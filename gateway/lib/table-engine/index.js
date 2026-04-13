/**
 * Table engine — single entry point.
 *
 * Wires together schema / select / link / row-io / view / query-builder.
 * Replaces the legacy gateway/baserow.js. See INVARIANTS.md for the
 * non-negotiable rules every consumer must respect.
 *
 * Usage from a route handler:
 *
 *   import { createTableEngine } from '../lib/table-engine/index.js';
 *   const tableEngine = createTableEngine(db);
 *   const t = tableEngine.createTable({ title: 'Customers', columns: [...] });
 *   const rows = tableEngine.queryRows(t.id, { filters, sorts, limit });
 */

import { createSchema } from './schema.js';
import { createSelect } from './select.js';
import { createLink } from './link.js';
import { createRowIo } from './row-io.js';
import { createView } from './view.js';
import { buildSelectQuery } from './query-builder.js';

export function createTableEngine(db) {
  const schema = createSchema(db);
  const select = createSelect(db);
  const link = createLink(db);
  const rowIo = createRowIo(db, { linkApi: link, schemaApi: schema });
  const view = createView(db);

  // ── cloneTable ──────────────────────────────────────────────────
  // Creates a new table that mirrors the source's schema and rows.
  // Skips Link/LinkToAnotherRecord fields (cross-table link cloning is
  // ambiguous — matches the legacy Baserow duplicate behavior). Virtual
  // uidts (CreatedTime etc.) are also skipped because they have no
  // physical column. Wrapped in one transaction.
  function cloneTable(srcTableId, { newTitle = null, created_by = null } = {}) {
    const src = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(srcTableId);
    if (!src) {
      const e = new Error(`table not found: ${srcTableId}`);
      e.code = 'NOT_FOUND';
      throw e;
    }
    const VIRTUAL = new Set(['CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'ID']);
    const SKIP = new Set([...VIRTUAL, 'LinkToAnotherRecord', 'Links']);

    const srcFields = schema.listFields(srcTableId);
    const copyableFields = srcFields.filter(f => !SKIP.has(f.uidt));

    let result;
    const tx = db.transaction(() => {
      const initialColumns = copyableFields.map(f => ({
        title: f.title,
        uidt: f.uidt,
        is_primary: !!f.is_primary,
        options: f.options || null,
      }));
      const newTable = schema.createTable({
        title: newTitle || `${src.title} (copy)`,
        description: src.description,
        icon: src.icon,
        created_by,
        columns: initialColumns,
      });
      const newFields = schema.listFields(newTable.id);

      // src field id → new field id (parallel by index because columns
      // were inserted in order)
      const fieldIdMap = new Map();
      copyableFields.forEach((src, i) => fieldIdMap.set(src.id, newFields[i].id));

      // Clone select options for each SingleSelect/MultiSelect, keeping
      // a value→newOptionId map per field for row payload remapping.
      const optionIdMap = new Map(); // oldOptionId → newOptionId
      for (const src of copyableFields) {
        if (src.uidt !== 'SingleSelect' && src.uidt !== 'MultiSelect') continue;
        const newFieldId = fieldIdMap.get(src.id);
        const oldOpts = select.listOptions(src.id);
        for (const o of oldOpts) {
          const created = select.addOption(newFieldId, { value: o.value, color: o.color });
          optionIdMap.set(o.id, created.id);
        }
      }

      // Copy rows. Read each src row in id-keyed form, remap field ids
      // and select option ids, then batchInsert into the new table.
      const allSrcRows = rowIo.listRows(srcTableId, { limit: 100000, offset: 0 });
      const inserts = [];
      for (const r of allSrcRows) {
        const payload = {};
        for (const src of copyableFields) {
          const v = r[src.id];
          if (v === null || v === undefined) continue;
          const newFid = fieldIdMap.get(src.id);
          if (src.uidt === 'SingleSelect') {
            payload[newFid] = optionIdMap.get(v) || v;
          } else if (src.uidt === 'MultiSelect') {
            payload[newFid] = Array.isArray(v) ? v.map(x => optionIdMap.get(x) || x) : v;
          } else {
            payload[newFid] = v;
          }
        }
        inserts.push(payload);
      }
      if (inserts.length > 0) {
        rowIo.batchInsert(newTable.id, inserts, { actor: created_by });
      }

      result = { new_table_id: newTable.id, copied_rows: inserts.length, new_table: newTable };
    });
    tx();
    return result;
  }

  // ── snapshotTable / restoreTable ────────────────────────────────
  // Snapshot captures schema (field defs + select options) and all rows
  // in id-keyed form. Restore performs: batchDelete current rows →
  // re-add any missing fields from snapshot schema → batchInsert
  // snapshot rows. Schema fields not present in snapshot are preserved
  // (current state wins for new columns).
  function snapshotTable(tableId) {
    const t = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(tableId);
    if (!t) { const e = new Error(`table not found: ${tableId}`); e.code = 'NOT_FOUND'; throw e; }
    const fields = schema.listFields(tableId);
    const schemaSnap = fields.map(f => ({
      id: f.id,
      title: f.title,
      uidt: f.uidt,
      is_primary: !!f.is_primary,
      position: f.position,
      options: f.options || null,
      select_options: (f.uidt === 'SingleSelect' || f.uidt === 'MultiSelect')
        ? select.listOptions(f.id).map(o => ({ id: o.id, value: o.value, color: o.color, position: o.position }))
        : null,
    }));
    const rows = rowIo.listRows(tableId, { limit: 1000000, offset: 0 });
    return { schema: schemaSnap, rows, table: { id: t.id, title: t.title } };
  }

  function restoreTable(tableId, snapshot) {
    const t = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(tableId);
    if (!t) { const e = new Error(`table not found: ${tableId}`); e.code = 'NOT_FOUND'; throw e; }
    if (!snapshot || !Array.isArray(snapshot.schema)) {
      const e = new Error('invalid snapshot'); e.code = 'VALIDATION_ERROR'; throw e;
    }

    let restored = 0;
    const tx = db.transaction(() => {
      // 1. Wipe current rows
      const currentRows = rowIo.listRows(tableId, { limit: 1000000, offset: 0 });
      if (currentRows.length > 0) {
        rowIo.batchDelete(tableId, currentRows.map(r => r.id));
      }

      // 2. Re-add missing fields. Match by title (snapshot field ids
      // won't exist after schema changes). Skip Link fields — we don't
      // recreate cross-table links from snapshots.
      const currentFields = schema.listFields(tableId);
      const titleToCurrentId = new Map(currentFields.map(f => [f.title, f.id]));
      const VIRTUAL = new Set(['CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'ID']);
      const SKIP = new Set([...VIRTUAL, 'LinkToAnotherRecord', 'Links']);

      // snapshot field id → effective current field id (either existing
      // by title, or freshly recreated)
      const snapToCurrentId = new Map();
      // snapshot option id → effective current option id
      const snapOptToCurrent = new Map();

      for (const snapField of snapshot.schema) {
        if (SKIP.has(snapField.uidt)) continue;
        let targetId = titleToCurrentId.get(snapField.title);
        if (!targetId) {
          const created = schema.addField(tableId, {
            title: snapField.title,
            uidt: snapField.uidt,
            options: snapField.options || null,
          });
          targetId = created.id;
          titleToCurrentId.set(snapField.title, targetId);
        }
        snapToCurrentId.set(snapField.id, targetId);

        // Reconcile select options by value
        if (snapField.select_options && (snapField.uidt === 'SingleSelect' || snapField.uidt === 'MultiSelect')) {
          const currentOpts = select.listOptions(targetId);
          const valueToId = new Map(currentOpts.map(o => [o.value, o.id]));
          for (const so of snapField.select_options) {
            let cid = valueToId.get(so.value);
            if (!cid) {
              const created = select.addOption(targetId, { value: so.value, color: so.color });
              cid = created.id;
              valueToId.set(so.value, cid);
            }
            snapOptToCurrent.set(so.id, cid);
          }
        }
      }

      // 3. Insert snapshot rows, remapping field ids and option ids
      const inserts = [];
      for (const r of (snapshot.rows || [])) {
        const payload = {};
        for (const snapField of snapshot.schema) {
          if (SKIP.has(snapField.uidt)) continue;
          const v = r[snapField.id];
          if (v === null || v === undefined) continue;
          const newFid = snapToCurrentId.get(snapField.id);
          if (!newFid) continue;
          if (snapField.uidt === 'SingleSelect') {
            payload[newFid] = snapOptToCurrent.get(v) || v;
          } else if (snapField.uidt === 'MultiSelect') {
            payload[newFid] = Array.isArray(v) ? v.map(x => snapOptToCurrent.get(x) || x) : v;
          } else {
            payload[newFid] = v;
          }
        }
        inserts.push(payload);
      }
      if (inserts.length > 0) {
        rowIo.batchInsert(tableId, inserts);
        restored = inserts.length;
      }
    });
    tx();
    return { restored };
  }

  // ── high-level query helper ──────────────────────────────────────
  // Combines query-builder + row-io's mapRow to return uidt-typed rows.
  function queryRows(tableId, spec = {}) {
    const t = db.prepare('SELECT * FROM user_tables WHERE id = ?').get(tableId);
    if (!t) {
      const err = new Error(`table not found: ${tableId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const fields = schema.listFields(tableId);
    const { sql, params } = buildSelectQuery({ table: t, fields, ...spec });
    const physRows = db.prepare(sql).all(...params);
    // Use rowIo.readRow on each id for mapping (could be optimized later)
    return physRows.map(r => rowIo.readRow(tableId, r.id));
  }

  // Convenience facade: flat surface that route handlers can call.
  return {
    // schema
    createTable: schema.createTable,
    getTable: schema.getTable,
    listTables: schema.listTables,
    dropTable: schema.dropTable,
    addField: schema.addField,
    updateField: schema.updateField,
    dropField: schema.dropField,
    listFields: schema.listFields,
    getField: schema.getField,
    // select
    listOptions: select.listOptions,
    addOption: select.addOption,
    updateOption: select.updateOption,
    deleteOption: select.deleteOption,
    // rows
    insertRow: rowIo.insertRow,
    updateRow: rowIo.updateRow,
    deleteRow: rowIo.deleteRow,
    readRow: rowIo.readRow,
    listRows: rowIo.listRows,
    batchInsert: rowIo.batchInsert,
    batchUpdate: rowIo.batchUpdate,
    batchDelete: rowIo.batchDelete,
    queryRows,
    cloneTable,
    snapshotTable,
    restoreTable,
    // links
    link: {
      list: link.list,
      listReverse: link.listReverse,
      add: link.add,
      remove: link.remove,
      setRowLinks: link.setRowLinks,
    },
    // views
    view: {
      create: view.createView,
      get: view.getView,
      list: view.listViews,
      update: view.updateView,
      delete: view.deleteView,
      listFilters: view.listFilters,
      addFilter: view.addFilter,
      updateFilter: view.updateFilter,
      deleteFilter: view.deleteFilter,
      listSorts: view.listSorts,
      addSort: view.addSort,
      updateSort: view.updateSort,
      deleteSort: view.deleteSort,
      listColumns: view.listColumns,
      setColumn: view.setColumn,
    },
    // raw modules (for advanced or test use)
    _modules: { schema, select, link, rowIo, view },
  };
}
