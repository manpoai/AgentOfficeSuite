/**
 * Sync protocol — shared logic for change application, conflict resolution,
 * and version negotiation.
 */

export const SYNC_PROTOCOL_VERSION = '1.0';

const SYNCABLE_TABLES = new Set([
  'documents', 'presentations', 'diagrams', 'canvases', 'videos',
  'content_items', 'actors', 'comments', 'content_snapshots',
  'events', 'thread_links', 'doc_icons', 'content_pins',
  'user_tables', 'user_fields', 'user_views',
  'user_view_filters', 'user_view_sorts', 'user_view_columns',
  'user_links', 'user_select_options',
]);

export function isSyncableTable(tableName) {
  if (SYNCABLE_TABLES.has(tableName)) return true;
  if (tableName.startsWith('utbl_') && tableName.endsWith('_rows')) return true;
  return false;
}

export function checkVersionCompatibility(clientVersion, serverVersion) {
  const [clientMajor] = clientVersion.split('.');
  const [serverMajor] = serverVersion.split('.');
  return clientMajor === serverMajor;
}

/**
 * Apply a single change to the database.
 * Returns true if applied, false if skipped (conflict, cloud wins).
 */
export function applyChange(db, change) {
  const { table_name, row_id, operation, data_json } = change;

  if (!isSyncableTable(table_name)) return false;

  try {
    if (operation === 'delete') {
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table_name);
      if (!tableExists) return false;

      const pk = getPrimaryKeyColumn(db, table_name);
      db.prepare(`DELETE FROM ${table_name} WHERE ${pk} = ?`).run(row_id);
      return true;
    }

    const data = typeof data_json === 'string' ? JSON.parse(data_json) : data_json;
    if (!data) return false;

    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table_name);
    if (!tableExists) return false;

    const tableColumns = getTableColumns(db, table_name);
    const filteredData = {};
    for (const [key, value] of Object.entries(data)) {
      if (tableColumns.has(key)) {
        filteredData[key] = value;
      }
    }

    if (Object.keys(filteredData).length === 0) return false;

    const pk = getPrimaryKeyColumn(db, table_name);

    if (operation === 'insert') {
      const cols = Object.keys(filteredData);
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map(c => serializeValue(filteredData[c]));
      db.prepare(
        `INSERT OR REPLACE INTO ${table_name} (${cols.join(', ')}) VALUES (${placeholders})`
      ).run(...values);
      return true;
    }

    if (operation === 'update') {
      const sets = [];
      const values = [];
      for (const [key, value] of Object.entries(filteredData)) {
        if (key === pk) continue;
        sets.push(`${key} = ?`);
        values.push(serializeValue(value));
      }
      if (sets.length === 0) return false;
      values.push(row_id);
      db.prepare(
        `UPDATE ${table_name} SET ${sets.join(', ')} WHERE ${pk} = ?`
      ).run(...values);
      return true;
    }
  } catch (err) {
    console.error(`[sync-protocol] Failed to apply change to ${table_name}:`, err.message);
    return false;
  }

  return false;
}

function getPrimaryKeyColumn(db, tableName) {
  const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const pk = info.find(c => c.pk === 1);
  return pk ? pk.name : 'id';
}

function getTableColumns(db, tableName) {
  const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(info.map(c => c.name));
}

function serializeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}
