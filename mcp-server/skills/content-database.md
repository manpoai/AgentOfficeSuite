# Content: Database Tables

Reference for working with aose databases. Assumes you've read `00-role-and-principles.md`, `01-typical-tasks.md`, `02-platform-overview.md`, and `03-events-and-collaboration.md`.

## What It Is

Databases are structured data tables with typed columns, similar to Airtable or Notion databases. Each table has a schema of typed columns, and data lives in rows. Tables support relationships between each other (Links), computed columns (Formula, Rollup, Lookup), multiple views (Grid, Kanban, Gallery, Form), and filtering/sorting on queries.

## When to Use

Create or use a database when:

- You have a list of items that share the same fields (customers, tasks, orders, events, bugs).
- You need to filter, sort, or group the data.
- You need to track relationships between entities (customer → orders, project → tasks).
- You need a view of the same data in multiple shapes (Kanban for workflow, Grid for editing).

Don't use a database when:

- The content is prose — use a document.
- There's only one or two records of a kind, and you'll never add more — just put them in a doc.
- The structure is freeform and each "row" has wildly different fields — that's a document, not a table.

## Typical Patterns

### Pattern 1: Read from an existing table

The human says "how many active customers do we have?" or "show me the open bugs."

1. If you don't know the `table_id`, `list_tables` once or use a name you already have.
2. `query_rows` with a filter: `query_rows({ table_id, where: "(Status,eq,Active)" })`.
3. Report the count or the relevant rows.

Don't `describe_table` unless you need to know the columns. Once per session is plenty.

### Pattern 2: Insert a new row

The human says "add a row for X" or you've decided a row needs to exist as part of a larger task.

1. Know the column names and types — call `describe_table` once if you don't.
2. Build the payload with only the columns you're setting. Skip read-only columns (`Id`, `CreatedTime`, `CreatedBy`, `Formula`, `Rollup`, `Lookup`).
3. `insert_row({ table_id, data: { Name: "...", ... } })`.
4. The return value includes the new row ID. That's your confirmation — you don't need to `query_rows` to verify it's there.

### Pattern 3: Bulk update from a criteria

"Mark all completed tasks as archived." "Update all customers from region X."

1. `query_rows` with a filter to find the target rows.
2. Iterate and `update_row` per row (or use a batch operation if one exists).
3. Report the count updated.

If one row fails, handle that one row plainly — don't abort the whole batch. "Updated 46 of 47 rows; row 23 failed because the email column rejected the value."

### Pattern 4: Create a new table

The human says "track X in a new table." Decide the schema, create the table, and optionally seed it.

1. Pick column names that describe what they hold (`customer_email`, not `col1`).
2. Pick the most specific column type (Currency for money, Date for dates, SingleSelect for known choices).
3. Decide which columns are required before calling.
4. `create_table({ title, columns: [{ title, uidt }, ...] })` — pass all initial columns in one call.
5. `list_tables` is *not* needed here — you're creating.

See `06-output-standards.md` for table design quality rules.

### Pattern 5: Modify an existing table's schema

The human says "add a Priority column" or "rename the Status column".

**Add a column:**
```
add_column(table_id, { title: "Priority", uidt: "SingleSelect" })
```

**Rename a column:**
```
update_column(table_id, column_id, { title: "New Name" })
```
Get `column_id` from `describe_table`.

**Delete a column:**
```
delete_column(table_id, column_id)
```
Warning: this permanently drops the column and all its data.

**Reorder columns:**
```
reorder_columns(table_id, [column_id_1, column_id_2, ...])
```
Pass all column IDs in the desired order. Columns not in the list are appended at the end.

Row data in other columns is unaffected by schema changes.

## Column Types (25 Types)

### Text
| Type | For | Notes |
|------|-----|-------|
| `SingleLineText` | Short text | Default type |
| `LongText` | Multi-line text | |
| `Email` | Email address | Validated |
| `URL` | Web URL | Clickable |
| `PhoneNumber` | Phone number | |

### Number
| Type | For | Notes |
|------|-----|-------|
| `Number` | Integer or decimal | General purpose |
| `Decimal` | Precise decimal | Configurable precision |
| `Currency` | Monetary | 10 currencies (USD, CNY, EUR, GBP, AUD, CAD, SGD, KRW, INR, JPY) |
| `Percent` | Percentage | Stored as number, displayed with % |
| `Rating` | 1–10 scale | Multiple icon styles |
| `AutoNumber` | Auto-incrementing | Read-only, system-managed |

### Date
| Type | For |
|------|-----|
| `Date` | Calendar date |
| `DateTime` | Date + time |

### Selection
| Type | For | Notes |
|------|-----|-------|
| `Checkbox` | Boolean | |
| `SingleSelect` | One option from a list | Color-coded |
| `MultiSelect` | Multiple options | Color-coded |

### Relationships and Computed
| Type | For | Notes |
|------|-----|-------|
| `Links` | Link to rows in another table | Single or multi |
| `Lookup` | Pull a field through a Links column | Read-only |
| `Rollup` | Aggregate over linked rows | sum, avg, count, min, max |
| `Formula` | Computed expression | Read-only |

### Other
| Type | For | Notes |
|------|-----|-------|
| `Attachment` | File uploads | Up to 10 files, 50MB each |
| `JSON` | Raw JSON | Flexible structured data |
| `User` | Workspace member reference | |
| `CreatedBy` | Creator | Read-only |
| `LastModifiedBy` | Last editor | Read-only |

### Read-only columns
`Id`, `AutoNumber`, `CreatedTime`, `LastModifiedTime`, `CreatedBy`, `LastModifiedBy`, `Formula`, `Rollup`, `Lookup` — do not include these in insert or update payloads.

## View Types

| View | For |
|------|-----|
| **Grid** | Spreadsheet-style, default for editing |
| **Kanban** | Card board grouped by a `SingleSelect` column — workflow tracking |
| **Gallery** | Visual cards with cover images — media-rich records |
| **Form** | Data entry form — collecting structured input |

## Querying

### Filter syntax
`(ColumnName,operator,value)` — column names are case-sensitive.

### Operators
- `eq` / `neq` — equal / not equal
- `like` / `nlike` — contains / not contains
- `gt` / `gte` / `lt` / `lte` — comparison
- `is` / `isnot` — null-safe equality
- `checked` / `notchecked` — for Checkbox columns

### Examples
- `(Status,eq,Active)`
- `(Amount,gt,1000)`
- `(Name,like,John)`

### Sorting
`sort=-Amount,Name` — prefix `-` for descending.

## Linked Records

`Links` columns create relationships between tables.

- **Inserting a link:** Pass a row ID (or array of row IDs for multi-link) in the Links column. Not the display value — the ID.
- **Querying linked data:** Use `Lookup` columns to read a single field through the link, or `Rollup` to aggregate (sum, count, etc.).
- **Cross-table references:** Build relational data (Projects → Tasks, Customers → Orders) with Links columns instead of duplicating data across tables.

## Edge Cases

- **Column type mismatch on insert.** Sending `"123"` (a string) to a `Number` column fails. Coerce client-side.
- **Missing required columns on insert.** Omitted columns default to null. If a column is required, the insert fails.
- **Filtering by a column that doesn't exist.** Often returns an empty result rather than a clear error. Check column names with `describe_table` if you get unexpectedly empty results.
- **Writing to a Formula/Rollup/Lookup column.** Rejected — these are computed from other columns.
- **Linking to a row that doesn't exist.** The insert fails with a "linked row not found" style error. Verify the target row ID exists first.
- **Renaming a column.** Existing queries that reference the old name will break. Consider impact before renaming.

## Anti-Patterns

- **Don't `list_tables` when you already know the table name.** The event payload or the human gave you the name — go straight to the row operation.
- **Don't `describe_table` on every operation.** Describe once per session and remember the schema. If you're inserting rows with the same columns as before, skip it.
- **Don't `query_rows` to "check state" after you just wrote.** `insert_row` and `update_row` return success/failure. Trust them unless they errored.
- **Don't filter client-side what the API can filter.** Don't pull every row and loop — pass a `where` clause.
- **Don't leave system-generated table titles visible.** A table called `table_a4f1b2` is a product-quality failure. Give tables real names. See `06-output-standards.md`.
- **Don't put placeholder garbage in rows.** `"TODO"`, `"tbd"`, `"N/A (placeholder)"` in real data is a quality failure — leave cells empty or use a real status value.
- **Don't duplicate data across tables instead of using Links.** If the same customer name appears in three tables, it belongs in one table with Links pointing at it.
- **Don't wrap every call in try/catch.** See `05-troubleshooting.md`. Handle real errors, not imagined ones.
