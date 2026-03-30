/**
 * Data routes: tables, columns, views, filters, sorts, rows, links,
 * file upload/download proxy, table comments, snapshots
 */
import crypto from 'crypto';
import multer from 'multer';
import {
  BR_URL,
  getBrJwt, br,
  UIDT_TO_BR, BR_TO_UIDT,
  parseNcWhere, NC_OP_TO_BR, buildBaserowFilterParams, buildBaserowOrderBy,
  BR_VIEW_TYPE_MAP, BR_VIEW_TYPE_NUM,
  getTableFields, invalidateFieldCache,
  normalizeRowForGateway, normalizeRowForBaserow,
  buildFieldCreateBody,
} from '../baserow.js';

export default function dataRoutes(app, { db, NC_EMAIL, NC_PASSWORD, NC_BASE_ID, authenticateAgent, genId, contentItemsUpsert, pushEvent, deliverWebhook }) {

  // Legacy aliases
  const nc = br;
  const getNcJwt = getBrJwt;

  // Baserow doesn't need per-agent users
  async function createNcUser(agentName, displayName) {
    console.log(`[gateway] Agent ${agentName} registered (Baserow mode — no per-agent DB user needed)`);
    return null;
  }

  async function getNcAgentJwt(agentName, password) {
    return getBrJwt();
  }

  // ─── Auto-snapshot helper ─────────────────────────
  async function createTableSnapshot(tableId, triggerType, agent) {
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

    const lastVersion = db.prepare('SELECT MAX(version) as maxV FROM table_snapshots WHERE table_id = ?').get(tableId);
    const version = (lastVersion?.maxV || 0) + 1;

    const result = db.prepare(
      'INSERT INTO table_snapshots (table_id, version, schema_json, data_json, trigger_type, agent, row_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(tableId, version, schemaJson, dataJson, triggerType, agent || null, allRows.length);

    // Retention cleanup
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const countAll = db.prepare('SELECT COUNT(*) as cnt FROM table_snapshots WHERE table_id = ?').get(tableId);
    if (countAll.cnt > 20) {
      const fiftieth = db.prepare('SELECT id FROM table_snapshots WHERE table_id = ? ORDER BY version DESC LIMIT 1 OFFSET 19').get(tableId);
      if (fiftieth) {
        db.prepare('DELETE FROM table_snapshots WHERE table_id = ? AND id < ? AND created_at < ?')
          .run(tableId, fiftieth.id, thirtyDaysAgo);
      }
    }

    return {
      id: result.lastInsertRowid,
      version,
      table_id: tableId,
      trigger_type: triggerType,
      agent: agent || null,
      row_count: allRows.length,
      created_at: new Date().toISOString(),
    };
  }

  async function maybeAutoSnapshot(tableId, agent) {
    try {
      const last = db.prepare('SELECT created_at FROM table_snapshots WHERE table_id = ? ORDER BY version DESC LIMIT 1').get(tableId);
      if (last) {
        const lastTime = new Date(last.created_at).getTime();
        if (Date.now() - lastTime < 30 * 60 * 1000) return;
      }
      await createTableSnapshot(tableId, 'auto', agent);
    } catch (e) {
      console.error(`[gateway] Auto-snapshot failed for ${tableId}: ${e.message}`);
    }
  }

  // ─── Tables ──────────────────────────────────────
  // List tables in the ASuite base
  app.get('/api/data/tables', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('GET', `/api/database/tables/database/${NC_BASE_ID}/`);
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { title, columns = [] } = req.body;
    if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });

    const createBody = { name: title };
    const result = await br('POST', `/api/database/tables/database/${NC_BASE_ID}/`, createBody);
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
    contentItemsUpsert.run(nodeId, tableId, 'table', title, null, null, null, req.agent?.name || null, null, new Date().toISOString(), null, null, Date.now());

    res.status(201).json({ table_id: tableId, title, columns: responseCols });
  });

  // Describe a table
  app.get('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;

    const fieldsResult = await br('GET', `/api/database/fields/table/${tableId}/`);
    if (fieldsResult.status >= 400) return res.status(fieldsResult.status).json({ error: 'UPSTREAM_ERROR', detail: fieldsResult.data });

    const viewsResult = await br('GET', `/api/database/views/table/${tableId}/`);

    const tablesResult = await br('GET', `/api/database/tables/database/${NC_BASE_ID}/`);
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
        col.meta = { decimals: f.number_decimal_places };
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
    }));

    res.json({ table_id: tableId, title: tableName, columns, views, created_at: tableCreatedAt, updated_at: null });
  });

  // Add a column
  app.post('/api/data/tables/:table_id/columns', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
              { [title]: req.agent.display_name || req.agent.name || 'system' }, { useToken: true });
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const columnId = req.params.column_id;
    const tableId = req.params.table_id;

    const colMeta = await br('GET', `/api/database/fields/${columnId}/`);
    if (colMeta.status >= 400) return res.status(colMeta.status).json({ error: 'UPSTREAM_ERROR', detail: colMeta.data });
    const currentField = colMeta.data;

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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/fields/${req.params.column_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    invalidateFieldCache(req.params.table_id);
    res.json({ deleted: true });
  });

  // Rename a table
  app.patch('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/tables/${req.params.table_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    invalidateFieldCache(req.params.table_id);
    db.prepare('DELETE FROM content_items WHERE raw_id = ? AND type = ?').run(req.params.table_id, 'table');
    res.json({ deleted: true });
  });

  // ── Views ──
  app.get('/api/data/tables/:table_id/views', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
    }));
    res.json({ list: views });
  });

  app.post('/api/data/tables/:table_id/views', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const body = {};
    if (req.body.fk_grp_col_id) body.single_select_field = parseInt(req.body.fk_grp_col_id, 10);
    const result = await br('PATCH', `/api/database/views/${req.params.view_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ updated: true });
  });

  app.patch('/api/data/views/:view_id/gallery', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const body = {};
    if (req.body.fk_cover_image_col_id !== undefined) body.card_cover_image_field = parseInt(req.body.fk_cover_image_col_id, 10);
    const result = await br('PATCH', `/api/database/views/${req.params.view_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ updated: true });
  });

  app.patch('/api/data/views/:view_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
    const result = await br('PATCH', `/api/database/views/${req.params.view_id}/`, { name: title });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ updated: true });
  });

  app.delete('/api/data/views/:view_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/views/${req.params.view_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ deleted: true });
  });

  // ── Filters ──
  app.get('/api/data/views/:view_id/filters', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('GET', `/api/database/views/${req.params.view_id}/filters/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    const brFilters = Array.isArray(result.data) ? result.data : [];
    const filters = brFilters.map(f => ({
      filter_id: String(f.id),
      fk_column_id: String(f.field),
      comparison_op: f.type,
      comparison_sub_op: null,
      value: f.value,
      logical_op: 'and',
      order: f.order,
    }));
    res.json({ list: filters });
  });

  app.post('/api/data/views/:view_id/filters', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { fk_column_id, comparison_op, value } = req.body;
    if (!fk_column_id || !comparison_op) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'fk_column_id and comparison_op required' });
    const brType = NC_OP_TO_BR[comparison_op] || comparison_op;
    const body = { field: parseInt(fk_column_id, 10), type: brType, value: value || '' };
    const result = await br('POST', `/api/database/views/${req.params.view_id}/filters/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.status(201).json({ filter_id: String(result.data.id), fk_column_id: String(result.data.field), comparison_op: comparison_op, value: result.data.value });
  });

  app.patch('/api/data/filters/:filter_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const body = {};
    if (req.body.fk_column_id) body.field = parseInt(req.body.fk_column_id, 10);
    if (req.body.comparison_op) body.type = NC_OP_TO_BR[req.body.comparison_op] || req.body.comparison_op;
    if (req.body.value !== undefined) body.value = req.body.value;
    const result = await br('PATCH', `/api/database/views/filter/${req.params.filter_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ updated: true });
  });

  app.delete('/api/data/filters/:filter_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/views/filter/${req.params.filter_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ deleted: true });
  });

  // ── Sorts ──
  app.get('/api/data/views/:view_id/sorts', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { fk_column_id, direction } = req.body;
    if (!fk_column_id) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'fk_column_id required' });
    const body = { field: parseInt(fk_column_id, 10), order: (direction || 'asc').toUpperCase() === 'DESC' ? 'DESC' : 'ASC' };
    const result = await br('POST', `/api/database/views/${req.params.view_id}/sortings/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.status(201).json({ sort_id: String(result.data.id), fk_column_id: String(result.data.field), direction: direction || 'asc' });
  });

  app.delete('/api/data/sorts/:sort_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/views/sorting/${req.params.sort_id}/`);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ deleted: true });
  });

  app.patch('/api/data/sorts/:sort_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const body = {};
    if (req.body.fk_column_id) body.field = parseInt(req.body.fk_column_id, 10);
    if (req.body.direction) body.order = req.body.direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const result = await br('PATCH', `/api/database/views/sorting/${req.params.sort_id}/`, body);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json(result.data);
  });

  // ── Rows ──
  // Query rows through a specific view
  app.get('/api/data/:table_id/views/:view_id/rows', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
      const filters = parseNcWhere(where);
      const filterParams = buildBaserowFilterParams(filters, fieldMap);
      for (const [key, val] of filterParams.entries()) params.append(key, val);
    }
    if (sort) {
      params.set('order_by', buildBaserowOrderBy(sort, fieldMap));
    }

    const result = await br('GET', `/api/database/rows/table/${tableId}/?${params}`, null, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const rows = (result.data?.results || []).map(r => normalizeRowForGateway(r, fields));
    res.json({ list: rows, pageInfo: { totalRows: result.data?.count || 0, page, pageSize: parseInt(limit, 10), isFirstPage: page === 1, isLastPage: !result.data?.next } });
  });

  // List rows from a table
  app.get('/api/data/:table_id/rows', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const { where, limit = '25', offset = '0', sort } = req.query;
    const fields = await getTableFields(tableId);
    const fieldMap = {};
    for (const f of fields) fieldMap[f.name] = f;

    const params = new URLSearchParams({ size: limit, user_field_names: 'true' });
    const page = Math.floor(parseInt(offset, 10) / parseInt(limit, 10)) + 1;
    params.set('page', String(page));

    if (where) {
      const filters = parseNcWhere(where);
      const filterParams = buildBaserowFilterParams(filters, fieldMap);
      for (const [key, val] of filterParams.entries()) params.append(key, val);
    }
    if (sort) {
      params.set('order_by', buildBaserowOrderBy(sort, fieldMap));
    }

    const result = await br('GET', `/api/database/rows/table/${tableId}/?${params}`, null, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const rows = (result.data?.results || []).map(r => normalizeRowForGateway(r, fields));
    res.json({ list: rows, pageInfo: { totalRows: result.data?.count || 0, page, pageSize: parseInt(limit, 10), isFirstPage: page === 1, isLastPage: !result.data?.next } });
  });

  // Insert row(s)
  app.post('/api/data/:table_id/rows', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    let rowData = req.body;

    const fields = await getTableFields(tableId);

    for (const field of fields) {
      if (field.type === 'text' && !rowData[field.name]) {
        const lcName = field.name.toLowerCase();
        if (lcName === 'created_by' || lcName === 'createdby') {
          rowData = { ...rowData, [field.name]: req.agent.display_name || req.agent.name };
        }
      }
    }

    const normalizedRow = normalizeRowForBaserow(rowData, fields);
    const result = await br('POST', `/api/database/rows/table/${tableId}/?user_field_names=true`, normalizedRow, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const normalized = normalizeRowForGateway(result.data, fields);
    res.status(201).json(normalized);
    maybeAutoSnapshot(tableId, req.agent.display_name || req.agent.name).catch(() => {});
  });

  // Update row
  app.patch('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const tableId = req.params.table_id;
    const rowId = req.params.row_id;
    let updateData = req.body;

    const fields = await getTableFields(tableId);

    for (const field of fields) {
      if (field.type === 'text') {
        const lcName = field.name.toLowerCase();
        if (lcName === 'lastmodifiedby' || lcName === 'last_modified_by') {
          updateData = { ...updateData, [field.name]: req.agent.display_name || req.agent.name };
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
      const allAgents = db.prepare('SELECT * FROM agent_accounts').all();
      const agentMap = new Map();
      for (const a of allAgents) {
        agentMap.set(a.name, a);
        if (a.display_name) agentMap.set(a.display_name, a);
      }
      const body = req.body || {};
      for (const [field, val] of Object.entries(body)) {
        if (!val) continue;
        const valStr = typeof val === 'string' ? val : (typeof val === 'object' && val.email ? val.email : null);
        if (!valStr) continue;
        const target = agentMap.get(valStr);
        if (!target || target.id === req.agent.id) continue;
        console.log(`[gateway] User assigned: ${target.name} via field "${field}" by ${req.agent.name}`);
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
            assigned_by: { name: req.agent.display_name || req.agent.name, type: req.agent.type || 'agent' },
          },
        };
        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, target.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), now);
        pushEvent(target.id, evt);
        if (target.webhook_url) deliverWebhook(target, evt).catch(() => {});
      }
    } catch (e) { console.error(`[gateway] User assignment notification error: ${e.message}`); }
    maybeAutoSnapshot(tableId, req.agent.display_name || req.agent.name).catch(() => {});
  });

  // Delete row
  app.delete('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const result = await br('DELETE', `/api/database/rows/table/${req.params.table_id}/${req.params.row_id}/`, null, { useToken: true });
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    res.json({ deleted: true });
    maybeAutoSnapshot(req.params.table_id, req.agent.display_name || req.agent.name).catch(() => {});
  });

  // Duplicate a table
  app.post('/api/data/:table_id/duplicate', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    try {
      const srcTableId = req.params.table_id;

      const tablesResult = await br('GET', `/api/database/tables/database/${NC_BASE_ID}/`);
      let srcTitle = 'Untitled';
      if (tablesResult.status < 400 && Array.isArray(tablesResult.data)) {
        const t = tablesResult.data.find(t => String(t.id) === String(srcTableId));
        if (t) srcTitle = t.name;
      }

      const srcFields = await getTableFields(srcTableId);
      const SKIP_TYPES = new Set(['autonumber', 'created_on', 'last_modified', 'link_row', 'lookup', 'rollup', 'formula', 'count']);

      const createResult = await br('POST', `/api/database/tables/database/${NC_BASE_ID}/`, { name: `${srcTitle} (copy)` });
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
      contentItemsUpsert.run(nodeId, newTableId, 'table', displayTitle, null, srcItem?.parent_id || null, null, req.agent?.name || null, null, new Date().toISOString(), null, null, Date.now());
      res.json({ success: true, new_table_id: newTableId, copied_rows: copiedRows });
    } catch (e) {
      console.error(`[gateway] Duplicate table failed: ${e.message}`);
      res.status(500).json({ error: 'DUPLICATE_FAILED', message: e.message });
    }
  });

  // Post a comment on a row
  app.post('/api/data/:table_id/rows/:row_id/comments', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

    const agent = req.agent;
    const commentId = genId('cmt');
    const now = Date.now();
    db.prepare(
      'INSERT INTO table_comments (id, table_id, row_id, text, actor, actor_id, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(commentId, req.params.table_id, req.params.row_id, text, agent.display_name || agent.name, agent.id, null, now, now);

    res.status(201).json({
      comment_id: commentId,
      table_id: req.params.table_id,
      row_id: req.params.row_id,
      created_at: now,
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
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

  // File download proxy
  app.get('/api/data/dl', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'MISSING_PATH' });
    try {
      const targetUrl = filePath.startsWith('http') ? filePath : `${BR_URL}${filePath.startsWith('/') ? filePath : '/' + filePath}`;
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

  // Legacy path-based download route
  app.get('/api/data/download/*', authenticateAgent, async (req, res) => {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });
    try {
      const brPath = '/' + req.params[0];
      const targetUrl = brPath.startsWith('http') ? brPath : `${BR_URL}${brPath}`;
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
    const rows = db.prepare('SELECT DISTINCT row_id, COUNT(*) as count FROM table_comments WHERE table_id = ? AND row_id IS NOT NULL GROUP BY row_id').all(table_id);
    res.json({ rows: rows.map(r => ({ row_id: r.row_id, count: r.count })) });
  });

  app.get('/api/data/tables/:table_id/comments', authenticateAgent, (req, res) => {
    const { table_id } = req.params;
    const { row_id, include_all } = req.query;
    let rows;
    if (row_id) {
      rows = db.prepare('SELECT * FROM table_comments WHERE table_id = ? AND row_id = ? ORDER BY created_at ASC').all(table_id, row_id);
    } else if (include_all === '1' || include_all === 'true') {
      rows = db.prepare('SELECT * FROM table_comments WHERE table_id = ? ORDER BY created_at ASC').all(table_id);
    } else {
      rows = db.prepare('SELECT * FROM table_comments WHERE table_id = ? AND row_id IS NULL ORDER BY created_at ASC').all(table_id);
    }
    const comments = rows.map(r => ({
      id: r.id,
      text: r.text,
      actor: r.actor,
      actor_id: r.actor_id,
      parent_id: r.parent_id || null,
      row_id: r.row_id || null,
      resolved_by: r.resolved_by ? { id: r.resolved_by, name: r.resolved_by } : null,
      resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    }));
    res.json({ comments });
  });

  app.post('/api/data/tables/:table_id/comments', authenticateAgent, (req, res) => {
    const { table_id } = req.params;
    const { text, parent_id, row_id } = req.body;
    if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

    const agent = req.agent;
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(`INSERT INTO table_comments (id, table_id, row_id, parent_id, text, actor, actor_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, table_id, row_id || null, parent_id || null, text,
      agent.display_name || agent.name, agent.id, now, now
    );

    // Notify agents mentioned via @agentname
    try {
      const allAgents = db.prepare('SELECT * FROM agent_accounts').all();
      for (const target of allAgents) {
        if (target.id === agent.id) continue;
        const mentionRegex = new RegExp(`@${target.name}(?![\\w-])`, 'i');
        if (!mentionRegex.test(text)) continue;

        const cleanText = text.replace(new RegExp(`@${target.name}(?![\\w-])\\s*`, 'gi'), '').trim();
        const evt = {
          event: 'data.commented',
          source: 'table_comments',
          event_id: genId('evt'),
          timestamp: now,
          data: {
            comment_id: id,
            table_id,
            row_id: row_id || null,
            text: cleanText,
            raw_text: text,
            sender: { name: agent.display_name || agent.name, type: agent.type || 'agent' },
          },
        };
        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, target.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), Date.now());
        pushEvent(target.id, evt);
        if (target.webhook_url) deliverWebhook(target, evt).catch(() => {});
        console.log(`[gateway] Event ${evt.event} → ${target.name} (table: ${table_id}, row: ${row_id || 'none'})`);
      }
    } catch (e) {
      console.error(`[gateway] Table comment notification error: ${e.message}`);
    }

    res.status(201).json({
      id,
      text,
      actor: agent.display_name || agent.name,
      actor_id: agent.id,
      parent_id: parent_id || null,
      resolved_by: null,
      resolved_at: null,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    });
  });

  app.patch('/api/data/table-comments/:comment_id', authenticateAgent, (req, res) => {
    const { comment_id } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

    const now = Date.now();
    const result = db.prepare('UPDATE table_comments SET text = ?, updated_at = ? WHERE id = ?').run(text, now, comment_id);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ updated: true });
  });

  app.delete('/api/data/table-comments/:comment_id', authenticateAgent, (req, res) => {
    const { comment_id } = req.params;
    const result = db.prepare('DELETE FROM table_comments WHERE id = ?').run(comment_id);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ deleted: true });
  });

  app.post('/api/data/table-comments/:comment_id/resolve', authenticateAgent, (req, res) => {
    const agent = req.agent;
    const now = Date.now();
    const result = db.prepare('UPDATE table_comments SET resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
      .run(agent.display_name || agent.name, now, now, req.params.comment_id);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ resolved: true });
  });

  app.post('/api/data/table-comments/:comment_id/unresolve', authenticateAgent, (req, res) => {
    const now = Date.now();
    const result = db.prepare('UPDATE table_comments SET resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?')
      .run(now, req.params.comment_id);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ unresolved: true });
  });

  // ─── Table Snapshots ─────────────────────────────

  app.get('/api/data/:table_id/snapshots', authenticateAgent, (req, res) => {
    const snapshots = db.prepare(
      'SELECT id, version, trigger_type, agent, row_count, created_at FROM table_snapshots WHERE table_id = ? ORDER BY version DESC'
    ).all(req.params.table_id);
    res.json({ snapshots });
  });

  app.get('/api/data/:table_id/snapshots/:snapshot_id', authenticateAgent, (req, res) => {
    const snap = db.prepare(
      'SELECT * FROM table_snapshots WHERE id = ? AND table_id = ?'
    ).get(req.params.snapshot_id, req.params.table_id);
    if (!snap) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(snap);
  });

  app.post('/api/data/:table_id/snapshots', authenticateAgent, async (req, res) => {
    try {
      const { agent: agentName } = req.body || {};
      const snap = await createTableSnapshot(req.params.table_id, 'manual', agentName || req.agent.display_name || req.agent.name);
      res.status(201).json(snap);
    } catch (e) {
      console.error(`[gateway] Manual snapshot failed: ${e.message}`);
      res.status(500).json({ error: 'SNAPSHOT_FAILED', message: e.message });
    }
  });

  app.post('/api/data/:table_id/snapshots/:snapshot_id/restore', authenticateAgent, async (req, res) => {
    const snap = db.prepare('SELECT * FROM table_snapshots WHERE id = ? AND table_id = ?')
      .get(req.params.snapshot_id, req.params.table_id);
    if (!snap) return res.status(404).json({ error: 'NOT_FOUND' });

    try {
      const preRestore = await createTableSnapshot(req.params.table_id, 'pre_restore', req.agent.display_name || req.agent.name);

      const snapshotRows = JSON.parse(snap.data_json);

      // Delete all current rows
      let delPage = 1;
      while (true) {
        const currentRows = await br('GET', `/api/database/rows/table/${req.params.table_id}/?size=200&page=1`, null, { useToken: true });
        if (currentRows.status >= 400) break;
        const list = currentRows.data?.results || [];
        if (list.length === 0) break;
        for (const row of list) {
          if (row.id) {
            await br('DELETE', `/api/database/rows/table/${req.params.table_id}/${row.id}/`, null, { useToken: true });
          }
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

      let restored = 0;
      for (const row of snapshotRows) {
        const cleanRow = {};
        for (const [key, val] of Object.entries(row)) {
          if (['Id', 'id', 'order', 'nc_id', 'CreatedAt', 'UpdatedAt', 'created_at', 'updated_at'].includes(key)) continue;
          if (currentCols.has(key)) {
            cleanRow[key] = val;
          }
        }
        if (Object.keys(cleanRow).length > 0) {
          const normalized = normalizeRowForBaserow(cleanRow, newFields);
          await br('POST', `/api/database/rows/table/${req.params.table_id}/?user_field_names=true`, normalized, { useToken: true });
          restored++;
        }
      }

      res.json({ success: true, restored_rows: restored, pre_restore_snapshot_id: preRestore.id });
    } catch (e) {
      console.error(`[gateway] Restore failed: ${e.message}`);
      res.status(500).json({ error: 'RESTORE_FAILED', message: e.message });
    }
  });
}
