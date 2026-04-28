#!/usr/bin/env node
/**
 * Copy @ffmpeg/core static assets to public/ffmpeg so they can be loaded by
 * the browser at runtime. Run automatically by `pnpm postinstall`.
 *
 * The core .wasm file is ~31MB and we don't track it in git (see .gitignore);
 * it gets re-materialized whenever `pnpm install` runs.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'node_modules', '@ffmpeg', 'core', 'dist', 'umd');
const DST = path.resolve(__dirname, '..', 'public', 'ffmpeg');

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!fs.existsSync(SRC)) {
  console.warn(`[setup-ffmpeg] @ffmpeg/core not installed at ${SRC} — skipping (this is fine if pnpm install has not run yet).`);
  process.exit(0);
}

fs.mkdirSync(DST, { recursive: true });
for (const f of files) {
  const from = path.join(SRC, f);
  const to = path.join(DST, f);
  if (!fs.existsSync(from)) {
    console.warn(`[setup-ffmpeg] missing ${from} — skipping.`);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`[setup-ffmpeg] copied ${f} → public/ffmpeg/`);
}
