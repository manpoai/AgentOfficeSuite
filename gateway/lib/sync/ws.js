/**
 * Sync WebSocket server — real-time bidirectional sync channel.
 */

import { WebSocketServer } from 'ws';
import { applyChange, SYNC_PROTOCOL_VERSION, checkVersionCompatibility } from './protocol.js';
import { recordChange } from '../sync-hook.js';

export class SyncWebSocketServer {
  constructor(server, db, authMiddleware, adminToken) {
    this.db = db;
    this.clients = new Map();
    this.authMiddleware = authMiddleware;
    this.adminToken = adminToken;

    this.wss = new WebSocketServer({ server, path: '/api/sync/ws' });

    this.wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req);
    });
  }

  _handleConnection(ws, req) {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing token');
      return;
    }

    const actor = this._authenticateToken(token);
    if (!actor) {
      ws.close(4003, 'Invalid token');
      return;
    }

    const clientId = actor.id;
    this.clients.set(clientId, { ws, actor });
    console.log(`[sync-ws] Client connected: ${actor.username} (${clientId})`);

    ws.send(JSON.stringify({
      type: 'handshake',
      protocol_version: SYNC_PROTOCOL_VERSION,
      server_timestamp: Date.now(),
    }));

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleMessage(clientId, msg);
      } catch (err) {
        console.error('[sync-ws] Invalid message:', err.message);
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      this.clients.delete(clientId);
      console.log(`[sync-ws] Client disconnected: ${actor.username}`);
    });

    ws.on('error', (err) => {
      console.error(`[sync-ws] Error for ${actor.username}:`, err.message);
    });
  }

  _authenticateToken(token) {
    // Check admin token first (used by sync clients)
    if (this.adminToken && token === this.adminToken) {
      const admin = this.db.prepare("SELECT id, username, type FROM actors WHERE type = 'human' AND role = 'admin'").get();
      if (admin) return admin;
    }
    try {
      const crypto = require('crypto');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const actor = this.db.prepare(
        'SELECT id, username, type FROM actors WHERE token_hash = ? AND deleted_at IS NULL'
      ).get(tokenHash);
      return actor || null;
    } catch {
      return null;
    }
  }

  _handleMessage(clientId, msg) {
    switch (msg.type) {
      case 'push':
        this._handlePush(clientId, msg.changes || []);
        break;
      case 'pull':
        this._handlePull(clientId, msg.since || 0);
        break;
      default:
        break;
    }
  }

  _handlePush(clientId, changes) {
    let applied = 0;
    for (const change of changes) {
      const ok = applyChange(this.db, change);
      if (ok) {
        applied++;
        this.broadcastChange(change, clientId);
      }
    }

    const client = this.clients.get(clientId);
    if (client?.ws.readyState === client?.ws.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'push_ack',
        applied,
        server_timestamp: Date.now(),
      }));
    }
  }

  _handlePull(clientId, since) {
    const changes = this.db.prepare(
      "SELECT table_name, row_id, operation, data_json, actor_id, timestamp FROM _sync_log WHERE timestamp > ? AND source = 'local' ORDER BY timestamp ASC LIMIT 1000"
    ).all(since);

    const client = this.clients.get(clientId);
    if (client?.ws.readyState === client?.ws.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'pull_response',
        changes,
        server_timestamp: Date.now(),
      }));
    }
  }

  broadcastChange(change, excludeClientId) {
    const msg = JSON.stringify({ type: 'change', data: change });
    for (const [clientId, { ws }] of this.clients) {
      if (clientId !== excludeClientId && ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }
}
