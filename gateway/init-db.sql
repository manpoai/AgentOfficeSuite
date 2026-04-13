-- ASuite Gateway Database Schema

-- Unified identity: humans + agents
CREATE TABLE IF NOT EXISTS actors (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('human', 'agent')),
  username    TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url  TEXT,
  -- human auth
  password_hash TEXT,
  role        TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  -- agent auth
  token_hash  TEXT,
  capabilities TEXT,
  webhook_url TEXT,
  webhook_secret TEXT,
  online      INTEGER DEFAULT 0,
  last_seen_at INTEGER,
  platform    TEXT,
  pending_approval INTEGER DEFAULT 0,
  deleted_at  INTEGER,
  -- shared
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actors_type ON actors(type);
CREATE INDEX IF NOT EXISTS idx_actors_token_hash ON actors(token_hash);

CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  label       TEXT,
  expires_at  INTEGER NOT NULL,
  used        INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  source          TEXT NOT NULL,
  occurred_at     INTEGER NOT NULL,
  payload         TEXT NOT NULL,
  delivered       INTEGER DEFAULT 0,
  delivered_at    INTEGER,
  delivery_method TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_agent_time ON events(agent_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_agent_undelivered ON events(agent_id, delivered, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_delivered ON events(agent_id, delivered_at);

-- Thread context links: cross-system associations
CREATE TABLE IF NOT EXISTS thread_links (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,       -- MM thread root_id (or synthetic thread ID)
  link_type   TEXT NOT NULL,       -- 'doc', 'task', 'data_row'
  link_id     TEXT NOT NULL,       -- doc_id, task_id, or table_id:row_id
  link_title  TEXT,
  created_by  TEXT NOT NULL,       -- agent_id that created the link
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_links_thread ON thread_links(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_links_link ON thread_links(link_type, link_id);

-- Unified comments (all comment types: doc, table, presentation, diagram, cell)
CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,     -- 'doc' | 'table' | 'presentation' | 'diagram' | 'cell'
  target_id   TEXT NOT NULL,     -- content_items ID format: 'type:raw_id' (e.g. 'doc:xxx', 'table:xxx')
  row_id      TEXT,              -- table-specific: row ID (kept for compat, use anchor_id instead)
  text        TEXT,
  html        TEXT,
  data_json   TEXT,              -- ProseMirror JSON (for doc comments)
  actor       TEXT,
  actor_id    TEXT,
  parent_id   TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  anchor_type TEXT,              -- 'row' | 'text-range' | 'image' | 'element' | 'node' | 'edge' | 'cell' | NULL
  anchor_id   TEXT,              -- anchor object ID
  anchor_meta TEXT,              -- JSON, anchor additional info
  context_payload TEXT           -- JSON, structured context for agent consumers (Phase 3)
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_anchor ON comments(target_type, target_id, anchor_type, anchor_id);

-- Doc/table custom icons (emoji per document or table)
CREATE TABLE IF NOT EXISTS doc_icons (
  doc_id      TEXT PRIMARY KEY,
  icon        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Unified content snapshots (history versioning for tables, docs, presentations, diagrams)
CREATE TABLE IF NOT EXISTS content_snapshots (
  id            TEXT PRIMARY KEY,
  content_type  TEXT NOT NULL,      -- 'doc' | 'table' | 'presentation' | 'diagram'
  content_id    TEXT NOT NULL,
  version       INTEGER,
  title         TEXT,               -- doc title at snapshot time
  data_json     TEXT NOT NULL,
  schema_json   TEXT,               -- table schema at snapshot time (table-specific)
  trigger_type  TEXT,               -- 'auto' | 'manual' | 'pre_restore'
  description   TEXT,               -- version description (e.g. 'agent 编辑前自动保存')
  row_count     INTEGER,            -- table-specific
  actor_id      TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_snapshots_content ON content_snapshots(content_type, content_id, created_at DESC);

-- Content items: unified doc/table metadata for sidebar (source of truth for Shell)
CREATE TABLE IF NOT EXISTS content_items (
  id          TEXT PRIMARY KEY,       -- 'doc:<uuid>' or 'table:<id>'
  raw_id      TEXT NOT NULL,          -- original doc UUID or Baserow table ID
  type        TEXT NOT NULL,          -- 'doc' or 'table'
  title       TEXT NOT NULL DEFAULT '',
  icon        TEXT,                   -- emoji or icon URL
  parent_id   TEXT,                   -- 'doc:<uuid>' or 'table:<id>' (null = root)
  sort_order  INTEGER DEFAULT 0,
  collection_id TEXT,                 -- content tree collection grouping (docs only)
  created_by  TEXT,                   -- display name of creator
  updated_by  TEXT,                   -- display name
  created_at  TEXT,                   -- ISO timestamp from upstream
  updated_at  TEXT,                   -- ISO timestamp from upstream
  deleted_at  TEXT,                   -- soft-delete timestamp
  pinned      INTEGER DEFAULT 0,     -- 1 = pinned to top of sidebar
  owner_actor_id TEXT,               -- actor id of content owner
  synced_at   INTEGER NOT NULL        -- last sync epoch ms
);

CREATE INDEX IF NOT EXISTS idx_content_items_type ON content_items(type);
CREATE INDEX IF NOT EXISTS idx_content_items_parent ON content_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_content_items_owner ON content_items(owner_actor_id);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  actor_id TEXT,                -- who triggered it (nullable for system notifications)
  target_actor_id TEXT NOT NULL, -- who receives it
  type TEXT NOT NULL,            -- 'comment_reply', 'mention', 'agent_action', 'system'
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,                     -- URL to navigate to (e.g., /content?id=doc:xxx)
  read INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_actor_id, read, created_at DESC);

-- View column settings (field visibility/width per view)
CREATE TABLE IF NOT EXISTS view_column_settings (
  view_id     TEXT NOT NULL,
  column_id   TEXT NOT NULL,
  width       INTEGER,
  show        INTEGER DEFAULT 1,
  sort_order  INTEGER,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (view_id, column_id)
);
