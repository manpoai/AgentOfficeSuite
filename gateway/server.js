#!/usr/bin/env node
/**
 * ASuite API Gateway
 * Implements Agent接入协议v1: registration, docs, data, events
 * Routes operations to Baserow, with local SQLite for docs
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

import {
  BR_URL, BR_EMAIL, BR_PASSWORD, BR_DATABASE_ID, BR_TOKEN,
  getBrJwt, br,
  UIDT_TO_BR, BR_TO_UIDT,
  parseNcWhere, NC_OP_TO_BR, buildBaserowFilterParams, buildBaserowOrderBy,
  BR_VIEW_TYPE_MAP, BR_VIEW_TYPE_NUM,
  getTableFields, invalidateFieldCache, getFieldMap,
  normalizeRowForGateway, normalizeRowForBaserow,
  buildFieldCreateBody,
} from './baserow.js';

import authRoutes from './routes/auth.js';
import docsRoutes from './routes/docs.js';
import dataRoutes from './routes/data.js';
import contentRoutes from './routes/content.js';
import eventsRoutes from './routes/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.GATEWAY_PORT || 4000;

// Upstream service URLs and tokens (Baserow, NC_ prefix kept for migration compat)
const NC_URL = process.env.NOCODB_URL || 'http://localhost:8080';
const NC_EMAIL = process.env.BASEROW_EMAIL || process.env.NOCODB_EMAIL;
const NC_PASSWORD = process.env.BASEROW_PASSWORD || process.env.NOCODB_PASSWORD;
const NC_BASE_ID = process.env.BASEROW_DATABASE_ID || process.env.NOCODB_BASE_ID || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ─── Database ────────────────────────────────────
const DB_PATH = process.env.GATEWAY_DB_PATH || path.join(__dirname, 'gateway.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
const schema = fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf8');
db.exec(schema);

// Migrate: add index on agent_accounts.token_hash
db.exec('CREATE INDEX IF NOT EXISTS idx_agent_accounts_token ON agent_accounts(token_hash)');

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

// Migrate: create documents table
try {
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
} catch { /* already exists */ }

// Migrate: create document_revisions table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS document_revisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_revisions_doc ON document_revisions(document_id)`);
} catch { /* already exists */ }

// Migrate: create document_comments table
try {
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
} catch { /* already exists */ }

// Migrate: FTS5 virtual table and sync triggers for documents
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  id UNINDEXED, title, text, content='documents', content_rowid='rowid'
)`);
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

// ─── Migrate: actors table (unified human + agent identity) ─────
try {
  const agents = db.prepare('SELECT * FROM agent_accounts').all();
  const insert = db.prepare(`INSERT OR IGNORE INTO actors (id, type, username, display_name, avatar_url, token_hash, capabilities, webhook_url, webhook_secret, online, last_seen_at, created_at, updated_at) VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let migrated = 0;
  for (const a of agents) {
    const result = insert.run(a.id, a.name, a.display_name, a.avatar_url || null, a.token_hash, a.capabilities || null, a.webhook_url || null, a.webhook_secret || null, a.online || 0, a.last_seen_at || null, a.created_at, a.updated_at);
    if (result.changes > 0) migrated++;
  }
  if (migrated > 0) console.log(`[gateway] Migrated ${migrated} agents to actors table`);
} catch (e) { /* actors table not yet created or already migrated */ }

// Migrate: create notifications table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    target_actor_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_actor_id, read, created_at DESC)');
} catch { /* already exists */ }

// Migrate: add pinned column to content_items
try {
  db.exec('ALTER TABLE content_items ADD COLUMN pinned INTEGER DEFAULT 0');
  console.log('[gateway] DB migrated: added pinned column to content_items');
} catch { /* already exists */ }

// Migrate: create content_comments table (generic comments for presentations, diagrams, etc.)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS content_comments (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL,
    text TEXT NOT NULL,
    author TEXT,
    actor_id TEXT,
    parent_comment_id TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_content_comments_content ON content_comments(content_id)');
} catch { /* already exists */ }

// Migrate: create content_revisions table (generic revisions for presentations, diagrams, etc.)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS content_revisions (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_content_revisions_content ON content_revisions(content_id, created_at DESC)');
} catch { /* already exists */ }

// ─── Helpers ─────────────────────────────────────
function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const result = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(result, 'hex'));
}

// Create default admin user if none exists
{
  const adminExists = db.prepare("SELECT id FROM actors WHERE type = 'human' AND role = 'admin'").get();
  if (!adminExists) {
    const adminId = genId('act');
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin';
    db.prepare(`INSERT INTO actors (id, type, username, display_name, password_hash, role, created_at, updated_at) VALUES (?, 'human', 'admin', 'Administrator', ?, 'admin', ?, ?)`)
      .run(adminId, hashPassword(defaultPassword), Date.now(), Date.now());
    console.log(`[gateway] Created default admin user (username: admin, password: ***)`);
  }
}

// Baserow doesn't need per-agent users — all operations go through the admin JWT
async function createNcUser(agentName, displayName) {
  console.log(`[gateway] Agent ${agentName} registered (Baserow mode — no per-agent DB user needed)`);
  return null;
}

// ─── Auth middleware ─────────────────────────────
function authenticateAny(req, res, next) {
  const auth = req.headers.authorization;
  const queryToken = req.query.token;
  let token;
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7);
  } else if (queryToken) {
    token = queryToken;
  } else {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing authorization' });
  }

  // Try JWT first (human auth)
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const actor = db.prepare('SELECT * FROM actors WHERE id = ?').get(decoded.actor_id);
    if (actor) {
      req.actor = { id: actor.id, type: actor.type, username: actor.username, display_name: actor.display_name, role: actor.role, avatar_url: actor.avatar_url };
      // Backward compat: set req.agent for existing code that uses req.agent
      req.agent = { id: actor.id, name: actor.username, display_name: actor.display_name, capabilities: actor.capabilities };
      return next();
    }
  } catch (e) { /* not a JWT, try agent token */ }

  // Try agent token hash (actors table)
  const hash = hashToken(token);
  const agent = db.prepare('SELECT * FROM actors WHERE token_hash = ?').get(hash);
  if (agent) {
    db.prepare('UPDATE actors SET last_seen_at = ?, online = 1 WHERE id = ?').run(Date.now(), agent.id);
    req.actor = { id: agent.id, type: 'agent', username: agent.username, display_name: agent.display_name, role: 'agent', avatar_url: agent.avatar_url };
    req.agent = { id: agent.id, name: agent.username, display_name: agent.display_name, capabilities: agent.capabilities };
    return next();
  }

  // Fallback: try legacy agent_accounts table
  const legacyAgent = db.prepare('SELECT * FROM agent_accounts WHERE token_hash = ?').get(hash);
  if (legacyAgent) {
    db.prepare('UPDATE agent_accounts SET last_seen_at = ?, online = 1 WHERE id = ?').run(Date.now(), legacyAgent.id);
    req.actor = { id: legacyAgent.id, type: 'agent', username: legacyAgent.name, display_name: legacyAgent.display_name, role: 'agent', avatar_url: legacyAgent.avatar_url };
    req.agent = legacyAgent;
    return next();
  }

  return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token' });
}

// Keep backward-compat alias
const authenticateAgent = authenticateAny;

function authenticateAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin token' });
  }
  const token = auth.slice(7);

  // Accept ADMIN_TOKEN
  if (token === ADMIN_TOKEN) return next();

  // Accept human JWT with admin role
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const actor = db.prepare("SELECT * FROM actors WHERE id = ? AND type = 'human' AND role = 'admin'").get(decoded.actor_id);
    if (actor) {
      req.actor = { id: actor.id, type: actor.type, username: actor.username, display_name: actor.display_name, role: actor.role };
      req.agent = { id: actor.id, name: actor.username, display_name: actor.display_name };
      return next();
    }
  } catch (e) { /* not a valid JWT */ }

  return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin token' });
}

// ─── SSE infrastructure ─────────────────────────
const sseClients = new Map(); // agent_id → Set<res>

function pushEvent(agentId, event) {
  const clients = sseClients.get(agentId);
  if (clients) {
    for (const res of clients) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }
}

function isAllowedWebhookUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    // Block private/internal IPs and non-HTTP(S) schemes
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    // Block localhost and common private ranges
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return false;
    if (host === '0.0.0.0' || host.startsWith('10.') || host.startsWith('192.168.')) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host.endsWith('.internal') || host.endsWith('.local')) return false;
    // Block metadata endpoints (cloud provider SSRF)
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;
    return true;
  } catch {
    return false;
  }
}

async function deliverWebhook(agent, event) {
  if (!isAllowedWebhookUrl(agent.webhook_url)) {
    console.warn(`[gateway] Blocked webhook delivery to disallowed URL for agent ${agent.username || agent.name}`);
    return;
  }
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

// Comment polling stub (no-op in Baserow mode)
async function pollNcComments() {
  // No-op in Baserow mode — comments are managed via SQLite
}

// ─── Content items upsert statement ─────────────
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
  console.log('[gateway] Syncing content items from local documents + Baserow...');

  // 1. Sync docs from local documents table
  let docCount = 0;
  try {
    const docs = db.prepare('SELECT d.*, di.icon as custom_icon FROM documents d LEFT JOIN doc_icons di ON di.doc_id = d.id').all();
    for (const doc of docs) {
      const nodeId = `doc:${doc.id}`;
      const existing = db.prepare('SELECT parent_id, collection_id FROM content_items WHERE id = ?').get(nodeId);
      const icon = doc.custom_icon || doc.icon || null;
      contentItemsUpsert.run(
        nodeId, doc.id, 'doc', doc.title || '',
        icon, existing?.parent_id || null, existing?.collection_id || null,
        doc.created_by || null, doc.updated_by || null,
        doc.created_at || null, doc.updated_at || null, doc.deleted_at || null,
        now
      );
      docCount++;
    }
  } catch (err) {
    console.error('[gateway] Content sync: documents error:', err.message);
  }

  // 2. Sync tables from Baserow
  let tableCount = 0;
  if (NC_EMAIL && NC_PASSWORD) {
    try {
      const result = await br('GET', `/api/database/tables/database/${NC_BASE_ID}/`);
      if (result.status < 400 && Array.isArray(result.data)) {
        for (const t of result.data) {
          const nodeId = `table:${t.id}`;
          const customIcon = db.prepare('SELECT icon FROM doc_icons WHERE doc_id = ?').get(String(t.id));
          contentItemsUpsert.run(
            nodeId, String(t.id), 'table', t.name || '',
            customIcon?.icon || null, null, null,
            null, null,
            t.created_on || null, null, null,
            now
          );
          tableCount++;
        }
      }
    } catch (err) {
      console.error('[gateway] Content sync: Baserow error:', err.message);
    }
  }

  // 3. Remove stale table items
  db.prepare("DELETE FROM content_items WHERE type = 'table' AND synced_at < ? AND deleted_at IS NULL").run(now);

  console.log(`[gateway] Content sync done: ${docCount} docs, ${tableCount} tables`);
}

// ─── App ─────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '50mb' }));

// ─── Shared dependencies for route modules ──────
const shared = {
  express,
  db,
  JWT_SECRET,
  ADMIN_TOKEN,
  NC_EMAIL,
  NC_PASSWORD,
  NC_BASE_ID,
  authenticateAny,
  authenticateAdmin,
  authenticateAgent,
  genId,
  hashToken,
  hashPassword,
  verifyPassword,
  createNcUser,
  contentItemsUpsert,
  syncContentItems,
  pushEvent,
  deliverWebhook,
  sseClients,
  pollNcComments,
};

// ─── Mount route modules ────────────────────────
authRoutes(app, shared);
docsRoutes(app, shared);
dataRoutes(app, shared);
contentRoutes(app, shared);
eventsRoutes(app, shared);

// ─── Start ───────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[gateway] ASuite API Gateway listening on :${PORT}`);
  console.log(`[gateway] Admin token: ${ADMIN_TOKEN.slice(0, 8)}...`);

  // Start Baserow comment polling every 15s
  setInterval(pollNcComments, 15000);
  console.log('[gateway] Baserow comment polling started (15s interval)');
  // Content items: no periodic sync — Gateway is source of truth.
  // Use POST /api/content-items/sync manually if needed for repair/migration.
  console.log('[gateway] Content items managed by Gateway (no periodic sync)');
});
