# CSV Import for Tables — Design Spec

## Summary

Add CSV file import to create new tables in AOSE. Frontend-only CSV parsing (Approach A) — no new gateway endpoints.

## Requirements

- Upload a CSV file → create a new table
- First row = column headers
- All columns = SingleLineText (no type inference)
- Table name = filename minus `.csv`
- Entry point: frontend UI only

## Architecture

All CSV parsing happens in the browser. The flow uses two existing gateway endpoints:

```
User picks .csv file
  → Browser reads file (FileReader)
  → Parse CSV (built-in parser, no library)
  → Call POST /api/content/items { type: 'table', title, columns }
  → Call POST /api/data/:table_id/rows/batch { rows: [...] }
  → Navigate to new table
```

No gateway changes required. The existing `createContentItem` (content route) creates the table + default grid view, and `/rows/batch` (data route) inserts rows in bulk.

## Components

### 1. CSV Parser (`shell/src/lib/csv-parser.ts`)

Hand-written parser handling RFC 4180:
- Comma delimiter
- Quoted fields (double-quote escaping)
- Newlines inside quoted fields
- BOM stripping (UTF-8)

```ts
interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
}
function parseCsv(text: string): CsvParseResult;
```

Returns headers from row 0, and an array of `{ [header]: value }` objects for data rows. Empty headers are auto-named (`Column 1`, `Column 2`, ...). Duplicate headers get a suffix (`Name`, `Name_2`).

### 2. API Client Addition (`shell/src/lib/api/tables.ts`)

Add `batchInsertRows`:

```ts
export async function batchInsertRows(
  tableId: string,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]>;
```

Calls `POST /api/data/:table_id/rows/batch` with `{ rows }`. For large imports, chunks into batches of 500 rows per request.

### 3. Import Dialog (`shell/src/components/table-editor/CsvImportDialog.tsx`)

Modal dialog:
- File picker (accept=".csv")
- After file selected: show preview (first 5 rows in a simple table)
- Show: filename → table name, column count, row count
- "Import" button to confirm, "Cancel" to close
- Loading state during import
- Error display if parsing fails or API errors

### 4. UI Entry Point (`shell/src/app/(workspace)/content/page.tsx`)

Add "Import CSV" option to the content creation menu (alongside "New Table", "New Doc", etc.). Triggers the CsvImportDialog. After successful import, navigates to the new table.

## Data Flow

1. User clicks "Import CSV" in content sidebar menu
2. CsvImportDialog opens → user picks a `.csv` file
3. FileReader reads file as text (UTF-8)
4. `parseCsv()` extracts headers + rows
5. Preview renders in dialog
6. User clicks "Import"
7. `gw.createContentItem({ type: 'table', title: filename, columns: headers.map(h => ({ title: h, uidt: 'SingleLineText' })) })`
8. Get `raw_id` (table ID) from response
9. `batchInsertRows(tableId, rows)` — chunked at 500 rows
10. Invalidate queries, navigate to new table
11. Close dialog

## Error Handling

- File read error → show error in dialog
- CSV parse error (malformed) → show error with line number if possible
- Empty file / no data rows → show "file is empty" message
- API error on table creation → show error, no cleanup needed
- API error during row insert → table exists but partially filled; show warning with row count inserted

## Limits

- Max file size: 10MB (checked client-side before parsing)
- Max rows: 50,000 (checked after parsing, before insert)
- Max columns: 100 (checked after parsing)

These are soft UI limits to prevent browser hangs; the gateway has no such limits.

## i18n

All user-facing strings use the existing `useT()` i18n system. Keys under `csvImport.*`:
- `csvImport.title` — dialog title
- `csvImport.selectFile` — file picker label
- `csvImport.preview` — preview section header
- `csvImport.importing` — loading state
- `csvImport.success` — success toast
- `csvImport.errors.*` — error messages

## Testing

- Manual: import a CSV with various edge cases (quoted fields, commas in values, empty cells, unicode, BOM)
- Verify table appears in content tree with correct name
- Verify all rows and columns present in table editor
- Verify large file (1000+ rows) imports without freezing
