-- ASuite Gateway Database Schema

CREATE TABLE IF NOT EXISTS agent_accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  capabilities TEXT,
  webhook_url TEXT,
  webhook_secret TEXT,
  online      INTEGER DEFAULT 0,
  last_seen_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  avatar_url  TEXT,
  nc_password TEXT    -- per-agent NocoDB password (agent email = name@nc-agents.local)
);

CREATE INDEX IF NOT EXISTS idx_agent_accounts_token ON agent_accounts(token_hash);

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
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  source      TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  delivered   INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_agent_time ON events(agent_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_agent_undelivered ON events(agent_id, delivered, occurred_at);

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

-- Table comments (table-level and row-level comments stored locally)
CREATE TABLE IF NOT EXISTS table_comments (
  id          TEXT PRIMARY KEY,
  table_id    TEXT NOT NULL,
  row_id      TEXT,              -- NULL for table-level comments, row ID for row-level
  parent_id   TEXT,              -- NULL for top-level, comment ID for replies
  text        TEXT NOT NULL,
  actor       TEXT NOT NULL,     -- display name of commenter
  actor_id    TEXT,              -- agent_id or user_id
  resolved_by TEXT,
  resolved_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_table_comments_table ON table_comments(table_id, row_id);
CREATE INDEX IF NOT EXISTS idx_table_comments_parent ON table_comments(parent_id);

-- Doc/table custom icons (emoji per document or table)
CREATE TABLE IF NOT EXISTS doc_icons (
  doc_id      TEXT PRIMARY KEY,
  icon        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Table snapshots (history versioning for tables)
CREATE TABLE IF NOT EXISTS table_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id    TEXT NOT NULL,
  version     INTEGER NOT NULL,
  schema_json TEXT NOT NULL,
  data_json   TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  agent       TEXT,
  row_count   INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_table ON table_snapshots(table_id, version DESC);

-- Content items: unified doc/table metadata for sidebar (source of truth for Shell)
CREATE TABLE IF NOT EXISTS content_items (
  id          TEXT PRIMARY KEY,       -- 'doc:<uuid>' or 'table:<uuid>'
  raw_id      TEXT NOT NULL,          -- original Outline doc ID or NocoDB table ID
  type        TEXT NOT NULL,          -- 'doc' or 'table'
  title       TEXT NOT NULL DEFAULT '',
  icon        TEXT,                   -- emoji or icon URL
  parent_id   TEXT,                   -- 'doc:<uuid>' or 'table:<uuid>' (null = root)
  sort_order  INTEGER DEFAULT 0,
  collection_id TEXT,                 -- Outline collection ID (docs only)
  created_by  TEXT,                   -- display name
  updated_by  TEXT,                   -- display name
  created_at  TEXT,                   -- ISO timestamp from upstream
  updated_at  TEXT,                   -- ISO timestamp from upstream
  deleted_at  TEXT,                   -- soft-delete timestamp
  pinned      INTEGER DEFAULT 0,     -- 1 = pinned to top of sidebar
  synced_at   INTEGER NOT NULL        -- last sync epoch ms
);

CREATE INDEX IF NOT EXISTS idx_content_items_type ON content_items(type);
CREATE INDEX IF NOT EXISTS idx_content_items_parent ON content_items(parent_id);

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

-- View column settings (field visibility/width per NocoDB view)
CREATE TABLE IF NOT EXISTS view_column_settings (
  view_id     TEXT NOT NULL,
  column_id   TEXT NOT NULL,
  width       INTEGER,
  show        INTEGER DEFAULT 1,
  sort_order  INTEGER,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (view_id, column_id)
);
