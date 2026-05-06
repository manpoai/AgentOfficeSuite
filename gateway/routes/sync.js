/**
 * Sync API routes — HTTP endpoints for push/pull sync.
 * WebSocket real-time channel is handled separately in lib/sync/ws.js.
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { applyChange, SYNC_PROTOCOL_VERSION, checkVersionCompatibility, isSyncableTable } from '../lib/sync/protocol.js';
import { resetSyncCache } from '../lib/sync-hook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = path.dirname(__dirname);
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(GATEWAY_DIR, 'uploads');

function seedSyncLog(db) {
  const existing = db.prepare("SELECT COUNT(*) as count FROM _sync_log").get();
  if (existing.count > 0) return 0;

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_%'"
  ).all().map(r => r.name).filter(n => isSyncableTable(n));

  const utblTables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'utbl_%_rows'"
  ).all().map(r => r.name);

  const allTables = [...tables, ...utblTables];

  const insert = db.prepare(`
    INSERT INTO _sync_log (table_name, row_id, operation, data_json, actor_id, timestamp, source)
    VALUES (?, ?, 'insert', ?, NULL, ?, 'local')
  `);

  let seeded = 0;
  const now = Date.now();

  for (const table of allTables) {
    try {
      const info = db.prepare(`PRAGMA table_info(${table})`).all();
      const pk = info.find(c => c.pk === 1);
      const pkCol = pk ? pk.name : 'id';

      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        insert.run(table, String(row[pkCol]), JSON.stringify(row), now);
        seeded++;
      }
    } catch (err) {
      console.error(`[sync] Failed to seed ${table}:`, err.message);
    }
  }

  console.log(`[sync] Seeded ${seeded} rows from ${allTables.length} tables for initial sync`);
  return seeded;
}

export default function syncRoutes(db, syncClient) {
  const router = Router();

  // POST /api/sync/push — receive changes from a remote client
  router.post('/push', (req, res) => {
    const { changes, protocol_version } = req.body;

    if (protocol_version && !checkVersionCompatibility(protocol_version, SYNC_PROTOCOL_VERSION)) {
      return res.status(409).json({
        error: 'protocol_version_mismatch',
        server_version: SYNC_PROTOCOL_VERSION,
        compatible: false,
      });
    }

    if (!Array.isArray(changes)) {
      return res.status(400).json({ error: 'changes must be an array' });
    }

    let applied = 0;
    for (const change of changes) {
      const ok = applyChange(db, change);
      if (ok) applied++;
    }

    res.json({ applied, total: changes.length, server_timestamp: Date.now() });
  });

  // GET /api/sync/pull?since=<timestamp> — send changes to a remote client
  router.get('/pull', (req, res) => {
    const since = parseInt(req.query.since, 10) || 0;
    const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);

    const changes = db.prepare(
      "SELECT table_name, row_id, operation, data_json, actor_id, timestamp FROM _sync_log WHERE timestamp > ? AND source = 'local' ORDER BY timestamp ASC LIMIT ?"
    ).all(since, limit);

    res.json({
      changes,
      server_timestamp: Date.now(),
      has_more: changes.length === limit,
    });
  });

  // GET /api/sync/status — sync connection status
  router.get('/status', (req, res) => {
    const pendingCount = db.prepare(
      "SELECT COUNT(*) as count FROM _sync_log WHERE synced = 0"
    ).get();

    const lastSync = db.prepare(
      "SELECT value FROM _sync_meta WHERE key = 'last_sync_timestamp'"
    ).get();

    const syncEnabled = db.prepare(
      "SELECT value FROM _sync_meta WHERE key = 'sync_enabled'"
    ).get();

    res.json({
      protocol_version: SYNC_PROTOCOL_VERSION,
      sync_enabled: syncEnabled?.value === '1',
      pending_changes: pendingCount?.count || 0,
      last_sync: lastSync?.value ? parseInt(lastSync.value, 10) : null,
    });
  });

  // POST /api/sync/connect — initiate sync connection (called by local App)
  router.post('/connect', (req, res) => {
    const { remote_url, remote_token, protocol_version } = req.body;

    if (!remote_url || !remote_token) {
      return res.status(400).json({ error: 'remote_url and remote_token are required' });
    }

    if (protocol_version && !checkVersionCompatibility(protocol_version, SYNC_PROTOCOL_VERSION)) {
      return res.status(409).json({
        error: 'protocol_version_mismatch',
        server_version: SYNC_PROTOCOL_VERSION,
      });
    }

    const upsert = db.prepare(
      "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES (?, ?)"
    );

    upsert.run('remote_url', remote_url);
    upsert.run('remote_token', remote_token);
    upsert.run('sync_enabled', '1');

    resetSyncCache();

    const seeded = seedSyncLog(db);

    if (syncClient) {
      syncClient.stop();
      syncClient.start();
    }

    res.json({ ok: true, message: 'Sync connection configured', seeded });
  });

  // POST /api/sync/disconnect — stop sync
  router.post('/disconnect', (req, res) => {
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO _sync_meta (key, value) VALUES (?, ?)"
    );
    upsert.run('sync_enabled', '0');

    resetSyncCache();

    if (syncClient) {
      syncClient.stop();
    }

    res.json({ ok: true, message: 'Sync disconnected' });
  });

  // POST /api/sync/files — receive uploaded file from remote
  // Accepts multipart/form-data with field "file" (single file) and field "filename" (target name).
  // Saves to UPLOADS_ROOT/files/ (or /avatars/ if filename starts with "avatar-").
  // Skips if a file with the same name already exists (names include timestamp+random).
  const syncUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  router.post('/files', syncUpload.single('file'), (req, res) => {
    const filename = req.body?.filename;
    if (!filename || !req.file) {
      return res.status(400).json({ error: 'file and filename fields are required' });
    }

    // Sanitise — only allow simple filenames (no path traversal)
    const safeName = path.basename(filename);
    if (!safeName || safeName !== filename) {
      return res.status(400).json({ error: 'invalid filename' });
    }

    const subDir = safeName.startsWith('avatar-') ? 'avatars' : 'files';
    const destDir = path.join(UPLOADS_ROOT, subDir);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const destPath = path.join(destDir, safeName);

    // Skip if already exists — same filename = same content (timestamp+random names)
    if (fs.existsSync(destPath)) {
      return res.json({ ok: true, filename: safeName, skipped: true });
    }

    try {
      fs.writeFileSync(destPath, req.file.buffer);
      res.json({ ok: true, filename: safeName });
    } catch (err) {
      console.error('[sync] File write error:', err.message);
      res.status(500).json({ error: 'Failed to write file' });
    }
  });

  return router;
}
