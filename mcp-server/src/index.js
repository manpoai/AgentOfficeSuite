#!/usr/bin/env node
/**
 * AgentOffice MCP Server
 *
 * Exposes AgentOffice workspace operations (IM, Docs, Tasks, Data) as MCP tools.
 * Connects to AgentOffice Gateway via HTTP REST, talks to AI agents over MCP stdio.
 *
 * Configuration:
 *   • base_url  → ~/.agentoffice-mcp/config.json (managed by `set-url`)
 *   • token     → process.env.ASUITE_TOKEN (set once in the MCP host's
 *                 mcpServers env block at agent registration; never persisted
 *                 to the local config file, never editable from this CLI)
 *
 * The token is intentionally not stored on disk. The agent receives it once
 * from /api/agents/self-register and the MCP host writes it into the env
 * block. Only the URL is mutable from the CLI, because the URL is the only
 * thing that changes when the user moves AgentOffice to a new address.
 *
 * Environment variable ASUITE_URL is honored as a one-time migration source —
 * when present without a config file, it is written to the file on first run.
 *
 * Subcommands:
 *   agentoffice-mcp                — start the MCP stdio server (default)
 *   agentoffice-mcp set-url <url>  — write base_url to config and exit
 *   agentoffice-mcp show-config    — print effective config (token masked)
 *   agentoffice-mcp --help         — show usage
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GatewayClient } from './gateway-client.js';
import { registerDocTools } from './tools/docs.js';
import { registerDataTools } from './tools/data.js';
import { registerSystemTools } from './tools/system.js';
import { registerAgentTools } from './tools/agents.js';
import { registerEventTools } from './tools/events.js';
import { registerCommentTools } from './tools/comments.js';
import { registerContentTools } from './tools/content.js';
import { CONFIG_PATH, loadEffectiveConfig, readConfig, writeConfig } from './config.js';

function maskToken(t) {
  if (!t || typeof t !== 'string') return '(none)';
  if (t.length <= 8) return '****';
  return `${t.slice(0, 8)}…`;
}

function printHelp() {
  console.log(`agentoffice-mcp — AgentOffice MCP server

Usage:
  agentoffice-mcp                  Start the MCP stdio server (default)
  agentoffice-mcp set-url <url>    Set base_url in ${CONFIG_PATH}
  agentoffice-mcp show-config      Print effective config (token masked)
  agentoffice-mcp --help, -h       Show this help

The base_url is the AgentOffice gateway address. For agents running on the
same machine as AgentOffice, this is typically:
  http://localhost:4000/api/gateway

For agents on a different machine, use the URL you exposed AgentOffice on
(your tunnel hostname, custom domain, etc.).

The agent's token is set by your MCP host as the ASUITE_TOKEN env var when
the agent first registers. It is not stored in this config file and cannot
be changed from this CLI — moving AgentOffice to a new URL never changes
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
  console.log(`  ASUITE_TOKEN: ${maskToken(process.env.ASUITE_TOKEN)}`);
  if (process.env.ASUITE_URL) {
    console.log('Env URL fallback (only used if config file has no base_url):');
    console.log(`  ASUITE_URL: ${process.env.ASUITE_URL}`);
  }
}

async function startServer() {
  let cfg;
  try {
    cfg = loadEffectiveConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(`[mcp] url source: ${cfg.source}`);
  console.error(`[mcp] base_url: ${cfg.base_url}`);

  const server = new McpServer({ name: 'asuite', version: '0.1.0' });
  const gw = new GatewayClient(cfg.base_url, cfg.token);

  registerDocTools(server, gw);
  registerDataTools(server, gw);
  registerSystemTools(server, gw);
  registerAgentTools(server, gw);
  registerEventTools(server, gw);
  registerCommentTools(server, gw);
  registerContentTools(server, gw);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const sub = process.argv[2];
switch (sub) {
  case undefined:
    await startServer();
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
