/**
 * Data routes: tables, columns, views, filters, sorts, rows, links,
 * file upload/download proxy, table comments, snapshots
 */
import crypto from 'crypto';
import { createUnifiedComment } from '../lib/comment-service.js';
import { isAgentRequest } from '../lib/snapshot-helper.js';
import multer from 'multer';
import {
  BR_URL,
  getBrJwt, br,
  UIDT_TO_BR, BR_TO_UIDT,
  parseWhere, OP_TO_BR, getBaserowFilterType, reverseBaserowFilterType, buildBaserowFilterParams, buildBaserowOrderBy,
  BR_VIEW_TYPE_MAP, BR_VIEW_TYPE_NUM,
  getTableFields, invalidateFieldCache,
  normalizeRowForGateway, normalizeRowForBaserow,
  buildFieldCreateBody,
} from '../baserow.js';

// Get display name for the authenticated actor (human or agent)
function actorName(req) {
  return req.actor?.display_name || req.actor?.username || req.agent?.name || null;
}

export default function dataRoutes(app, { db, BR_EMAIL, BR_PASSWORD, BR_DATABASE_ID, authenticateAgent, genId, contentItemsUpsert, pushEvent, pushHumanEvent, humanClients, deliverWebhook }) {

  // Baserow doesn't need per-agent users
  async function createBrUser(agentName, displayName) {
    console.log(`[gateway] Agent ${agentName} registered (Baserow mode — no per-agent DB user needed)`);
    return null;
  }

  async function getBrAgentJwt(agentName, password) {
    return getBrJwt();
  }

  // ─── Auto-snapshot helper ─────────────────────────
  async function createTableSnapshot(tableId, triggerType, agent, description) {
    const fields = await getTableFields(tableId);
    const columns = fields.map(f => {
      const col = { id: String(f.id), title: f.name, uidt: BR_TO_UIDT[f.type] || f.type, pk: !!f.primary, rqd: false };
      if (f.select_options) col.colOptions = { options: f.select_options.map((o, i) => ({ title: o.value, color: o.color, order: i + 1 })) };
      if (f.formula) col.formula_raw = f.formula;
      return col;
    });
    const schemaJson = JSON.stringify(columns);

    const allRows = [];
    let page = 1;
    while (true) {
      const rowResult = await br('GET', `/api/database/rows/table/${tableId}/?user_field_names=true&size=200&page=${page}`, null, { useToken: true });
      if (rowResult.status >= 400) throw new Error(`Failed to fetch rows: ${rowResult.status}`);
      const list = rowResult.data?.results || [];
      for (const row of list) {
        const normalized = normalizeRowForGateway(row, fields);
        allRows.push(normalized);
      }
      if (!rowResult.data?.next) break;
      page++;
    }
    const dataJson = JSON.stringify(allRows);

    const lastVersion = db.prepare("SELECT MAX(version) as maxV FROM content_snapshots WHERE content_type = 'table' AND content_id = ?").get(tableId);
    const version = (lastVersion?.maxV || 0) + 1;

    const snapId = genId('snap');
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, description, row_count, actor_id, created_at) VALUES (?, 'table', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)"
    ).run(snapId, tableId, version, dataJson, schemaJson, triggerType, description || null, allRows.length, agent || null, now);

    return {
      id: snapId,
      version,
      table_id: tableId,
      trigger_type: triggerType,
      agent: agent || null,
      row_count: allRows.length,
      created_at: now,
    };
  }


  // ─── Tables ──────────────────────────────────────
  // List tables in the ASuite base
  app.get('/api/data/tables', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('GET', `/api/database/tables/database/${BR_DATABASE_ID}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    const tables = Array.isArray(result.data) ? result.data : [];
    const list = tables.map(t => ({
      id: String(t.id),
      title: t.name,
      order: t.order,
      created_at: t.created_on || null,
    }));
    res.json({ list });
  });

  // Create a table
  app.post('/api/data/tables', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { title, columns = [] } = req.body;
    if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });

    const createBody = { name: title };
    const result = await br('POST', `/api/database/tables/database/${BR_DATABASE_ID}/`, createBody);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const tableId = String(result.data.id);

    const addedColumns = [];
    for (const col of columns) {
      const colTitle = col.title || col.column_name;
      if (!colTitle) continue;
      try {
        const fieldBody = buildFieldCreateBody(colTitle, col.uidt || 'SingleLineText', {
          options: col.options,
          meta: col.meta,
          childId: col.childId,
          relationType: col.relationType,
          fk_relation_column_id: col.fk_relation_column_id,
          fk_lookup_column_id: col.fk_lookup_column_id,
          formula_raw: col.formula_raw,
        });
        const colResult = await br('POST', `/api/database/fields/table/${tableId}/`, fieldBody);
        if (colResult.status < 400) {
          addedColumns.push({ column_id: String(colResult.data.id), title: colResult.data.name, type: col.uidt || 'SingleLineText' });
        }
      } catch (e) { console.error(`[gateway] Failed to create column "${colTitle}": ${e.message}`); }
    }

    // Add created_by column
    try {
      await br('POST', `/api/database/fields/table/${tableId}/`, { name: 'created_by', type: 'text' });
    } catch {}

    // Rename the default view to "Grid"
    try {
      const viewsResult = await br('GET', `/api/database/views/table/${tableId}/`);
      const views = Array.isArray(viewsResult.data) ? viewsResult.data : [];
      if (views.length > 0 && views[0].name !== 'Grid') {
        await br('PATCH', `/api/database/views/${views[0].id}/`, { name: 'Grid' });
      }
    } catch { /* non-critical */ }

    const fields = await getTableFields(tableId);
    const responseCols = fields.map(f => ({
      column_id: String(f.id), title: f.name, type: BR_TO_UIDT[f.type] || f.type,
      primary_key: !!f.primary,
    }));

    const nodeId = `table:${tableId}`;
    contentItemsUpsert.run(nodeId, tableId, 'table', title, null, null, null, actorName(req), null, new Date().toISOString(), null, null, req.actor?.id || req.agent?.id || null, Date.now());

    res.status(201).json({ table_id: tableId, title, columns: responseCols });
  });

  // Describe a table
  app.get('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;

    const fieldsResult = await br('GET', `/api/database/fields/table/${tableId}/`);
    if (fieldsResult.status >= 400) return res.status(fieldsResult.status).json({ error: 'UPSTREAM_ERROR', detail: fieldsResult.data });

    const viewsResult = await br('GET', `/api/database/views/table/${tableId}/`);

    const tablesResult = await br('GET', `/api/database/tables/database/${BR_DATABASE_ID}/`);
    let tableName = 'Untitled';
    let tableCreatedAt = null;
    if (tablesResult.status < 400 && Array.isArray(tablesResult.data)) {
      const t = tablesResult.data.find(t => String(t.id) === String(tableId));
      if (t) { tableName = t.name; tableCreatedAt = t.created_on; }
    }

    const fields = Array.isArray(fieldsResult.data) ? fieldsResult.data : [];
    const columns = fields.map(f => {
      const col = {
        column_id: String(f.id),
        title: f.name,
        type: BR_TO_UIDT[f.type] || f.type,
        primary_key: !!f.primary,
        required: false,
      };
      if (f.select_options) {
        col.options = f.select_options.map((o, i) => ({ title: o.value, color: o.color, order: i + 1 }));
      }
      if (f.formula) {
        col.formula = f.formula;
      }
      if (f.type === 'link_row') {
        col.relatedTableId = f.link_row_table_id ? String(f.link_row_table_id) : null;
        col.relationType = 'mm';
      }
      if (f.type === 'lookup') {
        if (f.through_field_id) col.fk_relation_column_id = String(f.through_field_id);
        if (f.target_field_id) col.fk_lookup_column_id = String(f.target_field_id);
      }
      if (f.type === 'number' && f.number_decimal_places) {
        col.meta = { precision: f.number_decimal_places };
      }
      return col;
    });

    const brViews = viewsResult.status < 400 && Array.isArray(viewsResult.data) ? viewsResult.data : [];
    const views = brViews.map((v, i) => ({
      view_id: String(v.id),
      title: v.name,
      type: BR_VIEW_TYPE_NUM[v.type] || 3,
      is_default: i === 0,
      order: v.order,
      ...(v.single_select_field ? { fk_grp_col_id: String(v.single_select_field) } : {}),
      ...(v.card_cover_image_field ? { fk_cover_image_col_id: String(v.card_cover_image_field) } : {}),
    }));

    res.json({ table_id: tableId, title: tableName, columns, views, created_at: tableCreatedAt, updated_at: null });
  });

  // Add a column
  app.post('/api/data/tables/:table_id/columns', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { title, uidt: rawUidt = 'SingleLineText', options, meta } = req.body;
    if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });
    const tableId = req.params.table_id;

    const fieldBody = buildFieldCreateBody(title, rawUidt, {
      options,
      meta: meta ? (typeof meta === 'string' ? JSON.parse(meta) : meta) : undefined,
      childId: req.body.childId,
      relationType: req.body.relationType,
      fk_relation_column_id: req.body.fk_relation_column_id,
      fk_lookup_column_id: req.body.fk_lookup_column_id,
      fk_rollup_column_id: req.body.fk_rollup_column_id,
      rollup_function: req.body.rollup_function,
      formula_raw: req.body.formula_raw,
    });

    const result = await br('POST', `/api/database/fields/table/${tableId}/`, fieldBody);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    invalidateFieldCache(tableId);
    const c = result.data;

    if (rawUidt === 'CreatedBy' || rawUidt === 'LastModifiedBy') {
      try {
        const rowsResult = await br('GET', `/api/database/rows/table/${tableId}/?user_field_names=true&size=200`, null, { useToken: true });
        if (rowsResult.status < 400 && rowsResult.data?.results?.length > 0) {
          for (const row of rowsResult.data.results) {
            await br('PATCH', `/api/database/rows/table/${tableId}/${row.id}/?user_field_names=true`,
              { [title]: actorName(req) || 'system' }, { useToken: true });
          }
        }
      } catch (backfillErr) {
        console.error('System column backfill failed (non-fatal):', backfillErr.message);
      }
    }

    res.status(201).json({ column_id: String(c.id), title: c.name, type: rawUidt });
  });

  // Update a column
  app.patch('/api/data/tables/:table_id/columns/:column_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const columnId = req.params.column_id;
    const tableId = req.params.table_id;

    const colMeta = await br('GET', `/api/database/fields/${columnId}/`);
    if (colMeta.status >= 400) return res.status(colMeta.status).json({ error: 'UPSTREAM_ERROR', detail: colMeta.data });
    const currentField = colMeta.data;

    // 人类改列类型前自动快照（不可逆操作，改名不触发）
    if (!isAgentRequest(req) && req.body.uidt) {
      await createTableSnapshot(tableId, 'manual', actorName(req), `修改列 "${currentField.name}" 类型前自动保存`).catch(() => {});
    }

    const body = {};
    if (req.body.title) body.name = req.body.title;
    if (req.body.uidt) {
      body.type = UIDT_TO_BR[req.body.uidt] || req.body.uidt;
    }

    if (req.body.options) {
      const existingOpts = currentField.select_options || [];
      const existingMap = new Map(existingOpts.map(o => [o.value, o]));
      body.select_options = req.body.options.map(o => {
        const optTitle = typeof o === 'string' ? o : (o.title || '');
        const existing = existingMap.get(optTitle);
        return {
          ...(existing ? { id: existing.id } : {}),
          value: optTitle,
          color: o.color || (existing ? existing.color : 'light-blue'),
        };
      });
    }

    if (req.body.meta !== undefined) {
      const metaObj = typeof req.body.meta === 'string' ? JSON.parse(req.body.meta) : req.body.meta;
      if (metaObj.decimals) body.number_decimal_places = metaObj.decimals;
    }

    const result = await br('PATCH', `/api/database/fields/${columnId}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    invalidateFieldCache(tableId);
    res.json(result.data);
  });

  // Delete a column
  app.delete('/api/data/tables/:table_id/columns/:column_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;

    // 人类删除列前自动快照（不可逆操作）
    if (!isAgentRequest(req)) {
      const colMeta = await br('GET', `/api/database/fields/${req.params.column_id}/`).catch(() => null);
      const colName = colMeta?.data?.name || req.params.column_id;
      await createTableSnapshot(tableId, 'manual', actorName(req), `删除列 "${colName}" 前自动保存`).catch(() => {});
    }

    const result = await br('DELETE', `/api/database/fields/${req.params.column_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    invalidateFieldCache(tableId);
    res.json({ deleted: true });
  });

  // Rename a table
  app.patch('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });
    const result = await br('PATCH', `/api/database/tables/${req.params.table_id}/`, { name: title });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
      .run(title, new Date().toISOString(), req.params.table_id, 'table');
    res.json({ ...result.data, title });
  });

  // Delete a table
  app.delete('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/tables/${req.params.table_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    invalidateFieldCache(req.params.table_id);
    db.prepare('DELETE FROM content_items WHERE raw_id = ? AND type = ?').run(req.params.table_id, 'table');
    res.json({ deleted: true });
  });

  // ── Views ──
  app.get('/api/data/tables/:table_id/views', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('GET', `/api/database/views/table/${req.params.table_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    const brViews = Array.isArray(result.data) ? result.data : [];
    const views = brViews.map((v, i) => ({
      view_id: String(v.id),
      title: v.name,
      type: BR_VIEW_TYPE_NUM[v.type] || 3,
      is_default: i === 0,
      order: v.order,
      lock_type: null,
      ...(v.single_select_field ? { fk_grp_col_id: String(v.single_select_field) } : {}),
      ...(v.card_cover_image_field ? { fk_cover_image_col_id: String(v.card_cover_image_field) } : {}),
    }));
    res.json({ list: views });
  });

  app.post('/api/data/tables/:table_id/views', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { title, type } = req.body;
    if (!title) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
    const brType = BR_VIEW_TYPE_MAP[type] || 'grid';
    const body = { name: title, type: brType };
    if (type === 'kanban' && req.body.fk_grp_col_id) {
      body.single_select_field = parseInt(req.body.fk_grp_col_id, 10);
    }
    const result = await br('POST', `/api/database/views/table/${req.params.table_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.status(201).json({
      view_id: String(result.data.id),
      title: result.data.name,
      type: BR_VIEW_TYPE_NUM[result.data.type] || 3,
      is_default: false,
      order: result.data.order,
    });
  });

  app.patch('/api/data/views/:view_id/kanban', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const body = {};
    if (req.body.fk_grp_col_id) body.single_select_field = parseInt(req.body.fk_grp_col_id, 10);
    const result = await br('PATCH', `/api/database/views/${req.params.view_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ updated: true });
  });

  app.patch('/api/data/views/:view_id/gallery', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const body = {};
    if (req.body.fk_cover_image_col_id !== undefined) body.card_cover_image_field = parseInt(req.body.fk_cover_image_col_id, 10);
    const result = await br('PATCH', `/api/database/views/${req.params.view_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ updated: true });
  });

  app.patch('/api/data/views/:view_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
    const result = await br('PATCH', `/api/database/views/${req.params.view_id}/`, { name: title });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ updated: true });
  });

  app.delete('/api/data/views/:view_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/views/${req.params.view_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ deleted: true });
  });

  // ── Filters ──
  app.get('/api/data/views/:view_id/filters', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('GET', `/api/database/views/${req.params.view_id}/filters/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    const brFilters = Array.isArray(result.data) ? result.data : [];
    const filters = brFilters.map(f => ({
      filter_id: String(f.id),
      fk_column_id: String(f.field),
      comparison_op: reverseBaserowFilterType(f.type),
      comparison_sub_op: null,
      value: f.value,
      logical_op: 'and',
      order: f.order,
    }));
    res.json({ list: filters });
  });

  app.post('/api/data/views/:view_id/filters', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { fk_column_id, comparison_op, value } = req.body;
    if (!fk_column_id || !comparison_op) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'fk_column_id and comparison_op required' });

    // Look up field type for type-aware filter mapping
    const fieldId = parseInt(fk_column_id, 10);
    const fieldMeta = await br('GET', `/api/database/fields/${fieldId}/`);
    const fieldType = fieldMeta.status < 400 ? fieldMeta.data?.type : null;
    const brType = fieldType ? getBaserowFilterType(fieldType, comparison_op) : (OP_TO_BR[comparison_op] || comparison_op);

    // For select fields, map option value to option ID
    let filterValue = value || '';
    if (fieldMeta.status < 400 && (fieldType === 'single_select' || fieldType === 'multiple_select') && fieldMeta.data?.select_options && filterValue) {
      const opt = fieldMeta.data.select_options.find(o => o.value === filterValue);
      if (opt) filterValue = String(opt.id);
    }

    const body = { field: fieldId, type: brType, value: filterValue };
    const result = await br('POST', `/api/database/views/${req.params.view_id}/filters/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.status(201).json({ filter_id: String(result.data.id), fk_column_id: String(result.data.field), comparison_op: comparison_op, value: result.data.value });
  });

  app.patch('/api/data/filters/:filter_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const body = {};
    if (req.body.fk_column_id) body.field = parseInt(req.body.fk_column_id, 10);
    if (req.body.comparison_op) {
      // Look up existing filter to get field type for type-aware mapping
      const existing = await br('GET', `/api/database/views/filter/${req.params.filter_id}/`);
      const fieldId = body.field || (existing.status < 400 ? existing.data?.field : null);
      if (fieldId) {
        const fieldMeta = await br('GET', `/api/database/fields/${fieldId}/`);
        const fieldType = fieldMeta.status < 400 ? fieldMeta.data?.type : null;
        body.type = fieldType ? getBaserowFilterType(fieldType, req.body.comparison_op) : (OP_TO_BR[req.body.comparison_op] || req.body.comparison_op);
      } else {
        body.type = OP_TO_BR[req.body.comparison_op] || req.body.comparison_op;
      }
    }
    if (req.body.value !== undefined) body.value = req.body.value;
    const result = await br('PATCH', `/api/database/views/filter/${req.params.filter_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ updated: true });
  });

  app.delete('/api/data/filters/:filter_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/views/filter/${req.params.filter_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ deleted: true });
  });

  // ── Sorts ──
  app.get('/api/data/views/:view_id/sorts', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('GET', `/api/database/views/${req.params.view_id}/sortings/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    const brSorts = Array.isArray(result.data) ? result.data : [];
    const sorts = brSorts.map(s => ({
      sort_id: String(s.id),
      fk_column_id: String(s.field),
      direction: s.order === 'DESC' ? 'desc' : 'asc',
      order: s.id,
    }));
    res.json({ list: sorts });
  });

  app.post('/api/data/views/:view_id/sorts', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { fk_column_id, direction } = req.body;
    if (!fk_column_id) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'fk_column_id required' });
    const body = { field: parseInt(fk_column_id, 10), order: (direction || 'asc').toUpperCase() === 'DESC' ? 'DESC' : 'ASC' };
    const result = await br('POST', `/api/database/views/${req.params.view_id}/sortings/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.status(201).json({ sort_id: String(result.data.id), fk_column_id: String(result.data.field), direction: direction || 'asc' });
  });

  app.delete('/api/data/sorts/:sort_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/views/sort/${req.params.sort_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ deleted: true });
  });

  app.patch('/api/data/sorts/:sort_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const body = {};
    if (req.body.fk_column_id) body.field = parseInt(req.body.fk_column_id, 10);
    if (req.body.direction) body.order = req.body.direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const result = await br('PATCH', `/api/database/views/sort/${req.params.sort_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json(result.data);
  });

  // ── Rows ──
  // Query rows through a specific view
  app.get('/api/data/:table_id/views/:view_id/rows', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const viewId = req.params.view_id;
    const { where, limit = '25', offset = '0', sort } = req.query;
    const fields = await getTableFields(tableId);
    const fieldMap = {};
    for (const f of fields) fieldMap[f.name] = f;

    const params = new URLSearchParams({ size: limit, user_field_names: 'true' });
    const page = Math.floor(parseInt(offset, 10) / parseInt(limit, 10)) + 1;
    params.set('page', String(page));

    if (where) {
      const filters = parseWhere(where);
      const filterParams = buildBaserowFilterParams(filters, fieldMap);
      for (const [key, val] of filterParams.entries()) params.append(key, val);
    }
    if (sort) {
      const orderBy = buildBaserowOrderBy(sort, fieldMap);
      if (orderBy) params.set('order_by', orderBy);
    }

    const result = await br('GET', `/api/database/rows/table/${tableId}/?${params}`, null, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const rows = (result.data?.results || []).map(r => normalizeRowForGateway(r, fields));
    res.json({ list: rows, pageInfo: { totalRows: result.data?.count || 0, page, pageSize: parseInt(limit, 10), isFirstPage: page === 1, isLastPage: !result.data?.next } });
  });

  // List rows from a table
  app.get('/api/data/:table_id/rows', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const { where, limit = '25', offset = '0', sort } = req.query;
    const fields = await getTableFields(tableId);
    const fieldMap = {};
    for (const f of fields) fieldMap[f.name] = f;

    const params = new URLSearchParams({ size: limit, user_field_names: 'true' });
    const page = Math.floor(parseInt(offset, 10) / parseInt(limit, 10)) + 1;
    params.set('page', String(page));

    if (where) {
      const filters = parseWhere(where);
      const filterParams = buildBaserowFilterParams(filters, fieldMap);
      for (const [key, val] of filterParams.entries()) params.append(key, val);
    }
    if (sort) {
      const orderBy = buildBaserowOrderBy(sort, fieldMap);
      if (orderBy) params.set('order_by', orderBy);
    }

    const result = await br('GET', `/api/database/rows/table/${tableId}/?${params}`, null, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const rows = (result.data?.results || []).map(r => normalizeRowForGateway(r, fields));
    res.json({ list: rows, pageInfo: { totalRows: result.data?.count || 0, page, pageSize: parseInt(limit, 10), isFirstPage: page === 1, isLastPage: !result.data?.next } });
  });

  // Insert row(s)
  app.post('/api/data/:table_id/rows', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    let rowData = req.body;

    const fields = await getTableFields(tableId);

    for (const field of fields) {
      if (field.type === 'text' && !rowData[field.name]) {
        const lcName = field.name.toLowerCase();
        if (lcName === 'created_by' || lcName === 'createdby') {
          rowData = { ...rowData, [field.name]: actorName(req) };
        }
      }
    }

    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), 'agent 编辑前自动保存').catch(() => {});
    }

    const normalizedRow = normalizeRowForBaserow(rowData, fields);
    const result = await br('POST', `/api/database/rows/table/${tableId}/?user_field_names=true`, normalizedRow, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const normalized = normalizeRowForGateway(result.data, fields);
    res.status(201).json(normalized);

    if (isAgentRequest(req)) {
      createTableSnapshot(tableId, 'post_agent_edit', actorName(req), 'agent 编辑后保存').catch(() => {});
    }
  });

  // Update row
  app.patch('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const rowId = req.params.row_id;
    let updateData = req.body;

    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), 'agent 编辑前自动保存').catch(() => {});
    }

    const fields = await getTableFields(tableId);

    for (const field of fields) {
      if (field.type === 'text') {
        const lcName = field.name.toLowerCase();
        if (lcName === 'lastmodifiedby' || lcName === 'last_modified_by') {
          updateData = { ...updateData, [field.name]: actorName(req) };
        }
      }
    }

    const normalizedUpdate = normalizeRowForBaserow(updateData, fields);
    const result = await br('PATCH', `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`, normalizedUpdate, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const normalized = normalizeRowForGateway(result.data, fields);
    res.json(normalized);

    // Async: check for User field assignments → notify assigned agents
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
        console.log(`[gateway] User assigned: ${target.username} via field "${field}" by ${actorName(req)}`);
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

    if (isAgentRequest(req)) {
      createTableSnapshot(tableId, 'post_agent_edit', actorName(req), 'agent 编辑后保存').catch(() => {});
    }
  });

  // Delete row
  app.delete('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });

    if (isAgentRequest(req)) {
      await createTableSnapshot(req.params.table_id, 'pre_agent_edit', actorName(req), 'agent 编辑前自动保存').catch(() => {});
    }

    const result = await br('DELETE', `/api/database/rows/table/${req.params.table_id}/${req.params.row_id}/`, null, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ deleted: true });

    if (isAgentRequest(req)) {
      createTableSnapshot(req.params.table_id, 'post_agent_edit', actorName(req), 'agent 编辑后保存').catch(() => {});
    }
  });

  // ─── Batch row operations ────────────────────────────────────────────

  // Batch insert rows
  app.post('/api/data/:table_id/rows/batch', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'INVALID_INPUT', detail: 'rows must be a non-empty array' });

    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), 'agent 编辑前自动保存').catch(() => {});
    }

    const fields = await getTableFields(tableId);
    const normalizedRows = rows.map(row => {
      let r = { ...row };
      for (const field of fields) {
        if (field.type === 'text' && !r[field.name]) {
          const lcName = field.name.toLowerCase();
          if (lcName === 'created_by' || lcName === 'createdby') {
            r[field.name] = actorName(req);
          }
        }
      }
      return normalizeRowForBaserow(r, fields);
    });

    const result = await br('POST', `/api/database/rows/table/${tableId}/batch/?user_field_names=true`, { items: normalizedRows }, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const items = (result.data?.items || []).map(r => normalizeRowForGateway(r, fields));
    res.status(201).json({ items });

    if (isAgentRequest(req)) {
      createTableSnapshot(tableId, 'post_agent_edit', actorName(req), 'agent 编辑后保存').catch(() => {});
    }
  });

  // Batch update rows
  app.patch('/api/data/:table_id/rows/batch', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'INVALID_INPUT', detail: 'rows must be a non-empty array with id field' });

    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), 'agent 编辑前自动保存').catch(() => {});
    }

    const fields = await getTableFields(tableId);
    const normalizedRows = rows.map(row => {
      let r = { ...row };
      for (const field of fields) {
        if (field.type === 'text') {
          const lcName = field.name.toLowerCase();
          if (lcName === 'lastmodifiedby' || lcName === 'last_modified_by') {
            r[field.name] = actorName(req);
          }
        }
      }
      return { id: row.id, ...normalizeRowForBaserow(r, fields) };
    });

    const result = await br('PATCH', `/api/database/rows/table/${tableId}/batch/?user_field_names=true`, { items: normalizedRows }, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const items = (result.data?.items || []).map(r => normalizeRowForGateway(r, fields));
    res.json({ items });

    if (isAgentRequest(req)) {
      createTableSnapshot(tableId, 'post_agent_edit', actorName(req), 'agent 编辑后保存').catch(() => {});
    }
  });

  // Batch delete rows
  app.post('/api/data/:table_id/rows/batch-delete', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'INVALID_INPUT', detail: 'ids must be a non-empty array' });

    if (isAgentRequest(req)) {
      await createTableSnapshot(tableId, 'pre_agent_edit', actorName(req), 'agent 编辑前自动保存').catch(() => {});
    }

    const result = await br('POST', `/api/database/rows/table/${tableId}/batch-delete/`, { items: ids }, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    res.json({ deleted: ids.length });

    if (isAgentRequest(req)) {
      createTableSnapshot(tableId, 'post_agent_edit', actorName(req), 'agent 编辑后保存').catch(() => {});
    }
  });

  // Duplicate a table
  app.post('/api/data/:table_id/duplicate', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    try {
      const srcTableId = req.params.table_id;

      const tablesResult = await br('GET', `/api/database/tables/database/${BR_DATABASE_ID}/`);
      let srcTitle = 'Untitled';
      if (tablesResult.status < 400 && Array.isArray(tablesResult.data)) {
        const t = tablesResult.data.find(t => String(t.id) === String(srcTableId));
        if (t) srcTitle = t.name;
      }

      const srcFields = await getTableFields(srcTableId);
      const SKIP_TYPES = new Set(['autonumber', 'created_on', 'last_modified', 'link_row', 'lookup', 'rollup', 'formula', 'count']);

      const createResult = await br('POST', `/api/database/tables/database/${BR_DATABASE_ID}/`, { name: `${srcTitle} (copy)` });
      if (createResult.status >= 400) return res.status(createResult.status).json({ error: 'CREATE_FAILED', detail: createResult.data });
      const newTableId = String(createResult.data.id);

      const copyCols = srcFields.filter(f => !f.primary && !f.read_only && !SKIP_TYPES.has(f.type));
      for (const col of copyCols) {
        try {
          const fieldBody = { name: col.name, type: col.type };
          if (col.select_options) fieldBody.select_options = col.select_options.map(o => ({ value: o.value, color: o.color }));
          if (col.number_decimal_places) fieldBody.number_decimal_places = col.number_decimal_places;
          await br('POST', `/api/database/fields/table/${newTableId}/`, fieldBody);
        } catch {}
      }

      const validFieldNames = new Set([...copyCols.map(c => c.name), ...srcFields.filter(f => f.primary).map(f => f.name)]);
      const newFields = await getTableFields(newTableId);
      let allRows = [];
      let page = 1;
      while (true) {
        const rowResult = await br('GET', `/api/database/rows/table/${srcTableId}/?user_field_names=true&size=200&page=${page}`, null, { useToken: true });
        if (rowResult.status >= 400) break;
        const list = rowResult.data?.results || [];
        allRows.push(...list);
        if (!rowResult.data?.next) break;
        page++;
      }

      let copiedRows = 0;
      for (const row of allRows) {
        const cleanRow = {};
        for (const [key, val] of Object.entries(row)) {
          if (key === 'id' || key === 'order') continue;
          if (validFieldNames.has(key)) cleanRow[key] = val;
        }
        const normalized = normalizeRowForBaserow(cleanRow, newFields);
        if (Object.keys(normalized).length > 0) {
          await br('POST', `/api/database/rows/table/${newTableId}/?user_field_names=true`, normalized, { useToken: true });
          copiedRows++;
        }
      }

      console.log(`[gateway] Duplicated table ${srcTableId} → ${newTableId} (${copiedRows} rows)`);
      const srcItem = db.prepare('SELECT * FROM content_items WHERE raw_id = ? AND type = ?').get(srcTableId, 'table');
      const displayTitle = srcItem ? `${srcItem.title} (copy)` : `${srcTitle} (copy)`;
      const nodeId = `table:${newTableId}`;
      contentItemsUpsert.run(nodeId, newTableId, 'table', displayTitle, null, srcItem?.parent_id || null, null, actorName(req), null, new Date().toISOString(), null, null, req.actor?.id || req.agent?.id || null, Date.now());
      res.json({ success: true, new_table_id: newTableId, copied_rows: copiedRows });
    } catch (e) {
      console.error(`[gateway] Duplicate table failed: ${e.message}`);
      res.status(500).json({ error: 'DUPLICATE_FAILED', message: e.message });
    }
  });

  // Post a comment on a row
  app.post('/api/data/:table_id/rows/:row_id/comments', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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

  // View columns (field visibility/width per view)
  app.get('/api/data/views/:view_id/columns', authenticateAgent, async (req, res) => {
    const viewId = req.params.view_id;
    const rows = db.prepare('SELECT column_id, width, show, sort_order FROM view_column_settings WHERE view_id = ?').all(viewId);
    const list = rows.map(r => ({
      fk_column_id: r.column_id,
      show: r.show === 1,
      width: r.width ? String(r.width) : null,
      order: r.sort_order,
    }));
    res.json({ list });
  });

  app.patch('/api/data/views/:view_id/columns/:col_id', authenticateAgent, async (req, res) => {
    const { view_id, col_id } = req.params;
    const { show, width, order } = req.body;

    const existing = db.prepare('SELECT 1 FROM view_column_settings WHERE view_id = ? AND column_id = ?').get(view_id, col_id);
    if (existing) {
      const sets = [];
      const vals = [];
      if (show !== undefined) { sets.push('show = ?'); vals.push(show ? 1 : 0); }
      if (width !== undefined) { sets.push('width = ?'); vals.push(typeof width === 'string' ? parseInt(width, 10) || null : width); }
      if (order !== undefined) { sets.push('sort_order = ?'); vals.push(order); }
      sets.push('updated_at = ?'); vals.push(Date.now());
      vals.push(view_id, col_id);
      db.prepare(`UPDATE view_column_settings SET ${sets.join(', ')} WHERE view_id = ? AND column_id = ?`).run(...vals);
    } else {
      db.prepare('INSERT INTO view_column_settings (view_id, column_id, width, show, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        view_id, col_id,
        width !== undefined ? (typeof width === 'string' ? parseInt(width, 10) || null : width) : null,
        show !== undefined ? (show ? 1 : 0) : 1,
        order || null,
        Date.now()
      );
    }
    res.json({ updated: true });
  });

  // Linked records
  app.get('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const rowId = req.params.row_id;
    const columnId = req.params.column_id;

    const fields = await getTableFields(tableId);
    const linkField = fields.find(f => String(f.id) === String(columnId));
    if (!linkField) return res.status(404).json({ error: 'COLUMN_NOT_FOUND' });

    const rowResult = await br('GET', `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`, null, { useToken: true });
    if (rowResult.status >= 400) return res.status(rowResult.status).json({ error: 'UPSTREAM_ERROR', detail: rowResult.data });

    const linkedRows = rowResult.data[linkField.name] || [];
    const list = Array.isArray(linkedRows) ? linkedRows.map(r => ({ Id: r.id, id: r.id, value: r.value })) : [];
    res.json({ list, pageInfo: { totalRows: list.length } });
  });

  app.post('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const rowId = req.params.row_id;
    const columnId = req.params.column_id;
    const records = Array.isArray(req.body) ? req.body : [];

    try {
      const fields = await getTableFields(tableId);
      const linkField = fields.find(f => String(f.id) === String(columnId));
      if (!linkField) return res.status(404).json({ error: 'COLUMN_NOT_FOUND' });

      const rowResult = await br('GET', `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`, null, { useToken: true });
      if (rowResult.status >= 400) return res.status(rowResult.status).json({ error: 'UPSTREAM_ERROR', detail: rowResult.data });

      const currentLinks = (rowResult.data[linkField.name] || []).map(r => r.id);
      const newIds = records.map(r => r.Id || r.id).filter(Boolean);
      const allIds = [...new Set([...currentLinks, ...newIds])];

      const result = await br('PATCH', `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`,
        { [linkField.name]: allIds }, { useToken: true });
      if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
      res.json({ msg: 'Links created successfully' });
    } catch (e) {
      console.error('[gateway] Link creation error:', e.message);
      res.status(500).json({ error: 'LINK_FAILED', detail: e.message });
    }
  });

  app.delete('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const rowId = req.params.row_id;
    const columnId = req.params.column_id;
    const records = Array.isArray(req.body) ? req.body : [];

    try {
      const fields = await getTableFields(tableId);
      const linkField = fields.find(f => String(f.id) === String(columnId));
      if (!linkField) return res.status(404).json({ error: 'COLUMN_NOT_FOUND' });

      const rowResult = await br('GET', `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`, null, { useToken: true });
      if (rowResult.status >= 400) return res.status(rowResult.status).json({ error: 'UPSTREAM_ERROR', detail: rowResult.data });

      const currentLinks = (rowResult.data[linkField.name] || []).map(r => r.id);
      const removeIds = new Set(records.map(r => r.Id || r.id).filter(Boolean));
      const remaining = currentLinks.filter(id => !removeIds.has(id));

      const result = await br('PATCH', `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`,
        { [linkField.name]: remaining }, { useToken: true });
      if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
      res.json({ msg: 'Links removed successfully' });
    } catch (e) {
      console.error('[gateway] Unlink error:', e.message);
      res.status(500).json({ error: 'UNLINK_FAILED', detail: e.message });
    }
  });

  // ─── File upload proxy (for Baserow attachments) ──────────────
  const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  app.post('/api/data/upload', authenticateAgent, fileUpload.array('files', 10), async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'NO_FILES' });

    try {
      const brJwt = await getBrJwt();
      const results = [];
      for (const file of req.files) {
        const form = new FormData();
        const blob = new Blob([file.buffer], { type: file.mimetype });
        form.append('file', blob, file.originalname);

        const uploadRes = await fetch(`${BR_URL}/api/user-files/upload-file/`, {
          method: 'POST',
          headers: { 'Authorization': `JWT ${brJwt}` },
          body: form,
        });
        if (!uploadRes.ok) {
          const detail = await uploadRes.text();
          return res.status(uploadRes.status).json({ error: 'UPLOAD_FAILED', detail });
        }
        const data = await uploadRes.json();
        results.push({
          name: data.name,  // Baserow server filename — required for setting file fields
          path: data.url,
          title: data.original_name || file.originalname,
          mimetype: data.mime_type || file.mimetype,
          size: data.size || file.size,
          url: data.url,
          thumbnails: data.thumbnails,
        });
      }
      res.json(results);
    } catch (e) {
      console.error('[gateway] File upload error:', e);
      res.status(500).json({ error: 'UPLOAD_ERROR', detail: e.message });
    }
  });

  // File download proxy (restricted to Baserow origin to prevent SSRF)
  app.get('/api/data/dl', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'MISSING_PATH' });
    try {
      let targetUrl;
      if (filePath.startsWith('http')) {
        // Only allow URLs pointing to the configured Baserow instance (hostname match)
        try {
          const parsed = new URL(filePath);
          const allowed = new URL(BR_URL);
          if (parsed.hostname !== allowed.hostname || parsed.port !== allowed.port) {
            return res.status(403).json({ error: 'FORBIDDEN_URL' });
          }
        } catch { return res.status(403).json({ error: 'INVALID_URL' }); }
        targetUrl = filePath;
      } else {
        targetUrl = `${BR_URL}${filePath.startsWith('/') ? filePath : '/' + filePath}`;
      }
      const brRes = await fetch(targetUrl);
      if (!brRes.ok) return res.status(brRes.status).send('Not found');
      res.set('Content-Type', brRes.headers.get('content-type') || 'application/octet-stream');
      const cacheControl = brRes.headers.get('cache-control');
      if (cacheControl) res.set('Cache-Control', cacheControl);
      const buffer = Buffer.from(await brRes.arrayBuffer());
      res.send(buffer);
    } catch (e) {
      console.error('[gateway] File download proxy error:', e);
      res.status(500).json({ error: 'DOWNLOAD_ERROR' });
    }
  });

  // Legacy path-based download route (restricted to Baserow origin)
  app.get('/api/data/download/*', authenticateAgent, async (req, res) => {
    if (!BR_EMAIL || !BR_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    try {
      const brPath = '/' + req.params[0];
      let targetUrl;
      if (brPath.startsWith('http')) {
        try {
          const parsed = new URL(brPath);
          const allowed = new URL(BR_URL);
          if (parsed.hostname !== allowed.hostname || parsed.port !== allowed.port) {
            return res.status(403).json({ error: 'FORBIDDEN_URL' });
          }
        } catch { return res.status(403).json({ error: 'INVALID_URL' }); }
        targetUrl = brPath;
      } else {
        targetUrl = `${BR_URL}${brPath}`;
      }
      const brRes = await fetch(targetUrl);
      if (!brRes.ok) return res.status(brRes.status).send('Not found');
      res.set('Content-Type', brRes.headers.get('content-type') || 'application/octet-stream');
      const cacheControl = brRes.headers.get('cache-control');
      if (cacheControl) res.set('Cache-Control', cacheControl);
      const buffer = Buffer.from(await brRes.arrayBuffer());
      res.send(buffer);
    } catch (e) {
      console.error('[gateway] File download proxy error:', e);
      res.status(500).json({ error: 'DOWNLOAD_ERROR' });
    }
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
      const preRestore = await createTableSnapshot(req.params.table_id, 'pre_restore', actorName(req), '恢复版本前自动保存');

      const snapshotRows = JSON.parse(snap.data_json);

      // Delete all current rows (batch)
      while (true) {
        const currentRows = await br('GET', `/api/database/rows/table/${req.params.table_id}/?size=200&page=1`, null, { useToken: true });
        if (currentRows.status >= 400) break;
        const list = currentRows.data?.results || [];
        if (list.length === 0) break;
        const ids = list.map(r => r.id).filter(Boolean);
        if (ids.length > 0) {
          await br('POST', `/api/database/rows/table/${req.params.table_id}/batch-delete/`, { items: ids }, { useToken: true });
        }
      }

      const currentFields = await getTableFields(req.params.table_id);
      const currentCols = new Set(currentFields.map(f => f.name));

      const snapshotSchema = JSON.parse(snap.schema_json || '[]');
      const SYSTEM_UIDTS = new Set(['ID', 'CreateTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'AutoNumber', 'created_on', 'last_modified', 'autonumber']);
      for (const col of snapshotSchema) {
        if (currentCols.has(col.title)) continue;
        if (col.pk) continue;
        if (SYSTEM_UIDTS.has(col.uidt)) continue;
        try {
          const fieldBody = buildFieldCreateBody(col.title, col.uidt, {
            options: col.colOptions?.options?.map(o => ({ title: o.title, color: o.color })),
            formula_raw: col.formula_raw,
          });
          const createResult = await br('POST', `/api/database/fields/table/${req.params.table_id}/`, fieldBody);
          if (createResult.status < 400) {
            currentCols.add(col.title);
            console.log(`[gateway] Restore: recreated column "${col.title}" (${col.uidt})`);
          } else {
            console.warn(`[gateway] Restore: failed to recreate column "${col.title}": ${JSON.stringify(createResult.data)}`);
          }
        } catch (colErr) {
          console.warn(`[gateway] Restore: error recreating column "${col.title}": ${colErr.message}`);
        }
      }
      invalidateFieldCache(req.params.table_id);
      const newFields = await getTableFields(req.params.table_id);

      // Batch insert restored rows (chunks of 200)
      const cleanRows = [];
      for (const row of snapshotRows) {
        const cleanRow = {};
        for (const [key, val] of Object.entries(row)) {
          if (['Id', 'id', 'order', 'nc_id', 'CreatedAt', 'UpdatedAt', 'created_at', 'updated_at'].includes(key)) continue;
          if (currentCols.has(key)) {
            cleanRow[key] = val;
          }
        }
        if (Object.keys(cleanRow).length > 0) {
          cleanRows.push(normalizeRowForBaserow(cleanRow, newFields));
        }
      }

      let restored = 0;
      for (let i = 0; i < cleanRows.length; i += 200) {
        const chunk = cleanRows.slice(i, i + 200);
        const result = await br('POST', `/api/database/rows/table/${req.params.table_id}/batch/?user_field_names=true`, { items: chunk }, { useToken: true });
        if (result.status < 400) {
          restored += (result.data?.items || chunk).length;
        }
      }

      res.json({ success: true, restored_rows: restored, pre_restore_snapshot_id: preRestore.id });
    } catch (e) {
      console.error(`[gateway] Restore failed: ${e.message}`);
      res.status(500).json({ error: 'RESTORE_FAILED', message: e.message });
    }
  });
}
