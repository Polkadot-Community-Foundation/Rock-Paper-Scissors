# Official Summit deployment — maintainer notes

How the **official** Rock-Paper-Scissors instance is deployed to the Web3 Summit
network. (Community forkers deploying their own copy use `DEPLOYMENT.md` instead.)

Two legs. The **contract** leg is manual/VM; the **frontend** leg is CI
(`.github/workflows/deploy-summit.yml`).

## One account does everything: `5Fk8…`

`5Fk8FBTqBpAyBReZPse2wn8Lf4ADzdNVAsrGoNMSTxKedN8f` (H160 `0xF8d186c352e2ea0B9C02c211525A20DdcB8CD2dD`),
the canonical PCF "W3S publisher". It is Bulletin-authorized, funded + Revive-mapped
on Summit Asset Hub, the `@w3s/playground-registry` publisher, and owns the DotNS
names. It signs every leg.

- **Repo secret:** `MNEMONIC` = the `5Fk8` mnemonic. The only secret the deploy
  workflow needs. (`--signer dev --suri "$MNEMONIC"` — the `--suri` value IS the
  real signer; it is NOT the public dev pool.)
- **GitHub Environment:** `production` (gates the secret; add required reviewers if wanted).

## Leg 1 — contract `@rps/leaderboard` → Summit Asset Hub (manual / VM)

`cdm deploy` needs the CDM toolchain (Rust + branch-pinned `cargo-pvm-contract` +
per-toolchain `rust-src`) and publishes the ABI to Bulletin with the *same* signer
— so the deployer must be Bulletin-authorized (`5Fk8`). On the deployment VM:

```sh
cdm account set -n w3s --mnemonic "<5Fk8 mnemonic>"
cdm account map  -n w3s
npm run build:contracts          # cdm build
npm run deploy:summit            # cdm deploy -n w3s → Summit registry 0xa5747e60…0141
cdm i -n w3s @rps/leaderboard    # sync the deployed address into cdm.json (deploy does NOT)
git add cdm.json && git commit   # lock the address; pushing main rebuilds + redeploys the SPA
```

`@rps/leaderboard` is first-come on the Summit CDM registry; `5Fk8` claims it.

## Leg 2 — frontend → Summit Bulletin + two DotNS names (CI)

`deploy-summit.yml` builds the SPA, asserts it is Paseo-free, builds the PCF
`playground-cli` fork from source (pinned SHA — it carries the Summit `cdm-env`),
and runs `playground deploy --env summit` headless, binding **the same build** to
two names:

| Name | Class | How |
|---|---|---|
| `rock-paper-scissors.dot` | 19 chars → **open** | CI registers + binds + **publishes** to the playground Apps grid (`--playground --moddable --tag gaming`). No gate. |
| `rps-game.dot` | 8 chars → **PoP-Full gated** | CI binds the contenthash only (`--no-playground`). **Prerequisite:** pre-register it to `5Fk8` (below). |

The same `dist/` serves both names — `PRODUCT_ID = "rps-game.dot"` is hardcoded in
`src/utils.ts` (not derived from the URL), so the app resolves the same product
account regardless of which name it is served at.

### One-time: register the `rps-game.dot` alias (owner-override)

8-char names are PoP-Full gated on Summit, and the grant has not been effective in
practice (signers read `NoStatus`) — so `5Fk8` cannot self-register it. Register it
with the DotNS **`registerReserved` owner-override** (owner key `0x8c78…`), the same
mechanism used for `t3rminal.dot` / `terminal.dot`. See the deployer KB
(`DOTNS_REFERENCE.md` / `BANDERSNATCH_KEY_GUIDE.md`). Until this is done, the
"Bind rps-game.dot alias" step stays red (it is `continue-on-error`, so it never
blocks the primary `rock-paper-scissors.dot` deploy); re-run after registering.

`rock-paper-scissors.dot` needs no pre-step — CI registers it on the first run
(best run via `workflow_dispatch` so you can watch it; ~2 SUM one-time).

## Ordering

Deploy the **contract first** (leg 1) so the committed `cdm.json` carries the
Summit address; then push `main` (or `workflow_dispatch`) to run leg 2. The SPA
resolves the contract address live from the CDM registry, but the registry must
hold a registered `@rps/leaderboard` or contract features error.

## Lifecycle

Bulletin storage expires (~201,600 blocks ≈ 14 days). Renew per
`summit-deployer-skills/guides/OPS_BULLETIN_RENEWAL_RUNBOOK.md` (or
`enable_auto_renew`). The deploy tool does not auto-renew.

## CLI-fork drift

`PLAYGROUND_CLI_REF` is pinned to a SHA of the PCF `playground-cli` fork. Bump it
as the fork advances; the hard requirement is that its bundled
`@polkadot-community-foundation/cdm-env` stays ≥ 2.1.0 (so `getRegistryAddress("w3s")`
is populated — the workflow's sanity step fails the run otherwise).
