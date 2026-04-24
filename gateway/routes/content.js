/**
 * Content routes: content items, presentations, diagrams, spreadsheets,
 * boards, doc icons, preferences, search, content comments/revisions
 */
import crypto from 'crypto';
import {
  formatUnifiedCommentRow,
  listUnifiedComments,
  createUnifiedComment,
  updateUnifiedCommentText,
  deleteUnifiedComment,
  setUnifiedCommentResolved,
} from '../lib/comment-service.js';
import { createSnapshot, isAgentRequest } from '../lib/snapshot-helper.js';
import { insertNotification } from '../lib/notifications.js';

/** Normalize agent-created diagram cells to flowchart-node format */
function normalizeDiagramCells(cells) {
  if (!Array.isArray(cells)) return cells;
  return cells.map(cell => {
    // Skip edge cells — X6 serializes edges as 'edge' or registered shapes like 'flowchart-edge'
    if (cell.shape === 'edge' || cell.shape?.includes('edge') || cell.source || cell.target) return cell;

    // Convert geometry:{x,y,width,height} to top-level props (X6 native format)
    if (cell.geometry && typeof cell.geometry === 'object') {
      const { geometry, ...rest } = cell;
      cell = {
        ...rest,
        x: cell.x ?? geometry.x,
        y: cell.y ?? geometry.y,
        width: cell.width ?? geometry.width,
        height: cell.height ?? geometry.height,
      };
    }

    if (cell.shape === 'flowchart-node' && cell.data?.flowchartShape) return cell;
    const label = cell.attrs?.label?.text || cell.data?.label || '';
    const bodyFill = cell.attrs?.body?.fill || '#ffffff';
    const bodyStroke = cell.attrs?.body?.stroke || '#374151';
    return {
      ...cell,
      shape: 'flowchart-node',
      data: {
        label,
        flowchartShape: 'rounded-rect',
        bgColor: bodyFill,
        borderColor: bodyStroke,
        textColor: '#1f2937',
        fontSize: 14,
        fontWeight: 'normal',
        fontStyle: 'normal',
        ...(cell.data || {}),
      },
      attrs: undefined,
    };
  });
}
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = path.dirname(__dirname);
import { restoreDocFromSnapshot } from '../lib/doc-restore-helper.js';

// Get display name for the authenticated actor (human or agent)
function actorName(req) {
  return req.actor?.display_name || req.actor?.username || req.agent?.name || null;
}

export default function contentRoutes(app, { db, authenticateAny, authenticateAgent, genId, contentItemsUpsert, syncContentItems, pushEvent, pushHumanEvent, humanClients, deliverWebhook, tableEngine }) {

  // ─── Presentations ─────────────────────────────
  app.post('/api/presentations', authenticateAgent, (req, res) => {
    const { title = '' } = req.body;
    const id = crypto.randomUUID();
    const now = Date.now();
    const agentName = actorName(req);
    const defaultData = JSON.stringify({ slides: [] });

    db.prepare(`INSERT INTO presentations (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

    const nodeId = `presentation:${id}`;
    const isoNow = new Date().toISOString();
    const presActorId = req.actor?.id || req.agent?.id || null;
    contentItemsUpsert.run(
      nodeId, id, 'presentation', title || '',
      null, req.body.parent_id || null, null,
      agentName, agentName, isoNow, isoNow, null, presActorId, Date.now()
    );

    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);

    // Notify human users when agent creates content
    if (isAgentRequest(req)) {
      try {
        const humanActors = db.prepare("SELECT id FROM actors WHERE type = 'human'").all();
        for (const actor of humanActors) {
          const { id: notifId } = insertNotification(db, { genId }, {
            actorId: agentName, targetActorId: actor.id, type: 'content_created',
            titleKey: 'serverNotifications.content_created.title', titleParams: { title: title || '' },
            bodyKey: 'serverNotifications.content_created.body', bodyParams: { agent: agentName, kind: '@:serverNotifications.kinds.presentation', title: title || nodeId },
            link: `/content?id=${nodeId}`, meta: { content_id: nodeId, type: 'presentation' },
          });
          pushHumanEvent(actor.id, { event: 'notification.created', data: { id: notifId, type: 'content_created', content_id: nodeId, title } });
          pushHumanEvent(actor.id, { event: 'content.changed', data: { action: 'created', type: 'presentation', id: nodeId, title } });
        }
      } catch (e) { console.warn('[content] presentation notification failed:', e.message); }
    }

    res.status(201).json({ presentation_id: id, item });
  });

  app.get('/api/presentations/:id', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);

    // Lazy migration: ensure all slides have stable IDs
    let needsSave = false;
    (data.slides || []).forEach(s => {
      if (!s.id) { s.id = crypto.randomUUID(); needsSave = true; }
    });
    if (needsSave) {
      db.prepare('UPDATE presentations SET data_json = ? WHERE id = ?')
        .run(JSON.stringify(data), req.params.id);
    }

    res.json({
      id: pres.id,
      data,
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

    if (isAgentRequest(req)) {
      createSnapshot(db, { genId }, {
        contentType: 'presentation',
        contentId: 'presentation:' + req.params.id,
        data: JSON.parse(pres.data_json),
        triggerType: 'pre_agent_edit',
        actorId: actorName(req),
        title: pres.title || null,
      });
    }

    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    if (isAgentRequest(req)) {
      createSnapshot(db, { genId }, {
        contentType: 'presentation',
        contentId: 'presentation:' + req.params.id,
        data: data,
        triggerType: 'post_agent_edit',
        actorId: actorName(req),
        title: null,
        description: req.body.revision_description || null,
      });
    }

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

    // Assign stable slide_id so element-level operations (update_slide_element etc.) work immediately
    if (!slide.id) slide.id = crypto.randomUUID();

    data.slides.push(slide);
    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    res.status(201).json({ index: data.slides.length - 1, slide_id: slide.id, slide, updated_at: now });
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
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    res.json({ index: idx, slide: data.slides[idx], updated_at: now });
  });

  // GET /api/presentations/:id/slides — list all slides (id + index + notes preview)
  app.get('/api/presentations/:id/slides', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);

    // Lazy migration: assign stable slide_id to any slide that lacks one
    let needsSave = false;
    (data.slides || []).forEach(s => {
      if (!s.id) { s.id = crypto.randomUUID(); needsSave = true; }
    });
    if (needsSave) {
      db.prepare('UPDATE presentations SET data_json = ? WHERE id = ?')
        .run(JSON.stringify(data), req.params.id);
    }

    const slides = (data.slides || []).map((s, idx) => ({
      index: idx,
      slide_id: s.id,
      background: s.background || '#ffffff',
      element_count: Array.isArray(s.elements) ? s.elements.length : 0,
      notes_preview: (s.notes || '').slice(0, 80),
      thumbnail: s.thumbnail || null,
    }));
    res.json({ presentation_id: req.params.id, slides });
  });

  // GET /api/presentations/:id/slides/:slide_id — read a single slide by its id field
  app.get('/api/presentations/:id/slides/by-id/:slide_id', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);
    const idx = (data.slides || []).findIndex(s => s.id === req.params.slide_id);
    if (idx === -1) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });
    res.json({ index: idx, slide: data.slides[idx] });
  });

  // PATCH /api/presentations/:id/slides/by-id/:slide_id — update slide by id
  app.patch('/api/presentations/:id/slides/by-id/:slide_id', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);
    const idx = (data.slides || []).findIndex(s => s.id === req.params.slide_id);
    if (idx === -1) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });

    const { layout, ...opts } = req.body;
    if (layout && SLIDE_LAYOUTS[layout]) {
      data.slides[idx] = { ...SLIDE_LAYOUTS[layout](opts), id: req.params.slide_id };
    } else {
      Object.assign(data.slides[idx], req.body);
      data.slides[idx].id = req.params.slide_id; // preserve id
    }

    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);
    res.json({ index: idx, slide: data.slides[idx], updated_at: now });
  });

  // DELETE /api/presentations/:id/slides/by-id/:slide_id — delete slide by id
  app.delete('/api/presentations/:id/slides/by-id/:slide_id', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);
    const idx = (data.slides || []).findIndex(s => s.id === req.params.slide_id);
    if (idx === -1) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });
    data.slides.splice(idx, 1);
    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);
    res.json({ deleted: true, remaining: data.slides.length, updated_at: now });
  });

  // PUT /api/presentations/:id/slides/reorder — reorder slides by slide_id array
  app.put('/api/presentations/:id/slides/reorder', authenticateAgent, (req, res) => {
    const { slide_id_order } = req.body;
    if (!Array.isArray(slide_id_order)) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'slide_id_order must be an array' });
    }
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);
    const slideMap = new Map((data.slides || []).map(s => [s.id, s]));
    const reordered = slide_id_order.map(sid => slideMap.get(sid)).filter(Boolean);
    // Append any slides not in the order list at the end
    const mentioned = new Set(slide_id_order);
    for (const s of (data.slides || [])) {
      if (!mentioned.has(s.id)) reordered.push(s);
    }
    data.slides = reordered;
    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);
    res.json({ presentation_id: req.params.id, slide_count: data.slides.length, updated_at: now });
  });

  // Slide element operations (by slide_id + element index)
  // PATCH /api/presentations/:id/slides/by-id/:slide_id/elements/:element_index
  app.patch('/api/presentations/:id/slides/by-id/:slide_id/elements/:element_index', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);
    const slideIdx = (data.slides || []).findIndex(s => s.id === req.params.slide_id);
    if (slideIdx === -1) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });
    const slide = data.slides[slideIdx];
    const elIdx = parseInt(req.params.element_index, 10);
    if (!Array.isArray(slide.elements) || elIdx < 0 || elIdx >= slide.elements.length) {
      return res.status(404).json({ error: 'ELEMENT_NOT_FOUND' });
    }
    Object.assign(slide.elements[elIdx], req.body);
    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);
    res.json({ slide_id: req.params.slide_id, element_index: elIdx, element: slide.elements[elIdx], updated_at: now });
  });

  // POST /api/presentations/:id/slides/by-id/:slide_id/elements — insert new element
  app.post('/api/presentations/:id/slides/by-id/:slide_id/elements', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);
    const slideIdx = (data.slides || []).findIndex(s => s.id === req.params.slide_id);
    if (slideIdx === -1) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });
    const slide = data.slides[slideIdx];
    if (!Array.isArray(slide.elements)) slide.elements = [];
    const { after_index, ...element } = req.body;
    const insertAt = (after_index !== undefined && after_index !== null)
      ? Math.min(after_index + 1, slide.elements.length)
      : slide.elements.length;
    slide.elements.splice(insertAt, 0, element);
    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);
    res.status(201).json({ slide_id: req.params.slide_id, element_index: insertAt, element, updated_at: now });
  });

  // DELETE /api/presentations/:id/slides/by-id/:slide_id/elements/:element_index
  app.delete('/api/presentations/:id/slides/by-id/:slide_id/elements/:element_index', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(pres.data_json);
    const slideIdx = (data.slides || []).findIndex(s => s.id === req.params.slide_id);
    if (slideIdx === -1) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });
    const slide = data.slides[slideIdx];
    const elIdx = parseInt(req.params.element_index, 10);
    if (!Array.isArray(slide.elements) || elIdx < 0 || elIdx >= slide.elements.length) {
      return res.status(404).json({ error: 'ELEMENT_NOT_FOUND' });
    }
    slide.elements.splice(elIdx, 1);
    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);
    res.json({ deleted: true, slide_id: req.params.slide_id, remaining_elements: slide.elements.length, updated_at: now });
  });

  app.delete('/api/presentations/:id/slides/:index', authenticateAgent, (req, res) => {
    const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
    if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });

    const data = JSON.parse(pres.data_json);
    const idx = parseInt(req.params.index, 10);
    if (idx < 0 || idx >= data.slides.length) return res.status(404).json({ error: 'SLIDE_NOT_FOUND' });

    data.slides.splice(idx, 1);
    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    res.json({ deleted: true, remaining: data.slides.length, updated_at: now });
  });

  // ─── Diagram CRUD ────────────────────────────────
  app.post('/api/diagrams', authenticateAgent, (req, res) => {
    const { title = '' } = req.body;
    const agentName = actorName(req) || 'unknown';
    const now = Date.now();
    const id = crypto.randomUUID();
    const defaultData = { cells: [], viewport: { x: 0, y: 0, zoom: 1 } };
    db.prepare(`INSERT INTO diagrams (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, JSON.stringify(defaultData), agentName, agentName, now, now);

    const nodeId = `diagram:${id}`;
    const isoNow = new Date().toISOString();
    const actorId = req.actor?.id || req.agent?.id || null;
    contentItemsUpsert.run(
      nodeId, id, 'diagram', title || '',
      null, req.body.parent_id || null, null,
      agentName, agentName, isoNow, isoNow, null, actorId, Date.now()
    );

    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);

    // Notify human users when agent creates content
    if (isAgentRequest(req)) {
      try {
        const humanActors = db.prepare("SELECT id FROM actors WHERE type = 'human'").all();
        for (const actor of humanActors) {
          const { id: notifId } = insertNotification(db, { genId }, {
            actorId: agentName, targetActorId: actor.id, type: 'content_created',
            titleKey: 'serverNotifications.content_created.title', titleParams: { title: title || '' },
            bodyKey: 'serverNotifications.content_created.body', bodyParams: { agent: agentName, kind: '@:serverNotifications.kinds.diagram', title: title || nodeId },
            link: `/content?id=${nodeId}`, meta: { content_id: nodeId, type: 'diagram' },
          });
          pushHumanEvent(actor.id, { event: 'notification.created', data: { id: notifId, type: 'content_created', content_id: nodeId, title } });
          pushHumanEvent(actor.id, { event: 'content.changed', data: { action: 'created', type: 'diagram', id: nodeId, title } });
        }
      } catch (e) { console.warn('[content] diagram notification failed:', e.message); }
    }

    res.status(201).json({ diagram_id: id, item });
  });

  app.get('/api/diagrams/:id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Diagram not found' });
    let data;
    try { data = JSON.parse(row.data_json); } catch { data = { cells: [], viewport: { x: 0, y: 0, zoom: 1 } }; }
    // Include title from content_items if available
    const contentItem = db.prepare('SELECT title FROM content_items WHERE raw_id = ? AND type = ?').get(row.id, 'diagram');
    res.json({ id: row.id, data, title: contentItem?.title || '', created_by: row.created_by, updated_by: row.updated_by, created_at: row.created_at, updated_at: row.updated_at });
  });

  app.patch('/api/diagrams/:id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Diagram not found' });
    const agentName = actorName(req) || 'unknown';
    const now = Date.now();
    let { data, title } = req.body;

    // Update title in content_items if provided
    if (title !== undefined) {
      const nodeId = `diagram:${req.params.id}`;
      db.prepare('UPDATE content_items SET title = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(title, agentName, new Date().toISOString(), nodeId);
    }

    if (!data) {
      // Title-only update
      if (title !== undefined) return res.json({ saved: true, updated_at: now });
      return res.status(400).json({ error: 'data or title is required' });
    }
    if (data.cells && isAgentRequest(req)) {
      data = { ...data, cells: normalizeDiagramCells(data.cells) };
    }

    if (isAgentRequest(req)) {
      createSnapshot(db, { genId }, {
        contentType: 'diagram',
        contentId: 'diagram:' + req.params.id,
        data: JSON.parse(row.data_json),
        triggerType: 'pre_agent_edit',
        actorId: actorName(req),
        title: null,
      });
    }

    db.prepare('UPDATE diagrams SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    if (isAgentRequest(req)) {
      createSnapshot(db, { genId }, {
        contentType: 'diagram',
        contentId: 'diagram:' + req.params.id,
        data: data,
        triggerType: 'post_agent_edit',
        actorId: actorName(req),
        title: null,
        description: req.body.revision_description || null,
      });
    }

    res.json({ saved: true, updated_at: now });
  });

  // ─── Diagram node/edge mutations ────────────────
  // POST /api/diagrams/:id/nodes — add a node
  app.post('/api/diagrams/:id/nodes', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    let data; try { data = JSON.parse(row.data_json); } catch { data = { cells: [], viewport: { x:0,y:0,zoom:1 } }; }
    if (!Array.isArray(data.cells)) data.cells = [];
    const { id, label, shape = 'rounded-rect', bgColor = '#ffffff', borderColor = '#374151', textColor = '#1f2937', width = 160, height = 60 } = req.body;
    let { x, y } = req.body;
    // Auto-place: if no position given, place below the lowest existing node
    if (x == null || y == null) {
      const existingNodes = data.cells.filter(c => c.shape !== 'edge');
      if (existingNodes.length === 0) {
        x = x ?? 80; y = y ?? 80;
      } else {
        const maxY = Math.max(...existingNodes.map(n => (n.position?.y ?? n.y ?? 0) + (n.size?.height ?? n.height ?? 60)));
        x = x ?? (existingNodes[0].position?.x ?? existingNodes[0].x ?? 80);
        y = y ?? (maxY + 80); // 80px gap below lowest node
      }
    }
    if (!id) return res.status(400).json({ error: 'MISSING_ID', message: 'id is required' });
    if (data.cells.find(c => c.id === id)) return res.status(400).json({ error: 'DUPLICATE_ID', message: `node id ${id} already exists` });
    const node = { id, shape: 'flowchart-node', x, y, width, height, data: { label: label || '', flowchartShape: shape, bgColor, borderColor, textColor, fontSize: 14, fontWeight: 'normal', fontStyle: 'normal' } };
    data.cells.push(node);
    db.prepare('UPDATE diagrams SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), actorName(req) || 'unknown', Date.now(), req.params.id);
    res.status(201).json({ node });
  });

  // PATCH /api/diagrams/:id/nodes/:node_id — update a node
  app.patch('/api/diagrams/:id/nodes/:node_id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    let data; try { data = JSON.parse(row.data_json); } catch { data = { cells: [] }; }
    const idx = (data.cells || []).findIndex(c => c.id === req.params.node_id && c.shape !== 'edge');
    if (idx === -1) return res.status(404).json({ error: 'NODE_NOT_FOUND' });
    const node = data.cells[idx];
    const { label, shape, bgColor, borderColor, textColor, x, y, width, height } = req.body;
    if (label !== undefined) node.data = { ...(node.data || {}), label };
    if (shape !== undefined) node.data = { ...(node.data || {}), flowchartShape: shape };
    if (bgColor !== undefined) node.data = { ...(node.data || {}), bgColor };
    if (borderColor !== undefined) node.data = { ...(node.data || {}), borderColor };
    if (textColor !== undefined) node.data = { ...(node.data || {}), textColor };
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
    if (width !== undefined) node.width = width;
    if (height !== undefined) node.height = height;
    db.prepare('UPDATE diagrams SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), actorName(req) || 'unknown', Date.now(), req.params.id);
    res.json({ node });
  });

  // DELETE /api/diagrams/:id/nodes/:node_id — delete node and its connected edges
  app.delete('/api/diagrams/:id/nodes/:node_id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    let data; try { data = JSON.parse(row.data_json); } catch { data = { cells: [] }; }
    const nodeId = req.params.node_id;
    const before = (data.cells || []).length;
    data.cells = (data.cells || []).filter(c => c.id !== nodeId && !(c.shape === 'edge' && (c.source === nodeId || c.target === nodeId)));
    if (data.cells.length === before) return res.status(404).json({ error: 'NODE_NOT_FOUND' });
    db.prepare('UPDATE diagrams SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), actorName(req) || 'unknown', Date.now(), req.params.id);
    res.json({ deleted: true, remaining_cells: data.cells.length });
  });

  // POST /api/diagrams/:id/edges — add an edge
  app.post('/api/diagrams/:id/edges', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    let data; try { data = JSON.parse(row.data_json); } catch { data = { cells: [] }; }
    const { id, source, target, label } = req.body;
    if (!id || !source || !target) return res.status(400).json({ error: 'MISSING_FIELDS', message: 'id, source, target are required' });
    if (data.cells.find(c => c.id === id)) return res.status(400).json({ error: 'DUPLICATE_ID', message: `edge id ${id} already exists` });
    const edge = { id, shape: 'edge', source, target, ...(label ? { labels: [{ attrs: { label: { text: label } } }] } : {}) };
    data.cells.push(edge);
    db.prepare('UPDATE diagrams SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), actorName(req) || 'unknown', Date.now(), req.params.id);
    res.status(201).json({ edge });
  });

  // PATCH /api/diagrams/:id/edges/:edge_id — update an edge
  app.patch('/api/diagrams/:id/edges/:edge_id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    let data; try { data = JSON.parse(row.data_json); } catch { data = { cells: [] }; }
    const idx = (data.cells || []).findIndex(c => c.id === req.params.edge_id && c.shape === 'edge');
    if (idx === -1) return res.status(404).json({ error: 'EDGE_NOT_FOUND' });
    const edge = data.cells[idx];
    if (req.body.source !== undefined) edge.source = req.body.source;
    if (req.body.target !== undefined) edge.target = req.body.target;
    if (req.body.label !== undefined) edge.labels = [{ attrs: { label: { text: req.body.label } } }];
    db.prepare('UPDATE diagrams SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), actorName(req) || 'unknown', Date.now(), req.params.id);
    res.json({ edge });
  });

  // DELETE /api/diagrams/:id/edges/:edge_id — delete an edge
  app.delete('/api/diagrams/:id/edges/:edge_id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    let data; try { data = JSON.parse(row.data_json); } catch { data = { cells: [] }; }
    const before = (data.cells || []).length;
    data.cells = (data.cells || []).filter(c => c.id !== req.params.edge_id);
    if (data.cells.length === before) return res.status(404).json({ error: 'EDGE_NOT_FOUND' });
    db.prepare('UPDATE diagrams SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), actorName(req) || 'unknown', Date.now(), req.params.id);
    res.json({ deleted: true });
  });

  // ─── Canvas CRUD ─────────────────────────────────
  app.post('/api/canvases', authenticateAgent, (req, res) => {
    const { title = '' } = req.body;
    const id = crypto.randomUUID();
    const now = Date.now();
    const agentName = actorName(req);
    const firstPageId = crypto.randomUUID();
    const defaultData = JSON.stringify({
      pages: [{
        page_id: firstPageId,
        title: 'Page 1',
        width: req.body.width || 1920,
        height: req.body.height || 1080,
        head_html: '',
        elements: [],
      }],
    });

    db.prepare(`INSERT INTO canvases (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

    const nodeId = `canvas:${id}`;
    const isoNow = new Date().toISOString();
    const canvasActorId = req.actor?.id || req.agent?.id || null;
    contentItemsUpsert.run(
      nodeId, id, 'canvas', title || '',
      null, req.body.parent_id || null, null,
      agentName, agentName, isoNow, isoNow, null, canvasActorId, Date.now()
    );

    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);

    if (isAgentRequest(req)) {
      try {
        const humanActors = db.prepare("SELECT id FROM actors WHERE type = 'human'").all();
        for (const actor of humanActors) {
          const { id: notifId } = insertNotification(db, { genId }, {
            actorId: agentName, targetActorId: actor.id, type: 'content_created',
            titleKey: 'serverNotifications.content_created.title', titleParams: { title: title || '' },
            bodyKey: 'serverNotifications.content_created.body', bodyParams: { agent: agentName, kind: '@:serverNotifications.kinds.canvas', title: title || nodeId },
            link: `/content?id=${nodeId}`, meta: { content_id: nodeId, type: 'canvas' },
          });
          pushHumanEvent(actor.id, { event: 'notification.created', data: { id: notifId, type: 'content_created', content_id: nodeId, title } });
          pushHumanEvent(actor.id, { event: 'content.changed', data: { action: 'created', type: 'canvas', id: nodeId, title } });
        }
      } catch (e) { console.warn('[content] canvas notification failed:', e.message); }
    }

    res.status(201).json({ canvas_id: id, item });
  });

  app.get('/api/canvases/:id', authenticateAgent, (req, res) => {
    const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(req.params.id);
    if (!canvas) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(canvas.data_json);
    res.json({
      id: canvas.id,
      data,
      created_by: canvas.created_by,
      updated_by: canvas.updated_by,
      created_at: canvas.created_at,
      updated_at: canvas.updated_at,
    });
  });

  app.patch('/api/canvases/:id', authenticateAgent, (req, res) => {
    const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(req.params.id);
    if (!canvas) return res.status(404).json({ error: 'NOT_FOUND' });

    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'MISSING_DATA' });

    if (isAgentRequest(req)) {
      createSnapshot(db, { genId }, {
        contentType: 'canvas',
        contentId: 'canvas:' + req.params.id,
        data: JSON.parse(canvas.data_json),
        triggerType: 'pre_agent_edit',
        actorId: actorName(req),
        title: null,
      });
    }

    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE canvases SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    if (isAgentRequest(req)) {
      createSnapshot(db, { genId }, {
        contentType: 'canvas',
        contentId: 'canvas:' + req.params.id,
        data: data,
        triggerType: 'post_agent_edit',
        actorId: actorName(req),
        title: null,
        description: req.body.revision_description || null,
      });
    }

    res.json({ saved: true, updated_at: now });
  });

  // ─── Videos ─────────────────────────────────────
  app.post('/api/videos', authenticateAgent, (req, res) => {
    const { title = '' } = req.body;
    const id = crypto.randomUUID();
    const now = Date.now();
    const agentName = actorName(req);
    const defaultData = JSON.stringify({
      scenes: [{
        scene_id: crypto.randomUUID(),
        title: 'Scene 1',
        duration: 5,
        elements: [],
      }],
      settings: {
        width: req.body.width || 1920,
        height: req.body.height || 1080,
        fps: 30,
        duration: 10,
      },
    });

    db.prepare(`INSERT INTO videos (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

    const nodeId = `video:${id}`;
    const isoNow = new Date().toISOString();
    const videoActorId = req.actor?.id || req.agent?.id || null;
    contentItemsUpsert.run(
      nodeId, id, 'video', title || '',
      null, req.body.parent_id || null, null,
      agentName, agentName, isoNow, isoNow, null, videoActorId, Date.now()
    );

    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);

    if (isAgentRequest(req)) {
      try {
        const humanActors = db.prepare("SELECT id FROM actors WHERE type = 'human'").all();
        for (const actor of humanActors) {
          const { id: notifId } = insertNotification(db, { genId }, {
            actorId: agentName, targetActorId: actor.id, type: 'content_created',
            titleKey: 'serverNotifications.content_created.title', titleParams: { title: title || '' },
            bodyKey: 'serverNotifications.content_created.body', bodyParams: { agent: agentName, kind: '@:serverNotifications.kinds.video', title: title || nodeId },
            link: `/content?id=${nodeId}`, meta: { content_id: nodeId, type: 'video' },
          });
          pushHumanEvent(actor.id, { event: 'notification.created', data: { id: notifId, type: 'content_created', content_id: nodeId, title } });
          pushHumanEvent(actor.id, { event: 'content.changed', data: { action: 'created', type: 'video', id: nodeId, title } });
        }
      } catch (e) { console.warn('[content] video notification failed:', e.message); }
    }

    res.status(201).json({ video_id: id, item });
  });

  app.get('/api/videos/:id', authenticateAgent, (req, res) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
    if (!video) return res.status(404).json({ error: 'NOT_FOUND' });
    const data = JSON.parse(video.data_json);
    res.json({
      id: video.id,
      data,
      created_by: video.created_by,
      updated_by: video.updated_by,
      created_at: video.created_at,
      updated_at: video.updated_at,
    });
  });

  app.patch('/api/videos/:id', authenticateAgent, (req, res) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
    if (!video) return res.status(404).json({ error: 'NOT_FOUND' });

    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'MISSING_DATA' });

    if (isAgentRequest(req)) {
      createSnapshot(db, { genId }, {
        contentType: 'video',
        contentId: 'video:' + req.params.id,
        data: JSON.parse(video.data_json),
        triggerType: 'pre_agent_edit',
        actorId: actorName(req),
        title: null,
      });
    }

    const now = Date.now();
    const agentName = actorName(req);
    db.prepare('UPDATE videos SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), agentName, now, req.params.id);

    if (isAgentRequest(req)) {
      createSnapshot(db, { genId }, {
        contentType: 'video',
        contentId: 'video:' + req.params.id,
        data: data,
        triggerType: 'post_agent_edit',
        actorId: actorName(req),
        title: null,
        description: req.body.revision_description || null,
      });
    }

    res.json({ saved: true, updated_at: now });
  });

  // ─── Content Items ─────────────────────────────
  app.get('/api/content-items', authenticateAgent, (req, res) => {
    if (req.query.deleted === 'true') {
      const rows = db.prepare('SELECT * FROM content_items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
      return res.json({ items: rows });
    }
    const actorId = req.actor?.id || req.agent?.id || null;
    const rows = db.prepare(`
      SELECT ci.*,
        COALESCE(cc.unresolved_count, 0) AS unresolved_comment_count,
        CASE WHEN cp.content_id IS NOT NULL THEN 1 ELSE 0 END AS pinned_relation
      FROM content_items ci
      LEFT JOIN (
        SELECT target_id, COUNT(*) AS unresolved_count
        FROM comments
        WHERE resolved_at IS NULL AND parent_id IS NULL
        GROUP BY target_id
      ) cc ON cc.target_id = ci.id
      LEFT JOIN content_pins cp ON cp.content_id = ci.id AND cp.actor_id = ?
      WHERE ci.deleted_at IS NULL
      ORDER BY ci.sort_order ASC, ci.created_at ASC
    `).all(actorId);
    const mappedRows = rows.map(r => ({ ...r, pinned: r.pinned_relation === 1 }));
    res.json({ items: mappedRows });
  });

  app.get('/api/content-items/:id', authenticateAgent, (req, res) => {
    const row = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND', message: 'Content item not found' });
    res.json({ item: row });
  });

  app.post('/api/content-items', authenticateAgent, async (req, res) => {
    const { type, title = '', parent_id = null, collection_id, columns } = req.body;
    if (!type || !['doc', 'table', 'board', 'presentation', 'spreadsheet', 'diagram', 'canvas', 'video'].includes(type)) {
      return res.status(400).json({ error: 'INVALID_TYPE', message: 'type must be "doc", "table", "board", "presentation", "spreadsheet", "diagram", "canvas", or "video"' });
    }

    const now = new Date().toISOString();
    const agentName = actorName(req);
    const actorId = req.actor?.id || req.agent?.id || null;

    /** Notify human users and trigger file tree refresh when agent creates content */
    function notifyContentCreated(contentId, contentTitle) {
      if (!isAgentRequest(req)) return;
      try {
        // Notify all human actors
        const humanActors = db.prepare("SELECT id FROM actors WHERE type = 'human'").all();
        const titleStr = contentTitle || contentId;
        for (const actor of humanActors) {
          const { id: notifId } = insertNotification(db, { genId }, {
            actorId: agentName,
            targetActorId: actor.id,
            type: 'content_created',
            titleKey: 'serverNotifications.content_created.title',
            titleParams: { title: contentTitle || '' },
            bodyKey: 'serverNotifications.content_created.body',
            bodyParams: { agent: agentName, kind: `@:serverNotifications.kinds.${type}`, title: titleStr },
            link: `/content?id=${contentId}`,
            meta: { content_id: contentId, type },
          });
          pushHumanEvent(actor.id, { event: 'notification.created', data: { id: notifId, type: 'content_created', content_id: contentId, title: contentTitle } });
          pushHumanEvent(actor.id, { event: 'content.changed', data: { action: 'created', type, id: contentId, title: contentTitle } });
        }
      } catch (e) { console.warn('[content] notification failed:', e.message); }
    }

    if (type === 'doc') {
      const docId = genId('doc');
      db.prepare(`INSERT INTO documents (id, title, text, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(docId, title || '', '', agentName, agentName, now, now);

      const nodeId = `doc:${docId}`;
      contentItemsUpsert.run(
        nodeId, docId, 'doc', title || '',
        null, parent_id, collection_id || null,
        agentName, agentName, now, now, null, actorId, Date.now()
      );
      // Initial version snapshot only for agent-created docs (human-created start empty)
      if (isAgentRequest(req)) {
        createSnapshot(db, { genId }, {
          contentType: 'doc', contentId: docId,
          data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] },
          triggerType: 'auto', actorId: agentName, title: title || '',
        });
      }
      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      notifyContentCreated(nodeId, title);
      return res.status(201).json({ item });
    }

    if (type === 'table') {
      const tableTitle = title || 'Untitled';

      // Build initial column list for tableEngine.createTable.
      const tableCols = columns && columns.length ? columns : [{ title: 'Notes', uidt: 'LongText' }];
      const initialColumns = [];
      for (const col of tableCols) {
        const colTitle = col.title || col.column_name;
        if (!colTitle) continue;
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

      let t;
      try {
        t = tableEngine.createTable({ title: tableTitle, created_by: agentName, columns: initialColumns });
      } catch (e) {
        if (e.code === 'VALIDATION_ERROR') return res.status(400).json({ error: 'VALIDATION_ERROR', detail: e.message });
        console.error('[gateway] create table failed:', e);
        return res.status(500).json({ error: 'INTERNAL_ERROR', detail: e.message });
      }

      // Seed select options for SingleSelect/MultiSelect fields.
      const createdFields = tableEngine.listFields(t.id);
      const fieldByTitle = new Map(createdFields.map(f => [f.title, f]));
      for (const col of tableCols) {
        const colTitle = col.title || col.column_name;
        if (!colTitle) continue;
        const f = fieldByTitle.get(colTitle);
        if (!f) continue;
        if ((f.uidt === 'SingleSelect' || f.uidt === 'MultiSelect') && Array.isArray(col.options)) {
          for (const o of col.options) {
            const optTitle = typeof o === 'string' ? o : (o.title || o.value || '');
            if (!optTitle) continue;
            tableEngine.addOption(f.id, { value: optTitle, color: o.color || '#d4e5ff' });
          }
        }
      }

      // Default Grid view.
      try {
        tableEngine.view.create({ table_id: t.id, title: 'Grid', view_type: 'grid', is_default: 1 });
      } catch (e) { console.error('[gateway] default view create failed:', e.message); }

      const fields = tableEngine.listFields(t.id);
      const responseCols = fields.map(f => ({
        column_id: f.id,
        title: f.title,
        type: f.uidt,
        primary_key: !!f.is_primary,
      }));

      const tableId = t.id;
      const nodeId = `table:${tableId}`;
      contentItemsUpsert.run(
        nodeId, tableId, 'table', tableTitle,
        null, parent_id, null,
        agentName, agentName,
        now, now, null, actorId, Date.now()
      );

      // Initial version snapshot only for agent-created tables (human-created start empty).
      if (isAgentRequest(req)) {
        const schemaJson = JSON.stringify(fields.map(f => ({
          id: f.id, title: f.title, uidt: f.uidt, pk: !!f.is_primary, rqd: false,
        })));
        const initSnapId = genId('snap');
        db.prepare(
          "INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, description, row_count, actor_id, created_at) VALUES (?, 'table', ?, 1, NULL, '[]', ?, 'auto', NULL, 0, ?, ?)"
        ).run(initSnapId, tableId, schemaJson, agentName, now);
      }

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      notifyContentCreated(nodeId, tableTitle);
      return res.status(201).json({ item, table_id: tableId, columns: responseCols });
    }

    if (type === 'board') {
      const id = crypto.randomUUID();
      const nowTs = Date.now();
      const isoNow = new Date().toISOString();
      const defaultData = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'aose',
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
        agentName, agentName, isoNow, isoNow, null, actorId, Date.now()
      );

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      notifyContentCreated(nodeId, title);
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
        agentName, agentName, isoNow, isoNow, null, actorId, Date.now()
      );
      // Initial version snapshot only for agent-created presentations
      if (isAgentRequest(req)) {
        createSnapshot(db, { genId }, {
          contentType: 'presentation', contentId: nodeId,
          data: { slides: [] },
          triggerType: 'auto', actorId: agentName, title: title || '',
        });
      }

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      notifyContentCreated(nodeId, title);
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
        agentName, agentName, isoNow, isoNow, null, actorId, Date.now()
      );

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      notifyContentCreated(nodeId, title);
      return res.status(201).json({ item });
    }

    if (type === 'diagram') {
      const id = crypto.randomUUID();
      const nowTs = Date.now();
      const isoNow = new Date().toISOString();
      const defaultData = JSON.stringify({ cells: [], viewport: { x: 0, y: 0, zoom: 1 } });

      db.prepare(`INSERT INTO diagrams (id, data_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, nowTs, nowTs);

      // Embedded diagrams (created from PPT/Doc) don't get a content_items entry
      const nodeId = `diagram:${id}`;
      if (!req.body.embedded) {
        contentItemsUpsert.run(
          nodeId, id, 'diagram', title || '',
          null, parent_id, null,
          agentName, agentName, isoNow, isoNow, null, actorId, Date.now()
        );
      }
      // Initial version snapshot only for agent-created diagrams
      if (isAgentRequest(req)) {
        createSnapshot(db, { genId }, {
          contentType: 'diagram', contentId: nodeId,
          data: { cells: [], viewport: { x: 0, y: 0, zoom: 1 } },
          triggerType: 'auto', actorId: agentName, title: title || '',
        });
      }

      // Return a synthetic item with raw_id for embedded use
      const item = req.body.embedded
        ? { id: nodeId, raw_id: id, type: 'diagram', title: title || '' }
        : db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      if (!req.body.embedded) notifyContentCreated(nodeId, title);
      return res.status(201).json({ item });
    }

    if (type === 'canvas') {
      const id = crypto.randomUUID();
      const nowTs = Date.now();
      const isoNow = new Date().toISOString();
      const firstPageId = crypto.randomUUID();
      const defaultData = JSON.stringify({
        pages: [{
          page_id: firstPageId, title: 'Page 1',
          width: 1920, height: 1080, head_html: '', elements: [],
        }],
      });

      db.prepare(`INSERT INTO canvases (id, data_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, nowTs, nowTs);

      const nodeId = `canvas:${id}`;
      contentItemsUpsert.run(
        nodeId, id, 'canvas', title || '',
        null, parent_id, null,
        agentName, agentName, isoNow, isoNow, null, actorId, Date.now()
      );

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      notifyContentCreated(nodeId, title);
      return res.status(201).json({ item });
    }

    if (type === 'video') {
      const id = crypto.randomUUID();
      const nowTs = Date.now();
      const isoNow = new Date().toISOString();
      const defaultData = JSON.stringify({
        elements: [],
        settings: { width: 1920, height: 1080, fps: 30, background_color: '#000000' },
      });

      db.prepare(`INSERT INTO videos (id, data_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, nowTs, nowTs);

      const nodeId = `video:${id}`;
      contentItemsUpsert.run(
        nodeId, id, 'video', title || '',
        null, parent_id, null,
        agentName, agentName, isoNow, isoNow, null, actorId, Date.now()
      );

      const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
      notifyContentCreated(nodeId, title);
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
    } else if (item.type === 'canvas') {
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
    } else if (item.type === 'video') {
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
    } else if (item.type === 'page') {
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
      try { tableEngine.dropTable(item.raw_id); } catch (e) {
        if (e.code !== 'NOT_FOUND') console.error('[gateway] dropTable failed:', e.message);
      }
    } else if (item.type === 'board') {
      db.prepare('DELETE FROM boards WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'presentation') {
      db.prepare('DELETE FROM presentations WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'spreadsheet') {
      db.prepare('DELETE FROM spreadsheets WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'diagram') {
      db.prepare('DELETE FROM diagrams WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'canvas') {
      db.prepare('DELETE FROM canvases WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'video') {
      db.prepare('DELETE FROM videos WHERE id = ?').run(item.raw_id);
    } else if (item.type === 'page') {
      db.prepare('DELETE FROM pages WHERE id = ?').run(item.raw_id);
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

  // ── Pin relation endpoints ──────────────────────────────
  app.get('/api/content-pins', authenticateAny, (req, res) => {
    const actorId = req.actor?.id || req.agent?.id;
    if (!actorId) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const rows = db.prepare('SELECT content_id FROM content_pins WHERE actor_id = ?').all(actorId);
    res.json({ pinned_ids: rows.map(r => r.content_id) });
  });

  app.post('/api/content-pins/:contentId', authenticateAny, (req, res) => {
    const actorId = req.actor?.id || req.agent?.id;
    if (!actorId) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const contentId = decodeURIComponent(req.params.contentId);
    const exists = db.prepare('SELECT id FROM content_items WHERE id = ?').get(contentId);
    if (!exists) return res.status(404).json({ error: 'NOT_FOUND' });
    const pinId = genId('pin');
    try {
      db.prepare('INSERT OR IGNORE INTO content_pins (id, actor_id, content_id, created_at) VALUES (?, ?, ?, ?)')
        .run(pinId, actorId, contentId, Date.now());
    } catch { /* ignore dup */ }
    res.json({ ok: true });
  });

  app.delete('/api/content-pins/:contentId', authenticateAny, (req, res) => {
    const actorId = req.actor?.id || req.agent?.id;
    if (!actorId) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const contentId = decodeURIComponent(req.params.contentId);
    db.prepare('DELETE FROM content_pins WHERE actor_id = ? AND content_id = ?').run(actorId, contentId);
    res.json({ ok: true });
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
  function formatContentComment(r) {
    return formatUnifiedCommentRow(r);
  }

  // Normalize a caller-supplied content id to the canonical prefixed form
  // (`doc:doc_xxx`, `table:tbl_xxx`, ...). Frontend always passes the
  // prefixed form; MCP tools document the bare form (`doc_xxx`). Both must
  // resolve to the same (target_type, target_id) pair, otherwise MCP writes
  // land under a second key and the UI never shows them.
  function normalizeContentTarget(rawId) {
    const colonIdx = rawId.indexOf(':');
    if (colonIdx > 0) {
      return { targetType: rawId.substring(0, colonIdx), targetId: rawId };
    }
    const item = db.prepare('SELECT type FROM content_items WHERE id = ?').get(rawId);
    if (!item) return null;
    return { targetType: item.type, targetId: `${item.type}:${rawId}` };
  }

  app.get('/api/content-items/:id/comments', authenticateAgent, (req, res) => {
    const rawId = decodeURIComponent(req.params.id);
    const normalized = normalizeContentTarget(rawId);
    if (!normalized) return res.status(404).json({ error: 'NOT_FOUND', message: 'content item not found' });
    const { anchor_type, anchor_id } = req.query;
    const comments = listUnifiedComments(db, normalized.targetId, {
      anchorType: anchor_type || undefined,
      anchorId: anchor_id || undefined,
    });
    res.json({ comments });
  });

  app.post('/api/content-items/:id/comments', authenticateAgent, (req, res) => {
    const rawId = decodeURIComponent(req.params.id);
    const { text, parent_comment_id, anchor_type, anchor_id, anchor_meta } = req.body;
    if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

    const normalized = normalizeContentTarget(rawId);
    if (!normalized) return res.status(404).json({ error: 'NOT_FOUND', message: 'content item not found' });
    const { targetType, targetId } = normalized;
    const displayName = actorName(req);
    const actorId = req.actor?.id || req.agent?.id;

    const created = createUnifiedComment(db, {
      genId,
      pushEvent,
      pushHumanEvent,
      humanClients,
      deliverWebhook,
    }, {
      targetType,
      targetId,
      text,
      parentId: parent_comment_id || null,
      anchorType: anchor_type || null,
      anchorId: anchor_id || null,
      anchorMeta: anchor_meta || null,
      actorId,
      actorName: displayName,
      idPrefix: 'ccmt',
    });

    res.status(201).json(created);
  });

  app.patch('/api/content-comments/:commentId', authenticateAgent, (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

    const updated = updateUnifiedCommentText(db, { humanClients, pushHumanEvent }, req.params.commentId, text);
    if (!updated) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ updated: true });
  });

  app.delete('/api/content-comments/:commentId', authenticateAgent, (req, res) => {
    const deleted = deleteUnifiedComment(db, { humanClients, pushHumanEvent }, req.params.commentId);
    if (!deleted) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ deleted: true });
  });

  app.post('/api/content-comments/:commentId/resolve', authenticateAgent, (req, res) => {
    const displayName = actorName(req);
    const actId = req.actor?.id || req.agent?.id;
    const updated = setUnifiedCommentResolved(db, {
      genId,
      pushEvent,
      pushHumanEvent,
      humanClients,
      deliverWebhook,
    }, req.params.commentId, true, actId, displayName);
    if (!updated) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ resolved: true });
  });

  app.post('/api/content-comments/:commentId/unresolve', authenticateAgent, (req, res) => {
    const displayName = actorName(req);
    const actId = req.actor?.id || req.agent?.id;
    const updated = setUnifiedCommentResolved(db, {
      genId,
      pushEvent,
      pushHumanEvent,
      humanClients,
      deliverWebhook,
    }, req.params.commentId, false, actId, displayName);
    if (!updated) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ unresolved: true });
  });

  // ─── Content Revisions (Generic — via unified content_snapshots) ─────────────────
  app.get('/api/content-items/:id/revisions', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    // Snapshots may store content_id as either prefixed ("presentation:uuid") or bare ("uuid"/"621").
    // Query all possible forms to handle inconsistencies.
    const ids = new Set([contentId]);
    if (contentId.includes(':')) {
      // Also try bare ID (e.g. "table:621" → "621", "doc:doc_xxx" → "doc_xxx")
      ids.add(contentId.split(':').slice(1).join(':'));
    } else {
      // Also try prefixed form
      const ci = db.prepare('SELECT type FROM content_items WHERE raw_id = ? LIMIT 1').get(contentId);
      if (ci) ids.add(`${ci.type}:${contentId}`);
    }
    const idArray = [...ids];
    const placeholders = idArray.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM content_snapshots WHERE content_id IN (${placeholders}) ORDER BY created_at DESC`
    ).all(...idArray);
    const revisions = rows.map(r => ({
      id: r.id,
      content_id: r.content_id,
      trigger_type: r.trigger_type || null,
      description: r.description || null,
      data: (() => { try { return JSON.parse(r.data_json); } catch { return null; } })(),
      created_at: r.created_at,
      created_by: r.actor_id,
    }));
    res.json({ revisions });
  });

  app.post('/api/content-items/:id/revisions', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    const { data, trigger_type, description } = req.body;
    if (!data) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'data required' });

    const displayName = actorName(req);
    const effectiveTriggerType = trigger_type || 'auto';
    const contentType = contentId.includes(':') ? contentId.split(':')[0] : 'unknown';

    // Daily granularity: auto type keeps only one per day — delete ALL existing (not LIMIT 1) to prevent accumulation from concurrent saves
    if (effectiveTriggerType === 'auto') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      db.prepare(`
        DELETE FROM content_snapshots
        WHERE content_id = ? AND trigger_type = 'auto' AND created_at >= ?
      `).run(contentId, todayStart.toISOString());
    }

    const id = genId('snap');
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, description, row_count, actor_id, created_at)
      VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL, ?, ?)`)
      .run(id, contentType, contentId, JSON.stringify(data), effectiveTriggerType, description || null, displayName, now);

    res.status(201).json({ id, content_id: contentId, trigger_type: effectiveTriggerType, created_at: now, created_by: displayName });
  });

  // POST /api/content-items/:id/revisions/manual — server-side manual snapshot (reads current data from DB)
  app.post('/api/content-items/:id/revisions/manual', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    const { description } = req.body;
    const displayName = actorName(req);

    // Determine content type and raw ID
    const colonIdx = contentId.indexOf(':');
    const type = colonIdx > 0 ? contentId.substring(0, colonIdx) : '';
    const rawId = colonIdx > 0 ? contentId.substring(colonIdx + 1) : contentId;

    let dataObj = null;
    let title = null;

    if (type === 'presentation') {
      const row = db.prepare('SELECT data_json FROM presentations WHERE id = ?').get(rawId);
      if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
      try { dataObj = JSON.parse(row.data_json); } catch { dataObj = {}; }
    } else if (type === 'diagram') {
      const row = db.prepare('SELECT data_json FROM diagrams WHERE id = ?').get(rawId);
      if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
      try { dataObj = JSON.parse(row.data_json); } catch { dataObj = {}; }
    } else if (type === 'doc') {
      const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(rawId);
      if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });
      dataObj = doc.data_json ? JSON.parse(doc.data_json)
        : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text || '' }] }] };
      title = doc.title;
    } else {
      return res.status(400).json({ error: 'UNSUPPORTED_TYPE', message: `Cannot create manual snapshot for type: ${type}` });
    }

    const ci = db.prepare('SELECT title FROM content_items WHERE id = ? OR (raw_id = ? AND type = ?)').get(contentId, rawId, type);
    if (!title) title = ci?.title || null;

    // Create the manual snapshot with current time
    const now = new Date();
    const manualTime = now.toISOString();
    const snapId = genId('snap');
    const dataJsonStr = JSON.stringify(dataObj);
    db.prepare(`
      INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, description, row_count, actor_id, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, NULL, ?, ?)
    `).run(snapId, type, contentId, title || null, dataJsonStr, 'manual', description || null, displayName, manualTime);

    res.status(201).json({ id: snapId, trigger_type: 'manual', created_at: manualTime });
  });

  app.post('/api/content-items/:id/revisions/:revId/restore', authenticateAgent, (req, res) => {
    const contentId = decodeURIComponent(req.params.id);
    // Snapshots may store content_id as either prefixed or bare — query all forms
    const ids = new Set([contentId]);
    if (contentId.includes(':')) {
      ids.add(contentId.split(':').slice(1).join(':'));
    } else {
      const ci = db.prepare('SELECT type FROM content_items WHERE raw_id = ? LIMIT 1').get(contentId);
      if (ci) ids.add(`${ci.type}:${contentId}`);
    }
    const idArray = [...ids];
    const placeholders = idArray.map(() => '?').join(',');
    const revision = db.prepare(
      `SELECT * FROM content_snapshots WHERE id = ? AND content_id IN (${placeholders})`
    ).get(req.params.revId, ...idArray);
    if (!revision) return res.status(404).json({ error: 'REVISION_NOT_FOUND' });

    // ── Determine content type and raw ID ──
    const type = revision.content_type || (contentId.includes(':') ? contentId.split(':')[0] : '');
    const rawId = contentId.includes(':') ? contentId.split(':').slice(1).join(':') : contentId;
    const tableName = type === 'presentation' ? 'presentations' : type === 'diagram' ? 'diagrams' : null;

    if (tableName) {
      const current = db.prepare(`SELECT data_json FROM ${tableName} WHERE id = ?`).get(rawId);
      if (current?.data_json) {
        try {
          createSnapshot(db, { genId }, {
            contentType: type,
            contentId: revision.content_id,
            data: JSON.parse(current.data_json),
            triggerType: 'pre_restore',
            actorId: actorName(req),
            title: null,
            });
        } catch { /* non-fatal */ }
      }
      let data;
      try { data = JSON.parse(revision.data_json); } catch { return res.status(500).json({ error: 'INVALID_REVISION_DATA' }); }
      // Write restored data back to the source table
      const now = Date.now();
      db.prepare(`UPDATE ${tableName} SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
        .run(revision.data_json, actorName(req), now, rawId);
      return res.json({ data, revision_id: revision.id, created_at: revision.created_at });
    }

    // ── Doc: use shared restore helper ──
    if (revision.content_type === 'doc') {
      const result = restoreDocFromSnapshot(db, { genId }, {
        docId: rawId,
        revision,
        actorName: actorName(req),
      });
      if (!result) return res.status(404).json({ error: 'DOC_NOT_FOUND' });
      return res.json({ data: result.data, revision_id: revision.id, created_at: revision.created_at, document: result.document });
    }

    // ── Fallback: return data ──
    let data;
    try { data = JSON.parse(revision.data_json); } catch { return res.status(500).json({ error: 'INVALID_REVISION_DATA' }); }
    res.json({ data, revision_id: revision.id, created_at: revision.created_at });
  });
}
