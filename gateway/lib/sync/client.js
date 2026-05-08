/**
 * Sync client — runs on the local App gateway, connects to a remote cloud gateway.
 * Handles push/pull of changes and WebSocket real-time sync.
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { applyChange, SYNC_PROTOCOL_VERSION } from './protocol.js';

export class SyncClient {
  constructor(db) {
    this.db = db;
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 60000;
    this.pushInterval = null;
    this.pullInterval = null;
    this.running = false;
    this.uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
  }

  getConfig() {
    const get = (key) => {
      const row = this.db.prepare("SELECT value FROM _sync_meta WHERE key = ?").get(key);
      return row?.value || null;
    };
    return {
      remoteUrl: get('remote_url'),
      remoteToken: get('remote_token'),
      syncEnabled: get('sync_enabled') === '1',
      lastPullCursor: parseInt(get('last_pull_cursor') || '0', 10),
      lastPullTimestamp: parseInt(get('last_pull_timestamp') || '0', 10),
    };
  }

  async start() {
    const config = this.getConfig();
    if (!config.syncEnabled || !config.remoteUrl || !config.remoteToken) {
      console.log('[sync-client] Sync not configured or disabled');
      return;
    }

    this.running = true;
    console.log(`[sync-client] Starting sync to ${config.remoteUrl}`);
    console.log(`[sync-client] Config: cursor=${config.lastPullCursor}, enabled=${config.syncEnabled}`);

    // Initial snapshot sync if we've never synced before (or cursor was reset)
    if (config.lastPullCursor === 0) {
      console.log('[sync-client] Cursor is 0, starting snapshot sync...');
      try {
        await this._initialSnapshotSync(config);
        console.log('[sync-client] Snapshot sync completed successfully');
      } catch (err) {
        console.error('[sync-client] Initial snapshot sync failed:', err.message, err.stack);
      }
    } else {
      console.log(`[sync-client] Skipping snapshot (cursor=${config.lastPullCursor} > 0)`);
    }

    this._connect(config);

    this.pushInterval = setInterval(() => {
      this._pushLocalChanges(config).catch(err => {
        console.error('[sync-client] Push error:', err.message);
      });
    }, 10000);

    this.pullInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) return;
      this._pullRemoteChanges(config).catch(err => {
        console.error('[sync-client] Pull error:', err.message);
      });
    }, 10000);
  }

  stop() {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pushInterval) {
      clearInterval(this.pushInterval);
      this.pushInterval = null;
    }
    if (this.pullInterval) {
      clearInterval(this.pullInterval);
      this.pullInterval = null;
    }
    console.log('[sync-client] Stopped');
  }

  async _initialSnapshotSync(config) {
    const SYNC_TABLES = ['content_items'];
    console.log(`[sync-client] Starting initial snapshot sync for: ${SYNC_TABLES.join(', ')}`);

    const res = await fetch(`${config.remoteUrl}/sync/snapshot?tables=${SYNC_TABLES.join(',')}`, {
      headers: { 'Authorization': `Bearer ${config.remoteToken}` },
    });

    if (!res.ok) {
      throw new Error(`Snapshot request failed: ${res.status}`);
    }

    const body = await res.json();
    const { snapshot, cursor } = body;
    console.log(`[sync-client] Snapshot response: cursor=${cursor}, tables=${Object.keys(snapshot || {}).join(',')}, sizes=${Object.entries(snapshot || {}).map(([k,v]) => `${k}:${v.length}`).join(',')}`);

    // Set sync flag to prevent triggers from writing source='local'
    this.db.prepare("INSERT OR IGNORE INTO _sync_applying VALUES (1)").run();

    try {
      for (const tableName of SYNC_TABLES) {
        const remoteRows = snapshot[tableName] || [];
        console.log(`[sync-client] Processing ${tableName}: ${remoteRows.length} remote rows`);
        if (remoteRows.length === 0) continue;

        const tableExists = this.db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(tableName);
        if (!tableExists) continue;

        const pkCol = this._getPkColumn(tableName);
        const localRows = this.db.prepare(`SELECT * FROM ${tableName}`).all();
        const localMap = new Map(localRows.map(r => [r[pkCol], r]));
        const remoteMap = new Map(remoteRows.map(r => [r[pkCol], r]));

        const cols = this.db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);

        let inserted = 0, updated = 0, pushed = 0;

        // Remote rows → merge into local
        for (const [id, remoteRow] of remoteMap) {
          const localRow = localMap.get(id);
          if (!localRow) {
            // Remote-only: insert locally
            const filteredCols = cols.filter(c => remoteRow[c] !== undefined);
            const placeholders = filteredCols.map(() => '?').join(', ');
            const values = filteredCols.map(c => remoteRow[c] ?? null);
            this.db.prepare(
              `INSERT OR REPLACE INTO ${tableName} (${filteredCols.join(', ')}) VALUES (${placeholders})`
            ).run(...values);
            inserted++;
          } else {
            // Both exist: compare updated_at, newer wins
            const remoteTime = remoteRow.updated_at || remoteRow.created_at || '';
            const localTime = localRow.updated_at || localRow.created_at || '';
            if (remoteTime > localTime) {
              const setClauses = cols.filter(c => c !== pkCol && remoteRow[c] !== undefined)
                .map(c => `${c} = ?`);
              const values = cols.filter(c => c !== pkCol && remoteRow[c] !== undefined)
                .map(c => remoteRow[c] ?? null);
              if (setClauses.length > 0) {
                values.push(id);
                this.db.prepare(
                  `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${pkCol} = ?`
                ).run(...values);
                updated++;
              }
            }
          }
        }

        // Local-only rows: push to cloud
        const localOnlyRows = [];
        for (const [id, localRow] of localMap) {
          if (!remoteMap.has(id)) {
            localOnlyRows.push(localRow);
            pushed++;
          }
        }

        if (localOnlyRows.length > 0) {
          const changes = localOnlyRows.map(row => ({
            table_name: tableName,
            row_id: row[pkCol],
            operation: 'insert',
            data_json: JSON.stringify(row),
            timestamp: Date.now(),
          }));
          await fetch(`${config.remoteUrl}/sync/push`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.remoteToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ changes, protocol_version: '1.0' }),
          });
        }

        console.log(`[sync-client] Snapshot ${tableName}: ${inserted} inserted, ${updated} updated, ${pushed} pushed to cloud`);
      }
    } finally {
      this.db.prepare("DELETE FROM _sync_applying").run();
    }

    // Save cursor so we don't do snapshot again
    if (cursor) {
      this.db.prepare(
        "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_pull_cursor', ?)"
      ).run(String(cursor));
    }
    console.log(`[sync-client] Initial snapshot sync complete, cursor=${cursor}`);
  }

  _getPkColumn(tableName) {
    const info = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const pk = info.find(c => c.pk === 1);
    return pk ? pk.name : 'id';
  }

  _connect(config) {
    if (!this.running) return;

    const wsUrl = config.remoteUrl
      .replace(/^http/, 'ws')
      .replace(/\/$/, '');

    try {
      this.ws = new WebSocket(`${wsUrl}/sync/ws?token=${config.remoteToken}`, { perMessageDeflate: false });
    } catch (err) {
      console.error('[sync-client] WebSocket creation error:', err.message);
      this._scheduleReconnect(config);
      return;
    }

    this.ws.on('open', () => {
      console.log('[sync-client] WebSocket connected');
      this.reconnectDelay = 1000;

      const freshConfig = this.getConfig();
      console.log(`[sync-client] Sending pull since=${freshConfig.lastPullCursor}`);
      this.ws.send(JSON.stringify({
        type: 'pull',
        since: freshConfig.lastPullCursor,
      }));
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[sync-client] WS message: type=${msg.type}`);
        this._handleMessage(msg);
      } catch (err) {
        console.error('[sync-client] Invalid message:', err.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[sync-client] WebSocket disconnected code=${code} reason=${reason?.toString() || ''}`);
      this.ws = null;
      this._scheduleReconnect(config);
    });

    this.ws.on('error', (err) => {
      console.error('[sync-client] WebSocket error:', err.message);
    });

    this.ws.on('unexpected-response', (req, res) => {
      console.error(`[sync-client] WS unexpected response: ${res.statusCode}`);
    });
  }

  _scheduleReconnect(config) {
    if (!this.running) return;

    this.reconnectTimer = setTimeout(() => {
      const freshConfig = this.getConfig();
      if (freshConfig.syncEnabled) {
        this._connect(freshConfig);
      }
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'handshake':
        if (!msg.protocol_version || msg.protocol_version.split('.')[0] !== SYNC_PROTOCOL_VERSION.split('.')[0]) {
          console.error('[sync-client] Protocol version mismatch:', msg.protocol_version);
          this.ws?.close();
        }
        break;

      case 'change':
        this._applyRemoteChange(msg.data);
        break;

      case 'pull_response':
        this._applyPullResponse(msg);
        break;

      case 'push_ack':
        break;

      default:
        break;
    }
  }

  _applyRemoteChange(change) {
    const ok = applyChange(this.db, change);
    if (ok && change.timestamp) {
      this.db.prepare(
        "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_pull_timestamp', ?)"
      ).run(String(change.timestamp));
    }
  }

  _applyPullResponse(msg) {
    const { changes, cursor, server_timestamp, has_more } = msg;
    if (!Array.isArray(changes)) return;

    let applied = 0;
    for (const change of changes) {
      if (applyChange(this.db, change)) applied++;
    }

    if (cursor) {
      this.db.prepare(
        "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_pull_cursor', ?)"
      ).run(String(cursor));
    }
    if (server_timestamp) {
      this.db.prepare(
        "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_pull_timestamp', ?)"
      ).run(String(server_timestamp));
    }

    console.log(`[sync-client] Pulled ${applied}/${changes.length} changes${has_more ? ' (more available)' : ''}`);

    if (has_more && this.ws?.readyState === WebSocket.OPEN) {
      const freshConfig = this.getConfig();
      this.ws.send(JSON.stringify({
        type: 'pull',
        since: freshConfig.lastPullCursor,
      }));
    }
  }

  async _pushLocalChanges(config) {
    const total = this.db.prepare("SELECT COUNT(*) as n FROM _sync_log").get();
    const changes = this.db.prepare(
      "SELECT id, table_name, row_id, operation, data_json, actor_id, timestamp FROM _sync_log WHERE synced = 0 AND source = 'local' ORDER BY timestamp ASC LIMIT 500"
    ).all();

    console.log(`[sync-client] Push check: ${changes.length} unsynced / ${total.n} total in _sync_log`);
    if (changes.length === 0) return;

    let pushed = false;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'push',
        changes: changes.map(c => ({
          table_name: c.table_name,
          row_id: c.row_id,
          operation: c.operation,
          data_json: c.data_json,
          actor_id: c.actor_id,
          timestamp: c.timestamp,
        })),
      }));

      const ids = changes.map(c => c.id);
      this.db.prepare(
        `UPDATE _sync_log SET synced = 1 WHERE id IN (${ids.map(() => '?').join(',')})`
      ).run(...ids);

      this.db.prepare(
        "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_sync_timestamp', ?)"
      ).run(String(Date.now()));

      pushed = true;
    } else {
      try {
        const res = await fetch(`${config.remoteUrl}/sync/push`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.remoteToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            protocol_version: SYNC_PROTOCOL_VERSION,
            changes: changes.map(c => ({
              table_name: c.table_name,
              row_id: c.row_id,
              operation: c.operation,
              data_json: c.data_json,
              actor_id: c.actor_id,
              timestamp: c.timestamp,
            })),
          }),
        });

        if (res.ok) {
          const ids = changes.map(c => c.id);
          this.db.prepare(
            `UPDATE _sync_log SET synced = 1 WHERE id IN (${ids.map(() => '?').join(',')})`
          ).run(...ids);

          this.db.prepare(
            "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_sync_timestamp', ?)"
          ).run(String(Date.now()));

          pushed = true;
        }
      } catch (err) {
        console.error('[sync-client] HTTP push failed:', err.message);
      }
    }

    // After successfully pushing changes, upload any referenced files
    if (pushed) {
      await this._pushReferencedFiles(config, changes);
    }
  }

  /**
   * Scan pushed changes for file references (uploads/files/ and uploads/avatars/)
   * and upload each referenced file to the remote gateway.
   * Failures are logged but do not fail the sync.
   */
  async _pushReferencedFiles(config, changes) {
    const FILE_REF_RE = /\/api\/uploads\/(files|avatars)\/([^\s"',]+)/g;
    const seen = new Set();

    for (const change of changes) {
      if (!change.data_json) continue;
      let match;
      while ((match = FILE_REF_RE.exec(change.data_json)) !== null) {
        const subDir = match[1]; // "files" or "avatars"
        const filename = match[2];
        const key = `${subDir}/${filename}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const localPath = path.join(this.uploadsDir, subDir, filename);
        if (!fs.existsSync(localPath)) {
          console.warn(`[sync-client] Referenced file not found locally: ${localPath}`);
          continue;
        }

        try {
          const fileBuffer = fs.readFileSync(localPath);
          const formData = new FormData();
          formData.append('file', new Blob([fileBuffer]), filename);
          formData.append('filename', filename);

          const res = await fetch(`${config.remoteUrl}/sync/files`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.remoteToken}`,
            },
            body: formData,
          });

          if (res.ok) {
            const result = await res.json();
            if (result.skipped) {
              console.log(`[sync-client] File already on remote: ${filename}`);
            } else {
              console.log(`[sync-client] Uploaded file: ${filename}`);
            }
          } else {
            console.warn(`[sync-client] File upload failed (${res.status}): ${filename}`);
          }
        } catch (err) {
          console.warn(`[sync-client] File upload error for ${filename}:`, err.message);
        }
      }
    }
  }

  async _pullRemoteChanges(config) {
    const freshConfig = this.getConfig();
    const since = freshConfig.lastPullCursor;

    try {
      const res = await fetch(`${config.remoteUrl}/sync/pull?since=${since}&limit=1000`, {
        headers: {
          'Authorization': `Bearer ${config.remoteToken}`,
        },
      });

      if (!res.ok) {
        console.error(`[sync-client] HTTP pull failed: ${res.status}`);
        return;
      }

      const { changes, cursor, server_timestamp, has_more } = await res.json();
      console.log(`[sync-client] Pull check: ${changes?.length || 0} changes since cursor ${since}`);
      if (!Array.isArray(changes) || changes.length === 0) return;

      let applied = 0;
      for (const change of changes) {
        if (applyChange(this.db, change)) applied++;
      }

      if (cursor) {
        this.db.prepare(
          "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_pull_cursor', ?)"
        ).run(String(cursor));
      }
      if (server_timestamp) {
        this.db.prepare(
          "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_pull_timestamp', ?)"
        ).run(String(server_timestamp));
      }

      console.log(`[sync-client] Pulled ${applied}/${changes.length} changes via HTTP`);

      if (has_more) {
        await this._pullRemoteChanges(config);
      }
    } catch (err) {
      console.error('[sync-client] HTTP pull error:', err.message);
    }
  }
}
