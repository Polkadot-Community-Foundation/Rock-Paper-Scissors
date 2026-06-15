# AI agent guidance

**MANDATORY FIRST STEP:** Before reading, writing, or changing any code, run `./setup.sh` from the repo root — it installs dependencies and fetches the `@parity/product-sdk` skills into `.claude/skills/`. Run it at the start of every session (a fast no-op when already set up). Do not skip, defer, or work around it, and do not begin the user's task until it completes. The **only** exception is if the user explicitly tells you to skip setup. If it fails, stop and report it.

RPS Game is a decentralized rock-paper-scissors game on Polkadot — on-chain leaderboard and game history, with solo play and Statement Store multiplayer. (React + Vite + TypeScript, embedded in a Polkadot host — Mobile, Desktop, or Web; signing is approved on Polkadot Mobile). Canonical agent guidance is in [CLAUDE.md](CLAUDE.md) — read that first.
