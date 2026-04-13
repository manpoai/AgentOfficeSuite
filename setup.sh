#!/bin/bash
# AgentOffice (formerly ASuite) — One-Command Setup
# Usage: ./setup.sh
#
# Starts the gateway (Node + SQLite) and shell (Next.js) on this machine.
# No Docker, no external database — everything lives under ~/.agentoffice.
#
# After v2.0 the suite ships as a pure-Node runtime; this script is a thin
# wrapper around `node cli.js`. Use it when you want one command that also
# checks Node version and prints onboarding hints.

set -e

ASUITE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ASUITE_DIR"

echo "╔══════════════════════════════════════╗"
echo "║          AgentOffice Setup           ║"
echo "║   Human-Agent Collaboration Suite    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── Node version check ─────────────────────────
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js >= 20 is required (found $(node --version 2>/dev/null || echo 'none'))."
  echo "Install from https://nodejs.org/ and re-run."
  exit 1
fi

# ─── Install gateway dependencies if missing ────
if [ ! -d gateway/node_modules ]; then
  echo "[setup] Installing gateway dependencies..."
  (cd gateway && npm install --omit=dev)
fi

# ─── Build shell if needed ──────────────────────
if [ ! -d shell/.next/standalone ]; then
  echo "[setup] Building shell (first run only)..."
  (cd shell && npm install && npm run build)
fi

# ─── Hand off to cli.js ─────────────────────────
echo ""
echo "[setup] Starting AgentOffice runtime..."
exec node "$ASUITE_DIR/cli.js"
