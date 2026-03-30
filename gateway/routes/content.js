/**
 * Content routes: content items, presentations, diagrams, spreadsheets,
 * boards, doc icons, preferences, search, content comments/revisions
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  br,
  BR_TO_UIDT,
  getTableFields, invalidateFieldCache,
  buildFieldCreateBody,
} from '../baserow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = path.dirname(__dirname);

export default function contentRoutes(app, { db, NC_EMAIL, NC_PASSWORD, NC_BASE_ID, authenticateAny, authenticateAgent, genId, contentItemsUpsert, syncContentItems }) {

  // ─── Presentations ─────────────────────────────
  app.post('/api/presentations', authenticateAgent, (req, res) => {
    const { title = '' } = req.body;
    const id = crypto.randomUUID();
    const now = Date.now();
    const agentName = req.agent?.name || null;
    const defaultData = JSON.stringify({ slides: [] });

    db.prepare(`INSERT INTO presentations (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

    const nodeId = `presentation:${id}`;
    const isoNow = new Date().toISOString();
    contentItemsUpsert.run(
      nodeId, id, 'presentation', title || '',
      null, req.body.parent_id || null, null,
      agentName, agentName, isoNow, isoNow, null, Date.now()
    );

    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
    res.status(201).json({ presentation_id: id, item });
  });

  app.get('/api/presentations/:id', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({
      id: pres.id,
      data: JSON.parse(pres.data_json),
      created_by: pres.created_by,
      updated_by: pres.updated_by,
      created_at: pres.created_at,
      updated_at: pres.updated_at,
    });
  });

  app.patch('/api/presentations/:id', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });

    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'MISSING_DATA' });

    const now = Date.now();
    const agentName = req.agent?.name || null;
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    res.json({ saved: true, updated_at: now });
  });

  // ─── Presentation Semantic Slide Endpoints ──────────
  const SLIDE_LAYOUTS = {
    title: (opts) => ({
      elements: [
        { type: 'textbox', left: 80, top: 200, width: 800, height: 80, text: opts.title || '', fontSize: 48, fontWeight: 'bold', textAlign: 'center', fill: '#1a1a1a' },
      ],
      background: opts.background || '#ffffff',
      notes: opts.notes || '',
    }),
    'title-content': (opts) => ({
      elements: [
        { type: 'textbox', left: 60, top: 40, width: 840, height: 60, text: opts.title || '', fontSize: 36, fontWeight: 'bold', fill: '#1a1a1a' },
        { type: 'textbox', left: 60, top: 120, width: 840, height: 340, text: (opts.bullets || []).map(b => `• ${b}`).join('\n'), fontSize: 22, fill: '#333333', lineHeight: 1.6 },
      ],
      background: opts.background || '#ffffff',
      notes: opts.notes || '',
    }),
    'title-image': (opts) => ({
      elements: [
        { type: 'textbox', left: 60, top: 40, width: 840, height: 60, text: opts.title || '', fontSize: 36, fontWeight: 'bold', fill: '#1a1a1a' },
        { type: 'image', left: 160, top: 130, width: 640, height: 330, src: opts.image || '' },
      ],
      background: opts.background || '#ffffff',
      notes: opts.notes || '',
    }),
    'two-column': (opts) => ({
      elements: [
        { type: 'textbox', left: 60, top: 40, width: 840, height: 60, text: opts.title || '', fontSize: 36, fontWeight: 'bold', fill: '#1a1a1a' },
        { type: 'textbox', left: 60, top: 120, width: 400, height: 340, text: opts.left_content || '', fontSize: 20, fill: '#333333', lineHeight: 1.5 },
        { type: 'textbox', left: 500, top: 120, width: 400, height: 340, text: opts.right_content || '', fontSize: 20, fill: '#333333', lineHeight: 1.5 },
      ],
      background: opts.background || '#ffffff',
      notes: opts.notes || '',
    }),
    blank: (opts) => ({
      elements: [],
      background: opts.background || '#ffffff',
      notes: opts.notes || '',
    }),
  };

  app.post('/api/presentations/:id/slides', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });

    const data = JSON.parse(pres.data_json);
    const { layout, ...opts } = req.body;

    let slide;
    if (layout && SLIDE_LAYOUTS[layout]) {
      slide = SLIDE_LAYOUTS[layout](opts);
    } else if (req.body.elements) {
      slide = { elements: req.body.elements, background: req.body.background || '#ffffff', notes: req.body.notes || '' };
    } else {
      slide = SLIDE_LAYOUTS.blank(opts);
    }

    data.slides.push(slide);
    const now = Date.now();
    const agentName = req.agent?.name || null;
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    res.status(201).json({ index: data.slides.length - 1, slide, updated_at: now });
  });

  app.patch('/api/presentations/:id/slides/:index', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });

    const data = JSON.parse(pres.data_json);
    const idx = parseInt(req.params.index, 10);
    if (idx < 0 || idx >= data.slides.length) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });

    const { layout, ...opts } = req.body;
    if (layout && SLIDE_LAYOUTS[layout]) {
      data.slides[idx] = SLIDE_LAYOUTS[layout](opts);
    } else {
      Object.assign(data.slides[idx], req.body);
    }

    const now = Date.now();
    const agentName = req.agent?.name || null;
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    res.json({ index: idx, slide: data.slides[idx], updated_at: now });
  });

  app.delete('/api/presentations/:id/slides/:index', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });

    const data = JSON.parse(pres.data_json);
    const idx = parseInt(req.params.index, 10);
    if (idx < 0 || idx >= data.slides.length) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });

    data.slides.splice(idx, 1);
    const now = Date.now();
    const agentName = req.agent?.name || null;
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    res.json({ deleted: true, remaining: data.slides.length, updated_at: now });
  });

  // ─── Diagram CRUD ────────────────────────────────
  app.post('/api/diagrams', authenticateAgent, (req, res) => {
    const agentName = req.agentConfig?.name || 'unknown';
    const now = Date.now();
    const id = crypto.randomUUID();
    const defaultData = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    db.prepare(`INSERT INTO diagrams (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, JSON.stringify(defaultData), agentName, agentName, now, now);
    res.json({ id, data: defaultData, created_by: agentName, created_at: now, updated_at: now });
  });

  app.get('/api/diagrams/:id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Diagram not found' });
    let data;
    try { data = JSON.parse(row.data_json); } catch { data = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }; }
    res.json({ id: row.id, data, created_by: row.created_by, updated_by: row.updated_by, created_at: row.created_at, updated_at: row.updated_at });
  });

  app.patch('/api/diagrams/:id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Diagram not found' });
    const agentName = req.agentConfig?.name || 'unknown';
    const now = Date.now();
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'data is required' });
    db.prepare('UPDATE diagrams SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);
    res.json({ saved: true, updated_at: now });
  });

  // ─── Content Items ─────────────────────────────
  app.get('/api/content-items', authenticateAgent, (req, res) => {
    if (req.query.deleted === 'true') {
      const rows = db.prepare('SELECT * FROM content_items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
      return res.json({ items: rows });
    }
    const rows = db.prepare('SELECT * FROM content_items WHERE deleted_at IS NULL ORDER BY pinned DESC, sort_order ASC, created_at ASC').all();
    res.json({ items: rows });
  });

  app.get('/api/content-items/:id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND', message: 'Content item not found' });
    res.json({ item: row });
  });

  app.post('/api/content-items', authenticateAgent, async (req, res) => {
    const { type, title = '', parent_id = null, collection_id, columns } = req.body;
    if (!type || !['doc', 'table', 'board', 'presentation', 'spreadsheet', 'diagram'].includes(type)) {
      return res.status(400).json({ error: 'INVALID_TYPE', message: 'type must be "doc", "table", "board", "presentation", "spreadsheet", or "diagram"' });
    }

    const now = new Date().toISOString();
    const agentName = req.agent?.name || null;

    if (type === 'doc') {
      const docId = genId('doc');
      db.prepare(`INSERT INTO documents (id, title, text, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(docId, title || '', '', agentName, agentName, now, now);

      const nodeId = `doc:${docId}`;
      contentItemsUpsert.run(
        nodeId, docId, 'doc', title || '',
        null, parent_id, collection_id || null,
        agentName, agentName, now, now, null, Date.now()
      );
      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      return res.status(201).json({ item });
    }

    if (type === 'table') {
      if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'BASEROW_NOT_CONFIGURED' });

      const tableTitle = title || 'Untitled';
      const result = await br('POST', `/api/database/tables/database/${NC_BASE_ID}/`, { name: tableTitle });
      if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

      const tableId = String(result.data.id);

      const tableCols = columns || [
        { title: 'Notes', uidt: 'LongText' },
      ];
      for (const col of tableCols) {
        const colTitle = col.title || col.column_name;
        if (!colTitle) continue;
        try {
          const fieldBody = buildFieldCreateBody(colTitle, col.uidt || 'SingleLineText', { options: col.options });
          await br('POST', `/api/database/fields/table/${tableId}/`, fieldBody);
        } catch {}
      }

      try { await br('POST', `/api/database/fields/table/${tableId}/`, { name: 'created_by', type: 'text' }); } catch {}

      try {
        const viewsResult = await br('GET', `/api/database/views/table/${tableId}/`);
        const views = Array.isArray(viewsResult.data) ? viewsResult.data : [];
        if (views.length > 0 && views[0].name !== 'Grid') {
          await br('PATCH', `/api/database/views/${views[0].id}/`, { name: 'Grid' });
        }
      } catch {}

      const fields = await getTableFields(tableId);
      const responseCols = fields.map(f => ({
        column_id: String(f.id), title: f.name, type: BR_TO_UIDT[f.type] || f.type,
      }));

      const nodeId = `table:${tableId}`;
      contentItemsUpsert.run(
        nodeId, tableId, 'table', tableTitle,
        null, parent_id, null,
        agentName, agentName,
        now, now, null, Date.now()
      );
      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      return res.status(201).json({ item, table_id: tableId, columns: responseCols });
    }

    if (type === 'board') {
      const id = crypto.randomUUID();
      const nowTs = Date.now();
      const isoNow = new Date().toISOString();
      const defaultData = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'asuite',
        elements: [],
        appState: {},
        files: {},
      });

      db.prepare(`INSERT INTO boards (id, data_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, nowTs, nowTs);

      const nodeId = `board:${id}`;
      contentItemsUpsert.run(
        nodeId, id, 'board', title || '',
        null, parent_id, null,
        agentName, agentName, isoNow, isoNow, null, Date.now()
      );

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      return res.status(201).json({ item });
    }

    if (type === 'presentation') {
      const id = crypto.randomUUID();
      const nowTs = Date.now();
      const isoNow = new Date().toISOString();
      const defaultData = JSON.stringify({ slides: [] });

      db.prepare(`INSERT INTO presentations (id, data_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, nowTs, nowTs);

      const nodeId = `presentation:${id}`;
      contentItemsUpsert.run(
        nodeId, id, 'presentation', title || '',
        null, parent_id, null,
        agentName, agentName, isoNow, isoNow, null, Date.now()
      );

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      return res.status(201).json({ item });
    }

    if (type === 'spreadsheet') {
      const id = crypto.randomUUID();
      const nowTs = Date.now();
      const isoNow = new Date().toISOString();
      const defaultData = JSON.stringify({});

      db.prepare(`INSERT INTO spreadsheets (id, data_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, nowTs, nowTs);

      const nodeId = `spreadsheet:${id}`;
      contentItemsUpsert.run(
        nodeId, id, 'spreadsheet', title || '',
        null, parent_id, null,
        agentName, agentName, isoNow, isoNow, null, Date.now()
      );

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      return res.status(201).json({ item });
    }

    if (type === 'diagram') {
      const id = crypto.randomUUID();
      const nowTs = Date.now();
      const isoNow = new Date().toISOString();
      const defaultData = JSON.stringify({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

      db.prepare(`INSERT INTO diagrams (id, data_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, nowTs, nowTs);

      const nodeId = `diagram:${id}`;
      contentItemsUpsert.run(
        nodeId, id, 'diagram', title || '',
        null, parent_id, null,
        agentName, agentName, isoNow, isoNow, null, Date.now()
      );

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      return res.status(201).json({ item });
    }
  });

  // Soft-delete content item
  app.delete('/api/content-items/:id', authenticateAgent, async (req, res) => {
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'NOT_FOUND' });

    const mode = req.query.mode || 'only';
    const now = new Date().toISOString();

    if (item.type === 'doc') {
      if (mode === 'all') {
        const collectDescendants = (parentId) => {
          const children = db.prepare('SELECT * FROM content_items WHERE parent_id = ? AND deleted_at IS NULL').all(parentId);
          let all = [...children];
          for (const child of children) {
            all = all.concat(collectDescendants(child.id));
          }
          return all;
        };
        const descendants = collectDescendants(req.params.id);

        db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
        db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(now, item.raw_id);

        for (const desc of descendants) {
          db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, desc.id);
          if (desc.type === 'doc') {
            db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(now, desc.raw_id);
          }
        }
      } else {
        const children = db.prepare('SELECT * FROM content_items WHERE parent_id = ? AND deleted_at IS NULL').all(req.params.id);
        for (const child of children) {
          db.prepare('UPDATE content_items SET parent_id = ? WHERE id = ?').run(item.parent_id, child.id);
        }
        db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
        db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(now, item.raw_id);
      }
    } else if (item.type === 'table') {
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
    } else if (item.type === 'board') {
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
    } else if (item.type === 'presentation') {
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
    } else if (item.type === 'spreadsheet') {
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
    } else if (item.type === 'diagram') {
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
    }

    res.json({ deleted: true });
  });

  // Restore content item
  app.post('/api/content-items/:id/restore', authenticateAgent, async (req, res) => {
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!item.deleted_at) return res.status(400).json({ error: 'NOT_DELETED' });

    db.prepare('UPDATE content_items SET deleted_at = NULL WHERE id = ?').run(req.params.id);

    if (item.type === 'doc') {
      db.prepare('UPDATE documents SET deleted_at = NULL WHERE id = ?').run(item.raw_id);
    }

    const restored = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
    res.json({ item: restored });
  });

  // Permanently delete content item
  app.delete('/api/content-items/:id/permanent', authenticateAgent, async (req, res) => {
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'NOT_FOUND' });

    if (item.type === 'doc') {
      db.prepare('DELETE FROM documents WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'table') {
      if (NC_EMAIL && NC_PASSWORD) {
        await br('DELETE', `/api/database/tables/${item.raw_id}/`).catch(() => {});
        invalidateFieldCache(item.raw_id);
      }
    } else if (item.type === 'board') {
      db.prepare('DELETE FROM boards WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'presentation') {
      db.prepare('DELETE FROM presentations WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'spreadsheet') {
      db.prepare('DELETE FROM spreadsheets WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'diagram') {
      db.prepare('DELETE FROM diagrams WHERE id = ?').run(item.raw_id);
    }

    db.prepare('DELETE FROM content_items WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM doc_icons WHERE doc_id = ?').run(item.raw_id);

    res.json({ deleted: true });
  });

  // Force sync
  app.post('/api/content-items/sync', authenticateAgent, async (req, res) => {
    await syncContentItems();
    const rows = db.prepare('SELECT * FROM content_items WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC').all();
    res.json({ items: rows, synced_at: Date.now() });
  });

  // Update content item metadata
  app.patch('/api/content-items/:id', authenticateAgent, (req, res) => {
    const { icon, parent_id, sort_order, title, pinned } = req.body;
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'NOT_FOUND' });

    const updates = [];
    const params = [];
    if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
    if (parent_id !== undefined) { updates.push('parent_id = ?'); params.push(parent_id); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (pinned !== undefined) { updates.push('pinned = ?'); params.push(pinned ? 1 : 0); }
    if (updates.length === 0) return res.json(item);

    params.push(req.params.id);
    db.prepare(`UPDATE content_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (icon !== undefined) {
      if (icon) {
        db.prepare('INSERT INTO doc_icons (doc_id, icon, updated_at) VALUES (?, ?, ?) ON CONFLICT(doc_id) DO UPDATE SET icon = excluded.icon, updated_at = excluded.updated_at')
          .run(item.raw_id, icon, Date.now());
      } else {
        db.prepare('DELETE FROM doc_icons WHERE doc_id = ?').run(item.raw_id);
      }
    }
    const updated = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
    res.json(updated);
  });

  // Batch update sort/parent
  app.put('/api/content-items/tree', authenticateAgent, (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: '"items" array required' });
    const stmt = db.prepare('UPDATE content_items SET parent_id = ?, sort_order = ? WHERE id = ?');
    const tx = db.transaction((list) => {
      for (const item of list) {
        stmt.run(item.parent_id ?? null, item.sort_order ?? 0, item.id);
      }
    });
    tx(items);
    res.json({ updated: items.length });
  });

  // ─── Doc Icons ─────────────────────────────────
  app.get('/api/doc-icons', authenticateAgent, (req, res) => {
    const rows = db.prepare('SELECT doc_id, icon FROM doc_icons').all();
    const map = {};
    for (const r of rows) map[r.doc_id] = r.icon;
    res.json({ icons: map });
  });

  app.put('/api/doc-icons/:doc_id', authenticateAgent, (req, res) => {
    const { icon } = req.body;
    if (!icon) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: '"icon" required' });
    const now = Date.now();
    db.prepare('INSERT INTO doc_icons (doc_id, icon, updated_at) VALUES (?, ?, ?) ON CONFLICT(doc_id) DO UPDATE SET icon = excluded.icon, updated_at = excluded.updated_at')
      .run(req.params.doc_id, icon, now);
    db.prepare('UPDATE content_items SET icon = ? WHERE raw_id = ?').run(icon, req.params.doc_id);
    res.json({ doc_id: req.params.doc_id, icon, updated_at: now });
  });

  app.delete('/api/doc-icons/:doc_id', authenticateAgent, (req, res) => {
    db.prepare('DELETE FROM doc_icons WHERE doc_id = ?').run(req.params.doc_id);
    db.prepare('UPDATE content_items SET icon = NULL WHERE raw_id = ?').run(req.params.doc_id);
    res.json({ deleted: true });
  });

  // ─── Preferences ────────────────────────────────
  const PREFS_DIR = path.join(GATEWAY_DIR, 'data', 'preferences');
  fs.mkdirSync(PREFS_DIR, { recursive: true });

  function prefsPath(key) {
    const safe = key.replace(/[^a-zA-Z0-9_\-:.]/g, '_');
    return path.join(PREFS_DIR, `${safe}.json`);
  }

  app.get('/api/preferences/:key', authenticateAgent, (req, res) => {
    const filePath = prefsPath(req.params.key);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        return res.json({ key: req.params.key, value: data.value });
      }
      return res.status(404).json({ error: 'NOT_FOUND', message: `Preference "${req.params.key}" not found` });
    } catch (e) {
      return res.status(500).json({ error: 'READ_ERROR', message: e.message });
    }
  });

  app.put('/api/preferences/:key', authenticateAgent, (req, res) => {
    const filePath = prefsPath(req.params.key);
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: '"value" field required' });
    }
    try {
      fs.writeFileSync(filePath, JSON.stringify({ key: req.params.key, value, updated_at: Date.now() }), 'utf8');
      return res.json({ key: req.params.key, value, updated_at: Date.now() });
    } catch (e) {
      return res.status(500).json({ error: 'WRITE_ERROR', message: e.message });
    }
  });

  // ─── Global Search ──────────────────────────────
  app.get('/api/search', authenticateAny, (req, res) => {
    const { q, limit = '20' } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: 'MISSING_QUERY', message: 'q parameter required' });

    const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 50);
    const results = [];

    try {
      const docResults = db.prepare(`
        SELECT d.id, d.title, snippet(documents_fts, 2, '', '', '...', 40) as snippet, d.updated_at
        FROM documents_fts fts
        JOIN documents d ON d.id = fts.id
        WHERE documents_fts MATCH ? AND d.deleted_at IS NULL
        ORDER BY rank
        LIMIT ?
      `).all(q, lim);
      for (const r of docResults) {
        results.push({ id: `doc:${r.id}`, type: 'doc', title: r.title, snippet: r.snippet || '', updated_at: r.updated_at });
      }
    } catch {
      const docResults = db.prepare(
        'SELECT id, title, text, updated_at FROM documents WHERE deleted_at IS NULL AND (title LIKE ? OR text LIKE ?) ORDER BY updated_at DESC LIMIT ?'
      ).all(`%${q}%`, `%${q}%`, lim);
      for (const r of docResults) {
        const idx = (r.text || '').toLowerCase().indexOf(q.toLowerCase());
        const snippet = idx >= 0 ? r.text.substring(Math.max(0, idx - 40), idx + q.length + 40) : (r.text || '').substring(0, 80);
        results.push({ id: `doc:${r.id}`, type: 'doc', title: r.title, snippet, updated_at: r.updated_at });
      }
    }

    try {
      const itemResults = db.prepare(
        "SELECT id, type, title, updated_at FROM content_items WHERE deleted_at IS NULL AND type != 'doc' AND title LIKE ? ORDER BY updated_at DESC LIMIT ?"
      ).all(`%${q}%`, lim);
      for (const r of itemResults) {
        results.push({ id: r.id, type: r.type, title: r.title, snippet: '', updated_at: r.updated_at });
      }
    } catch { /* content_items may not exist yet */ }

    results.sort((a, b) => {
      const ta = typeof a.updated_at === 'number' ? a.updated_at : new Date(a.updated_at || 0).getTime();
      const tb = typeof b.updated_at === 'number' ? b.updated_at : new Date(b.updated_at || 0).getTime();
      return tb - ta;
    });

    res.json({ results: results.slice(0, lim) });
  });

  // ─── Health Check ─────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ─── Content Comments (Generic) ─────────────────
  app.get('/api/content-items/:id/comments', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    const rows = db.prepare(
      'SELECT * FROM content_comments WHERE content_id = ? ORDER BY created_at ASC'
    ).all(contentId);
    const comments = rows.map(r => ({
      id: r.id,
      text: r.text,
      actor: r.author,
      actor_id: r.actor_id,
      parent_id: r.parent_comment_id || null,
      resolved_by: r.resolved_by ? { id: r.resolved_by, name: r.resolved_by } : null,
      resolved_at: r.resolved_at || null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    res.json({ comments });
  });

  app.post('/api/content-items/:id/comments', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    const { text, parent_comment_id } = req.body;
    if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

    const agent = req.agent;
    const id = genId('ccmt');
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO content_comments (id, content_id, text, author, actor_id, parent_comment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, contentId, text, agent.display_name || agent.name, agent.id, parent_comment_id || null, now, now);

    res.status(201).json({
      id,
      text,
      actor: agent.display_name || agent.name,
      actor_id: agent.id,
      parent_id: parent_comment_id || null,
      resolved_by: null,
      resolved_at: null,
      created_at: now,
      updated_at: now,
    });
  });

  app.patch('/api/content-comments/:commentId', authenticateAgent, (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

    const now = new Date().toISOString();
    const result = db.prepare(
      'UPDATE content_comments SET text = ?, updated_at = ? WHERE id = ?'
    ).run(text, now, req.params.commentId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ updated: true });
  });

  app.delete('/api/content-comments/:commentId', authenticateAgent, (req, res) => {
    const result = db.prepare('DELETE FROM content_comments WHERE id = ?').run(req.params.commentId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ deleted: true });
  });

  app.post('/api/content-comments/:commentId/resolve', authenticateAgent, (req, res) => {
    const agent = req.agent;
    const now = new Date().toISOString();
    const result = db.prepare(
      'UPDATE content_comments SET resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?'
    ).run(agent.display_name || agent.name, now, now, req.params.commentId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ resolved: true });
  });

  app.post('/api/content-comments/:commentId/unresolve', authenticateAgent, (req, res) => {
    const now = new Date().toISOString();
    const result = db.prepare(
      'UPDATE content_comments SET resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?'
    ).run(now, req.params.commentId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ unresolved: true });
  });

  // ─── Content Revisions (Generic) ─────────────────
  app.get('/api/content-items/:id/revisions', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    const rows = db.prepare(
      'SELECT * FROM content_revisions WHERE content_id = ? ORDER BY created_at DESC'
    ).all(contentId);
    const revisions = rows.map(r => ({
      id: r.id,
      content_id: r.content_id,
      data: (() => { try { return JSON.parse(r.data); } catch { return null; } })(),
      created_at: r.created_at,
      created_by: r.created_by,
    }));
    res.json({ revisions });
  });

  app.post('/api/content-items/:id/revisions', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'data required' });

    const agent = req.agent;
    const id = genId('crev');
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO content_revisions (id, content_id, data, created_at, created_by)
      VALUES (?, ?, ?, ?, ?)`)
      .run(id, contentId, JSON.stringify(data), now, agent.display_name || agent.name);

    res.status(201).json({ id, content_id: contentId, created_at: now, created_by: agent.display_name || agent.name });
  });

  app.post('/api/content-items/:id/revisions/:revId/restore', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    const revision = db.prepare(
      'SELECT * FROM content_revisions WHERE id = ? AND content_id = ?'
    ).get(req.params.revId, contentId);
    if (!revision) return res.status(404).json({ error: 'REVISION_NOT_FOUND' });

    let data;
    try { data = JSON.parse(revision.data); } catch { return res.status(500).json({ error: 'INVALID_REVISION_DATA' }); }
    res.json({ data, revision_id: revision.id, created_at: revision.created_at });
  });
}
