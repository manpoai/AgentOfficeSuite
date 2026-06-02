# CSV Import (New Table) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import a CSV file from the content sidebar to create a new table (all SingleLineText columns).

**Architecture:** Frontend-only CSV parsing. Reuse the existing `parseLine` CSV parser (extracted to a shared module), call `gw.createContentItem({ type: 'table', columns })` to create the table, then `POST /api/data/:table_id/rows/batch` to insert rows in batches of 500. No gateway changes.

**Tech Stack:** Next.js (React), TypeScript, existing AOSE gateway API, lucide-react icons, `useT()` i18n system.

**Key existing code:**
- CSV parser (inline in `shell/src/components/table-editor/TableEditor.tsx:1537-1554`) — handles quoted fields but not newlines inside quotes
- `CSVImportDialog` in `shell/src/components/table-editor/TableDialogs.tsx:104` — imports into *existing* table with column mapping (different from our feature)
- `gw.createContentItem()` in `shell/src/lib/api/gateway.ts:291` — accepts `columns` array for table creation
- `POST /api/data/:table_id/rows/batch` in gateway — batch row insert (not yet in frontend API client)
- Content creation menu in `shell/src/components/ContentSidebar.tsx:1091-1114` — renders `CREATE_CONTENT_ITEMS` array
- `CREATABLE_TYPES` in `shell/src/actions/entity-names.ts:64`

---

### Task 1: Extract CSV parser to shared module

**Files:**
- Create: `shell/src/lib/csv-parser.ts`
- Modify: `shell/src/components/table-editor/TableEditor.tsx:1534-1557` (replace inline parser with import)

- [ ] **Step 1: Create `shell/src/lib/csv-parser.ts`**

```ts
// RFC 4180 CSV parser — handles quoted fields, double-quote escaping, newlines in quotes, BOM.

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  rawRows: string[][];
}

export function parseCsv(text: string): CsvParseResult {
  // Strip UTF-8 BOM
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  // Parse into 2D array handling quoted fields with embedded newlines
  const records: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current);
        current = '';
      } else if (ch === '\r' && clean[i + 1] === '\n') {
        row.push(current);
        current = '';
        records.push(row);
        row = [];
        i++; // skip \n
      } else if (ch === '\n') {
        row.push(current);
        current = '';
        records.push(row);
        row = [];
      } else {
        current += ch;
      }
    }
  }
  // Flush last field/row
  row.push(current);
  if (row.length > 1 || row[0] !== '') {
    records.push(row);
  }

  if (records.length === 0) return { headers: [], rows: [], rawRows: [] };

  // Deduplicate and name empty headers
  const rawHeaders = records[0];
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`;
    const count = seen.get(name.toLowerCase()) || 0;
    if (count > 0) name = `${name}_${count + 1}`;
    seen.set(name.toLowerCase(), count + 1);
    return name;
  });

  const dataRows = records.slice(1);
  const rawRows = dataRows;
  const rows = dataRows.map(cols => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    return obj;
  });

  return { headers, rows, rawRows };
}
```

- [ ] **Step 2: Update TableEditor.tsx to use shared parser**

In `shell/src/components/table-editor/TableEditor.tsx`, add import at the top (near other imports):

```ts
import { parseCsv } from '@/lib/csv-parser';
```

Replace the `handleCSVFileSelect` function body (lines ~1527-1569) with:

```ts
  const handleCSVFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const { headers, rawRows } = parseCsv(text);
      if (headers.length === 0 || rawRows.length === 0) return;
      setCsvImportData({ headers, rows: rawRows });
      const autoMap: Record<number, string> = {};
      headers.forEach((h, i) => {
        const match = editableCols.find(c => c.title.toLowerCase() === h.trim().toLowerCase());
        if (match) autoMap[i] = match.title;
      });
      setCsvColMap(autoMap);
    };
    reader.readAsText(file);
    e.target.value = '';
  };
```

- [ ] **Step 3: Verify existing CSV import still works**

Run: `cd /Users/mac/Documents/asuite/shell && npx tsc --noEmit 2>&1 | head -20`
Expected: No new type errors.

Manual check: Open the app, go to an existing table, use the existing "Import CSV" button in the table toolbar. It should still work with the extracted parser.

- [ ] **Step 4: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/lib/csv-parser.ts shell/src/components/table-editor/TableEditor.tsx
git commit -m "refactor: extract CSV parser to shared module"
```

---

### Task 2: Add `batchInsertRows` to API client

**Files:**
- Modify: `shell/src/lib/api/tables.ts` (add function after `insertRow`)

- [ ] **Step 1: Add `batchInsertRows` function**

In `shell/src/lib/api/tables.ts`, add after the `deleteRow` function (after line 156):

```ts
export async function batchInsertRows(
  tableId: string,
  rows: Record<string, unknown>[],
  batchSize = 500
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const res = await brFetch<{ items: Record<string, unknown>[] }>(
      `/${tableId}/rows/batch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: chunk }),
      }
    );
    all.push(...res.items);
  }
  return all;
}
```

- [ ] **Step 2: Type check**

Run: `cd /Users/mac/Documents/asuite/shell && npx tsc --noEmit 2>&1 | head -20`
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/lib/api/tables.ts
git commit -m "feat: add batchInsertRows to tables API client"
```

---

### Task 3: Add i18n keys

**Files:**
- Modify: `shell/src/lib/i18n/locales/en.json`
- Modify: `shell/src/lib/i18n/locales/zh.json`
- Modify: `shell/src/lib/i18n/locales/ja.json`
- Modify: `shell/src/lib/i18n/locales/ko.json`

- [ ] **Step 1: Add keys to all locale files**

Add the following keys inside the `"actions"` section of each locale file (after `"newVideo"` line):

**en.json** — add after `"newVideo": "New Video",`:
```json
    "importCSV": "Import CSV",
```

Note: `"importCSV"` already exists under `"dataTable"` (key `dataTable.importCSV`). This new key goes under `"actions"` for the sidebar menu. Check if `actions.importCSV` already exists first — if it does, skip this step.

Add a new top-level `"csvImport"` section (before the closing `}`):
```json
  "csvImport": {
    "title": "Import CSV as New Table",
    "preview": "Preview",
    "importing": "Importing…",
    "success": "Table created successfully",
    "fileName": "File",
    "tableName": "Table name",
    "columns": "{n} columns",
    "rows": "{n} rows",
    "importBtn": "Import",
    "fileTooLarge": "File is too large (max 10MB)",
    "tooManyRows": "Too many rows (max 50,000)",
    "tooManyColumns": "Too many columns (max 100)",
    "emptyFile": "File is empty or has no data rows",
    "parseError": "Could not parse CSV file",
    "createTableFailed": "Failed to create table",
    "insertRowsFailed": "Failed to import some rows. {inserted} of {total} rows imported."
  },
```

**zh.json** — same structure:
```json
    "importCSV": "导入 CSV",
```

```json
  "csvImport": {
    "title": "导入 CSV 为新表",
    "preview": "预览",
    "importing": "导入中…",
    "success": "表格创建成功",
    "fileName": "文件",
    "tableName": "表名",
    "columns": "{n} 列",
    "rows": "{n} 行",
    "importBtn": "导入",
    "fileTooLarge": "文件过大（最大 10MB）",
    "tooManyRows": "行数过多（最多 50,000 行）",
    "tooManyColumns": "列数过多（最多 100 列）",
    "emptyFile": "文件为空或没有数据行",
    "parseError": "无法解析 CSV 文件",
    "createTableFailed": "创建表格失败",
    "insertRowsFailed": "部分行导入失败。已导入 {inserted}/{total} 行。"
  },
```

**ja.json** and **ko.json**: Use English values for now (they can be translated later). Copy the en.json block.

- [ ] **Step 2: Verify JSON is valid**

Run: `cd /Users/mac/Documents/asuite/shell && node -e "JSON.parse(require('fs').readFileSync('src/lib/i18n/locales/en.json'))" && echo "OK"`
Run the same for zh.json, ja.json, ko.json.
Expected: "OK" for all four.

- [ ] **Step 3: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/lib/i18n/locales/*.json
git commit -m "feat: add i18n keys for CSV import"
```

---

### Task 4: Create CsvImportNewTableDialog component

**Files:**
- Create: `shell/src/components/table-editor/CsvImportNewTableDialog.tsx`

This is the dialog shown when importing a CSV from the sidebar to create a *new* table. It is different from the existing `CSVImportDialog` which imports into an existing table with column mapping.

- [ ] **Step 1: Create the dialog component**

```tsx
'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { parseCsv, type CsvParseResult } from '@/lib/csv-parser';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROWS = 50_000;
const MAX_COLS = 100;

export interface CsvImportNewTableDialogProps {
  onClose: () => void;
  onImport: (tableName: string, parsed: CsvParseResult) => Promise<void>;
}

export function CsvImportNewTableDialog({ onClose, onImport }: CsvImportNewTableDialogProps) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [tableName, setTableName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsed(null);

    if (file.size > MAX_FILE_SIZE) {
      setError(t('csvImport.fileTooLarge'));
      return;
    }

    const name = file.name.replace(/\.csv$/i, '');
    setTableName(name);

    const reader = new FileReader();
    reader.onerror = () => setError(t('csvImport.parseError'));
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) { setError(t('csvImport.parseError')); return; }

      try {
        const result = parseCsv(text);
        if (result.headers.length === 0 || result.rows.length === 0) {
          setError(t('csvImport.emptyFile'));
          return;
        }
        if (result.rows.length > MAX_ROWS) {
          setError(t('csvImport.tooManyRows'));
          return;
        }
        if (result.headers.length > MAX_COLS) {
          setError(t('csvImport.tooManyColumns'));
          return;
        }
        setParsed(result);
      } catch {
        setError(t('csvImport.parseError'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [t]);

  const handleImport = async () => {
    if (!parsed || !tableName.trim()) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(tableName.trim(), parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('csvImport.createTableFailed'));
      setImporting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">{t('csvImport.title')}</h3>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* File picker */}
            {!parsed && !error && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-border rounded-lg hover:border-sidebar-primary/50 hover:bg-sidebar-primary/5 transition-colors"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Click to select a .csv file</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* Preview */}
            {parsed && (
              <>
                {/* Table name */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t('csvImport.tableName')}</label>
                  <input
                    value={tableName}
                    onChange={e => setTableName(e.target.value)}
                    className="w-full bg-muted rounded px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-sidebar-primary"
                  />
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>{t('csvImport.columns', { n: parsed.headers.length })}</span>
                  <span>·</span>
                  <span>{t('csvImport.rows', { n: parsed.rows.length })}</span>
                </div>

                {/* Preview table */}
                <div className="border border-border rounded-lg overflow-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        {parsed.headers.map((h, i) => (
                          <th key={i} className="px-3 py-1.5 text-left font-medium text-foreground whitespace-nowrap border-b border-border">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rawRows.slice(0, 5).map((row, ri) => (
                        <tr key={ri} className="border-b border-border last:border-0">
                          {parsed.headers.map((_, ci) => (
                            <td key={ci} className="px-3 py-1.5 text-muted-foreground whitespace-nowrap max-w-[200px] truncate">
                              {row[ci] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.rows.length > 5 && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    … and {parsed.rows.length - 5} more rows
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            {error && !parsed && (
              <button
                onClick={() => { setError(null); fileInputRef.current?.click(); }}
                className="mr-auto px-3 py-1.5 text-xs text-sidebar-primary hover:underline"
              >
                Try another file
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded border border-border"
            >
              {t('common.cancel')}
            </button>
            {parsed && (
              <button
                onClick={handleImport}
                disabled={importing || !tableName.trim()}
                className="px-3 py-1.5 text-xs text-white bg-sidebar-primary rounded hover:opacity-90 disabled:opacity-50"
              >
                {importing ? t('csvImport.importing') : t('csvImport.importBtn')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Type check**

Run: `cd /Users/mac/Documents/asuite/shell && npx tsc --noEmit 2>&1 | head -20`
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/table-editor/CsvImportNewTableDialog.tsx
git commit -m "feat: add CsvImportNewTableDialog component"
```

---

### Task 5: Add "Import CSV" to content sidebar menu and wire up the flow

**Files:**
- Modify: `shell/src/components/ContentSidebar.tsx` (~line 1091-1123)
- Modify: `shell/src/app/(workspace)/content/page.tsx` (~line 788-812, ~line 1152)

- [ ] **Step 1: Add import handler to content/page.tsx**

In `shell/src/app/(workspace)/content/page.tsx`:

Add imports at the top:
```ts
import { CsvImportNewTableDialog } from '@/components/table-editor/CsvImportNewTableDialog';
import type { CsvParseResult } from '@/lib/csv-parser';
import * as br from '@/lib/api/tables';
```

Add state near the other dialog states (near `showNewMenu` around line 225):
```ts
const [showCsvImport, setShowCsvImport] = useState(false);
```

Add the import handler function (after `handleCreateByType` around line 924):
```ts
  const handleCsvImport = async (tableName: string, parsed: CsvParseResult) => {
    // 1. Create table with columns
    const columns = parsed.headers.map(h => ({ title: h, uidt: 'SingleLineText' }));
    const item = await gw.createContentItem({
      type: 'table',
      title: tableName,
      columns,
    });

    // 2. Batch insert rows
    if (parsed.rows.length > 0) {
      try {
        await br.batchInsertRows(item.raw_id, parsed.rows);
      } catch (e) {
        const inserted = 0; // Partial failure — table exists but rows may be partial
        throw new Error(t('csvImport.insertRowsFailed', { inserted, total: parsed.rows.length }));
      }
    }

    // 3. Navigate to new table
    await queryClient.invalidateQueries({ queryKey: ['content-items'] });
    const sel = { type: 'table' as const, id: item.raw_id };
    setSelection(sel);
    syncSelectionToURL(sel);
    setMobileView('detail');
    setShowCsvImport(false);
  };
```

Add the dialog render (near the end of the JSX, before the closing fragment or alongside other modals):
```tsx
{showCsvImport && (
  <CsvImportNewTableDialog
    onClose={() => setShowCsvImport(false)}
    onImport={handleCsvImport}
  />
)}
```

Pass `onImportCsv` to ContentSidebar (add to the props being passed around line 1152):
```tsx
onImportCsv={() => { setShowNewMenu(false); setShowCsvImport(true); }}
```

- [ ] **Step 2: Add "Import CSV" button to ContentSidebar menu**

In `shell/src/components/ContentSidebar.tsx`:

Add `Upload` to the lucide-react import (line 1, check if it's already imported):
```ts
import { ..., Upload } from 'lucide-react';
```

Add `onImportCsv` to the component props interface (around line 42):
```ts
  onImportCsv?: () => void;
```

And destructure it in the function params (around line 67):
```ts
  onImportCsv,
```

In the New item menu (around line 1114, after the `CREATE_CONTENT_ITEMS.map(...)` block and before the divider `<div className="border-t ..."`), add:

```tsx
            {onImportCsv && (
              <>
                <div className="border-t border-black/10 dark:border-border my-1" />
                <button
                  onClick={onImportCsv}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                >
                  <Upload className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                  {t('actions.importCSV')}
                </button>
              </>
            )}
```

- [ ] **Step 3: Add `actions.importCSV` i18n key if not already present**

Check: `grep "importCSV" shell/src/lib/i18n/locales/en.json`

If there's no `"importCSV"` under `"actions"`, add it:
- en.json: `"importCSV": "Import CSV",` inside `"actions"`
- zh.json: `"importCSV": "导入 CSV",` inside `"actions"`
- ja.json: `"importCSV": "Import CSV",` inside `"actions"`
- ko.json: `"importCSV": "Import CSV",` inside `"actions"`

Note: There's already `"dataTable.importCSV"` but we need `"actions.importCSV"` for the sidebar menu.

- [ ] **Step 4: Type check**

Run: `cd /Users/mac/Documents/asuite && cd shell && npx tsc --noEmit 2>&1 | head -30`
Expected: No new type errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/ContentSidebar.tsx shell/src/app/\(workspace\)/content/page.tsx
git commit -m "feat: wire CSV import into content sidebar menu"
```

---

### Task 6: Manual verification in browser

**Files:** None (testing only)

- [ ] **Step 1: Build and start the dev server**

```bash
cd /Users/mac/Documents/asuite/shell && npm run dev
```

Or if using pm2:
```bash
cd /Users/mac/Documents/asuite/shell && npm run build && pm2 restart aose-shell
```

- [ ] **Step 2: Prepare a test CSV file**

Create a test file at `/tmp/test-import.csv`:
```csv
Name,Email,City
Alice,alice@example.com,Tokyo
Bob,bob@example.com,London
"Charlie, Jr.",charlie@example.com,"New York"
"Dave ""The Dev""",dave@example.com,Berlin
```

This covers: basic values, commas in quoted fields, double-quote escaping.

- [ ] **Step 3: Test the import flow**

1. Open the app in browser
2. Click the "+" button in the content sidebar to open the New menu
3. Verify "Import CSV" appears below the existing content types
4. Click "Import CSV"
5. Select `/tmp/test-import.csv`
6. Verify the preview shows:
   - Table name: "test-import"
   - 3 columns: Name, Email, City
   - 4 rows
   - Preview table shows first 4 rows with correct data including the quoted fields
7. Click "Import"
8. Verify the new table appears in the content tree
9. Verify clicking on it shows all 4 rows with correct data
10. Verify the table has 3 columns, all SingleLineText

- [ ] **Step 4: Test error cases**

1. Try importing an empty file → should show "file is empty" error
2. Try importing a file > 10MB → should show "file too large" error
3. Try importing without changing the table name → should work fine

- [ ] **Step 5: Test existing CSV import still works**

1. Open an existing table
2. Use the table toolbar's "Import CSV" button
3. Verify column mapping dialog appears and rows can be imported

- [ ] **Step 6: Final commit (if any fixes needed)**

```bash
cd /Users/mac/Documents/asuite
git add -A
git commit -m "fix: address issues found during CSV import testing"
```
