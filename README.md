# RPS Game

Decentralized rock-paper-scissors game, with on-chain leaderboard and game history.

## Modes

- **Solo** — play against the computer, best-of-3
- **Multiplayer** — play against another player via Statement Store (commit-reveal anti-cheat)

Scoring: win **+2**, loss **−1**, draw **0**.

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | React 19 + Vite + TypeScript |
| Wallet | `@polkadot-apps/signer` (Host API / extension / dev) |
| Storage | `@polkadot-apps/bulletin` (JSON history → CID) |
| Multiplayer | `@polkadot-apps/statement-store` (real-time pub/sub) |
| Smart contract | `@dotdm/cdm` + PVM (Rust) on Asset Hub |

## How it works

**Solo:** You play locally → after the match, JSON with history is uploaded to Bulletin → contract stores CID + points.

**Multiplayer:** Create a room, get a code, share it with your opponent. Each round:
1. Both players send `commit = SHA256(move + salt)` over Statement Store
2. Once both commits arrive, they send `reveal = { move, salt }`
3. Hash is verified, round winner is determined

**Leaderboard:** Contract on Asset Hub stores a `address → (CID, points)` mapping. All games live on Bulletin (off-chain, content-addressed).

## Running

```bash
npm install

# Smart contract
cdm build
cdm deploy -n paseo
cdm install @rps/leaderboard -n paseo

# Dev server
npm run dev

# Production deploy to Bulletin
npm run build:frontend
bulletin-deploy ./dist <your-domain>.dot
```

> Deploying **your own copy** (own contract, own `.dot` name, published to the
> playground)? Follow the step-by-step [DEPLOYMENT.md](./DEPLOYMENT.md).

> Account needs PAS tokens on Asset Hub ([faucet](https://faucet.polkadot.io/)) and Bulletin chain ([faucet](https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet)).
> Multiplayer requires running inside the Polkadot Desktop container (Host API).

## Structure

```
contracts/leaderboard/lib.rs   # PVM smart contract
src/
├── App.tsx                    # Routing + account selector
├── utils.ts                   # SignerManager, BulletinClient, CDM init
├── types.ts                   # Move, Round, GameData, PlayerData
└── pages/
    ├── Home.tsx               # Mode picker + profile
    ├── MyProfile.tsx          # Stats + history
    ├── SoloGame.tsx           # Solo mode
    ├── MultiplayerLobby.tsx   # Create/join room
    ├── MultiplayerGame.tsx    # Commit-reveal multiplayer
    ├── Leaderboard.tsx        # Top players list
    └── PlayerHistory.tsx      # Detailed player history
```
