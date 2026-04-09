#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist/agentoffice-runtime"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Build shell standalone
cd "$ROOT_DIR/shell"
npm run build
cd "$ROOT_DIR"

# Copy gateway runtime
mkdir -p "$DIST_DIR/gateway"
cp -R gateway/server.js gateway/baserow.js gateway/routes gateway/middleware gateway/lib gateway/init-db.sql gateway/package.json gateway/package-lock.json "$DIST_DIR/gateway/"
cp -R gateway/node_modules "$DIST_DIR/gateway/"

# Copy shell runtime
mkdir -p "$DIST_DIR/shell/.next"
cp -R shell/.next/standalone "$DIST_DIR/shell/.next/"
cp -R shell/.next/static "$DIST_DIR/shell/.next/"
mkdir -p "$DIST_DIR/shell/public"
cp -R shell/public/favicon.png shell/public/favicon.svg shell/public/logo.png shell/public/icons "$DIST_DIR/shell/public/"

# Root runtime metadata
cp LICENSE README.md cli.js "$DIST_DIR/"

tar -czf "$ROOT_DIR/dist/agentoffice-runtime.tar.gz" -C "$ROOT_DIR/dist" agentoffice-runtime

echo "Built runtime artifact: $ROOT_DIR/dist/agentoffice-runtime.tar.gz"
