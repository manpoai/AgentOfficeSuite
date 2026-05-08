/**
 * Sync WebSocket server — real-time bidirectional sync channel.
 */

import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import { applyChange, SYNC_PROTOCOL_VERSION, checkVersionCompatibility } from './protocol.js';
import { recordChange } from '../sync-hook.js';

export class SyncWebSocketServer {
  constructor(server, db, authMiddleware, adminToken) {
    this.db = db;
    this.clients = new Map();
    this.authMiddleware = authMiddleware;
    this.adminToken = adminToken;

    this.wss = new WebSocketServer({ server, path: '/api/sync/ws', perMessageDeflate: false });

    this.wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req);
    });

    // Poll sync_log for new local changes and broadcast to connected clients
    this._lastBroadcastId = this._getMaxLocalSyncId();
    this._broadcastInterval = setInterval(() => {
      this._broadcastNewLocalChanges();
    }, 2000);
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
    console.log(`[sync-ws] Client connected: ${actor.username} (${clientId}) readyState=${ws.readyState}`);

    ws.send(JSON.stringify({
      type: 'handshake',
      protocol_version: SYNC_PROTOCOL_VERSION,
      server_timestamp: Date.now(),
    }));
    console.log(`[sync-ws] Handshake sent to ${actor.username}`);

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[sync-ws] Message from ${actor.username}: type=${msg.type}`);
        this._handleMessage(clientId, msg);
      } catch (err) {
        console.error('[sync-ws] Invalid message:', err.message);
      }
    });

    ws.on('close', (code, reason) => {
      clearInterval(pingInterval);
      this.clients.delete(clientId);
      console.log(`[sync-ws] Client disconnected: ${actor.username} code=${code} reason=${reason?.toString() || ''}`);
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
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      // Try agent token
      const actor = this.db.prepare(
        'SELECT id, username, type FROM actors WHERE token_hash = ? AND deleted_at IS NULL'
      ).get(tokenHash);
      if (actor) return actor;
      // Try sync token
      const syncRow = this.db.prepare(
        'SELECT a.id, a.username, a.type FROM sync_tokens st JOIN actors a ON st.actor_id = a.id WHERE st.token_hash = ? AND st.revoked_at IS NULL'
      ).get(tokenHash);
      if (syncRow) {
        this.db.prepare('UPDATE sync_tokens SET last_used_at = ? WHERE token_hash = ?').run(Date.now(), tokenHash);
        return syncRow;
      }
      return null;
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
        console.log(`[sync-ws] Pull request from ${clientId}, since=${msg.since}`);
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
    const limit = 100;
    const changes = this.db.prepare(
      "SELECT id, table_name, row_id, operation, data_json, actor_id, timestamp FROM _sync_log WHERE id > ? AND source = 'local' ORDER BY id ASC LIMIT ?"
    ).all(since, limit);

    const hasMore = changes.length === limit;
    const cursor = changes.length > 0
      ? changes[changes.length - 1].id
      : since;

    const client = this.clients.get(clientId);
    if (client?.ws.readyState === client?.ws.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'pull_response',
        changes,
        cursor,
        server_timestamp: Date.now(),
        has_more: hasMore,
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

  _getMaxLocalSyncId() {
    try {
      const row = this.db.prepare("SELECT MAX(id) as max_id FROM _sync_log WHERE source = 'local'").get();
      return row?.max_id || 0;
    } catch { return 0; }
  }

  _broadcastNewLocalChanges() {
    if (this.clients.size === 0) return;
    try {
      const changes = this.db.prepare(
        "SELECT id, table_name, row_id, operation, data_json, actor_id, timestamp FROM _sync_log WHERE id > ? AND source = 'local' ORDER BY id ASC LIMIT 100"
      ).all(this._lastBroadcastId);
      if (changes.length === 0) return;
      this._lastBroadcastId = changes[changes.length - 1].id;
      for (const change of changes) {
        this.broadcastChange(change);
      }
      console.log(`[sync-ws] Broadcast ${changes.length} local changes to ${this.clients.size} client(s)`);
    } catch (err) {
      console.error('[sync-ws] Broadcast poll error:', err.message);
    }
  }
}
