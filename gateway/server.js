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

// Migrate: create thread_links table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS thread_links (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, link_type TEXT NOT NULL,
    link_id TEXT NOT NULL, link_title TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_thread_links_thread ON thread_links(thread_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_thread_links_link ON thread_links(link_type, link_id)');
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
app.use(express.json());

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
  res.status(201).json({
    doc_id: result.data.data.id,
    url: `${OL_URL}${result.data.data.url}`,
    created_at: new Date(result.data.data.createdAt).getTime(),
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

// Helper: NocoDB API call
async function nc(method, path, body) {
  const jwt = await getNcJwt();
  if (!jwt) return { status: 503, data: { error: 'NOCODB_NOT_CONFIGURED' } };
  const url = `${NC_URL}${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json', 'xc-auth': jwt } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
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

  // NocoDB 0.202 requires column_name (not title), and pk column uidt must be "ID"
  const hasPk = columns.some(c => c.pk);
  const normalizeCol = c => ({
    column_name: c.column_name || c.title,
    title: c.title || c.column_name,
    uidt: c.uidt,
    ...(c.pk !== undefined ? { pk: c.pk } : {}),
    ...(c.ai !== undefined ? { ai: c.ai } : {}),
    ...(c.required !== undefined ? { rqd: c.required } : {}),
  });
  const fullColumns = [
    ...(hasPk ? [] : [{ column_name: 'Id', title: 'Id', uidt: 'ID', pk: true, ai: true }]),
    ...columns.map(normalizeCol),
    { column_name: 'created_by', title: 'created_by', uidt: 'SingleLineText' },
  ];

  const body = { table_name: title, title, columns: fullColumns };
  const result = await nc('POST', `/api/v1/db/meta/projects/${NC_BASE_ID}/tables`, body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.status(201).json({ table_id: result.data.id, title: result.data.title, columns: result.data.columns });
});

// Describe a table (get column definitions)
app.get('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  const t = result.data;
  const columns = (t.columns || []).map(c => {
    const col = {
      column_id: c.id, title: c.title, type: c.uidt,
      primary_key: !!c.pk, required: !!c.rqd,
    };
    // Pass through select options
    if (c.colOptions?.options) {
      col.options = c.colOptions.options.map(o => ({ title: o.title, color: o.color, order: o.order }));
    }
    // Pass through meta (for currency symbol, decimal places, etc.)
    if (c.meta && typeof c.meta === 'object' && Object.keys(c.meta).length > 0) {
      col.meta = c.meta;
    } else if (c.meta && typeof c.meta === 'string') {
      try { const m = JSON.parse(c.meta); if (Object.keys(m).length > 0) col.meta = m; } catch {}
    }
    return col;
  });
  res.json({ table_id: t.id, title: t.title, columns });
});

// Add a column to a table
// Body: { title: string, uidt: string, options?: [{title, color}] }
app.post('/api/data/tables/:table_id/columns', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { title, uidt = 'SingleLineText', options, meta } = req.body;
  if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });
  const body = { column_name: title, title, uidt };
  if (options && (uidt === 'SingleSelect' || uidt === 'MultiSelect')) {
    body.colOptions = { options: options.map((o, i) => ({ title: o.title || o, color: o.color, order: i + 1 })) };
  }
  if (meta) body.meta = meta;
  const result = await nc('POST', `/api/v1/db/meta/tables/${req.params.table_id}/columns`, body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  const c = result.data;
  res.status(201).json({ column_id: c.id, title: c.title, type: c.uidt });
});

// Update a column (rename or change type)
// Body: { title?: string, uidt?: string }
app.patch('/api/data/tables/:table_id/columns/:column_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const body = {};
  if (req.body.title) { body.title = req.body.title; body.column_name = req.body.title; }
  if (req.body.uidt) body.uidt = req.body.uidt;
  const result = await nc('PATCH', `/api/v1/db/meta/columns/${req.params.column_id}`, body);
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

// Rename a table
app.patch('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'MISSING_TITLE' });
  const result = await nc('PATCH', `/api/v1/db/meta/tables/${req.params.table_id}`, { title, table_name: title });
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json(result.data);
});

// Delete a table
app.delete('/api/data/tables/:table_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('DELETE', `/api/v1/db/meta/tables/${req.params.table_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ deleted: true });
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
  const result = await nc('POST', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}`, req.body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.status(201).json(result.data);
});

// Update row
app.patch('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('PATCH', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${req.params.row_id}`, req.body);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json(result.data);
});

// Delete row
app.delete('/api/data/:table_id/rows/:row_id', authenticateAgent, async (req, res) => {
  if (!NC_EMAIL || !NC_PASSWORD) return res.status(503).json({ error: 'NOCODB_NOT_CONFIGURED' });
  const result = await nc('DELETE', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${req.params.row_id}`);
  if (result.status >= 400) return res.status(result.status).json({ error: 'UPSTREAM_ERROR', detail: result.data });
  res.json({ deleted: true });
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
  const agents = db.prepare('SELECT id, name, display_name, capabilities, online, last_seen_at FROM agent_accounts WHERE pending_approval = 0 OR pending_approval IS NULL').all();
  res.json({
    agents: agents.map(a => ({
      agent_id: a.id, name: a.name, display_name: a.display_name,
      capabilities: JSON.parse(a.capabilities || '[]'),
      online: !!a.online, last_seen_at: a.last_seen_at,
    })),
  });
});

// Agent-facing: get info about a specific agent
app.get('/api/agents/:name', authenticateAgent, (req, res) => {
  const agent = db.prepare('SELECT id, name, display_name, capabilities, online, last_seen_at FROM agent_accounts WHERE name = ? AND (pending_approval = 0 OR pending_approval IS NULL)').get(req.params.name);
  if (!agent) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({
    agent_id: agent.id, name: agent.name, display_name: agent.display_name,
    capabilities: JSON.parse(agent.capabilities || '[]'),
    online: !!agent.online, last_seen_at: agent.last_seen_at,
  });
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

// ─── Health Check ─────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
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
});
