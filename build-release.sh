#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist/aose-runtime"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Build shell standalone
cd "$ROOT_DIR/shell"
npm run build
cd "$ROOT_DIR"

# Copy gateway runtime
mkdir -p "$DIST_DIR/gateway"
cp -R gateway/server.js gateway/routes gateway/middleware gateway/lib gateway/locales gateway/init-db.sql gateway/package.json gateway/package-lock.json gateway/seed-data.json "$DIST_DIR/gateway/"

# Copy agent skills into gateway so /api/agent-skills works in deployed runtime
cp -R mcp-server/skills "$DIST_DIR/gateway/skills"

# Copy shell runtime
mkdir -p "$DIST_DIR/shell/.next"
cp -R shell/.next/standalone "$DIST_DIR/shell/.next/"
mkdir -p "$DIST_DIR/shell/.next/standalone/.next"
cp -R shell/.next/static "$DIST_DIR/shell/.next/standalone/.next/"
mkdir -p "$DIST_DIR/shell/.next/standalone/public"
cp -R shell/public/favicon.png shell/public/favicon.svg shell/public/logo.png shell/public/icons "$DIST_DIR/shell/.next/standalone/public/"

# Root runtime metadata
cp LICENSE README.md cli.js "$DIST_DIR/"
RUNTIME_VERSION="$(node -p "require('./package.json').version")"
cat > "$DIST_DIR/package.json" <<PKGJSON
{"name":"aose-runtime","version":"$RUNTIME_VERSION","type":"module"}
PKGJSON

tar -czf "$ROOT_DIR/dist/aose-runtime.tar.gz" -C "$ROOT_DIR/dist" aose-runtime

echo "Built runtime artifact: $ROOT_DIR/dist/aose-runtime.tar.gz"
