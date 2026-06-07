#!/usr/bin/env bash
# Sample-app setup — installs dependencies after cloning the repo.
# Safe to re-run. Should finish in under 2 minutes on a clean macOS/Linux box.

set -euo pipefail

echo "[setup] Rock Paper Scissors"
echo "[setup] Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"

# --- Node dependencies -------------------------------------------------------
if [ -f "package.json" ]; then
    echo "[setup] Installing npm dependencies..."
    if command -v npm >/dev/null 2>&1; then
        npm install --no-audit --no-fund
    else
        echo "[setup] ERROR: npm not found. Install Node.js (>= 20) and try again." >&2
        exit 1
    fi
fi

# --- Rust / PVM contracts (optional) -----------------------------------------
# Only needed if you intend to build/deploy the leaderboard contract.
if [ -f "Cargo.toml" ]; then
    echo "[setup] Rust workspace detected."
    if ! command -v cargo >/dev/null 2>&1; then
        echo "[setup] WARNING: cargo not found. Install via https://rustup.rs to build contracts."
    fi
    if ! command -v cdm >/dev/null 2>&1; then
        echo "[setup] WARNING: cdm CLI not found. Install it before running 'cdm build && cdm deploy -n paseo'."
    else
        echo "[setup] cdm is available — run 'npm run build:contracts && npm run deploy' when ready."
    fi
fi

# --- Post-install hints ------------------------------------------------------
cat <<'EOF'

[setup] Done.

Next steps:
  npm run dev              # start the dev server
  open http://localhost:5173 in Polkadot Desktop

EOF
