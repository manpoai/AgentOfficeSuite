#!/usr/bin/env node
/**
 * AOSE Universal Adapter
 *
 * Platform-agnostic adapter entry point.
 * Loads platform plugin based on config.platform, then runs the standard
 * SSE → translate → deliver pipeline.
 *
 * Usage: ZYLOS_DIR=/path/to/agent node adapters/index.js
 * Config: loaded from adapters/<platform>/config-<agentDirName>.json
 * The gateway URL must be an externally reachable aose public gateway URL when the adapter runs outside the aose host.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import EventSource from 'eventsource';
import { translateEvent } from './event-translator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load config ────────────────────────────────
const AGENT_ZYLOS_DIR = process.env.ZYLOS_DIR;
const agentDirName = process.env.AGENT_NAME
  || (AGENT_ZYLOS_DIR ? path.basename(AGENT_ZYLOS_DIR) : 'default');

function loadConfig() {
  // Scan all subdirs of adapters/ for config-<agentDirName>.json,
  // then fall back to legacy zylos paths.
  const configFile = `config-${agentDirName}.json`;
  const subdirs = fs.readdirSync(__dirname, { withFileTypes: true })
    .filter(e => e.isDirectory() && !['node_modules', 'platforms'].includes(e.name))
    .map(e => e.name);

  // Prefer exact-match subdir (e.g. openclaw/), then others, then zylos fallback
  const searchPaths = [
    ...subdirs.map(d => path.join(__dirname, d, configFile)),
    path.join(__dirname, 'zylos', 'config.json'),
  ];

  for (const p of searchPaths) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return {};
}

let config = loadConfig();

// Supplement with env vars
const GATEWAY_URL = config.gateway_url || process.env.AOSE_GATEWAY_URL;
const AGENT_TOKEN = config.agent_token || process.env.AOSE_AGENT_TOKEN;
const AGENT_NAME  = config.agent_name  || agentDirName;
const PLATFORM    = config.platform    || 'zylos';

// Add runtime context to config
const zylosHome = config.zylos_home || process.env.ZYLOS_HOME || path.join(process.env.HOME, 'zylos');
config = { ...config, zylos_dir: AGENT_ZYLOS_DIR, zylos_home: zylosHome, gateway_url: GATEWAY_URL, agent_token: AGENT_TOKEN };

if (!AGENT_TOKEN) {
  console.error('[adapter] AOSE_AGENT_TOKEN is required. Set in config or env.');
  process.exit(1);
}

if (!GATEWAY_URL) {
  console.error('[adapter] AOSE_GATEWAY_URL is required. Use the public aose gateway URL.');
  process.exit(1);
}

// ─── Load platform plugin ────────────────────────
const platformPlugin = await import(`./platforms/${PLATFORM}.js`);

// Platform-specific adapter directory (for symlinks, send.js etc.)
const adapterDir = path.join(__dirname, PLATFORM);
platformPlugin.init(config, adapterDir);

// ─── State file for catchup ──────────────────────
const STATE_FILE = path.join(adapterDir, `.last-event-ts-${agentDirName}`);

function saveLastEventTs(ts) {
  fs.writeFileSync(STATE_FILE, String(ts));
}

// ─── Event handler ───────────────────────────────
async function handleEvent(event) {
  if (event.timestamp) saveLastEventTs(event.timestamp);

  const result = translateEvent(event, { gatewayUrl: GATEWAY_URL, agentToken: AGENT_TOKEN });
  if (!result) {
    console.log(`[adapter] Skipped event: ${event.event}`);
    return;
  }

  console.log(`[adapter] Delivering event ${event.event} → ${result.endpoint.substring(0, 60)}`);
  try {
    await platformPlugin.deliver(config, adapterDir, result.endpoint, result.content);
  } catch (e) {
    console.error(`[adapter] Delivery failed: ${e.message}`);
  }
}

// ─── Catchup ────────────────────────────────────
async function catchup() {
  let since = 0;
  try { since = parseInt(fs.readFileSync(STATE_FILE, 'utf8').trim()); } catch {}
  if (since === 0) { console.log('[adapter] No previous state, skipping catchup'); return; }

  console.log(`[adapter] Catching up events since ${new Date(since).toISOString()}`);
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const params = new URLSearchParams({ since: String(since), limit: '50' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${GATEWAY_URL}/api/me/catchup?${params}`, {
      headers: { 'Authorization': `Bearer ${AGENT_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    for (const event of data.events || []) await handleEvent(event);
    hasMore = data.has_more;
    cursor = data.cursor;
  }
  console.log('[adapter] Catchup complete');
}

// ─── SSE ────────────────────────────────────────
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function connectSSE() {
  const url = `${GATEWAY_URL}/api/me/events/stream?token=${AGENT_TOKEN}`;
  console.log('[adapter] Connecting to Gateway SSE');
  const es = new EventSource(url);

  es.onopen = () => {
    console.log('[adapter] SSE connected');
    reconnectDelay = 1000;
  };

  es.onmessage = async (evt) => {
    try {
      const event = JSON.parse(evt.data);
      console.log(`[adapter] Event: ${event.event}`);
      await handleEvent(event);
    } catch (e) {
      console.error(`[adapter] Event handling error: ${e.message}`);
    }
  };

  es.onerror = () => {
    console.error(`[adapter] SSE error, reconnecting in ${reconnectDelay}ms...`);
    es.close();
    setTimeout(connectSSE, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  };
}

// ─── Main ────────────────────────────────────────
console.log(`[adapter] Starting — agent: ${AGENT_NAME}, platform: ${PLATFORM}, gateway: ${GATEWAY_URL}`);
await catchup();
connectSSE();
