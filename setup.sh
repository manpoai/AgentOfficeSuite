#!/bin/bash
# ASuite One-Command Setup
# Usage: ./setup.sh [--domain your-domain.com]
#
# This script:
# 1. Generates .env with random secrets (if not exists)
# 2. Starts all services via docker compose
# 3. Runs init container to configure MM/Baserow
# 4. Prints onboarding instructions for connecting agents

set -e

DOMAIN="${1:-localhost}"
if [ "$1" = "--domain" ]; then
  DOMAIN="${2:-localhost}"
fi

ASUITE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ASUITE_DIR"

echo "╔══════════════════════════════════════╗"
echo "║        ASuite Setup                  ║"
echo "║   Human-Agent Collaboration Suite    ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Domain: $DOMAIN"
echo ""

# ─── Step 1: Generate .env if missing ──────────
if [ -f .env ]; then
  echo "[setup] .env exists — using existing configuration"
else
  echo "[setup] Generating .env with random secrets..."

  gen_secret() { openssl rand -hex 32; }
  gen_short() { openssl rand -hex 16; }

  ADMIN_TOKEN=$(gen_secret)

  if [ "$DOMAIN" = "localhost" ]; then
    SHELL_URL="http://localhost:3101"
    PUB_MM="http://localhost:8065"
    PUB_OL="http://localhost:3000"
    PUB_PL="http://localhost:8000"
    PUB_BR="http://localhost:8280"
  else
    SHELL_URL="https://$DOMAIN"
    PUB_MM="https://mm.$DOMAIN"
    PUB_OL="https://outline.$DOMAIN"
    PUB_PL="https://plane.$DOMAIN"
    PUB_BR="https://baserow.$DOMAIN"
  fi

  cat > .env << ENVEOF
# ASuite .env — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# DO NOT COMMIT

# Admin
ADMIN_EMAIL=admin@asuite.local
ADMIN_PASSWORD=Asuite2026!

# Mattermost
POSTGRES_MM_PASS=$(gen_short)

# Outline
OUTLINE_SECRET_KEY=$(gen_secret)
OUTLINE_UTILS_SECRET=$(gen_secret)
POSTGRES_OL_PASS=$(gen_short)
MINIO_ACCESS_KEY=$(gen_short)
MINIO_SECRET_KEY=$(gen_secret)

# Plane
POSTGRES_PL_PASS=$(gen_short)
PLANE_SECRET_KEY=$(gen_secret)

# Baserow
POSTGRES_BR_PASS=$(gen_short)

# Ports
MM_PORT=8065
OUTLINE_PORT=3000
PLANE_PORT=8000
GATEWAY_PORT=4000
SHELL_PORT=3101

# Gateway (tokens filled after first manual service setup)
MM_ADMIN_TOKEN=PENDING
OL_TOKEN=PENDING
PLANE_TOKEN=PENDING
PLANE_WORKSPACE=asuite
PLANE_PROJECT_ID=PENDING
BASEROW_DATABASE_ID=PENDING
GATEWAY_ADMIN_TOKEN=$ADMIN_TOKEN

# Shell
SHELL_URL=$SHELL_URL
SHELL_SECRET=$(gen_secret)
PUBLIC_MM_URL=$PUB_MM
PUBLIC_OUTLINE_URL=$PUB_OL
PUBLIC_PLANE_URL=$PUB_PL
PUBLIC_BASEROW_URL=$PUB_BR
ENVEOF

  echo "[setup] .env generated"
fi

# ─── Step 2: Build & Start ─────────────────────
echo ""
echo "[setup] Building and starting services..."
docker compose build gateway shell 2>&1 | tail -5
docker compose up -d
echo ""

# ─── Step 3: Wait for Gateway health ──────────
echo "[setup] Waiting for Gateway to be ready..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:${GATEWAY_PORT:-4000}/health > /dev/null 2>&1; then
    echo "[setup] Gateway is ready!"
    break
  fi
  if [ "$i" = "60" ]; then
    echo "[setup] Gateway not ready after 60s. Check: docker compose logs gateway"
    exit 1
  fi
  sleep 2
done

# ─── Step 4: Print onboarding instructions ────
GATEWAY_URL="http://localhost:${GATEWAY_PORT:-4000}"
MCP_PATH="$ASUITE_DIR/mcp-server/src/index.js"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        ASuite is Running!            ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Services:"
echo "  Gateway:  $GATEWAY_URL"
echo "  Shell:    http://localhost:${SHELL_PORT:-3101}"
echo "  MM:       http://localhost:${MM_PORT:-8065}"
echo "  Outline:  http://localhost:${OUTLINE_PORT:-3000}"
echo "  Plane:    http://localhost:${PLANE_PORT:-8000}"
echo "  Baserow:  http://localhost:${BASEROW_PORT:-8280}"
echo ""
echo "─── To connect an Agent ───────────────"
echo ""
echo "Send this to your Agent:"
echo ""
echo "---"
echo "Please connect to my ASuite workspace:"
echo "1. Register yourself:"
echo "   curl -s -X POST $GATEWAY_URL/api/agents/self-register \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"name\":\"YOUR_NAME\",\"display_name\":\"Your Display Name\"}'"
echo "2. Save the agent_token from the response"
echo "3. Create .mcp.json in your working directory:"
echo "   {\"mcpServers\":{\"asuite\":{\"command\":\"node\",\"args\":[\"$MCP_PATH\"],\"env\":{\"ASUITE_TOKEN\":\"<your-token>\",\"ASUITE_URL\":\"$GATEWAY_URL\"}}}}"
echo "4. Restart your session to load MCP tools"
echo "5. Use the whoami tool to verify, then send a message to town-square"
echo "---"
echo ""
echo "Note: Some service tokens (MM_ADMIN_TOKEN, OL_TOKEN, PLANE_TOKEN)"
echo "need manual setup on first run. See docs for details."
