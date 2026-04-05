/**
 * Document routes: /api/docs/*, /api/documents/*, /api/comments, document comments/revisions
 */

// Get display name for the authenticated actor (human or agent)
function actorName(req) {
  return req.actor?.display_name || req.actor?.username || req.agent?.name || null;
}

export default function docsRoutes(app, { db, authenticateAgent, genId, contentItemsUpsert, pushEvent, deliverWebhook }) {

  // ─── Helper ─────────────────────────────────────
  function extractTextFromProseMirror(pmData) {
    if (!pmData) return '';
    const extract = (node) => {
      if (node.text) return node.text;
      if (node.content) return node.content.map(extract).join('');
      return '';
    };
    return extract(pmData);
  }

  function formatDocComment(r) {
    let pmData = null;
    try { pmData = JSON.parse(r.data_json); } catch { /* ignore */ }
    return {
      id: r.id,
      documentId: r.target_id,
      parentCommentId: r.parent_id || null,
      data: pmData,
      createdById: r.actor_id || '',
      createdBy: { id: r.actor_id || '', name: r.actor || '' },
      resolvedById: r.resolved_by || null,
      resolvedBy: r.resolved_by ? { id: r.resolved_by, name: r.resolved_by } : null,
      resolvedAt: r.resolved_at || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ─── Docs (local SQLite) ────────────────────────
  app.post('/api/docs', authenticateAgent, (req, res) => {
    const { title, content_markdown, parent_id, collection_id } = req.body;
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
    contentItemsUpsert.run(
      nodeId, docId, 'doc', title,
      null, parent_id || null, collection_id || null,
      agentName, agentName, now, now, null, Date.now()
    );

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

    db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

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
    const commentId = genId('cmt');
    const now = new Date().toISOString();

    // Convert plain text to minimal ProseMirror JSON
    const pmData = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };

    db.prepare(`INSERT INTO comments (id, target_type, target_id, parent_id, data_json, actor, actor_id, created_at, updated_at)
      VALUES (?, 'doc', ?, ?, ?, ?, ?, ?, ?)`)
      .run(commentId, doc_id, parent_comment_id || null, JSON.stringify(pmData),
        displayName, actId, now, now);

    // @mention detection
    try {
      const allAgents = db.prepare("SELECT * FROM actors WHERE type = 'agent'").all();
      const nowMs = Date.now();
      for (const target of allAgents) {
        if (target.id === actId) continue;
        const mentionName = new RegExp(`@${target.username}(?![\\w-])`, 'i');
        const mentionDisplay = target.display_name ? new RegExp(`@${target.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i') : null;
        if (!mentionName.test(text) && !(mentionDisplay && mentionDisplay.test(text))) continue;

        const cleanText = text.replace(new RegExp(`@${target.username}(?![\\w-])\\s*`, 'gi'), '').trim();
        const evt = {
          event: 'doc.commented',
          source: 'comments',
          event_id: genId('evt'),
          timestamp: nowMs,
          data: {
            comment_id: commentId,
            doc_id,
            parent_id: parent_comment_id || null,
            text: cleanText,
            raw_text: text,
            sender: { name: displayName, type: req.actor?.type || 'agent' },
          },
        };
        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, target.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), nowMs);
        pushEvent(target.id, evt);
        if (target.webhook_url) deliverWebhook(target, evt).catch(() => {});
        console.log(`[gateway] Event ${evt.event} → ${target.username} (doc: ${doc_id})`);
      }
    } catch (e) {
      console.error(`[gateway] Doc comment notification error: ${e.message}`);
    }

    res.status(201).json({
      comment_id: commentId,
      doc_id,
      parent_comment_id: parent_comment_id || null,
      actor: displayName,
      actor_id: actId,
      created_at: new Date(now).getTime(),
    });
  });

  // GET /api/docs/:doc_id/comments — list comments for a document (agent-facing, simplified)
  app.get('/api/docs/:doc_id/comments', authenticateAgent, (req, res) => {
    const rows = db.prepare(
      "SELECT * FROM comments WHERE target_type = 'doc' AND target_id = ? ORDER BY created_at ASC"
    ).all(req.params.doc_id);

    const comments = rows.map(r => {
      let pmData = null;
      try { pmData = JSON.parse(r.data_json); } catch { /* ignore */ }
      return {
        id: r.id,
        text: extractTextFromProseMirror(pmData),
        actor: r.actor,
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
    contentItemsUpsert.run(
      nodeId, docId, 'doc', title,
      icon || null, parent_id || null, collection_id || null,
      agentName, agentName, now, now, null, Date.now()
    );

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
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

    // Save revision snapshot before updating (only if text content changed)
    if (text !== undefined && text !== doc.text) {
      const revId = genId('snap');
      db.prepare(`INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, row_count, actor_id, created_at)
        VALUES (?, 'doc', ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?)`).run(
        revId, req.params.id, doc.title,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text }] }] }),
        doc.updated_by || doc.created_by, doc.updated_at
      );
    }

    db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Sync title to content_items
    if (title !== undefined) {
      db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
        .run(title, now, req.params.id, 'doc');
    }

    const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
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
      data: (() => { try { return JSON.parse(r.data_json); } catch { return null; } })(),
      createdAt: r.created_at,
      createdBy: { id: r.actor_id || '', name: r.actor_id || '' }
    }));

    res.json({ data });
  });

  // POST /api/documents/:id/revisions/:revisionId/restore — restore a revision
  app.post('/api/documents/:id/revisions/:revisionId/restore', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

    const revision = db.prepare(
      "SELECT * FROM content_snapshots WHERE id = ? AND content_type = 'doc' AND content_id = ?"
    ).get(req.params.revisionId, req.params.id);
    if (!revision) return res.status(404).json({ error: 'REVISION_NOT_FOUND' });

    const now = new Date().toISOString();
    const agentName = actorName(req);

    // Save current state as a new revision (so user can undo the restore)
    const snapId = genId('snap');
    db.prepare(`INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, row_count, actor_id, created_at)
      VALUES (?, 'doc', ?, NULL, ?, ?, NULL, 'pre_restore', NULL, ?, ?)`).run(
      snapId, req.params.id, doc.title,
      JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text }] }] }),
      doc.updated_by || doc.created_by, doc.updated_at
    );

    // Extract text from the revision's ProseMirror JSON
    let revData = null;
    try { revData = JSON.parse(revision.data_json); } catch { /* ignore */ }
    const restoredText = revData ? extractTextFromProseMirror(revData) : '';

    // Update document with restored title and text
    db.prepare(`UPDATE documents SET title = ?, text = ?, data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .run(revision.title, restoredText, revision.data_json, agentName, now, req.params.id);

    // Sync title to content_items
    db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
      .run(revision.title, now, req.params.id, 'doc');

    const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    res.json(updated);
  });

  // ─── Document Comments (Shell-facing) ───────────────────────────────────────

  // GET /api/documents/:id/comments — list comments for a document
  app.get('/api/documents/:id/comments', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT id FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

    const rows = db.prepare(
      "SELECT * FROM comments WHERE target_type = 'doc' AND target_id = ? ORDER BY created_at ASC"
    ).all(req.params.id);

    res.json({ data: rows.map(formatDocComment) });
  });

  // POST /api/documents/:id/comments — create comment
  app.post('/api/documents/:id/comments', authenticateAgent, (req, res) => {
    const doc = db.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

    const { data, parent_comment_id } = req.body;
    if (!data) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'data (ProseMirror JSON) required' });

    const displayName = actorName(req);
    const actId = req.actor?.id || req.agent?.id;
    const commentId = genId('cmt');
    const now = new Date().toISOString();
    const nowMs = Date.now();

    db.prepare(`INSERT INTO comments (id, target_type, target_id, parent_id, data_json, actor, actor_id, created_at, updated_at)
      VALUES (?, 'doc', ?, ?, ?, ?, ?, ?, ?)`)
      .run(commentId, req.params.id, parent_comment_id || null, JSON.stringify(data),
        displayName, actId, now, now);

    // @mention detection
    try {
      const commentText = extractTextFromProseMirror(data);
      const allAgents = db.prepare("SELECT * FROM actors WHERE type = 'agent'").all();
      for (const target of allAgents) {
        if (target.id === actId) continue;
        const mentionName = new RegExp(`@${target.username}(?![\\w-])`, 'i');
        const mentionDisplay = target.display_name
          ? new RegExp(`@${target.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i')
          : null;
        if (!mentionName.test(commentText) && !(mentionDisplay && mentionDisplay.test(commentText))) continue;

        const cleanText = commentText.replace(new RegExp(`@${target.username}(?![\\w-])\\s*`, 'gi'), '').trim();
        const evt = {
          event: 'doc.commented',
          source: 'comments',
          event_id: genId('evt'),
          timestamp: nowMs,
          data: {
            comment_id: commentId,
            doc_id: req.params.id,
            parent_id: parent_comment_id || null,
            text: cleanText,
            raw_text: commentText,
            sender: { name: displayName, type: req.actor?.type || 'agent' },
          },
        };
        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, target.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), nowMs);
        pushEvent(target.id, evt);
        if (target.webhook_url) deliverWebhook(target, evt).catch(() => {});
        console.log(`[gateway] Event ${evt.event} → ${target.username} (doc: ${req.params.id})`);
      }
    } catch (e) {
      console.error(`[gateway] Doc comment mention error: ${e.message}`);
    }

    const inserted = db.prepare("SELECT * FROM comments WHERE id = ?").get(commentId);
    res.status(201).json(formatDocComment(inserted));
  });

  // PATCH /api/documents/comments/:commentId — update comment data
  app.patch('/api/documents/comments/:commentId', authenticateAgent, (req, res) => {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'data (ProseMirror JSON) required' });

    const now = new Date().toISOString();
    const result = db.prepare(
      "UPDATE comments SET data_json = ?, updated_at = ? WHERE id = ? AND target_type = 'doc'"
    ).run(JSON.stringify(data), now, req.params.commentId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });

    const updated = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.commentId);
    res.json(formatDocComment(updated));
  });

  // DELETE /api/documents/comments/:commentId — delete comment
  app.delete('/api/documents/comments/:commentId', authenticateAgent, (req, res) => {
    const result = db.prepare("DELETE FROM comments WHERE id = ? AND target_type = 'doc'").run(req.params.commentId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ deleted: true });
  });

  // POST /api/documents/comments/:commentId/resolve — mark resolved
  app.post('/api/documents/comments/:commentId/resolve', authenticateAgent, (req, res) => {
    const now = new Date().toISOString();
    const result = db.prepare(
      "UPDATE comments SET resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND target_type = 'doc'"
    ).run(actorName(req), now, now, req.params.commentId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    const updated = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.commentId);
    res.json(formatDocComment(updated));
  });

  // POST /api/documents/comments/:commentId/unresolve — unmark resolved
  app.post('/api/documents/comments/:commentId/unresolve', authenticateAgent, (req, res) => {
    const now = new Date().toISOString();
    const result = db.prepare(
      "UPDATE comments SET resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ? AND target_type = 'doc'"
    ).run(now, req.params.commentId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    const updated = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.commentId);
    res.json(formatDocComment(updated));
  });
}
