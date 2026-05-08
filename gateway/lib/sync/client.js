/**
 * Sync client — runs on the local App gateway, connects to a remote cloud gateway.
 * Handles push/pull of changes and WebSocket real-time sync.
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { applyChange, SYNC_PROTOCOL_VERSION } from './protocol.js';

export class SyncClient {
  constructor(db, { onChangeApplied } = {}) {
    this.db = db;
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 60000;
    this.pushInterval = null;
    this.pullInterval = null;
    this.running = false;
    this.uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
    this.onChangeApplied = onChangeApplied || null;
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

    if (config.lastPullCursor === 0) {
      try {
        await this._initialSnapshotSync(config);
      } catch (err) {
        console.error('[sync-client] Initial snapshot sync failed:', err.message);
      }
    }

    try {
      await this._pullMissingFiles(config);
    } catch (err) {
      console.error('[sync-client] File pull failed:', err.message);
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
    const SYNC_TABLES = [
      'content_items', 'documents', 'presentations', 'diagrams', 'canvases', 'videos',
      'actors', 'comments', 'content_snapshots', 'events', 'thread_links',
      'doc_icons', 'content_pins',
      'user_tables', 'user_fields', 'user_views',
      'user_view_columns', 'user_view_filters', 'user_view_sorts',
      'user_links', 'user_select_options',
      'agent_messages', 'notifications', 'preferences',
    ];
    // Also discover utbl_*_rows tables from both sides
    const localUtbl = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'utbl_%_rows'").all().map(r => r.name);
    const allTables = [...SYNC_TABLES, ...localUtbl];
    const res = await fetch(`${config.remoteUrl}/sync/snapshot?tables=${allTables.join(',')}`, {
      headers: { 'Authorization': `Bearer ${config.remoteToken}` },
    });

    if (!res.ok) {
      throw new Error(`Snapshot request failed: ${res.status}`);
    }

    const body = await res.json();
    const { snapshot, cursor } = body;

    this.db.prepare("INSERT OR IGNORE INTO _sync_applying VALUES (1)").run();

    try {
      for (const tableName of allTables) {
        const remoteRows = snapshot[tableName] || [];
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

        if (inserted + updated + pushed > 0) {
          console.log(`[sync-client] ${tableName}: +${inserted} ↓${updated} ↑${pushed}`);
        }
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

  _handleAuthFailure() {
    this._authFailCount = (this._authFailCount || 0) + 1;
    if (this._authFailCount >= 3) {
      console.error('[sync-client] Token revoked or invalid — disabling sync');
      this.db.prepare("INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('sync_enabled', '0')").run();
      this.stop();
    }
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
      this.ws.send(JSON.stringify({
        type: 'pull',
        since: freshConfig.lastPullCursor,
      }));
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
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
      if (res.statusCode === 401 || res.statusCode === 403) this._handleAuthFailure();
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
    if (ok) {
      if (change.timestamp) {
        this.db.prepare(
          "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('last_pull_timestamp', ?)"
        ).run(String(change.timestamp));
      }
      if (this.onChangeApplied) {
        this.onChangeApplied(change);
      }
      this._downloadReferencedFiles(change);
    }
  }

  async _downloadReferencedFiles(change) {
    if (!change.data_json) return;
    const json = typeof change.data_json === 'string' ? change.data_json : JSON.stringify(change.data_json);
    const FILE_REF_RE = /\/api\/uploads\/(thumbnails|files|avatars)\/([^\s"',]+)/g;
    let match;
    const config = this.getConfig();
    if (!config.remoteUrl || !config.remoteToken) return;
    while ((match = FILE_REF_RE.exec(json)) !== null) {
      const subDir = match[1];
      const filename = match[2];
      const localPath = path.join(this.uploadsDir, subDir, filename);
      if (fs.existsSync(localPath)) continue;
      const localDir = path.join(this.uploadsDir, subDir);
      if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
      try {
        const res = await fetch(`${config.remoteUrl}/uploads/${subDir}/${encodeURIComponent(filename)}`, {
          headers: { 'Authorization': `Bearer ${config.remoteToken}` },
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(localPath, buf);
          console.log(`[sync-client] Downloaded file on change: ${subDir}/${filename}`);
        }
      } catch (err) {
        console.warn(`[sync-client] File download error for ${subDir}/${filename}:`, err.message);
      }
    }
  }

  _applyPullResponse(msg) {
    const { changes, cursor, server_timestamp, has_more } = msg;
    if (!Array.isArray(changes)) return;

    let applied = 0;
    for (const change of changes) {
      if (applyChange(this.db, change)) {
        applied++;
        if (this.onChangeApplied) this.onChangeApplied(change);
      }
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
    const changes = this.db.prepare(
      "SELECT id, table_name, row_id, operation, data_json, actor_id, timestamp FROM _sync_log WHERE synced = 0 AND source = 'local' ORDER BY timestamp ASC LIMIT 500"
    ).all();
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
          this._authFailCount = 0;
        } else if (res.status === 401 || res.status === 403) {
          this._handleAuthFailure();
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
    const FILE_REF_RE = /\/api\/uploads\/(thumbnails|files|avatars)\/([^\s"',]+)/g;
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
          formData.append('subdir', subDir);

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

  async _pullMissingFiles(config) {
    try {
      const res = await fetch(`${config.remoteUrl}/sync/files/list`, {
        headers: { 'Authorization': `Bearer ${config.remoteToken}` },
      });
      if (!res.ok) {
        console.warn(`[sync-client] File list request failed: ${res.status}`);
        return;
      }
      const remoteFiles = await res.json();
      let downloaded = 0;

      for (const subDir of ['files', 'avatars', 'thumbnails']) {
        const names = remoteFiles[subDir] || [];
        const localDir = path.join(this.uploadsDir, subDir);
        if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

        for (const name of names) {
          const localPath = path.join(localDir, name);
          if (fs.existsSync(localPath)) continue;

          try {
            const fileRes = await fetch(`${config.remoteUrl}/uploads/${subDir}/${encodeURIComponent(name)}`, {
              headers: { 'Authorization': `Bearer ${config.remoteToken}` },
            });
            if (!fileRes.ok) continue;
            const buf = Buffer.from(await fileRes.arrayBuffer());
            fs.writeFileSync(localPath, buf);
            downloaded++;
          } catch (err) {
            console.warn(`[sync-client] Failed to download ${subDir}/${name}:`, err.message);
          }
        }
      }

      if (downloaded > 0) {
        console.log(`[sync-client] Downloaded ${downloaded} missing files from remote`);
      }
    } catch (err) {
      console.warn('[sync-client] File pull error:', err.message);
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
        if (res.status === 401 || res.status === 403) this._handleAuthFailure();
        return;
      }
      this._authFailCount = 0;

      const { changes, cursor, server_timestamp, has_more } = await res.json();
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
