/**
 * Table engine metadata schema.
 *
 * See INVARIANTS.md in this directory for the non-negotiable rules that
 * shape this schema (I1-I9).
 *
 * Eight metadata tables:
 *   user_tables           — one row per user-created table
 *   user_fields           — columns, with physical_column as immutable slot
 *   user_views            — Grid/Kanban/Gallery/Form view configs
 *   user_view_filters     — per-view filter rules
 *   user_view_sorts       — per-view sort rules
 *   user_view_columns     — per-view column visibility/order/width
 *   user_links            — single source of truth for Link field relations
 *   user_select_options   — SingleSelect/MultiSelect option values
 *
 * Physical row tables are named `utbl_<tableId>_rows` and are created
 * dynamically by schema.js::createTable.
 */

export function runTableEngineMigrations(db) {
  // user_tables ──────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS user_tables (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    description   TEXT,
    icon          TEXT,
    physical_name TEXT NOT NULL UNIQUE,
    created_by    TEXT,
    updated_by    TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  )`);

  // user_fields ──────────────────────────────────────
  // physical_column is the immutable SQLite column name on the physical
  // row table. See I5.
  db.exec(`CREATE TABLE IF NOT EXISTS user_fields (
    id               TEXT PRIMARY KEY,
    table_id         TEXT NOT NULL,
    title            TEXT NOT NULL,
    uidt             TEXT NOT NULL,
    physical_column  TEXT NOT NULL,
    position         INTEGER NOT NULL DEFAULT 0,
    is_primary       INTEGER NOT NULL DEFAULT 0,
    options          TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    FOREIGN KEY (table_id) REFERENCES user_tables(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_fields_table ON user_fields(table_id, position)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_fields_physcol ON user_fields(table_id, physical_column)');

  // user_views ───────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS user_views (
    id           TEXT PRIMARY KEY,
    table_id     TEXT NOT NULL,
    title        TEXT NOT NULL,
    view_type    TEXT NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    is_default   INTEGER NOT NULL DEFAULT 0,
    options      TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    FOREIGN KEY (table_id) REFERENCES user_tables(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_views_table ON user_views(table_id, position)');

  // user_view_filters ────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS user_view_filters (
    id            TEXT PRIMARY KEY,
    view_id       TEXT NOT NULL,
    field_id      TEXT NOT NULL,
    operator      TEXT NOT NULL,
    value         TEXT,
    conjunction   TEXT NOT NULL DEFAULT 'and',
    position      INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (view_id) REFERENCES user_views(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_view_filters_view ON user_view_filters(view_id, position)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_view_filters_field ON user_view_filters(field_id)');

  // user_view_sorts ──────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS user_view_sorts (
    id         TEXT PRIMARY KEY,
    view_id    TEXT NOT NULL,
    field_id   TEXT NOT NULL,
    direction  TEXT NOT NULL DEFAULT 'asc',
    position   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (view_id) REFERENCES user_views(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_view_sorts_view ON user_view_sorts(view_id, position)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_view_sorts_field ON user_view_sorts(field_id)');

  // user_view_columns ────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS user_view_columns (
    id          TEXT PRIMARY KEY,
    view_id     TEXT NOT NULL,
    field_id    TEXT NOT NULL,
    visible     INTEGER NOT NULL DEFAULT 1,
    position    INTEGER NOT NULL DEFAULT 0,
    width       INTEGER,
    FOREIGN KEY (view_id) REFERENCES user_views(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_view_columns_view ON user_view_columns(view_id, position)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_view_columns_field ON user_view_columns(field_id)');

  // user_links — single source of truth (I1)
  // field_id is the OUTGOING field on source_table_id.
  // For bidirectional links, there is exactly one row per relation;
  // the reverse side reads the same row via target_row_id lookup.
  db.exec(`CREATE TABLE IF NOT EXISTS user_links (
    id              TEXT PRIMARY KEY,
    field_id        TEXT NOT NULL,
    source_table_id TEXT NOT NULL,
    source_row_id   TEXT NOT NULL,
    target_table_id TEXT NOT NULL,
    target_row_id   TEXT NOT NULL,
    created_at      INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_links_source ON user_links(field_id, source_row_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_links_target ON user_links(field_id, target_row_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_links_src_tbl ON user_links(source_table_id, source_row_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_links_tgt_tbl ON user_links(target_table_id, target_row_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_links_unique ON user_links(field_id, source_row_id, target_row_id)');

  // user_select_options — SingleSelect / MultiSelect
  db.exec(`CREATE TABLE IF NOT EXISTS user_select_options (
    id          TEXT PRIMARY KEY,
    field_id    TEXT NOT NULL,
    table_id    TEXT NOT NULL,
    value       TEXT NOT NULL,
    color       TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_select_options_field ON user_select_options(field_id, position)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_select_options_table ON user_select_options(table_id)');
}
