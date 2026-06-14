# Deploying your own copy of this app

This guide walks you through deploying your own instance of a playground
sample app: your own smart contract on Polkadot Hub, your own frontend on
Bulletin Chain, your own `.dot` name, starting from nothing but a GitHub
account, a terminal, and a phone. It uses Rock Paper Scissors as the example, but
the steps are the same for every sample app (only the contract package name
differs; check the app's `contracts/*/Cargo.toml`).

Two tools do the work:

- **CDM** (`cdm`) builds and deploys the app's *smart contract*, and
  registers it in the on-chain contract registry so the frontend can find it
  by name.
- **Playground CLI** (`playground`, short alias `pg`) deploys the app's
  *frontend* to Bulletin Chain, registers your `.dot` name, and publishes
  the app to the playground registry so it shows up in the Apps grid.

Rough time: 30 minutes end to end. The slow parts are the toolchain
install and the first Rust build.

> **Two audiences for this guide.** Sections 0–8 below are the **community
> "deploy your own copy"** flow, which targets the **public playground
> network** via the Playground CLI. The repo's `main` branch, however, is
> configured for the **official Summit deployment** (`rps-game.dot`) — its
> frontend builds against the Summit Asset Hub descriptor and the Summit CDM
> registry. See **[Official Summit deployment](#official-summit-deployment-maintainers)**
> just below. If you're forking to deploy on the public playground network,
> read the **[forker note](#forking-to-the-public-playground-network)** first.

## Official Summit deployment (maintainers)

The official instance lives on the **Summit** network, served at two names that
point at the same build — **`rock-paper-scissors.dot`** (primary, in the Apps
grid + moddable) and **`rps-game.dot`** (alias). It is a two-leg deploy; the
contract leg is manual (VM), the frontend leg is CI. **Full notes:
[`.github/DEPLOY_SUMMIT.md`](.github/DEPLOY_SUMMIT.md).**

1. **Contract → Summit Asset Hub** (manual / VM). On the funded,
   Bulletin-authorized deployer (the W3S publisher `5Fk8…` — `cdm deploy`
   publishes the ABI to Bulletin, so the signer must hold a Bulletin allowance):

   ```sh
   cdm account set -n w3s --mnemonic "<5Fk8 mnemonic>"   # then: cdm account map -n w3s
   npm run build:contracts          # cdm build
   npm run deploy:summit            # cdm deploy -n w3s → Summit registry 0xa5747e60…
   cdm i -n w3s @rps/leaderboard    # sync the deployed address into cdm.json
   git add cdm.json && git commit   # lock the address; pushing main rebuilds the SPA
   ```

   `@rps/leaderboard` is first-come on the Summit CDM registry; `5Fk8` claims
   it. `cdm deploy` does **not** write `cdm.json` — the `cdm i` step does.

2. **Frontend → Summit Bulletin + both names** (CI). Handled by
   `.github/workflows/deploy-summit.yml` on push to `main` (or
   `workflow_dispatch`). It builds the SPA, asserts the bundle is Paseo-free,
   builds the PCF `playground-cli` fork (Summit-capable), and runs
   `playground deploy --env summit` headless: `rock-paper-scissors.dot` gets
   registered + bound + **published to the playground Apps grid** (`--playground
   --moddable`); `rps-game.dot` is bound to the same build. Requires the repo
   secret **`MNEMONIC`** (= the `5Fk8` mnemonic) and a `production` GitHub
   Environment.

   > `PRODUCT_ID = "rps-game.dot"` in `src/utils.ts` is fixed and **decoupled**
   > from the serving name — the app resolves the same product account at either
   > URL. Don't change it without intending to move every user's account.

   > **`rps-game.dot` is 8 chars → PoP-Full gated.** One-time, register it to
   > `5Fk8` via the DotNS `registerReserved` owner-override (the t3rminal
   > pattern) before CI can bind it; until then the alias step stays red but does
   > not block the primary deploy. `rock-paper-scissors.dot` (19 chars) is open —
   > no pre-step. See [`.github/DEPLOY_SUMMIT.md`](.github/DEPLOY_SUMMIT.md).

Bulletin storage expires (~14 days); renew per
`summit-deployer-skills/guides/OPS_BULLETIN_RENEWAL_RUNBOOK.md`.

### Forking to the public playground network

`main` builds for **Summit**. To deploy your own copy on the **public
playground** network using the community flow below, first point the frontend
and manifest back at Paseo:

- `src/utils.ts`: import the `paseo-asset-hub` descriptor (revert the three
  `summit_asset_hub` references) — or your build will bake the Summit chain.
- `cdm.json`: set `"registry"` back to the Paseo registry
  `0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0`.
- Use `npm run deploy` (the `-n paseo` script), not `deploy:summit`.

Then follow sections 0–8.

## 0. Prerequisites

You need three things installed:

**The Polkadot App on your phone**, with an account created. The standard
flow signs every deploy step by approving on the phone. (Deploying with a
pre-provisioned mnemonic instead is covered in step 7.)

**The CDM toolchain** (installs the `cdm` binary, the Rust toolchain it
needs, and the `cargo-pvm-contract` build plugin):

```sh
curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash
```

**The Playground CLI**:

```sh
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | bash
```

Open a fresh terminal afterwards so both are on your PATH, then verify:

```sh
cdm --version
playground --version
```

## 1. Fork and clone the repository

Fork this repo on GitHub (the **Fork** button), then clone **your fork**,
not the upstream repo:

```sh
git clone https://github.com/<your-github-username>/Rock-Paper-Scissors.git
cd Rock-Paper-Scissors
```

*What's happening:* you now own a copy of the app: frontend (`src/`),
smart contract (`contracts/`), and the manifest that ties them together
(`cdm.json`).

The fork matters beyond etiquette. When you later deploy with
`--playground`, the CLI publishes your git `origin` URL as the app's public
source repo; that's what makes your app **moddable** (others can build on
it). If you clone the upstream repo directly, your app would advertise the
original author's code instead of yours.

## 2. Create and fund your deploy account

```sh
cdm init
```

*What's happening:* CDM generates a keypair (saved to
`~/.cdm/accounts.json`) and prints its address plus two balances: **Asset
Hub** (PAS tokens, which pay for contract deployment) and **Bulletin**
(a storage allowance, which pays for publishing the contract metadata).
Both start at zero.

**Write down the mnemonic it prints.** It's the only copy.

Fund the account using the two faucet links `cdm init` printed. **Both are
required before `cdm deploy`:**

- PAS for contract fees: <https://faucet.polkadot.io/?parachain=1500>
- Bulletin storage allowance:
  <https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet>
  (the **Faucet** tab: paste your address, submit; you get an allowance of
  ~100 transactions / ~10 MB, which expires after a while and can be topped
  up the same way)

Skipping the Bulletin one is the classic mistake; `cdm deploy` then fails
at its final step with `store data: InvalidTxError {"Invalid":{"Payment"}}`.

Then register the account for contract calls:

```sh
cdm account map -n paseo
```

*What's happening:* contracts on Polkadot Hub live behind `pallet-revive`,
which requires every account that calls contracts to register a one-time
mapping to an EVM-style address. Without it, every contract interaction
fails with `AccountUnmapped`. Costs a fraction of a PAS (which is why
funding comes first).

Re-check balances any time with `cdm account bal -n paseo`.

## 3. Rename the contract package to your own namespace

Contract package names work like npm package names, except they are
**globally owned in the on-chain registry: first deploy wins, forever**.
The name this repo ships with (`@rps/leaderboard`) belongs to the original
deployment, so publishing under it from your account will fail. Claim your
own:

Edit `contracts/leaderboard/Cargo.toml`:

```toml
[package.metadata.cdm]
package = "@<your-handle>/leaderboard"   # was: @rps/leaderboard
```

Then update every other reference to the old name. For this app that's:

- `cdm.json`: two occurrences (under `dependencies` and `contracts`)
- `src/utils.ts`: two occurrences (the `libraries: [...]` option and the
  `getContract("...")` call)

Find them all with:

```sh
grep -rn "@rps/leaderboard" --include="*.ts" --include="*.toml" --include="*.json" . | grep -v node_modules
```

> Note for Rock Paper Scissors specifically: all instances deployed under
> the shipped name resolve the same contract, so they share one global
> leaderboard. By deploying your own contract you're opting out of that;
> your leaderboard starts empty, and only your instance (and mods of it)
> write to it. That's the right trade for learning the full deploy. Keep
> the original name in `cdm.json` instead if you'd rather stay on the
> shared leaderboard and skip steps 3-5.

## 4. Build the contract

```sh
cdm build
```

*What's happening:* compiles the Rust contract in `contracts/` to PolkaVM
bytecode plus a Solidity-style ABI, under `target/release/`. The first
build compiles the full dependency graph and takes several minutes; later
builds are fast.

If it fails telling you to `rustup component add rust-src` (the underlying
error mentions a missing `Cargo.lock` in the Rust source tree), do exactly
that and retry. The contract builds Rust's standard library from source
for the PolkaVM target, which needs that component.

## 5. Deploy the contract

```sh
cdm deploy -n paseo
```

(This repo also ships `npm run deploy`, which runs the same command with
the network endpoints pinned explicitly. Either works.)

*What's happening, in order:* (1) rebuilds if needed, (2) deploys the
bytecode to Paseo Asset Hub via pallet-revive, (3) publishes the contract
metadata to Bulletin, (4) registers `@<your-handle>/leaderboard → (address,
metadata CID)` in the on-chain CDM registry. Step 4 is what lets the
frontend resolve your contract's address by name at runtime; no hardcoded
addresses.

Two timing notes, both observed in practice:

- The command can sit quietly for a minute or two at the end: it's waiting
  for the registry update to **finalize**. Let it exit on its own; killing
  it mid-wait leaves the registry pointing at your previous version (or at
  nothing).
- Re-running `cdm deploy` is safe but not idempotent: each run deploys a
  **fresh contract instance** and moves the registry's "latest" pointer to
  it. Frontends that resolve via the live registry follow automatically.

Afterwards, sync your local manifest to what's actually registered:

```sh
cdm i -n paseo @<your-handle>/leaderboard
```

(`cdm i` is short for `cdm install`.) This writes the registered address
and ABI into `cdm.json`; your frontend now points at your contract.

## 6. Sign in with the Playground CLI

```sh
playground init
```

*What's happening:* `init` checks prerequisites (it will reuse the Rust
toolchain from step 0), asks you for a display name, then shows a QR code.
Scan it with the Polkadot App and approve: one signature on the phone.
That authenticates you via Proof of Personhood, pairs a product account
(you'll see an address like `playground.dot/0`), provisions a local
session key, and confirms allowances and funding.

There is **no `playground login` subcommand**; login is part of `init`.
Sign out later with `playground logout`.

A warning like `[cloudStorage] checkAuthorization: query failed ...
DisjointError` *after* `✓ setup complete` has been observed and was
harmless. If you got the `setup complete` line, proceed.

## 7. Deploy the frontend to the playground

```sh
playground deploy --playground --moddable --domain rock-paper-scissors --signer phone
```

Use the repository name as the domain (or any name of your choice if you
want to rename it). Two constraints to know: if the name is already taken
by someone else, pick another; and very short names currently require
personhood verification, so prefer names of 9+ characters.

The CLI shows a **preflight summary** before submitting anything. Read it
before pressing Enter:

- `moddable: yes ... <repo url>` must point at **your fork**. It's
  auto-detected from your git `origin`; if it shows the upstream repo, you
  cloned instead of forking. Fix with
  `git remote set-url origin https://github.com/<you>/Rock-Paper-Scissors.git`.
- It lists the **4 expected phone approvals**: reserve domain (DotNS
  commitment), finalize domain (DotNS register), link content
  (setContenthash), publish to Playground registry, plus possibly one more
  to top up the Bulletin storage allowance.

Press Enter, keep your phone unlocked, and approve each signature as it
arrives. Between the first two approvals there is a deliberate ~60-second
pause (DotNS's anti-front-running window); it's not stuck.

*What's happening:*

1. builds the frontend, then uploads the assets + app metadata to
   **Bulletin Chain** (decentralized storage, no server anywhere),
2. registers your **`.dot` domain** via DotNS and points it at the upload,
3. publishes the app to the **playground registry**, which puts it in the
   playground's Apps grid and awards your account its deploy XP,
4. prints the result: your live URL (`https://<name>.dot.li`, or
   `<name>.dot` inside Polkadot Desktop/Mobile) plus the app, IPFS, and
   metadata CIDs.

### Deploying with a mnemonic instead of the phone

If you have a pre-provisioned account (a mnemonic or secret URI) you can
skip the phone flow entirely, including `playground init`:

```sh
playground deploy --playground --moddable --domain rock-paper-scissors --signer dev --suri "<your secret URI>"
```

Everything (storage, DotNS, playground publish) is then signed by that
account, with no phone approvals. Two things to know:

- **Always pass `--suri`.** Bare `--signer dev` without it falls back to a
  shared, publicly-known development mnemonic, so anyone could control what
  you deploy.
- The account must be funded like any other: PAS for fees and a Bulletin
  storage allowance (the step 2 faucets work for it too).

## 8. Verify

- Open `https://<name>.dot.li`: your app, served from Bulletin. Use a real
  browser; fetching the URL with curl/scripts returns the gateway's
  client-side resolver shell, not your HTML.
- Open the playground's **Apps** tab (the playground app inside Polkadot
  Desktop / Mobile). Your card should appear, newest first.
- Check the playground's **Leaderboard**: your account earned its deploy
  XP.
- Play a round in your instance. The result lands on the on-chain
  leaderboard: a real transaction against *your* contract.

## Troubleshooting

All of these were hit for real while writing this guide.

| Symptom | Cause / fix |
|---|---|
| Build fails asking for `rustup component add rust-src` | run exactly that, then retry `cdm build` |
| `AccountUnmapped` on deploy or contract call | run `cdm account map -n paseo` (needs a funded account) |
| `store data: InvalidTxError {"Invalid":{"Payment"}}` at the end of `cdm deploy` | no Bulletin storage allowance; use the Bulletin faucet from step 2, then re-run the deploy |
| Deploy fails with a registry/name conflict | the package name in `Cargo.toml` still belongs to someone else; see step 3 |
| `cdm deploy` looks finished but doesn't exit | it's finalizing the registry update; give it a couple of minutes. Don't kill it: an interrupted run leaves the registry on your previous version |
| Re-ran `cdm deploy` and got a different address | expected: each run deploys a fresh instance and repoints the registry's "latest". Run `cdm i` to re-sync `cdm.json` |
| `error: unknown command 'login'` | login is `playground init` in current CLI versions |
| `[cloudStorage] ... DisjointError` after `playground init` | observed as harmless when it appears after `✓ setup complete`; proceed |
| `Domain <name>.dot is already registered` | first come, first served; pick a different name (re-deploying a domain you own yourself is fine) |
| `<name>.dot requires ProofOfPersonhoodFull, but this signer is NoStatus` | the name is too short to be open to all accounts; pick a longer one (9+ characters) |
| Preflight shows `moddable: ... github.com/paritytech/...` | your git `origin` is the upstream repo, not your fork; `git remote set-url origin <your fork URL>` |
| Deploy pauses ~60s after the first phone approval | DotNS's mandatory commit-reveal wait (front-running protection), not a hang |
| App loads but shows no data in a plain desktop browser | expected: chain/storage access flows through the host. Open it inside Polkadot Desktop/Mobile, or via its `.dot.li` URL |
| `.dot.li` URL returns a generic Polkadot page to curl/scripts | the gateway serves a client-side resolver shell; only a real browser renders your app |
