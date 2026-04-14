/**
 * Schema operations: createTable, addField, updateField, dropField, dropTable.
 *
 * MUST READ: ./INVARIANTS.md
 *   - I4: Link target_table_id immutable
 *   - I5: physical_column immutable after creation
 *   - I6: dropField runs full cleanup sequence in one transaction
 *   - I7: dropTable runs full cleanup sequence in one transaction
 *   - I9: every multi-step write wrapped in db.transaction
 */

import crypto from 'node:crypto';

// ── uidt → SQLite physical column type ────────────────────────────────
// CreatedTime/LastModifiedTime/CreatedBy/LastModifiedBy are virtual: they
// read from the row's built-in created_at/updated_at/created_by/updated_by
// columns and have no physical f_<id> column on the row table.
const VIRTUAL_UIDTS = new Set([
  'CreatedTime',
  'LastModifiedTime',
  'CreatedBy',
  'LastModifiedBy',
  'ID',
]);

const UIDT_PHYSICAL_TYPE = {
  SingleLineText: 'TEXT',
  LongText: 'TEXT',
  Number: 'REAL',
  Decimal: 'REAL',
  Checkbox: 'INTEGER',
  Date: 'INTEGER',
  DateTime: 'INTEGER',
  Email: 'TEXT',
  URL: 'TEXT',
  SingleSelect: 'TEXT',
  MultiSelect: 'TEXT',
  AutoNumber: 'INTEGER',
  LinkToAnotherRecord: 'TEXT',
  Links: 'TEXT',
  Attachment: 'TEXT',
  Rating: 'INTEGER',
  PhoneNumber: 'TEXT',
  Percent: 'REAL',
  Duration: 'INTEGER',
  Currency: 'REAL',
  JSON: 'TEXT',
  User: 'TEXT',
};

const LINK_UIDTS = new Set(['LinkToAnotherRecord', 'Links']);

const SUPPORTED_UIDTS = new Set([
  ...Object.keys(UIDT_PHYSICAL_TYPE),
  ...VIRTUAL_UIDTS,
]);

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function physicalTableName(tableId) {
  return `utbl_${tableId}_rows`;
}

function physicalColumnName(fieldId) {
  return `f_${fieldId}`;
}

function quoteIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

function nowMs() {
  return Date.now();
}

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

export function createSchema(db) {
  // ── createTable ─────────────────────────────────────
  function createTable({ title, description = null, icon = null, created_by = null, columns = [] } = {}) {
    if (!title || typeof title !== 'string') throw validationError('table title required');
    const tableId = genId('utbl');
    const physName = physicalTableName(tableId);
    const now = nowMs();

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO user_tables
        (id, title, description, icon, physical_name, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(tableId, title, description, icon, physName, created_by, created_by, now, now);

      // Physical row table — built-in columns only at creation.
      // Field columns are added by addField afterwards.
      db.exec(`CREATE TABLE ${quoteIdent(physName)} (
        id          TEXT PRIMARY KEY,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        created_by  TEXT,
        updated_by  TEXT
      )`);
      db.exec(`CREATE INDEX ${quoteIdent('idx_' + physName + '_created')} ON ${quoteIdent(physName)}(created_at DESC)`);

      // Add user-supplied initial columns (if any).
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        addFieldInternal(tableId, { ...col, position: i, created_by });
      }
    });
    tx();

    return getTable(tableId);
  }

  // ── getTable / listTables ──────────────────────────
  function getTable(tableId) {
    const t = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(tableId);
    if (!t) return null;
    const fields = db.prepare('SELECT * FROM user_fields WHERE table_id = ? ORDER BY position').all(tableId);
    return {
      ...t,
      fields: fields.map(parseFieldOptions),
    };
  }

  function listTables() {
    const rows = db.prepare('SELECT * FROM user_tables ORDER BY created_at DESC').all();
    return rows;
  }

  function parseFieldOptions(row) {
    if (!row) return row;
    let options = null;
    if (row.options) {
      try { options = JSON.parse(row.options); } catch { options = null; }
    }
    return { ...row, options };
  }

  // ── addField (internal — called within createTable txn or addField txn)
  function addFieldInternal(tableId, { title, uidt, options = null, position = null, is_primary = 0, created_by = null }) {
    if (!title) throw validationError('field title required');
    if (!SUPPORTED_UIDTS.has(uidt)) throw validationError(`unsupported uidt: ${uidt}`);

    const fieldId = genId('ufld');
    const physCol = physicalColumnName(fieldId);
    const now = nowMs();

    if (position === null) {
      const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM user_fields WHERE table_id = ?').get(tableId);
      position = (max?.m ?? -1) + 1;
    }

    // Link fields require target_table_id at creation (I4 — immutable thereafter).
    if (LINK_UIDTS.has(uidt)) {
      if (!options || !options.target_table_id) {
        throw validationError(`Link field requires options.target_table_id`);
      }
      const targetExists = db.prepare('SELECT 1 FROM user_tables WHERE id = ?').get(options.target_table_id);
      if (!targetExists) throw validationError(`Link target table not found: ${options.target_table_id}`);
    }

    db.prepare(`INSERT INTO user_fields
      (id, table_id, title, uidt, physical_column, position, is_primary, options, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(fieldId, tableId, title, uidt, physCol, position, is_primary ? 1 : 0,
        options ? JSON.stringify(options) : null, now, now);

    // Virtual fields have no physical column.
    if (!VIRTUAL_UIDTS.has(uidt)) {
      const physType = UIDT_PHYSICAL_TYPE[uidt];
      const physName = physicalTableName(tableId);
      db.exec(`ALTER TABLE ${quoteIdent(physName)} ADD COLUMN ${quoteIdent(physCol)} ${physType}`);

      // AutoNumber: backfill existing rows in created_at ASC order so the
      // first-created row gets 1, the second 2, etc. Matches top-to-bottom
      // default ordering in the UI.
      if (uidt === 'AutoNumber') {
        const existing = db.prepare(
          `SELECT id FROM ${quoteIdent(physName)} ORDER BY created_at ASC, rowid ASC`
        ).all();
        const upd = db.prepare(
          `UPDATE ${quoteIdent(physName)} SET ${quoteIdent(physCol)} = ? WHERE id = ?`
        );
        existing.forEach((r, i) => upd.run(i + 1, r.id));
      }
    }

    return fieldId;
  }

  function addField(tableId, spec) {
    const t = db.prepare('SELECT id FROM user_tables WHERE id = ?').get(tableId);
    if (!t) throw validationError(`table not found: ${tableId}`);
    let fieldId;
    const tx = db.transaction(() => {
      fieldId = addFieldInternal(tableId, spec);
    });
    tx();
    return parseFieldOptions(db.prepare('SELECT * FROM user_fields WHERE id = ?').get(fieldId));
  }

  // ── updateField ─────────────────────────────────────
  // Only `title`, `position`, `is_primary`, and non-target_table_id keys
  // inside `options` may be patched. (I4, I5)
  function updateField(fieldId, patch = {}) {
    const f = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(fieldId);
    if (!f) throw validationError(`field not found: ${fieldId}`);

    if ('physical_column' in patch) {
      throw validationError('physical_column is immutable');
    }
    if ('uidt' in patch && patch.uidt !== f.uidt) {
      throw validationError('field uidt cannot be changed; delete and recreate');
    }

    let optionsJson = f.options;
    if ('options' in patch) {
      const oldOpts = f.options ? JSON.parse(f.options) : {};
      const nextOpts = { ...oldOpts, ...(patch.options || {}) };
      // I4: Link target_table_id is immutable.
      if (LINK_UIDTS.has(f.uidt) && oldOpts.target_table_id && nextOpts.target_table_id !== oldOpts.target_table_id) {
        throw validationError('Link target cannot be changed; delete and recreate the field');
      }
      optionsJson = JSON.stringify(nextOpts);
    }

    const nextTitle = 'title' in patch ? patch.title : f.title;
    const nextPos = 'position' in patch ? patch.position : f.position;
    const nextPrimary = 'is_primary' in patch ? (patch.is_primary ? 1 : 0) : f.is_primary;
    const now = nowMs();

    db.prepare(`UPDATE user_fields SET title = ?, position = ?, is_primary = ?, options = ?, updated_at = ?
      WHERE id = ?`).run(nextTitle, nextPos, nextPrimary, optionsJson, now, fieldId);

    return parseFieldOptions(db.prepare('SELECT * FROM user_fields WHERE id = ?').get(fieldId));
  }

  // ── dropField — full cleanup sequence (I6) ─────────
  function dropField(fieldId) {
    const f = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(fieldId);
    if (!f) throw validationError(`field not found: ${fieldId}`);

    const tx = db.transaction(() => {
      // 1. user_links
      db.prepare('DELETE FROM user_links WHERE field_id = ?').run(fieldId);
      // 2. user_select_options
      db.prepare('DELETE FROM user_select_options WHERE field_id = ?').run(fieldId);
      // 3. user_view_filters
      db.prepare('DELETE FROM user_view_filters WHERE field_id = ?').run(fieldId);
      // 4. user_view_sorts
      db.prepare('DELETE FROM user_view_sorts WHERE field_id = ?').run(fieldId);
      // 5. user_view_columns
      db.prepare('DELETE FROM user_view_columns WHERE field_id = ?').run(fieldId);
      // 6. drop physical column (skipped for virtual fields)
      if (!VIRTUAL_UIDTS.has(f.uidt)) {
        const physName = physicalTableName(f.table_id);
        try {
          db.exec(`ALTER TABLE ${quoteIdent(physName)} DROP COLUMN ${quoteIdent(f.physical_column)}`);
        } catch (err) {
          // Fallback: rebuild table without the column.
          rebuildPhysicalTableWithoutColumn(f.table_id, f.physical_column);
        }
      }
      // 7. user_fields
      db.prepare('DELETE FROM user_fields WHERE id = ?').run(fieldId);
    });
    tx();
    return { ok: true, field_id: fieldId };
  }

  function rebuildPhysicalTableWithoutColumn(tableId, physColToDrop) {
    const physName = physicalTableName(tableId);
    const tmpName = `${physName}_tmp_${Date.now()}`;
    const info = db.prepare(`PRAGMA table_info(${quoteIdent(physName)})`).all();
    const keep = info.filter(c => c.name !== physColToDrop);
    if (keep.length === info.length) return; // nothing to drop
    const colDefs = keep.map(c => {
      const parts = [quoteIdent(c.name), c.type || 'TEXT'];
      if (c.notnull) parts.push('NOT NULL');
      if (c.dflt_value !== null) parts.push(`DEFAULT ${c.dflt_value}`);
      if (c.pk) parts.push('PRIMARY KEY');
      return parts.join(' ');
    }).join(', ');
    const colNames = keep.map(c => quoteIdent(c.name)).join(', ');
    db.exec(`CREATE TABLE ${quoteIdent(tmpName)} (${colDefs})`);
    db.exec(`INSERT INTO ${quoteIdent(tmpName)} (${colNames}) SELECT ${colNames} FROM ${quoteIdent(physName)}`);
    db.exec(`DROP TABLE ${quoteIdent(physName)}`);
    db.exec(`ALTER TABLE ${quoteIdent(tmpName)} RENAME TO ${quoteIdent(physName)}`);
    db.exec(`CREATE INDEX IF NOT EXISTS ${quoteIdent('idx_' + physName + '_created')} ON ${quoteIdent(physName)}(created_at DESC)`);
  }

  // ── dropTable — full cleanup sequence (I7) ─────────
  function dropTable(tableId) {
    const t = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(tableId);
    if (!t) throw validationError(`table not found: ${tableId}`);

    const tx = db.transaction(() => {
      const fields = db.prepare('SELECT id FROM user_fields WHERE table_id = ?').all(tableId);
      // Run per-field cleanup for every field (covers user_links, options, view refs)
      // We do the cleanup inline rather than calling dropField in a loop because
      // the physical table itself is about to be dropped — no need to ALTER each column.
      for (const fr of fields) {
        db.prepare('DELETE FROM user_links WHERE field_id = ?').run(fr.id);
        db.prepare('DELETE FROM user_select_options WHERE field_id = ?').run(fr.id);
        db.prepare('DELETE FROM user_view_filters WHERE field_id = ?').run(fr.id);
        db.prepare('DELETE FROM user_view_sorts WHERE field_id = ?').run(fr.id);
        db.prepare('DELETE FROM user_view_columns WHERE field_id = ?').run(fr.id);
      }
      // View-level cascade (FK CASCADE handles it but be explicit for clarity)
      const viewIds = db.prepare('SELECT id FROM user_views WHERE table_id = ?').all(tableId).map(r => r.id);
      for (const vid of viewIds) {
        db.prepare('DELETE FROM user_view_filters WHERE view_id = ?').run(vid);
        db.prepare('DELETE FROM user_view_sorts WHERE view_id = ?').run(vid);
        db.prepare('DELETE FROM user_view_columns WHERE view_id = ?').run(vid);
      }
      db.prepare('DELETE FROM user_views WHERE table_id = ?').run(tableId);
      db.prepare('DELETE FROM user_select_options WHERE table_id = ?').run(tableId);
      // Catch any residual link rows (where this table is target side of a Link
      // owned by another table's field).
      db.prepare('DELETE FROM user_links WHERE source_table_id = ? OR target_table_id = ?').run(tableId, tableId);
      db.prepare('DELETE FROM user_fields WHERE table_id = ?').run(tableId);

      const physName = physicalTableName(tableId);
      db.exec(`DROP TABLE IF EXISTS ${quoteIdent(physName)}`);
      db.prepare('DELETE FROM user_tables WHERE id = ?').run(tableId);
    });
    tx();
    return { ok: true, table_id: tableId };
  }

  // ── listFields ─────────────────────────────────────
  function listFields(tableId) {
    return db.prepare('SELECT * FROM user_fields WHERE table_id = ? ORDER BY position').all(tableId).map(parseFieldOptions);
  }

  function getField(fieldId) {
    return parseFieldOptions(db.prepare('SELECT * FROM user_fields WHERE id = ?').get(fieldId));
  }

  return {
    createTable,
    getTable,
    listTables,
    addField,
    updateField,
    dropField,
    dropTable,
    listFields,
    getField,
    // exposed for tests
    _physicalTableName: physicalTableName,
    _physicalColumnName: physicalColumnName,
    _UIDT_PHYSICAL_TYPE: UIDT_PHYSICAL_TYPE,
    _VIRTUAL_UIDTS: VIRTUAL_UIDTS,
    _LINK_UIDTS: LINK_UIDTS,
  };
}
