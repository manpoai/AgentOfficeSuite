#!/usr/bin/env node
/**
 * ASuite API Gateway
 * Implements Agent接入协议v1: registration, messages, docs, tasks, events
 * Routes operations to Mattermost / Outline / Plane
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.GATEWAY_PORT || 4000;

// Upstream service URLs and tokens
const MM_URL = process.env.MM_URL || 'http://localhost:8065';
const MM_ADMIN_TOKEN = process.env.MM_ADMIN_TOKEN;
const OL_URL = process.env.OL_URL || 'http://localhost:3000';
const OL_TOKEN = process.env.OL_TOKEN;
const PLANE_URL = process.env.PLANE_URL || 'http://localhost:8000';
const PLANE_TOKEN = process.env.PLANE_TOKEN;
const PLANE_WORKSPACE = process.env.PLANE_WORKSPACE || 'asuite';
const PLANE_PROJECT_ID = process.env.PLANE_PROJECT_ID;
const NC_URL = process.env.NOCODB_URL || 'http://localhost:8080';
const NC_EMAIL = process.env.NOCODB_EMAIL;
const NC_PASSWORD = process.env.NOCODB_PASSWORD;
const NC_BASE_ID = process.env.NOCODB_BASE_ID || 'pgw03v3ek2obunx';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');

// ─── Database ────────────────────────────────────
const DB_PATH = process.env.GATEWAY_DB_PATH || path.join(__dirname, 'gateway.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
const schema = fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf8');
db.exec(schema);

// Migrate: add nc_password column if not present
try {
  db.exec('ALTER TABLE agent_accounts ADD COLUMN nc_password TEXT');
  console.log('[gateway] DB migrated: added nc_password column');
} catch { /* already exists */ }

// Migrate: add pending_approval column
try {
  db.exec('ALTER TABLE agent_accounts ADD COLUMN pending_approval INTEGER DEFAULT 0');
  console.log('[gateway] DB migrated: added pending_approval column');
} catch { /* already exists */ }

// Migrate: add avatar_url column
try {
  db.exec('ALTER TABLE agent_accounts ADD COLUMN avatar_url TEXT');
  console.log('[gateway] DB migrated: added avatar_url column');
} catch { /* already exists */ }

// Migrate: create table_snapshots table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS table_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    schema_json TEXT NOT NULL,
    data_json TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    agent TEXT,
    row_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_snapshots_table ON table_snapshots(table_id, version DESC)');
} catch { /* already exists */ }

// Migrate: create thread_links table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS thread_links (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, link_type TEXT NOT NULL,
    link_id TEXT NOT NULL, link_title TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_thread_links_thread ON thread_links(thread_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_thread_links_link ON thread_links(link_type, link_id)');
} catch { /* already exists */ }

// Migrate: create boards table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL DEFAULT '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}',
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
} catch { /* already exists */ }

// Migrate: create presentations table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS presentations (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL DEFAULT '{"slides":[]}',
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
} catch { /* already exists */ }

// Migrate: create spreadsheets table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS spreadsheets (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
} catch { /* already exists */ }

// Migrate: create diagrams table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS diagrams (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}',
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
} catch { /* already exists */ }

// ─── Helpers ─────────────────────────────────────
function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function upstream(baseUrl, method, apiPath, body, token, extraHeaders = {}) {
  const url = `${baseUrl}${apiPath}`;
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (extraHeaders['X-API-Key']) delete headers['Authorization'];

  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

// ─── Auth middleware ─────────────────────────────
function authenticateAgent(req, res, next) {
  const auth = req.headers.authorization;
  const queryToken = req.query.token;
  let token;
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7);
  } else if (queryToken) {
    token = queryToken;
  } else {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Bearer token' });
  }
  const hash = hashToken(token);
  const agent = db.prepare('SELECT * FROM agent_accounts WHERE token_hash = ?').get(hash);
  if (!agent) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token' });
  }
  // Update last_seen
  db.prepare('UPDATE agent_accounts SET last_seen_at = ?, online = 1 WHERE id = ?')
    .run(Date.now(), agent.id);
  req.agent = agent;
  next();
}

function authenticateAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ') || auth.slice(7) !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin token' });
  }
  next();
}

// ─── App ─────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '5mb' }));

// ─── Admin: Create ticket ────────────────────────
app.post('/api/admin/tickets', authenticateAdmin, (req, res) => {
  const { label, expires_in = 86400 } = req.body;
  const id = `tkt_${crypto.randomBytes(16).toString('hex')}`;
  const now = Date.now();
  db.prepare('INSERT INTO tickets (id, label, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(id, label || '', now + expires_in * 1000, now);
  res.json({ ticket: id, expires_at: now + expires_in * 1000 });
});

// ─── Auth: Register agent ────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { ticket, name, display_name, capabilities, webhook_url, webhook_secret } = req.body;
  if (!ticket || !name || !display_name) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'ticket, name, display_name required' });
  }
  // Validate ticket
  const tkt = db.prepare('SELECT * FROM tickets WHERE id = ? AND used = 0').get(ticket);
  if (!tkt) {
    return res.status(400).json({ error: 'INVALID_TICKET', message: 'Ticket not found or already used' });
  }
  if (Date.now() > tkt.expires_at) {
    return res.status(400).json({ error: 'TICKET_EXPIRED', message: 'Ticket has expired' });
  }
  // Check name uniqueness
  const existing = db.prepare('SELECT id FROM agent_accounts WHERE name = ?').get(name);
  if (existing) {
    return res.status(409).json({ error: 'NAME_TAKEN', message: `Name "${name}" already registered` });
  }
  // Create agent
  const agentId = genId('agt');
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  db.prepare(`INSERT INTO agent_accounts (id, name, display_name, token_hash, capabilities, webhook_url, webhook_secret, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(agentId, name, display_name, hashToken(token), JSON.stringify(capabilities || []),
      webhook_url || null, webhook_secret || null, now, now);

  // Mark ticket used
  db.prepare('UPDATE tickets SET used = 1 WHERE id = ?').run(ticket);

  // Create a Mattermost bot account for this agent
  createMMBot(name, display_name).catch(e => console.warn(`[gateway] MM bot creation failed: ${e.message}`));

  // Create a NocoDB user for this agent
  createNcUser(name, display_name).then(ncPassword => {
    if (ncPassword) {
      db.prepare('UPDATE agent_accounts SET nc_password = ? WHERE id = ?').run(ncPassword, agentId);
    }
  }).catch(e => console.warn(`[gateway] NC user creation failed: ${e.message}`));

  res.json({ agent_id: agentId, token, name, display_name, created_at: now });
});

// ─── Auth: Verify ────────────────────────────────
app.get('/api/me', authenticateAgent, (req, res) => {
  const a = req.agent;
  res.json({
    agent_id: a.id, name: a.name, display_name: a.display_name,
    capabilities: JSON.parse(a.capabilities || '[]'),
    webhook_url: a.webhook_url, online: !!a.online, last_seen_at: a.last_seen_at,
  });
});

// ─── Messages (Mattermost) ──────────────────────
app.post('/api/messages', authenticateAgent, async (req, res) => {
  const { channel_id, text, thread_id } = req.body;
  if (!channel_id || !text) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'channel_id and text required' });
  }
  // Get bot token for this agent
  const botToken = await getMMBotToken(req.agent.name);
  if (!botToken) {
    return res.status(500).json({ error: 'BOT_NOT_CONFIGURED', message: 'No Mattermost bot for this agent' });
  }

  const post = { channel_id, message: text };
  if (thread_id) post.root_id = thread_id;

  const result = await upstream(MM_URL, 'POST', '/api/v4/posts', post, botToken);
  if (result.status >= 400) {
    return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  res.json({ message_id: result.data.id, channel_id: result.data.channel_id, created_at: result.data.create_at });
});

// List channels visible to this agent's bot
app.get('/api/channels', authenticateAgent, async (req, res) => {
  const botToken = await getMMBotToken(req.agent.name);
  if (!botToken) {
    return res.status(500).json({ error: 'BOT_NOT_CONFIGURED', message: 'No Mattermost bot for this agent' });
  }
  const botInfo = mmBotTokens.get(req.agent.name);
  if (!botInfo) return res.status(500).json({ error: 'BOT_NOT_CONFIGURED' });

  // Get bot's teams first
  const teamsRes = await upstream(MM_URL, 'GET', `/api/v4/users/${botInfo.userId}/teams`, null, botToken);
  if (!Array.isArray(teamsRes.data) || teamsRes.data.length === 0) {
    return res.json({ channels: [] });
  }
  const teamId = teamsRes.data[0].id;

  const limit = Math.min(parseInt(req.query.limit || '50'), 200);
  const channelsRes = await upstream(MM_URL, 'GET',
    `/api/v4/users/${botInfo.userId}/teams/${teamId}/channels?per_page=${limit}`, null, botToken);
  if (channelsRes.status >= 400) {
    return res.status(channelsRes.status).json({ error: 'UPSTREAM_ERROR', detail: channelsRes.data });
  }
  const channels = (channelsRes.data || []).map(ch => ({
    channel_id: ch.id, name: ch.name, display_name: ch.display_name,
    type: ch.type, // O=public, P=private, D=direct, G=group
    team_id: ch.team_id,
  }));
  res.json({ channels });
});

// Find channel by name
app.get('/api/channels/find', authenticateAgent, async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'MISSING_NAME', message: 'name query param required' });

  const botToken = await getMMBotToken(req.agent.name);
  if (!botToken) return res.status(500).json({ error: 'BOT_NOT_CONFIGURED' });
  const botInfo = mmBotTokens.get(req.agent.name);
  if (!botInfo) return res.status(500).json({ error: 'BOT_NOT_CONFIGURED' });

  const teamsRes = await upstream(MM_URL, 'GET', `/api/v4/users/${botInfo.userId}/teams`, null, botToken);
  if (!Array.isArray(teamsRes.data) || teamsRes.data.length === 0) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'No teams found' });
  }
  const teamId = teamsRes.data[0].id;

  const chRes = await upstream(MM_URL, 'GET', `/api/v4/teams/${teamId}/channels/name/${encodeURIComponent(name)}`, null, botToken);
  if (chRes.status >= 400) {
    return res.status(404).json({ error: 'NOT_FOUND', message: `Channel "${name}" not found` });
  }
  res.json({
    channel_id: chRes.data.id, name: chRes.data.name, display_name: chRes.data.display_name,
    type: chRes.data.type, team_id: chRes.data.team_id,
  });
});

// Read messages from a channel
app.get('/api/channels/:channel_id/messages', authenticateAgent, async (req, res) => {
  const botToken = await getMMBotToken(req.agent.name);
  if (!botToken) return res.status(500).json({ error: 'BOT_NOT_CONFIGURED' });

  const limit = Math.min(parseInt(req.query.limit || '30'), 100);
  const before = req.query.before || '';
  let apiPath = `/api/v4/channels/${req.params.channel_id}/posts?per_page=${limit}`;
  if (before) apiPath += `&before=${before}`;

  const result = await upstream(MM_URL, 'GET', apiPath, null, botToken);
  if (result.status >= 400) {
    return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  // MM returns { order: [id...], posts: { id: post } } — flatten to array
  const order = result.data.order || [];
  const posts = result.data.posts || {};
  const messages = order.map(id => {
    const p = posts[id];
    return {
      message_id: p.id, channel_id: p.channel_id, text: p.message,
      sender_id: p.user_id, thread_id: p.root_id || null,
      created_at: p.create_at, updated_at: p.update_at,
    };
  });
  res.json({ messages });
});

// ─── Docs (Outline) ─────────────────────────────
app.post('/api/docs', authenticateAgent, async (req, res) => {
  const { title, content_markdown, collection_id } = req.body;
  if (!title || !content_markdown) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title and content_markdown required' });
  }
  const agentOlToken = req.agent.ol_token || OL_TOKEN;
  const body = { title, text: content_markdown, publish: true };
  if (collection_id) body.collectionId = collection_id;

  const result = await upstream(OL_URL, 'POST', '/api/documents.create', body, agentOlToken);
  if (!result.data?.ok) {
    return res.status(500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  // Also write to content_items so sidebar is up to date
  const doc = result.data.data;
  const nodeId = `doc:${doc.id}`;
  contentItemsUpsert.run(
    nodeId, doc.id, 'doc', title,
    null, doc.parentDocumentId ? `doc:${doc.parentDocumentId}` : null,
    doc.collectionId || collection_id || null,
    doc.createdBy?.name || req.agent?.name || null, doc.updatedBy?.name || req.agent?.name || null,
    doc.createdAt || new Date().toISOString(), doc.updatedAt || new Date().toISOString(), null, Date.now()
  );

  res.status(201).json({
    doc_id: doc.id,
    url: `${OL_URL}${doc.url}`,
    created_at: new Date(doc.createdAt).getTime(),
  });
});

app.patch('/api/docs/:doc_id', authenticateAgent, async (req, res) => {
  const { title, content_markdown } = req.body;
  const agentOlToken = req.agent.ol_token || OL_TOKEN;
  const body = { id: req.params.doc_id };
  if (title) body.title = title;
  if (content_markdown) body.text = content_markdown;

  const result = await upstream(OL_URL, 'POST', '/api/documents.update', body, agentOlToken);
  if (!result.data?.ok) {
    return res.status(result.data?.status || 500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  // Sync title change to content_items if title was updated
  if (title) {
    db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
      .run(title, result.data.data.updatedAt || new Date().toISOString(), req.params.doc_id, 'doc');
  }

  res.json({ doc_id: result.data.data.id, updated_at: new Date(result.data.data.updatedAt).getTime() });
});

// ─── Comments (Outline) ─────────────────────────
app.post('/api/comments', authenticateAgent, async (req, res) => {
  const { doc_id, text, parent_comment_id } = req.body;
  if (!doc_id || !text) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'doc_id and text required' });
  }
  const agentOlToken = req.agent.ol_token || OL_TOKEN;
  const body = {
    documentId: doc_id,
    data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  };
  if (parent_comment_id) body.parentCommentId = parent_comment_id;

  const result = await upstream(OL_URL, 'POST', '/api/comments.create', body, agentOlToken);
  if (!result.data?.ok) {
    return res.status(500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  res.status(201).json({
    comment_id: result.data.data.id,
    doc_id,
    created_at: new Date(result.data.data.createdAt).getTime(),
  });
});

// List document comments
app.get('/api/docs/:doc_id/comments', authenticateAgent, async (req, res) => {
  const agentOlToken = req.agent.ol_token || OL_TOKEN;
  const result = await upstream(OL_URL, 'POST', '/api/comments.list', { documentId: req.params.doc_id }, agentOlToken);
  if (!result.data?.ok) {
    return res.status(500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  const comments = (result.data.data || []).map(c => ({
    id: c.id,
    text: extractTextFromProseMirror(c.data),
    actor: c.createdBy?.name || 'Unknown',
    parent_id: c.parentCommentId || null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  }));
  res.json({ comments });
});

function extractTextFromProseMirror(pmData) {
  if (!pmData) return '';
  const extract = (node) => {
    if (node.text) return node.text;
    if (node.content) return node.content.map(extract).join('');
    return '';
  };
  return extract(pmData);
}

// Read a single document
app.get('/api/docs/:doc_id', authenticateAgent, async (req, res) => {
  const agentOlToken = req.agent.ol_token || OL_TOKEN;
  const result = await upstream(OL_URL, 'POST', '/api/documents.info', { id: req.params.doc_id }, agentOlToken);
  if (!result.data?.ok) {
    return res.status(result.data?.status || 404).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  const d = result.data.data;
  res.json({
    doc_id: d.id, title: d.title, content_markdown: d.text,
    url: `${OL_URL}${d.url}`, collection_id: d.collectionId,
    created_at: new Date(d.createdAt).getTime(),
    updated_at: new Date(d.updatedAt).getTime(),
  });
});

// List/search documents
app.get('/api/docs', authenticateAgent, async (req, res) => {
  const agentOlToken = req.agent.ol_token || OL_TOKEN;
  const { query, collection_id, limit = '25' } = req.query;

  let result;
  if (query) {
    // Search
    const body = { query, limit: Math.min(parseInt(limit), 25) };
    if (collection_id) body.collectionId = collection_id;
    result = await upstream(OL_URL, 'POST', '/api/documents.search', body, agentOlToken);
    if (!result.data?.ok) {
      return res.status(500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    }
    const docs = (result.data.data || []).map(item => ({
      doc_id: item.document.id, title: item.document.title,
      url: `${OL_URL}${item.document.url}`,
      snippet: item.context, // search context snippet
      collection_id: item.document.collectionId,
      updated_at: new Date(item.document.updatedAt).getTime(),
    }));
    res.json({ docs });
  } else {
    // List recent
    const body = { limit: Math.min(parseInt(limit), 25), sort: 'updatedAt', direction: 'DESC' };
    if (collection_id) body.collectionId = collection_id;
    result = await upstream(OL_URL, 'POST', '/api/documents.list', body, agentOlToken);
    if (!result.data?.ok) {
      return res.status(500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    }
    const docs = (result.data.data || []).map(d => ({
      doc_id: d.id, title: d.title, url: `${OL_URL}${d.url}`,
      collection_id: d.collectionId,
      updated_at: new Date(d.updatedAt).getTime(),
    }));
    res.json({ docs });
  }
});

// ─── Tasks (Plane) ──────────────────────────────
app.post('/api/tasks', authenticateAgent, async (req, res) => {
  const { title, description, context, assignee_name, parent_task_id, priority, start_date, target_date } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
  }
  const agentPlaneToken = req.agent.plane_token || PLANE_TOKEN;
  const body = { name: title };
  // Combine description and context into description_html
  // context is used for agent-to-agent delegation: provides background the assignee needs
  const fullDescription = [description, context ? `---\nContext from ${req.agent.name}:\n${context}` : '']
    .filter(Boolean).join('\n\n');
  if (fullDescription) body.description_html = `<p>${fullDescription.replace(/\n/g, '</p><p>')}</p>`;
  if (priority) body.priority = priority;
  if (parent_task_id) body.parent = parent_task_id;
  if (start_date) body.start_date = start_date;
  if (target_date) body.target_date = target_date;

  // Resolve assignee: if assignee_name given, find their Plane user ID
  if (assignee_name) {
    const assigneeAgent = db.prepare('SELECT * FROM agent_accounts WHERE name = ?').get(assignee_name);
    if (assigneeAgent?.plane_token) {
      // Look up assignee's Plane user ID via their token
      const meRes = await upstream(PLANE_URL, 'GET',
        `/api/v1/users/me/`, null, null, { 'X-API-Key': assigneeAgent.plane_token });
      if (meRes.data?.id) body.assignees = [meRes.data.id];
    }
  }

  const apiPath = `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/`;
  const result = await upstream(PLANE_URL, 'POST', apiPath, body, null, { 'X-API-Key': agentPlaneToken });

  if (!result.data?.id) {
    return res.status(500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  res.status(201).json({
    task_id: result.data.id,
    title: result.data.name,
    url: `${PLANE_URL}/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${result.data.id}`,
    start_date: result.data.start_date || null,
    target_date: result.data.target_date || null,
    created_at: new Date(result.data.created_at).getTime(),
  });
});

app.patch('/api/tasks/:task_id/status', authenticateAgent, async (req, res) => {
  const { status } = req.body;
  // Map friendly status names to Plane state group names, then look up UUID
  const groupMap = { todo: 'unstarted', in_progress: 'started', done: 'completed', cancelled: 'cancelled' };
  const groupName = groupMap[status];
  if (!groupName) {
    return res.status(422).json({ error: 'INVALID_STATUS', message: `Valid: ${Object.keys(groupMap).join(', ')}` });
  }

  // Fetch project states to get the UUID for the requested group
  const statesRes = await upstream(PLANE_URL, 'GET',
    `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/states/`,
    null, null, { 'X-API-Key': PLANE_TOKEN });
  const states = statesRes.data?.results || statesRes.data || [];
  const state = states.find(s => s.group === groupName);
  if (!state) {
    return res.status(500).json({ error: 'STATE_NOT_FOUND', message: `No state with group "${groupName}"` });
  }

  const agentPlaneToken = req.agent.plane_token || PLANE_TOKEN;
  const apiPath = `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${req.params.task_id}/`;
  const result = await upstream(PLANE_URL, 'PATCH', apiPath, { state: state.id }, null, { 'X-API-Key': agentPlaneToken });

  if (!result.data?.id) {
    return res.status(result.status || 500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  res.json({ task_id: result.data.id, status, updated_at: Date.now() });
});

// General task update (title, description, priority, assignees, dates)
app.patch('/api/tasks/:task_id', authenticateAgent, async (req, res) => {
  const { title, description, priority, assignee_name, start_date, target_date } = req.body;
  const agentPlaneToken = req.agent.plane_token || PLANE_TOKEN;
  const body = {};

  if (title !== undefined) body.name = title;
  if (description !== undefined) body.description_html = `<p>${description.replace(/\n/g, '</p><p>')}</p>`;
  if (priority !== undefined) body.priority = priority;
  if (start_date !== undefined) body.start_date = start_date || null; // "YYYY-MM-DD" or null
  if (target_date !== undefined) body.target_date = target_date || null;

  // Resolve assignee by name → Plane user ID
  if (assignee_name !== undefined) {
    if (!assignee_name) {
      body.assignees = [];
    } else {
      const assigneeAgent = db.prepare('SELECT * FROM agent_accounts WHERE name = ?').get(assignee_name);
      if (assigneeAgent?.plane_token) {
        const meRes = await upstream(PLANE_URL, 'GET',
          `/api/v1/users/me/`, null, null, { 'X-API-Key': assigneeAgent.plane_token });
        if (meRes.data?.id) body.assignees = [meRes.data.id];
      }
    }
  }

  if (Object.keys(body).length === 0) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'No fields to update' });
  }

  const apiPath = `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${req.params.task_id}/`;
  const result = await upstream(PLANE_URL, 'PATCH', apiPath, body, null, { 'X-API-Key': agentPlaneToken });

  if (!result.data?.id) {
    return res.status(result.status || 500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  const i = result.data;
  res.json({
    task_id: i.id, title: i.name, status: i.state_detail?.group || null,
    priority: i.priority, start_date: i.start_date, target_date: i.target_date,
    assignees: i.assignee_details?.map(a => a.display_name) || [],
    updated_at: Date.now(),
  });
});

app.post('/api/tasks/:task_id/comments', authenticateAgent, async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });
  }
  const agentPlaneToken = req.agent.plane_token || PLANE_TOKEN;
  const apiPath = `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${req.params.task_id}/comments/`;
  const result = await upstream(PLANE_URL, 'POST', apiPath,
    { comment_html: `<p>${text}</p>` }, null, { 'X-API-Key': agentPlaneToken });

  if (!result.data?.id) {
    return res.status(500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  res.status(201).json({ comment_id: result.data.id, task_id: req.params.task_id, created_at: Date.now() });
});

// List task comments
app.get('/api/tasks/:task_id/comments', authenticateAgent, async (req, res) => {
  const agentPlaneToken = req.agent.plane_token || PLANE_TOKEN;
  const apiPath = `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${req.params.task_id}/comments/`;
  const result = await upstream(PLANE_URL, 'GET', apiPath, null, null, { 'X-API-Key': agentPlaneToken });
  const comments = (result.data?.results || result.data || []).map(c => ({
    id: c.id,
    text: (c.comment_stripped || c.comment_html || '').replace(/<[^>]+>/g, '').trim(),
    html: c.comment_html || '',
    actor: c.actor_detail?.display_name || c.actor_detail?.email || 'Unknown',
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));
  res.json({ comments });
});

// List tasks
app.get('/api/tasks', authenticateAgent, async (req, res) => {
  const agentPlaneToken = req.agent.plane_token || PLANE_TOKEN;
  const { status, assignee_name, limit = '25' } = req.query;

  let apiPath = `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/?per_page=${Math.min(parseInt(limit), 100)}`;

  // Plane API supports filters via query params
  if (status) {
    // Map friendly status to Plane state group
    const groupMap = { todo: 'unstarted', in_progress: 'started', done: 'completed', cancelled: 'cancelled' };
    const groupName = groupMap[status];
    if (groupName) apiPath += `&state__group__in=${groupName}`;
  }

  const result = await upstream(PLANE_URL, 'GET', apiPath, null, null, { 'X-API-Key': agentPlaneToken });
  if (result.status >= 400) {
    return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }

  // Plane v1 returns { results: [...] } or an array
  const issues = result.data?.results || result.data || [];
  let tasks = issues.map(i => ({
    task_id: i.id, title: i.name, status: i.state_detail?.group || null,
    priority: i.priority, assignees: i.assignee_details?.map(a => a.display_name) || [],
    start_date: i.start_date || null, target_date: i.target_date || null,
    url: `${PLANE_URL}/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${i.id}`,
    created_at: new Date(i.created_at).getTime(),
    updated_at: new Date(i.updated_at).getTime(),
  }));

  // Client-side filter by assignee_name if specified
  if (assignee_name) {
    const assigneeAgent = db.prepare('SELECT display_name FROM agent_accounts WHERE name = ?').get(assignee_name);
    const displayName = assigneeAgent?.display_name || assignee_name;
    tasks = tasks.filter(t => t.assignees.some(a =>
      a.toLowerCase() === displayName.toLowerCase() || a.toLowerCase() === assignee_name.toLowerCase()));
  }

  res.json({ tasks });
});

// Read a single task
app.get('/api/tasks/:task_id', authenticateAgent, async (req, res) => {
  const agentPlaneToken = req.agent.plane_token || PLANE_TOKEN;
  const apiPath = `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${req.params.task_id}/`;
  const result = await upstream(PLANE_URL, 'GET', apiPath, null, null, { 'X-API-Key': agentPlaneToken });
  if (result.status >= 400 || !result.data?.id) {
    return res.status(result.status || 404).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  }
  const i = result.data;
  res.json({
    task_id: i.id, title: i.name, description: i.description_stripped || i.description || '',
    status: i.state_detail?.group || null, priority: i.priority,
    assignees: i.assignee_details?.map(a => a.display_name) || [],
    start_date: i.start_date || null, target_date: i.target_date || null,
    url: `${PLANE_URL}/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${i.id}`,
    created_at: new Date(i.created_at).getTime(),
    updated_at: new Date(i.updated_at).getTime(),
  });
});

// ─── Data (NocoDB) ───────────────────────────────
// Auto-refreshing JWT for NocoDB
let ncJwt = null;
let ncJwtExpiry = 0;

async function getNcJwt() {
  if (ncJwt && Date.now() < ncJwtExpiry - 60000) return ncJwt;
  if (!NC_EMAIL || !NC_PASSWORD) return null;
  const res = await fetch(`${NC_URL}/api/v1/auth/user/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: NC_EMAIL, password: NC_PASSWORD }),
  });
  const data = await res.json();
  if (data.token) {
    ncJwt = data.token;
    // JWT expires in 10h, refresh after 9h
    ncJwtExpiry = Date.now() + 9 * 60 * 60 * 1000;
    console.log('[gateway] NocoDB JWT refreshed');
  }
  return ncJwt;
}

// Helper: NocoDB API call (30s timeout, auto-retry on 401 JWT expiry)
async function nc(method, path, body) {
  const jwt = await getNcJwt();
  if (!jwt) return { status: 503, data: { error: 'NOCODB_NOT_CONFIGURED' } };
  const url = `${NC_URL}${path}`;

  async function doFetch(token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const opts = { method, headers: { 'Content-Type': 'application/json', 'xc-auth': token }, signal: controller.signal };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    try {
      const res = await fetch(url, opts);
      clearTimeout(timer);
      const text = await res.text();
      try { return { status: res.status, data: JSON.parse(text) }; }
      catch { return { status: res.status, data: text }; }
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') return { status: 504, data: { error: 'NOCODB_TIMEOUT' } };
      return { status: 502, data: { error: err.message } };
    }
  }

  const result = await doFetch(jwt);
  // On 401, force JWT refresh and retry once
  if (result.status === 401) {
    ncJwtExpiry = 0; // force refresh
    const freshJwt = await getNcJwt();
    if (freshJwt && freshJwt !== jwt) return doFetch(freshJwt);
  }
  return result;
}

// Create a NocoDB user for an agent and add them to the ASuite base as editor
async function createNcUser(agentName, displayName) {
  const email = `${agentName}@nc-agents.local`;
  const password = crypto.randomBytes(16).toString('hex');

  // 1. Sign up (works even without email service)
  const signupRes = await fetch(`${NC_URL}/api/v1/auth/user/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstname: displayName, lastname: '' }),
  });
  const signupData = await signupRes.json();
  if (!signupData.token && !signupData.id) {
    // User may already exist — try to sign in
    const signinRes = await fetch(`${NC_URL}/api/v1/auth/user/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const signinData = await signinRes.json();
    if (!signinData.token) {
      console.warn(`[gateway] NC user already exists for ${agentName} but sign-in failed — skipping`);
      return null;
    }
  }

  // 2. Invite agent email to the ASuite base (editor role)
  const adminJwt = await getNcJwt();
  if (!adminJwt) return null;
  const inviteRes = await fetch(`${NC_URL}/api/v1/db/meta/projects/${NC_BASE_ID}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xc-auth': adminJwt },
    body: JSON.stringify({ email, roles: 'editor' }),
  });
  const inviteData = await inviteRes.json();
  if (inviteData.msg && !inviteData.msg.includes('invited')) {
    console.warn(`[gateway] NC base invite for ${agentName}: ${JSON.stringify(inviteData)}`);
  }

  console.log(`[gateway] NC user created: ${email}`);
  return password;
}

// Get a NocoDB JWT for a specific agent (by name)
const ncAgentJwts = new Map(); // agentName → { jwt, expiry }

async function getNcAgentJwt(agentName, password) {
  const cached = ncAgentJwts.get(agentName);
  if (cached && Date.now() < cached.expiry - 60000) return cached.jwt;

  const email = `${agentName}@nc-agents.local`;
  const res = await fetch(`${NC_URL}/api/v1/auth/user/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (data.token) {
    ncAgentJwts.set(agentName, { jwt: data.token, expiry: Date.now() + 9 * 60 * 60 * 1000 });
    return data.token;
  }
  return null;
}

// List tables in the ASuite base
app.get('/api/data/tables', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('GET', `/api/v1/db/meta/projects/${NC_BASE_ID}/tables`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  // Replace internal titles with user-facing display titles from meta
  if (result.data?.list) {
    for (const t of result.data.list) {
      try {
        const m = typeof t.meta === 'string' ? JSON.parse(t.meta) : t.meta;
        if (m?._displayTitle) t.title = m._displayTitle;
      } catch {}
    }
  }
  res.json(result.data);
});

// Create a table in the ASuite base
// Body: { title: string, columns: [{ title, uidt, pk?, ai?, required? }, ...] }
// uidt values: SingleLineText, LongText, Number, Decimal, Checkbox, Date, DateTime, Email, URL
// Agent identity is recorded via a meta column "created_by_agent"
app.post('/api/data/tables', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { title, columns = [] } = req.body;
  if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });

  // PK column: auto-increment integer for stable numeric sorting.
  const hasPk = columns.some(c => c.pk);
  const normalizeCol = c => {
    const col = {
      column_name: c.column_name || c.title,
      title: c.title || c.column_name,
      uidt: c.uidt,
      ...(c.pk !== undefined ? { pk: c.pk } : {}),
      ...(c.ai !== undefined ? { ai: c.ai } : {}),
      ...(c.required !== undefined ? { rqd: c.required } : {}),
    };
    // Handle SingleSelect/MultiSelect options with dtxp (NocoDB v0.202 uses single quotes)
    if (c.uidt === 'SingleSelect' || c.uidt === 'MultiSelect') {
      const optsList = (c.options || []).filter(o => o && (o.title || typeof o === 'string'));
      if (optsList.length > 0) {
        col.dtxp = optsList.map(o => `'${(typeof o === 'string' ? o : o.title).replace(/'/g, "''")}'`).join(',');
        col.colOptions = { options: optsList.map((o, i) => ({ title: typeof o === 'string' ? o : o.title, color: o.color, order: i + 1 })) };
      } else {
        col.dtxp = "'Option 1'";
        col.colOptions = { options: [{ title: 'Option 1', order: 1 }] };
      }
    }
    return col;
  };
  const fullColumns = [
    ...(hasPk ? [] : [{ column_name: 'Id', title: 'Id', uidt: 'ID', pk: true, ai: true }]),
    ...columns.map(normalizeCol),
    { column_name: 'created_by', title: 'created_by', uidt: 'SingleLineText' },
  ];

  // NocoDB requires both table_name and title (alias) to be unique.
  // Use random internal names; store the user's display name in meta._displayTitle.
  const suffix = `_${Math.random().toString(36).slice(2, 8)}_${Date.now()}`;
  const internalTitle = `t${suffix}`;
  const meta = JSON.stringify({ _displayTitle: title });
  const body = { table_name: internalTitle, title: internalTitle, columns: fullColumns, meta };
  const result = await nc('POST', `/api/v1/db/meta/projects/${NC_BASE_ID}/tables`, body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

  // Rename the default view from the random internal name to "Grid"
  const tableId = result.data.id;
  try {
    const viewsResult = await nc('GET', `/api/v1/db/meta/tables/${tableId}`);
    if (viewsResult.data?.views?.length > 0) {
      const defaultView = viewsResult.data.views[0];
      await nc('PATCH', `/api/v1/db/meta/views/${defaultView.id}`, { title: 'Grid' });
    }
  } catch { /* non-critical */ }

  // Also write to content_items so sidebar is up to date
  const nodeId = `table:${tableId}`;
  contentItemsUpsert.run(nodeId, tableId, 'table', title, null, null, null, req.agent?.name || null, null, new Date().toISOString(), null, null, Date.now());

  res.status(201).json({ table_id: tableId, title, columns: result.data.columns });
});

// Describe a table (get column definitions)
app.get('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  const t = result.data;
  // Reverse-map NocoDB UIType names to Shell names
  const UIDT_REVERSE = { 'CreateTime': 'CreatedTime', 'Collaborator': 'User', 'LinkToAnotherRecord': 'Links' };
  // Filter out system columns and internal ForeignKey columns (NocoDB bt relation internals)
  const columns = (t.columns || []).filter(c => !c.system && c.uidt !== 'ForeignKey').map(c => {
    // Check for _shellType in meta (used for CreatedBy/LastModifiedBy stored as SingleLineText)
    let parsedMeta = null;
    try { parsedMeta = c.meta ? (typeof c.meta === 'string' ? JSON.parse(c.meta) : c.meta) : null; } catch {}
    const shellType = parsedMeta?._shellType;
    const col = {
      column_id: c.id, title: c.title, type: shellType || UIDT_REVERSE[c.uidt] || c.uidt,
      primary_key: !!c.pk || !!c.pv, required: !!c.rqd,
    };
    // Pass through select options
    if (c.colOptions?.options) {
      col.options = c.colOptions.options.map(o => ({ title: o.title, color: o.color, order: o.order }));
    }
    // Pass through formula
    if (c.colOptions?.formula_raw || c.colOptions?.formula) {
      col.formula = c.colOptions.formula_raw || c.colOptions.formula;
    }
    // Pass through relation info
    if (c.colOptions?.fk_related_model_id) {
      col.relatedTableId = c.colOptions.fk_related_model_id;
      col.relationType = c.colOptions.type; // hm, bt, mm
    }
    // Pass through lookup/rollup info
    if (c.colOptions?.fk_relation_column_id) {
      col.fk_relation_column_id = c.colOptions.fk_relation_column_id;
    }
    if (c.colOptions?.fk_lookup_column_id) {
      col.fk_lookup_column_id = c.colOptions.fk_lookup_column_id;
    }
    if (c.colOptions?.fk_rollup_column_id) {
      col.fk_rollup_column_id = c.colOptions.fk_rollup_column_id;
      col.rollup_function = c.colOptions.rollup_function;
    }
    // Pass through meta (for currency symbol, decimal places, etc.)
    if (c.meta && typeof c.meta === 'object' && Object.keys(c.meta).length > 0) {
      col.meta = c.meta;
    } else if (c.meta && typeof c.meta === 'string') {
      try { const m = JSON.parse(c.meta); if (Object.keys(m).length > 0) col.meta = m; } catch {}
    }
    return col;
  });
  const views = (t.views || []).map(v => {
    const view = {
      view_id: v.id,
      title: v.title,
      type: v.type, // 1=form, 2=gallery, 3=grid, 4=kanban
      is_default: !!v.is_default,
      order: v.order,
    };
    // Pass through kanban/gallery config from nested view object
    if (v.view) {
      if (v.view.fk_grp_col_id) view.fk_grp_col_id = v.view.fk_grp_col_id;
      if (v.view.fk_cover_image_col_id) view.fk_cover_image_col_id = v.view.fk_cover_image_col_id;
    }
    return view;
  });
  // Use display title from meta if available
  let displayTitle = t.title;
  try {
    const m = typeof t.meta === 'string' ? JSON.parse(t.meta) : t.meta;
    if (m?._displayTitle) displayTitle = m._displayTitle;
  } catch {}
  res.json({ table_id: t.id, title: displayTitle, columns, views, created_at: t.created_at, updated_at: t.updated_at });
});

// Add a column to a table
// Body: { title: string, uidt: string, options?: [{title, color}] }
app.post('/api/data/tables/:table_id/columns', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { title, uidt: rawUidt = 'SingleLineText', options, meta } = req.body;
  if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });
  // Map Shell type names to NocoDB v0.202 UIType names
  // NocoDB v0.202: CreateTime ✓, LastModifiedTime ✓, Collaborator ✓
  // NOT supported: CreatedBy, LastModifiedBy, User (use Collaborator instead)
  const UIDT_MAP = {
    'CreatedTime': 'CreateTime',
    'LastModifiedTime': 'LastModifiedTime',
    'CreatedBy': 'SingleLineText',     // NocoDB v0.202 doesn't support CreatedBy — use text, Gateway fills on insert
    'LastModifiedBy': 'SingleLineText', // NocoDB v0.202 doesn't support LastModifiedBy — use text, Gateway fills on update
    'User': 'Collaborator',            // NocoDB v0.202 uses Collaborator, not User
    'Links': 'LinkToAnotherRecord',    // NocoDB v0.202 uses LinkToAnotherRecord, not Links
  };
  let uidt = UIDT_MAP[rawUidt] || rawUidt;
  // Number with decimals > 0 should use Decimal uidt to preserve precision
  if (uidt === 'Number' && meta && meta.decimals && meta.decimals > 0) {
    uidt = 'Decimal';
  }
  const body = { column_name: title, title, uidt };
  if (uidt === 'SingleSelect' || uidt === 'MultiSelect') {
    // Always provide colOptions for select types — NocoDB crashes on row insert if colOptions is null
    const optsList = (options || []).filter(o => o && (o.title || typeof o === 'string'));
    body.colOptions = { options: optsList.map((o, i) => ({ title: o.title || o, color: o.color, order: i + 1 })) };
    // NocoDB bug: colOptions stays null even with colOptions in create body.
    // Must use dtxp to initialize — NocoDB v0.202 uses single quotes in dtxp.
    if (optsList.length > 0) {
      body.dtxp = optsList.map(o => `'${(o.title || o).replace(/'/g, "''")}'`).join(',');
    } else {
      // Provide a default placeholder option — users can rename/delete it
      body.dtxp = "'Option 1'";
      body.colOptions = { options: [{ title: 'Option 1', order: 1 }] };
    }
  }
  // Store original Shell type in meta for types that get remapped (CreatedBy, LastModifiedBy)
  const metaObj = meta ? (typeof meta === 'string' ? JSON.parse(meta) : { ...meta }) : {};
  if (rawUidt === 'CreatedBy' || rawUidt === 'LastModifiedBy') {
    metaObj._shellType = rawUidt;
  }
  if (Object.keys(metaObj).length > 0) body.meta = JSON.stringify(metaObj);
  // Formula
  if (uidt === 'Formula' && req.body.formula_raw) {
    body.formula_raw = req.body.formula_raw;
  }
  // Links (relation between tables)
  if ((uidt === 'Links' || uidt === 'LinkToAnotherRecord') && req.body.childId) {
    const relType = req.body.relationType || 'mm';
    if (relType === 'bt') {
      // For bt (belongs-to / single select): current table holds the FK, so current = child, target = parent
      body.parentId = req.body.childId;
      body.childId = req.params.table_id;
    } else {
      // For mm / hm: current table is parent, target is child
      body.parentId = req.params.table_id;
      body.childId = req.body.childId;
    }
    body.type = relType;
  }
  // Lookup — NocoDB v0.202 expects fk_* at top level, NOT in colOptions
  if (uidt === 'Lookup' && req.body.fk_relation_column_id && req.body.fk_lookup_column_id) {
    body.fk_relation_column_id = req.body.fk_relation_column_id;
    body.fk_lookup_column_id = req.body.fk_lookup_column_id;
  }
  // Rollup — same as Lookup, top-level properties
  if (uidt === 'Rollup' && req.body.fk_relation_column_id && req.body.fk_rollup_column_id) {
    body.fk_relation_column_id = req.body.fk_relation_column_id;
    body.fk_rollup_column_id = req.body.fk_rollup_column_id;
    body.rollup_function = req.body.rollup_function || 'count';
  }
  const result = await nc('POST', `/api/v1/db/meta/tables/${req.params.table_id}/columns`, body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  const c = result.data;

  // Backfill system columns for existing rows (NocoDB v0.202 does not auto-populate these)
  const needsBackfill = ['AutoNumber', 'CreateTime', 'LastModifiedTime'].includes(uidt)
    || (rawUidt === 'CreatedBy' || rawUidt === 'LastModifiedBy');
  if (needsBackfill) {
    try {
      // Fetch all existing rows
      const allRows = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}?limit=10000`);
      if (allRows.status < 400 && allRows.data?.list?.length > 0) {
        const rows = allRows.data.list;
        for (let i = 0; i < rows.length; i++) {
          const rowId = rows[i].Id;
          if (rowId == null) continue;
          let value;
          if (uidt === 'AutoNumber') {
            value = i + 1;
          } else if (uidt === 'CreateTime') {
            value = rows[i].created_at || new Date().toISOString();
          } else if (uidt === 'LastModifiedTime') {
            value = rows[i].updated_at || new Date().toISOString();
          } else if (rawUidt === 'CreatedBy' || rawUidt === 'LastModifiedBy') {
            value = req.agent.display_name || req.agent.name || 'system';
          }
          if (value !== undefined) {
            await nc('PATCH', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${rowId}`, { [title]: value });
          }
        }
      }
    } catch (backfillErr) {
      console.error('System column backfill failed (non-fatal):', backfillErr.message);
    }
  }

  // NocoDB returns table object for Links, column object for others
  if (c.columns) {
    // Links: find the newly created column by matching title
    const newCol = c.columns.find(col => col.title === title);

    // Rename reverse column on target table to use source table's display name
    if ((uidt === 'Links' || uidt === 'LinkToAnotherRecord') && req.body.childId) {
      try {
        // Get source table's display name
        const srcMeta = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
        let srcDisplayName = req.params.table_id;
        if (srcMeta.status < 400 && srcMeta.data) {
          try {
            const m = typeof srcMeta.data.meta === 'string' ? JSON.parse(srcMeta.data.meta) : srcMeta.data.meta;
            srcDisplayName = m?._displayTitle || srcMeta.data.title || req.params.table_id;
          } catch { srcDisplayName = srcMeta.data.title || req.params.table_id; }
        }
        // Find the reverse column on the target table
        const targetMeta = await nc('GET', `/api/v1/db/meta/tables/${req.body.childId}`);
        if (targetMeta.status < 400 && targetMeta.data?.columns) {
          const reverseCol = targetMeta.data.columns.find(col =>
            (col.uidt === 'LinkToAnotherRecord' || col.uidt === 'Links') && !col.system &&
            col.colOptions?.fk_related_model_id === req.params.table_id &&
            col.id !== (newCol?.id || '')
          );
          if (reverseCol) {
            await nc('PATCH', `/api/v1/db/meta/columns/${reverseCol.id}`, {
              title: srcDisplayName, column_name: srcDisplayName,
              uidt: reverseCol.uidt,
            });
          }
        }
      } catch (e) { console.error('Reverse column rename failed (non-fatal):', e.message); }
    }

    res.status(201).json({ column_id: newCol?.id || c.id, title: title, type: rawUidt });
  } else {
    res.status(201).json({ column_id: c.id, title: c.title, type: rawUidt });
  }
});

// Update a column (rename, change type, update options)
// Body: { title?: string, uidt?: string, options?: [{title, color?}] }
app.patch('/api/data/tables/:table_id/columns/:column_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  // Always fetch current column metadata to preserve column_name and get current uidt
  const colMeta = await nc('GET', `/api/v1/db/meta/columns/${req.params.column_id}`);
  if (colMeta.status >= 400) return res.status(colMeta.status).json({ error: 'UPSTREAM_ERROR', detail: colMeta.data });
  const currentCol = colMeta.data;
  // NocoDB PATCH requires title + column_name to avoid 'replace' crash
  const body = {
    title: req.body.title || currentCol.title,
    column_name: currentCol.column_name || currentCol.title,
  };
  // Map Shell type names to NocoDB UIType names for type changes
  const UIDT_MAP = { 'CreatedTime': 'CreateTime', 'User': 'Collaborator', 'Links': 'LinkToAnotherRecord' };
  if (req.body.uidt) body.uidt = UIDT_MAP[req.body.uidt] || req.body.uidt;
  // When updating options without explicit uidt, use current column type
  if (req.body.options && !body.uidt) {
    if (currentCol.uidt) body.uidt = currentCol.uidt;
  }
  // Pass select options through to NocoDB with dtxp (required for persistence)
  // NocoDB v0.202: dtxp uses single quotes, existing option IDs must be preserved
  if (req.body.options) {
    const existingOpts = currentCol.colOptions?.options || [];
    const existingMap = new Map(existingOpts.map(o => [o.title, o]));
    const optsList = req.body.options.map((o, i) => {
      const title = typeof o === 'string' ? o : (o.title || '');
      const existing = existingMap.get(title);
      return {
        ...(existing ? { id: existing.id } : {}),
        title,
        color: o.color || (existing ? existing.color : undefined),
        order: i + 1,
      };
    });
    body.colOptions = { options: optsList };
    // NocoDB v0.202 requires dtxp with single quotes for option persistence
    body.dtxp = optsList.map(o => `'${(o.title || '').replace(/'/g, "''")}'`).join(',');
  }
  // Pass meta through (for number format, rating config, date format, etc.)
  if (req.body.meta !== undefined) {
    body.meta = typeof req.body.meta === 'string' ? req.body.meta : JSON.stringify(req.body.meta);
  }
  // Auto-upgrade Number to Decimal when decimals > 0 to preserve precision
  if ((body.uidt === 'Number' || (!body.uidt)) && body.meta) {
    try {
      const metaObj = typeof body.meta === 'string' ? JSON.parse(body.meta) : body.meta;
      if (metaObj.decimals && metaObj.decimals > 0 && (!body.uidt || body.uidt === 'Number')) {
        body.uidt = 'Decimal';
      }
    } catch {}
  }
  let result = await nc('PATCH', `/api/v1/db/meta/columns/${req.params.column_id}`, body);
  // If type change fails, try delete + recreate approach (preserve column position in all views)
  if (result.status >= 400 && req.body.uidt && req.body.uidt !== currentCol.uidt) {
    try {
      // Save column order in all views before deleting
      const tableMeta = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
      const viewOrders = [];
      if (tableMeta.status < 400 && tableMeta.data?.views) {
        for (const view of tableMeta.data.views) {
          const vcRes = await nc('GET', `/api/v1/db/meta/views/${view.id}/columns`);
          if (vcRes.status < 400 && vcRes.data?.list) {
            const vc = vcRes.data.list.find(c => c.fk_column_id === req.params.column_id);
            if (vc) viewOrders.push({ viewId: view.id, order: vc.order });
          }
        }
      }
      const delResult = await nc('DELETE', `/api/v1/db/meta/columns/${req.params.column_id}`);
      if (delResult.status < 400) {
        const newTitle = req.body.title || currentCol.title;
        const newUidt = UIDT_MAP[req.body.uidt] || req.body.uidt;
        const createBody = { column_name: currentCol.column_name || newTitle, title: newTitle, uidt: newUidt };
        if (req.body.options) {
          const optsList = req.body.options.map((o, i) => ({ title: o.title || o, color: o.color, order: i + 1 }));
          createBody.colOptions = { options: optsList };
          if (optsList.length > 0) {
            createBody.dtxp = optsList.map(o => `'${(o.title || '').replace(/'/g, "''")}'`).join(',');
          }
        }
        if (req.body.meta !== undefined) {
          createBody.meta = typeof req.body.meta === 'string' ? req.body.meta : JSON.stringify(req.body.meta);
        }
        result = await nc('POST', `/api/v1/db/meta/tables/${req.params.table_id}/columns`, createBody);
        // Restore column position in all views
        if (result.status < 400 && result.data?.id && viewOrders.length > 0) {
          const newColId = result.data.id;
          for (const vo of viewOrders) {
            try {
              await nc('PATCH', `/api/v1/db/meta/views/${vo.viewId}/columns/${newColId}`, { order: vo.order });
            } catch {}
          }
        }
      }
    } catch {}
  }
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json(result.data);
});

// Delete a column
app.delete('/api/data/tables/:table_id/columns/:column_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('DELETE', `/api/v1/db/meta/columns/${req.params.column_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ deleted: true });
});

// Rename a table (updates display title in meta, not NocoDB's internal title/alias)
app.patch('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });
  // Read current meta, update _displayTitle
  const info = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
  if (info.status >= 400) return res.status(info.status).json({ error: 'UPSTREAM_ERROR', detail: info.data });
  let meta = {};
  try { meta = typeof info.data.meta === 'string' ? JSON.parse(info.data.meta) : (info.data.meta || {}); } catch {}
  meta._displayTitle = title;
  const result = await nc('PATCH', `/api/v1/db/meta/tables/${req.params.table_id}`, { meta: JSON.stringify(meta) });
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  // Sync title to content_items
  db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
    .run(title, new Date().toISOString(), req.params.table_id, 'table');
  res.json({ ...result.data, title });
});

// Delete a table
app.delete('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('DELETE', `/api/v1/db/meta/tables/${req.params.table_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  // Also remove from content_items
  db.prepare('DELETE FROM content_items WHERE raw_id = ? AND type = ?').run(req.params.table_id, 'table');
  res.json({ deleted: true });
});

// ── Views ──

// List views for a table (included in describe, but also standalone)
app.get('/api/data/tables/:table_id/views', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  const views = (result.data.views || []).map(v => ({
    view_id: v.id,
    title: v.title,
    type: v.type, // 1=form, 2=gallery, 3=grid, 4=kanban, 5=calendar
    is_default: !!v.is_default,
    order: v.order,
    lock_type: v.lock_type,
  }));
  res.json({ list: views });
});

// Create a grid view
app.post('/api/data/tables/:table_id/views', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { title, type } = req.body;
  if (!title) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
  // Map type string to endpoint; default to grid
  const typeMap = { form: 'forms', gallery: 'galleries', grid: 'grids', kanban: 'kanbans', calendar: 'calendars' };
  const endpoint = typeMap[type] || 'grids';
  const result = await nc('POST', `/api/v1/db/meta/tables/${req.params.table_id}/${endpoint}`, { title });
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.status(201).json({
    view_id: result.data.id,
    title: result.data.title,
    type: result.data.type,
    is_default: !!result.data.is_default,
    order: result.data.order,
  });
});

// Update kanban view config (set grouping column)
app.patch('/api/data/views/:view_id/kanban', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { fk_grp_col_id, fk_cover_image_col_id } = req.body;
  const body = {};
  if (fk_grp_col_id) body.fk_grp_col_id = fk_grp_col_id;
  if (fk_cover_image_col_id) body.fk_cover_image_col_id = fk_cover_image_col_id;
  const result = await nc('PATCH', `/api/v1/db/meta/kanbans/${req.params.view_id}`, body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ updated: true });
});

// Update gallery view config (set cover image column)
app.patch('/api/data/views/:view_id/gallery', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { fk_cover_image_col_id } = req.body;
  const body = {};
  if (fk_cover_image_col_id !== undefined) body.fk_cover_image_col_id = fk_cover_image_col_id;
  const result = await nc('PATCH', `/api/v1/db/meta/galleries/${req.params.view_id}`, body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ updated: true });
});

// Rename a view
app.patch('/api/data/views/:view_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'title required' });
  const result = await nc('PATCH', `/api/v1/db/meta/views/${req.params.view_id}`, { title });
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ updated: true });
});

// Delete a view
app.delete('/api/data/views/:view_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('DELETE', `/api/v1/db/meta/views/${req.params.view_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ deleted: true });
});

// List filters for a view
app.get('/api/data/views/:view_id/filters', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('GET', `/api/v1/db/meta/views/${req.params.view_id}/filters`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  const filters = (result.data.list || []).map(f => ({
    filter_id: f.id,
    fk_column_id: f.fk_column_id,
    comparison_op: f.comparison_op,
    comparison_sub_op: f.comparison_sub_op,
    value: f.value,
    logical_op: f.logical_op,
    order: f.order,
  }));
  res.json({ list: filters });
});

// Create a filter for a view
app.post('/api/data/views/:view_id/filters', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { fk_column_id, comparison_op, value, logical_op } = req.body;
  if (!fk_column_id || !comparison_op) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'fk_column_id and comparison_op required' });
  const result = await nc('POST', `/api/v1/db/meta/views/${req.params.view_id}/filters`, { fk_column_id, comparison_op, value: value || '', logical_op: logical_op || 'and' });
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.status(201).json({ filter_id: result.data.id, fk_column_id: result.data.fk_column_id, comparison_op: result.data.comparison_op, value: result.data.value });
});

// Update a filter
app.patch('/api/data/filters/:filter_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('PATCH', `/api/v1/db/meta/filters/${req.params.filter_id}`, req.body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ updated: true });
});

// Delete a filter
app.delete('/api/data/filters/:filter_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('DELETE', `/api/v1/db/meta/filters/${req.params.filter_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ deleted: true });
});

// List sorts for a view
app.get('/api/data/views/:view_id/sorts', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('GET', `/api/v1/db/meta/views/${req.params.view_id}/sorts`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  const sorts = (result.data.list || []).map(s => ({
    sort_id: s.id,
    fk_column_id: s.fk_column_id,
    direction: s.direction,
    order: s.order,
  }));
  res.json({ list: sorts });
});

// Create a sort for a view
app.post('/api/data/views/:view_id/sorts', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { fk_column_id, direction } = req.body;
  if (!fk_column_id) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'fk_column_id required' });
  const result = await nc('POST', `/api/v1/db/meta/views/${req.params.view_id}/sorts`, { fk_column_id, direction: direction || 'asc' });
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.status(201).json({ sort_id: result.data.id, fk_column_id: result.data.fk_column_id, direction: result.data.direction });
});

// Delete a sort
app.delete('/api/data/sorts/:sort_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('DELETE', `/api/v1/db/meta/sorts/${req.params.sort_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ deleted: true });
});

// Update a sort
app.patch('/api/data/sorts/:sort_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('PATCH', `/api/v1/db/meta/sorts/${req.params.sort_id}`, req.body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json(result.data);
});

// Query rows through a specific view (applies view's filters/sorts)
app.get('/api/data/:table_id/views/:view_id/rows', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { where, limit = '25', offset = '0', sort } = req.query;
  const params = new URLSearchParams({ limit, offset });
  if (where) params.set('where', where);
  if (sort) params.set('sort', sort);
  const result = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/views/${req.params.view_id}?${params}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json(result.data);
});

// List rows from a table
app.get('/api/data/:table_id/rows', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { where, limit = '25', offset = '0', sort } = req.query;
  const params = new URLSearchParams({ limit, offset });
  if (where) params.set('where', where);
  if (sort) params.set('sort', sort);
  const result = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}?${params}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json(result.data);
});

// Insert row(s)
app.post('/api/data/:table_id/rows', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  // Auto-generate PK value and system columns for new rows
  let rowData = req.body;
  try {
    const meta = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
    if (meta.status < 400 && meta.data?.columns) {
      const columns = meta.data.columns;
      // Auto-generate PK if SingleLineText and value is missing
      const pkCol = columns.find(c => c.pk && c.uidt === 'SingleLineText');
      if (pkCol && !rowData[pkCol.title] && !rowData[pkCol.column_name]) {
        // Fetch all PK values to find the true numeric max (string sort fails for "9" vs "10")
        const allResult = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}?limit=1000&fields=${encodeURIComponent(pkCol.title)}`);
        let nextId = 1;
        if (allResult.status < 400 && allResult.data?.list?.length > 0) {
          let maxVal = 0;
          for (const row of allResult.data.list) {
            const v = parseInt(row[pkCol.title], 10);
            if (!isNaN(v) && v > maxVal) maxVal = v;
          }
          nextId = maxVal + 1;
        }
        rowData = { ...rowData, [pkCol.title]: String(nextId) };
      }
      // Auto-fill AutoNumber columns
      for (const col of columns) {
        if (col.uidt === 'AutoNumber' && !rowData[col.title]) {
          const maxResult = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}?limit=1&sort=-${encodeURIComponent(col.title)}&fields=${encodeURIComponent(col.title)}`);
          let nextNum = 1;
          if (maxResult.status < 400 && maxResult.data?.list?.length > 0) {
            const maxVal = parseInt(maxResult.data.list[0][col.title], 10);
            nextNum = isNaN(maxVal) ? 1 : maxVal + 1;
          }
          rowData = { ...rowData, [col.title]: nextNum };
        }
      }
      // Auto-fill CreatedBy/LastModifiedBy with the agent name (these are stored as SingleLineText, NocoDB won't auto-manage)
      // NOTE: CreatedTime/LastModifiedTime are NocoDB native types — NocoDB auto-manages them, do NOT override
      for (const col of columns) {
        if (col.system) continue;
        if ((col.uidt === 'CreatedBy') && !rowData[col.title]) {
          rowData = { ...rowData, [col.title]: req.agent.display_name || req.agent.name };
        }
        if ((col.uidt === 'LastModifiedBy') && !rowData[col.title]) {
          rowData = { ...rowData, [col.title]: req.agent.display_name || req.agent.name };
        }
      }
    }
  } catch (e) { /* proceed with original data if detection fails */ }
  let result = await nc('POST', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}`, rowData);
  // NocoDB bug: SingleSelect/MultiSelect with null colOptions crashes on insert
  // Auto-fix by adding a temp option (forces NocoDB to create colOptions record) then removing it
  if (result.status === 400 && result.data?.msg?.includes?.('options') && result.data?.msg?.includes?.('null')) {
    try {
      const meta = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
      if (meta.status < 400 && meta.data?.columns) {
        for (const col of meta.data.columns) {
          if ((col.uidt === 'SingleSelect' || col.uidt === 'MultiSelect') && !col.colOptions) {
            // Use dtxp to force NocoDB to initialize colOptions (colOptions patch alone doesn't work)
            await nc('PATCH', `/api/v1/db/meta/columns/${col.id}`, {
              title: col.title, column_name: col.column_name, uidt: col.uidt,
              dtxp: "'Option 1'",
              colOptions: { options: [{ title: 'Option 1', order: 1 }] },
            });
          }
        }
        result = await nc('POST', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}`, rowData);
      }
    } catch { /* fall through to original error */ }
  }
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.status(201).json(result.data);
  // Async auto-snapshot
  maybeAutoSnapshot(req.params.table_id, req.agent.display_name || req.agent.name).catch(() => {});
});

// Update row
app.patch('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  // Auto-update LastModifiedBy columns (stored as SingleLineText, NocoDB won't auto-manage)
  // NOTE: LastModifiedTime is NocoDB native type — NocoDB auto-manages it, do NOT override
  let updateData = req.body;
  try {
    const meta = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
    if (meta.status < 400 && meta.data?.columns) {
      for (const col of meta.data.columns) {
        if (col.system) continue;
        if (col.uidt === 'LastModifiedBy') {
          updateData = { ...updateData, [col.title]: req.agent.display_name || req.agent.name };
        }
      }
    }
  } catch (e) { /* proceed without auto-fill */ }
  const result = await nc('PATCH', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${req.params.row_id}`, updateData);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json(result.data);

  // Async: check for User field assignments → notify assigned agents
  try {
    const allAgents = db.prepare('SELECT * FROM agent_accounts').all();
    const agentMap = new Map();
    for (const a of allAgents) {
      agentMap.set(a.name, a);
      if (a.display_name) agentMap.set(a.display_name, a);
      if (a.nc_email) agentMap.set(a.nc_email, a);
    }
    const body = req.body || {};
    for (const [field, val] of Object.entries(body)) {
      // Collaborator field can be a string (email/name) or comma-separated string
      if (!val) continue;
      const valStr = typeof val === 'string' ? val : (typeof val === 'object' && val.email ? val.email : null);
      if (!valStr) continue;
      const target = agentMap.get(valStr);
      if (!target || target.id === req.agent.id) continue;
      console.log(`[gateway] User assigned: ${target.name} via field "${field}" by ${req.agent.name}`);
      // This field's value matches an agent — emit user_assigned event
      const now = Date.now();
      const evt = {
        event: 'data.user_assigned',
        source: 'row_update',
        event_id: genId('evt'),
        timestamp: now,
        data: {
          table_id: req.params.table_id,
          row_id: req.params.row_id,
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
  // Async auto-snapshot
  maybeAutoSnapshot(req.params.table_id, req.agent.display_name || req.agent.name).catch(() => {});
});

// Delete row
app.delete('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('DELETE', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${req.params.row_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ deleted: true });
  // Async auto-snapshot
  maybeAutoSnapshot(req.params.table_id, req.agent.display_name || req.agent.name).catch(() => {});
});

// Duplicate a table (schema + data)
app.post('/api/data/:table_id/duplicate', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  try {
    // 1. Get source table meta
    const metaResult = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
    if (metaResult.status >= 400) return res.status(metaResult.status).json({ error: 'UPSTREAM_ERROR', detail: metaResult.data });
    const srcTitle = metaResult.data.title || 'Untitled';
    const srcCols = metaResult.data.columns || [];

    // 2. Create new table with same columns (skip system cols)
    const SYSTEM_UIDTS = new Set(['ID', 'CreateTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'AutoNumber', 'Links', 'LinkToAnotherRecord', 'Lookup', 'Rollup', 'Formula', 'Count']);
    const newCols = srcCols
      .filter(c => !c.pk && !c.system && !SYSTEM_UIDTS.has(c.uidt))
      .map(c => {
        const col = { column_name: c.title, title: c.title, uidt: c.uidt };
        if ((c.uidt === 'SingleSelect' || c.uidt === 'MultiSelect') && c.colOptions?.options) {
          col.colOptions = { options: c.colOptions.options.map((o, i) => ({ title: o.title, color: o.color, order: i + 1 })) };
        }
        if (c.meta) col.meta = c.meta;
        return col;
      });

    const createResult = await nc('POST', `/api/v1/db/meta/bases/${NC_BASE_ID}/tables`, {
      table_name: `${srcTitle} (copy)`,
      title: `${srcTitle} (copy)`,
      columns: [
        { column_name: 'Title', title: 'Title', uidt: 'SingleLineText', pv: true },
        ...newCols,
      ],
    });
    if (createResult.status >= 400) return res.status(createResult.status).json({ error: 'CREATE_FAILED', detail: createResult.data });
    const newTableId = createResult.data.id;

    // 3. Copy rows (skip system fields)
    const allRows = [];
    let offset = 0;
    while (true) {
      const rowResult = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}?limit=1000&offset=${offset}`);
      if (rowResult.status >= 400) break;
      const list = rowResult.data?.list || [];
      allRows.push(...list);
      if (list.length < 1000) break;
      offset += 1000;
    }

    const skipFields = new Set(['Id', 'id', 'nc_id', 'CreatedAt', 'UpdatedAt', 'created_at', 'updated_at', 'ncRecordId', 'ncRecordHash']);
    const validCols = new Set(newCols.map(c => c.title));
    let copiedRows = 0;
    for (const row of allRows) {
      const cleanRow = {};
      for (const [key, val] of Object.entries(row)) {
        if (skipFields.has(key)) continue;
        if (validCols.has(key)) cleanRow[key] = val;
      }
      if (Object.keys(cleanRow).length > 0) {
        await nc('POST', `/api/v1/db/data/noco/${NC_BASE_ID}/${newTableId}`, cleanRow);
        copiedRows++;
      }
    }

    console.log(`[gateway] Duplicated table ${req.params.table_id} → ${newTableId} (${copiedRows} rows)`);
    // Write to content_items for sidebar
    const srcItem = db.prepare('SELECT * FROM content_items WHERE raw_id = ? AND type = ?').get(req.params.table_id, 'table');
    const displayTitle = srcItem ? `${srcItem.title} (copy)` : `${srcTitle} (copy)`;
    const nodeId = `table:${newTableId}`;
    contentItemsUpsert.run(nodeId, newTableId, 'table', displayTitle, null, srcItem?.parent_id || null, null, req.agent?.name || null, null, new Date().toISOString(), null, null, Date.now());
    res.json({ success: true, new_table_id: newTableId, copied_rows: copiedRows });
  } catch (e) {
    console.error(`[gateway] Duplicate table failed: ${e.message}`);
    res.status(500).json({ error: 'DUPLICATE_FAILED', message: e.message });
  }
});

// Post a comment on a row (agent posts as their own NocoDB identity)
app.post('/api/data/:table_id/rows/:row_id/comments', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

  const agent = req.agent;
  let ncJwtToUse;

  if (agent.nc_password) {
    // Use agent's own NocoDB JWT so comment shows their identity
    ncJwtToUse = await getNcAgentJwt(agent.name, agent.nc_password);
  }
  // Fallback to admin JWT if agent has no NC account yet
  if (!ncJwtToUse) ncJwtToUse = await getNcJwt();
  if (!ncJwtToUse) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });

  const url = `${NC_URL}/api/v1/db/meta/audits/comments`;
  const ncRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xc-auth': ncJwtToUse },
    body: JSON.stringify({ fk_model_id: req.params.table_id, row_id: req.params.row_id, description: text }),
  });
  const data = await ncRes.json().catch(() => ({}));
  if (ncRes.status >= 400) return res.status(ncRes.status).json({ error: 'UPSTREAM_ERROR', detail: data });
  res.status(201).json({
    comment_id: data.id,
    table_id: req.params.table_id,
    row_id: req.params.row_id,
    created_at: Date.now(),
  });
});

// View columns (field visibility/width per view) — stored in Gateway DB
// NocoDB's view column update API doesn't reliably persist in v0.202, so we manage it locally.
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

// Helper: resolve NocoDB relation type (mm/hm/bt) for a column
async function resolveRelationType(tableId, columnId) {
  try {
    const meta = await nc('GET', `/api/v1/db/meta/tables/${tableId}`);
    if (meta.status >= 400) return 'mm'; // fallback
    const col = (meta.data.columns || []).find(c => c.id === columnId);
    return col?.colOptions?.type || 'mm';
  } catch { return 'mm'; }
}

// Linked records (for Links/LinkToAnotherRecord columns)
app.get('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const relType = await resolveRelationType(req.params.table_id, req.params.column_id);
  const params = new URLSearchParams();
  if (req.query.limit) params.set('limit', req.query.limit);
  if (req.query.offset) params.set('offset', req.query.offset);
  const qs = params.toString();
  const result = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${req.params.row_id}/${relType}/${req.params.column_id}${qs ? '?' + qs : ''}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json(result.data);
});

app.post('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const relType = await resolveRelationType(req.params.table_id, req.params.column_id);
  // NocoDB 0.202.10: target row ID goes in URL path, one at a time
  const records = Array.isArray(req.body) ? req.body : [];
  const basePath = `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${req.params.row_id}/${relType}/${req.params.column_id}`;
  try {
    for (const rec of records) {
      const targetId = rec.Id || rec.id;
      if (!targetId) continue;
      const result = await nc('POST', `${basePath}/${targetId}`);
      if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    }
    res.json({ msg: 'Links created successfully' });
  } catch (e) {
    console.error('[gateway] Link creation error:', e.message);
    res.status(500).json({ error: 'LINK_FAILED', detail: e.message });
  }
});

app.delete('/api/data/:table_id/rows/:row_id/links/:column_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const relType = await resolveRelationType(req.params.table_id, req.params.column_id);
  // NocoDB 0.202.10: target row ID goes in URL path, one at a time
  const records = Array.isArray(req.body) ? req.body : [];
  const basePath = `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${req.params.row_id}/${relType}/${req.params.column_id}`;
  try {
    for (const rec of records) {
      const targetId = rec.Id || rec.id;
      if (!targetId) continue;
      const result = await nc('DELETE', `${basePath}/${targetId}`);
      if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    }
    res.json({ msg: 'Links removed successfully' });
  } catch (e) {
    console.error('[gateway] Unlink error:', e.message);
    res.status(500).json({ error: 'UNLINK_FAILED', detail: e.message });
  }
});

// ─── Catchup ─────────────────────────────────────
app.get('/api/me/catchup', authenticateAgent, (req, res) => {
  const since = parseInt(req.query.since || '0');
  const limit = Math.min(parseInt(req.query.limit || '50'), 100);
  const cursor = req.query.cursor;

  let query = 'SELECT * FROM events WHERE agent_id = ? AND occurred_at > ? ORDER BY occurred_at ASC LIMIT ?';
  const params = [req.agent.id, cursor ? parseInt(cursor) : since, limit + 1];

  const rows = db.prepare(query).all(...params);
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(r => JSON.parse(r.payload));

  // Mark as delivered
  for (const r of rows.slice(0, limit)) {
    db.prepare('UPDATE events SET delivered = 1 WHERE id = ?').run(r.id);
  }

  res.json({
    events,
    has_more: hasMore,
    cursor: events.length > 0 ? String(events[events.length - 1].occurred_at) : null,
  });
});

// ─── SSE Event Stream ────────────────────────────
const sseClients = new Map(); // agent_id → Set<res>

app.get('/api/me/events/stream', authenticateAgent, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const agentId = req.agent.id;
  if (!sseClients.has(agentId)) sseClients.set(agentId, new Set());
  sseClients.get(agentId).add(res);

  // Send heartbeat every 30s
  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.get(agentId)?.delete(res);
  });
});

function pushEvent(agentId, event) {
  const clients = sseClients.get(agentId);
  if (clients) {
    for (const res of clients) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }
}

// ─── Mattermost WebSocket Listener ──────────────
// Listens for @mentions in MM and generates events for registered agents
import WebSocket from 'ws';

const mmBotTokens = new Map(); // agent_name → { userId, token }

async function getMMBotToken(agentName) {
  if (mmBotTokens.has(agentName)) return mmBotTokens.get(agentName).token;
  return null;
}

async function createMMBot(agentName, displayName) {
  if (!MM_ADMIN_TOKEN) return;
  // Create bot
  const botRes = await upstream(MM_URL, 'POST', '/api/v4/bots',
    { username: agentName, display_name: displayName }, MM_ADMIN_TOKEN);
  if (botRes.status >= 400 && botRes.data?.id !== 'store.sql_bot.save.username_exists.app_error') {
    // Bot might already exist, try to get it
    const usersRes = await upstream(MM_URL, 'GET', `/api/v4/users/username/${agentName}`, null, MM_ADMIN_TOKEN);
    if (usersRes.data?.id) {
      // Generate token for existing bot
      const tokenRes = await upstream(MM_URL, 'POST', `/api/v4/users/${usersRes.data.id}/tokens`,
        { description: 'gateway-managed' }, MM_ADMIN_TOKEN);
      if (tokenRes.data?.token) {
        mmBotTokens.set(agentName, { userId: usersRes.data.id, token: tokenRes.data.token });
      }
    }
    return;
  }
  // Generate access token
  const userId = botRes.data?.user_id;
  if (!userId) return;
  const tokenRes = await upstream(MM_URL, 'POST', `/api/v4/users/${userId}/tokens`,
    { description: 'gateway-managed' }, MM_ADMIN_TOKEN);
  if (tokenRes.data?.token) {
    mmBotTokens.set(agentName, { userId, token: tokenRes.data.token });
    // Add bot to team
    const teams = await upstream(MM_URL, 'GET', '/api/v4/teams', null, MM_ADMIN_TOKEN);
    if (Array.isArray(teams.data) && teams.data.length > 0) {
      await upstream(MM_URL, 'POST', `/api/v4/teams/${teams.data[0].id}/members`,
        { team_id: teams.data[0].id, user_id: userId }, MM_ADMIN_TOKEN);
    }
  }
}

// Load existing bot tokens on startup
async function loadExistingBots() {
  const agents = db.prepare('SELECT name, display_name FROM agent_accounts').all();
  for (const agent of agents) {
    try {
      const userRes = await upstream(MM_URL, 'GET', `/api/v4/users/username/${agent.name}`, null, MM_ADMIN_TOKEN);
      if (userRes.data?.id) {
        // Check for existing tokens
        const tokensRes = await upstream(MM_URL, 'GET', `/api/v4/users/${userRes.data.id}/tokens`, null, MM_ADMIN_TOKEN);
        if (Array.isArray(tokensRes.data) && tokensRes.data.length > 0) {
          // Need to generate a new token since we can't retrieve existing ones
          const tokenRes = await upstream(MM_URL, 'POST', `/api/v4/users/${userRes.data.id}/tokens`,
            { description: 'gateway-managed' }, MM_ADMIN_TOKEN);
          if (tokenRes.data?.token) {
            mmBotTokens.set(agent.name, { userId: userRes.data.id, token: tokenRes.data.token });
            console.log(`[gateway] Loaded MM bot: ${agent.name}`);
          }
        }
      }
    } catch (e) {
      console.warn(`[gateway] Failed to load bot ${agent.name}: ${e.message}`);
    }
  }
}

function startMMListener() {
  if (!MM_ADMIN_TOKEN) {
    console.warn('[gateway] MM_ADMIN_TOKEN not set, Mattermost listener disabled');
    return;
  }

  const wsUrl = MM_URL.replace(/^http/, 'ws') + '/api/v4/websocket';
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      seq: 1,
      action: 'authentication_challenge',
      data: { token: MM_ADMIN_TOKEN },
    }));
    console.log('[gateway] Connected to Mattermost WebSocket');
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event !== 'posted') return;

      const post = JSON.parse(msg.data.post);
      const channelName = msg.data.channel_display_name || '';
      const channelType = msg.data.channel_type || '';

      const agents = db.prepare('SELECT * FROM agent_accounts').all();

      // Get sender info once (shared across events)
      const senderRes = await upstream(MM_URL, 'GET', `/api/v4/users/${post.user_id}`, null, MM_ADMIN_TOKEN);
      const senderName = senderRes.data?.username || post.user_id;

      if (channelType === 'D') {
        // Direct message: route to the agent whose bot is in this DM channel
        // DM channel name is "<userId1>__<userId2>" — find agent whose bot userId appears in it
        const dmChannelRes = await upstream(MM_URL, 'GET', `/api/v4/channels/${post.channel_id}`, null, MM_ADMIN_TOKEN);
        const dmChannelName = dmChannelRes.data?.name || '';

        for (const agent of agents) {
          const botInfo = mmBotTokens.get(agent.name);
          if (!botInfo) continue;
          if (!dmChannelName.includes(botInfo.userId)) continue;
          // Skip if the post was made by this agent's own bot
          if (post.user_id === botInfo.userId) continue;

          const event = {
            event: 'message.direct',
            source: 'mattermost',
            event_id: genId('evt'),
            timestamp: post.create_at,
            data: {
              channel_id: post.channel_id,
              message_id: post.id,
              text: post.message,
              sender: { id: post.user_id, name: senderName, type: 'human' },
            },
          };

          db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(event.event_id, agent.id, event.event, event.source, event.timestamp, JSON.stringify(event), Date.now());

          pushEvent(agent.id, event);

          if (agent.webhook_url) {
            deliverWebhook(agent, event).catch(e =>
              console.warn(`[gateway] Webhook delivery failed for ${agent.name}: ${e.message}`));
          }

          console.log(`[gateway] Event ${event.event} → ${agent.name}`);
        }
      } else {
        // Channel/thread message: find agents mentioned with exact word boundary
        for (const agent of agents) {
          // Use word boundary: @agentname must not be followed by alphanumeric or hyphen
          const mentionRegex = new RegExp(`@${agent.name}(?![\\w-])`);
          if (!mentionRegex.test(post.message)) continue;

          // Skip if the post was made by this agent's own bot
          const botInfo = mmBotTokens.get(agent.name);
          if (botInfo && post.user_id === botInfo.userId) continue;

          const event = {
            event: 'message.mentioned',
            source: 'mattermost',
            event_id: genId('evt'),
            timestamp: post.create_at,
            data: {
              channel_id: post.channel_id,
              channel_name: channelName,
              message_id: post.id,
              thread_id: post.root_id || null,
              text: post.message,
              text_without_mention: post.message.replace(new RegExp(`@${agent.name}(?![\\w-])\\s*`, 'g'), '').trim(),
              sender: { id: post.user_id, name: senderName, type: 'human' },
            },
          };

          db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(event.event_id, agent.id, event.event, event.source, event.timestamp, JSON.stringify(event), Date.now());

          pushEvent(agent.id, event);

          if (agent.webhook_url) {
            deliverWebhook(agent, event).catch(e =>
              console.warn(`[gateway] Webhook delivery failed for ${agent.name}: ${e.message}`));
          }

          console.log(`[gateway] Event ${event.event} → ${agent.name}`);
        }
      }
    } catch (e) {
      console.error(`[gateway] MM listener error: ${e.message}`);
    }
  });

  ws.on('close', () => {
    console.log('[gateway] MM WebSocket closed, reconnecting in 5s...');
    setTimeout(startMMListener, 5000);
  });

  ws.on('error', (e) => console.error(`[gateway] MM WebSocket error: ${e.message}`));
}

async function deliverWebhook(agent, event) {
  const timestamp = String(Date.now());
  const body = JSON.stringify(event);
  const signature = 'sha256=' + crypto.createHmac('sha256', agent.webhook_secret || '')
    .update(`${timestamp}.${body}`).digest('hex');

  await fetch(agent.webhook_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-Hub-Timestamp': timestamp,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
}

// ─── Outline Webhook Receiver ────────────────────
// Receives comment events from Outline and routes to mentioned agents
app.post('/webhooks/outline', express.json(), async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  try {
    const { event, payload } = req.body;

    // Extract plain text from ProseMirror JSON
    const extractText = (node) => {
      let t = '';
      if (node.text) t += node.text;
      if (node.content) node.content.forEach(c => { t += extractText(c); });
      return t;
    };

    const agents = db.prepare('SELECT * FROM agent_accounts').all();

    if (event === 'comments.create') {
      let comment = payload?.model;
      if (!comment) return;

      // Outline webhook may send model.data as null — fetch the full comment if needed
      if (!comment.data && comment.id) {
        try {
          const cRes = await upstream(OL_URL, 'POST', '/api/comments.list',
            { documentId: comment.documentId }, OL_TOKEN);
          const found = (cRes.data?.data || []).find(c => c.id === comment.id);
          if (found) comment = { ...comment, ...found };
        } catch {}
      }

      // Extract text and mention node labels separately from ProseMirror
      const extractComment = (node) => {
        const result = { text: '', mentionLabels: [] };
        const walk = (n) => {
          if (n.type === 'mention' && n.attrs?.label) {
            // Store mention labels separately — do NOT inline into text to avoid substring collisions
            result.mentionLabels.push(n.attrs.label.toLowerCase()); // e.g. "zylos digger"
          } else if (n.text) {
            result.text += n.text;
          }
          if (n.content) n.content.forEach(walk);
        };
        walk(node);
        return result;
      };

      let commentText = '';
      let mentionLabels = [];
      if (comment.data) {
        const extracted = extractComment(comment.data);
        commentText = extracted.text.trim();
        mentionLabels = extracted.mentionLabels;
      }

      // Fetch document content to include in the event
      let docText = '';
      try {
        const docRes = await upstream(OL_URL, 'POST', '/api/documents.info',
          { id: comment.documentId }, OL_TOKEN);
        if (docRes.data?.data?.text) docText = docRes.data.data.text;
      } catch {}

      for (const agent of agents) {
        // Match mention nodes by display_name (exact, case-insensitive)
        // OR plain @name in text (for non-UI @mentions)
        const displayName = (agent.display_name || agent.name).toLowerCase();
        const nameVariants = [agent.name.toLowerCase(), displayName];
        const hasMentionNode = mentionLabels.some(l => nameVariants.includes(l));
        const hasTextMention = new RegExp(`@${agent.name}(?![\\w-])`, 'i').test(commentText);
        if (!hasMentionNode && !hasTextMention) continue;

        const cleanText = commentText
          .replace(new RegExp(`@${agent.name}(?![\\w-])\\s*`, 'gi'), '')
          .trim();
        const evt = {
          event: 'comment.mentioned',
          source: 'outline',
          event_id: genId('evt'),
          timestamp: new Date(comment.createdAt).getTime(),
          data: {
            doc_id: comment.documentId,
            comment_id: comment.id,
            parent_comment_id: comment.parentCommentId || null,
            text_without_mention: cleanText,
            anchor_text: null,
            doc_title: payload?.document?.title || '',
            doc_content: docText,
            sender: { id: comment.createdById, name: payload?.actor?.name || 'unknown', type: 'human' },
          },
        };

        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, agent.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), Date.now());

        pushEvent(agent.id, evt);
        if (agent.webhook_url) deliverWebhook(agent, evt).catch(() => {});
        console.log(`[gateway] Event ${evt.event} → ${agent.name} (doc: ${evt.data.doc_id})`);
      }
    } else if (event === 'documents.update') {
      // Handle @mentions in document body
      const doc = payload?.model;
      if (!doc) return;

      let text = '';
      if (doc.content) text = extractText(doc.content);

      const docUpdatedAt = new Date(doc.updatedAt).getTime();

      for (const agent of agents) {
        const mentionRegex = new RegExp(`@${agent.name}(?![\\w-])`, 'i');
        if (!mentionRegex.test(text)) continue;

        // Deduplicate: only fire once per (doc, agent, ~minute window)
        const windowStart = docUpdatedAt - 60000;
        const existing = db.prepare(
          `SELECT id FROM events WHERE agent_id=? AND event_type='doc.mentioned' AND payload LIKE ? AND occurred_at > ?`
        ).get(agent.id, `%"doc_id":"${doc.id}"%`, windowStart);
        if (existing) continue;

        const cleanText = text.replace(new RegExp(`@${agent.name}(?![\\w-])\\s*`, 'gi'), '').trim();
        const evt = {
          event: 'doc.mentioned',
          source: 'outline',
          event_id: genId('evt'),
          timestamp: docUpdatedAt,
          data: {
            doc_id: doc.id,
            doc_title: doc.title || '',
            text_without_mention: cleanText,
            sender: { id: payload?.actor?.id, name: payload?.actor?.name || 'unknown', type: 'human' },
          },
        };

        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, agent.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), Date.now());

        pushEvent(agent.id, evt);
        if (agent.webhook_url) deliverWebhook(agent, evt).catch(() => {});
        console.log(`[gateway] Event ${evt.event} → ${agent.name} (doc: ${doc.id})`);
      }
    }
  } catch (e) {
    console.error(`[gateway] Outline webhook error: ${e.message}`);
  }
});

// ─── Plane Polling ───────────────────────────────
// Plane community edition has no webhooks — poll for new assignments and comments
const PLANE_STATE_FILE = path.join(__dirname, '.plane-poll-state.json');
function loadPlanePollState() {
  try {
    const s = JSON.parse(fs.readFileSync(PLANE_STATE_FILE, 'utf8'));
    return { lastPollAt: s.lastPollAt || (Date.now() - 30000) };
  } catch {
    return { lastPollAt: Date.now() - 30000 };
  }
}
function savePlanePollState(state) {
  fs.writeFileSync(PLANE_STATE_FILE, JSON.stringify({ lastPollAt: state.lastPollAt }));
}
const planePollState = loadPlanePollState();

async function pollPlane() {
  try {
    const since = planePollState.lastPollAt;
    planePollState.lastPollAt = Date.now();
    savePlanePollState(planePollState);

    const agents = db.prepare('SELECT * FROM agent_accounts').all();
    const apiBase = `/api/v1/workspaces/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}`;

    // Fetch recently updated issues
    const issuesRes = await upstream(PLANE_URL, 'GET',
      `${apiBase}/issues/?per_page=50&order_by=-updated_at`, null, null, { 'X-API-Key': PLANE_TOKEN });

    if (!Array.isArray(issuesRes.data?.results)) return;

    for (const issue of issuesRes.data.results) {
      const updatedAt = new Date(issue.updated_at).getTime();
      if (updatedAt <= since) continue; // Only process recently changed

      // Check for new assignments: issue has assignees matching an agent's Plane user ID
      for (const agent of agents) {
        if (!agent.plane_token) continue;

        // Look up agent's Plane user ID (cache it)
        if (!planePollState.agentPlaneIds) planePollState.agentPlaneIds = new Map();
        if (!planePollState.agentPlaneIds.has(agent.name)) {
          const meRes = await upstream(PLANE_URL, 'GET',
            `/api/v1/users/me/`, null, null, { 'X-API-Key': agent.plane_token });
          if (meRes.data?.id) planePollState.agentPlaneIds.set(agent.name, meRes.data.id);
        }
        const planeUserId = planePollState.agentPlaneIds.get(agent.name);
        if (!planeUserId) continue;

        const assigneeIds = issue.assignees || [];
        if (!assigneeIds.includes(planeUserId)) continue;

        // Deduplicate: check if we already emitted this assignment event
        const existing = db.prepare(
          `SELECT id FROM events WHERE agent_id=? AND event_type='task.assigned' AND payload LIKE ?`
        ).get(agent.id, `%"task_id":"${issue.id}"%`);
        if (existing) continue;

        // Parse description: split off "Context from <agent>:" section if present
        const rawDesc = issue.description_stripped || '';
        const ctxMatch = rawDesc.match(/^([\s\S]*?)---\s*Context from ([^:]+):\s*([\s\S]*)$/);
        const taskDescription = ctxMatch ? ctxMatch[1].trim() : rawDesc;
        const delegationContext = ctxMatch ? { from: ctxMatch[2].trim(), text: ctxMatch[3].trim() } : null;

        const evt = {
          event: 'task.assigned',
          source: 'plane',
          event_id: genId('evt'),
          timestamp: updatedAt,
          data: {
            task_id: issue.id,
            task_title: issue.name,
            task_description: taskDescription,
            delegation_context: delegationContext,
            priority: issue.priority,
            start_date: issue.start_date || null,
            due_date: issue.target_date || null,
            task_url: `${PLANE_URL}/${PLANE_WORKSPACE}/projects/${PLANE_PROJECT_ID}/issues/${issue.id}`,
            assigned_by: { name: 'system' },
          },
        };

        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, agent.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), Date.now());

        pushEvent(agent.id, evt);
        console.log(`[gateway] Event ${evt.event} → ${agent.name} (task: ${issue.id})`);
      }

      // Check for new comments on this issue
      const commentsRes = await upstream(PLANE_URL, 'GET',
        `${apiBase}/issues/${issue.id}/comments/`, null, null, { 'X-API-Key': PLANE_TOKEN });

      if (!Array.isArray(commentsRes.data?.results)) continue;

      for (const comment of commentsRes.data.results) {
        const commentAt = new Date(comment.created_at).getTime();
        if (commentAt <= since) continue;

        const html = comment.comment_html || '';

        // Extract mentioned Plane user IDs from <mention-component entity_identifier="...">
        const mentionedUserIds = [];
        const mentionRe = /entity_identifier="([^"]+)"/g;
        let m;
        while ((m = mentionRe.exec(html)) !== null) mentionedUserIds.push(m[1]);

        // Extract plain text (strip all HTML tags including custom components)
        const commentText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        for (const agent of agents) {
          // Match by Plane user ID in mention-component OR plain @name in text
          const planeUserId = planePollState.agentPlaneIds?.get(agent.name);
          const hasMentionNode = planeUserId && mentionedUserIds.includes(planeUserId);
          const hasTextMention = new RegExp(`@${agent.name}(?![\\w-])`).test(commentText);
          if (!hasMentionNode && !hasTextMention) continue;

          // Skip if posted by this agent's own bot
          const botInfo = mmBotTokens.get(agent.name);
          if (botInfo && comment.actor === botInfo.userId) continue;

          const evt = {
            event: 'task.commented',
            source: 'plane',
            event_id: genId('evt'),
            timestamp: commentAt,
            data: {
              task_id: issue.id,
              task_title: issue.name,
              comment_id: comment.id,
              text: commentText,
              sender: { id: comment.actor, name: comment.actor_detail?.display_name || comment.actor, type: 'human' },
            },
          };

          db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(evt.event_id, agent.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), Date.now());

          pushEvent(agent.id, evt);
          console.log(`[gateway] Event ${evt.event} → ${agent.name} (task: ${issue.id})`);
        }
      }
    }
  } catch (e) {
    console.error(`[gateway] Plane poll error: ${e.message}`);
  }
}

// ─── NocoDB Comment Polling ──────────────────────
// NocoDB has no webhook for row comments — poll the audit log every 15s
const NC_POLL_STATE_FILE = path.join(__dirname, '.nc-poll-state.json');
function loadNcPollState() {
  try {
    const s = JSON.parse(fs.readFileSync(NC_POLL_STATE_FILE, 'utf8'));
    return { lastCommentId: s.lastCommentId || null, lastPollAt: s.lastPollAt || null };
  } catch {
    return { lastCommentId: null, lastPollAt: null };
  }
}
function saveNcPollState(state) {
  fs.writeFileSync(NC_POLL_STATE_FILE, JSON.stringify(state));
}
const ncPollState = loadNcPollState();

async function pollNcComments() {
  if (!NC_EMAIL || !NC_PASSWORD) return;
  try {
    const jwt = await getNcJwt();
    if (!jwt) return;

    // Fetch recent comments from audit log (newest first)
    const url = `${NC_URL}/api/v1/db/meta/projects/${NC_BASE_ID}/audits?where=(op_type,eq,COMMENT)&limit=25&sort=-created_at`;
    const res = await fetch(url, { headers: { 'xc-auth': jwt } });
    if (!res.ok) return;
    const data = await res.json();
    const comments = data.list || [];
    if (comments.length === 0) return;

    // Determine new comments since last poll
    const lastId = ncPollState.lastCommentId;
    const lastPollAt = ncPollState.lastPollAt ? new Date(ncPollState.lastPollAt).getTime() : 0;
    const newComments = lastId
      ? comments.filter(c => c.id !== lastId && new Date(c.created_at).getTime() > lastPollAt)
      : comments.filter(c => new Date(c.created_at).getTime() > lastPollAt);

    // Update state to newest comment
    ncPollState.lastCommentId = comments[0].id;
    ncPollState.lastPollAt = comments[0].created_at;
    saveNcPollState(ncPollState);

    if (newComments.length === 0) return;

    const agents = db.prepare('SELECT * FROM agent_accounts').all();

    for (const comment of newComments) {
      const text = comment.description || '';

      for (const agent of agents) {
        // Skip if this comment was posted by this agent itself
        const agentNcEmail = `${agent.name}@nc-agents.local`;
        if (comment.user === agentNcEmail) continue;

        // Match @agentname mention
        const mentionRegex = new RegExp(`@${agent.name}(?![\\w-])`, 'i');
        if (!mentionRegex.test(text)) continue;

        const cleanText = text.replace(new RegExp(`@${agent.name}(?![\\w-])\\s*`, 'gi'), '').trim();

        const evt = {
          event: 'data.commented',
          source: 'nocodb',
          event_id: genId('evt'),
          timestamp: new Date(comment.created_at).getTime(),
          data: {
            comment_id: comment.id,
            table_id: comment.fk_model_id,
            row_id: comment.row_id,
            text: cleanText,
            raw_text: text,
            sender: { name: comment.user, type: 'human' },
          },
        };

        db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evt.event_id, agent.id, evt.event, evt.source, evt.timestamp, JSON.stringify(evt), Date.now());

        pushEvent(agent.id, evt);
        if (agent.webhook_url) deliverWebhook(agent, evt).catch(() => {});
        console.log(`[gateway] Event ${evt.event} → ${agent.name} (table: ${evt.data.table_id}, row: ${evt.data.row_id})`);
      }
    }
  } catch (e) {
    console.error(`[gateway] NC comment poll error: ${e.message}`);
  }
}

// ─── Agent Self-Registration ────────────────────
// Simplified flow: agent registers → gets pending status → admin approves in IM
app.post('/api/agents/self-register', async (req, res) => {
  const { name, display_name, capabilities, webhook_url, webhook_secret } = req.body;
  if (!name || !display_name) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'name and display_name required' });
  }
  // Validate name format: lowercase, alphanumeric + hyphens
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
    return res.status(400).json({ error: 'INVALID_NAME', message: 'Name must be lowercase alphanumeric with hyphens, 2-31 chars' });
  }
  // Check name uniqueness
  const existing = db.prepare('SELECT id FROM agent_accounts WHERE name = ?').get(name);
  if (existing) {
    return res.status(409).json({ error: 'NAME_TAKEN', message: `Name "${name}" already registered` });
  }

  const agentId = genId('agt');
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  db.prepare(`INSERT INTO agent_accounts (id, name, display_name, token_hash, capabilities, webhook_url, webhook_secret, created_at, updated_at, pending_approval)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(agentId, name, display_name, hashToken(token), JSON.stringify(capabilities || []),
      webhook_url || null, webhook_secret || null, now, now);

  // Notify admin via Mattermost Town Square
  try {
    const townSquare = await findTownSquareChannel();
    if (townSquare && MM_ADMIN_TOKEN) {
      const msg = `🤖 **New agent registration request**\n` +
        `Name: \`${name}\` | Display: ${display_name}\n` +
        `Capabilities: ${(capabilities || []).join(', ') || 'none'}\n` +
        `To approve: \`curl -X POST http://localhost:${PORT}/api/admin/agents/${agentId}/approve -H "Authorization: Bearer ${ADMIN_TOKEN}"\``;
      await upstream(MM_URL, 'POST', '/api/v4/posts',
        { channel_id: townSquare, message: msg }, MM_ADMIN_TOKEN);
    }
  } catch (e) {
    console.warn(`[gateway] Failed to notify admin about registration: ${e.message}`);
  }

  // Create MM bot + NC user in advance (will only activate after approval)
  createMMBot(name, display_name).catch(e => console.warn(`[gateway] MM bot creation failed: ${e.message}`));
  createNcUser(name, display_name).then(ncPassword => {
    if (ncPassword) {
      db.prepare('UPDATE agent_accounts SET nc_password = ? WHERE id = ?').run(ncPassword, agentId);
    }
  }).catch(e => console.warn(`[gateway] NC user creation failed: ${e.message}`));

  res.status(201).json({
    agent_id: agentId,
    token,
    name,
    display_name,
    status: 'pending_approval',
    message: 'Registration received. Token is active but rate-limited until admin approval.',
    created_at: now,
  });
});

// Admin: approve a pending agent
app.post('/api/admin/agents/:agent_id/approve', authenticateAdmin, (req, res) => {
  const agent = db.prepare('SELECT * FROM agent_accounts WHERE id = ?').get(req.params.agent_id);
  if (!agent) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found' });
  }
  db.prepare('UPDATE agent_accounts SET pending_approval = 0, updated_at = ? WHERE id = ?')
    .run(Date.now(), agent.id);
  res.json({ agent_id: agent.id, name: agent.name, status: 'approved' });
});

// Admin: list all agents
app.get('/api/admin/agents', authenticateAdmin, (req, res) => {
  const agents = db.prepare('SELECT id, name, display_name, capabilities, online, last_seen_at, pending_approval, created_at FROM agent_accounts').all();
  res.json({ agents: agents.map(a => ({ ...a, capabilities: JSON.parse(a.capabilities || '[]'), pending_approval: !!a.pending_approval })) });
});

// Agent-facing: list other agents (public info only)
app.get('/api/agents', authenticateAgent, (req, res) => {
  const agents = db.prepare('SELECT id, name, display_name, avatar_url, capabilities, online, last_seen_at FROM agent_accounts WHERE pending_approval = 0 OR pending_approval IS NULL').all();
  res.json({
    agents: agents.map(a => ({
      agent_id: a.id, name: a.name, display_name: a.display_name, avatar_url: a.avatar_url || null,
      capabilities: JSON.parse(a.capabilities || '[]'),
      online: !!a.online, last_seen_at: a.last_seen_at,
    })),
  });
});

// Agent-facing: get info about a specific agent
app.get('/api/agents/:name', authenticateAgent, (req, res) => {
  const agent = db.prepare('SELECT id, name, display_name, avatar_url, capabilities, online, last_seen_at FROM agent_accounts WHERE name = ? AND (pending_approval = 0 OR pending_approval IS NULL)').get(req.params.name);
  if (!agent) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({
    agent_id: agent.id, name: agent.name, display_name: agent.display_name, avatar_url: agent.avatar_url || null,
    capabilities: JSON.parse(agent.capabilities || '[]'),
    online: !!agent.online, last_seen_at: agent.last_seen_at,
  });
});

// Update agent profile (display_name, avatar_url) — accessible to any authenticated agent
app.patch('/api/agents/:name', authenticateAgent, (req, res) => {
  const { display_name, avatar_url } = req.body;
  const target = db.prepare('SELECT id FROM agent_accounts WHERE name = ?').get(req.params.name);
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
  const updates = [];
  const values = [];
  if (display_name !== undefined) { updates.push('display_name = ?'); values.push(display_name); }
  if (avatar_url !== undefined) { updates.push('avatar_url = ?'); values.push(avatar_url); }
  if (updates.length === 0) return res.status(400).json({ error: 'NO_FIELDS' });
  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(target.id);
  db.prepare(`UPDATE agent_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

// Upload agent avatar — stored in gateway's own uploads dir and served statically
const AVATAR_DIR = path.join(__dirname, 'uploads', 'avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

// Serve uploaded avatars statically (at both /uploads and /api/uploads for proxy compatibility)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: AVATAR_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

app.post('/api/agents/:name/avatar', authenticateAgent, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
  const target = db.prepare('SELECT id, avatar_url FROM agent_accounts WHERE name = ?').get(req.params.name);
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
  // Delete old avatar file if it exists
  if (target.avatar_url && target.avatar_url.includes('/uploads/avatars/')) {
    const filename = target.avatar_url.split('/uploads/avatars/').pop();
    if (filename) {
      const oldPath = path.join(AVATAR_DIR, filename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
  }
  const avatarUrl = `/api/gateway/uploads/avatars/${req.file.filename}`;
  db.prepare('UPDATE agent_accounts SET avatar_url = ?, updated_at = ? WHERE id = ?').run(avatarUrl, Date.now(), target.id);
  res.json({ ok: true, avatar_url: avatarUrl });
});

// Helper: find Town Square channel ID
let townSquareId = null;
async function findTownSquareChannel() {
  if (townSquareId) return townSquareId;
  if (!MM_ADMIN_TOKEN) return null;
  const teamsRes = await upstream(MM_URL, 'GET', '/api/v4/teams', null, MM_ADMIN_TOKEN);
  if (!Array.isArray(teamsRes.data) || teamsRes.data.length === 0) return null;
  const chRes = await upstream(MM_URL, 'GET', `/api/v4/teams/${teamsRes.data[0].id}/channels/name/town-square`, null, MM_ADMIN_TOKEN);
  if (chRes.data?.id) townSquareId = chRes.data.id;
  return townSquareId;
}

// ─── Thread Context ─────────────────────────────
// Link a doc/task/data_row to a thread for cross-system context
app.post('/api/threads/:thread_id/links', authenticateAgent, (req, res) => {
  const { link_type, link_id, link_title } = req.body;
  if (!link_type || !link_id) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'link_type and link_id required' });
  }
  if (!['doc', 'task', 'data_row'].includes(link_type)) {
    return res.status(400).json({ error: 'INVALID_LINK_TYPE', message: 'link_type must be doc, task, or data_row' });
  }
  const id = genId('tl');
  db.prepare('INSERT INTO thread_links (id, thread_id, link_type, link_id, link_title, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.thread_id, link_type, link_id, link_title || null, req.agent.id, Date.now());
  res.status(201).json({ id, thread_id: req.params.thread_id, link_type, link_id });
});

// Get thread context: messages + linked resources
app.get('/api/threads/:thread_id/context', authenticateAgent, async (req, res) => {
  const threadId = req.params.thread_id;
  const botToken = await getMMBotToken(req.agent.name);

  // 1. Get thread messages from MM
  let messages = [];
  if (botToken) {
    const threadRes = await upstream(MM_URL, 'GET', `/api/v4/posts/${threadId}/thread?perPage=50`, null, botToken);
    if (threadRes.data?.order) {
      const order = threadRes.data.order;
      const posts = threadRes.data.posts || {};
      messages = order.map(id => {
        const p = posts[id];
        return {
          message_id: p.id, text: p.message, sender_id: p.user_id,
          created_at: p.create_at,
        };
      });
    }
  }

  // 2. Get linked resources
  const links = db.prepare('SELECT * FROM thread_links WHERE thread_id = ? ORDER BY created_at ASC').all(threadId);

  // 3. Optionally fetch linked resource summaries
  const linkedResources = [];
  for (const link of links) {
    const entry = { link_id: link.id, type: link.link_type, id: link.link_id, title: link.link_title };
    linkedResources.push(entry);
  }

  res.json({ thread_id: threadId, messages, linked_resources: linkedResources });
});

// Delete a thread link
app.delete('/api/threads/:thread_id/links/:link_id', authenticateAgent, (req, res) => {
  const link = db.prepare('SELECT * FROM thread_links WHERE id = ? AND thread_id = ?').get(req.params.link_id, req.params.thread_id);
  if (!link) return res.status(404).json({ error: 'NOT_FOUND' });
  if (link.created_by !== req.agent.id) return res.status(403).json({ error: 'FORBIDDEN', message: 'Can only delete own links' });
  db.prepare('DELETE FROM thread_links WHERE id = ?').run(link.id);
  res.json({ deleted: true });
});

// ─── Enhanced Catchup ───────────────────────────
// Get unread event count
app.get('/api/me/events/count', authenticateAgent, (req, res) => {
  const since = parseInt(req.query.since || '0');
  const count = db.prepare('SELECT COUNT(*) as count FROM events WHERE agent_id = ? AND delivered = 0 AND occurred_at > ?')
    .get(req.agent.id, since);
  res.json({ unread_count: count.count });
});

// Acknowledge events (mark as delivered up to a cursor)
app.post('/api/me/events/ack', authenticateAgent, (req, res) => {
  const { cursor } = req.body;
  if (!cursor) return res.status(400).json({ error: 'MISSING_CURSOR', message: 'cursor (timestamp) required' });
  const result = db.prepare('UPDATE events SET delivered = 1 WHERE agent_id = ? AND occurred_at <= ? AND delivered = 0')
    .run(req.agent.id, parseInt(cursor));
  res.json({ acknowledged: result.changes });
});

// ─── Doc Icons (emoji per document/table) ─────────
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
  // Also update content_items if exists (both doc: and table: prefixed)
  db.prepare('UPDATE content_items SET icon = ? WHERE raw_id = ?').run(icon, req.params.doc_id);
  res.json({ doc_id: req.params.doc_id, icon, updated_at: now });
});

app.delete('/api/doc-icons/:doc_id', authenticateAgent, (req, res) => {
  db.prepare('DELETE FROM doc_icons WHERE doc_id = ?').run(req.params.doc_id);
  // Clear icon in content_items too
  db.prepare('UPDATE content_items SET icon = NULL WHERE raw_id = ?').run(req.params.doc_id);
  res.json({ deleted: true });
});

// ─── Content Items (unified sidebar metadata) ─────
// Sync doc/table metadata from Outline + NocoDB into content_items table
// Shell reads from here instead of calling Outline + NocoDB + doc-icons separately

const contentItemsUpsert = db.prepare(`
  INSERT INTO content_items (id, raw_id, type, title, icon, parent_id, collection_id, created_by, updated_by, created_at, updated_at, deleted_at, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    icon = COALESCE((SELECT icon FROM doc_icons WHERE doc_id = excluded.raw_id), excluded.icon),
    parent_id = excluded.parent_id,
    collection_id = excluded.collection_id,
    created_by = excluded.created_by,
    updated_by = excluded.updated_by,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    synced_at = excluded.synced_at
`);

async function syncContentItems() {
  const now = Date.now();
  console.log('[gateway] Syncing content items from Outline + NocoDB...');

  // 1. Sync docs from Outline
  let docCount = 0;
  if (OL_TOKEN) {
    try {
      let offset = 0;
      const limit = 100;
      while (true) {
        const result = await upstream(OL_URL, 'POST', '/api/documents.list', { limit, offset, sort: 'updatedAt', direction: 'DESC' }, OL_TOKEN);
        if (!result.data?.data) break;
        const docs = result.data.data;
        for (const doc of docs) {
          const nodeId = `doc:${doc.id}`;
          const parentId = doc.parentDocumentId ? `doc:${doc.parentDocumentId}` : null;
          // Check for custom icon in doc_icons table
          const customIcon = db.prepare('SELECT icon FROM doc_icons WHERE doc_id = ?').get(doc.id);
          const icon = customIcon?.icon || doc.icon || doc.emoji || null;
          contentItemsUpsert.run(
            nodeId, doc.id, 'doc', doc.title || '',
            icon, parentId, doc.collectionId || null,
            doc.createdBy?.name || null, doc.updatedBy?.name || null,
            doc.createdAt || null, doc.updatedAt || null, doc.deletedAt || null,
            now
          );
          docCount++;
        }
        if (docs.length < limit) break;
        offset += limit;
      }
    } catch (err) {
      console.error('[gateway] Content sync: Outline error:', err.message);
    }
  }

  // 2. Sync tables from NocoDB
  let tableCount = 0;
  if (NC_EMAIL && NC_PASSWORD) {
    try {
      const result = await nc('GET', `/api/v1/db/meta/projects/${NC_BASE_ID}/tables`);
      if (result.status < 400 && result.data?.list) {
        for (const t of result.data.list) {
          let displayTitle = t.title;
          try {
            const m = typeof t.meta === 'string' ? JSON.parse(t.meta) : t.meta;
            if (m?._displayTitle) displayTitle = m._displayTitle;
          } catch {}
          const nodeId = `table:${t.id}`;
          const customIcon = db.prepare('SELECT icon FROM doc_icons WHERE doc_id = ?').get(t.id);
          contentItemsUpsert.run(
            nodeId, t.id, 'table', displayTitle || '',
            customIcon?.icon || null, null, null,
            null, null,
            t.created_at || null, t.updated_at || null, null,
            now
          );
          tableCount++;
        }
      }
    } catch (err) {
      console.error('[gateway] Content sync: NocoDB error:', err.message);
    }
  }

  // 3. Remove stale items (not seen in this sync cycle)
  db.prepare('DELETE FROM content_items WHERE synced_at < ? AND deleted_at IS NULL').run(now);

  console.log(`[gateway] Content sync done: ${docCount} docs, ${tableCount} tables`);
}

// ─── Boards (Excalidraw) ─────────────────────────
// API: create a board
app.post('/api/boards', authenticateAgent, (req, res) => {
  const { title = '' } = req.body;
  const id = crypto.randomUUID();
  const now = Date.now();
  const agentName = req.agent?.name || null;
  const defaultData = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'asuite',
    elements: [],
    appState: {},
    files: {},
  });

  db.prepare(`INSERT INTO boards (id, data_json, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

  // Create content_item entry
  const nodeId = `board:${id}`;
  const isoNow = new Date().toISOString();
  contentItemsUpsert.run(
    nodeId, id, 'board', title || '',
    null, req.body.parent_id || null, null,
    agentName, agentName, isoNow, isoNow, null, Date.now()
  );

  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
  res.status(201).json({ board_id: id, item });
});

// API: get board data
app.get('/api/boards/:id', authenticateAgent, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({
    id: board.id,
    data: JSON.parse(board.data_json),
    created_by: board.created_by,
    updated_by: board.updated_by,
    created_at: board.created_at,
    updated_at: board.updated_at,
  });
});

// API: save board data (auto-save from frontend)
app.patch('/api/boards/:id', authenticateAgent, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'NOT_FOUND' });

  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'MISSING_DATA' });

  const now = Date.now();
  const agentName = req.agent?.name || null;
  db.prepare('UPDATE boards SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(data), agentName, now, req.params.id);

  res.json({ saved: true, updated_at: now });
});

// ─── Presentations (Fabric.js PPT) ─────────────────
// API: create a presentation
app.post('/api/presentations', authenticateAgent, (req, res) => {
  const { title = '' } = req.body;
  const id = crypto.randomUUID();
  const now = Date.now();
  const agentName = req.agent?.name || null;
  const defaultData = JSON.stringify({ slides: [] });

  db.prepare(`INSERT INTO presentations (id, data_json, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

  // Create content_item entry
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

// API: get presentation data
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

// API: save presentation data (auto-save from frontend)
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
// Layout templates for Agent-friendly slide creation
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

// API: append a slide (supports semantic layout)
app.post('/api/presentations/:id/slides', authenticateAgent, (req, res) => {
  const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!pres) return res.status(404).json({ error: 'NOT_FOUND' });

  const data = JSON.parse(pres.data_json);
  const { layout, ...opts } = req.body;

  let slide;
  if (layout && SLIDE_LAYOUTS[layout]) {
    slide = SLIDE_LAYOUTS[layout](opts);
  } else if (req.body.elements) {
    // Raw Fabric.js elements
    slide = { elements: req.body.elements, background: req.body.background || '#ffffff', notes: req.body.notes || '' };
  } else {
    // Default blank
    slide = SLIDE_LAYOUTS.blank(opts);
  }

  data.slides.push(slide);
  const now = Date.now();
  const agentName = req.agent?.name || null;
  db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(data), agentName, now, req.params.id);

  res.status(201).json({ index: data.slides.length - 1, slide, updated_at: now });
});

// API: update a single slide
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
    // Merge provided fields into existing slide
    Object.assign(data.slides[idx], req.body);
  }

  const now = Date.now();
  const agentName = req.agent?.name || null;
  db.prepare('UPDATE presentations SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(data), agentName, now, req.params.id);

  res.json({ index: idx, slide: data.slides[idx], updated_at: now });
});

// API: delete a single slide
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

// ─── Spreadsheet CRUD ────────────────────────────
app.post('/api/spreadsheets', authenticateAgent, (req, res) => {
  const agentName = req.agentConfig?.name || 'unknown';
  const now = Date.now();
  const id = crypto.randomUUID();
  const defaultData = {};
  db.prepare(`INSERT INTO spreadsheets (id, data_json, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, JSON.stringify(defaultData), agentName, agentName, now, now);
  res.json({ id, data: defaultData, created_by: agentName, created_at: now, updated_at: now });
});

app.get('/api/spreadsheets/:id', authenticateAgent, (req, res) => {
  const row = db.prepare('SELECT * FROM spreadsheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Spreadsheet not found' });
  let data;
  try { data = JSON.parse(row.data_json); } catch { data = {}; }
  res.json({ id: row.id, data, created_by: row.created_by, updated_by: row.updated_by, created_at: row.created_at, updated_at: row.updated_at });
});

app.patch('/api/spreadsheets/:id', authenticateAgent, (req, res) => {
  const row = db.prepare('SELECT * FROM spreadsheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Spreadsheet not found' });
  const agentName = req.agentConfig?.name || 'unknown';
  const now = Date.now();
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data is required' });
  db.prepare('UPDATE spreadsheets SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(data), agentName, now, req.params.id);
  res.json({ saved: true, updated_at: now });
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

// API: list content items for sidebar (or trash)
app.get('/api/content-items', authenticateAgent, (req, res) => {
  if (req.query.deleted === 'true') {
    const rows = db.prepare('SELECT * FROM content_items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
    return res.json({ items: rows });
  }
  const rows = db.prepare('SELECT * FROM content_items WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC').all();
  res.json({ items: rows });
});

// API: create content item (doc or table) — Gateway is source of truth
app.post('/api/content-items', authenticateAgent, async (req, res) => {
  const { type, title = '', parent_id = null, collection_id, columns } = req.body;
  if (!type || !['doc', 'table', 'board', 'presentation', 'spreadsheet', 'diagram'].includes(type)) {
    return res.status(400).json({ error: 'INVALID_TYPE', message: 'type must be "doc", "table", "board", "presentation", "spreadsheet", or "diagram"' });
  }

  const now = new Date().toISOString();
  const agentName = req.agent?.name || null;

  if (type === 'doc') {
    // Determine collection: use provided or fall back to first available
    let collId = collection_id;
    if (!collId && OL_TOKEN) {
      try {
        const colResult = await upstream(OL_URL, 'POST', '/api/collections.list', {}, OL_TOKEN);
        if (colResult.data?.data?.length > 0) collId = colResult.data.data[0].id;
      } catch {}
    }
    if (!collId) return res.status(400).json({ error: 'NO_COLLECTION', message: 'No collection_id and none found in Outline' });

    // Parse parent: only doc parents go to Outline; table parents are sidebar-only
    let olParentId = null;
    if (parent_id && parent_id.startsWith('doc:')) {
      olParentId = parent_id.slice(4);
    }

    const agentOlToken = req.agent?.ol_token || OL_TOKEN;
    const olBody = { title: title || '', text: '', collectionId: collId, publish: true };
    if (olParentId) olBody.parentDocumentId = olParentId;
    const result = await upstream(OL_URL, 'POST', '/api/documents.create', olBody, agentOlToken);
    if (!result.data?.ok) {
      return res.status(500).json({ error: 'UPSTREAM_ERROR', detail: result.data });
    }
    const doc = result.data.data;
    const nodeId = `doc:${doc.id}`;
    contentItemsUpsert.run(
      nodeId, doc.id, 'doc', title || '',
      null, parent_id, collId,
      doc.createdBy?.name || agentName, doc.updatedBy?.name || agentName,
      doc.createdAt || now, doc.updatedAt || now, null, Date.now()
    );
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
    return res.status(201).json({ item });
  }

  if (type === 'table') {
    if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });

    const tableTitle = title || 'Untitled';
    const tableCols = columns || [
      { title: 'Name', uidt: 'SingleLineText' },
      { title: 'Notes', uidt: 'LongText' },
    ];
    const hasPk = tableCols.some(c => c.pk);
    const normalizeCol = c => {
      const col = { column_name: c.column_name || c.title, title: c.title || c.column_name, uidt: c.uidt };
      if (c.pk !== undefined) col.pk = c.pk;
      if (c.ai !== undefined) col.ai = c.ai;
      if (c.required !== undefined) col.rqd = c.required;
      if (c.uidt === 'SingleSelect' || c.uidt === 'MultiSelect') {
        const optsList = (c.options || []).filter(o => o && (o.title || typeof o === 'string'));
        if (optsList.length > 0) {
          col.dtxp = optsList.map(o => `'${(typeof o === 'string' ? o : o.title).replace(/'/g, "''")}'`).join(',');
          col.colOptions = { options: optsList.map((o, i) => ({ title: typeof o === 'string' ? o : o.title, color: o.color, order: i + 1 })) };
        }
      }
      return col;
    };
    const fullColumns = [
      ...(hasPk ? [] : [{ column_name: 'Id', title: 'Id', uidt: 'ID', pk: true, ai: true }]),
      ...tableCols.map(normalizeCol),
      { column_name: 'created_by', title: 'created_by', uidt: 'SingleLineText' },
    ];
    const suffix = `_${Math.random().toString(36).slice(2, 8)}_${Date.now()}`;
    const internalTitle = `t${suffix}`;
    const meta = JSON.stringify({ _displayTitle: tableTitle });
    const ncBody = { table_name: internalTitle, title: internalTitle, columns: fullColumns, meta };
    const result = await nc('POST', `/api/v1/db/meta/projects/${NC_BASE_ID}/tables`, ncBody);
    if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });

    const tableId = result.data.id;
    // Rename default view to "Grid"
    try {
      const viewsResult = await nc('GET', `/api/v1/db/meta/tables/${tableId}`);
      if (viewsResult.data?.views?.length > 0) {
        await nc('PATCH', `/api/v1/db/meta/views/${viewsResult.data.views[0].id}`, { title: 'Grid' });
      }
    } catch {}

    const nodeId = `table:${tableId}`;
    contentItemsUpsert.run(
      nodeId, tableId, 'table', tableTitle,
      null, parent_id, null,
      agentName, agentName,
      now, now, null, Date.now()
    );
    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
    return res.status(201).json({ item, table_id: tableId, columns: result.data.columns });
  }

  if (type === 'board') {
    const id = crypto.randomUUID();
    const now = Date.now();
    const isoNow = new Date().toISOString();
    const agentName = req.agent?.name || null;
    const defaultData = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'asuite',
      elements: [],
      appState: {},
      files: {},
    });

    db.prepare(`INSERT INTO boards (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

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
    const now = Date.now();
    const isoNow = new Date().toISOString();
    const agentName = req.agent?.name || null;
    const defaultData = JSON.stringify({ slides: [] });

    db.prepare(`INSERT INTO presentations (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

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
    const now = Date.now();
    const isoNow = new Date().toISOString();
    const agentName = req.agent?.name || null;
    const defaultData = JSON.stringify({});

    db.prepare(`INSERT INTO spreadsheets (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

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
    const now = Date.now();
    const isoNow = new Date().toISOString();
    const agentName = req.agent?.name || null;
    const defaultData = JSON.stringify({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

    db.prepare(`INSERT INTO diagrams (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

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

// API: soft-delete content item (move to trash)
app.delete('/api/content-items/:id', authenticateAgent, async (req, res) => {
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND' });

  const mode = req.query.mode || 'only'; // 'only' or 'all'
  const now = new Date().toISOString();

  if (item.type === 'doc') {
    const agentOlToken = req.agent?.ol_token || OL_TOKEN;

    if (mode === 'all') {
      // Collect all descendants recursively
      const collectDescendants = (parentId) => {
        const children = db.prepare('SELECT * FROM content_items WHERE parent_id = ? AND deleted_at IS NULL').all(parentId);
        let all = [...children];
        for (const child of children) {
          all = all.concat(collectDescendants(child.id));
        }
        return all;
      };
      const descendants = collectDescendants(req.params.id);

      // Soft-delete this item
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
      // Delete from Outline
      await upstream(OL_URL, 'POST', '/api/documents.delete', { id: item.raw_id }, agentOlToken).catch(() => {});

      // Soft-delete descendants
      for (const desc of descendants) {
        db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, desc.id);
        if (desc.type === 'doc') {
          await upstream(OL_URL, 'POST', '/api/documents.delete', { id: desc.raw_id }, agentOlToken).catch(() => {});
        }
        // Tables: just soft-delete in content_items, don't delete from NocoDB yet
      }
    } else {
      // mode === 'only': reparent children, then delete this node
      const children = db.prepare('SELECT * FROM content_items WHERE parent_id = ? AND deleted_at IS NULL').all(req.params.id);
      for (const child of children) {
        db.prepare('UPDATE content_items SET parent_id = ? WHERE id = ?').run(item.parent_id, child.id);
        // If child is a doc, also move in Outline
        if (child.type === 'doc') {
          const newOlParent = item.parent_id?.startsWith('doc:') ? item.parent_id.slice(4) : null;
          await upstream(OL_URL, 'POST', '/api/documents.move', {
            id: child.raw_id,
            parentDocumentId: newOlParent,
          }, agentOlToken).catch(() => {});
        }
      }
      // Soft-delete this item
      db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
      // Delete from Outline
      await upstream(OL_URL, 'POST', '/api/documents.delete', { id: item.raw_id }, agentOlToken).catch(() => {});
    }
  } else if (item.type === 'table') {
    // Soft-delete only — NocoDB table data preserved until permanent delete
    db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
  } else if (item.type === 'board') {
    // Soft-delete only — board data preserved until permanent delete
    db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
  } else if (item.type === 'presentation') {
    // Soft-delete only — presentation data preserved until permanent delete
    db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
  } else if (item.type === 'spreadsheet') {
    // Soft-delete only — spreadsheet data preserved until permanent delete
    db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
  } else if (item.type === 'diagram') {
    // Soft-delete only — diagram data preserved until permanent delete
    db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
  }

  res.json({ deleted: true });
});

// API: restore content item from trash
app.post('/api/content-items/:id/restore', authenticateAgent, async (req, res) => {
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!item.deleted_at) return res.status(400).json({ error: 'NOT_DELETED' });

  // Clear deleted_at
  db.prepare('UPDATE content_items SET deleted_at = NULL WHERE id = ?').run(req.params.id);

  // Restore in upstream if doc
  if (item.type === 'doc') {
    const agentOlToken = req.agent?.ol_token || OL_TOKEN;
    // Outline's unarchive restores from trash
    await upstream(OL_URL, 'POST', '/api/documents.restore', { id: item.raw_id }, agentOlToken).catch(() => {});
  }
  // Tables: nothing to do in NocoDB (data was never deleted)

  const restored = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
  res.json({ item: restored });
});

// API: permanently delete content item
app.delete('/api/content-items/:id/permanent', authenticateAgent, async (req, res) => {
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND' });

  if (item.type === 'doc') {
    const agentOlToken = req.agent?.ol_token || OL_TOKEN;
    await upstream(OL_URL, 'POST', '/api/documents.delete', { id: item.raw_id, permanent: true }, agentOlToken).catch(() => {});
  } else if (item.type === 'table') {
    if (NC_EMAIL && NC_PASSWORD) {
      await nc('DELETE', `/api/v1/db/meta/tables/${item.raw_id}`).catch(() => {});
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

  // Remove from content_items
  db.prepare('DELETE FROM content_items WHERE id = ?').run(req.params.id);
  // Clean up related data
  db.prepare('DELETE FROM doc_icons WHERE doc_id = ?').run(item.raw_id);

  res.json({ deleted: true });
});

// API: force sync content items (manual/repair tool only — not used in normal operation)
app.post('/api/content-items/sync', authenticateAgent, async (req, res) => {
  await syncContentItems();
  const rows = db.prepare('SELECT * FROM content_items WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC').all();
  res.json({ items: rows, synced_at: Date.now() });
});

// API: update content item metadata (icon, parent, sort_order) — local-only changes
app.patch('/api/content-items/:id', authenticateAgent, (req, res) => {
  const { icon, parent_id, sort_order, title } = req.body;
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND' });

  const updates = [];
  const params = [];
  if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
  if (parent_id !== undefined) { updates.push('parent_id = ?'); params.push(parent_id); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (updates.length === 0) return res.json(item);

  params.push(req.params.id);
  db.prepare(`UPDATE content_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  // Also sync icon to doc_icons for backward compat
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

// API: batch update sort/parent for drag-and-drop reordering
app.put('/api/content-items/tree', authenticateAgent, (req, res) => {
  const { items } = req.body; // [{ id, parent_id, sort_order }]
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

// ─── Preferences (key-value store) ────────────────
const PREFS_DIR = path.join(__dirname, 'data', 'preferences');
fs.mkdirSync(PREFS_DIR, { recursive: true });

function prefsPath(key) {
  // Sanitize key to prevent path traversal
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

// ─── Health Check ─────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── File upload proxy (for NocoDB attachments) ──────────────
const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

app.post('/api/data/upload', authenticateAgent, fileUpload.array('files', 10), async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'NO_FILES' });

  try {
    const form = new FormData();
    for (const file of req.files) {
      const blob = new Blob([file.buffer], { type: file.mimetype });
      form.append('files', blob, file.originalname);
    }

    const ncToken = await getNcJwt();
    const uploadRes = await fetch(`${NC_URL}/api/v1/db/storage/upload`, {
      method: 'POST',
      headers: { 'xc-auth': ncToken },
      body: form,
    });
    if (!uploadRes.ok) {
      const detail = await uploadRes.text();
      return res.status(uploadRes.status).json({ error: 'UPLOAD_FAILED', detail });
    }
    const data = await uploadRes.json();
    res.json(data); // Returns array of { path, title, mimetype, size, ... }
  } catch (e) {
    console.error('[gateway] File upload error:', e);
    res.status(500).json({ error: 'UPLOAD_ERROR', detail: e.message });
  }
});

// ─── File download proxy (for NocoDB attachment URLs) ──────────────
// Query-parameter based route (preferred — avoids Next.js file-extension routing issues)
app.get('/api/data/dl', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const ncPath = req.query.path;
  if (!ncPath) return res.status(400).json({ error: 'MISSING_PATH' });
  try {
    const ncToken = await getNcJwt();
    const fullPath = ncPath.startsWith('/') ? ncPath : '/' + ncPath;
    const ncRes = await fetch(`${NC_URL}${fullPath}`, {
      headers: { 'xc-auth': ncToken },
    });
    if (!ncRes.ok) return res.status(ncRes.status).send('Not found');
    res.set('Content-Type', ncRes.headers.get('content-type') || 'application/octet-stream');
    const cacheControl = ncRes.headers.get('cache-control');
    if (cacheControl) res.set('Cache-Control', cacheControl);
    const buffer = Buffer.from(await ncRes.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    console.error('[gateway] File download proxy error:', e);
    res.status(500).json({ error: 'DOWNLOAD_ERROR' });
  }
});
// Legacy path-based route (kept for backward compat)
app.get('/api/data/download/*', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  try {
    const ncToken = await getNcJwt();
    // The path after /api/data/download/ is the NocoDB path (e.g., /dltemp/...)
    const ncPath = '/' + req.params[0];
    const ncRes = await fetch(`${NC_URL}${ncPath}`, {
      headers: { 'xc-auth': ncToken },
    });
    if (!ncRes.ok) return res.status(ncRes.status).send('Not found');
    res.set('Content-Type', ncRes.headers.get('content-type') || 'application/octet-stream');
    const cacheControl = ncRes.headers.get('cache-control');
    if (cacheControl) res.set('Cache-Control', cacheControl);
    const buffer = Buffer.from(await ncRes.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    console.error('[gateway] File download proxy error:', e);
    res.status(500).json({ error: 'DOWNLOAD_ERROR' });
  }
});

// ─── Table Comments (SQLite-backed) ──────────────

// List row IDs that have comments for a table
app.get('/api/data/tables/:table_id/commented-rows', authenticateAgent, (req, res) => {
  const { table_id } = req.params;
  const rows = db.prepare('SELECT DISTINCT row_id, COUNT(*) as count FROM table_comments WHERE table_id = ? AND row_id IS NOT NULL GROUP BY row_id').all(table_id);
  res.json({ rows: rows.map(r => ({ row_id: r.row_id, count: r.count })) });
});

// List comments for a table (optionally filtered by row_id)
app.get('/api/data/tables/:table_id/comments', authenticateAgent, (req, res) => {
  const { table_id } = req.params;
  const { row_id, include_all } = req.query; // row_id: filter by row; include_all: return all comments
  let rows;
  if (row_id) {
    rows = db.prepare('SELECT * FROM table_comments WHERE table_id = ? AND row_id = ? ORDER BY created_at ASC').all(table_id, row_id);
  } else if (include_all === '1' || include_all === 'true') {
    // All comments (table-level + all row-level)
    rows = db.prepare('SELECT * FROM table_comments WHERE table_id = ? ORDER BY created_at ASC').all(table_id);
  } else {
    // Table-level comments only (row_id IS NULL)
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

// Create a table comment (table-level or row-level)
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
      // Skip if the comment author is this agent
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

// Update a table comment (edit text)
app.patch('/api/data/table-comments/:comment_id', authenticateAgent, (req, res) => {
  const { comment_id } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'text required' });

  const now = Date.now();
  const result = db.prepare('UPDATE table_comments SET text = ?, updated_at = ? WHERE id = ?').run(text, now, comment_id);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ updated: true });
});

// Delete a table comment
app.delete('/api/data/table-comments/:comment_id', authenticateAgent, (req, res) => {
  const { comment_id } = req.params;
  const result = db.prepare('DELETE FROM table_comments WHERE id = ?').run(comment_id);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ deleted: true });
});

// Resolve a table comment
app.post('/api/data/table-comments/:comment_id/resolve', authenticateAgent, (req, res) => {
  const agent = req.agent;
  const now = Date.now();
  const result = db.prepare('UPDATE table_comments SET resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
    .run(agent.display_name || agent.name, now, now, req.params.comment_id);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ resolved: true });
});

// Unresolve a table comment
app.post('/api/data/table-comments/:comment_id/unresolve', authenticateAgent, (req, res) => {
  const now = Date.now();
  const result = db.prepare('UPDATE table_comments SET resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?')
    .run(now, req.params.comment_id);
  if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ unresolved: true });
});

// ─── Table Snapshots (History Versioning) ─────────

// Create a snapshot of a table's current state
async function createTableSnapshot(tableId, triggerType, agent) {
  // 1. Fetch table schema from NocoDB
  const metaResult = await nc('GET', `/api/v1/db/meta/tables/${tableId}`);
  if (metaResult.status >= 400) throw new Error(`Failed to fetch table meta: ${metaResult.status}`);
  const columns = (metaResult.data.columns || []).map(c => {
    const col = { id: c.id, title: c.title, uidt: c.uidt, pk: !!c.pk, rqd: !!c.rqd };
    if (c.colOptions) col.colOptions = c.colOptions;
    if (c.meta) col.meta = c.meta;
    if (c.formula_raw) col.formula_raw = c.formula_raw;
    return col;
  });
  const schemaJson = JSON.stringify(columns);

  // 2. Fetch ALL rows (paginate at 1000 per page)
  const allRows = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const rowResult = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${tableId}?limit=${pageSize}&offset=${offset}`);
    if (rowResult.status >= 400) throw new Error(`Failed to fetch rows: ${rowResult.status}`);
    const list = rowResult.data?.list || [];
    allRows.push(...list);
    if (list.length < pageSize) break;
    offset += pageSize;
  }
  const dataJson = JSON.stringify(allRows);

  // 3. Get next version number
  const lastVersion = db.prepare('SELECT MAX(version) as maxV FROM table_snapshots WHERE table_id = ?').get(tableId);
  const version = (lastVersion?.maxV || 0) + 1;

  // 4. Insert snapshot
  const result = db.prepare(
    'INSERT INTO table_snapshots (table_id, version, schema_json, data_json, trigger_type, agent, row_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(tableId, version, schemaJson, dataJson, triggerType, agent || null, allRows.length);

  // 5. Retention cleanup: keep last 20 or last 30 days, whichever keeps more
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const countAll = db.prepare('SELECT COUNT(*) as cnt FROM table_snapshots WHERE table_id = ?').get(tableId);
  if (countAll.cnt > 20) {
    // Find the 20th newest snapshot's id
    const fiftieth = db.prepare('SELECT id FROM table_snapshots WHERE table_id = ? ORDER BY version DESC LIMIT 1 OFFSET 19').get(tableId);
    if (fiftieth) {
      // Delete snapshots older than both the 50th and 30 days
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

// Check if auto-snapshot is needed (last snapshot older than 5 minutes)
async function maybeAutoSnapshot(tableId, agent) {
  try {
    const last = db.prepare('SELECT created_at FROM table_snapshots WHERE table_id = ? ORDER BY version DESC LIMIT 1').get(tableId);
    if (last) {
      const lastTime = new Date(last.created_at).getTime();
      if (Date.now() - lastTime < 30 * 60 * 1000) return; // less than 30 minutes ago
    }
    await createTableSnapshot(tableId, 'auto', agent);
  } catch (e) {
    console.error(`[gateway] Auto-snapshot failed for ${tableId}: ${e.message}`);
  }
}

// List snapshots (without large data fields)
app.get('/api/data/:table_id/snapshots', authenticateAgent, (req, res) => {
  const snapshots = db.prepare(
    'SELECT id, version, trigger_type, agent, row_count, created_at FROM table_snapshots WHERE table_id = ? ORDER BY version DESC'
  ).all(req.params.table_id);
  res.json({ snapshots });
});

// Get a single snapshot (full data)
app.get('/api/data/:table_id/snapshots/:snapshot_id', authenticateAgent, (req, res) => {
  const snap = db.prepare(
    'SELECT * FROM table_snapshots WHERE id = ? AND table_id = ?'
  ).get(req.params.snapshot_id, req.params.table_id);
  if (!snap) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(snap);
});

// Manually create a snapshot
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

// Restore a snapshot
app.post('/api/data/:table_id/snapshots/:snapshot_id/restore', authenticateAgent, async (req, res) => {
  const snap = db.prepare('SELECT * FROM table_snapshots WHERE id = ? AND table_id = ?')
    .get(req.params.snapshot_id, req.params.table_id);
  if (!snap) return res.status(404).json({ error: 'NOT_FOUND' });

  try {
    // 1. Create pre-restore snapshot
    const preRestore = await createTableSnapshot(req.params.table_id, 'pre_restore', req.agent.display_name || req.agent.name);

    // 2. Read snapshot data
    const snapshotRows = JSON.parse(snap.data_json);

    // 3. Delete all current rows
    let offset = 0;
    while (true) {
      const currentRows = await nc('GET', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}?limit=1000&offset=${offset}`);
      if (currentRows.status >= 400) break;
      const list = currentRows.data?.list || [];
      if (list.length === 0) break;
      for (const row of list) {
        const rowId = row.Id || row.id || row.nc_id;
        if (rowId) {
          await nc('DELETE', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${rowId}`);
        }
      }
      // If we deleted all from this page, check for more (don't increment offset since rows shifted)
      if (list.length < 1000) break;
    }

    // 4. Get current schema and recreate missing columns from snapshot
    const metaResult = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
    const currentCols = new Set((metaResult.data?.columns || []).map(c => c.title));

    // 4b. Recreate columns from snapshot that are missing in current table
    const snapshotSchema = JSON.parse(snap.schema_json || '[]');
    const SYSTEM_UIDTS = new Set(['ID', 'CreateTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'AutoNumber']);
    for (const col of snapshotSchema) {
      if (currentCols.has(col.title)) continue;
      if (col.pk) continue; // Skip primary key columns
      if (SYSTEM_UIDTS.has(col.uidt)) continue; // Skip system-generated column types
      try {
        const body = { column_name: col.title, title: col.title, uidt: col.uidt };
        if ((col.uidt === 'SingleSelect' || col.uidt === 'MultiSelect') && col.colOptions?.options) {
          body.colOptions = { options: col.colOptions.options.map((o, i) => ({ title: o.title, color: o.color, order: i + 1 })) };
        }
        if (col.meta) body.meta = col.meta;
        if (col.formula_raw) body.formula_raw = col.formula_raw;
        const createResult = await nc('POST', `/api/v1/db/meta/tables/${req.params.table_id}/columns`, body);
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

    // 5. Insert rows from snapshot
    let restored = 0;
    for (const row of snapshotRows) {
      const cleanRow = {};
      for (const [key, val] of Object.entries(row)) {
        // Skip system fields
        if (['Id', 'id', 'nc_id', 'CreatedAt', 'UpdatedAt', 'created_at', 'updated_at', 'ncRecordId', 'ncRecordHash'].includes(key)) continue;
        if (currentCols.has(key)) {
          cleanRow[key] = val;
        }
      }
      if (Object.keys(cleanRow).length > 0) {
        await nc('POST', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}`, cleanRow);
        restored++;
      }
    }

    res.json({ success: true, restored_rows: restored, pre_restore_snapshot_id: preRestore.id });
  } catch (e) {
    console.error(`[gateway] Restore failed: ${e.message}`);
    res.status(500).json({ error: 'RESTORE_FAILED', message: e.message });
  }
});

// ─── Start ───────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[gateway] ASuite API Gateway listening on :${PORT}`);
  console.log(`[gateway] Admin token: ${ADMIN_TOKEN}`);
  await loadExistingBots();
  startMMListener();
  // Start Plane polling every 15s
  setInterval(pollPlane, 15000);
  console.log('[gateway] Plane polling started (15s interval)');
  // Start NocoDB comment polling every 15s
  setInterval(pollNcComments, 15000);
  console.log('[gateway] NocoDB comment polling started (15s interval)');
  // Content items: no periodic sync — Gateway is source of truth.
  // Use POST /api/content-items/sync manually if needed for repair/migration.
  console.log('[gateway] Content items managed by Gateway (no periodic sync)');
});
