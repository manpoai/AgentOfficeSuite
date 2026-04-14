/**
 * Database initialization and migrations
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { runTableEngineMigrations } from './table-engine/migrations.js';

export function initDatabase(gatewayDir) {
  const DB_PATH = process.env.GATEWAY_DB_PATH || path.join(gatewayDir, 'gateway.db');
  let db = openDatabase(DB_PATH);
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`integrity_check failed: ${integrity}`);
    }
  } catch (err) {
    console.warn(`[gateway] Corrupted SQLite database detected at ${DB_PATH}: ${err.message}`);
    try { db.close(); } catch {}
    const backupPath = `${DB_PATH}.corrupt-${Date.now()}`;
    try {
      if (fs.existsSync(DB_PATH)) fs.renameSync(DB_PATH, backupPath);
      if (fs.existsSync(`${DB_PATH}-wal`)) fs.renameSync(`${DB_PATH}-wal`, `${backupPath}-wal`);
      if (fs.existsSync(`${DB_PATH}-shm`)) fs.renameSync(`${DB_PATH}-shm`, `${backupPath}-shm`);
      console.warn(`[gateway] Moved corrupt database to ${backupPath}`);
    } catch (moveErr) {
      console.warn(`[gateway] Failed to move corrupt database aside: ${moveErr.message}`);
      try { fs.rmSync(DB_PATH, { force: true }); } catch {}
      try { fs.rmSync(`${DB_PATH}-wal`, { force: true }); } catch {}
      try { fs.rmSync(`${DB_PATH}-shm`, { force: true }); } catch {}
    }
    db = openDatabase(DB_PATH);
  }
  const schema = fs.readFileSync(path.join(gatewayDir, 'init-db.sql'), 'utf8');
  db.exec(schema);

  runMigrations(db);
  runWriteSmokeTest(db);
  seedExampleContent(db, gatewayDir);

  return db;
}

function runWriteSmokeTest(db) {
  try {
    const id = `smoke_${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO documents (id, title, text, data_json, icon, full_width, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, 'smoke', '', null, null, 0, 'system', 'system', now, now);
    db.prepare('UPDATE documents SET text = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run('ok', now, 'system', id);
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  } catch (err) {
    throw new Error(`database write smoke test failed: ${err.message}`);
  }
}

function openDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  return db;
}

function runMigrations(db) {
  // Migrate: add pending_approval column to actors
  try { db.exec('ALTER TABLE actors ADD COLUMN pending_approval INTEGER DEFAULT 0'); } catch { /* already exists */ }

  // Migrate: add platform column to actors (separate try/catch so UPDATE always runs)
  try { db.exec('ALTER TABLE actors ADD COLUMN platform TEXT'); } catch { /* already exists */ }
  try {
    db.exec("UPDATE actors SET platform = 'zylos' WHERE username IN ('zylos', 'zylos-thinker', 'zylos-digger') AND platform IS NULL");
  } catch (e) { console.warn('[gateway] platform seed error:', e.message); }

  // Migrate: add deleted_at column to actors
  try { db.exec('ALTER TABLE actors ADD COLUMN deleted_at INTEGER'); } catch { /* already exists */ }

  // Migrate: create content_snapshots table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS content_snapshots (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      content_id TEXT NOT NULL,
      version INTEGER,
      title TEXT,
      data_json TEXT NOT NULL,
      schema_json TEXT,
      trigger_type TEXT,
      row_count INTEGER,
      actor_id TEXT,
      created_at TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_content_snapshots_content ON content_snapshots(content_type, content_id, created_at DESC)');
  } catch { /* already exists */ }

  // Migrate: add description column to content_snapshots
  try { db.exec('ALTER TABLE content_snapshots ADD COLUMN description TEXT'); } catch { /* already exists */ }

  // Migrate data from old table_snapshots to content_snapshots
  try {
    const hasOldTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='table_snapshots'").get();
    if (hasOldTable) {
      db.exec(`INSERT OR IGNORE INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, row_count, actor_id, created_at)
        SELECT 'snap_' || hex(randomblob(8)), 'table', table_id, version, NULL, data_json, schema_json, trigger_type, row_count, agent, COALESCE(created_at, datetime('now'))
        FROM table_snapshots`);
      console.log('[gateway] Migrated table_snapshots -> content_snapshots');
    }
  } catch (e) { console.warn('[gateway] table_snapshots migration skipped:', e.message); }

  // Migrate: create thread_links table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS thread_links (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, link_type TEXT NOT NULL,
      link_id TEXT NOT NULL, link_title TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_thread_links_thread ON thread_links(thread_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_thread_links_link ON thread_links(link_type, link_id)');
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

  // Migrate: create document_revisions table (legacy, kept for migration)
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

  // Migrate data from old document_revisions to content_snapshots
  try {
    const hasDocRevisions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_revisions'").get();
    if (hasDocRevisions) {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM document_revisions').get();
      if (count.cnt > 0) {
        db.exec(`INSERT OR IGNORE INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, row_count, actor_id, created_at)
          SELECT id, 'doc', document_id, NULL, title, data_json, NULL, NULL, NULL, created_by, created_at
          FROM document_revisions`);
        console.log(`[gateway] Migrated ${count.cnt} document_revisions -> content_snapshots`);
      }
    }
  } catch (e) { console.warn('[gateway] document_revisions migration skipped:', e.message); }

  // Migrate: create unified comments table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      row_id TEXT,
      text TEXT,
      html TEXT,
      data_json TEXT,
      actor TEXT,
      actor_id TEXT,
      parent_id TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)');
  } catch { /* already exists */ }

  // Migrate data from old comment tables to unified comments table
  migrateTableComments(db);
  migrateDocComments(db);
  migrateContentComments(db);

  // Legacy: keep document_comments migration for backward compat
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
  db.exec('DROP TRIGGER IF EXISTS documents_ai');
  db.exec('DROP TRIGGER IF EXISTS documents_au');
  db.exec('DROP TRIGGER IF EXISTS documents_ad');
  db.exec('DROP TABLE IF EXISTS documents_fts');
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    id UNINDEXED, title, text, content='documents', content_rowid='rowid'
  )`);
  db.exec(`INSERT INTO documents_fts(rowid, id, title, text)
    SELECT rowid, id, title, text FROM documents WHERE deleted_at IS NULL`);
  db.exec(`CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, id, title, text) VALUES (new.rowid, new.id, new.title, new.text);
  END`);
  db.exec(`CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, id, title, text) VALUES ('delete', old.rowid, old.id, old.title, old.text);
    INSERT INTO documents_fts(rowid, id, title, text) VALUES (new.rowid, new.id, new.title, new.text);
  END`);
  db.exec(`CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, id, title, text) VALUES ('delete', old.rowid, old.id, old.title, old.text);
  END`);

  // Migrate: agent_accounts -> actors (final migration, then drop)
  migrateAgentAccounts(db);

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

  // Migrate: add owner_actor_id to content_items (Phase 2)
  try {
    db.exec('ALTER TABLE content_items ADD COLUMN owner_actor_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_content_items_owner ON content_items(owner_actor_id)');
    console.log('[gateway] DB migrated: added owner_actor_id to content_items');
  } catch { /* already exists */ }

  // Backfill owner_actor_id from created_by display name
  try {
    db.exec(`UPDATE content_items SET owner_actor_id = (
      SELECT id FROM actors WHERE display_name = content_items.created_by OR username = content_items.created_by
      LIMIT 1
    ) WHERE owner_actor_id IS NULL AND created_by IS NOT NULL`);
  } catch (e) { console.warn('[gateway] owner_actor_id backfill:', e.message); }

  // Migrate: create content_pins table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS content_pins (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      content_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(actor_id, content_id)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_content_pins_actor ON content_pins(actor_id)');
    console.log('[gateway] DB migrated: created content_pins table');
  } catch { /* already exists */ }

  // Migrate: old content_items.pinned=1 rows to content_pins
  try {
    const alreadyMigrated = db.prepare('SELECT COUNT(*) as n FROM content_pins').get();
    if (alreadyMigrated.n === 0) {
      const pinnedItems = db.prepare('SELECT id FROM content_items WHERE pinned = 1 AND deleted_at IS NULL').all();
      for (const item of pinnedItems) {
        const owner = db.prepare('SELECT owner_actor_id FROM content_items WHERE id = ?').get(item.id);
        if (owner?.owner_actor_id) {
          try {
            db.prepare('INSERT OR IGNORE INTO content_pins (id, actor_id, content_id, created_at) VALUES (?, ?, ?, ?)')
              .run(`pin_migrated_${item.id.replace(/:/g, '_')}`, owner.owner_actor_id, item.id, Date.now());
          } catch { /* ignore */ }
        }
      }
      if (pinnedItems.length > 0) {
        console.log(`[gateway] DB migrated: migrated ${pinnedItems.length} pinned items to content_pins table`);
      }
    }
  } catch (e) { console.warn('[gateway] content_pins migration:', e.message); }

  // Migrate: add meta column to notifications table
  try {
    db.exec('ALTER TABLE notifications ADD COLUMN meta TEXT');
    console.log('[gateway] DB migrated: added meta column to notifications');
  } catch { /* already exists */ }

  // Migrate: add anchor columns to comments (Phase 0)
  try { db.exec('ALTER TABLE comments ADD COLUMN anchor_type TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE comments ADD COLUMN anchor_id TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE comments ADD COLUMN anchor_meta TEXT'); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_comments_anchor ON comments(target_type, target_id, anchor_type, anchor_id)'); } catch { /* already exists */ }

  // Migrate: unify target_id format to 'type:raw_id' for all comments (Phase 0)
  try {
    // doc comments: raw UUID (no prefix, no 'doc' start) → 'doc:uuid'
    db.exec(`UPDATE comments SET target_id = 'doc:' || target_id
      WHERE target_type = 'doc' AND target_id NOT LIKE 'doc:%' AND target_id NOT LIKE 'doc_%'`);
    // doc comments: 'doc_xxx' raw new-format ID (no 'doc:' prefix) → 'doc:doc_xxx'
    db.exec(`UPDATE comments SET target_id = 'doc:' || target_id
      WHERE target_type = 'doc' AND target_id LIKE 'doc_%' AND target_id NOT LIKE 'doc:%'`);
    // table comments: raw table ID (no prefix) → 'table:id'
    db.exec(`UPDATE comments SET target_id = 'table:' || target_id
      WHERE target_type = 'table' AND target_id NOT LIKE 'table:%'`);
    // presentation comments: already 'presentation:xxx', no change needed
    // diagram comments: if any without prefix
    db.exec(`UPDATE comments SET target_id = 'diagram:' || target_id
      WHERE target_type = 'diagram' AND target_id NOT LIKE 'diagram:%'`);
    // Migrate row_id → anchor_id (table row comments)
    db.exec(`UPDATE comments SET anchor_type = 'row', anchor_id = row_id
      WHERE row_id IS NOT NULL AND row_id != '' AND anchor_type IS NULL`);
    console.log('[gateway] DB migrated: unified comments target_id format and anchor columns (Phase 0)');
  } catch (e) { console.warn('[gateway] Phase 0 comment migration:', e.message); }

  // Migrate: add context_payload column to comments (Phase 3)
  try { db.exec('ALTER TABLE comments ADD COLUMN context_payload TEXT'); } catch { /* already exists */ }

  // Legacy: keep content_comments table creation for backward compat
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

  // Migrate: create content_revisions table (legacy, kept for migration)
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

  // Migrate data from old content_revisions to content_snapshots
  try {
    const hasContentRevisions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_revisions'").get();
    if (hasContentRevisions) {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM content_revisions').get();
      if (count.cnt > 0) {
        db.exec(`INSERT OR IGNORE INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, row_count, actor_id, created_at)
          SELECT id,
            CASE
              WHEN content_id LIKE 'presentation:%' THEN 'presentation'
              WHEN content_id LIKE 'diagram:%' THEN 'diagram'
              WHEN content_id LIKE 'board:%' THEN 'board'
              WHEN content_id LIKE 'spreadsheet:%' THEN 'spreadsheet'
              ELSE 'unknown'
            END,
            content_id, NULL, NULL, data, NULL, NULL, NULL, created_by, created_at
          FROM content_revisions`);
        console.log(`[gateway] Migrated ${count.cnt} content_revisions -> content_snapshots`);
      }
    }
  } catch (e) { console.warn('[gateway] content_revisions migration skipped:', e.message); }

  // Phase 5: event delivery tracking
  try { db.exec('ALTER TABLE events ADD COLUMN delivered_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE events ADD COLUMN delivery_method TEXT'); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_events_delivered ON events(agent_id, delivered_at)'); } catch { /* already exists */ }

  // Phase 6: i18n — structured keys + params for notifications, snapshots, actors preferred_language
  try { db.exec('ALTER TABLE notifications ADD COLUMN title_key TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE notifications ADD COLUMN title_params TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE notifications ADD COLUMN body_key TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE notifications ADD COLUMN body_params TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE content_snapshots ADD COLUMN description_key TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE content_snapshots ADD COLUMN description_params TEXT'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE actors ADD COLUMN preferred_language TEXT DEFAULT 'en'"); } catch { /* already exists */ }

  // Phase 4: table engine metadata
  try {
    runTableEngineMigrations(db);
  } catch (e) { console.error('[gateway] table-engine migrations failed:', e.message); throw e; }
}

function migrateTableComments(db) {
  try {
    const hasTableComments = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='table_comments'").get();
    if (hasTableComments) {
      const oldTableComments = db.prepare('SELECT * FROM table_comments').all();
      const insertStmt = db.prepare(`INSERT OR IGNORE INTO comments (id, target_type, target_id, row_id, text, data_json, actor, actor_id, parent_id, resolved_by, resolved_at, created_at, updated_at)
        VALUES (?, 'table', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of oldTableComments) {
        insertStmt.run(r.id, r.table_id, r.row_id || null, r.text, r.actor, r.actor_id || null, r.parent_id || null, r.resolved_by || null,
          r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
          typeof r.created_at === 'number' ? new Date(r.created_at).toISOString() : r.created_at,
          typeof r.updated_at === 'number' ? new Date(r.updated_at).toISOString() : r.updated_at);
      }
      if (oldTableComments.length > 0) console.log(`[gateway] Migrated ${oldTableComments.length} table_comments -> comments`);
    }
  } catch (e) { console.error('[gateway] table_comments migration error:', e.message); }
}

function migrateDocComments(db) {
  try {
    const hasDocComments = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_comments'").get();
    if (hasDocComments) {
      const oldDocComments = db.prepare('SELECT * FROM document_comments').all();
      const insertStmt = db.prepare(`INSERT OR IGNORE INTO comments (id, target_type, target_id, row_id, text, data_json, actor, actor_id, parent_id, resolved_by, resolved_at, created_at, updated_at)
        VALUES (?, 'doc', ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of oldDocComments) {
        insertStmt.run(r.id, r.document_id, r.data_json || null, r.actor || null, r.actor_id || null, r.parent_id || null, r.resolved_by || null, r.resolved_at || null, r.created_at, r.updated_at);
      }
      if (oldDocComments.length > 0) console.log(`[gateway] Migrated ${oldDocComments.length} document_comments -> comments`);
    }
  } catch (e) { console.error('[gateway] document_comments migration error:', e.message); }
}

function migrateContentComments(db) {
  try {
    const hasContentComments = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_comments'").get();
    if (hasContentComments) {
      const oldContentComments = db.prepare('SELECT * FROM content_comments').all();
      const insertStmt = db.prepare(`INSERT OR IGNORE INTO comments (id, target_type, target_id, row_id, text, data_json, actor, actor_id, parent_id, resolved_by, resolved_at, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of oldContentComments) {
        let targetType = 'content';
        const colonIdx = (r.content_id || '').indexOf(':');
        if (colonIdx > 0) targetType = r.content_id.substring(0, colonIdx);
        insertStmt.run(r.id, targetType, r.content_id, r.text, r.author || null, r.actor_id || null, r.parent_comment_id || null, r.resolved_by || null, r.resolved_at || null, r.created_at, r.updated_at);
      }
      if (oldContentComments.length > 0) console.log(`[gateway] Migrated ${oldContentComments.length} content_comments -> comments`);
    }
  } catch (e) { console.error('[gateway] content_comments migration error:', e.message); }
}

function migrateAgentAccounts(db) {
  try {
    const hasAgentAccounts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_accounts'").get();
    if (hasAgentAccounts) {
      const agents = db.prepare('SELECT * FROM agent_accounts').all();
      const insert = db.prepare(`INSERT OR IGNORE INTO actors (id, type, username, display_name, avatar_url, token_hash, capabilities, webhook_url, webhook_secret, online, last_seen_at, pending_approval, created_at, updated_at) VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      let migrated = 0;
      for (const a of agents) {
        const result = insert.run(a.id, a.name, a.display_name, a.avatar_url || null, a.token_hash, a.capabilities || null, a.webhook_url || null, a.webhook_secret || null, a.online || 0, a.last_seen_at || null, a.pending_approval || 0, a.created_at, a.updated_at);
        if (result.changes > 0) migrated++;
        if (result.changes === 0 && a.pending_approval) {
          db.prepare('UPDATE actors SET pending_approval = COALESCE(pending_approval, ?) WHERE id = ?')
            .run(a.pending_approval || 0, a.id);
        }
      }
      if (migrated > 0) console.log(`[gateway] Final migration: ${migrated} agents from agent_accounts -> actors`);
      db.exec('DROP TABLE agent_accounts');
      console.log('[gateway] Dropped legacy agent_accounts table');
    }
  } catch (e) { console.warn('[gateway] agent_accounts migration:', e.message); }
}

function seedExampleContent(db, gatewayDir) {
  // Only seed if content_items table is empty (first deployment)
  const count = db.prepare('SELECT COUNT(*) as n FROM content_items').get().n;
  if (count > 0) return;

  const seedPath = path.join(gatewayDir, 'seed-data.json');
  if (!fs.existsSync(seedPath)) return;

  try {
    // Copy seed images to uploads directory so they're accessible via /api/gateway/uploads/files/*
    const seedAssetsDir = path.join(gatewayDir, 'seed-assets');
    const uploadsDir = path.join(gatewayDir, 'uploads', 'files');
    if (fs.existsSync(seedAssetsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      for (const file of fs.readdirSync(seedAssetsDir)) {
        const src = path.join(seedAssetsDir, file);
        const dest = path.join(uploadsDir, `seed-${file}`);
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      }
    }

    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const now = new Date().toISOString();
    const nowMs = Date.now();

    // Seed document
    if (seed.doc) {
      const ci = seed.doc.content_item;
      const doc = seed.doc.document;
      db.prepare(
        `INSERT INTO content_items (id, raw_id, type, title, icon, parent_id, sort_order, collection_id, created_by, updated_by, created_at, updated_at, synced_at, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'admin', ?, ?, ?, 0)`
      ).run(ci.id, ci.raw_id, ci.type, ci.title, ci.icon, ci.parent_id, ci.sort_order || 0, ci.collection_id, now, now, nowMs);

      db.prepare(
        `INSERT INTO documents (id, title, text, data_json, icon, full_width, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'admin', 'admin', ?, ?)`
      ).run(doc.id, doc.title, doc.text, doc.data_json, doc.icon, doc.full_width || 0, now, now);
    }

    // Seed presentation
    if (seed.presentation) {
      const ci = seed.presentation.content_item;
      const pres = seed.presentation.presentation;
      db.prepare(
        `INSERT INTO content_items (id, raw_id, type, title, icon, parent_id, sort_order, collection_id, created_by, updated_by, created_at, updated_at, synced_at, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'admin', ?, ?, ?, 0)`
      ).run(ci.id, ci.raw_id, ci.type, ci.title, ci.icon, ci.parent_id, ci.sort_order || 0, ci.collection_id, now, now, nowMs);

      db.prepare(
        `INSERT INTO presentations (id, data_json, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, 'admin', 'admin', ?, ?)`
      ).run(pres.id, pres.data_json, now, now);
    }

    console.log('[gateway] Seeded example content (Welcome doc + Overview presentation)');
  } catch (e) {
    console.warn('[gateway] Failed to seed example content:', e.message);
  }
}
