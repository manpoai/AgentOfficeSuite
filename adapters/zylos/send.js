#!/usr/bin/env node
/**
 * AOSE Zylos Adapter — Send Script
 * Called by Zylos c4-send.js when agent replies via the "aose" channel.
 * Receives: node send.js <endpoint> "<message>"
 * Endpoint format: <channel_id>|msg:<msg_id>|thread:<thread_id>
 * Routes the reply back through AOSE Gateway API.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load per-agent config based on ZYLOS_DIR
const AGENT_ZYLOS_DIR = process.env.ZYLOS_DIR;
const agentDirName = AGENT_ZYLOS_DIR ? path.basename(AGENT_ZYLOS_DIR) : 'default';
const AGENT_CONFIG_PATH = path.join(__dirname, `config-${agentDirName}.json`);
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(AGENT_CONFIG_PATH, 'utf8')); }
catch { try { config = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8')); } catch {} }

const GATEWAY_URL = config.gateway_url || process.env.AOSE_GATEWAY_URL || 'http://localhost:4000';
const AGENT_TOKEN = config.agent_token || process.env.AOSE_AGENT_TOKEN;

if (!AGENT_TOKEN) {
  console.error('Error: No agent token configured. Set in config.json or AOSE_AGENT_TOKEN env var.');
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node send.js <endpoint> "<message>"');
  process.exit(1);
}

const endpoint = args[0];
let message;
if (args.length >= 2) {
  message = args.slice(1).join(' ');
} else {
  message = fs.readFileSync(0, 'utf8');
}

// Parse endpoint
function parseEndpoint(ep) {
  const parts = ep.split('|');
  const result = { channelId: parts[0] };
  for (let i = 1; i < parts.length; i++) {
    const [key, ...val] = parts[i].split(':');
    result[key] = val.join(':');
  }
  return result;
}

const parsed = parseEndpoint(endpoint);

async function sendRequest(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${AGENT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

async function main() {
  if (message.trim() === '[SKIP]') {
    console.log('Skipped');
    return;
  }

  const text = message.trim();

  // Route based on endpoint type
  if (parsed.comment) {
    // Content item comment reply (doc, presentation, spreadsheet, etc.)
    const contentId = parsed.channelId;
    const body = { text, parent_comment_id: parsed.comment };
    const data = await sendRequest(`${GATEWAY_URL}/api/content-items/${encodeURIComponent(contentId)}/comments`, body);
    if (data.id || data.comment_id) {
      console.log('Comment posted successfully');
    } else {
      console.error(`Failed: ${JSON.stringify(data)}`);
      process.exit(1);
    }
  } else if (parsed.channelId.startsWith('task:')) {
    // Task comment reply
    const taskId = parsed.channelId.slice(5);
    const data = await sendRequest(`${GATEWAY_URL}/api/tasks/${taskId}/comments`, { text });
    if (data.comment_id) {
      console.log('Task comment posted successfully');
    } else {
      console.error(`Failed: ${JSON.stringify(data)}`);
      process.exit(1);
    }
  } else {
    // MM message reply
    const body = { channel_id: parsed.channelId, text };
    if (parsed.thread) body.thread_id = parsed.thread;
    else if (parsed.msg) body.thread_id = parsed.msg;

    const data = await sendRequest(`${GATEWAY_URL}/api/messages`, body);
    if (data.message_id) {
      console.log('Message sent successfully');
    } else {
      console.error(`Failed: ${JSON.stringify(data)}`);
      process.exit(1);
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
