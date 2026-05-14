#!/usr/bin/env node
// Idempotently injects no-op mappers for Paseo Next v2 pallet-revive signed
// extensions into node_modules/@polkadot-api/pjs-signer/dist/pjs-signed-extensions-mappers.js.
//
// Upstream `@polkadot-api/pjs-signer`'s static mapper table only knows the
// classic 8 substrate extensions. Paseo Next v2 adds: AsPgas, AsRingAlias,
// CheckWeight, WeightReclaim. Without mappers, `from-pjs-account.signTx`
// throws `PJS does not support this signed-extension: <name>` before the tx
// ever reaches the host. The no-op mappers just omit those extensions from
// the PJS payload object — the encoded bytes still go into the extrinsic via
// PAPI's `extra` array, and the host's `signPayload` handler reads the actual
// extension data from `signedExtensions` + metadata.
//
// Runs after `npm install` (see "postinstall" in package.json). Re-running is
// safe: it appends only the mappers that aren't already in the file.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TARGET = "node_modules/@polkadot-api/pjs-signer/dist/pjs-signed-extensions-mappers.js";

// All custom signed extensions paseo-next-v2's pallet-revive ships; extend if
// the chain adds more. Probed from metadata via state_getMetadata.
const NOOP_MAPPERS = ["AsPgas", "AsRingAlias", "CheckWeight", "WeightReclaim"];

if (!existsSync(TARGET)) {
    console.warn(`[patch-pjs-signer] ${TARGET} not found — skipping (clean install in progress?)`);
    process.exit(0);
}

const src = readFileSync(TARGET, "utf8");

const missing = NOOP_MAPPERS.filter((name) => !src.includes(name));
if (missing.length === 0) {
    console.log("[patch-pjs-signer] all no-op mappers already present — no change");
    process.exit(0);
}

const stubLines = missing.map((name) => `const ${name} = () => ({});`).join("\n");
const patched = src.replace(
    /export\s*\{([^}]+)\};?\s*$/m,
    (_match, exports) =>
        `${stubLines}\nexport {${exports.trim()}, ${missing.join(", ")} };`,
);

if (patched === src) {
    console.error("[patch-pjs-signer] export statement not matched — aborting");
    process.exit(1);
}

writeFileSync(TARGET, patched, "utf8");
console.log(`[patch-pjs-signer] injected no-op mappers: ${missing.join(", ")}`);
