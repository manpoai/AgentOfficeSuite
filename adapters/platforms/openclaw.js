/**
 * OpenClaw platform adapter plugin.
 *
 * Connects to OpenClaw Gateway via WebSocket and delivers AOSE events
 * to a pre-configured OpenClaw session via sessions.send.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

let ws = null;
let connected = false;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const pendingRequests = new Map(); // id → { resolve, reject, timer }

let clawConfig = {};

export function init(config, adapterDir) {
  const { openclaw_gateway_url, openclaw_auth_token, openclaw_session_key } = config;
  if (!openclaw_gateway_url || !openclaw_auth_token || !openclaw_session_key) {
    console.error('[openclaw] Missing required config: openclaw_gateway_url, openclaw_auth_token, openclaw_session_key');
    process.exit(1);
  }
  clawConfig = {
    url: openclaw_gateway_url,
    token: openclaw_auth_token,
    sessionKey: openclaw_session_key,
  };
  connectGateway();
}

export async function deliver(config, adapterDir, endpoint, content) {
  if (!connected) {
    throw new Error('OpenClaw Gateway not connected');
  }

  const result = await sendRequest('sessions.send', {
    key: clawConfig.sessionKey,
    message: content,
  });

  console.log(`[openclaw] Delivered to session ${clawConfig.sessionKey}`);
  return result;
}

// ─── WebSocket connection ────────────────────────

function connectGateway() {
  const { url, token } = clawConfig;
  console.log(`[openclaw] Connecting to OpenClaw Gateway: ${url}`);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error(`[openclaw] WebSocket create error: ${err.message}`);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    console.log('[openclaw] WebSocket open, waiting for challenge...');
  });

  ws.on('message', (raw) => {
    let frame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }

    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      doConnect(token);
      return;
    }

    if (frame.type === 'res' && frame.id) {
      const pending = pendingRequests.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(frame.id);
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          pending.reject(new Error(frame.error?.message || 'Request failed'));
        }
      }
      return;
    }
  });

  ws.on('close', () => {
    connected = false;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`[openclaw] WebSocket error: ${err.message}`);
  });
}

function scheduleReconnect() {
  console.log(`[openclaw] Reconnecting in ${reconnectDelay}ms...`);
  setTimeout(connectGateway, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

async function doConnect(token) {
  try {
    await sendRequest('connect', {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: 'cli', version: '1.0.0', platform: 'macos', mode: 'node' },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      caps: [],
      auth: { token },
    });
    connected = true;
    reconnectDelay = 1000;
    console.log('[openclaw] Gateway connected and authenticated');
  } catch (err) {
    console.error(`[openclaw] Connect handshake failed: ${err.message}`);
    ws?.close();
  }
}

function sendRequest(method, params, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('WebSocket not open'));
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingRequests.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}
