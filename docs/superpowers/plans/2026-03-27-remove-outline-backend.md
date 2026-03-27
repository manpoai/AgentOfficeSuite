# Remove Outline Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Outline backend with Gateway SQLite storage for all document operations (CRUD, revisions, comments, attachments, search), then remove Outline proxy and dependencies.

**Architecture:** Gateway SQLite becomes the single source of truth for documents, replacing the current Shell→Outline proxy→Outline API→PostgreSQL chain with Shell→Gateway proxy→Gateway SQLite. All existing UI components (ProseMirror editor, RevisionHistory, comment panel) stay intact — only API call targets change. Attachments move from S3 presigned upload to Gateway local file storage.

**Tech Stack:** Express.js (Gateway), better-sqlite3, multer (file upload), SQLite FTS5 (search), Next.js API routes (Shell proxy)

---

## File Structure

### Gateway (server.js — modify existing)
- `gateway/server.js` — Add documents table migration, document CRUD endpoints, document_revisions table + endpoints, document_comments table + endpoints, file upload endpoint + static serving, FTS5 search, remove Outline upstream calls

### Shell — New files
- `shell/src/lib/api/documents.ts` — New document API client (replaces outline.ts)

### Shell — Modify existing
- `shell/src/lib/api/gateway.ts` — Add document upload function
- `shell/src/components/RevisionHistory.tsx` — Switch from ol.* to new doc API
- `shell/src/app/(workspace)/content/page.tsx` — Replace all ol.* calls with new doc API
- `shell/src/app/api/gateway/[...path]/route.ts` — Add Cache-Control for uploaded files

### Shell — Delete
- `shell/src/lib/api/outline.ts` — Remove entirely
- `shell/src/app/api/outline/[...path]/route.ts` — Remove entirely

---

## Task 1: Gateway — Documents Table & CRUD Endpoints

**Files:**
- Modify: `gateway/server.js`

This task adds the `documents` table and basic CRUD endpoints (create, read, update, delete, list deleted, restore, permanent delete).

- [ ] **Step 1: Add documents table migration**

In the migration section of `server.js` (near existing `CREATE TABLE` statements around line ~100), add:

```javascript
db.exec(`CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  data_json TEXT,
  icon TEXT,
  full_width INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
)`);
```

- `text` = Markdown content (what Shell editor saves as text)
- `data_json` = ProseMirror JSON (optional, for future use if editor sends it)
- `full_width` = boolean as integer (0/1)

- [ ] **Step 2: Add GET /api/documents/:id endpoint**

After the existing `// ─── Docs (Outline)` section (~line 364), add a new section. This endpoint replaces `documents.info`:

```javascript
// ─── Documents (local SQLite) ─────────────────────
app.get('/api/documents/:id', authenticateAgent, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({
    id: doc.id,
    title: doc.title,
    text: doc.text,
    data_json: doc.data_json ? JSON.parse(doc.data_json) : null,
    icon: doc.icon,
    full_width: !!doc.full_width,
    created_by: doc.created_by,
    updated_by: doc.updated_by,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    deleted_at: doc.deleted_at,
  });
});
```

- [ ] **Step 3: Add POST /api/documents endpoint (create)**

```javascript
app.post('/api/documents', authenticateAgent, (req, res) => {
  const { title = '', text = '', data_json, icon, full_width } = req.body;
  const id = genId('doc');
  const now = new Date().toISOString();
  const agentName = req.agent?.name || req.agent?.display_name || null;

  db.prepare(`INSERT INTO documents (id, title, text, data_json, icon, full_width, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, title, text, data_json ? JSON.stringify(data_json) : null,
    icon || null, full_width ? 1 : 0, agentName, agentName, now, now
  );

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  res.status(201).json({
    id: doc.id,
    title: doc.title,
    text: doc.text,
    icon: doc.icon,
    full_width: !!doc.full_width,
    created_by: doc.created_by,
    updated_by: doc.updated_by,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  });
});
```

- [ ] **Step 4: Add PATCH /api/documents/:id endpoint (update)**

```javascript
app.patch('/api/documents/:id', authenticateAgent, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

  const { title, text, data_json, icon, full_width } = req.body;
  const now = new Date().toISOString();
  const agentName = req.agent?.name || req.agent?.display_name || null;

  const fields = [];
  const values = [];

  if (title !== undefined) { fields.push('title = ?'); values.push(title); }
  if (text !== undefined) { fields.push('text = ?'); values.push(text); }
  if (data_json !== undefined) { fields.push('data_json = ?'); values.push(data_json ? JSON.stringify(data_json) : null); }
  if (icon !== undefined) { fields.push('icon = ?'); values.push(icon); }
  if (full_width !== undefined) { fields.push('full_width = ?'); values.push(full_width ? 1 : 0); }

  fields.push('updated_by = ?', 'updated_at = ?');
  values.push(agentName, now, req.params.id);

  db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  // Sync title to content_items
  if (title !== undefined) {
    db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
      .run(title, now, req.params.id, 'doc');
  }

  const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  res.json({
    id: updated.id,
    title: updated.title,
    text: updated.text,
    icon: updated.icon,
    full_width: !!updated.full_width,
    created_by: updated.created_by,
    updated_by: updated.updated_by,
    created_at: updated.created_at,
    updated_at: updated.updated_at,
  });
});
```

- [ ] **Step 5: Add DELETE /api/documents/:id endpoint (soft delete)**

```javascript
app.delete('/api/documents/:id', authenticateAgent, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

  const permanent = req.query.permanent === 'true';
  if (permanent) {
    db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
    // Also delete revisions and comments
    db.prepare('DELETE FROM document_revisions WHERE document_id = ?').run(req.params.id);
    db.prepare('DELETE FROM document_comments WHERE document_id = ?').run(req.params.id);
  } else {
    const now = new Date().toISOString();
    db.prepare('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, req.params.id);
  }
  res.json({ deleted: true });
});
```

- [ ] **Step 6: Add POST /api/documents/:id/restore endpoint**

```javascript
app.post('/api/documents/:id/restore', authenticateAgent, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

  const now = new Date().toISOString();
  db.prepare('UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, req.params.id);

  res.json({ id: doc.id, restored: true });
});
```

- [ ] **Step 7: Update content-items creation for type='doc'**

In the `POST /api/content-items` handler (~line 3180), replace the Outline doc creation block with local document creation:

```javascript
  if (type === 'doc') {
    // Create document in local SQLite (no more Outline)
    const docId = genId('doc');
    const isoNow = new Date().toISOString();

    db.prepare(`INSERT INTO documents (id, title, text, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, '', ?, ?, ?, ?)`).run(
      docId, title || '', agentName, agentName, isoNow, isoNow
    );

    const nodeId = `doc:${docId}`;
    contentItemsUpsert.run(
      nodeId, docId, 'doc', title || '',
      null, parent_id, null,
      agentName, agentName, isoNow, isoNow, null, Date.now()
    );
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
    return res.status(201).json({ item });
  }
```

- [ ] **Step 8: Update content-items deletion for type='doc'**

In `DELETE /api/content-items/:id` (~line 3371), replace the Outline deletion calls with local document deletion:

```javascript
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
      // Soft-delete the document locally
      db.prepare('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, item.raw_id);

      for (const desc of descendants) {
        db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, desc.id);
        if (desc.type === 'doc') {
          db.prepare('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, desc.raw_id);
        }
      }
    } else {
      // mode === 'only': reparent children, then delete this node
      const children = db.prepare('SELECT * FROM content_items WHERE parent_id = ? AND deleted_at IS NULL').all(req.params.id);
      for (const child of children) {
        db.prepare('UPDATE content_items SET parent_id = ? WHERE id = ?').run(item.parent_id, child.id);
      }
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
      db.prepare('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, item.raw_id);
    }
```

- [ ] **Step 9: Update content-items permanent delete for type='doc'**

Find the permanent delete handler and replace Outline call with local delete:

```javascript
// In the permanent delete handler for docs:
db.prepare('DELETE FROM documents WHERE id = ?').run(item.raw_id);
db.prepare('DELETE FROM document_revisions WHERE document_id = ?').run(item.raw_id);
db.prepare('DELETE FROM document_comments WHERE document_id = ?').run(item.raw_id);
```

- [ ] **Step 10: Update syncContentItems to skip Outline**

In `syncContentItems()` (~line 2796), replace the "Sync docs from Outline" section with syncing from local documents table:

```javascript
  // 1. Sync docs from local documents table
  let docCount = 0;
  try {
    const docs = db.prepare('SELECT d.*, di.icon as custom_icon FROM documents d LEFT JOIN doc_icons di ON di.doc_id = d.id').all();
    for (const doc of docs) {
      const nodeId = `doc:${doc.id}`;
      const icon = doc.custom_icon || doc.icon || null;
      contentItemsUpsert.run(
        nodeId, doc.id, 'doc', doc.title || '',
        icon, null, null,
        doc.created_by || null, doc.updated_by || null,
        doc.created_at || null, doc.updated_at || null, doc.deleted_at || null,
        now
      );
      docCount++;
    }
  } catch (err) {
    console.error('[gateway] Content sync: documents error:', err.message);
  }
```

- [ ] **Step 11: Update agent doc API endpoints to use local storage**

Replace the `POST /api/docs` and `PATCH /api/docs/:doc_id` handlers (~lines 365-414) to use local documents instead of Outline:

```javascript
// ─── Docs (local SQLite) ─────────────────────────
app.post('/api/docs', authenticateAgent, async (req, res) => {
  const { title, content_markdown, collection_id } = req.body;
  if (!title || !content_markdown) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title and content_markdown required' });
  }
  const id = genId('doc');
  const now = new Date().toISOString();
  const agentName = req.agent?.name || req.agent?.display_name || null;

  db.prepare(`INSERT INTO documents (id, title, text, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, title, content_markdown, agentName, agentName, now, now);

  const nodeId = `doc:${id}`;
  contentItemsUpsert.run(
    nodeId, id, 'doc', title,
    null, null, null,
    agentName, agentName, now, now, null, Date.now()
  );

  res.status(201).json({
    doc_id: id,
    url: null,
    created_at: new Date(now).getTime(),
  });
});

app.patch('/api/docs/:doc_id', authenticateAgent, async (req, res) => {
  const { title, content_markdown } = req.body;
  const now = new Date().toISOString();
  const agentName = req.agent?.name || req.agent?.display_name || null;

  const fields = [];
  const values = [];
  if (title) { fields.push('title = ?'); values.push(title); }
  if (content_markdown) { fields.push('text = ?'); values.push(content_markdown); }
  fields.push('updated_by = ?', 'updated_at = ?');
  values.push(agentName, now, req.params.doc_id);

  const result = db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });

  if (title) {
    db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
      .run(title, now, req.params.doc_id, 'doc');
  }

  res.json({ doc_id: req.params.doc_id, updated_at: new Date(now).getTime() });
});
```

- [ ] **Step 12: Update agent doc read/list/search endpoints**

Replace `GET /api/docs/:doc_id` and `GET /api/docs` (~lines 468-519):

```javascript
app.get('/api/docs/:doc_id', authenticateAgent, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(req.params.doc_id);
  if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({
    doc_id: doc.id, title: doc.title, content_markdown: doc.text,
    url: null, collection_id: null,
    created_at: new Date(doc.created_at).getTime(),
    updated_at: new Date(doc.updated_at).getTime(),
  });
});

app.get('/api/docs', authenticateAgent, (req, res) => {
  const { query, limit = '25' } = req.query;
  const lim = Math.min(parseInt(limit) || 25, 100);

  if (query) {
    // FTS search (will be enhanced in Task 5)
    const docs = db.prepare('SELECT * FROM documents WHERE deleted_at IS NULL AND (title LIKE ? OR text LIKE ?) ORDER BY updated_at DESC LIMIT ?')
      .all(`%${query}%`, `%${query}%`, lim);
    res.json({ docs: docs.map(d => ({
      doc_id: d.id, title: d.title, url: null,
      snippet: d.text.substring(0, 200),
      collection_id: null,
      updated_at: new Date(d.updated_at).getTime(),
    }))});
  } else {
    const docs = db.prepare('SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?').all(lim);
    res.json({ docs: docs.map(d => ({
      doc_id: d.id, title: d.title, url: null,
      collection_id: null,
      updated_at: new Date(d.updated_at).getTime(),
    }))});
  }
});
```

- [ ] **Step 13: Update agent doc comments to use local storage**

Replace `POST /api/comments` and `GET /api/docs/:doc_id/comments` (~lines 416-456):

```javascript
// ─── Doc Comments (local SQLite) ─────────────────
app.post('/api/comments', authenticateAgent, (req, res) => {
  const { doc_id, text, parent_comment_id } = req.body;
  if (!doc_id || !text) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'doc_id and text required' });
  }
  const id = genId('cmt');
  const now = new Date().toISOString();
  const agentName = req.agent?.display_name || req.agent?.name || 'Unknown';

  db.prepare(`INSERT INTO document_comments (id, document_id, parent_id, data_json, actor, actor_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, doc_id, parent_comment_id || null,
    JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }),
    agentName, req.agent?.agent_id || null, now, now
  );

  res.status(201).json({
    comment_id: id,
    doc_id,
    created_at: new Date(now).getTime(),
  });
});

app.get('/api/docs/:doc_id/comments', authenticateAgent, (req, res) => {
  const rows = db.prepare('SELECT * FROM document_comments WHERE document_id = ? ORDER BY created_at ASC')
    .all(req.params.doc_id);
  const comments = rows.map(c => ({
    id: c.id,
    text: extractTextFromProseMirror(c.data_json ? JSON.parse(c.data_json) : null),
    actor: c.actor,
    parent_id: c.parent_id || null,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));
  res.json({ comments });
});
```

- [ ] **Step 14: Remove Outline webhook handler**

Delete the entire `POST /webhooks/outline` handler (~lines 2115-2260). Replace with a simpler internal mention detection in the comment creation endpoint:

```javascript
// In the POST /api/documents/:id/comments endpoint (added in Task 3),
// after inserting the comment, check for @mentions:
const agents = db.prepare('SELECT * FROM agents').all();
const commentText = extractTextFromProseMirror(data_json ? JSON.parse(JSON.stringify(data_json)) : null);
for (const agent of agents) {
  const names = [agent.name, agent.display_name].filter(Boolean).map(n => n.toLowerCase());
  const mentioned = names.some(n => commentText.toLowerCase().includes(`@${n}`));
  if (mentioned) {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    const evt = {
      event: 'comment.mentioned',
      source: 'documents',
      event_id: genId('evt'),
      timestamp: Date.now(),
      data: {
        doc_id: req.params.id,
        comment_id: id,
        parent_comment_id: parent_id || null,
        text_without_mention: commentText.replace(new RegExp(`@${agent.name}`, 'gi'), '').trim(),
        doc_title: doc?.title || '',
        doc_content: doc?.text || '',
        sender: { id: req.agent?.agent_id || 'human', name: req.agent?.display_name || req.agent?.name || 'Human', type: req.agent?.type || 'human' },
      },
    };
    // Insert event
    db.prepare('INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(evt.event_id, agent.agent_id, 'comment.mentioned', 'documents', evt.timestamp, JSON.stringify(evt.data), Date.now());
    pushEvent(agent.agent_id, evt);
  }
}
```

- [ ] **Step 15: Remove OL_URL and OL_TOKEN references**

Remove the Outline config variables at the top of server.js (~line 22-23):

```javascript
// DELETE these lines:
// const OL_URL = process.env.OL_URL || 'http://localhost:3000';
// const OL_TOKEN = process.env.OL_TOKEN;
```

Also remove any remaining `upstream(OL_URL, ...)` calls. Search for `OL_URL` and `OL_TOKEN` to find all occurrences.

- [ ] **Step 16: Test Gateway document endpoints**

```bash
# Start gateway
cd /Users/mac/Documents/asuite/gateway && node server.js &

# Get token
TOKEN=$(cat /Users/mac/Documents/asuite/adapters/zylos/config-zylos-thinker.json | grep agent_token | cut -d'"' -f4)

# Create document
curl -s -X POST http://localhost:4000/api/documents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Doc","text":"# Hello\n\nThis is a test."}'
# Expected: 201 with {id, title, text, ...}

# Read document
curl -s http://localhost:4000/api/documents/<id> \
  -H "Authorization: Bearer $TOKEN"
# Expected: 200 with full document

# Update document
curl -s -X PATCH http://localhost:4000/api/documents/<id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated Title","text":"# Updated\n\nNew content."}'
# Expected: 200 with updated document

# Soft delete
curl -s -X DELETE http://localhost:4000/api/documents/<id> \
  -H "Authorization: Bearer $TOKEN"
# Expected: 200 {deleted: true}

# Restore
curl -s -X POST http://localhost:4000/api/documents/<id>/restore \
  -H "Authorization: Bearer $TOKEN"
# Expected: 200 {id, restored: true}
```

- [ ] **Step 17: Commit**

```bash
cd /Users/mac/Documents/asuite
git add gateway/server.js
git commit -m "feat(gateway): add local documents table and CRUD endpoints, remove Outline upstream calls"
```

---

## Task 2: Gateway — Document Revisions

**Files:**
- Modify: `gateway/server.js`

- [ ] **Step 1: Add document_revisions table migration**

```javascript
db.exec(`CREATE TABLE IF NOT EXISTS document_revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_revisions_doc ON document_revisions(document_id)`);
```

- [ ] **Step 2: Add auto-revision creation in document update**

In the `PATCH /api/documents/:id` handler (from Task 1 Step 4), before the UPDATE statement, snapshot the current state:

```javascript
  // Save revision snapshot before updating (only if text content changed)
  if (text !== undefined && text !== doc.text) {
    const revId = genId('rev');
    db.prepare(`INSERT INTO document_revisions (id, document_id, title, data_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      revId, req.params.id, doc.title,
      JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text }] }] }),
      doc.updated_by || doc.created_by, doc.updated_at
    );
  }
```

- [ ] **Step 3: Add GET /api/documents/:id/revisions endpoint**

```javascript
app.get('/api/documents/:id/revisions', authenticateAgent, (req, res) => {
  const revisions = db.prepare(
    'SELECT * FROM document_revisions WHERE document_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);

  res.json({
    data: revisions.map(r => ({
      id: r.id,
      documentId: r.document_id,
      title: r.title,
      data: r.data_json ? JSON.parse(r.data_json) : null,
      createdAt: r.created_at,
      createdBy: { id: r.created_by || 'unknown', name: r.created_by || 'Unknown' },
    })),
  });
});
```

- [ ] **Step 4: Add POST /api/documents/:id/revisions/:revisionId/restore endpoint**

```javascript
app.post('/api/documents/:id/revisions/:revisionId/restore', authenticateAgent, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'NOT_FOUND' });

  const revision = db.prepare('SELECT * FROM document_revisions WHERE id = ? AND document_id = ?')
    .get(req.params.revisionId, req.params.id);
  if (!revision) return res.status(404).json({ error: 'REVISION_NOT_FOUND' });

  // Save current state as a revision before restoring
  const snapId = genId('rev');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO document_revisions (id, document_id, title, data_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    snapId, req.params.id, doc.title,
    JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text }] }] }),
    doc.updated_by || doc.created_by, now
  );

  // Extract text from revision ProseMirror JSON
  const revData = revision.data_json ? JSON.parse(revision.data_json) : null;
  const restoredText = extractTextFromProseMirror(revData);
  const agentName = req.agent?.name || req.agent?.display_name || null;

  db.prepare('UPDATE documents SET title = ?, text = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(revision.title, restoredText, agentName, now, req.params.id);

  const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  res.json({
    id: updated.id,
    title: updated.title,
    text: updated.text,
    updated_at: updated.updated_at,
  });
});
```

- [ ] **Step 5: Test revision endpoints**

```bash
TOKEN=$(cat /Users/mac/Documents/asuite/adapters/zylos/config-zylos-thinker.json | grep agent_token | cut -d'"' -f4)

# Create a doc
DOC=$(curl -s -X POST http://localhost:4000/api/documents \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Rev Test","text":"Version 1"}')
DOC_ID=$(echo $DOC | jq -r '.id')

# Update it twice to create revisions
curl -s -X PATCH http://localhost:4000/api/documents/$DOC_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Version 2"}'

curl -s -X PATCH http://localhost:4000/api/documents/$DOC_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Version 3"}'

# List revisions
curl -s http://localhost:4000/api/documents/$DOC_ID/revisions \
  -H "Authorization: Bearer $TOKEN"
# Expected: 2 revisions (Version 1 and Version 2 snapshots)

# Restore first revision
REV_ID=$(curl -s http://localhost:4000/api/documents/$DOC_ID/revisions \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[-1].id')
curl -s -X POST http://localhost:4000/api/documents/$DOC_ID/revisions/$REV_ID/restore \
  -H "Authorization: Bearer $TOKEN"
# Expected: text restored to "Version 1"
```

- [ ] **Step 6: Commit**

```bash
cd /Users/mac/Documents/asuite
git add gateway/server.js
git commit -m "feat(gateway): add document revisions with auto-snapshot on update"
```

---

## Task 3: Gateway — Document Comments

**Files:**
- Modify: `gateway/server.js`

- [ ] **Step 1: Add document_comments table migration**

```javascript
db.exec(`CREATE TABLE IF NOT EXISTS document_comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  parent_id TEXT,
  data_json TEXT,
  actor TEXT,
  actor_id TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_comments_doc ON document_comments(document_id)`);
```

- [ ] **Step 2: Add Shell-facing comment endpoints**

These are the endpoints that the Shell frontend (content/page.tsx) will call directly through the Gateway proxy. They use ProseMirror JSON format for comment data (matching what the Shell editor already sends).

```javascript
// ─── Document Comments (Shell-facing, ProseMirror JSON) ─────
app.get('/api/documents/:id/comments', authenticateAgent, (req, res) => {
  const rows = db.prepare('SELECT * FROM document_comments WHERE document_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json({
    data: rows.map(c => ({
      id: c.id,
      documentId: c.document_id,
      parentCommentId: c.parent_id || null,
      data: c.data_json ? JSON.parse(c.data_json) : null,
      createdById: c.actor_id || c.actor,
      createdBy: { id: c.actor_id || c.actor || 'unknown', name: c.actor || 'Unknown' },
      resolvedById: c.resolved_by || null,
      resolvedBy: c.resolved_by ? { id: c.resolved_by, name: c.resolved_by } : null,
      resolvedAt: c.resolved_at || null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  });
});

app.post('/api/documents/:id/comments', authenticateAgent, (req, res) => {
  const { data, parent_comment_id } = req.body;
  if (!data) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'data (ProseMirror JSON) required' });

  const id = genId('cmt');
  const now = new Date().toISOString();
  const agentName = req.agent?.display_name || req.agent?.name || 'Human';

  db.prepare(`INSERT INTO document_comments (id, document_id, parent_id, data_json, actor, actor_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, req.params.id, parent_comment_id || null,
    JSON.stringify(data), agentName, req.agent?.agent_id || null, now, now
  );

  // Check for @mentions and generate events
  const commentText = extractTextFromProseMirror(data);
  const agents = db.prepare('SELECT * FROM agents').all();
  for (const agent of agents) {
    const names = [agent.name, agent.display_name].filter(Boolean).map(n => n.toLowerCase());
    const mentioned = names.some(n => commentText.toLowerCase().includes(`@${n}`));
    if (mentioned) {
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
      const evtId = genId('evt');
      const evtData = {
        doc_id: req.params.id,
        comment_id: id,
        parent_comment_id: parent_comment_id || null,
        text_without_mention: commentText.replace(new RegExp(`@(${agent.name}|${agent.display_name || ''})`, 'gi'), '').trim(),
        doc_title: doc?.title || '',
        doc_content: doc?.text || '',
        sender: { id: req.agent?.agent_id || 'human', name: agentName, type: req.agent?.type || 'human' },
      };
      db.prepare('INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(evtId, agent.agent_id, 'comment.mentioned', 'documents', Date.now(), JSON.stringify(evtData), Date.now());
      if (typeof pushEvent === 'function') pushEvent(agent.agent_id, { event: 'comment.mentioned', source: 'documents', event_id: evtId, timestamp: Date.now(), data: evtData });
    }
  }

  const comment = db.prepare('SELECT * FROM document_comments WHERE id = ?').get(id);
  res.status(201).json({
    data: {
      id: comment.id,
      documentId: comment.document_id,
      parentCommentId: comment.parent_id,
      data: comment.data_json ? JSON.parse(comment.data_json) : null,
      createdBy: { id: comment.actor_id || comment.actor, name: comment.actor },
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    },
  });
});

app.patch('/api/documents/comments/:commentId', authenticateAgent, (req, res) => {
  const { data } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE document_comments SET data_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(data), now, req.params.commentId);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ updated: true });
});

app.delete('/api/documents/comments/:commentId', authenticateAgent, (req, res) => {
  const result = db.prepare('DELETE FROM document_comments WHERE id = ?').run(req.params.commentId);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ deleted: true });
});

app.post('/api/documents/comments/:commentId/resolve', authenticateAgent, (req, res) => {
  const now = new Date().toISOString();
  const agentName = req.agent?.display_name || req.agent?.name || 'Human';
  const result = db.prepare('UPDATE document_comments SET resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
    .run(agentName, now, now, req.params.commentId);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ resolved: true });
});

app.post('/api/documents/comments/:commentId/unresolve', authenticateAgent, (req, res) => {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE document_comments SET resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?')
    .run(now, req.params.commentId);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ resolved: false });
});
```

- [ ] **Step 3: Test comment endpoints**

```bash
TOKEN=$(cat /Users/mac/Documents/asuite/adapters/zylos/config-zylos-thinker.json | grep agent_token | cut -d'"' -f4)

# Create a comment on an existing doc
curl -s -X POST http://localhost:4000/api/documents/<doc_id>/comments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"data":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test comment"}]}]}}'
# Expected: 201 with comment data

# List comments
curl -s http://localhost:4000/api/documents/<doc_id>/comments \
  -H "Authorization: Bearer $TOKEN"
# Expected: array with the comment

# Resolve comment
curl -s -X POST http://localhost:4000/api/documents/comments/<comment_id>/resolve \
  -H "Authorization: Bearer $TOKEN"
# Expected: {resolved: true}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/mac/Documents/asuite
git add gateway/server.js
git commit -m "feat(gateway): add document comments with threading, resolve, and @mention events"
```

---

## Task 4: Gateway — File Upload & Static Serving

**Files:**
- Modify: `gateway/server.js`

- [ ] **Step 1: Add multer and uploads directory setup**

At the top of server.js, after existing imports:

```javascript
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.bin';
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});
```

- [ ] **Step 2: Add upload endpoint**

```javascript
app.post('/api/uploads', authenticateAgent, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'NO_FILE' });

  const url = `/api/uploads/${req.file.filename}`;
  res.status(201).json({
    url,
    name: req.file.originalname,
    size: req.file.size,
    content_type: req.file.mimetype,
  });
});
```

- [ ] **Step 3: Add static file serving for uploads**

```javascript
app.get('/api/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  // Prevent directory traversal
  if (!filePath.startsWith(UPLOADS_DIR)) return res.status(403).json({ error: 'FORBIDDEN' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'NOT_FOUND' });

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.mp4': 'video/mp4',
  };

  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(filePath).pipe(res);
});
```

- [ ] **Step 4: Install multer**

```bash
cd /Users/mac/Documents/asuite/gateway && npm install multer
```

- [ ] **Step 5: Test upload**

```bash
TOKEN=$(cat /Users/mac/Documents/asuite/adapters/zylos/config-zylos-thinker.json | grep agent_token | cut -d'"' -f4)

# Upload a test file
echo "test" > /tmp/test-upload.txt
curl -s -X POST http://localhost:4000/api/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test-upload.txt"
# Expected: 201 with {url, name, size, content_type}

# Retrieve it
curl -s http://localhost:4000/api/uploads/<filename>
# Expected: file content
```

- [ ] **Step 6: Commit**

```bash
cd /Users/mac/Documents/asuite
git add gateway/server.js gateway/package.json gateway/package-lock.json
git commit -m "feat(gateway): add file upload endpoint with multer local storage"
```

---

## Task 5: Gateway — Full-Text Search (FTS5)

**Files:**
- Modify: `gateway/server.js`

- [ ] **Step 1: Add FTS5 virtual table migration**

```javascript
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  id UNINDEXED, title, text, content='documents', content_rowid='rowid'
)`);

// Triggers to keep FTS in sync
db.exec(`CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(id, title, text) VALUES (new.id, new.title, new.text);
END`);
db.exec(`CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
  INSERT INTO documents_fts(id, title, text) VALUES (new.id, new.title, new.text);
END`);
db.exec(`CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
END`);
```

- [ ] **Step 2: Add search endpoint**

```javascript
app.get('/api/documents/search', authenticateAgent, (req, res) => {
  const { q, limit = '25' } = req.query;
  if (!q) return res.status(400).json({ error: 'MISSING_QUERY' });

  const lim = Math.min(parseInt(limit) || 25, 100);

  // Use FTS5 match with snippet for context
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
        id: r.id,
        title: r.title,
        text: r.text,
        icon: r.icon,
        full_width: !!r.full_width,
        created_by: r.created_by,
        updated_by: r.updated_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
      context: r.context,
    })),
  });
});
```

- [ ] **Step 3: Also update the agent-facing GET /api/docs search to use FTS**

Replace the LIKE-based search in `GET /api/docs` (from Task 1 Step 12) with FTS5:

```javascript
  if (query) {
    try {
      const docs = db.prepare(`
        SELECT d.*, snippet(documents_fts, 2, '', '', '...', 40) as context
        FROM documents_fts fts
        JOIN documents d ON d.id = fts.id
        WHERE documents_fts MATCH ? AND d.deleted_at IS NULL
        ORDER BY rank LIMIT ?
      `).all(query, lim);
      res.json({ docs: docs.map(d => ({
        doc_id: d.id, title: d.title, url: null,
        snippet: d.context,
        collection_id: null,
        updated_at: new Date(d.updated_at).getTime(),
      }))});
    } catch {
      // Fallback to LIKE for invalid FTS syntax
      const docs = db.prepare('SELECT * FROM documents WHERE deleted_at IS NULL AND (title LIKE ? OR text LIKE ?) ORDER BY updated_at DESC LIMIT ?')
        .all(`%${query}%`, `%${query}%`, lim);
      res.json({ docs: docs.map(d => ({
        doc_id: d.id, title: d.title, url: null,
        snippet: d.text.substring(0, 200),
        collection_id: null,
        updated_at: new Date(d.updated_at).getTime(),
      }))});
    }
  }
```

- [ ] **Step 4: Test FTS search**

```bash
TOKEN=$(cat /Users/mac/Documents/asuite/adapters/zylos/config-zylos-thinker.json | grep agent_token | cut -d'"' -f4)

# Search
curl -s "http://localhost:4000/api/documents/search?q=test" \
  -H "Authorization: Bearer $TOKEN"
# Expected: matching documents with context snippets
```

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Documents/asuite
git add gateway/server.js
git commit -m "feat(gateway): add FTS5 full-text search for documents"
```

---

## Task 6: Shell — New Document API Client

**Files:**
- Create: `shell/src/lib/api/documents.ts`

This replaces `shell/src/lib/api/outline.ts` with a Gateway-backed client.

- [ ] **Step 1: Create documents.ts**

```typescript
/**
 * Documents API client — calls through /api/gateway/* proxy to Gateway SQLite
 * Replaces the old Outline API client (outline.ts)
 */

const BASE = '/api/gateway';

async function docFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`Documents API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface Document {
  id: string;
  title: string;
  text: string;
  data_json?: any;
  icon?: string | null;
  full_width: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Revision {
  id: string;
  documentId: string;
  title: string;
  data: any; // ProseMirror JSON
  createdAt: string;
  createdBy: { id: string; name: string };
}

export interface Comment {
  id: string;
  documentId: string;
  parentCommentId: string | null;
  data: any; // ProseMirror JSON
  createdById: string;
  createdBy: { id: string; name: string };
  resolvedById: string | null;
  resolvedBy?: { id: string; name: string } | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Document CRUD ──

export async function getDocument(id: string): Promise<Document> {
  return docFetch(`/documents/${id}`);
}

export async function updateDocument(
  id: string,
  title?: string,
  text?: string,
  icon?: string | null,
  opts?: { fullWidth?: boolean }
): Promise<Document> {
  const body: Record<string, unknown> = {};
  if (title !== undefined) body.title = title;
  if (text !== undefined) body.text = text;
  if (icon !== undefined) body.icon = icon;
  if (opts?.fullWidth !== undefined) body.full_width = opts.fullWidth;
  return docFetch(`/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await docFetch(`/documents/${id}`, { method: 'DELETE' });
}

export async function searchDocuments(query: string): Promise<{ document: Document; context: string }[]> {
  const data = await docFetch<{ data: { document: Document; context: string }[] }>(
    `/documents/search?q=${encodeURIComponent(query)}`
  );
  return data.data;
}

// ── Revisions ──

export async function listRevisions(documentId: string): Promise<Revision[]> {
  const data = await docFetch<{ data: Revision[] }>(`/documents/${documentId}/revisions`);
  return data.data;
}

export async function restoreRevision(documentId: string, revisionId: string): Promise<Document> {
  return docFetch(`/documents/${documentId}/revisions/${revisionId}/restore`, {
    method: 'POST',
  });
}

// ── Comments ──

export async function listComments(documentId: string): Promise<Comment[]> {
  const data = await docFetch<{ data: Comment[] }>(`/documents/${documentId}/comments`);
  return data.data;
}

export async function createComment(documentId: string, data: any, parentCommentId?: string): Promise<Comment> {
  const body: Record<string, unknown> = { data };
  if (parentCommentId) body.parent_comment_id = parentCommentId;
  const res = await docFetch<{ data: Comment }>(`/documents/${documentId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function updateComment(id: string, data: any): Promise<void> {
  await docFetch(`/documents/comments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

export async function deleteComment(id: string): Promise<void> {
  await docFetch(`/documents/comments/${id}`, { method: 'DELETE' });
}

export async function resolveComment(id: string): Promise<void> {
  await docFetch(`/documents/comments/${id}/resolve`, { method: 'POST' });
}

export async function unresolveComment(id: string): Promise<void> {
  await docFetch(`/documents/comments/${id}/unresolve`, { method: 'POST' });
}

// ── File Upload ──

export async function uploadFile(file: File, _documentId?: string): Promise<{ url: string; name: string; size: number }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/uploads`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  // Return URL through gateway proxy
  return { url: `${BASE}${data.url.startsWith('/api/') ? data.url.slice(4) : data.url}`, name: data.name, size: data.size };
}

// ── ProseMirror Helpers ──

/** Convert plain text to ProseMirror JSON suitable for comments */
export function textToProseMirror(text: string): any {
  const lines = text.split('\n');
  const content = lines.map(line => {
    if (!line) return { type: 'paragraph' };
    const parts: any[] = [];
    const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let lastIdx = 0;
    let match;
    while ((match = imgRe.exec(line)) !== null) {
      if (match.index > lastIdx) {
        parts.push({ type: 'text', text: line.slice(lastIdx, match.index) });
      }
      parts.push({ type: 'image', attrs: { src: match[2], alt: match[1] } });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < line.length) {
      parts.push({ type: 'text', text: line.slice(lastIdx) });
    }
    if (parts.length === 0) return { type: 'paragraph' };
    return { type: 'paragraph', content: parts };
  });
  return { type: 'doc', content };
}

/** Extract plain text from ProseMirror JSON */
export function proseMirrorToText(pmData: any): string {
  if (!pmData) return '';
  const extract = (node: any): string => {
    if (node.text) return node.text;
    if (node.type === 'image') return `![${node.attrs?.alt || ''}](${node.attrs?.src || ''})`;
    if (node.content) return node.content.map(extract).join('');
    return '';
  };
  if (pmData.content) {
    return pmData.content.map((block: any) => extract(block)).join('\n');
  }
  return extract(pmData);
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/lib/api/documents.ts
git commit -m "feat(shell): add documents API client for Gateway-backed document storage"
```

---

## Task 7: Shell — Replace Outline Calls in Content Page

**Files:**
- Modify: `shell/src/app/(workspace)/content/page.tsx`

This is the largest Shell-side change. Every `ol.*` call needs to be replaced with the new `doc.*` or `gw.*` API.

- [ ] **Step 1: Update imports**

Replace the Outline import with the new documents import:

```typescript
// Remove:
import * as ol from '@/lib/api/outline';
import type { OLDocument, OLComment, OLRevision } from '@/lib/api/outline';

// Add:
import * as doc from '@/lib/api/documents';
import type { Document as DocType, Comment as DocComment, Revision as DocRevision } from '@/lib/api/documents';
```

- [ ] **Step 2: Replace listCollections query**

Find the `useQuery` that calls `ol.listCollections` (~line 216) and remove it entirely. Collections are an Outline concept — we don't need them anymore. If the collections data was only used for creating documents (passing `collectionId`), this is no longer needed since Gateway handles doc creation without collection IDs.

- [ ] **Step 3: Replace searchDocuments query**

Find the search query (~line 229) and replace:

```typescript
// Old:
queryFn: () => ol.searchDocuments(searchQuery),
// New:
queryFn: () => doc.searchDocuments(searchQuery),
```

- [ ] **Step 4: Replace getDocument query**

Find the document fetch query (~line 242) and replace:

```typescript
// Old:
queryFn: () => ol.getDocument(selectedDocId!),
// New:
queryFn: () => doc.getDocument(selectedDocId!),
```

Also update the query key from `['outline-doc', ...]` to `['document', ...]`.

Update the type from `OLDocument` to `DocType` everywhere it's used.

- [ ] **Step 5: Replace moveDocument calls**

Find all `ol.moveDocument(...)` calls (~lines 784, 843, 847). These handle tree drag-and-drop. Since we no longer need to sync moves to Outline (content_items tree handles this), remove the Outline move calls:

```typescript
// Old:
ol.moveDocument(activeNode.rawId, overNode.rawId).catch(e => console.error('Move doc failed:', e));
// New: (just update content_items tree, which is already done by the DnD handler)
// Remove the ol.moveDocument calls entirely — content_items tree update is sufficient
```

- [ ] **Step 6: Replace uploadAttachment calls**

Find all `ol.uploadAttachment(...)` calls (~lines 1599, 2333, 2400) and replace:

```typescript
// Old:
const result = await ol.uploadAttachment(file, node.rawId);
// New:
const result = await doc.uploadFile(file, node.rawId);
// Note: result format changes from { data: { url, name, size } } to { url, name, size }
// Update the destructuring accordingly
```

- [ ] **Step 7: Replace updateDocument calls**

Find all `ol.updateDocument(...)` calls (~lines 2046, 2097, 2230) and replace:

```typescript
// Old:
const savedDoc = await ol.updateDocument(saveDocId, titleToSave, savingText, outlineEmoji);
// New:
const savedDoc = await doc.updateDocument(saveDocId, titleToSave, savingText, iconValue);

// Old (fullWidth toggle):
await ol.updateDocument(doc.id, undefined, undefined, undefined, { fullWidth: v });
// New:
await doc.updateDocument(docData.id, undefined, undefined, undefined, { fullWidth: v });

// Old (mark done):
ol.updateDocument(docId, undefined, undefined, undefined, { done: true }).catch(() => {});
// New: Remove this — "done" is an Outline-specific feature. Or add a done field if needed.
```

- [ ] **Step 8: Replace comment operations**

Find all comment-related `ol.*` calls and replace:

```typescript
// Old:
const comments = await ol.listComments(doc.id);
// New:
const comments = await doc.listComments(doc.id);

// Old (in comment mapping):
text: ol.proseMirrorToText(c.data),
// New:
text: doc.proseMirrorToText(c.data),

// Old:
await ol.updateComment(commentId, ol.textToProseMirror(text));
// New:
await doc.updateComment(commentId, doc.textToProseMirror(text));

// Old:
await ol.deleteComment(commentId);
// New:
await doc.deleteComment(commentId);

// Old:
await ol.resolveComment(commentId);
// New:
await doc.resolveComment(commentId);

// Old:
await ol.unresolveComment(commentId);
// New:
await doc.unresolveComment(commentId);
```

- [ ] **Step 9: Replace revision restore callback**

Find the `onRestored` callback for RevisionHistory (~line 2422):

```typescript
// Old:
const restored = await queryClient.fetchQuery({ queryKey: ['outline-doc', doc.id], queryFn: () => ol.getDocument(doc.id) });
// New:
const restored = await queryClient.fetchQuery({ queryKey: ['document', doc.id], queryFn: () => doc.getDocument(doc.id) });
```

- [ ] **Step 10: Update type references**

Search for all `OLDocument`, `OLComment`, `OLRevision` type references in the file and replace with `DocType`, `DocComment`, `DocRevision` (or adjust property access as the field names may differ slightly — e.g., `doc.updatedAt` vs `doc.updated_at`, `doc.fullWidth` vs `doc.full_width`).

Key field mapping:
- `OLDocument.text` → `DocType.text` (same)
- `OLDocument.updatedAt` → `DocType.updated_at`
- `OLDocument.createdAt` → `DocType.created_at`
- `OLDocument.fullWidth` → `DocType.full_width`
- `OLDocument.icon` or `OLDocument.emoji` → `DocType.icon`
- `OLDocument.updatedBy.name` → `DocType.updated_by`
- `OLDocument.createdBy.name` → `DocType.created_by`
- `OLComment.parentCommentId` → `DocComment.parentCommentId` (same)
- `OLComment.resolvedAt` → `DocComment.resolvedAt` (same)

- [ ] **Step 11: Build and verify**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
# Expected: No build errors
```

- [ ] **Step 12: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/app/\(workspace\)/content/page.tsx
git commit -m "feat(shell): replace all Outline API calls with Gateway document API in content page"
```

---

## Task 8: Shell — Update RevisionHistory Component

**Files:**
- Modify: `shell/src/components/RevisionHistory.tsx`

- [ ] **Step 1: Update imports and types**

```typescript
// Old:
import * as ol from '@/lib/api/outline';
import type { OLRevision, OLDocument } from '@/lib/api/outline';

// New:
import * as doc from '@/lib/api/documents';
import type { Revision, Document as DocType } from '@/lib/api/documents';
```

- [ ] **Step 2: Update Props type**

```typescript
interface Props {
  doc: DocType;  // was OLDocument
  onClose: () => void;
  onRestored: () => void | Promise<void>;
  onSelect: (revision: Revision | null, prevRevision: Revision | null) => void;  // was OLRevision
  highlightChanges: boolean;
  onHighlightChangesToggle: () => void;
}
```

- [ ] **Step 3: Update API calls**

```typescript
// Old:
ol.listRevisions(doc.id)
// New:
doc.listRevisions(doc.id)

// Old:
await ol.restoreRevision(doc.id, selectedId);
// New:
await doc.restoreRevision(doc.id, selectedId);
```

- [ ] **Step 4: Update field access**

```typescript
// Old: doc.updatedAt, doc.updatedBy?.name
// New: doc.updated_at, doc.updated_by

// Old: rev.createdBy?.name, rev.createdAt
// New: rev.createdBy?.name, rev.createdAt
// (revision fields stay camelCase from the API response)
```

- [ ] **Step 5: Update state type**

```typescript
const [revisions, setRevisions] = useState<Revision[]>([]);  // was OLRevision[]
```

- [ ] **Step 6: Build and verify**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
```

- [ ] **Step 7: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/RevisionHistory.tsx
git commit -m "feat(shell): update RevisionHistory to use Gateway document API"
```

---

## Task 9: Shell — Delete Outline Files & Update Gateway Proxy

**Files:**
- Delete: `shell/src/lib/api/outline.ts`
- Delete: `shell/src/app/api/outline/[...path]/route.ts`
- Modify: `shell/src/app/api/gateway/[...path]/route.ts` (add Cache-Control for uploads)

- [ ] **Step 1: Delete outline.ts**

```bash
rm /Users/mac/Documents/asuite/shell/src/lib/api/outline.ts
```

- [ ] **Step 2: Delete Outline proxy route**

```bash
rm -r /Users/mac/Documents/asuite/shell/src/app/api/outline/
```

- [ ] **Step 3: Update Gateway proxy to handle upload responses with caching**

In `shell/src/app/api/gateway/[...path]/route.ts`, update the response handler to add cache headers for uploaded files:

```typescript
  const contentType = resp.headers.get('Content-Type') || 'application/json';
  const headers: Record<string, string> = { 'Content-Type': contentType };

  // Cache uploaded files (images, etc.)
  if (pathParts[0] === 'uploads' && (contentType.startsWith('image/') || contentType.startsWith('application/'))) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  return new NextResponse(data, { status: resp.status, headers });
```

- [ ] **Step 4: Verify no remaining Outline references in Shell**

```bash
cd /Users/mac/Documents/asuite/shell
grep -r "outline" src/ --include="*.ts" --include="*.tsx" -l
# Expected: No files (or only irrelevant mentions)

grep -r "from.*outline" src/ --include="*.ts" --include="*.tsx"
# Expected: No results
```

- [ ] **Step 5: Build and verify**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
# Expected: No build errors
```

- [ ] **Step 6: Commit**

```bash
cd /Users/mac/Documents/asuite
git add -A shell/src/lib/api/outline.ts shell/src/app/api/outline/ shell/src/app/api/gateway/
git commit -m "chore(shell): remove Outline proxy route and API client, update gateway proxy for uploads"
```

---

## Task 10: Data Migration Script

**Files:**
- Create: `gateway/scripts/migrate-outline-docs.js`

This script migrates existing documents, revisions, comments, and attachments from Outline to Gateway SQLite.

- [ ] **Step 1: Create migration script**

```javascript
#!/usr/bin/env node
/**
 * Migrate all documents, revisions, comments, and attachments from Outline to Gateway SQLite.
 * Run once: node scripts/migrate-outline-docs.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const OL_URL = process.env.OL_URL || 'http://localhost:3000';
const OL_TOKEN = process.env.OL_TOKEN;
const DB_PATH = path.join(__dirname, '..', 'gateway.db');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

if (!OL_TOKEN) {
  console.error('Set OL_TOKEN environment variable');
  process.exit(1);
}

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(DB_PATH);

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function olFetch(endpoint, body = {}) {
  const resp = await fetch(`${OL_URL}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Outline ${endpoint}: ${resp.status}`);
  return resp.json();
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'Authorization': `Bearer ${OL_TOKEN}` } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      const ws = fs.createWriteStream(destPath);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(); });
      ws.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Outline → Gateway Migration ===\n');

  // 1. Migrate documents
  console.log('1. Migrating documents...');
  let offset = 0, docCount = 0;
  const insertDoc = db.prepare(`INSERT OR REPLACE INTO documents (id, title, text, icon, full_width, created_by, updated_by, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  while (true) {
    const data = await olFetch('documents.list', { limit: 100, offset, sort: 'updatedAt', direction: 'DESC' });
    if (!data.data?.length) break;
    for (const d of data.data) {
      // Fetch full text
      const full = await olFetch('documents.info', { id: d.id });
      const doc = full.data;
      insertDoc.run(
        doc.id, doc.title, doc.text, doc.icon || doc.emoji || null,
        doc.fullWidth ? 1 : 0,
        doc.createdBy?.name || null, doc.updatedBy?.name || null,
        doc.createdAt, doc.updatedAt, doc.deletedAt || null
      );
      docCount++;
      process.stdout.write(`  Documents: ${docCount}\r`);
    }
    if (data.data.length < 100) break;
    offset += 100;
  }
  console.log(`  Documents: ${docCount} migrated`);

  // 2. Migrate revisions
  console.log('2. Migrating revisions...');
  let revCount = 0;
  const insertRev = db.prepare(`INSERT OR REPLACE INTO document_revisions (id, document_id, title, data_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const allDocs = db.prepare('SELECT id FROM documents').all();
  for (const { id: docId } of allDocs) {
    try {
      const data = await olFetch('revisions.list', { documentId: docId });
      for (const rev of (data.data || [])) {
        insertRev.run(rev.id, docId, rev.title, JSON.stringify(rev.data), rev.createdBy?.name || null, rev.createdAt);
        revCount++;
      }
    } catch (e) {
      console.warn(`  Warn: revisions for ${docId}: ${e.message}`);
    }
  }
  console.log(`  Revisions: ${revCount} migrated`);

  // 3. Migrate comments
  console.log('3. Migrating comments...');
  let cmtCount = 0;
  const insertCmt = db.prepare(`INSERT OR REPLACE INTO document_comments (id, document_id, parent_id, data_json, actor, actor_id, resolved_by, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const { id: docId } of allDocs) {
    try {
      const data = await olFetch('comments.list', { documentId: docId });
      for (const c of (data.data || [])) {
        insertCmt.run(c.id, docId, c.parentCommentId || null, JSON.stringify(c.data),
          c.createdBy?.name || 'Unknown', c.createdById || null,
          c.resolvedBy?.name || null, c.resolvedAt || null,
          c.createdAt, c.updatedAt);
        cmtCount++;
      }
    } catch (e) {
      console.warn(`  Warn: comments for ${docId}: ${e.message}`);
    }
  }
  console.log(`  Comments: ${cmtCount} migrated`);

  // 4. Download and rewrite attachment URLs
  console.log('4. Migrating attachments...');
  let attCount = 0;
  const urlMap = {};

  // Find all Outline attachment URLs in documents
  const allDocsText = db.prepare('SELECT id, text FROM documents').all();
  const urlRegex = /(?:\/api\/outline\/attachments\/[^\s)]+|https?:\/\/[^\s)]*\/api\/attachments\.[^\s)]+)/g;

  for (const { id: docId, text } of allDocsText) {
    const matches = text.match(urlRegex);
    if (!matches) continue;
    for (const url of [...new Set(matches)]) {
      if (urlMap[url]) continue;
      try {
        const ext = path.extname(url.split('?')[0]) || '.bin';
        const filename = `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        const fullUrl = url.startsWith('http') ? url : `${OL_URL}${url.replace('/api/outline/', '/api/')}`;
        await downloadFile(fullUrl, path.join(UPLOADS_DIR, filename));
        urlMap[url] = `/api/uploads/${filename}`;
        attCount++;
        process.stdout.write(`  Attachments: ${attCount}\r`);
      } catch (e) {
        console.warn(`  Warn: download ${url}: ${e.message}`);
      }
    }
  }

  // Rewrite URLs in documents
  if (Object.keys(urlMap).length > 0) {
    console.log(`\n  Rewriting URLs in documents...`);
    const updateText = db.prepare('UPDATE documents SET text = ? WHERE id = ?');
    for (const { id: docId, text } of allDocsText) {
      let newText = text;
      for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
        newText = newText.split(oldUrl).join(newUrl);
      }
      if (newText !== text) {
        updateText.run(newText, docId);
      }
    }

    // Also rewrite in comments (ProseMirror JSON may contain image URLs)
    console.log('  Rewriting URLs in comments...');
    const allComments = db.prepare('SELECT id, data_json FROM document_comments WHERE data_json IS NOT NULL').all();
    const updateCmt = db.prepare('UPDATE document_comments SET data_json = ? WHERE id = ?');
    for (const { id: cmtId, data_json } of allComments) {
      let newJson = data_json;
      for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
        newJson = newJson.split(oldUrl).join(newUrl);
      }
      if (newJson !== data_json) {
        updateCmt.run(newJson, cmtId);
      }
    }
  }
  console.log(`  Attachments: ${attCount} downloaded and URLs rewritten`);

  // 5. Rebuild FTS index
  console.log('5. Rebuilding FTS index...');
  try {
    db.exec("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')");
    console.log('  FTS index rebuilt');
  } catch (e) {
    console.warn(`  FTS rebuild: ${e.message} (may need to run gateway first to create FTS table)`);
  }

  console.log('\n=== Migration complete ===');
  db.close();
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
```

- [ ] **Step 2: Test migration script (dry run)**

```bash
cd /Users/mac/Documents/asuite/gateway
OL_URL=http://localhost:3000 OL_TOKEN=<token> node scripts/migrate-outline-docs.js
# Expected: Documents, revisions, comments migrated with counts
```

- [ ] **Step 3: Commit**

```bash
cd /Users/mac/Documents/asuite
git add gateway/scripts/migrate-outline-docs.js
git commit -m "feat(gateway): add Outline to Gateway migration script for docs, revisions, comments, attachments"
```

---

## Task 11: End-to-End Verification & Cleanup

**Files:**
- Modify: `gateway/server.js` (remove any remaining Outline references)
- Modify: `docker-compose.yml` (optionally comment out Outline service)

- [ ] **Step 1: Verify no Outline references remain in Gateway**

```bash
cd /Users/mac/Documents/asuite
grep -n "OL_URL\|OL_TOKEN\|outline" gateway/server.js -i
# Expected: No matches (or only comments explaining the removal)
```

- [ ] **Step 2: Verify no Outline references remain in Shell**

```bash
grep -rn "outline" shell/src/ --include="*.ts" --include="*.tsx" -i
# Expected: No matches
```

- [ ] **Step 3: Build both services**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
# Expected: Success

cd /Users/mac/Documents/asuite/gateway && node -e "require('./server.js')" &
# Expected: Starts without errors, then kill it
```

- [ ] **Step 4: Restart services and verify in browser**

```bash
cd /Users/mac/Documents/asuite/gateway && pm2 restart asuite-gateway
cd /Users/mac/Documents/asuite/shell && npm run build && pm2 restart asuite-shell
```

Then verify in browser at http://localhost:3101:
- Create a new document → should save to Gateway SQLite
- Edit document content → should auto-save
- Open version history → should show revisions
- Add a comment → should appear in comment panel
- Upload an image in editor → should upload via Gateway
- Search documents → should use FTS5
- Delete a document → should move to trash
- Restore from trash → should work

- [ ] **Step 5: Final commit**

```bash
cd /Users/mac/Documents/asuite
git add -A
git commit -m "chore: remove remaining Outline references, complete migration to Gateway document storage"
```
