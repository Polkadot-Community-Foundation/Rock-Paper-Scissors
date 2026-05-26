---
quest: level-3
title: The Leaderboard — AI context
---

# Context for Claude / AI pair

You are helping a developer complete **Level 3: The Leaderboard** of the Rock Paper Scissors tutorial.

## Goal

Deploy a Rust/PVM contract on **Paseo Asset Hub Next** that indexes players by H160 address. Contract stores `(cid, points)` per player; game JSON itself stays on Bulletin from Level 2.

## Network

Paseo Next v2:

- **Asset Hub Next**: `wss://paseo-asset-hub-next-rpc.polkadot.io` (genesis `0x173cea9df45656cf612c8b8ece56e04e9a693c69cfaac47d3628dae735067af8`)
- **Bulletin Next**: `wss://paseo-bulletin-next-rpc.polkadot.io`
- **ContractRegistry on v2**: `0x0afb53bf7650f71a8a09f1a6f654fbe59e166195` (freshly bootstrapped — not the v1 registry that the stock `cdm` binary still has hardcoded)

## Prerequisite check

Before writing code, confirm the dev has:

- `rustup` installed
- `cdm` CLI installed and on PATH **AND** the binary-patched `cdm-paseo-next` alongside it (see "cdm workarounds" below — stock 0.1.0 points at the old Paseo registry)
- Funded account on **both** chains:
  - Asset Hub Next (ParaID 1500): `https://faucet.polkadot.io/?parachain=1500`
  - Bulletin Next (ParaID 1501): `https://faucet.polkadot.io/?parachain=1501`
- Same mnemonic / address on both. `cdm init -n paseo` generates the keypair to `~/.cdm/accounts.json`.

## Contract shape (`contracts/leaderboard/lib.rs`)

```rust
#[pvm::storage]
struct Storage {
    player_count: u64,
    player_at: Mapping<u64, [u8; 20]>,
    is_registered: Mapping<[u8; 20], bool>,
    player_cid: Mapping<[u8; 20], String>,
    player_points: Mapping<[u8; 20], i64>,
}

#[pvm::contract(cdm = "@example/leaderboard")]
mod leaderboard {
    fn register() -> u64 { /* ... */ }
    fn update_result(new_cid: String, points_delta: i64) { /* ... */ }
    fn get_player_count() -> u64 { /* ... */ }
    fn get_player_at(index: u64) -> [u8; 20] { /* ... */ }
    fn get_player_cid(player: [u8; 20]) -> String { /* ... */ }
    fn get_player_points(player: [u8; 20]) -> i64 { /* ... */ }
    fn is_registered(player: [u8; 20]) -> bool { /* ... */ }
}
```

## cdm workarounds (current, until upstream ships 0.2.x)

`cdm 0.1.0` has the ContractRegistry address hardcoded into the binary at `0xae344f7f0f91d3a2176032af2990abcc7606c7d4` — that contract only exists on the retired Paseo v1, so plain `cdm deploy -n paseo` against v2 RPCs fails with `Contract 0xae34… not found`.

**The repo ships these workarounds — don't reinvent them:**

1. **A binary-patched copy** of `cdm` lives at `~/.local/bin/cdm-paseo-next`, with the registry constant replaced by `0x0afb53bf7650f71a8a09f1a6f654fbe59e166195` (the freshly-bootstrapped registry on v2). Patch script: in-place byte replace (both addresses are 40 hex chars, identical length) + `codesign --force --sign -` to re-sign after edit so macOS Gatekeeper doesn't kill it.

2. **`contracts/contract-registry/`** holds a copy of the registry crate source (taken from `~/.cargo/git/checkouts/contract-dependency-manager-…/src/contract`). Needed once during `cdm deploy --bootstrap` to build the registry. After bootstrap, it's `exclude`-d from the Cargo workspace so subsequent `cdm deploy` runs don't try to redeploy it alongside the leaderboard (would cause nonce-stale collisions).

3. **`package.json` deploy script**:

    ```json
    "deploy": "cdm deploy -n paseo --registry-address 0x0afb53bf7650f71a8a09f1a6f654fbe59e166195 --assethub-url wss://paseo-asset-hub-next-rpc.polkadot.io --bulletin-url wss://paseo-bulletin-next-rpc.polkadot.io"
    ```

    (`--registry-address` was added by a later cdm patch; if your CLI doesn't accept it, fall back to `cdm-paseo-next` binary.)

When upstream ships a `cdm` that accepts `--registry-address` as a first-class flag, you can drop both the binary patch and the vendored crate.

## Build + deploy flow

```bash
cdm build                # builds leaderboard PVM
npm run deploy           # uses paseo-next RPCs + registry override
```

`cdm deploy` writes the contract address into `cdm.json` under `contracts["acc2c3b5e912b762"]["@example/leaderboard"].address`. The target key `acc2c3b5e912b762` is the same on both Paseo v1 and v2 — only the RPC URLs inside `targets[].asset-hub` / `targets[].bulletin` differ.

## Frontend integration (current SDK)

```ts
import { ContractManager, ensureContractAccountMapped } from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { ss58ToH160 } from "@parity/product-sdk-address";
import { createClient, createPapiProvider } from "polkadot-api";
import { getWsProvider } from "@polkadot-api/ws-provider";
import cdmJson from "../cdm.json";

// PAPI client — host-routed in prod, direct WS in dev (localhost). The host refuses
// to open a chain follow for an unregistered domain even though `host_feature_supported`
// returns true, so for dev we bypass `createPapiProvider` and go straight to WS.
const isDevHost = /^localhost(:\d+)?$/.test(window.location.host);
const PASEO_ASSET_HUB_WS = "wss://paseo-asset-hub-next-rpc.polkadot.io";
const PASEO_ASSET_HUB_GENESIS = "0x173cea9df45656cf612c8b8ece56e04e9a693c69cfaac47d3628dae735067af8";

const provider = isDevHost
    ? getWsProvider(PASEO_ASSET_HUB_WS)
    : createPapiProvider(PASEO_ASSET_HUB_GENESIS, getWsProvider(PASEO_ASSET_HUB_WS));
const client = createClient(provider);

// IMPORTANT: wake the chain follow before passing the client to ContractManager.
// PAPI's chain-head subscription is lazy — the first storage query throws
// "No active follow for this chain" until something touches the client.
await client.getChainSpecData();
await client.getBestBlocks();

// Build the manager. SDK 0.5 dropped @polkadot-api/sdk-ink — use `fromClient`,
// which builds a ContractRuntime internally that wires the typed API (for
// extrinsics + storage) and the unsafe API (for the ReviveApi.call dry-run,
// sidesteps compat-token drift if descriptor lags a runtime upgrade).
const contractManager = ContractManager.fromClient(
    cdmJson,
    client,
    paseo_asset_hub,
    { defaultOrigin: account.address, defaultSigner: account.signer },
);
const lb = contractManager.getContract("@example/leaderboard");

// Query (read-only) — `.query(...args)` returns `{ success, value, gasRequired }`.
const cidRes = await lb.getPlayerCid.query(asBytes20(account));
if (!cidRes.success) throw new Error("query failed");
const cid: string = cidRes.value;

// Tx (write) — uses defaultSigner/defaultOrigin from setDefaults; no need to
// pass `{ signer, origin }` per call.
await lb.register.tx();
await lb.updateResult.tx(newCid, BigInt(pointsDelta));
```

### Account mapping is mandatory on Paseo Next v2

```ts
// Before any contract call from a freshly-created product account:
const mapped = await ensureContractAccountMapped(
    contractManager.getRuntime(),
    account.address,
    account.signer,
);
// mapped === null → already mapped (free)
// mapped !== null → first-time map_account() tx landed in block #mapped.block.number
```

This **must** be called per-account on first contract interaction. pallet-revive on v2 rejects `Revive.call` from any SS58 origin that hasn't been mapped to its derived H160 — the old desktop-side pre-mapping shortcut from v1 is gone.

## `asBytes20` helper

```ts
export function asBytes20(hexOrAccount: string | AppAccount): `0x${string}` {
    const hex = typeof hexOrAccount === "string" ? hexOrAccount : hexOrAccount.h160Address;
    return (hex.startsWith("0x") ? hex : `0x${hex}`) as `0x${string}`;
}
```

sdk-ink's encoder accepted either `0x…` hex strings or `Binary` instances. SDK 0.5 contracts is stricter — pass the hex string only. Don't construct `FixedSizeBinary<20>` / `Binary` wrappers; cross-realm class identity issues bite when multiple substrate-bindings versions hoist into `node_modules`.

## Lazy contract init pattern

The repo defers `createClient(...)` until the first contract method call (`stageCdmJson(cdmJson)` plants the manifest, `ensureContractsReady()` does the actual init). Reason: holding an Asset Hub chain follow open at app startup competes with Bulletin preimage submits and can starve the host's connection pool. If you're adding new pages that hit the contract, follow the same pattern via `getContract()` — it returns a proxy that defers init until method invocation.

## Wake-on-touch wrapper

Each contract method handle is wrapped so `.query()` / `.tx()` first calls `wakeChainFollow()` (a no-op `client.getBestBlocks()`) and retries once on `"No active follow for this chain"`. The host tears down the chain follow when the tab is backgrounded long enough — without this retry, the first call after wake bombs. Same trick t3rminal uses.

## Common gotchas

- **`PJS does not support this signed-extension`** in console = the signer was built with `signerType: "signPayload"` (the default). Fix: pass `"createTransaction"` as the second arg to `getProductAccountSigner` — see [level-1](level-1-local-challenger.md) for the full signer setup.
- **`AccountUnmapped` from `Revive`** = `ensureContractAccountMapped` not called before the first contract tx. The Level 1 comment that "product accounts are pre-mapped on the host side" is **wrong on Paseo Next v2** — has to be called explicitly.
- **`DuplicateContract` from `cdm deploy`** is harmless — the contract address is deterministic (deployer + salt + code → same address). On a re-deploy after a successful one, it just means "already there".
- **`Invalid::Stale`** during deploy = nonce collision. Most often caused by `cdm` trying to deploy both `contract-registry` and `@example/leaderboard` in parallel because both ended up as workspace members. Fix: keep `exclude = ["contracts/contract-registry"]` in `Cargo.toml`.
- **`Invalid::Payment`** = deployer / caller has no PAS on the relevant chain. **Both** chains need funding for the deploy step (Asset Hub for the contract, Bulletin for the metadata upload).
- **H160 vs SS58**: the contract keys by H160 (`account.h160Address`). Use SS58 (`account.address`) only for `origin` / signing. The `ss58ToH160` helper in `@parity/product-sdk-address` is the canonical derivation — don't roll your own keccak.
- **Points can be negative** (i64) — losses subtract. Don't use `u64`.
- **Contract is the index, Bulletin is the data.** Don't put game JSON on-chain — store the CID only.
- **`register()` must be called once per player** before any `update_result()`. Check `isRegistered()` first; auto-register on first save.

## Acceptance check

- `npm run deploy` succeeds against Paseo Next v2; address written to `cdm.json`
- New player triggers one `Revive.map_account()` tx, then one `register()` call, then `update_result()` per match
- Switching browsers with the same account pulls points from the contract and games from Bulletin
- Leaderboard page lists all registered players sorted by points

## Do NOT

- Don't add multiplayer yet — Level 4
- Don't try to store game round data on-chain — too expensive, stays on Bulletin
- Don't import `@polkadot-api/sdk-ink` — it was dropped in `@parity/product-sdk-contracts` 0.4. Use `ContractManager.fromClient(...)`.
- Don't construct contract addresses by hand; let `cdm deploy` write to `cdm.json` and read from there
