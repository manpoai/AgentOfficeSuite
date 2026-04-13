/**
 * Document routes: /api/docs/*, /api/documents/*, /api/comments, document comments/revisions
 */
import { createUnifiedComment } from '../lib/comment-service.js';
import { createSnapshot, isAgentRequest } from '../lib/snapshot-helper.js';
import { insertNotification } from '../lib/notifications.js';
import { restoreDocFromSnapshot, extractTextFromProseMirror } from '../lib/doc-restore-helper.js';

// Get display name for the authenticated actor (human or agent)
function actorName(req) {
  return req.actor?.display_name || req.actor?.username || req.agent?.name || null;
}

export default function docsRoutes(app, { db, authenticateAgent, genId, contentItemsUpsert, pushEvent, pushHumanEvent, humanClients, deliverWebhook }) {

  // extractTextFromProseMirror imported from ../lib/doc-restore-helper.js

  function formatDocComment(r) {
    let pmData = null;
    try { pmData = JSON.parse(r.data_json); } catch { /* ignore */ }
    // Strip 'doc:' prefix for legacy documentId field (frontend expects raw ID)
    const docId = r.target_id.startsWith('doc:') ? r.target_id.slice(4) : r.target_id;
    const actorName = r.latest_name || r.actor || '';
    return {
      id: r.id,
      documentId: docId,
      parentCommentId: r.parent_id || null,
      data: pmData,
      createdById: r.actor_id || '',
      createdBy: { id: r.actor_id || '', name: actorName, avatar_url: r.actor_avatar_url || null, platform: r.actor_platform || null },
      resolvedById: r.resolved_by || null,
      resolvedBy: r.resolved_by ? { id: r.resolved_by, name: r.resolved_by } : null,
      resolvedAt: r.resolved_at || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      actor_avatar_url: r.actor_avatar_url || null,
      actor_platform: r.actor_platform || null,
      context_payload: r.context_payload ? (() => { try { return JSON.parse(r.context_payload); } catch { return null; } })() : null,
    };
  }

  // ─── Docs (local SQLite) ────────────────────────
  app.post('/api/docs', authenticateAgent, (req, res) => {
    const { title, content_markdown, parent_id, collection_id, data_json } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
    }
    const now = new Date().toISOString();
    const agentName = actorName(req);
    const docId = genId('doc');

    db.prepare(`INSERT INTO documents (id, title, text, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(docId, title, content_markdown || '', agentName, agentName, now, now);

    const nodeId = `doc:${docId}`;
    const actorId = req.actor?.id || req.agent?.id || null;
    contentItemsUpsert.run(
      nodeId, docId, 'doc', title,
      null, parent_id || null, collection_id || null,
      agentName, agentName, now, now, null, actorId, Date.now()
    );

    // Create initial version snapshot only for agent-created docs (human-created docs start empty)
    if (isAgentRequest(req)) {
      const initData = data_json
        ? (typeof data_json === 'string' ? JSON.parse(data_json) : data_json)
        : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content_markdown || '' }] }] };
      createSnapshot(db, { genId }, {
        contentType: 'doc',
        contentId: docId,
        data: initData,
        triggerType: 'auto',
        actorId: agentName,
        title,
      });

      // Notify human users
      const humanActors = db.prepare("SELECT id FROM actors WHERE type = 'human'").all();
      const titleStr = title || docId;
      for (const actor of humanActors) {
        const { id: notifId } = insertNotification(db, { genId }, {
          actorId: agentName,
          targetActorId: actor.id,
          type: 'doc_created',
          titleKey: 'serverNotifications.doc_created.title',
          titleParams: { title: title || '' },
          bodyKey: 'serverNotifications.doc_created.body',
          bodyParams: { agent: agentName, title: titleStr },
          link: `/content?id=doc:${docId}`,
          meta: { doc_id: docId },
        });
        pushHumanEvent(actor.id, { event: 'notification.created', data: { id: notifId, type: 'doc_created', doc_id: docId, title } });
        pushHumanEvent(actor.id, { event: 'content.changed', data: { action: 'created', type: 'doc', id: docId, title } });
      }
    }

    res.status(201).json({
      doc_id: docId,
      created_at: new Date(now).getTime(),
    });
  });

  app.patch('/api/docs/:doc_id', authenticateAgent, (req, res) => {
    const { title, content_markdown } = req.body;
    const now = new Date().toISOString();
    const agentName = actorName(req);

    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(req.params.doc_id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

    const updates = ['updated_at = ?', 'updated_by = ?'];
    const params = [now, agentName];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (content_markdown !== undefined) { updates.push('text = ?'); params.push(content_markdown); }
    params.push(req.params.doc_id);

    // Agent edit: create pre/post snapshots when content changes
    if (content_markdown !== undefined && content_markdown !== doc.text && isAgentRequest(req)) {
      const preData = doc.data_json
        ? JSON.parse(doc.data_json)
        : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text || '' }] }] };
      createSnapshot(db, { genId }, {
        contentType: 'doc',
        contentId: req.params.doc_id,
        data: preData,
        triggerType: 'pre_agent_edit',
        actorId: doc.updated_by || doc.created_by,
        title: doc.title,
      });
    }

    db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Post-edit snapshot
    if (content_markdown !== undefined && content_markdown !== doc.text && isAgentRequest(req)) {
      const postData = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content_markdown }] }] };
      createSnapshot(db, { genId }, {
        contentType: 'doc',
        contentId: req.params.doc_id,
        data: postData,
        triggerType: 'post_agent_edit',
        actorId: agentName,
        title: title || doc.title,
        description: req.body.revision_description || null,
      });
    }

    // Sync title change to content_items
    if (title !== undefined) {
      db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
        .run(title, now, req.params.doc_id, 'doc');
    }

    res.json({ doc_id: req.params.doc_id, updated_at: new Date(now).getTime() });
  });

  // ─── Agent-facing comment endpoints ─────────────────────────────────────────

  // POST /api/comments — agent posts a comment on a document (plain text → ProseMirror)
  app.post('/api/comments', authenticateAgent, (req, res) => {
    const { doc_id, text, parent_comment_id } = req.body;
    if (!doc_id || !text) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'doc_id and text required' });
    }

    const doc = db.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL').get(doc_id);
    if (!doc) return res.status(404).json({ error: 'DOC_NOT_FOUND' });

    const displayName = actorName(req);
    const actId = req.actor?.id || req.agent?.id;
    const unifiedDocId = doc_id.startsWith('doc:') ? doc_id : `doc:${doc_id}`;

    // Convert plain text to minimal ProseMirror JSON
    const pmData = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };

    const created = createUnifiedComment(db, {
      genId, pushEvent, pushHumanEvent, humanClients, deliverWebhook,
    }, {
      targetType: 'doc',
      targetId: unifiedDocId,
      text,
      parentId: parent_comment_id || null,
      actorId: actId,
      actorName: displayName,
      idPrefix: 'cmt',
      dataJson: pmData,
    });

    res.status(201).json({
      comment_id: created.id,
      doc_id,
      parent_comment_id: parent_comment_id || null,
      actor: displayName,
      actor_id: actId,
      created_at: new Date(created.created_at).getTime(),
    });
  });

  // GET /api/docs/:doc_id/comments — list comments for a document (agent-facing, simplified)
  app.get('/api/docs/:doc_id/comments', authenticateAgent, (req, res) => {
    const rawId = req.params.doc_id;
    const unifiedId = rawId.startsWith('doc:') ? rawId : `doc:${rawId}`;
    const rows = db.prepare(
      "SELECT c.*, a.display_name AS latest_name, a.avatar_url AS actor_avatar_url, a.platform AS actor_platform FROM comments c LEFT JOIN actors a ON a.id = c.actor_id WHERE c.target_type = 'doc' AND c.target_id = ? ORDER BY c.created_at ASC"
    ).all(unifiedId);

    const comments = rows.map(r => {
      let pmData = null;
      try { pmData = JSON.parse(r.data_json); } catch { /* ignore */ }
      return {
        id: r.id,
        text: extractTextFromProseMirror(pmData),
        actor: r.latest_name || r.actor,
        actor_avatar_url: r.actor_avatar_url || null,
        actor_platform: r.actor_platform || null,
        parent_id: r.parent_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });

    res.json({ comments });
  });

  // Read a single document
  app.get('/api/docs/:doc_id', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(req.params.doc_id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({
      doc_id: doc.id,
      title: doc.title,
      content_markdown: doc.text,
      created_at: new Date(doc.created_at).getTime(),
      updated_at: new Date(doc.updated_at).getTime(),
    });
  });

  // List/search documents
  app.get('/api/docs', authenticateAgent, (req, res) => {
    const { query, limit = '25' } = req.query;
    const lim = Math.min(parseInt(limit) || 25, 100);

    if (query) {
      try {
        const docs = db.prepare(`
          SELECT d.*, snippet(documents_fts, 2, '', '', '...', 40) as context
          FROM documents_fts fts JOIN documents d ON d.id = fts.id
          WHERE documents_fts MATCH ? AND d.deleted_at IS NULL
          ORDER BY rank LIMIT ?
        `).all(query, lim);
        return res.json({ docs: docs.map(d => ({ doc_id: d.id, title: d.title, url: null, snippet: d.context, collection_id: null, updated_at: new Date(d.updated_at).getTime() })) });
      } catch {
        // fallback to LIKE
        const docs = db.prepare('SELECT * FROM documents WHERE deleted_at IS NULL AND (title LIKE ? OR text LIKE ?) ORDER BY updated_at DESC LIMIT ?').all(`%${query}%`, `%${query}%`, lim);
        return res.json({ docs: docs.map(d => ({ doc_id: d.id, title: d.title, url: null, snippet: d.text?.substring(0, 200), collection_id: null, updated_at: new Date(d.updated_at).getTime() })) });
      }
    }

    const docs = db.prepare(
      `SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`
    ).all(lim);

    res.json({
      docs: docs.map(d => ({
        doc_id: d.id,
        title: d.title,
        url: null,
        snippet: null,
        collection_id: null,
        updated_at: new Date(d.updated_at).getTime(),
      })),
    });
  });

  // ─── Documents (new /api/documents namespace) ───────────────────────────────
  // GET /api/documents/search — FTS5 full-text search (must be before /:id)
  app.get('/api/documents/search', authenticateAgent, (req, res) => {
    const { q, limit = '25' } = req.query;
    if (!q) return res.status(400).json({ error: 'MISSING_QUERY' });
    const lim = Math.min(parseInt(limit) || 25, 100);

    try {
      const results = db.prepare(`
        SELECT d.*, snippet(documents_fts, 2, '<mark>', '</mark>', '...', 40) as context
        FROM documents_fts fts
        JOIN documents d ON d.id = fts.id
        WHERE documents_fts MATCH ? AND d.deleted_at IS NULL
        ORDER BY rank
        LIMIT ?
      `).all(q, lim);

      res.json({
        data: results.map(r => ({
          document: {
            id: r.id, title: r.title, text: r.text, icon: r.icon,
            full_width: !!r.full_width,
            created_by: r.created_by, updated_by: r.updated_by,
            created_at: r.created_at, updated_at: r.updated_at,
          },
          context: r.context,
        })),
      });
    } catch (e) {
      // Fallback for invalid FTS syntax
      const results = db.prepare('SELECT * FROM documents WHERE deleted_at IS NULL AND (title LIKE ? OR text LIKE ?) ORDER BY updated_at DESC LIMIT ?')
        .all(`%${q}%`, `%${q}%`, lim);
      res.json({
        data: results.map(r => ({
          document: { id: r.id, title: r.title, text: r.text, icon: r.icon, full_width: !!r.full_width, created_by: r.created_by, updated_by: r.updated_by, created_at: r.created_at, updated_at: r.updated_at },
          context: r.text?.substring(0, 200) || '',
        })),
      });
    }
  });

  // GET /api/documents/:id — read single document (full content)
  app.get('/api/documents/:id', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });
    // Parse data_json from TEXT string to object so frontend gets a proper object
    if (doc.data_json) {
      try { doc.data_json = JSON.parse(doc.data_json); } catch { /* leave as-is */ }
    }
    res.json(doc);
  });

  // POST /api/documents — create document
  app.post('/api/documents', authenticateAgent, (req, res) => {
    const { title = '', text = '', data_json, icon, full_width = 0, parent_id, collection_id } = req.body;
    const now = new Date().toISOString();
    const agentName = actorName(req);
    const docId = genId('doc');

    db.prepare(`INSERT INTO documents (id, title, text, data_json, icon, full_width, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(docId, title, text, data_json ? JSON.stringify(data_json) : null, icon || null, full_width ? 1 : 0, agentName, agentName, now, now);

    const nodeId = `doc:${docId}`;
    const ownerId = req.actor?.id || req.agent?.id || null;
    contentItemsUpsert.run(
      nodeId, docId, 'doc', title,
      icon || null, parent_id || null, collection_id || null,
      agentName, agentName, now, now, null, ownerId, Date.now()
    );

    // Create initial version snapshot only for agent-created docs (human-created start empty)
    if (isAgentRequest(req)) {
      const initData = data_json
        ? (typeof data_json === 'string' ? JSON.parse(data_json) : data_json)
        : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: text || '' }] }] };
      createSnapshot(db, { genId }, {
        contentType: 'doc',
        contentId: docId,
        data: initData,
        triggerType: 'auto',
        actorId: agentName,
        title,
      });
    }

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);

    // Notify human users when an agent creates a document
    if (isAgentRequest(req)) {
      const humanActors = db.prepare("SELECT id FROM actors WHERE type = 'human'").all();
      const titleStr = title || docId;
      for (const actor of humanActors) {
        const { id: notifId } = insertNotification(db, { genId }, {
          actorId: agentName,
          targetActorId: actor.id,
          type: 'doc_created',
          titleKey: 'serverNotifications.doc_created.title',
          titleParams: { title: title || '' },
          bodyKey: 'serverNotifications.doc_created.body',
          bodyParams: { agent: agentName, title: titleStr },
          link: `/content?id=doc:${docId}`,
          meta: { doc_id: docId },
        });
        pushHumanEvent(actor.id, { event: 'notification.created', data: { id: notifId, type: 'doc_created', doc_id: docId, title } });
        pushHumanEvent(actor.id, { event: 'content.changed', data: { action: 'created', type: 'doc', id: docId, title } });
      }
    }

    res.status(201).json(doc);
  });

  // PATCH /api/documents/:id — update document
  app.patch('/api/documents/:id', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

    const now = new Date().toISOString();
    const agentName = actorName(req);
    const { title, text, data_json, icon, full_width } = req.body;

    const updates = ['updated_at = ?', 'updated_by = ?'];
    const params = [now, agentName];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (text !== undefined) { updates.push('text = ?'); params.push(text); }
    if (data_json !== undefined) { updates.push('data_json = ?'); params.push(JSON.stringify(data_json)); }
    if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
    if (full_width !== undefined) { updates.push('full_width = ?'); params.push(full_width ? 1 : 0); }
    params.push(req.params.id);

    // Agent edit: create pre_agent_edit snapshot BEFORE update
    if (text !== undefined && text !== doc.text && isAgentRequest(req)) {
      const preData = doc.data_json
        ? JSON.parse(doc.data_json)
        : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text || '' }] }] };
      createSnapshot(db, { genId }, {
        contentType: 'doc',
        contentId: req.params.id,
        data: preData,
        triggerType: 'pre_agent_edit',
        actorId: doc.updated_by || doc.created_by,
        title: doc.title,
      });
    }

    db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Sync title to content_items
    if (title !== undefined) {
      db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
        .run(title, now, req.params.id, 'doc');
    }

    const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

    // Post-edit snapshot for agent requests (captures the newly written state)
    if (isAgentRequest(req) && text !== undefined) {
      const postData = updated.data_json
        ? JSON.parse(updated.data_json)
        : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: updated.text || '' }] }] };
      createSnapshot(db, { genId }, {
        contentType: 'doc',
        contentId: req.params.id,
        data: postData,
        triggerType: 'post_agent_edit',
        actorId: actorName(req),
        title: updated.title,
        description: req.body.revision_description || null,
      });
    }

    res.json(updated);
  });

  // DELETE /api/documents/:id — soft delete (or ?permanent=true for hard delete)
  app.delete('/api/documents/:id', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

    if (req.query.permanent === 'true') {
      db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
      db.prepare('DELETE FROM content_items WHERE raw_id = ? AND type = ?').run(req.params.id, 'doc');
      db.prepare('DELETE FROM doc_icons WHERE doc_id = ?').run(req.params.id);
      return res.json({ deleted: true, permanent: true });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
    db.prepare('UPDATE content_items SET deleted_at = ? WHERE raw_id = ? AND type = ?').run(now, req.params.id, 'doc');
    res.json({ deleted: true });
  });

  // POST /api/documents/:id/restore — restore soft-deleted document
  app.post('/api/documents/:id/restore', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!doc.deleted_at) return res.status(400).json({ error: 'NOT_DELETED' });

    db.prepare('UPDATE documents SET deleted_at = NULL WHERE id = ?').run(req.params.id);
    db.prepare('UPDATE content_items SET deleted_at = NULL WHERE raw_id = ? AND type = ?').run(req.params.id, 'doc');

    const restored = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    res.json(restored);
  });

  // POST /api/documents/:id/revisions — create a manual version snapshot
  app.post('/api/documents/:id/revisions', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

    const { description } = req.body;
    const dataToStore = doc.data_json
      ? JSON.parse(doc.data_json)
      : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text || '' }] }] };

    const snap = createSnapshot(db, { genId }, {
      contentType: 'doc',
      contentId: req.params.id,
      data: dataToStore,
      triggerType: 'manual',
      actorId: actorName(req),
      title: doc.title,
      description: description || null,
    });

    res.status(201).json(snap);
  });

  // GET /api/documents/:id/revisions — list revisions for a document
  app.get('/api/documents/:id/revisions', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

    const revisions = db.prepare(
      "SELECT * FROM content_snapshots WHERE content_type = 'doc' AND content_id = ? ORDER BY created_at DESC"
    ).all(req.params.id);

    const data = revisions.map(r => ({
      id: r.id,
      documentId: r.content_id,
      title: r.title,
      trigger_type: r.trigger_type || null,
      description: r.description || null,
      data: (() => { try { return JSON.parse(r.data_json); } catch { return null; } })(),
      createdAt: r.created_at,
      createdBy: { id: r.actor_id || '', name: r.actor_id || '' }
    }));

    res.json({ data });
  });

  // POST /api/documents/:id/revisions/:revisionId/restore — restore a revision
  app.post('/api/documents/:id/revisions/:revisionId/restore', authenticateAgent, (req, res) => {
    const revision = db.prepare(
      "SELECT * FROM content_snapshots WHERE id = ? AND content_type = 'doc' AND content_id = ?"
    ).get(req.params.revisionId, req.params.id);
    if (!revision) return res.status(404).json({ error: 'REVISION_NOT_FOUND' });

    const result = restoreDocFromSnapshot(db, { genId }, {
      docId: req.params.id,
      revision,
      actorName: actorName(req),
    });
    if (!result) return res.status(404).json({ error: 'NOT_FOUND' });

    res.json(result.document);
  });

  // ─── Document Comments (removed legacy routes; use unified content comment APIs) ───────
  function commentApiMoved(res) {
    return res.status(410).json({
      error: 'COMMENT_API_MOVED',
      message: 'Document comment routes were removed. Use /api/content-items/:id/comments and /api/content-comments/:commentId instead.',
    });
  }

  app.get('/api/documents/:id/comments', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.post('/api/documents/:id/comments', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.patch('/api/documents/comments/:commentId', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.delete('/api/documents/comments/:commentId', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.post('/api/documents/comments/:commentId/resolve', authenticateAgent, (_req, res) => commentApiMoved(res));
  app.post('/api/documents/comments/:commentId/unresolve', authenticateAgent, (_req, res) => commentApiMoved(res));
}
