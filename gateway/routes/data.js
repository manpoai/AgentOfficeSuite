/**
 * Data routes: tables, columns, views, filters, sorts, rows, links,
 * file upload, table comments, snapshots
 */
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createUnifiedComment } from '../lib/comment-service.js';
import { isAgentRequest } from '../lib/snapshot-helper.js';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = path.dirname(__dirname);

// Get display name for the authenticated actor (human or agent)
function actorName(req) {
  return req.actor?.display_name || req.actor?.username || req.agent?.name || null;
}

export default function dataRoutes(app, { db, authenticateAgent, genId, contentItemsUpsert, pushEvent, pushHumanEvent, humanClients, deliverWebhook, tableEngine }) {

  // ─── Auto-snapshot helper ─────────────────────────
  // Uses tableEngine.snapshotTable to capture id-keyed schema + rows.
  // Snapshot format (post-P4.2): { schema: [...field defs], rows: [...id-keyed rows] }
  async function createTableSnapshot(tableId, triggerType, agent, description) {
    const snap = tableEngine.snapshotTable(tableId);
    const dataJson = JSON.stringify(snap.rows);
    const schemaJson = JSON.stringify(snap.schema);

    const lastVersion = db.prepare("SELECT MAX(version) as maxV FROM content_snapshots WHERE content_type = 'table' AND content_id = ?").get(tableId);
    const version = (lastVersion?.maxV || 0) + 1;

    const snapId = genId('snap');
    const now = new Date().toISOString();
    // When no free-text description is provided, store the canonical i18n key
    // for this trigger_type so readers can render it in their language.
    const DEFAULT_KEYS = {
      pre_agent_edit:  'serverSnapshots.pre_agent_edit',
      post_agent_edit: 'serverSnapshots.post_agent_edit',
      pre_restore:     'serverSnapshots.pre_restore',
      auto:            'serverSnapshots.auto_initial',
    };
    const descriptionKey = description ? null : (DEFAULT_KEYS[triggerType] || null);
    db.prepare(
      "INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, description, row_count, actor_id, created_at, description_key) VALUES (?, 'table', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(snapId, tableId, version, dataJson, schemaJson, triggerType, description || null, snap.rows.length, agent || null, now, descriptionKey);

    return {
      id: snapId,
      version,
      table_id: tableId,
      trigger_type: triggerType,
      agent: agent || null,
      row_count: snap.rows.length,
      created_at: now,
    };
  }


  // ─── Tables ──────────────────────────────────────
  // P4.2 族 A: backed by table-engine (SQLite). See INVARIANTS.md.
  //
  // mapFieldToColumn projects a tableEngine user_fields row into the
  // legacy gateway response shape the frontend expects. We keep the wire
  // contract identical so frontend cleanup happens in P4.3.
  function mapFieldToColumn(f, selectOptionsByField) {
    const col = {
      column_id: f.id,
      title: f.title,
      type: f.uidt,
      primary_key: !!f.is_primary,
      required: false,
    };
    if (f.options && typeof f.options === 'object') {
      if (f.options.target_table_id) {
        col.relatedTableId = f.options.target_table_id;
        col.relationType = f.options.cardinality === 'one' ? 'oo' : 'mm';
      }
      // Expose the full options bag as `meta` for the frontend so round-trips
      // preserve currency_code, date_format, max, precision, etc. Strip keys
      // that already live on top-level fields (target_table_id, cardinality,
      // paired_field_id).
      const metaCopy = { ...f.options };
      delete metaCopy.target_table_id;
      delete metaCopy.cardinality;
      delete metaCopy.paired_field_id;
      if (Object.keys(metaCopy).length) col.meta = metaCopy;
    }
    if (selectOptionsByField && (f.uidt === 'SingleSelect' || f.uidt === 'MultiSelect')) {
      const opts = selectOptionsByField.get(f.id) || [];
      col.options = opts.map((o, i) => ({ title: o.value, color: o.color, order: i + 1, id: o.id }));
    }
    return col;
  }

  function mapViewRow(v, idx) {
    const VIEW_TYPE_NUM = { form: 1, gallery: 2, grid: 3, kanban: 4 };
    const opts = v.options && typeof v.options === 'string'
      ? (() => { try { return JSON.parse(v.options); } catch { return {}; } })()
      : (v.options || {});
    return {
      view_id: v.id,
      title: v.title,
      type: VIEW_TYPE_NUM[v.view_type] || 3,
      is_default: !!v.is_default || idx === 0,
      order: v.position,
      ...(opts.fk_grp_col_id ? { fk_grp_col_id: opts.fk_grp_col_id } : {}),
      ...(opts.fk_cover_image_col_id ? { fk_cover_image_col_id: opts.fk_cover_image_col_id } : {}),
    };
  }

  // List tables in the AOSE base
  app.get('/api/data/tables', authenticateAgent, async (req, res) => {
    try {
      const tables = tableEngine.listTables();
      const list = tables.map(t => ({
        id: t.id,
        title: t.title,
        order: 0,
        created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
      }));
      res.json({ list });
    } catch (e) {
      console.error('[gateway] list tables failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // Create a table
  app.post('/api/data/tables', authenticateAgent, async (req, res) => {
    const { title, columns = [] } = req.body;
    if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });

    try {
      const createdBy = actorName(req);
      const initialColumns = [];
      for (const col of columns) {
        const colTitle = col.title || col.column_name;
        if (!colTitle) continue;
        // Build field-level options (Link target, precision) — NOT select options.
        const fieldOptions = {};
        if (col.relatedTableId || col.target_table_id) {
          fieldOptions.target_table_id = col.relatedTableId || col.target_table_id;
          if (col.relationType === 'oo') fieldOptions.cardinality = 'one';
        }
        if (col.meta?.precision != null) fieldOptions.precision = col.meta.precision;
        initialColumns.push({
          title: colTitle,
          uidt: col.uidt || 'SingleLineText',
          options: Object.keys(fieldOptions).length ? fieldOptions : null,
          is_primary: col.primary_key ? 1 : 0,
        });
      }

      const t = tableEngine.createTable({ title, created_by: createdBy, columns: initialColumns });

      // Initial select options for SingleSelect/MultiSelect columns.
      // (createTable.columns only seeds user_fields; select options live
      // in user_select_options and need a separate addOption call.)
      const createdFields = tableEngine.listFields(t.id);
      const fieldByTitle = new Map(createdFields.map(f => [f.title, f]));
      for (const col of columns) {
        const colTitle = col.title || col.column_name;
        if (!colTitle) continue;
        const f = fieldByTitle.get(colTitle);
        if (!f) continue;
        if ((f.uidt === 'SingleSelect' || f.uidt === 'MultiSelect') && Array.isArray(col.options)) {
          for (const o of col.options) {
            const optTitle = typeof o === 'string' ? o : (o.title || o.value || '');
            if (!optTitle) continue;
            tableEngine.addOption(f.id, { value: optTitle, color: o.color || 'light-blue' });
          }
        }
      }

      // Default grid view so the frontend has something to render.
      try {
        tableEngine.view.create({ table_id: t.id, title: 'Grid', view_type: 'grid', is_default: 1 });
      } catch (e) { console.error('[gateway] default view create failed:', e.message); }

      const fields = tableEngine.listFields(t.id);
      const responseCols = fields.map(f => mapFieldToColumn(f));

      const nodeId = `table:${t.id}`;
      contentItemsUpsert.run(nodeId, t.id, 'table', title, null, null, null, createdBy, null, new Date().toISOString(), null, null, req.actor?.id || req.agent?.id || null, Date.now());

      res.status(201).json({ table_id: t.id, title, columns: responseCols });
    } catch (e) {
      if (e.code === 'VALIDATION_ERROR') return res.status(400).json({ error: 'VALIDATION_ERROR', detail: e.message });
      console.error('[gateway] create table failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // Describe a table
  app.get('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
    try {
      const tableId = req.params.table_id;
      const t = tableEngine.getTable(tableId);
      if (!t) return res.status(404).json({ error: 'NOT_FOUND' });

      const fields = tableEngine.listFields(tableId);
      const selectOptionsByField = new Map();
      for (const f of fields) {
        if (f.uidt === 'SingleSelect' || f.uidt === 'MultiSelect') {
          selectOptionsByField.set(f.id, tableEngine.listOptions(f.id));
        }
      }
      const columns = fields.map(f => mapFieldToColumn(f, selectOptionsByField));

      const views = tableEngine.view.list(tableId).map(mapViewRow);

      res.json({
        table_id: tableId,
        title: t.title,
        columns,
        views,
        created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
        updated_at: t.updated_at ? new Date(t.updated_at).toISOString() : null,
      });
    } catch (e) {
      console.error('[gateway] get table failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // ─── Columns (Family B) — table-engine backed ──────────────
  // Note: I4 means Link target_table_id is immutable; updateField will reject.
  // I5 means physical_column never renames; rename only changes user_fields.title.
  // I6 means dropField runs full 7-step transactional cleanup.

  // Add a column
  app.post('/api/data/tables/:table_id/columns', authenticateAgent, async (req, res) => {
    const { title, uidt: rawUidt = 'SingleLineText', options, meta } = req.body;
    if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });
    const tableId = req.params.table_id;

    try {
      const fieldOptions = {};
      const targetTableId = req.body.childId || req.body.relatedTableId || req.body.target_table_id;
      if (targetTableId) {
        fieldOptions.target_table_id = targetTableId;
        if (req.body.relationType === 'oo') fieldOptions.cardinality = 'one';
        if (req.body.relationType === 'mm') fieldOptions.cardinality = 'many';
        if (req.body.relationType === 'bt') fieldOptions.cardinality = 'one';
      }
      if (meta) {
        const metaObj = typeof meta === 'string' ? JSON.parse(meta) : meta;
        if (metaObj.precision != null) fieldOptions.precision = metaObj.precision;
        if (metaObj.decimals != null) fieldOptions.precision = metaObj.decimals;
      }

      const f = tableEngine.addField(tableId, {
        title,
        uidt: rawUidt,
        options: Object.keys(fieldOptions).length ? fieldOptions : null,
      });

      // Initial select options for SingleSelect/MultiSelect, if provided.
      if ((rawUidt === 'SingleSelect' || rawUidt === 'MultiSelect') && Array.isArray(options)) {
        for (const o of options) {
          const optTitle = typeof o === 'string' ? o : (o.title || o.value || '');
          if (!optTitle) continue;
          tableEngine.addOption(f.id, { value: optTitle, color: o.color || 'light-blue' });
        }
      }

      // Reciprocal Link field: when a Link is added on A→B, create the mirror on B→A
      // and wire paired_field_id on both sides so link.js rebuilds both JSON caches.
      if ((rawUidt === 'Links' || rawUidt === 'LinkToAnotherRecord') && targetTableId && targetTableId !== tableId) {
        try {
          const sourceTable = tableEngine.getTable(tableId);
          const pairedTitle = sourceTable?.title ? `${sourceTable.title}` : `Linked from ${tableId}`;
          const pairedCardinality = req.body.relationType === 'bt' ? 'many' : (req.body.relationType === 'oo' ? 'one' : 'many');
          const paired = tableEngine.addField(targetTableId, {
            title: pairedTitle,
            uidt: rawUidt,
            options: { target_table_id: tableId, cardinality: pairedCardinality, paired_field_id: f.id },
          });
          tableEngine.updateField(f.id, { options: { paired_field_id: paired.id } });
        } catch (pairErr) {
          console.error('[gateway] reciprocal link create failed:', pairErr);
        }
      }

      res.status(201).json({ column_id: f.id, title: f.title, type: f.uidt });
    } catch (e) {
      if (e.code === 'VALIDATION_ERROR') return res.status(400).json({ error: 'VALIDATION_ERROR', detail: e.message });
      console.error('[gateway] add column failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // Update a column
  app.patch('/api/data/tables/:table_id/columns/:column_id', authenticateAgent, async (req, res) => {
    const columnId = req.params.column_id;
    const tableId = req.params.table_id;

    try {
      const currentField = tableEngine.getField(columnId);
      if (!currentField) return res.status(404).json({ error: 'NOT_FOUND' });

      // I5: rename only touches user_fields.title; physical column stays.
      // uidt change is rejected by tableEngine.updateField.
      const patch = {};
      if (req.body.title) patch.title = req.body.title;
      if (req.body.is_primary != null) patch.is_primary = req.body.is_primary;
      if (req.body.position != null) patch.position = req.body.position;
      if (req.body.meta !== undefined) {
        const metaObj = typeof req.body.meta === 'string' ? JSON.parse(req.body.meta) : req.body.meta;
        // Pass the full meta object through as field options so the frontend
        // can round-trip currency_code, date_format, max, precision, etc.
        if (metaObj && typeof metaObj === 'object') {
          // Normalize legacy `decimals` → `precision` for Decimal fields.
          if (metaObj.decimals != null && metaObj.precision == null) {
            metaObj.precision = metaObj.decimals;
          }
          patch.options = metaObj;
        }
      }

      // I5: uidt change is forbidden for everyone (agent or human).
      if (req.body.uidt && req.body.uidt !== currentField.uidt) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', detail: 'field uidt cannot be changed; delete and recreate' });
      }

      const updated = Object.keys(patch).length
        ? tableEngine.updateField(columnId, patch)
        : currentField;

      // Select options diff: replace strategy. Existing options not in payload → delete; new ones → add.
      if (Array.isArray(req.body.options) && (currentField.uidt === 'SingleSelect' || currentField.uidt === 'MultiSelect')) {
        const existing = tableEngine.listOptions(columnId);
        const existingByValue = new Map(existing.map(o => [o.value, o]));
        const seenValues = new Set();
        for (const o of req.body.options) {
          const v = typeof o === 'string' ? o : (o.title || o.value || '');
          if (!v) continue;
          seenValues.add(v);
          const ex = existingByValue.get(v);
          if (ex) {
            const newColor = (typeof o === 'object' && o.color) || ex.color;
            if (newColor !== ex.color) tableEngine.updateOption(ex.id, { color: newColor });
          } else {
            tableEngine.addOption(columnId, { value: v, color: (typeof o === 'object' && o.color) || 'light-blue' });
          }
        }
        for (const ex of existing) {
          if (!seenValues.has(ex.value)) tableEngine.deleteOption(ex.id);
        }
      }

      res.json({ column_id: updated.id, title: updated.title, type: updated.uidt });
    } catch (e) {
      if (e.code === 'VALIDATION_ERROR') return res.status(400).json({ error: 'VALIDATION_ERROR', detail: e.message });
      console.error('[gateway] patch column failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // Delete a column
  app.delete('/api/data/tables/:table_id/columns/:column_id', authenticateAgent, async (req, res) => {
    const tableId = req.params.table_id;
    const columnId = req.params.column_id;

    try {
      const f = tableEngine.getField(columnId);
      if (!f) return res.status(404).json({ error: 'NOT_FOUND' });

      // 人类删除列前自动快照（不可逆）—— snapshot helper still uses Baserow,
      // so skip until family C lands. Drop happens regardless.
      tableEngine.dropField(columnId);
      res.json({ deleted: true });
    } catch (e) {
      if (e.code === 'VALIDATION_ERROR') return res.status(400).json({ error: 'VALIDATION_ERROR', detail: e.message });
      console.error('[gateway] delete column failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // Rename a table
  app.patch('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });
    try {
      const tableId = req.params.table_id;
      const t = db.prepare('SELECT id FROM user_tables WHERE id = ?').get(tableId);
      if (!t) return res.status(404).json({ error: 'NOT_FOUND' });
      db.prepare('UPDATE user_tables SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), tableId);
      db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
        .run(title, new Date().toISOString(), tableId, 'table');
      res.json({ table_id: tableId, title });
    } catch (e) {
      console.error('[gateway] patch table failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // Delete a table
  app.delete('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
    try {
      const tableId = req.params.table_id;
      const t = db.prepare('SELECT id FROM user_tables WHERE id = ?').get(tableId);
      if (!t) return res.status(404).json({ error: 'NOT_FOUND' });
      tableEngine.dropTable(tableId);
      db.prepare('DELETE FROM content_items WHERE raw_id = ? AND type = ?').run(tableId, 'table');
      res.json({ deleted: true });
    } catch (e) {
      console.error('[gateway] delete table failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // ── Views (Family E) — table-engine backed ─────────────────
  // Wire contract:
  //   view: { view_id, title, type, is_default, order, fk_grp_col_id?, fk_cover_image_col_id? }
  //   filter: { filter_id, fk_column_id, comparison_op, value, logical_op, order }
  //   sort: { sort_id, fk_column_id, direction, order }
  // type is a number mapping agreed with frontend (shell/lib/api/tables.ts):
  //   form:1, gallery:2, grid:3, kanban:4

  const VIEW_TYPE_NUM = { form: 1, gallery: 2, grid: 3, kanban: 4 };
  const NUM_TO_VIEW_TYPE = { 1: 'form', 2: 'gallery', 3: 'grid', 4: 'kanban' };
  const VIEW_TYPES_VALID = new Set(['grid', 'kanban', 'gallery', 'form']);

  // Front-end comparison_op → tableEngine OPERATORS key. Mirrors WHERE_OP_TO_ENGINE.
  const FILTER_OP_TO_ENGINE = {
    eq: 'eq', neq: 'neq',
    like: 'contains', nlike: 'not_contains',
    gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte',
    is: 'eq', isnot: 'neq',
    null: 'is_empty', notnull: 'is_not_empty',
    in: 'in', notin: 'not_in',
  };
  // Reverse for GET responses — pick the canonical name.
  const ENGINE_TO_FILTER_OP = {
    eq: 'eq', neq: 'neq',
    contains: 'like', not_contains: 'nlike',
    gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte',
    is_empty: 'null', is_not_empty: 'notnull',
    in: 'in', not_in: 'notin',
  };

  function mapViewToWire(v) {
    if (!v) return null;
    const opts = v.options || {};
    return {
      view_id: v.id,
      title: v.title,
      type: VIEW_TYPE_NUM[v.view_type] || 3,
      is_default: !!v.is_default,
      order: v.position,
      lock_type: null,
      ...(opts.fk_grp_col_id ? { fk_grp_col_id: opts.fk_grp_col_id } : {}),
      ...(opts.fk_cover_image_col_id ? { fk_cover_image_col_id: opts.fk_cover_image_col_id } : {}),
    };
  }

  function mapFilterToWire(f) {
    let value = null;
    if (f.value != null) {
      try { value = JSON.parse(f.value); } catch { value = f.value; }
    }
    return {
      filter_id: f.id,
      fk_column_id: f.field_id,
      comparison_op: ENGINE_TO_FILTER_OP[f.operator] || f.operator,
      comparison_sub_op: null,
      value,
      logical_op: f.conjunction || 'and',
      order: f.position,
    };
  }

  function mapSortToWire(s) {
    return {
      sort_id: s.id,
      fk_column_id: s.field_id,
      direction: s.direction,
      order: s.position,
    };
  }

  app.get('/api/data/tables/:table_id/views', authenticateAgent, (req, res) => {
    try {
      const views = tableEngine.view.list(req.params.table_id) || [];
      // Parse options on each
      const parsed = views.map(v => ({ ...v, options: v.options ? (typeof v.options === 'string' ? JSON.parse(v.options) : v.options) : null }));
      res.json({ list: parsed.map(mapViewToWire) });
    } catch (e) {
      console.error('[gateway] list views failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.post('/api/data/tables/:table_id/views', authenticateAgent, (req, res) => {
    const { title, type } = req.body;
    if (!title) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
    const view_type = (typeof type === 'string' && VIEW_TYPES_VALID.has(type)) ? type : 'grid';
    const options = {};
    if (view_type === 'kanban' && req.body.fk_grp_col_id) options.fk_grp_col_id = req.body.fk_grp_col_id;
    if ((view_type === 'kanban' || view_type === 'gallery') && req.body.fk_cover_image_col_id) options.fk_cover_image_col_id = req.body.fk_cover_image_col_id;
    try {
      const v = tableEngine.view.create({
        table_id: req.params.table_id,
        title,
        view_type,
        options: Object.keys(options).length ? options : null,
        is_default: 0,
      });
      res.status(201).json(mapViewToWire(v));
    } catch (e) {
      const status = e.code === 'VALIDATION_ERROR' ? 400 : 500;
      if (status === 500) console.error('[gateway] create view failed:', e);
      res.status(status).json({ error: status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.patch('/api/data/views/:view_id/kanban', authenticateAgent, (req, res) => {
    try {
      const v = tableEngine.view.get(req.params.view_id);
      if (!v) return res.status(404).json({ error: 'NOT_FOUND' });
      const opts = { ...(v.options || {}) };
      if (req.body.fk_grp_col_id !== undefined) opts.fk_grp_col_id = req.body.fk_grp_col_id || null;
      if (req.body.fk_cover_image_col_id !== undefined) opts.fk_cover_image_col_id = req.body.fk_cover_image_col_id || null;
      tableEngine.view.update(req.params.view_id, { options: opts });
      res.json({ updated: true });
    } catch (e) {
      console.error('[gateway] patch kanban view failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.patch('/api/data/views/:view_id/gallery', authenticateAgent, (req, res) => {
    try {
      const v = tableEngine.view.get(req.params.view_id);
      if (!v) return res.status(404).json({ error: 'NOT_FOUND' });
      const opts = { ...(v.options || {}) };
      if (req.body.fk_cover_image_col_id !== undefined) opts.fk_cover_image_col_id = req.body.fk_cover_image_col_id || null;
      tableEngine.view.update(req.params.view_id, { options: opts });
      res.json({ updated: true });
    } catch (e) {
      console.error('[gateway] patch gallery view failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.patch('/api/data/views/:view_id', authenticateAgent, (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
    try {
      tableEngine.view.update(req.params.view_id, { title });
      res.json({ updated: true });
    } catch (e) {
      const status = e.code === 'VALIDATION_ERROR' && /not found/.test(e.message) ? 404 : 500;
      if (status === 500) console.error('[gateway] update view failed:', e);
      res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.delete('/api/data/views/:view_id', authenticateAgent, (req, res) => {
    try {
      const v = tableEngine.view.get(req.params.view_id);
      if (!v) return res.status(404).json({ error: 'NOT_FOUND' });
      tableEngine.view.delete(req.params.view_id);
      res.json({ deleted: true });
    } catch (e) {
      console.error('[gateway] delete view failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // ── Filters ──
  app.get('/api/data/views/:view_id/filters', authenticateAgent, (req, res) => {
    try {
      const filters = tableEngine.view.listFilters(req.params.view_id) || [];
      res.json({ list: filters.map(mapFilterToWire) });
    } catch (e) {
      console.error('[gateway] list filters failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.post('/api/data/views/:view_id/filters', authenticateAgent, (req, res) => {
    const { fk_column_id, comparison_op, value } = req.body;
    if (!fk_column_id || !comparison_op) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'fk_column_id and comparison_op required' });
    const operator = FILTER_OP_TO_ENGINE[comparison_op] || comparison_op;
    try {
      const f = tableEngine.view.addFilter(req.params.view_id, {
        field_id: fk_column_id,
        operator,
        value: value ?? null,
        conjunction: req.body.logical_op || 'and',
      });
      res.status(201).json(mapFilterToWire(f));
    } catch (e) {
      const status = e.code === 'VALIDATION_ERROR' ? 400 : 500;
      if (status === 500) console.error('[gateway] add filter failed:', e);
      res.status(status).json({ error: status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.patch('/api/data/filters/:filter_id', authenticateAgent, (req, res) => {
    try {
      const patch = {};
      if (req.body.fk_column_id) patch.field_id = req.body.fk_column_id;
      if (req.body.comparison_op) patch.operator = FILTER_OP_TO_ENGINE[req.body.comparison_op] || req.body.comparison_op;
      if (req.body.value !== undefined) patch.value = req.body.value;
      if (req.body.logical_op) patch.conjunction = req.body.logical_op;
      tableEngine.view.updateFilter(req.params.filter_id, patch);
      res.json({ updated: true });
    } catch (e) {
      const status = e.code === 'VALIDATION_ERROR' && /not found/.test(e.message) ? 404 : 500;
      if (status === 500) console.error('[gateway] patch filter failed:', e);
      res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.delete('/api/data/filters/:filter_id', authenticateAgent, (req, res) => {
    try {
      const existing = db.prepare('SELECT id FROM user_view_filters WHERE id = ?').get(req.params.filter_id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });
      tableEngine.view.deleteFilter(req.params.filter_id);
      res.json({ deleted: true });
    } catch (e) {
      console.error('[gateway] delete filter failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // ── Sorts ──
  app.get('/api/data/views/:view_id/sorts', authenticateAgent, (req, res) => {
    try {
      const sorts = tableEngine.view.listSorts(req.params.view_id) || [];
      res.json({ list: sorts.map(mapSortToWire) });
    } catch (e) {
      console.error('[gateway] list sorts failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.post('/api/data/views/:view_id/sorts', authenticateAgent, (req, res) => {
    const { fk_column_id, direction } = req.body;
    if (!fk_column_id) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'fk_column_id required' });
    try {
      const s = tableEngine.view.addSort(req.params.view_id, {
        field_id: fk_column_id,
        direction: (direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
      });
      res.status(201).json(mapSortToWire(s));
    } catch (e) {
      const status = e.code === 'VALIDATION_ERROR' ? 400 : 500;
      if (status === 500) console.error('[gateway] add sort failed:', e);
      res.status(status).json({ error: status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.delete('/api/data/sorts/:sort_id', authenticateAgent, (req, res) => {
    try {
      const existing = db.prepare('SELECT id FROM user_view_sorts WHERE id = ?').get(req.params.sort_id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });
      tableEngine.view.deleteSort(req.params.sort_id);
      res.json({ deleted: true });
    } catch (e) {
      console.error('[gateway] delete sort failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.patch('/api/data/sorts/:sort_id', authenticateAgent, (req, res) => {
    try {
      const patch = {};
      if (req.body.fk_column_id) patch.field_id = req.body.fk_column_id;
      if (req.body.direction) patch.direction = req.body.direction.toLowerCase() === 'desc' ? 'desc' : 'asc';
      tableEngine.view.updateSort(req.params.sort_id, patch);
      res.json({ updated: true });
    } catch (e) {
      const status = e.code === 'VALIDATION_ERROR' && /not found/.test(e.message) ? 404 : 500;
      if (status === 500) console.error('[gateway] patch sort failed:', e);
      res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // ── Rows (Family C) — table-engine backed ─────────────────
  // Wire contract: payloads + responses are keyed by field TITLE (not field id),
  // matching the legacy Baserow user_field_names=true layout. Internally we
  // resolve each title to the field row and call tableEngine which speaks ids.

  // Convert title-keyed payload → id-keyed payload for tableEngine.
  // Unknown titles are dropped (frontend may send extras).
  function payloadTitlesToIds(payload, fields) {
    if (!payload || typeof payload !== 'object') return {};
    const byTitle = new Map(fields.map(f => [f.title, f]));
    const byId = new Map(fields.map(f => [f.id, f]));
    const out = {};
    for (const [k, v] of Object.entries(payload)) {
      // Prefer exact field-id match (unique); fall back to title lookup.
      const f = byId.get(k) || byTitle.get(k);
      if (!f) continue;
      out[f.id] = v;
    }
    return out;
  }

  // Convert tableEngine row (mixed: id keys for fields + builtin id/created_at/...)
  // into title-keyed wire row. Always includes `id`, `created_at`, `updated_at`.
  // Cache primary-field row values per target table so a batch of N source rows
  // doesn't hit the DB once per linked target repeatedly.
  function makeLinkResolver() {
    const cache = new Map(); // targetTableId -> Map(rowId -> displayValue)
    function resolve(targetTableId, ids) {
      if (!ids || ids.length === 0) return [];
      let tbl = cache.get(targetTableId);
      if (!tbl) {
        tbl = new Map();
        const targetFields = tableEngine.listFields(targetTableId);
        const primary = targetFields.find(f => f.is_primary) || targetFields[0];
        if (primary) {
          // Load every referenced row once.
          for (const rid of ids) {
            if (tbl.has(rid)) continue;
            const r = tableEngine.readRow(targetTableId, rid);
            tbl.set(rid, r && r[primary.id] != null ? String(r[primary.id]) : '');
          }
        }
        cache.set(targetTableId, tbl);
      } else {
        const targetFields = tableEngine.listFields(targetTableId);
        const primary = targetFields.find(f => f.is_primary) || targetFields[0];
        for (const rid of ids) {
          if (tbl.has(rid)) continue;
          const r = tableEngine.readRow(targetTableId, rid);
          tbl.set(rid, primary && r && r[primary.id] != null ? String(r[primary.id]) : '');
        }
      }
      return ids.map(rid => ({ Id: rid, id: rid, value: tbl.get(rid) || '' }));
    }
    return { resolve };
  }

  function rowIdsToTitles(row, fields, linkResolver = null) {
    if (!row) return null;
    const out = { id: row.id, Id: row.id };
    if (row.created_at != null) out.created_at = new Date(row.created_at).toISOString();
    if (row.updated_at != null) out.updated_at = new Date(row.updated_at).toISOString();
    if (row.created_by != null) out.created_by = row.created_by;
    if (row.updated_by != null) out.updated_by = row.updated_by;
    for (const f of fields) {
      if (!(f.id in row)) continue;
      const val = row[f.id];
      let emitVal;
      if ((f.uidt === 'Links' || f.uidt === 'LinkToAnotherRecord') && Array.isArray(val)) {
        const opts = typeof f.options === 'string' ? (() => { try { return JSON.parse(f.options); } catch { return {}; } })() : (f.options || {});
        const targetTableId = opts.target_table_id;
        if (targetTableId && linkResolver) {
          emitVal = linkResolver.resolve(targetTableId, val);
        } else {
          emitVal = val.map(rid => ({ Id: rid, id: rid, value: '' }));
        }
      } else {
        emitVal = val;
      }
      out[f.id] = emitVal;
      // Keep title as alias; column_id is the stable key that survives duplicates.
      if (!(f.title in out)) out[f.title] = emitVal;
    }
    return out;
  }

  // Map legacy where parser ops to tableEngine OPERATORS keys.
  const WHERE_OP_TO_ENGINE = {
    eq: 'eq',
    neq: 'neq',
    like: 'contains',
    nlike: 'not_contains',
    gt: 'gt',
    gte: 'gte',
    lt: 'lt',
    lte: 'lte',
    is: 'eq',
    isnot: 'neq',
    null: 'is_empty',
    notnull: 'is_not_empty',
    in: 'in',
    notin: 'not_in',
  };

  // Inlined parseWhere — pure string parser for (field,op,value)~and(…) syntax.
  function parseWhereString(where) {
    if (!where) return [];
    const filters = [];
    const parts = where.split(/~(and|or)/);
    for (const part of parts) {
      if (part === 'and' || part === 'or') continue;
      const match = part.match(/^\((.+?),(eq|neq|like|nlike|gt|gte|lt|lte|is|isnot|null|notnull|in|notin),(.*)?\)$/);
      if (match) filters.push({ field: match[1], op: match[2], value: match[3] || '' });
    }
    return filters;
  }

  function buildEngineFilters(whereStr, fields) {
    if (!whereStr) return [];
    const byTitle = new Map(fields.map(f => [f.title, f]));
    const raw = parseWhereString(whereStr);
    const out = [];
    for (const f of raw) {
      const field = byTitle.get(f.field);
      if (!field) continue;
      const op = WHERE_OP_TO_ENGINE[f.op];
      if (!op) continue;
      let value = f.value;
      if (op === 'in' || op === 'not_in') {
        value = String(value).split(',').map(s => s.trim()).filter(Boolean);
      }
      out.push({ field_id: field.id, operator: op, value });
    }
    return out;
  }

  function buildEngineSorts(sortStr, fields) {
    if (!sortStr) return [];
    const byTitle = new Map(fields.map(f => [f.title, f]));
    const out = [];
    for (const part of String(sortStr).split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const direction = trimmed.startsWith('-') ? 'desc' : 'asc';
      const title = trimmed.replace(/^-/, '');
      const f = byTitle.get(title);
      if (!f) continue;
      out.push({ field_id: f.id, direction });
    }
    return out;
  }

  function applyViewFiltersAndSorts(viewId, baseFilters, baseSorts) {
    // Merge view-level filters/sorts with caller-supplied ones. Caller-supplied
    // takes precedence: extra filters appended (AND), and explicit sort
    // overrides view sort entirely if non-empty.
    const filters = [...baseFilters];
    let sorts = baseSorts;
    if (viewId) {
      const vfs = tableEngine.view.listFilters(viewId).map(f => ({
        field_id: f.field_id,
        operator: f.operator,
        value: f.value != null ? JSON.parse(f.value) : null,
        conjunction: f.conjunction || 'and',
      }));
      filters.push(...vfs);
      if (sorts.length === 0) {
        sorts = tableEngine.view.listSorts(viewId).map(s => ({ field_id: s.field_id, direction: s.direction }));
      }
    }
    return { filters, sorts };
  }

  function rowsListResponse(tableId, viewId, query) {
    const limit = parseInt(query.limit || '25', 10);
    const offset = parseInt(query.offset || '0', 10);
    const fields = tableEngine.listFields(tableId);
    const baseFilters = buildEngineFilters(query.where, fields);
    const baseSorts = buildEngineSorts(query.sort, fields);
    const { filters, sorts } = applyViewFiltersAndSorts(viewId, baseFilters, baseSorts);
    const rows = tableEngine.queryRows(tableId, { filters, sorts, limit, offset, search: query.search || null });
    const linkResolver = makeLinkResolver();
    const wireRows = rows.map(r => rowIdsToTitles(r, fields, linkResolver));
    // Total count: rerun without limit/offset to count. For now skip exact total
    // (frontend pagination uses isFirstPage/isLastPage). totalRows = len if we
    // got fewer than limit, else estimate next-page presence.
    const page = Math.floor(offset / limit) + 1;
    return {
      list: wireRows,
      pageInfo: {
        totalRows: wireRows.length < limit ? offset + wireRows.length : offset + wireRows.length + 1,
        page,
        pageSize: limit,
        isFirstPage: page === 1,
        isLastPage: wireRows.length < limit,
      },
    };
  }

  // Query rows through a specific view
  app.get('/api/data/:table_id/views/:view_id/rows', authenticateAgent, async (req, res) => {
    try {
      res.json(rowsListResponse(req.params.table_id, req.params.view_id, req.query));
    } catch (e) {
      console.error('[gateway] view rows query failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // List rows from a table
  app.get('/api/data/:table_id/rows', authenticateAgent, async (req, res) => {
    try {
      res.json(rowsListResponse(req.params.table_id, null, req.query));
    } catch (e) {
      console.error('[gateway] rows query failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // ─── Batch row operations ────────────────────────────────────────────
  // (registered BEFORE /:row_id routes so /rows/batch and /rows/batch-delete
  //  don't get captured by /rows/:row_id)

  function mapEngineErrorStatus(e) {
    if (e && e.code === 'VALIDATION_ERROR') {
      if (/table not found|row not found/.test(e.message)) return 404;
      return 400;
    }
    return 500;
  }

  app.post('/api/data/:table_id/rows/batch', authenticateAgent, async (req, res) => {
    const tableId = req.params.table_id;
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'INVALID_INPUT', detail: 'rows must be a non-empty array' });

    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), null).catch(() => {});
    }

    try {
      const fields = tableEngine.listFields(tableId);
      const idRows = rows.map(r => payloadTitlesToIds(r, fields));
      const created = tableEngine.batchInsert(tableId, idRows, { actor: actorName(req) });
      const linkResolver = makeLinkResolver();
      const items = created.map(r => rowIdsToTitles(tableEngine.readRow(tableId, r.id), fields, linkResolver));
      res.status(201).json({ items });

      if (isAgentRequest(req)) {
        createTableSnapshot(tableId, 'post_agent_edit', actorName(req), null).catch(() => {});
      }
    } catch (e) {
      const status = mapEngineErrorStatus(e);
      if (status === 500) console.error('[gateway] batch insert failed:', e);
      res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', detail: e.message });
    }
  });

  app.patch('/api/data/:table_id/rows/batch', authenticateAgent, async (req, res) => {
    const tableId = req.params.table_id;
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'INVALID_INPUT', detail: 'rows must be a non-empty array with id field' });

    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), null).catch(() => {});
    }

    try {
      const fields = tableEngine.listFields(tableId);
      const updates = rows.map(r => {
        const { id, ...rest } = r;
        return { id, data: payloadTitlesToIds(rest, fields) };
      });
      const updated = tableEngine.batchUpdate(tableId, updates, { actor: actorName(req) });
      const linkResolver = makeLinkResolver();
      const items = updated.map(r => rowIdsToTitles(tableEngine.readRow(tableId, r.id), fields, linkResolver));
      res.json({ items });

      if (isAgentRequest(req)) {
        createTableSnapshot(tableId, 'post_agent_edit', actorName(req), null).catch(() => {});
      }
    } catch (e) {
      const status = mapEngineErrorStatus(e);
      if (status === 500) console.error('[gateway] batch update failed:', e);
      res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', detail: e.message });
    }
  });

  app.post('/api/data/:table_id/rows/batch-delete', authenticateAgent, async (req, res) => {
    const tableId = req.params.table_id;
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'INVALID_INPUT', detail: 'ids must be a non-empty array' });

    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), null).catch(() => {});
    }

    try {
      tableEngine.batchDelete(tableId, ids);
      res.json({ deleted: ids.length });

      if (isAgentRequest(req)) {
        createTableSnapshot(tableId, 'post_agent_edit', actorName(req), null).catch(() => {});
      }
    } catch (e) {
      const status = mapEngineErrorStatus(e);
      if (status === 500) console.error('[gateway] batch delete failed:', e);
      res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', detail: e.message });
    }
  });

  // Insert row
  app.post('/api/data/:table_id/rows', authenticateAgent, async (req, res) => {
    const tableId = req.params.table_id;
    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), null).catch(() => {});
    }
    try {
      const fields = tableEngine.listFields(tableId);
      const idData = payloadTitlesToIds(req.body, fields);
      const created = tableEngine.insertRow(tableId, idData, { actor: actorName(req) });
      const typed = tableEngine.readRow(tableId, created.id);
      res.status(201).json(rowIdsToTitles(typed, fields, makeLinkResolver()));
      if (isAgentRequest(req)) {
        createTableSnapshot(tableId, 'post_agent_edit', actorName(req), null).catch(() => {});
      }
    } catch (e) {
      if (e.code === 'VALIDATION_ERROR') {
        if (/table not found|row not found/.test(e.message)) return res.status(404).json({ error: 'NOT_FOUND', detail: e.message });
        return res.status(400).json({ error: 'VALIDATION_ERROR', detail: e.message });
      }
      console.error('[gateway] insert row failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // Update row
  app.patch('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
    const tableId = req.params.table_id;
    const rowId = req.params.row_id;
    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), null).catch(() => {});
    }
    try {
      const fields = tableEngine.listFields(tableId);
      const idData = payloadTitlesToIds(req.body, fields);
      tableEngine.updateRow(tableId, rowId, idData, { actor: actorName(req) });
      const typed = tableEngine.readRow(tableId, rowId);
      res.json(rowIdsToTitles(typed, fields, makeLinkResolver()));
      if (isAgentRequest(req)) {
        createTableSnapshot(tableId, 'post_agent_edit', actorName(req), null).catch(() => {});
      }
    } catch (e) {
      if (e.code === 'VALIDATION_ERROR') {
        if (/table not found|row not found/.test(e.message)) return res.status(404).json({ error: 'NOT_FOUND', detail: e.message });
        return res.status(400).json({ error: 'VALIDATION_ERROR', detail: e.message });
      }
      console.error('[gateway] update row failed:', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }

    // Async best-effort: User field assignment notifications.
    try {
      const allAgents = db.prepare("SELECT * FROM actors WHERE type = 'agent'").all();
      const agentMap = new Map();
      for (const a of allAgents) {
        agentMap.set(a.username, a);
        if (a.display_name) agentMap.set(a.display_name, a);
      }
      const body = req.body || {};
      for (const [field, val] of Object.entries(body)) {
        if (!val) continue;
        const valStr = typeof val === 'string' ? val : (typeof val === 'object' && val.email ? val.email : null);
        if (!valStr) continue;
        const target = agentMap.get(valStr);
        if (!target || target.id === (req.actor?.id || req.agent?.id)) continue;
        const now = Date.now();
        const evt = {
          event: 'data.user_assigned',
          source: 'row_update',
          event_id: genId('evt'),
          timestamp: now,
          data: {
            table_id: tableId,
            row_id: rowId,
            field,
            assigned_to: val,
            assigned_by: { name: actorName(req), type: req.actor?.type || 'agent' },
          },
        };
        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, target.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), now);
        pushEvent(target.id, evt);
        if (target.webhook_url) deliverWebhook(target, evt).catch(() => {});
      }
    } catch (e) { console.error(`[gateway] User assignment notification error: ${e.message}`); }
  });

  // Delete row
  app.delete('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
    const tableId = req.params.table_id;
    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), null).catch(() => {});
    }
    try {
      const existing = tableEngine.readRow(tableId, req.params.row_id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });
      tableEngine.deleteRow(tableId, req.params.row_id);
      res.json({ deleted: true });
      if (isAgentRequest(req)) {
        createTableSnapshot(tableId, 'post_agent_edit', actorName(req), null).catch(() => {});
      }
    } catch (e) {
      if (e.code === 'VALIDATION_ERROR' && /table not found/.test(e.message)) {
        return res.status(404).json({ error: 'NOT_FOUND', detail: e.message });
      }
      console.error('[gateway] delete row failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // Duplicate a table — table-engine backed (P4.2 cleanup)
  app.post('/api/data/:table_id/duplicate', authenticateAgent, (req, res) => {
    try {
      const srcTableId = req.params.table_id;
      const srcItem = db.prepare('SELECT * FROM content_items WHERE raw_id = ? AND type = ?').get(srcTableId, 'table');
      const result = tableEngine.cloneTable(srcTableId, { created_by: actorName(req) });
      const displayTitle = srcItem ? `${srcItem.title} (copy)` : result.new_table.title;
      const nodeId = `table:${result.new_table_id}`;
      contentItemsUpsert.run(nodeId, result.new_table_id, 'table', displayTitle, null, srcItem?.parent_id || null, null, actorName(req), null, new Date().toISOString(), null, null, req.actor?.id || req.agent?.id || null, Date.now());
      console.log(`[gateway] Duplicated table ${srcTableId} → ${result.new_table_id} (${result.copied_rows} rows)`);
      res.json({ success: true, new_table_id: result.new_table_id, copied_rows: result.copied_rows });
    } catch (e) {
      const status = e.code === 'NOT_FOUND' ? 404 : (e.code === 'VALIDATION_ERROR' ? 400 : 500);
      if (status === 500) console.error(`[gateway] Duplicate table failed: ${e.message}`);
      res.status(status).json({ error: e.code || 'DUPLICATE_FAILED', message: e.message });
    }
  });

  // Post a comment on a row
  app.post('/api/data/:table_id/rows/:row_id/comments', authenticateAgent, async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

    const displayName = actorName(req);
    const actId = req.actor?.id || req.agent?.id;
    const tableId = req.params.table_id;
    const rowId = req.params.row_id;
    const unifiedTableId = tableId.startsWith('table:') ? tableId : `table:${tableId}`;

    const created = createUnifiedComment(db, {
      genId, pushEvent, pushHumanEvent, humanClients, deliverWebhook,
    }, {
      targetType: 'table',
      targetId: unifiedTableId,
      text,
      anchorType: 'row',
      anchorId: rowId,
      actorId: actId,
      actorName: displayName,
    });

    res.status(201).json({
      comment_id: created.id,
      table_id: req.params.table_id,
      row_id: req.params.row_id,
      created_at: new Date(created.created_at).getTime(),
    });
  });

  // View columns (field visibility/width/order per view) — table-engine backed
  app.get('/api/data/views/:view_id/columns', authenticateAgent, async (req, res) => {
    try {
      const rows = tableEngine.view.listColumns(req.params.view_id) || [];
      const list = rows.map(r => ({
        fk_column_id: r.field_id,
        show: r.visible === 1 || r.visible === true,
        width: r.width != null ? String(r.width) : null,
        order: r.position,
      }));
      res.json({ list });
    } catch (e) {
      console.error('[gateway] list view columns failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.patch('/api/data/views/:view_id/columns/:col_id', authenticateAgent, async (req, res) => {
    const { view_id, col_id } = req.params;
    const { show, width, order } = req.body;
    try {
      const patch = {};
      if (show !== undefined) patch.visible = show ? 1 : 0;
      if (width !== undefined) patch.width = typeof width === 'string' ? (parseInt(width, 10) || null) : width;
      if (order !== undefined) patch.position = order;
      tableEngine.view.setColumn(view_id, col_id, patch);
      res.json({ updated: true });
    } catch (e) {
      console.error('[gateway] patch view column failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // ── Links (Family F) — table-engine backed ─────────────────
  // Wire contract: GET returns { list: [{Id, id, value}], pageInfo }
  // value = the linked row's primary field display string.

  function getLinkField(tableId, columnId) {
    const fields = tableEngine.listFields(tableId);
    return fields.find(f => f.id === columnId && (f.uidt === 'Links' || f.uidt === 'LinkToAnotherRecord'));
  }

  function loadLinkedRowsDisplay(targetTableId, rowIds) {
    if (!rowIds || rowIds.length === 0) return [];
    const targetFields = tableEngine.listFields(targetTableId);
    const primary = targetFields.find(f => f.is_primary) || targetFields[0];
    const out = [];
    for (const rid of rowIds) {
      const row = tableEngine.readRow(targetTableId, rid);
      if (!row) continue;
      const value = primary ? (row[primary.id] != null ? String(row[primary.id]) : '') : '';
      out.push({ Id: rid, id: rid, value });
    }
    return out;
  }

  app.get('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, (req, res) => {
    const { table_id, row_id, column_id } = req.params;
    try {
      const linkField = getLinkField(table_id, column_id);
      if (!linkField) return res.status(404).json({ error: 'COLUMN_NOT_FOUND' });
      const targets = tableEngine.link.list(linkField, row_id);
      const opts = typeof linkField.options === 'string' ? JSON.parse(linkField.options) : (linkField.options || {});
      const list = loadLinkedRowsDisplay(opts.target_table_id, targets);
      res.json({ list, pageInfo: { totalRows: list.length } });
    } catch (e) {
      console.error('[gateway] list links failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.post('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, (req, res) => {
    const { table_id, row_id, column_id } = req.params;
    const records = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.records) ? req.body.records : []);
    try {
      const linkField = getLinkField(table_id, column_id);
      if (!linkField) return res.status(404).json({ error: 'COLUMN_NOT_FOUND' });
      const newIds = records.map(r => r.Id || r.id).filter(Boolean);
      const current = tableEngine.link.list(linkField, row_id);
      const merged = [...new Set([...current, ...newIds])];
      tableEngine.link.setRowLinks(linkField, row_id, merged);
      res.json({ msg: 'Links created successfully' });
    } catch (e) {
      const status = e.code === 'CARDINALITY_VIOLATION' ? 400
        : (e.code === 'VALIDATION_ERROR' ? 400 : 500);
      if (status === 500) console.error('[gateway] add links failed:', e);
      res.status(status).json({ error: e.code || 'INTERNAL_ERROR', detail: e.message });
    }
  });

  app.delete('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, (req, res) => {
    const { table_id, row_id, column_id } = req.params;
    const records = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.records) ? req.body.records : []);
    try {
      const linkField = getLinkField(table_id, column_id);
      if (!linkField) return res.status(404).json({ error: 'COLUMN_NOT_FOUND' });
      const removeIds = new Set(records.map(r => r.Id || r.id).filter(Boolean));
      const current = tableEngine.link.list(linkField, row_id);
      const remaining = current.filter(id => !removeIds.has(id));
      tableEngine.link.setRowLinks(linkField, row_id, remaining);
      res.json({ msg: 'Links removed successfully' });
    } catch (e) {
      console.error('[gateway] remove links failed:', e);
      res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  // ─── File upload (attachments for Database rows) ──────────────
  // Writes to the same UPLOADS_ROOT/files directory used by /api/uploads
  // in auth.js, so everything is served by the static route
  // `/api/uploads/files/:filename` already registered there.
  const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(GATEWAY_DIR, 'uploads');
  const FILES_DIR = path.join(UPLOADS_ROOT, 'files');
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

  const attachmentUpload = multer({
    storage: multer.diskStorage({
      destination: FILES_DIR,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.bin';
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        cb(null, name);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.post('/api/data/upload', authenticateAgent, attachmentUpload.array('files', 10), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'NO_FILES' });
    const results = req.files.map((file) => {
      const url = `/api/uploads/files/${file.filename}`;
      return {
        name: file.filename,
        path: url,
        title: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        url,
      };
    });
    res.json(results);
  });

  // ─── Table Comments (SQLite-backed) ──────────────

  app.get('/api/data/tables/:table_id/commented-rows', authenticateAgent, (req, res) => {
    const { table_id } = req.params;
    const unifiedId = table_id.startsWith('table:') ? table_id : `table:${table_id}`;
    const rows = db.prepare("SELECT DISTINCT anchor_id, COUNT(*) as count FROM comments WHERE target_type = 'table' AND target_id = ? AND anchor_type = 'row' GROUP BY anchor_id").all(unifiedId);
    res.json({ rows: rows.map(r => ({ row_id: r.anchor_id, count: r.count })) });
  });

  function commentApiMoved(res) {
    return res.status(410).json({
      error: 'COMMENT_API_MOVED',
      message: 'Table comment routes were removed. Use /api/content-items/:id/comments and /api/content-comments/:commentId instead.',
    });
  }

  app.get('/api/data/tables/:table_id/comments', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.post('/api/data/tables/:table_id/comments', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.patch('/api/data/table-comments/:comment_id', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.delete('/api/data/table-comments/:comment_id', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.post('/api/data/table-comments/:comment_id/resolve', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.post('/api/data/table-comments/:comment_id/unresolve', authenticateAgent, (_req, res) => commentApiMoved(res));

  // ─── Table Snapshots ─────────────────────────────

  app.get('/api/data/:table_id/snapshots', authenticateAgent, (req, res) => {
    const rows = db.prepare(
      "SELECT id, version, trigger_type, description, actor_id as agent, row_count, created_at FROM content_snapshots WHERE content_type = 'table' AND content_id = ? ORDER BY version DESC"
    ).all(req.params.table_id);
    res.json({ snapshots: rows });
  });

  app.get('/api/data/:table_id/snapshots/:snapshot_id', authenticateAgent, (req, res) => {
    const snap = db.prepare(
      "SELECT id, content_id as table_id, version, trigger_type, actor_id as agent, row_count, schema_json, data_json, created_at FROM content_snapshots WHERE id = ? AND content_type = 'table' AND content_id = ?"
    ).get(req.params.snapshot_id, req.params.table_id);
    if (!snap) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(snap);
  });

  app.post('/api/data/:table_id/snapshots', authenticateAgent, async (req, res) => {
    try {
      const { agent: agentName, description } = req.body || {};
      const snap = await createTableSnapshot(req.params.table_id, 'manual', agentName || actorName(req), description);
      res.status(201).json(snap);
    } catch (e) {
      console.error(`[gateway] Manual snapshot failed: ${e.message}`);
      res.status(500).json({ error: 'SNAPSHOT_FAILED', message: e.message });
    }
  });

  app.post('/api/data/:table_id/snapshots/:snapshot_id/restore', authenticateAgent, async (req, res) => {
    const snap = db.prepare("SELECT * FROM content_snapshots WHERE id = ? AND content_type = 'table' AND content_id = ?")
      .get(req.params.snapshot_id, req.params.table_id);
    if (!snap) return res.status(404).json({ error: 'NOT_FOUND' });

    try {
      const schemaSnap = JSON.parse(snap.schema_json || '[]');
      const rowsSnap = JSON.parse(snap.data_json || '[]');

      // Format detection: P4.2 snapshots have field objects with `id`/`uidt`
      // at top level; legacy Baserow snapshots have `title`/`uidt` but
      // rows are title-keyed. Detect via row key shape on first row.
      const isP42Format = schemaSnap.length > 0 && schemaSnap[0].id && typeof schemaSnap[0].id === 'string' && schemaSnap[0].id.startsWith('ufld_');
      if (!isP42Format) {
        return res.status(409).json({
          error: 'LEGACY_SNAPSHOT_UNSUPPORTED',
          message: 'This snapshot was created with the pre-P4.2 Baserow format and cannot be restored after the migration. Create a new snapshot first.',
        });
      }

      const preRestore = await createTableSnapshot(req.params.table_id, 'pre_restore', actorName(req), null);

      const result = tableEngine.restoreTable(req.params.table_id, { schema: schemaSnap, rows: rowsSnap });

      res.json({ success: true, restored_rows: result.restored, pre_restore_snapshot_id: preRestore.id });
    } catch (e) {
      console.error(`[gateway] Restore failed: ${e.message}`);
      const status = e.code === 'NOT_FOUND' ? 404 : (e.code === 'VALIDATION_ERROR' ? 400 : 500);
      res.status(status).json({ error: e.code || 'RESTORE_FAILED', message: e.message });
    }
  });
}
