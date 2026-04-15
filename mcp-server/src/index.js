#!/usr/bin/env node
/**
 * aose MCP Server
 *
 * Exposes aose workspace operations (IM, Docs, Tasks, Data) as MCP tools.
 * Connects to aose Gateway via HTTP REST, talks to AI agents over MCP stdio.
 *
 * Configuration:
 *   • base_url  → ~/.aose-mcp/config.json (managed by `set-url`)
 *   • token     → process.env.AOSE_TOKEN (set once in the MCP host's
 *                 mcpServers env block at agent registration; never persisted
 *                 to the local config file, never editable from this CLI)
 *
 * The token is intentionally not stored on disk. The agent receives it once
 * from /api/agents/self-register and the MCP host writes it into the env
 * block. Only the URL is mutable from the CLI, because the URL is the only
 * thing that changes when the user moves aose to a new address.
 *
 * Environment variable AOSE_URL is honored as a one-time migration source —
 * when present without a config file, it is written to the file on first run.
 *
 * Subcommands:
 *   aose-mcp                — start the MCP stdio server (default)
 *   aose-mcp set-url <url>  — write base_url to config and exit
 *   aose-mcp show-config    — print effective config (token masked)
 *   aose-mcp --help         — show usage
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildAoseMcpServer } from './build-server.js';
import { CONFIG_PATH, SKILLS_DIR, loadEffectiveConfig, readConfig, writeConfig } from './config.js';
import { EventBridge } from './event-bridge.js';
import { fetchAndCacheSkills } from './skills-fetch.js';

function maskToken(t) {
  if (!t || typeof t !== 'string') return '(none)';
  if (t.length <= 8) return '****';
  return `${t.slice(0, 8)}…`;
}

function printHelp() {
  console.log(`aose-mcp — aose MCP server

Usage:
  aose-mcp                  Start the MCP stdio server (default)
  aose-mcp set-url <url>    Set base_url in ${CONFIG_PATH}
  aose-mcp show-config      Print effective config (token masked)
  aose-mcp --help, -h       Show this help

To onboard a new agent, follow the prompt returned by
POST ${'${base_url}'}/agents/self-register — the gateway generates a
platform-specific onboarding prompt that walks the agent through
adapter sidecar setup and MCP host wiring in one flow.

The base_url is the aose gateway address. For agents running on the
same machine as aose, this is typically:
  http://localhost:4000/api/gateway

For agents on a different machine, use the URL you exposed aose on
(your tunnel hostname, custom domain, etc.).

The agent's token is set by your MCP host as the AOSE_TOKEN env var when
the agent first registers. It is not stored in this config file and cannot
be changed from this CLI — moving aose to a new URL never changes
the token, only the URL.
`);
}

function handleSetUrl(url) {
  if (!url || typeof url !== 'string') {
    console.error('Error: set-url requires a URL argument.');
    process.exit(1);
  }
  if (!/^https?:\/\//.test(url)) {
    console.error('Error: URL must start with http:// or https://');
    process.exit(1);
  }
  const next = writeConfig({ base_url: url.replace(/\/$/, '') });
  console.log(`✓ base_url written to ${CONFIG_PATH}`);
  console.log(`  base_url: ${next.base_url}`);
}

function handleShowConfig() {
  const file = readConfig();
  console.log(`Config file: ${CONFIG_PATH}`);
  if (file) {
    console.log(`  base_url: ${file.base_url || '(not set)'}`);
  } else {
    console.log('  (file does not exist)');
  }
  console.log('Token (from env, not stored on disk):');
  console.log(`  AOSE_TOKEN: ${maskToken(process.env.AOSE_TOKEN)}`);
  if (process.env.AOSE_URL) {
    console.log('Env URL fallback (only used if config file has no base_url):');
    console.log(`  AOSE_URL: ${process.env.AOSE_URL}`);
  }
}

async function startServer() {
  // `step` marks which phase we're in so the top-level FATAL line can
  // point at the exact failure point. Kept on a ref so catch handlers can
  // tag any thrown error with `err.step = stepRef.current`.
  const stepRef = { current: 'load_config' };
  let cfg;
  try {
    cfg = loadEffectiveConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(`[mcp] url source: ${cfg.source}`);
  console.error(`[mcp] base_url: ${cfg.base_url}`);

  try {
    await runServer(stepRef, cfg);
  } catch (err) {
    if (err && typeof err === 'object' && !err.step) err.step = stepRef.current;
    throw err;
  }
}

async function runServer(stepRef, cfg) {
  stepRef.current = 'build_server';

  // Inject pending-events hints into every tool response. This is the
  // fallback for MCP hosts that do not surface notifications/message to the
  // agent — the agent still sees the hint the next time it calls any tool.
  const bridgeRef = { current: null };
  const decorateHandler = (handler) => async (...args) => {
    const result = await handler(...args);
    const bridge = bridgeRef.current;
    if (bridge && Array.isArray(result?.content)) {
      const pending = bridge.takePendingHint();
      if (pending > 0) {
        result.content.push({
          type: 'text',
          text: `[aose-bridge] ${pending} new event(s) arrived since your last tool call. Call get_unread_events to inspect.`,
        });
      }
    }
    return result;
  };

  const { server, gw } = buildAoseMcpServer({
    baseUrl: cfg.base_url,
    token: cfg.token,
    decorateHandler,
  });

  stepRef.current = 'stdio_connect';
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // ─── Post-connect background setup ────────────────────────────────────
  // Everything below this line runs AFTER the MCP host has received a
  // successful stdio handshake. The host treats the server as "up" the
  // moment server.connect resolves; any slow network work done before that
  // point can and will trip host-side connect timeouts (seen in the wild:
  // a gateway that was slow to respond to /agent-skills silently broke
  // MCP initialization in bundle-mcp with `-32000 Connection closed`).
  // Keep this contract: nothing that touches the network belongs above.

  // Pull skills into ~/.aose-mcp/skills/. Non-fatal: if the gateway is
  // unreachable or slow, the agent still starts — it just won't have fresh
  // skills cached this run. fetchAndCacheSkills has its own 4s timeout.
  stepRef.current = 'skills_fetch';
  try {
    const { files } = await fetchAndCacheSkills(cfg.base_url);
    console.error(`[mcp] skills cached to ${SKILLS_DIR} (${files.length} files)`);
  } catch (e) {
    console.error(`[mcp] skills fetch failed (non-fatal): ${e.message}`);
  }

  // ─── Event bridge: push gateway events to host via MCP notifications ──
  stepRef.current = 'event_bridge';
  const pushMode = (process.env.AOSE_PUSH || 'sse').toLowerCase();
  let bridge = null;
  if (pushMode !== 'off') {
    try {
      const me = await gw.get('/me');
      const agentId = me.agent_id || me.id;
      if (!agentId) {
        console.error('[mcp] bridge skipped: /me did not return an agent id');
      } else {
        const pollIntervalMs = parseInt(process.env.AOSE_POLL_INTERVAL_MS || '15000', 10);
        bridge = new EventBridge({
          baseUrl: cfg.base_url,
          token: cfg.token,
          agentId,
          mcpServer: server,
          mode: pushMode,
          pollIntervalMs,
        });
        await bridge.start();
        bridgeRef.current = bridge;
        console.error(`[mcp] event bridge started (mode=${pushMode})`);
      }
    } catch (e) {
      console.error(`[mcp] event bridge start failed: ${e.message}`);
    }
  } else {
    console.error('[mcp] event bridge disabled (AOSE_PUSH=off)');
  }

  const shutdown = async () => {
    if (bridge) await bridge.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const sub = process.argv[2];
switch (sub) {
  case undefined:
    try {
      await startServer();
    } catch (err) {
      // Surface a single structured FATAL line so bundle-mcp / other MCP
      // hosts forwarding stderr can tell at a glance which phase died.
      // startServer tags its own `step` on thrown errors when it can; fall
      // back to 'unknown' otherwise.
      const phase = err?.step || 'unknown';
      const msg = err?.message || String(err);
      console.error(`[aose-mcp] FATAL step=${phase} error=${msg}`);
      process.exit(1);
    }
    break;
  case 'set-url':
    handleSetUrl(process.argv[3]);
    break;
  case 'show-config':
    handleShowConfig();
    break;
  case '--help':
  case '-h':
  case 'help':
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${sub}`);
    printHelp();
    process.exit(1);
}
