# Excalidraw Board (画板) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third content type "board" (画板) to ASuite, backed by Excalidraw, alongside existing doc and table (Baserow) types.

**Architecture:** Board data is a JSON blob stored directly in Gateway SQLite (no external service needed). The Shell renders boards using `@excalidraw/excalidraw` React component loaded via Next.js dynamic import. The existing `content_items` unified tree model is extended with `type = 'board'`, so sidebar, drag-and-drop, delete/restore all inherit automatically.

**Tech Stack:** @excalidraw/excalidraw v0.18.0, Next.js 14 dynamic import, Gateway SQLite (better-sqlite3), React 18

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `gateway/init-db.sql` | Modify | Add `boards` table schema |
| `gateway/server.js` | Modify | Add board CRUD endpoints + extend content-items to accept `type: 'board'` + board cleanup on permanent delete |
| `shell/src/components/board-editor/BoardEditor.tsx` | Create | Excalidraw wrapper component with auto-save |
| `shell/src/lib/api/gateway.ts` | Modify | Add `getBoard()`, `saveBoard()` API functions + extend `createContentItem` type union |
| `shell/src/app/(workspace)/content/page.tsx` | Modify | Add board rendering branch, board creation handler, board icon, update types |
| `shell/src/lib/i18n/locales/en.json` | Modify | Add `newBoard`, `untitledBoard` keys |
| `shell/src/lib/i18n/locales/zh.json` | Modify | Add `newBoard`, `untitledBoard` keys |
| `shell/src/lib/i18n/locales/ja.json` | Modify | Add `newBoard`, `untitledBoard` keys |
| `shell/src/lib/i18n/locales/ko.json` | Modify | Add `newBoard`, `untitledBoard` keys |
| `shell/package.json` | Modify | Add `@excalidraw/excalidraw` dependency |

---

### Task 1: Gateway — boards table + migration

**Files:**
- Modify: `gateway/init-db.sql`
- Modify: `gateway/server.js` (migration section, lines ~40-90)

- [ ] **Step 1: Add boards table to init-db.sql**

Add at the end of `init-db.sql`, before the closing line:

```sql
-- Boards (Excalidraw drawings stored as JSON)
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  data_json   TEXT NOT NULL DEFAULT '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}',
  created_by  TEXT,
  updated_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

- [ ] **Step 2: Add migration in server.js**

In the migration section of `server.js` (around line 59, after the existing `try { db.exec('ALTER TABLE ...') }` blocks), add:

```js
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
```

- [ ] **Step 3: Restart Gateway to verify migration**

Run:
```bash
cd /Users/mac/Documents/asuite/gateway && pm2 restart asuite-gateway
```
Expected: Gateway restarts without errors. Check logs:
```bash
pm2 logs asuite-gateway --lines 5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/mac/Documents/asuite
git add gateway/init-db.sql gateway/server.js
git commit -m "feat: add boards table for Excalidraw drawings"
```

---

### Task 2: Gateway — board CRUD API endpoints

**Files:**
- Modify: `gateway/server.js`

These endpoints go near the existing doc/table endpoints (around line 2830, before the content-items section).

- [ ] **Step 1: Add board CRUD endpoints**

Add these three endpoints in `server.js`:

```js
// ─── Boards (Excalidraw) ─────────────────────────
// API: create a board
app.post('/api/boards', authenticateAgent, (req, res) => {
  const { title = '' } = req.body;
  const id = crypto.randomUUID();
  const now = Date.now();
  const agentName = req.agent?.name || null;
  const defaultData = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'asuite',
    elements: [],
    appState: {},
    files: {},
  });

  db.prepare(`INSERT INTO boards (id, data_json, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

  // Create content_item entry
  const nodeId = `board:${id}`;
  const isoNow = new Date().toISOString();
  contentItemsUpsert.run(
    nodeId, id, 'board', title || '',
    null, req.body.parent_id || null, null,
    agentName, agentName, isoNow, isoNow, null, Date.now()
  );

  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
  res.status(201).json({ board_id: id, item });
});

// API: get board data
app.get('/api/boards/:id', authenticateAgent, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({
    id: board.id,
    data: JSON.parse(board.data_json),
    created_by: board.created_by,
    updated_by: board.updated_by,
    created_at: board.created_at,
    updated_at: board.updated_at,
  });
});

// API: save board data (auto-save from frontend)
app.patch('/api/boards/:id', authenticateAgent, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'NOT_FOUND' });

  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'MISSING_DATA' });

  const now = Date.now();
  const agentName = req.agent?.name || null;
  db.prepare('UPDATE boards SET data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(data), agentName, now, req.params.id);

  res.json({ saved: true, updated_at: now });
});
```

- [ ] **Step 2: Extend content-items POST to accept type 'board'**

In the `POST /api/content-items` handler (line ~2833), change the type validation from:

```js
if (!type || !['doc', 'table'].includes(type)) {
    return res.status(400).json({ error: 'INVALID_TYPE', message: 'type must be "doc" or "table"' });
}
```

to:

```js
if (!type || !['doc', 'table', 'board'].includes(type)) {
    return res.status(400).json({ error: 'INVALID_TYPE', message: 'type must be "doc", "table", or "board"' });
}
```

Then add a `board` handler block after the `if (type === 'table')` block (before the closing of the handler):

```js
  if (type === 'board') {
    const id = crypto.randomUUID();
    const now = Date.now();
    const isoNow = new Date().toISOString();
    const agentName = req.agent?.name || null;
    const defaultData = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'asuite',
      elements: [],
      appState: {},
      files: {},
    });

    db.prepare(`INSERT INTO boards (id, data_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, defaultData, agentName, agentName, now, now);

    const nodeId = `board:${id}`;
    contentItemsUpsert.run(
      nodeId, id, 'board', title || '',
      null, parent_id, null,
      agentName, agentName, isoNow, isoNow, null, Date.now()
    );

    const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(nodeId);
    return res.status(201).json({ item });
  }
```

- [ ] **Step 3: Extend soft-delete to handle boards**

In the `DELETE /api/content-items/:id` handler (line ~2987), after the `else if (item.type === 'table')` block, add:

```js
  else if (item.type === 'board') {
    // Soft-delete only — board data preserved until permanent delete
    db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, req.params.id);
  }
```

- [ ] **Step 4: Extend permanent delete to handle boards**

In the `DELETE /api/content-items/:id/permanent` handler (line ~3024), after the `else if (item.type === 'table')` block, add:

```js
  else if (item.type === 'board') {
    db.prepare('DELETE FROM boards WHERE id = ?').run(item.raw_id);
  }
```

- [ ] **Step 5: Extend restore to handle boards**

In the `POST /api/content-items/:id/restore` handler (line ~3005), after the doc restore block, the existing code already handles tables with a comment "Tables: nothing to do in Baserow". Add after that:

```js
  // Boards: nothing to do (data was never deleted)
```

(No code change needed — boards restore just like tables by clearing `deleted_at`.)

- [ ] **Step 6: Handle boards in descendant soft-delete**

In the `DELETE /api/content-items/:id` handler's mode==='all' loop (line ~2960-2967), the loop already soft-deletes descendants. After `if (desc.type === 'doc')` and the existing `// Tables: just soft-delete` comment, boards are already covered since the loop does `db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, desc.id)` for all descendants regardless of type. No change needed.

- [ ] **Step 7: Restart Gateway and test**

```bash
pm2 restart asuite-gateway && sleep 1 && pm2 logs asuite-gateway --lines 5
```

Test with curl:
```bash
TOKEN=$(cat /Users/mac/Documents/asuite/adapters/zylos/config-zylos-thinker.json | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).agent_token)")
# Create a board
curl -s -X POST http://localhost:4000/api/boards -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Test Board"}'
```
Expected: 201 response with `board_id` and `item` containing `type: 'board'`

- [ ] **Step 8: Commit**

```bash
cd /Users/mac/Documents/asuite
git add gateway/server.js
git commit -m "feat: board CRUD API + content-items board type support"
```

---

### Task 3: Shell — install Excalidraw + gateway API functions

**Files:**
- Modify: `shell/package.json` (via npm install)
- Modify: `shell/src/lib/api/gateway.ts`

- [ ] **Step 1: Install @excalidraw/excalidraw**

```bash
cd /Users/mac/Documents/asuite/shell && npm install @excalidraw/excalidraw@0.18.0
```

- [ ] **Step 2: Add board API functions to gateway.ts**

In `shell/src/lib/api/gateway.ts`, add these functions (after the existing `createContentItem` function):

```ts
// ─── Boards (Excalidraw) ─────────────────────────
export async function getBoard(boardId: string): Promise<{
  id: string;
  data: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
}> {
  return gwFetch(`/boards/${boardId}`);
}

export async function saveBoard(boardId: string, data: Record<string, unknown>): Promise<{ saved: boolean; updated_at: number }> {
  return gwFetch(`/boards/${boardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}
```

- [ ] **Step 3: Extend createContentItem type union**

Change the `createContentItem` function's type parameter from:

```ts
  type: 'doc' | 'table';
```

to:

```ts
  type: 'doc' | 'table' | 'board';
```

- [ ] **Step 4: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/package.json shell/package-lock.json shell/src/lib/api/gateway.ts
git commit -m "feat: install excalidraw + add board API client functions"
```

---

### Task 4: Shell — BoardEditor component

**Files:**
- Create: `shell/src/components/board-editor/BoardEditor.tsx`

- [ ] **Step 1: Create the BoardEditor component**

Create `shell/src/components/board-editor/BoardEditor.tsx`:

```tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import { ArrowLeft, Maximize2, Minimize2, ArrowLeftToLine, ArrowRightToLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

// Excalidraw is client-only (no SSR) — dynamically imported in the component
let ExcalidrawComponent: React.ComponentType<any> | null = null;
let excalidrawLoaded = false;

function loadExcalidraw() {
  if (excalidrawLoaded) return Promise.resolve();
  return import('@excalidraw/excalidraw').then((mod) => {
    ExcalidrawComponent = mod.Excalidraw;
    excalidrawLoaded = true;
  });
}

interface BoardEditorProps {
  boardId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}

export function BoardEditor({
  boardId,
  breadcrumb,
  onBack,
  onDeleted,
  onCopyLink,
  docListVisible,
  onToggleDocList,
}: BoardEditorProps) {
  const { t } = useT();
  const [ready, setReady] = useState(excalidrawLoaded);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const excalidrawApiRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load Excalidraw module
  useEffect(() => {
    if (!excalidrawLoaded) {
      loadExcalidraw().then(() => setReady(true));
    }
  }, []);

  // Fetch board data
  const { data: board, isLoading } = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => gw.getBoard(boardId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Auto-save on change (debounced 800ms)
  const handleChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const data = {
          type: 'excalidraw',
          version: 2,
          source: 'asuite',
          elements: elements.filter((el: any) => !el.isDeleted),
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            gridSize: appState.gridSize,
          },
          files: files || {},
        };
        gw.saveBoard(boardId, data).catch((err) => {
          console.error('Board auto-save failed:', err);
        });
      }, 800);
    },
    [boardId],
  );

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Listen for fullscreen exit via Escape
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  if (isLoading || !ready) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">{t('common.loading') || 'Loading...'}</div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">Board not found</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0 bg-white dark:bg-card">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        {/* Mobile back */}
        <button onClick={onBack} className="md:hidden p-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Toggle sidebar */}
        {onToggleDocList && (
          <button
            onClick={onToggleDocList}
            className="hidden md:flex p-1 text-muted-foreground hover:text-foreground"
            title={docListVisible ? 'Hide sidebar' : 'Show sidebar'}
          >
            {docListVisible ? <ArrowLeftToLine className="h-4 w-4" /> : <ArrowRightToLine className="h-4 w-4" />}
          </button>
        )}

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground truncate flex-1 min-w-0">
          {breadcrumb?.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/50">/</span>}
              <span className={i === (breadcrumb.length - 1) ? 'text-foreground font-medium' : ''}>
                {crumb.title || (t('content.untitledBoard') || 'Untitled Board')}
              </span>
            </span>
          ))}
        </div>

        {/* Fullscreen toggle */}
        <button
          onClick={toggleFullscreen}
          className="p-1 text-muted-foreground hover:text-foreground"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Excalidraw canvas */}
      <div className="flex-1 min-h-0">
        {ExcalidrawComponent && (
          <ExcalidrawComponent
            initialData={board.data}
            onChange={handleChange}
            excalidrawAPI={(api: any) => { excalidrawApiRef.current = api; }}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                export: { saveFileToDisk: true },
              },
            }}
            theme={
              typeof window !== 'undefined' &&
              document.documentElement.classList.contains('dark')
                ? 'dark'
                : 'light'
            }
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component file was created**

```bash
ls -la /Users/mac/Documents/asuite/shell/src/components/board-editor/BoardEditor.tsx
```

- [ ] **Step 3: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/board-editor/BoardEditor.tsx
git commit -m "feat: BoardEditor component with Excalidraw + auto-save"
```

---

### Task 5: Shell — i18n keys for board

**Files:**
- Modify: `shell/src/lib/i18n/locales/en.json`
- Modify: `shell/src/lib/i18n/locales/zh.json`
- Modify: `shell/src/lib/i18n/locales/ja.json`
- Modify: `shell/src/lib/i18n/locales/ko.json`

- [ ] **Step 1: Add i18n keys to all locale files**

In each locale file, in the `content` section (after `"newTable"` and near `"untitledTable"`), add:

**en.json:**
```json
"newBoard": "New Board",
"untitledBoard": "Untitled Board",
```

**zh.json:**
```json
"newBoard": "新建画板",
"untitledBoard": "无标题画板",
```

**ja.json:**
```json
"newBoard": "新規ボード",
"untitledBoard": "無題ボード",
```

**ko.json:**
```json
"newBoard": "새 보드",
"untitledBoard": "제목 없는 보드",
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/lib/i18n/locales/*.json
git commit -m "feat: add board i18n keys (en/zh/ja/ko)"
```

---

### Task 6: Shell — integrate board into content page

**Files:**
- Modify: `shell/src/app/(workspace)/content/page.tsx`

This is the largest task. It touches types, creation handler, rendering branch, sidebar icons, and "new" menu.

- [ ] **Step 1: Add imports**

At the top of `page.tsx`, add:

After the `TableEditor` import (line 15):
```tsx
import { BoardEditor } from '@/components/board-editor/BoardEditor';
```

Add `PenTool` (or `Pencil`) to the lucide-react import (line 6). Change it to include `Pencil`:
```tsx
import { FileText, Table2, Pencil, Plus, ArrowLeft, ... } from 'lucide-react';
```

- [ ] **Step 2: Update types**

Change the `ContentNode` type's `type` field (line 48):
```ts
type: 'doc' | 'table' | 'board';
```

Change the `Selection` type (line 56):
```ts
type Selection = { type: 'doc'; id: string } | { type: 'table'; id: string } | { type: 'board'; id: string } | null;
```

- [ ] **Step 3: Add selectedBoardId**

After `const selectedTableId = ...` (line 226), add:
```ts
const selectedBoardId = selection?.type === 'board' ? selection.id : null;
```

- [ ] **Step 4: Update nodeMap title fallback**

In the `nodeMap` useMemo (line 244), change:
```ts
title: item.title || (item.type === 'doc' ? t('content.untitled') : t('content.untitledTable')),
```
to:
```ts
title: item.title || (item.type === 'doc' ? t('content.untitled') : item.type === 'table' ? t('content.untitledTable') : t('content.untitledBoard')),
```

- [ ] **Step 5: Add handleCreateBoard function**

After `handleCreateTable` (around line 543), add:

```ts
  const handleCreateBoard = async (parentNodeId?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const item = await gw.createContentItem({
        type: 'board',
        title: '',
        parent_id: parentNodeId || null,
      });
      if (parentNodeId) {
        setExpandedIds(prev => new Set(prev).add(parentNodeId));
      }
      await queryClient.invalidateQueries({ queryKey: ['content-items'] });
      const sel = { type: 'board' as const, id: item.raw_id };
      setSelection(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      console.error('Create board failed:', e);
    } finally {
      setCreating(false);
    }
  };
```

- [ ] **Step 6: Add "New Board" button to header new menu**

In the new-item dropdown (after the "New Table" button around line 853), add:

```tsx
                    <button
                      onClick={() => { setShowNewMenu(false); handleCreateBoard(); }}
                      disabled={creating}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                      {t('content.newBoard')}
                    </button>
```

- [ ] **Step 7: Add board rendering branch in detail area**

In the detail area (around line 1012-1059), change the ternary chain. Currently it's:

```tsx
{selectedDoc && selection?.type === 'doc' ? (
  <DocPanel ... />
) : selectedTableId ? (
  <TableEditor ... />
) : (
  <div>...empty state...</div>
)}
```

Change to:

```tsx
{selectedDoc && selection?.type === 'doc' ? (
  <DocPanel ... />
) : selectedTableId ? (
  <TableEditor ... />
) : selectedBoardId ? (
  <BoardEditor
    boardId={selectedBoardId}
    breadcrumb={(() => {
      const path: { id: string; title: string }[] = [];
      let nodeId: string | null = `board:${selectedBoardId}`;
      while (nodeId) {
        const node = effectiveNodes.get(nodeId);
        if (!node) break;
        path.unshift({ id: node.rawId, title: node.title });
        nodeId = node.parentId;
      }
      return path;
    })()}
    onBack={() => setMobileView('list')}
    onDeleted={() => {
      setSelection(null); setMobileView('list');
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    }}
    onCopyLink={() => {
      navigator.clipboard.writeText(buildContentLink({ type: 'board', id: selectedBoardId }));
    }}
    docListVisible={docListVisible}
    onToggleDocList={() => setDocListVisible(v => !v)}
  />
) : (
  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
    <div className="flex gap-3 mb-2">
      <FileText className="h-8 w-8 opacity-20" />
      <Table2 className="h-8 w-8 opacity-20" />
      <Pencil className="h-8 w-8 opacity-20" />
    </div>
    <p className="text-sm">{t('content.selectHint')}</p>
    <p className="text-xs text-muted-foreground/50">{t('content.createHint')}</p>
  </div>
)}
```

- [ ] **Step 8: Update tree node icon rendering**

In the `DraggableTreeNode` component's icon section (around line 1313-1315), change:

```tsx
) : node.type === 'table'
  ? <Table2 className={cn('h-4 w-4', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
  : <FileText className={cn('h-4 w-4', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
```

to:

```tsx
) : node.type === 'table'
  ? <Table2 className={cn('h-4 w-4', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
  : node.type === 'board'
  ? <Pencil className={cn('h-4 w-4', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
  : <FileText className={cn('h-4 w-4', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
```

- [ ] **Step 9: Add "New Board" to tree node add-child menu**

In the `DraggableTreeNode` add-child dropdown (after the "New Table" button around line 1367), add:

```tsx
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); onCreateChild('board'); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('content.newBoard')}
                  </button>
```

- [ ] **Step 10: Update onCreateChild type**

In the `DraggableTreeNode` component, change `onCreateChild` prop type (line ~1198):

```ts
onCreateChild: (type: 'doc' | 'table') => void;
```

to:

```ts
onCreateChild: (type: 'doc' | 'table' | 'board') => void;
```

And in `TreeNodeRecursive`, update the `onCreateChild` callback (around line 1147-1149) to handle 'board':

```ts
onCreateChild={(type) => {
  if (type === 'doc') onCreateDoc(nodeId);
  else if (type === 'table') onCreateTable(nodeId);
  else onCreateBoard(nodeId);
}}
```

This means `TreeNodeRecursive` also needs `onCreateBoard` prop. Add it:

In the `TreeNodeRecursive` props interface (line ~1107), add `onCreateBoard`:
```ts
onCreateDoc, onCreateTable, onCreateBoard, onRequestDelete, depth, creating, dropIntent, dragActiveId,
```

In the type definition:
```ts
onCreateBoard: (parentId?: string) => void;
```

And pass it down recursively (line ~1168):
```tsx
onCreateBoard={onCreateBoard}
```

Where `TreeNodeRecursive` is called from the main component (line ~918), add:
```tsx
onCreateBoard={handleCreateBoard}
```

- [ ] **Step 11: Update DragOverlay icon**

In the DragOverlay section (around line 931), where it shows the type icon for the dragged item, add board support:

Find:
```tsx
{dragActiveNode.type === 'table'
```

Add after the table icon case, a board case using Pencil icon. The exact code depends on the existing ternary structure — follow the same pattern as table vs doc.

- [ ] **Step 12: Update buildContentLink for boards**

Find `buildContentLink` function and ensure it handles `type: 'board'`. If it constructs URLs based on type, add the board case.

- [ ] **Step 13: Build and test**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
```

Expected: Build succeeds without errors.

Then restart:
```bash
pm2 restart asuite-shell
```

- [ ] **Step 14: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/app/\(workspace\)/content/page.tsx
git commit -m "feat: integrate board type into content page (sidebar, creation, rendering)"
```

---

### Task 7: Verification — end-to-end test in browser

- [ ] **Step 1: Verify Gateway is running**

```bash
curl -s http://localhost:4000/api/me -H "Authorization: Bearer $(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/Users/mac/Documents/asuite/adapters/zylos/config-zylos-thinker.json','utf8')).agent_token)")" | head -c 200
```

Expected: Agent info JSON response.

- [ ] **Step 2: Verify Shell build succeeded**

```bash
pm2 status asuite-shell
```

Expected: status `online`.

- [ ] **Step 3: Test board creation via API**

```bash
TOKEN=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/Users/mac/Documents/asuite/adapters/zylos/config-zylos-thinker.json','utf8')).agent_token)")
curl -s -X POST http://localhost:4000/api/content-items -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"type":"board","title":"Test Excalidraw Board"}'
```

Expected: 201 with `item.type === 'board'`

- [ ] **Step 4: Test board data retrieval**

```bash
# Use the board ID from step 3
BOARD_ID=<from-step-3>
curl -s http://localhost:4000/api/boards/$BOARD_ID -H "Authorization: Bearer $TOKEN"
```

Expected: JSON with empty Excalidraw data structure.

- [ ] **Step 5: Manual browser test**

Open `http://localhost:3101` in browser. Navigate to Content section. Click "+" → "New Board". Verify:
1. Board appears in sidebar with pencil icon
2. Excalidraw canvas loads in the main area
3. Drawing on the canvas works
4. After drawing, wait 1 second, refresh — drawing persists (auto-save worked)
5. Board can be renamed via sidebar
6. Board can be dragged to reorder
7. Board can be deleted and restored from trash

- [ ] **Step 6: Report to moonyaan**

Send confirmation message via Telegram with the test results.
