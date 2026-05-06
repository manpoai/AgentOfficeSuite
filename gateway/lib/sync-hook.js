/**
 * Sync hook — records write operations to _sync_log for cross-instance sync.
 * Call recordChange() after every INSERT/UPDATE/DELETE in route handlers.
 */

const EXCLUDED_TABLES = new Set(['_sync_log', '_sync_meta']);

const SYSTEM_EVENT_TYPES = new Set([
  'sync.started', 'sync.completed', 'sync.error',
  'health.check', 'health.degraded',
]);

let _syncEnabled = null;

function isSyncEnabled(db) {
  if (_syncEnabled !== null) return _syncEnabled;
  try {
    const row = db.prepare("SELECT value FROM _sync_meta WHERE key = 'sync_enabled'").get();
    _syncEnabled = row?.value === '1';
  } catch {
    _syncEnabled = false;
  }
  return _syncEnabled;
}

function resetSyncCache() {
  _syncEnabled = null;
}

function recordChange(db, tableName, rowId, operation, dataJson, actorId, source) {
  if (source === 'sync') return;
  if (EXCLUDED_TABLES.has(tableName)) return;

  if (tableName === 'events' && dataJson) {
    try {
      const data = typeof dataJson === 'string' ? JSON.parse(dataJson) : dataJson;
      if (SYSTEM_EVENT_TYPES.has(data.event_type)) return;
    } catch {}
  }

  try {
    db.prepare(`
      INSERT INTO _sync_log (table_name, row_id, operation, data_json, actor_id, timestamp, source)
      VALUES (?, ?, ?, ?, ?, ?, 'local')
    `).run(
      tableName,
      String(rowId),
      operation,
      typeof dataJson === 'string' ? dataJson : JSON.stringify(dataJson),
      actorId || null,
      Date.now()
    );
  } catch (err) {
    console.error('[sync-hook] Failed to record change:', err.message);
  }
}

export { recordChange, isSyncEnabled, resetSyncCache };
