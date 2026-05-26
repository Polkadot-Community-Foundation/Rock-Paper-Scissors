---
quest: level-1
title: Local Challenger — AI context
---

# Context for Claude / AI pair

You are helping a developer complete **Level 1: Local Challenger** of the Rock Paper Scissors tutorial.

## Starting state

- Host-managed product account via `@novasamatech/product-sdk` (`createAccountsProvider().getProductAccount(identifier, 0)`)
- Best-of-3 vs computer
- Results saved in `localStorage` under key `rps-game:<h160Address>`
- Profile card showing W/L/D, win rate, last 10 games
- No smart contracts, no Bulletin, no Statement Store

## Goal

The developer should ship a **modded** version of the starting app to their own `.dot` domain on Paseo Next v2. Modding can be visual (theming, emoji sets) or behavioral (computer "personality", trash-talk, sound effects). Contract/chain changes are explicitly **out of scope** for this level.

## Runtime requirements

- **Polkadot Desktop ≥ 0.3.10** (ships `@novasamatech/host-api 0.7.9-5` — required for the `createTransaction` signing path the SDK uses)
- **Polkadot mobile (nightly)** if signing on a paired phone. Production builds don't yet have Paseo Next v2 in their `chains_v2` Firebase config — signing will fail with "Failed to load transaction".

## Relevant files

- `src/pages/SoloGame.tsx` — move picker, round logic, match save
- `src/pages/MyProfile.tsx` — reads from localStorage
- `src/pages/Home.tsx` — landing page
- `src/App.css` — dark-theme CSS variables (easy to retheme)
- `src/utils.ts` — `randomMove()`, `determineWinner()`, `appendGame()`, account flow

## Packages in play

```json
"@novasamatech/host-api": "0.7.9-4",
"@novasamatech/product-sdk": "0.7.9-4",
"@parity/product-sdk-address": "^0.1.1",   // ss58ToH160 helper
"polkadot-api": "^2.1.3"
```

Note: `@novasamatech/*` is pinned to `0.7.9-4` to match what shipped Polkadot Desktop expects on the wire (codec is Hex-based in 0.7.9-x; 0.7.8 used a different codec, and 0.7.9-5 isn't published publicly).

## Account flow (utils.ts pattern)

```ts
import { createAccountsProvider, type ProductAccount } from "@novasamatech/product-sdk";
import { ss58ToH160 } from "@parity/product-sdk-address";
import { AccountId } from "polkadot-api";

const accountsProvider = createAccountsProvider();

// `getProductIdentifier()` derives `<name>.dot` from `window.location.host`.
// dotli exposes products as <name>.<gateway> (3 labels); fall back to full host for
// localhost / proxied previews. Identifier MUST end in `.dot` or dotli's accountGet
// rejects with RequestCredentialsErr::DomainNotValid.
const [identifier, derivationIndex] = getAppAccountId();
const result = await accountsProvider.getProductAccount(identifier, derivationIndex);
const { publicKey } = result.value;
const productAccount: ProductAccount = { dotNsIdentifier: identifier, derivationIndex, publicKey };

// "createTransaction" signerType (novasama 0.7.9+) bypasses @polkadot-api/pjs-signer
// entirely and routes through the host's `host_create_transaction` RPC. PJS adapter
// has a static signed-extension whitelist that throws on pallet-revive's Paseo Next v2
// extensions (AsPgas, AsRingAlias, CheckWeight, WeightReclaim). The host accepts the
// raw extension list directly — no static mapper required.
const signer = accountsProvider.getProductAccountSigner(productAccount, "createTransaction");

const ss58 = AccountId().dec(publicKey);
const h160Address = ss58ToH160(ss58);   // for any pallet-revive / EVM keying later
```

## Common gotchas

- **Login only works inside Polkadot Desktop.** Don't suggest extension or browser fallbacks — the SDK is desktop-host-only by design.
- **`signerType: "createTransaction"` is mandatory.** The default `"signPayload"` path goes through PJS-signer which throws on Paseo Next v2's custom signed extensions. If you see `PJS does not support this signed-extension: AsPgas` / `AsRingAlias` / `CheckWeight` / `WeightReclaim`, the signer was constructed wrong.
- **Identifier must end in `.dot`.** `dotli.accountGet` rejects anything else with `DomainNotValid`. Localhost is accepted as long as the identifier still ends `.dot`. The repo's `getProductIdentifier()` handles this — don't replace it with `window.location.host` raw.
- **localStorage keys are per-account** (`rps-game:<address>`). Switching accounts swaps the profile.
- **Don't prompt to add contracts/Bulletin** — that's Level 2 / Level 3 territory.

## Ship checklist

1. `npm run build:frontend` produces `dist/`
2. `dot deploy` (or `bulletin-deploy ./dist <name>.dot`) — uses Paseo Next v2 bulletin (`wss://paseo-bulletin-next-rpc.polkadot.io`)
3. Open `<name>.dot` inside Polkadot Desktop ≥ 0.3.10 to verify

## Do NOT

- Don't bump `@novasamatech/*` past `0.7.9-4` — the wire codec is in flux above that and the shipped desktop won't decode payloads correctly
- Don't use `@parity/product-sdk-signer`'s `SignerManager` — it calls `getLegacyAccounts()` which the new desktop/android hosts reject
