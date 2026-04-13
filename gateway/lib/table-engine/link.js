/**
 * Link field operations — single source of truth.
 *
 * READ INVARIANTS.md FIRST.
 *
 * I1: user_links is the SOLE authoritative store for Link relations.
 *     The f_<field_id> physical column is a derived JSON cache, rebuilt
 *     from user_links inside the same transaction that mutates links.
 *
 * I2: Bidirectional fields share ONE row in user_links. The reverse side
 *     reads the same row via target_row_id.
 *
 * I3: 1:1 / 1:N / N:N share this single storage and code path.
 *     Cardinality is enforced at write time, not at storage level.
 *
 * I4: Link target_table_id is immutable (enforced in schema.js updateField).
 *
 * Public API (the only writes to user_links anywhere):
 *   list(field, rowId)            → array of target row ids (outgoing)
 *   listReverse(field, rowId)     → array of source row ids (incoming, for paired fields)
 *   add(field, sourceRowId, targetRowId)
 *   remove(field, sourceRowId, targetRowId)
 *   clearRowLinks(tableId, rowId) → wipe all links involving this row (used on row delete)
 *   clearByField(fieldId)         → wipe all links for a field (used on dropField)
 *   setRowLinks(field, sourceRowId, targetRowIds[]) → atomic replace + cache rebuild
 */

import crypto from 'node:crypto';

function genId(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function quoteIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
}
function physicalTableName(tableId) { return `utbl_${tableId}_rows`; }

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

function cardinalityError(message) {
  const err = new Error(message);
  err.code = 'CARDINALITY_VIOLATION';
  return err;
}

const LINK_UIDTS = new Set(['LinkToAnotherRecord', 'Links']);

export function createLink(db) {
  function assertLinkField(field) {
    if (!field || !LINK_UIDTS.has(field.uidt)) {
      throw validationError(`not a link field: ${field?.id}`);
    }
  }

  function getOptions(field) {
    if (!field.options) return {};
    if (typeof field.options === 'string') {
      try { return JSON.parse(field.options); } catch { return {}; }
    }
    return field.options;
  }

  function list(field, sourceRowId) {
    assertLinkField(field);
    // Tie-break on rowid so insertion order is deterministic when multiple
    // links share the same created_at ms.
    const rows = db.prepare(`SELECT target_row_id FROM user_links WHERE field_id = ? AND source_row_id = ? ORDER BY created_at, rowid`)
      .all(field.id, sourceRowId);
    return rows.map(r => r.target_row_id);
  }

  function listReverse(pairedOutgoingFieldId, targetRowId) {
    const rows = db.prepare(`SELECT source_row_id FROM user_links WHERE field_id = ? AND target_row_id = ? ORDER BY created_at, rowid`)
      .all(pairedOutgoingFieldId, targetRowId);
    return rows.map(r => r.source_row_id);
  }

  function add(field, sourceRowId, targetRowId) {
    assertLinkField(field);
    const opts = getOptions(field);
    if (!opts.target_table_id) throw validationError('link field missing target_table_id');

    // Cardinality enforcement (I3)
    const sourceCardinality = opts.cardinality || 'many';
    if (sourceCardinality === 'one') {
      const existing = db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE field_id = ? AND source_row_id = ?').get(field.id, sourceRowId);
      if (existing.n >= 1) {
        throw cardinalityError(`field ${field.id} cardinality=one but source ${sourceRowId} already linked`);
      }
    }

    db.prepare(`INSERT OR IGNORE INTO user_links
      (id, field_id, source_table_id, source_row_id, target_table_id, target_row_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(genId('ulnk'), field.id, field.table_id, sourceRowId, opts.target_table_id, targetRowId, Date.now());
  }

  function remove(field, sourceRowId, targetRowId) {
    assertLinkField(field);
    db.prepare('DELETE FROM user_links WHERE field_id = ? AND source_row_id = ? AND target_row_id = ?')
      .run(field.id, sourceRowId, targetRowId);
  }

  // setRowLinks: atomic replace + cache rebuild on source row + reverse cache rebuild
  // on each touched target row. Called by row-io.js insertRow/updateRow with a
  // transaction already open.
  function setRowLinks(field, sourceRowId, targetRowIds) {
    assertLinkField(field);
    const opts = getOptions(field);
    if (!opts.target_table_id) throw validationError('link field missing target_table_id');
    const targetTableId = opts.target_table_id;

    // Cardinality
    const sourceCardinality = opts.cardinality || 'many';
    if (sourceCardinality === 'one' && targetRowIds.length > 1) {
      throw cardinalityError(`field ${field.id} cardinality=one but ${targetRowIds.length} targets given`);
    }

    // Old targets (for reverse-cache rebuild)
    const oldTargets = list(field, sourceRowId);

    // Wipe and re-add
    db.prepare('DELETE FROM user_links WHERE field_id = ? AND source_row_id = ?').run(field.id, sourceRowId);
    const insertStmt = db.prepare(`INSERT INTO user_links
      (id, field_id, source_table_id, source_row_id, target_table_id, target_row_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const now = Date.now();
    for (const tid of targetRowIds) {
      insertStmt.run(genId('ulnk'), field.id, field.table_id, sourceRowId, targetTableId, tid, now);
    }

    // Rebuild source row's JSON cache
    rebuildRowCache(field, sourceRowId);

    // Rebuild reverse cache on every target (old + new) if there's a paired field
    if (opts.paired_field_id) {
      const pairedField = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(opts.paired_field_id);
      if (pairedField) {
        const touched = new Set([...oldTargets, ...targetRowIds]);
        for (const tid of touched) rebuildReverseCache(pairedField, tid, field.id);
      }
    }
  }

  function rebuildRowCache(field, sourceRowId) {
    const targets = list(field, sourceRowId);
    const physName = physicalTableName(field.table_id);
    db.prepare(`UPDATE ${quoteIdent(physName)} SET ${quoteIdent(field.physical_column)} = ? WHERE id = ?`)
      .run(targets.length ? JSON.stringify(targets) : null, sourceRowId);
  }

  function rebuildReverseCache(pairedField, targetRowId, outgoingFieldId) {
    // pairedField lives on the target table. Its cache should reflect
    // all source rows that link TO this target via the outgoing field.
    const sources = listReverse(outgoingFieldId, targetRowId);
    const physName = physicalTableName(pairedField.table_id);
    db.prepare(`UPDATE ${quoteIdent(physName)} SET ${quoteIdent(pairedField.physical_column)} = ? WHERE id = ?`)
      .run(sources.length ? JSON.stringify(sources) : null, targetRowId);
  }

  // clearRowLinks: called by row-io.deleteRow to wipe ALL link involvement
  // (both as source and as target) and rebuild downstream caches.
  function clearRowLinks(tableId, rowId) {
    // 1. Find all links where this row is the source
    const outgoing = db.prepare('SELECT DISTINCT field_id FROM user_links WHERE source_table_id = ? AND source_row_id = ?').all(tableId, rowId);
    for (const o of outgoing) {
      const field = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(o.field_id);
      if (field) {
        // Capture targets so we can rebuild paired-field caches AFTER deletion
        const oldTargets = list(field, rowId);
        db.prepare('DELETE FROM user_links WHERE field_id = ? AND source_row_id = ?').run(field.id, rowId);
        const opts = getOptions(field);
        if (opts.paired_field_id) {
          const pairedField = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(opts.paired_field_id);
          if (pairedField) {
            for (const tid of oldTargets) rebuildReverseCache(pairedField, tid, field.id);
          }
        }
      }
    }
    // 2. Find all links where this row is the target
    const incoming = db.prepare('SELECT DISTINCT field_id, source_row_id FROM user_links WHERE target_table_id = ? AND target_row_id = ?').all(tableId, rowId);
    // Group by field
    const incomingByField = new Map();
    for (const i of incoming) {
      if (!incomingByField.has(i.field_id)) incomingByField.set(i.field_id, []);
      incomingByField.get(i.field_id).push(i.source_row_id);
    }
    db.prepare('DELETE FROM user_links WHERE target_table_id = ? AND target_row_id = ?').run(tableId, rowId);
    for (const [fieldId, sourceRowIds] of incomingByField.entries()) {
      const field = db.prepare('SELECT * FROM user_fields WHERE id = ?').get(fieldId);
      if (field) {
        for (const srcId of sourceRowIds) rebuildRowCache(field, srcId);
      }
    }
  }

  function clearByField(fieldId) {
    db.prepare('DELETE FROM user_links WHERE field_id = ?').run(fieldId);
  }

  return {
    list,
    listReverse,
    add,
    remove,
    setRowLinks,
    clearRowLinks,
    clearByField,
  };
}
