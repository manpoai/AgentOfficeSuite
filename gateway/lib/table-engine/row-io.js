/**
 * Row CRUD for the table engine.
 *
 * Per INVARIANTS.md:
 *   - I1: row-io NEVER writes Link physical columns directly. When a Link
 *     value comes in, it is delegated to link.js which writes user_links
 *     and rebuilds the row's JSON cache inside the same transaction.
 *   - I9: every multi-row / multi-table operation is wrapped in a
 *     db.transaction.
 *
 * Value coercion lives here for non-Link uidts. The 22 (non-virtual,
 * non-link) uidts collapse to four physical types (TEXT/INTEGER/REAL +
 * JSON-as-TEXT), and value coercion is mostly "validate + pass through".
 */

import crypto from 'node:crypto';

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function quoteIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
}

function physicalTableName(tableId) { return `utbl_${tableId}_rows`; }

const VIRTUAL_UIDTS = new Set(['CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'ID']);
const LINK_UIDTS = new Set(['LinkToAnotherRecord', 'Links']);

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

// ── coerce uidt → physical value ──────────────────────────────────────
function coerce(uidt, value) {
  if (value === null || value === undefined) return null;
  switch (uidt) {
    case 'SingleLineText':
    case 'LongText':
    case 'PhoneNumber':
      return String(value);
    case 'Email': {
      const s = String(value);
      if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw validationError(`invalid email: ${s}`);
      return s;
    }
    case 'URL':
      return String(value);
    case 'Number':
    case 'Decimal':
    case 'Percent':
    case 'Currency': {
      const n = Number(value);
      if (Number.isNaN(n)) throw validationError(`invalid number: ${value}`);
      return n;
    }
    case 'Checkbox':
      return value ? 1 : 0;
    case 'Rating': {
      const n = Number(value);
      if (Number.isNaN(n) || n < 0 || n > 5) throw validationError(`invalid rating: ${value}`);
      return Math.round(n);
    }
    case 'Date':
    case 'DateTime': {
      if (typeof value === 'number') return value;
      const ms = Date.parse(value);
      if (Number.isNaN(ms)) throw validationError(`invalid date: ${value}`);
      return ms;
    }
    case 'Duration': {
      const n = Number(value);
      if (Number.isNaN(n)) throw validationError(`invalid duration: ${value}`);
      return Math.round(n);
    }
    case 'AutoNumber': {
      const n = Number(value);
      if (Number.isNaN(n)) throw validationError(`invalid auto number: ${value}`);
      return Math.round(n);
    }
    case 'SingleSelect':
      return String(value); // option_id
    case 'MultiSelect':
      if (!Array.isArray(value)) throw validationError('MultiSelect value must be array');
      return JSON.stringify(value.map(String));
    case 'Attachment':
      if (!Array.isArray(value)) throw validationError('Attachment value must be array of metadata objects');
      return JSON.stringify(value);
    case 'JSON':
      if (typeof value === 'string') {
        try { JSON.parse(value); return value; } catch { throw validationError(`invalid JSON: ${value}`); }
      }
      return JSON.stringify(value);
    case 'User':
      return String(value);
    default:
      throw validationError(`coerce: unsupported uidt ${uidt}`);
  }
}

export function createRowIo(db, { linkApi = null, schemaApi = null } = {}) {
  // linkApi (created later by createLink) is injected so row-io can
  // delegate Link writes per I1. To keep the module usable standalone in
  // tests, calls without linkApi will throw if Link data is provided.

  function getNextAutoNumber(tableId, fieldId) {
    const physName = physicalTableName(tableId);
    const physCol = `f_${fieldId}`;
    const max = db.prepare(`SELECT COALESCE(MAX(${quoteIdent(physCol)}), 0) AS m FROM ${quoteIdent(physName)}`).get();
    return (max?.m || 0) + 1;
  }

  function loadFields(tableId) {
    return db.prepare('SELECT * FROM user_fields WHERE table_id = ? ORDER BY position').all(tableId);
  }

  function buildRowInsert(tableId, data, actor) {
    const fields = loadFields(tableId);
    const fieldByTitle = new Map(fields.map(f => [f.title, f]));
    const fieldById = new Map(fields.map(f => [f.id, f]));
    const physical = {};
    const linkWrites = []; // { field, value }

    for (const [k, v] of Object.entries(data || {})) {
      const f = fieldById.get(k) || fieldByTitle.get(k);
      if (!f) continue; // ignore unknown keys silently for resilience
      if (VIRTUAL_UIDTS.has(f.uidt)) continue; // virtual: not written
      if (LINK_UIDTS.has(f.uidt)) {
        linkWrites.push({ field: f, value: v });
        continue;
      }
      physical[f.physical_column] = coerce(f.uidt, v);
    }

    // AutoNumber auto-fill
    for (const f of fields) {
      if (f.uidt === 'AutoNumber' && !(f.physical_column in physical)) {
        physical[f.physical_column] = getNextAutoNumber(tableId, f.id);
      }
    }

    return { physical, linkWrites };
  }

  function insertRow(tableId, data, { actor = null } = {}) {
    const t = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(tableId);
    if (!t) throw validationError(`table not found: ${tableId}`);

    let resultRow;
    const tx = db.transaction(() => {
      const rowId = genId('urow');
      const now = Date.now();
      const { physical, linkWrites } = buildRowInsert(tableId, data, actor);

      const cols = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', ...Object.keys(physical)];
      const placeholders = cols.map(() => '?').join(', ');
      const values = [rowId, now, now, actor, actor, ...Object.values(physical)];
      const physName = physicalTableName(tableId);
      db.prepare(`INSERT INTO ${quoteIdent(physName)} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders})`).run(...values);

      // Process Link writes via linkApi (I1)
      if (linkWrites.length > 0) {
        if (!linkApi) throw new Error('insertRow received Link data but linkApi not wired');
        for (const lw of linkWrites) {
          linkApi.setRowLinks(lw.field, rowId, normalizeLinkValue(lw.value));
        }
      }

      resultRow = readRowInternal(tableId, rowId);
    });
    tx();
    return resultRow;
  }

  function normalizeLinkValue(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.map(String);
    return [String(value)];
  }

  function updateRow(tableId, rowId, data, { actor = null } = {}) {
    const t = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(tableId);
    if (!t) throw validationError(`table not found: ${tableId}`);
    const physName = physicalTableName(tableId);
    const exists = db.prepare(`SELECT 1 FROM ${quoteIdent(physName)} WHERE id = ?`).get(rowId);
    if (!exists) throw validationError(`row not found: ${rowId}`);

    let resultRow;
    const tx = db.transaction(() => {
      const { physical, linkWrites } = buildRowInsert(tableId, data, actor);
      const now = Date.now();

      // Build SET clause
      const setParts = ['updated_at = ?', 'updated_by = ?'];
      const params = [now, actor];
      for (const [col, val] of Object.entries(physical)) {
        setParts.push(`${quoteIdent(col)} = ?`);
        params.push(val);
      }
      params.push(rowId);
      db.prepare(`UPDATE ${quoteIdent(physName)} SET ${setParts.join(', ')} WHERE id = ?`).run(...params);

      if (linkWrites.length > 0) {
        if (!linkApi) throw new Error('updateRow received Link data but linkApi not wired');
        for (const lw of linkWrites) {
          linkApi.setRowLinks(lw.field, rowId, normalizeLinkValue(lw.value));
        }
      }

      resultRow = readRowInternal(tableId, rowId);
    });
    tx();
    return resultRow;
  }

  function deleteRow(tableId, rowId) {
    const t = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(tableId);
    if (!t) throw validationError(`table not found: ${tableId}`);
    const physName = physicalTableName(tableId);

    const tx = db.transaction(() => {
      // Per I1: clear all link references involving this row before
      // deleting the row itself.
      if (linkApi) linkApi.clearRowLinks(tableId, rowId);
      db.prepare(`DELETE FROM ${quoteIdent(physName)} WHERE id = ?`).run(rowId);
    });
    tx();
    return { ok: true, row_id: rowId };
  }

  function readRowInternal(tableId, rowId) {
    const physName = physicalTableName(tableId);
    return db.prepare(`SELECT * FROM ${quoteIdent(physName)} WHERE id = ?`).get(rowId);
  }

  function readRow(tableId, rowId) {
    const row = readRowInternal(tableId, rowId);
    if (!row) return null;
    return mapRow(tableId, row);
  }

  function listRows(tableId, { limit = 100, offset = 0 } = {}) {
    const physName = physicalTableName(tableId);
    const rows = db.prepare(`SELECT * FROM ${quoteIdent(physName)} ORDER BY created_at ASC, rowid ASC LIMIT ? OFFSET ?`).all(limit, offset);
    return rows.map(r => mapRow(tableId, r));
  }

  // mapRow: convert physical column values back to uidt-typed JS values.
  function mapRow(tableId, row) {
    const fields = loadFields(tableId);
    const out = {
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
    };
    for (const f of fields) {
      if (VIRTUAL_UIDTS.has(f.uidt)) {
        // Virtual fields read from row built-ins
        if (f.uidt === 'CreatedTime') out[f.id] = row.created_at;
        else if (f.uidt === 'LastModifiedTime') out[f.id] = row.updated_at;
        else if (f.uidt === 'CreatedBy') out[f.id] = row.created_by;
        else if (f.uidt === 'LastModifiedBy') out[f.id] = row.updated_by;
        else if (f.uidt === 'ID') out[f.id] = row.id;
        continue;
      }
      const raw = row[f.physical_column];
      out[f.id] = decode(f.uidt, raw);
    }
    return out;
  }

  function decode(uidt, raw) {
    if (raw === null || raw === undefined) return null;
    switch (uidt) {
      case 'Checkbox': return raw === 1;
      case 'MultiSelect':
      case 'Attachment':
      case 'LinkToAnotherRecord':
      case 'Links':
        try { return JSON.parse(raw); } catch { return null; }
      default:
        return raw;
    }
  }

  // ── batch ──────────────────────────────────────────
  function batchInsert(tableId, rows, { actor = null } = {}) {
    const out = [];
    const tx = db.transaction(() => {
      for (const r of rows) out.push(insertRowNoTx(tableId, r, actor));
    });
    tx();
    return out;
  }

  function insertRowNoTx(tableId, data, actor) {
    const rowId = genId('urow');
    const now = Date.now();
    const { physical, linkWrites } = buildRowInsert(tableId, data, actor);
    const cols = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', ...Object.keys(physical)];
    const placeholders = cols.map(() => '?').join(', ');
    const values = [rowId, now, now, actor, actor, ...Object.values(physical)];
    const physName = physicalTableName(tableId);
    db.prepare(`INSERT INTO ${quoteIdent(physName)} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders})`).run(...values);
    if (linkWrites.length > 0) {
      if (!linkApi) throw new Error('insertRow received Link data but linkApi not wired');
      for (const lw of linkWrites) linkApi.setRowLinks(lw.field, rowId, normalizeLinkValue(lw.value));
    }
    return readRowInternal(tableId, rowId);
  }

  function batchUpdate(tableId, updates, { actor = null } = {}) {
    const out = [];
    const tx = db.transaction(() => {
      for (const u of updates) {
        out.push(updateRowNoTx(tableId, u.id, u.data, actor));
      }
    });
    tx();
    return out;
  }

  function updateRowNoTx(tableId, rowId, data, actor) {
    const physName = physicalTableName(tableId);
    const existing = db.prepare(`SELECT id FROM ${quoteIdent(physName)} WHERE id = ?`).get(rowId);
    if (!existing) throw validationError(`row not found: ${rowId}`);
    const { physical, linkWrites } = buildRowInsert(tableId, data, actor);
    const now = Date.now();
    const setParts = ['updated_at = ?', 'updated_by = ?'];
    const params = [now, actor];
    for (const [col, val] of Object.entries(physical)) {
      setParts.push(`${quoteIdent(col)} = ?`);
      params.push(val);
    }
    params.push(rowId);
    db.prepare(`UPDATE ${quoteIdent(physName)} SET ${setParts.join(', ')} WHERE id = ?`).run(...params);
    if (linkWrites.length > 0) {
      if (!linkApi) throw new Error('updateRow received Link data but linkApi not wired');
      for (const lw of linkWrites) linkApi.setRowLinks(lw.field, rowId, normalizeLinkValue(lw.value));
    }
    return readRowInternal(tableId, rowId);
  }

  function batchDelete(tableId, rowIds) {
    const tx = db.transaction(() => {
      const physName = physicalTableName(tableId);
      const stmt = db.prepare(`DELETE FROM ${quoteIdent(physName)} WHERE id = ?`);
      for (const id of rowIds) {
        if (linkApi) linkApi.clearRowLinks(tableId, id);
        stmt.run(id);
      }
    });
    tx();
    return { ok: true, count: rowIds.length };
  }

  return {
    insertRow,
    updateRow,
    deleteRow,
    readRow,
    listRows,
    batchInsert,
    batchUpdate,
    batchDelete,
    // expose for link.js callbacks
    _readRowInternal: readRowInternal,
    _loadFields: loadFields,
  };
}
