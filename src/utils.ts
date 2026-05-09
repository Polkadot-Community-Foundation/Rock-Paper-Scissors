import { useState, useEffect } from "react";
import {
    createAccountsProvider,
    preimageManager,
    requestPermission,
    createPapiProvider,
    type ProductAccount,
} from "@novasamatech/product-sdk";
import { ContractManager } from "@parity/product-sdk-contracts";
import { createInkSdk, ss58ToEthereum } from "@polkadot-api/sdk-ink";
import { createClient, AccountId, type PolkadotSigner } from "polkadot-api";
import { getWsProvider } from "@polkadot-api/ws-provider";
import { blake2b } from "@noble/hashes/blake2.js";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import type { MultihashDigest } from "multiformats/hashes/interface";
import type { Move, RoundResult } from "./types.ts";

const PASEO_ASSET_HUB_GENESIS = "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2" as const;
const PASEO_ASSET_HUB_WS = "wss://asset-hub-paseo-rpc.n.dwellir.com";

// ---------------------------------------------------------------------------
// Permissions (RFC-0002)
// ---------------------------------------------------------------------------

const _grantedPermissions = new Set<string>();

async function ensurePermission(tag: "ChainSubmit" | "PreimageSubmit" | "StatementSubmit") {
    if (_grantedPermissions.has(tag)) return;
    try {
        const result = await requestPermission({ tag, value: undefined });
        if (result.isOk() && result.value) {
            _grantedPermissions.add(tag);
            console.log(`[Permission] ${tag} granted`);
        } else {
            console.warn(`[Permission] ${tag} denied`, result.isErr() ? result.error : "user rejected");
        }
    } catch (err) {
        console.warn(`[Permission] ${tag} request failed:`, err);
    }
}

// ---------------------------------------------------------------------------
// Account flow — direct against product-sdk (matches t3rminal pattern).
// We intentionally avoid @parity/product-sdk-signer because its SignerManager
// goes through getLegacyAccounts() which the new desktop/android hosts reject.
// ---------------------------------------------------------------------------

const accountsProvider = createAccountsProvider();
const accountIdCodec = AccountId();

/**
 * Identifier the host uses to scope our product. Polkadot Desktop ≥ 0.7.5
 * accepts both ".dot" hostnames and "localhost:PORT" — read live so dev and
 * prod both work.
 */
function getProductIdentifier(): string | null {
    if (typeof window === "undefined") return null;
    return window.location.host || null;
}

export function getAppAccountId(): [string, number] {
    const identifier = getProductIdentifier() ?? "rps-game.dot";
    return [identifier, 0];
}

export interface AppAccount {
    /** SS58 string derived from the host's product public key. */
    address: string;
    /** Same SS58 — kept under `h160Address` for compatibility with existing pages. */
    h160Address: string;
    /** 32-byte sr25519 public key. */
    publicKey: Uint8Array;
    /** Display name (optional). */
    name: string | null;
    /** PolkadotSigner ready for `tx.signSubmitAndWatch`. */
    signer: PolkadotSigner;
    /** [identifier, derivationIndex] used by host-mediated APIs. */
    productAccountId: [string, number];
    /** ProductAccount struct used by getProductAccountSigner. */
    productAccount: ProductAccount;
    /** Backwards-compat: pages call account.getSigner(). */
    getSigner(): PolkadotSigner;
}

interface AccountState {
    status: "idle" | "connecting" | "ready" | "error";
    account: AppAccount | null;
    error?: string;
}

let _state: AccountState = { status: "idle", account: null };
const _listeners = new Set<(s: AccountState) => void>();

function setState(next: AccountState) {
    _state = next;
    for (const cb of _listeners) cb(next);
}

export function useAccountState(): AccountState {
    const [state, set] = useState<AccountState>(_state);
    useEffect(() => {
        const cb = (s: AccountState) => set(s);
        _listeners.add(cb);
        return () => { _listeners.delete(cb); };
    }, []);
    return state;
}

export async function connectAccount(): Promise<void> {
    if (_state.status === "connecting") return;
    setState({ status: "connecting", account: null });

    try {
        const [identifier, derivationIndex] = getAppAccountId();
        console.log(`[Account] Requesting product account ${identifier}#${derivationIndex}`);

        const result = await accountsProvider.getProductAccount(identifier, derivationIndex);
        if (result.isErr()) {
            const errMsg = `${(result.error as any)?.tag ?? "Unknown"}: ${(result.error as any)?.value?.reason ?? String(result.error)}`;
            console.warn("[Account] getProductAccount error:", errMsg);
            setState({ status: "error", account: null, error: errMsg });
            return;
        }

        const { publicKey } = result.value;
        const productAccount: ProductAccount = { dotNsIdentifier: identifier, derivationIndex, publicKey };
        const signer = accountsProvider.getProductAccountSigner(productAccount);
        const ss58 = accountIdCodec.dec(publicKey);
        // pallet-revive contracts key by EVM-style h160 (keccak256(publicKey).slice(12)).
        // Use sdk-ink's helper so pages can pass a stable hex address that matches
        // what `Revive.OriginalAccount` and contract bytes20 args expect.
        const h160Address = ss58ToEthereum(ss58) as unknown as `0x${string}`;

        let displayName: string | null = null;
        try {
            const userIdResult = await accountsProvider.getUserId();
            if (userIdResult.isOk()) {
                displayName = (userIdResult.value as any).primaryUsername ?? null;
            }
        } catch { /* optional */ }

        const account: AppAccount = {
            address: ss58,
            h160Address,
            publicKey,
            name: displayName,
            signer,
            productAccountId: [identifier, derivationIndex],
            productAccount,
            getSigner: () => signer,
        };

        // Wire up signer + origin defaults so contract queries don't fall back
        // to the dev Alice account and tx calls don't need explicit `{ signer }`.
        if (_contractManager) {
            _contractManager.setDefaults({ origin: ss58, signer });
        }

        console.log(`[Account] Ready — ${ss58} (h160 ${h160Address}) (${displayName ?? identifier})`);
        setState({ status: "ready", account });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Account] Connect failed:", msg);
        setState({ status: "error", account: null, error: msg });
    }
}

// ---------------------------------------------------------------------------
// Bulletin upload — host preimage path (works in dev mode)
// ---------------------------------------------------------------------------

const BLAKE2B_256_CODE = 0xb220;

function encodeVarint(value: number): Uint8Array {
    const bytes: number[] = [];
    let num = value;
    while (num >= 0x80) {
        bytes.push((num & 0x7f) | 0x80);
        num >>= 7;
    }
    bytes.push(num & 0x7f);
    return new Uint8Array(bytes);
}

export function calculateCID(bytes: Uint8Array): string {
    const hash = blake2b(bytes, { dkLen: 32 });
    const codeBytes = encodeVarint(BLAKE2B_256_CODE);
    const lengthBytes = encodeVarint(hash.length);
    const multihash = new Uint8Array(codeBytes.length + lengthBytes.length + hash.length);
    multihash.set(codeBytes, 0);
    multihash.set(lengthBytes, codeBytes.length);
    multihash.set(hash, codeBytes.length + lengthBytes.length);
    const digest: MultihashDigest = {
        code: BLAKE2B_256_CODE,
        size: hash.length,
        bytes: multihash,
        digest: hash,
    };
    return CID.createV1(raw.code, digest).toString();
}

export async function uploadToBulletin(_account: AppAccount, bytes: Uint8Array): Promise<string> {
    await ensurePermission("PreimageSubmit");
    const cid = calculateCID(bytes);
    console.log("[Bulletin] Submitting preimage via host, size:", bytes.length, "expected CID:", cid);
    await preimageManager.submit(bytes);
    console.log("[Bulletin] Preimage stored.");
    return cid;
}

// ---------------------------------------------------------------------------
// Contract (sdk-ink + ContractManager). WS fallback handles dev mode
// where the host refuses to open Asset Hub chain provider.
// ---------------------------------------------------------------------------

let _contractManager: ContractManager | null = null;
let _contract: any = null;
let _polkadotClient: ReturnType<typeof createClient> | null = null;

/**
 * Wake the Asset Hub chain follow before a contract call. The host container
 * tears down the follow when the tab is backgrounded long enough; the first
 * request after wake bails with "No active follow for this chain" until we
 * touch the client to trigger a re-follow. Same trick t3rminal uses.
 */
export async function wakeChainFollow(): Promise<void> {
    if (!_polkadotClient) return;
    try {
        await _polkadotClient.getBestBlocks();
    } catch (err) {
        console.warn("[CDM] wakeChainFollow failed:", err);
    }
}

const NO_FOLLOW_RE = /no active follow/i;

/**
 * Wrap a contract method handle so each `query()` / `tx()` first wakes the
 * chain follow and retries once on "No active follow for this chain".
 */
function withFollowRetry<T extends Record<string, any>>(method: T): T {
    const wrap = <Fn extends (...a: any[]) => Promise<any>>(fn: Fn): Fn =>
        (async (...args: any[]) => {
            await wakeChainFollow();
            try {
                return await fn(...args);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!NO_FOLLOW_RE.test(msg)) throw err;
                console.warn("[CDM] follow lost mid-call, retrying once:", msg);
                await wakeChainFollow();
                return await fn(...args);
            }
        }) as Fn;

    return new Proxy(method, {
        get(target, prop) {
            const v = target[prop as keyof T];
            if (typeof v === "function") return wrap(v.bind(target));
            return v;
        },
    });
}

function wrapContract(contract: any): any {
    return new Proxy(contract, {
        get(target, prop) {
            const m = target[prop];
            if (m && typeof m === "object" && ("query" in m || "tx" in m)) {
                return withFollowRetry(m);
            }
            return m;
        },
    });
}

let _cdmJson: any = null;
let _contractInitPromise: Promise<void> | null = null;

/** Stage cdm.json without opening the Asset Hub chain client yet. */
export function stageCdmJson(cdmJson: any): void {
    _cdmJson = cdmJson;
}

/**
 * Lazy contract init. Holding an Asset Hub PolkadotClient open (with its
 * chain-head follow) at app startup interferes with Bulletin preimage submits
 * — t3rminal pattern is to only spin up the chain client when a contract call
 * is actually about to happen. This defers `createPapiProvider`/`createClient`
 * until the first `getContract()` consumer calls a method.
 */
async function ensureContractsReady(): Promise<void> {
    if (_contractManager || !_cdmJson) return;
    if (_contractInitPromise) return _contractInitPromise;
    _contractInitPromise = (async () => {
        await ensurePermission("ChainSubmit");

        // Asset Hub access:
        //  - In dev (localhost) the host refuses to open a chain follow for the
        //    unregistered domain even though `host_feature_supported` returns
        //    true, so `createPapiProvider` traps and the fallback never fires.
        //    Bypass and go straight to WS so the chain follow actually starts.
        //  - In a deployed `*.dot` app the host owns the follow; route through
        //    `createPapiProvider` so signing/permissions stay coordinated.
        const isDevHost =
            typeof window !== "undefined" && /^localhost(:\d+)?$/.test(window.location.host);

        const provider = isDevHost
            ? getWsProvider(PASEO_ASSET_HUB_WS)
            : createPapiProvider(PASEO_ASSET_HUB_GENESIS, getWsProvider(PASEO_ASSET_HUB_WS));
        console.log(`[CDM] Asset Hub provider: ${isDevHost ? "direct WS (dev)" : "host with WS fallback (prod)"}`);
        _polkadotClient = createClient(provider);

        console.log("[CDM] Waking Asset Hub chain follow...");
        await _polkadotClient.getChainSpecData();
        await _polkadotClient.getBestBlocks();
        console.log("[CDM] Chain follow active.");

        const inkSdk = createInkSdk(_polkadotClient, { atBest: true });
        _contractManager = new ContractManager(_cdmJson, inkSdk);
        _contract = wrapContract(_contractManager.getContract("@example/leaderboard"));
        console.log("[CDM] Contract manager ready");
        // wire defaults if account already loaded
        if (_state.account) {
            _contractManager.setDefaults({ origin: _state.account.address, signer: _state.account.signer });
        }
    })();
    return _contractInitPromise;
}

export async function initContracts(cdmJson: any): Promise<void> {
    stageCdmJson(cdmJson);
}

/**
 * Get a lazy-initialized contract handle. The Asset Hub chain client doesn't
 * spin up until a method is actually called, so Bulletin preimage submits at
 * startup don't compete with a leaderboard chain follow.
 */
export function getContract(): any {
    if (!_cdmJson) return null;
    // Return a proxy that defers chain init until first method call.
    return new Proxy({}, {
        get(_target, prop) {
            // sync property access (truthiness check) returns a stub method object
            return new Proxy({} as any, {
                get(_t, methodProp) {
                    if (methodProp !== "query" && methodProp !== "tx") return undefined;
                    return async (...args: any[]) => {
                        await ensureContractsReady();
                        if (!_contract) throw new Error("Contract init failed");
                        const real = _contract[prop as string];
                        if (!real) throw new Error(`Unknown method: ${String(prop)}`);
                        return real[methodProp](...args);
                    };
                },
            });
        },
    });
}

/**
 * Format a 20-byte address for contract `bytes20` parameters.
 *
 * sdk-ink's encoder accepts either a `0x...` hex string OR an object with
 * `asHex()`. Prior versions of this helper returned a `Binary` instance, but
 * multiple substrate-bindings versions hoisted into `node_modules` cause the
 * `asHex` duck-type check to occasionally fail across realm boundaries.
 * Returning the hex string is the most robust path — the encoder handles it
 * directly and there's no class identity to mis-match.
 */
export function asBytes20(hexOrAccount: string | AppAccount): `0x${string}` {
    const hex = typeof hexOrAccount === "string" ? hexOrAccount : hexOrAccount.h160Address;
    if (!hex.startsWith("0x")) return ("0x" + hex) as `0x${string}`;
    return hex as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Account mapping (Revive)
// ---------------------------------------------------------------------------

const _mappedAccounts = new Set<string>();

export async function ensureMapping(account: AppAccount): Promise<void> {
    if (_mappedAccounts.has(account.address)) return;
    _mappedAccounts.add(account.address);
    // Product accounts are pre-mapped on the host side; no extra step needed.
}

// ---------------------------------------------------------------------------
// Bulletin reads via public IPFS gateways
// ---------------------------------------------------------------------------

const GATEWAYS = [
    "https://paseo-ipfs.polkadot.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://nftstorage.link/ipfs/",
] as const;

export const IPFS_GATEWAY = GATEWAYS[0];

export async function fetchFromGateway(cid: string, timeoutMs = 30000): Promise<Uint8Array> {
    const master = new AbortController();
    const timer = setTimeout(() => master.abort(), timeoutMs);
    try {
        const winner = await Promise.any(
            GATEWAYS.map(async gw => {
                const resp = await fetch(gw + cid, { signal: master.signal });
                if (!resp.ok) throw new Error(`${gw} -> ${resp.status}`);
                return new Uint8Array(await resp.arrayBuffer());
            }),
        );
        master.abort();
        return winner;
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchJsonFromBulletin<T = unknown>(cid: string): Promise<T> {
    const bytes = await fetchFromGateway(cid);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const short = (addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4);

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
        ),
    ]);
}

export function determineWinner(player: Move, opponent: Move): RoundResult {
    if (player === opponent) return "draw";
    if (
        (player === "rock" && opponent === "scissors") ||
        (player === "paper" && opponent === "rock") ||
        (player === "scissors" && opponent === "paper")
    ) {
        return "win";
    }
    return "loss";
}

export function pointsForResult(result: RoundResult): number {
    if (result === "win") return 2;
    if (result === "loss") return -1;
    return 0;
}

const MOVES: Move[] = ["rock", "paper", "scissors"];
export function randomMove(): Move {
    return MOVES[Math.floor(Math.random() * 3)];
}

export function generateRoomCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}
