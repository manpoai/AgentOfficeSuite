#!/usr/bin/env node
/**
 * AOSE Adapter — universal sidecar that bridges AOSE events to a local agent runtime.
 *
 * Usage:
 *   aose-adapter --config <path>
 *   aose-adapter                  # uses $AOSE_ADAPTER_CONFIG
 *
 * Config file (JSON):
 *   {
 *     "agent_name": "claw2",
 *     "platform": "openclaw",
 *     "gateway_url": "https://asuite.example.com",
 *     "agent_token": "...",
 *     // platform-specific fields, e.g. for openclaw:
 *     "openclaw_gateway_url": "ws://127.0.0.1:18789/",
 *     "openclaw_auth_token": "...",
 *     "openclaw_session_key": "agent:main:..."
 *   }
 *
 * The gateway_url must be the AOSE deployment base (e.g. "https://asuite.example.com").
 * The adapter appends "/api/gateway/me/events/stream" and "/api/gateway/me/catchup"
 * itself — the "/api/gateway" prefix is what the public Caddy/reverse-proxy rewrites
 * onto the internal gateway. Passing a gateway_url that already ends in "/api/gateway"
 * is tolerated (we strip it), so both forms work.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import EventSource from 'eventsource';
import { translateEvent } from './event-translator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── `aose-adapter bridge <agent-name>` ─────────────
// Tiny stdio↔unix-socket relay so MCP hosts with global mcp.servers config
// (OpenClaw etc.) can spawn this command and reach the per-agent MCP socket
// the adapter sidecar exposes. Replaces the older `ncat -U` recipe so users
// don't need to install nmap or netcat-openbsd. Delegated to a separate
// file so the sidecar's top-level await chain doesn't run in bridge mode.
if (process.argv[2] === 'bridge') {
  await import('./bridge.js');
  // bridge.js installs a 'close' handler that exits the process. Block
  // forever here so the sidecar code below never runs in bridge mode.
  await new Promise(() => {});
}

// ─── Parse CLI args ──────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' || a === '-c') out.config = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: aose-adapter --config <path-to-config.json>');
  process.exit(0);
}

// ─── Load config ─────────────────────────────────
const configPath = args.config || process.env.AOSE_ADAPTER_CONFIG;
if (!configPath) {
  console.error('[adapter] --config <path> (or $AOSE_ADAPTER_CONFIG) is required');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error(`[adapter] Failed to read config at ${configPath}: ${e.message}`);
  process.exit(1);
}

// Normalize gateway_url: we want a base WITHOUT a trailing slash and WITHOUT
// any "/api/gateway" suffix. The adapter itself appends "/api/gateway/me/...".
// Accept both forms the user might pass:
//   "https://asuite.example.com"
//   "https://asuite.example.com/"
//   "https://asuite.example.com/api/gateway"
//   "https://asuite.example.com/api/gateway/"
function normalizeGatewayBase(raw) {
  if (!raw) return raw;
  let s = String(raw).trim();
  s = s.replace(/\/+$/, '');              // strip trailing slashes
  s = s.replace(/\/api\/gateway$/, '');   // strip optional /api/gateway suffix
  return s;
}
const GATEWAY_BASE = normalizeGatewayBase(config.gateway_url);
// Public mount point — everything in the gateway is reached via /api/gateway/*,
// which the reverse proxy rewrites to /api/* before handing off to the gateway process.
const GATEWAY_URL = GATEWAY_BASE ? `${GATEWAY_BASE}/api/gateway` : GATEWAY_BASE;
const AGENT_TOKEN = config.agent_token;
const AGENT_NAME  = config.agent_name || path.basename(configPath, '.json');
const PLATFORM    = config.platform || 'zylos';

if (!AGENT_TOKEN) {
  console.error('[adapter] config.agent_token is required');
  process.exit(1);
}
if (!GATEWAY_URL) {
  console.error('[adapter] config.gateway_url is required (AOSE gateway base URL)');
  process.exit(1);
}

// ─── State dir (for catchup cursor) ──────────────
const STATE_DIR = process.env.AOSE_ADAPTER_STATE_DIR || path.join(os.homedir(), '.aose', 'adapter-state');
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, `${AGENT_NAME}.last-event-ts`);

function saveLastEventTs(ts) {
  fs.writeFileSync(STATE_FILE, String(ts));
}

// ─── Load platform plugin ────────────────────────
const platformPlugin = await import(`./platforms/${PLATFORM}.js`);
platformPlugin.init(config);

// ─── MCP server surface (Case B platforms only) ──
// Platforms whose host MCP config is global rather than per-agent (currently:
// openclaw) need the adapter sidecar to also expose a per-agent MCP endpoint
// over a unix domain socket. The host's mcp.servers entry points at this
// socket via `ncat -U`, so each agent on the same host gets its own MCP
// process bound to its own AOSE token. See feedback memory rule
// "AOSE adapter responsibility — identity carrier, scope depends on host".
const HOSTS_NEEDING_MCP_SURFACE = new Set(['openclaw']);
let socketMcp = null;
if (HOSTS_NEEDING_MCP_SURFACE.has(PLATFORM)) {
  try {
    const { startSocketMcpServer } = await import('aose-mcp/socket');
    const socketPath = path.join(os.homedir(), '.aose', 'sockets', `${AGENT_NAME}.sock`);
    socketMcp = await startSocketMcpServer({
      socketPath,
      baseUrl: GATEWAY_URL,
      token: AGENT_TOKEN,
    });
    console.log(`[adapter] MCP socket endpoint ready at ${socketPath}`);

    // Cache skills to ~/.aose-mcp/skills/. Non-fatal: if the gateway is
    // slow or unreachable the socket is already up and the agent can
    // still reach AOSE — it just won't have fresh skills cached this run.
    try {
      const { fetchAndCacheSkills } = await import('aose-mcp/skills-fetch');
      const { dir, files } = await fetchAndCacheSkills(GATEWAY_URL);
      console.log(`[adapter] skills cached to ${dir} (${files.length} files)`);
    } catch (e) {
      console.error(`[adapter] skills fetch failed (non-fatal): ${e.message}`);
    }
  } catch (e) {
    console.error(`[adapter] Failed to start MCP socket endpoint: ${e.message}`);
    process.exit(1);
  }
}

// Cleanup on signal so the .sock file doesn't linger across restarts.
const shutdown = async (sig) => {
  console.log(`[adapter] Received ${sig}, shutting down`);
  if (socketMcp) {
    try { await socketMcp.close(); } catch (e) { console.error(`[adapter] socket close failed: ${e.message}`); }
  }
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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
    await platformPlugin.deliver(config, result.endpoint, result.content);
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
    const res = await fetch(`${GATEWAY_URL}/me/catchup?${params}`, {
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
  const url = `${GATEWAY_URL}/me/events/stream?token=${AGENT_TOKEN}`;
  console.log(`[adapter] Connecting to Gateway SSE: ${url.replace(AGENT_TOKEN, '<token>')}`);
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

  es.onerror = (err) => {
    // EventSource error objects are often opaque — pull out every field we can
    // so operators have something to grep on when things break.
    const parts = [];
    if (err) {
      if (err.status != null) parts.push(`status=${err.status}`);
      if (err.message) parts.push(`message=${err.message}`);
      if (err.type) parts.push(`type=${err.type}`);
    }
    const detail = parts.length ? parts.join(' ') : '(no detail from EventSource)';
    console.error(`[adapter] SSE error — ${detail}. Reconnecting in ${reconnectDelay}ms...`);
    es.close();
    setTimeout(connectSSE, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  };
}

// ─── Main ────────────────────────────────────────
console.log(`[adapter] Starting — agent: ${AGENT_NAME}, platform: ${PLATFORM}, gateway: ${GATEWAY_URL}`);
await catchup();
connectSSE();
