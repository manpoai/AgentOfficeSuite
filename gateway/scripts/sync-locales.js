#!/usr/bin/env node
/**
 * Copy shell locale JSON files into gateway/locales/ so i18n-server.js can
 * load them at runtime without reaching outside the gateway directory.
 *
 * Run manually (`node scripts/sync-locales.js`) or via `prestart` hook.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', '..', 'shell', 'src', 'lib', 'i18n', 'locales');
const DST = path.resolve(__dirname, '..', 'locales');

if (!fs.existsSync(SRC)) {
  console.error(`[sync-locales] source dir not found: ${SRC}`);
  process.exit(1);
}
fs.mkdirSync(DST, { recursive: true });

let copied = 0;
for (const file of fs.readdirSync(SRC)) {
  if (!file.endsWith('.json')) continue;
  fs.copyFileSync(path.join(SRC, file), path.join(DST, file));
  copied++;
}
console.log(`[sync-locales] copied ${copied} locale file(s) from ${SRC} to ${DST}`);
