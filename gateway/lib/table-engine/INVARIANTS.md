# Table Engine Invariants

These are not suggestions. They are enforced at the code level. Any PR that
touches `gateway/lib/table-engine/*` must read this file and confirm each
invariant still holds after the change.

---

## I1. Link is single-source-of-truth

**Rule:** `user_links` is the **only** authoritative store for Link field data.
The `f_<field_id>` column on the physical row table is a **derived cache**,
rebuilt from `user_links` inside the same transaction that mutates links.

**Enforcement:**
- `link.js` exposes **exactly five** primitives: `list / add / remove /
  clearByRow / clearByField`. No other file writes to `user_links`.
- `row-io.js` never writes Link columns directly. When `insertRow` /
  `updateRow` receives a Link value, it delegates to `link.js` which does
  `clearByRow(fieldId, rowId)` → `add(fieldId, rowId, targetRowId)` per
  target, then `rebuildRowCache(rowId, fieldId)`.
- Rebuild failure → transaction rollback. There must never be a state where
  `user_links` and the JSON cache disagree.

**Why this matters:** The original concern is that Link design sprawls across
storage, query, bidirectional sync, cascade delete, row display, row detail,
comments, events, and agent context. Funneling every write through one table
and one module is the only way to keep it auditable.

---

## I2. Bidirectional links are not dual-truth

**Rule:** A bidirectional Link field is **one record in `user_links`**, read
from both sides. The reverse side's cache is rebuilt by reading the same
`user_links` row. There is no "source" record and "mirror" record.

**Enforcement:**
- `user_links` row shape: `(id, field_id, source_row_id, target_row_id)`.
- `list(fieldId, rowId)` returns rows where `source_row_id = rowId AND
  field_id = fieldId` (outgoing direction).
- `listReverse(reverseFieldId, rowId)` returns rows where `target_row_id =
  rowId AND field_id = pairedOutgoingFieldId`. The paired outgoing field is
  resolved via `user_fields.options.paired_field_id`.
- When the outgoing side writes, the reverse side's cache column on the
  target row is rebuilt in the same transaction.

---

## I3. One storage path for 1:1 / 1:N / N:N

**Rule:** Cardinality is a **read-time validation**, not a separate storage
code path. All three relationship types use the same `user_links` table and
the same five link primitives.

**Enforcement:**
- `user_fields.options.cardinality` ∈ `{"one", "many"}` for source and target
  independently.
- On `add`, if source cardinality is `"one"` and `user_links` already has a
  row with this `source_row_id + field_id`, the write throws
  `CARDINALITY_VIOLATION`. Same for target cardinality.
- No file may branch on `relationship_type === 'one_to_one'`. There is no
  such field.

---

## I4. Link target table is immutable

**Rule:** Once a Link field is created with `target_table_id = X`, that value
cannot be changed. To change it, delete the field and create a new one.

**Enforcement:**
- `schema.js updateField`: if the field is of type `LinkToAnotherRecord` /
  `LinkToAnotherRecords` and the patch contains `target_table_id` or
  `options.target_table_id`, throw `VALIDATION_ERROR: "Link target cannot be
  changed; delete and recreate the field"`.
- `user_fields.options.target_table_id` is a write-once slot, set by
  `addField` and never touched by `updateField`.

**Why:** Changing target mid-life would leave `user_links` rows pointing at
rows in a different table's ID space. Cascade-cleanup logic would have to
guess which target table to check. We sidestep the whole class of bugs.

---

## I5. Physical column name is immutable after creation

**Rule:** The physical SQLite column `f_<field_id>` on `utbl_<table_id>_rows`
is **never renamed**. A user-visible field rename changes only
`user_fields.title`.

**Enforcement:**
- `user_fields` has a `physical_column` column, populated once by `addField`
  as `f_${fieldId}`, treated as immutable by all callers.
- `updateField` can patch `title`, `options` (subject to I4), and display
  metadata. It **must not** emit any `ALTER TABLE ... RENAME COLUMN`.
- Query builder, row mapper, link cache rebuild all reference
  `user_fields.physical_column`, never construct the name from `title`.

**Why:** SQLite column rename is supported (3.25+) but fragile across
indexes, triggers, view references, and FTS sync. Decoupling display name
from physical name eliminates an entire failure class.

---

## I6. Full cleanup on drop field

**Rule:** Dropping a field runs a **complete cleanup sequence inside one
transaction**. Any step fails → entire transaction rolls back.

**Sequence (in order):**

1. `DELETE FROM user_links WHERE field_id = ?`
2. `DELETE FROM user_select_options WHERE field_id = ?`
3. `DELETE FROM user_view_filters WHERE field_id = ?`
4. `DELETE FROM user_view_sorts WHERE field_id = ?`
5. `DELETE FROM user_view_columns WHERE field_id = ?`
6. Drop the reverse-cache column on linked tables, if this field is a Link
   and has a paired field on the target table (same cleanup sequence runs
   on the paired field record).
7. `ALTER TABLE utbl_<tableId>_rows DROP COLUMN f_<fieldId>`
8. `DELETE FROM user_fields WHERE id = ?`

**Enforcement:**
- `schema.js dropField` is the only caller of the above sequence.
- The sequence is wrapped in `db.transaction(() => { ... })()`.
- SQLite native `DROP COLUMN` (3.35+) is used first. If it errors (index on
  column, check constraint, etc.), fall back to the "copy table" pattern:
  create new table without the column, `INSERT INTO new SELECT ... FROM
  old`, `DROP old`, `ALTER RENAME`. Test UT8 must cover both paths.

---

## I7. Full cleanup on drop table

**Rule:** Dropping a table runs the equivalent full cleanup sequence.

**Sequence:**
1. For each field on the table, run the drop-field cleanup (I6).
2. `DELETE FROM user_view_columns WHERE view_id IN (SELECT id FROM user_views WHERE table_id = ?)`
3. `DELETE FROM user_view_filters WHERE view_id IN (...)`
4. `DELETE FROM user_view_sorts WHERE view_id IN (...)`
5. `DELETE FROM user_views WHERE table_id = ?`
6. `DELETE FROM user_select_options WHERE table_id = ?` (safety net)
7. `DELETE FROM user_links WHERE source_table_id = ? OR target_table_id = ?`
   (catches any residual bidirectional link rows whose source field was on
   a different table)
8. `DROP TABLE utbl_<tableId>_rows`
9. `DELETE FROM user_tables WHERE id = ?`

All wrapped in one transaction.

---

## I8. routes/data.js is replaced per route family, not in bulk

**Rule:** `gateway/routes/data.js` must be migrated to `table-engine` **one
route family at a time**, with per-family verification between each step.
Do not delete `gateway/baserow.js` until every family is migrated.

**Families (in order):**
1. Tables — list / get / create / delete
2. Columns — add / update / drop field
3. Rows — single insert / update / delete / query
4. Batch — batch insert / update / delete
5. Views — view CRUD + filters + sorts + columns
6. Links — row link endpoints

**Between each family:**
- Run the family's integration tests (IT set defined in phase4-plan §7.4)
- Open shell in a browser, exercise that family end-to-end against real
  data
- `grep -r "br(" gateway/routes/data.js` — confirm no half-migrated state
  (lines for this family should be gone; other families can still reference
  `br`)

Only after family 6 passes does `baserow.js` get deleted in one commit.

---

## I9. Transactions wrap every multi-step mutation

Any operation touching more than one row or more than one table wraps its
work in `db.transaction(() => { ... })()`. This is non-negotiable for:

- `createTable` (insert user_tables + CREATE physical table)
- `addField` (insert user_fields + ALTER physical table + optional options)
- `dropField` / `dropTable` (full I6/I7 sequences)
- `insertRow` / `updateRow` (row write + any Link side-effects +
  `user_links` writes + cache rebuild)
- `batchInsert` / `batchUpdate` / `batchDelete`

No exceptions. If you find a multi-step write without a transaction
wrapper, that is a bug.
