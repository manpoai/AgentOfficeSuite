# RichTable Shared Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the table editing experience across Docs, PPT, and Diagram editors with one shared RichTable engine, unified FloatingToolbar, and fix table attribute persistence.

**Architecture:** RichTable's ProseMirror schema is upgraded to match Docs editor's table capabilities (marks, cell attributes). Docs keeps native ProseMirror table nodes; PPT/Diagram use standalone RichTable instances in DOM overlays. All scenarios use the unified FloatingToolbar for table cell formatting. Markdown serialization is extended to persist colwidth/background/merge via HTML table fallback.

**Tech Stack:** ProseMirror, prosemirror-tables, React, Next.js, Fabric.js (PPT), AntV X6 (Diagram)

**Spec:** `docs/superpowers/specs/2026-04-01-richtable-shared-component-design.md`

---

## File Structure

| File | Role |
|------|------|
| `shell/src/components/shared/RichTable/index.tsx` | Modify: upgrade schema, add `onCellToolbar` prop |
| `shell/src/components/shared/RichTable/types.ts` | Modify: add `onCellToolbar` to props |
| `shell/src/components/shared/RichTable/TableToolbar.tsx` | Delete |
| `shell/src/components/shared/RichTable/adapters/FabricOverlay.tsx` | Delete |
| `shell/src/components/shared/RichTable/adapters/X6Overlay.tsx` | Delete |
| `shell/src/components/shared/MobileToolbar.tsx` | Delete |
| `shell/src/components/editor/markdown.ts` | Modify: HTML table serialization + parsing for colwidth/bg/merge |
| `shell/src/components/presentation-editor/PresentationEditor.tsx` | Modify: upgrade PPTTableOverlay data model + FloatingToolbar |
| `shell/src/components/diagram-editor/X6DiagramEditor.tsx` | Modify: add table feature (insertion + overlay + FloatingToolbar) |
| `shell/src/components/diagram-editor/components/LeftToolbar.tsx` | Modify: add Table tool button |
| `shell/src/app/(workspace)/content/page.tsx` | Modify: remove MobileToolbar |

---

### Task 1: Cleanup — Delete unused files

**Files:**
- Delete: `shell/src/components/shared/RichTable/TableToolbar.tsx`
- Delete: `shell/src/components/shared/RichTable/adapters/FabricOverlay.tsx`
- Delete: `shell/src/components/shared/RichTable/adapters/X6Overlay.tsx`
- Delete: `shell/src/components/shared/MobileToolbar.tsx`
- Modify: `shell/src/app/(workspace)/content/page.tsx`
- Modify: `shell/src/components/diagram-editor/X6DiagramEditor.tsx`

- [ ] **Step 1: Delete unused files**

```bash
cd /Users/mac/Documents/asuite/shell/src/components
rm shared/RichTable/TableToolbar.tsx
rm shared/RichTable/adapters/FabricOverlay.tsx
rm shared/RichTable/adapters/X6Overlay.tsx
rm shared/MobileToolbar.tsx
```

- [ ] **Step 2: Remove MobileToolbar from content/page.tsx**

In `shell/src/app/(workspace)/content/page.tsx`:

Remove the import line:
```typescript
import { MobileToolbar } from '@/components/shared/MobileToolbar';
```

Remove the `mobileToolbarItems` useMemo block (lines ~2259-2290):
```typescript
  // Mobile toolbar items for doc editing
  const mobileToolbarItems = useMemo(() => [
    // ... all items ...
  ], [toggleMarkInView, isMarkActiveInView, toggleHeading, isHeadingActive, toggleBulletList, isBulletListActive]);
```

Remove the MobileToolbar JSX (inside the `{isMobile && (` block):
```tsx
        <MobileToolbar
          items={mobileToolbarItems}
          visible={mobileEditMode}
        />
```

Also remove any now-unused imports that were only used by `mobileToolbarItems` (check if `toggleMarkInView`, `isMarkActiveInView`, `toggleHeading`, `isHeadingActive`, `toggleBulletList`, `isBulletListActive` are used elsewhere — if not, remove their definitions too).

- [ ] **Step 3: Remove MobileToolbar import from X6DiagramEditor.tsx**

In `shell/src/components/diagram-editor/X6DiagramEditor.tsx`, remove:
```typescript
import { MobileToolbar } from '@/components/shared/MobileToolbar';
```
And remove any `<MobileToolbar ... />` JSX usage if present.

- [ ] **Step 4: Verify build**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
```

Expected: Build succeeds with no errors related to deleted files.

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Documents/asuite
git add -A shell/src/components/shared/RichTable/TableToolbar.tsx \
  shell/src/components/shared/RichTable/adapters/FabricOverlay.tsx \
  shell/src/components/shared/RichTable/adapters/X6Overlay.tsx \
  shell/src/components/shared/MobileToolbar.tsx \
  shell/src/app/\(workspace\)/content/page.tsx \
  shell/src/components/diagram-editor/X6DiagramEditor.tsx
git commit -m "cleanup: remove TableToolbar, unused overlays, and MobileToolbar"
```

---

### Task 2: Upgrade RichTable schema and add onCellToolbar prop

**Files:**
- Modify: `shell/src/components/shared/RichTable/types.ts`
- Modify: `shell/src/components/shared/RichTable/index.tsx`

- [ ] **Step 1: Add onCellToolbar to RichTableProps in types.ts**

In `shell/src/components/shared/RichTable/types.ts`, add to the `RichTableProps` interface after the `height` field:

```typescript
  /** Callback for FloatingToolbar integration — emits cell selection info */
  onCellToolbar?: (info: { anchor: { top: number; left: number; width: number }; view: any } | null) => void;
```

- [ ] **Step 2: Upgrade createTableSchema in index.tsx**

In `shell/src/components/shared/RichTable/index.tsx`, update the `createTableSchema()` function's `marks` section. Replace the existing marks object:

```typescript
    marks: {
      strong: {
        parseDOM: [
          { tag: 'strong' },
          { tag: 'b' },
          {
            style: 'font-weight',
            getAttrs: (value: unknown) =>
              /^(bold|[7-9]\d{2,})$/.test(value as string) && null,
          },
        ],
        toDOM() {
          return ['strong', 0];
        },
      },
      em: {
        parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
        toDOM() {
          return ['em', 0];
        },
      },
      underline: {
        parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
        toDOM() {
          return ['u', 0];
        },
      },
      strikethrough: {
        parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
        toDOM() {
          return ['s', 0];
        },
      },
      highlight: {
        attrs: { color: { default: null } },
        parseDOM: [
          {
            tag: 'mark',
            getAttrs(dom: HTMLElement) {
              return { color: dom.getAttribute('data-color') || dom.style.backgroundColor || null };
            },
          },
        ],
        toDOM(mark: any) {
          const attrs: Record<string, string> = {};
          if (mark.attrs.color) {
            attrs.style = `background-color: ${mark.attrs.color}`;
            attrs['data-color'] = mark.attrs.color;
          }
          return ['mark', attrs, 0];
        },
      },
    },
```

- [ ] **Step 3: Wire onCellToolbar to table-menu-plugin in index.tsx**

In `shell/src/components/shared/RichTable/index.tsx`, update the component to accept and forward `onCellToolbar`.

In the destructured props of the `RichTable` component (inside `forwardRef`), add `onCellToolbar`:

```typescript
    {
      data,
      prosemirrorJSON,
      onChange,
      onProsemirrorChange,
      onCellToolbar,
      config: userConfig,
      className,
      width,
      height,
    },
```

Store it in a ref (add after the existing `onPmChangeRef`):

```typescript
    const onCellToolbarRef = useRef(onCellToolbar);
    onCellToolbarRef.current = onCellToolbar;
```

Update the table-menu-plugin instantiation. Find the line:

```typescript
        if (!config.readonly) {
          plugins.push(tableMenuPlugin());
        }
```

Replace with:

```typescript
        if (!config.readonly) {
          plugins.push(tableMenuPlugin(
            onCellToolbarRef.current
              ? (info: any) => onCellToolbarRef.current?.(info)
              : undefined
          ));
        }
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/RichTable/types.ts \
  shell/src/components/shared/RichTable/index.tsx
git commit -m "feat(RichTable): upgrade schema with strikethrough/highlight marks and add onCellToolbar prop"
```

---

### Task 3: Fix Docs table colwidth/background/merge persistence

**Files:**
- Modify: `shell/src/components/editor/markdown.ts`

This is the hardest technical task. The markdown serializer currently outputs GFM markdown tables which cannot represent `colwidth`, `background`, `colspan`, or `rowspan`. We add an HTML table fallback.

- [ ] **Step 1: Add HTML table detection helper**

In `shell/src/components/editor/markdown.ts`, find the `table(state, node)` serializer function (around line 665). Add this helper function at the very beginning of the `table()` function body, before `function serializeInline`:

```typescript
      // Check if table has any attributes that GFM markdown can't represent
      function needsHtmlTable(tableNode: PMNode): boolean {
        let needs = false;
        tableNode.forEach((row) => {
          row.forEach((cell) => {
            if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) needs = true;
            if (cell.attrs.background) needs = true;
            if (cell.attrs.colwidth && cell.attrs.colwidth.some((w: number) => w > 0)) needs = true;
          });
        });
        return needs;
      }
```

- [ ] **Step 2: Add HTML table serializer**

Still inside the `table(state, node)` function, add this function after `needsHtmlTable`:

```typescript
      function serializeHtmlTable(tableNode: PMNode) {
        // Collect column widths from first row
        const firstRow = tableNode.child(0);
        const colWidths: (number | null)[] = [];
        firstRow.forEach((cell) => {
          const cw = cell.attrs.colwidth;
          if (cw && Array.isArray(cw)) {
            cw.forEach((w: number) => colWidths.push(w > 0 ? w : null));
          } else {
            for (let c = 0; c < (cell.attrs.colspan || 1); c++) colWidths.push(null);
          }
        });

        let html = '<table>\n';

        // Colgroup for widths
        if (colWidths.some((w) => w !== null)) {
          html += '<colgroup>';
          for (const w of colWidths) {
            html += w ? `<col style="width: ${w}px" />` : '<col />';
          }
          html += '</colgroup>\n';
        }

        tableNode.forEach((row) => {
          html += '<tr>';
          row.forEach((cell) => {
            const isHeader = cell.type.name === 'table_header';
            const tag = isHeader ? 'th' : 'td';
            const attrs: string[] = [];
            if (cell.attrs.colspan > 1) attrs.push(`colspan="${cell.attrs.colspan}"`);
            if (cell.attrs.rowspan > 1) attrs.push(`rowspan="${cell.attrs.rowspan}"`);
            const styles: string[] = [];
            if (cell.attrs.background) styles.push(`background-color: ${cell.attrs.background}`);
            if (cell.attrs.alignment) styles.push(`text-align: ${cell.attrs.alignment}`);
            if (styles.length) attrs.push(`style="${styles.join('; ')}"`);

            const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
            const content = serializeBlocks(cell);
            html += `<${tag}${attrStr}>${content}</${tag}>`;
          });
          html += '</tr>\n';
        });

        html += '</table>\n\n';
        state.write(html);
      }
```

- [ ] **Step 3: Add HTML table dispatch at the top of the existing table serializer**

Find the line `const rows: string[][] = [];` (around line 767). Insert before it:

```typescript
      // Use HTML table if any cell has attributes that GFM can't represent
      if (needsHtmlTable(node)) {
        serializeHtmlTable(node);
        return;
      }
```

- [ ] **Step 4: Add HTML table parser — extend the markdown-it HTML block handler**

The markdown-it instance is configured with `html: true` (line 118), so `<table>` HTML blocks pass through as `html_block` tokens. Currently `html_block` tokens are ignored (line 567: `html_block: { ignore: true, noCloseToken: true }`).

We need a core rule that converts `html_block` tokens containing `<table>` into proper table tokens.

Add this function before the `export function parseMarkdown` function:

```typescript
/**
 * Core rule: convert html_block tokens containing <table> into
 * proper table/tr/th/td tokens so ProseMirror can parse them.
 * Extracts style attributes (background-color, text-align) and
 * col widths into token attrs.
 */
function htmlTableRule(state: any) {
  const tokens = state.tokens;
  const newTokens: typeof tokens = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'html_block' || !/<table[\s>]/i.test(tok.content)) {
      newTokens.push(tok);
      continue;
    }

    // Parse the HTML table
    const parser = new DOMParser();
    const doc = parser.parseFromString(tok.content, 'text/html');
    const table = doc.querySelector('table');
    if (!table) { newTokens.push(tok); continue; }

    // Extract col widths from <colgroup>
    const colWidths: (number | null)[] = [];
    table.querySelectorAll('colgroup col').forEach((col) => {
      const style = (col as HTMLElement).style.width;
      const match = style?.match(/(\d+)px/);
      colWidths.push(match ? parseInt(match[1], 10) : null);
    });

    // table_open
    const tableOpen = new state.Token('table_open', 'table', 1);
    tableOpen.block = true;
    newTokens.push(tableOpen);

    let colIdx = 0;
    table.querySelectorAll('tr').forEach((tr) => {
      const rowOpen = new state.Token('tr_open', 'tr', 1);
      rowOpen.block = true;
      newTokens.push(rowOpen);

      let cellColIdx = colIdx;
      tr.querySelectorAll('th, td').forEach((cell) => {
        const isHeader = cell.tagName.toLowerCase() === 'th';
        const tag = isHeader ? 'th' : 'td';
        const cellOpen = new state.Token(`${tag}_open`, tag, 1);
        cellOpen.block = true;

        // Extract attributes
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
        const bg = (cell as HTMLElement).style.backgroundColor || null;
        const align = (cell as HTMLElement).style.textAlign || null;

        // Build colwidth array for this cell
        const cw: number[] = [];
        for (let c = 0; c < colspan; c++) {
          cw.push(colWidths[cellColIdx + c] || 0);
        }
        cellColIdx += colspan;

        cellOpen.attrs = [];
        if (colspan > 1) cellOpen.attrs.push(['colspan', String(colspan)]);
        if (rowspan > 1) cellOpen.attrs.push(['rowspan', String(rowspan)]);
        if (bg) cellOpen.attrs.push(['data-background', bg]);
        if (align) cellOpen.attrs.push(['data-alignment', align]);
        if (cw.some((w) => w > 0)) cellOpen.attrs.push(['data-colwidth', JSON.stringify(cw)]);

        newTokens.push(cellOpen);

        // Cell content as inline token
        const content = cell.innerHTML.trim();
        if (content) {
          const pOpen = new state.Token('paragraph_open', 'p', 1);
          pOpen.block = true;
          newTokens.push(pOpen);

          const inline = new state.Token('inline', '', 0);
          inline.content = cell.textContent || '';
          inline.children = [];
          // Re-parse inline content through markdown-it
          state.md.inline.parse(inline.content, state.md, state.env, inline.children);
          newTokens.push(inline);

          const pClose = new state.Token('paragraph_close', 'p', -1);
          pClose.block = true;
          newTokens.push(pClose);
        }

        const cellClose = new state.Token(`${tag}_close`, tag, -1);
        cellClose.block = true;
        newTokens.push(cellClose);
      });

      const rowClose = new state.Token('tr_close', 'tr', -1);
      rowClose.block = true;
      newTokens.push(rowClose);
    });

    const tableClose = new state.Token('table_close', 'table', -1);
    tableClose.block = true;
    newTokens.push(tableClose);
  }

  state.tokens = newTokens;
}
```

Register the rule after the existing markdown-it plugins. Find the line `md.use(htmlImgPlugin);` and add after it:

```typescript
md.core.ruler.after('text_join', 'html_table_parse', htmlTableRule);
```

- [ ] **Step 5: Update table token handler to extract cell attributes**

The existing token handlers in `prosemirrorTokenHandlers` (around line 557-562) need to extract attributes from the HTML table tokens we created. Update the `th` and `td` handlers:

Replace:
```typescript
  th: { block: 'table_header' },
  td: { block: 'table_cell' },
```

With:
```typescript
  th: {
    block: 'table_header',
    getAttrs(tok: any) {
      const attrs: Record<string, unknown> = {};
      if (tok.attrs) {
        for (const [key, val] of tok.attrs) {
          if (key === 'colspan') attrs.colspan = parseInt(val, 10);
          if (key === 'rowspan') attrs.rowspan = parseInt(val, 10);
          if (key === 'data-background') attrs.background = val;
          if (key === 'data-alignment') attrs.alignment = val;
          if (key === 'data-colwidth') {
            try { attrs.colwidth = JSON.parse(val); } catch {}
          }
        }
      }
      return attrs;
    },
  },
  td: {
    block: 'table_cell',
    getAttrs(tok: any) {
      const attrs: Record<string, unknown> = {};
      if (tok.attrs) {
        for (const [key, val] of tok.attrs) {
          if (key === 'colspan') attrs.colspan = parseInt(val, 10);
          if (key === 'rowspan') attrs.rowspan = parseInt(val, 10);
          if (key === 'data-background') attrs.background = val;
          if (key === 'data-alignment') attrs.alignment = val;
          if (key === 'data-colwidth') {
            try { attrs.colwidth = JSON.parse(val); } catch {}
          }
        }
      }
      return attrs;
    },
  },
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Browser verification — colwidth persistence**

1. Open ASuite in browser, create/open a document
2. Insert a table via "/" menu
3. Drag a column border to resize a column
4. Save (wait for auto-save or navigate away and back)
5. Reload the page
6. Verify the column width is preserved

- [ ] **Step 8: Browser verification — cell background persistence**

1. Select cells in a table
2. Use the FloatingToolbar to set a cell background color
3. Save and reload
4. Verify the background color is preserved

- [ ] **Step 9: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/editor/markdown.ts
git commit -m "fix(editor): persist table colwidth, background, and merge via HTML table serialization"
```

---

### Task 4: Upgrade PPT table data model and interaction

**Files:**
- Modify: `shell/src/components/presentation-editor/PresentationEditor.tsx`

- [ ] **Step 1: Update PPTTableOverlay to use ProseMirror JSON**

In `shell/src/components/presentation-editor/PresentationEditor.tsx`, find the `PPTTableOverlay` function (around line 2290). Replace the entire section from `stringArrayToRichTableData` through the end of `PPTTableOverlay`:

```typescript
// ─── PPT Table Overlay — RichTable positioned over Fabric.js table rect ────
function PPTTableOverlay({ obj, canvas, containerRef, propVersion, isSelected }: {
  obj: any;
  canvas: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  propVersion: number;
  isSelected?: boolean;
}) {
  const [pos, setPos] = useState({ left: 0, top: 0, width: 200, height: 100 });
  const [editing, setEditing] = useState(false);
  const [tableToolbarInfo, setTableToolbarInfo] = useState<{
    anchor: { top: number; left: number; width: number };
    view: any;
  } | null>(null);

  // Get or create default table JSON
  const getTableJSON = useCallback(() => {
    if (obj.__tableJSON) return obj.__tableJSON;
    // Migrate from old string[][] format if present
    const oldData: string[][] = obj.__tableData;
    if (oldData && Array.isArray(oldData) && oldData.length > 0) {
      const rows = oldData.map((row, rowIdx) => ({
        type: rowIdx === 0 ? 'table_row' : 'table_row',
        content: row.map((cell) => ({
          type: rowIdx === 0 ? 'table_header' : 'table_cell',
          attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
          content: [{ type: 'paragraph', content: cell ? [{ type: 'text', text: cell }] : undefined }],
        })),
      }));
      return { type: 'doc', content: [{ type: 'table', content: rows }] };
    }
    // Default 3x3 table
    const cols = 3, rowCount = 3;
    const headerCells = Array.from({ length: cols }, () => ({
      type: 'table_header',
      attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
      content: [{ type: 'paragraph' }],
    }));
    const bodyRow = () => ({
      type: 'table_row',
      content: Array.from({ length: cols }, () => ({
        type: 'table_cell',
        attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
        content: [{ type: 'paragraph' }],
      })),
    });
    return {
      type: 'doc',
      content: [{ type: 'table', content: [
        { type: 'table_row', content: headerCells },
        bodyRow(),
        bodyRow(),
      ]}],
    };
  }, [obj]);

  const [tableJSON, setTableJSON] = useState<Record<string, unknown>>(() => getTableJSON());

  // Sync when object changes externally
  useEffect(() => {
    setTableJSON(getTableJSON());
  }, [obj, propVersion, getTableJSON]);

  // Compute position relative to canvas container
  const updatePos = useCallback(() => {
    const container = containerRef.current;
    if (!container || !canvas) return;
    const zoom = canvas.getZoom() || 1;
    const wrapper = container.querySelector('.canvas-wrapper') as HTMLElement;
    const wrapperLeft = wrapper ? parseFloat(wrapper.style.marginLeft || '0') : 0;
    const wrapperTop = wrapper ? parseFloat(wrapper.style.marginTop || '0') : 0;
    const objW = (obj.width || 200) * (obj.scaleX || 1);
    const objH = (obj.height || 100) * (obj.scaleY || 1);
    setPos({
      left: (obj.left || 0) * zoom + wrapperLeft,
      top: (obj.top || 0) * zoom + wrapperTop,
      width: objW * zoom,
      height: objH * zoom,
    });
  }, [obj, canvas, containerRef]);

  useEffect(() => {
    updatePos();
    if (!canvas) return;
    const handler = () => updatePos();
    canvas.on('after:render', handler);
    return () => { canvas.off('after:render', handler); };
  }, [canvas, updatePos]);

  const handleProsemirrorChange = useCallback((json: Record<string, unknown>) => {
    setTableJSON(json);
    obj.__tableJSON = json;
    // Clean up old format
    delete obj.__tableData;
    delete obj.__tableRows;
    delete obj.__tableCols;
    canvas?.fire('object:modified', { target: obj });
  }, [obj, canvas]);

  // Click on non-selected table overlay → select the Fabric.js object
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSelected && canvas) {
      canvas.setActiveObject(obj);
      canvas.renderAll();
    }
  }, [isSelected, canvas, obj]);

  // Double-click to enter edit mode
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSelected) {
      setEditing(true);
    }
  }, [isSelected]);

  // Exit edit mode on click outside
  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      const overlay = (e.target as HTMLElement).closest('.ppt-table-overlay');
      if (!overlay) {
        setEditing(false);
        setTableToolbarInfo(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing]);

  // Escape to exit edit mode
  useEffect(() => {
    if (!editing) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(false);
        setTableToolbarInfo(null);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [editing]);

  return (
    <>
      <div
        className="ppt-table-overlay absolute overflow-visible"
        style={{
          left: pos.left,
          top: pos.top,
          width: pos.width,
          minHeight: pos.height,
          zIndex: editing ? 50 : isSelected ? 30 : 10,
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <RichTable
          prosemirrorJSON={tableJSON}
          onProsemirrorChange={editing ? handleProsemirrorChange : undefined}
          onCellToolbar={editing ? (info) => setTableToolbarInfo(info) : undefined}
          config={{
            cellMinWidth: 60,
            showToolbar: false,
            showContextMenu: editing,
            readonly: !editing,
          }}
          width="100%"
        />
        {!editing && isSelected && (
          <div className="absolute inset-0 border-2 border-sidebar-primary/50 rounded pointer-events-none" />
        )}
      </div>
      {tableToolbarInfo && editing && (
        <FloatingToolbar
          items={DOCS_TABLE_ITEMS}
          handler={createDocsTableHandler(tableToolbarInfo.view)}
          anchor={tableToolbarInfo.anchor}
          visible={true}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Add missing imports to PresentationEditor.tsx**

At the top of PresentationEditor.tsx, ensure these imports exist (add any missing):

```typescript
import { FloatingToolbar } from '@/components/shared/FloatingToolbar';
import { DOCS_TABLE_ITEMS } from '@/components/shared/FloatingToolbar/presets';
import { createDocsTableHandler } from '@/components/editor/docs-toolbar-handler';
```

Check if `FloatingToolbar` is already imported (it likely is from the unified toolbar work). Only add the missing ones.

- [ ] **Step 3: Remove old stringArrayToRichTableData and richTableDataToStringArray functions**

These two functions (around lines 2278-2288) should be removed since they're replaced by the new PPTTableOverlay implementation. They were:

```typescript
function stringArrayToRichTableData(data: string[][]): RichTableData { ... }
function richTableDataToStringArray(data: RichTableData): string[][] { ... }
```

- [ ] **Step 4: Update slide serialization — save tableJSON**

Find the slide serialization section (around line 719-727). Replace:

```typescript
      } else if (objType === 'table') {
        elements.push({
          ...base,
          type: 'table',
          tableData: obj.__tableData || [],
          tableRows: obj.__tableRows || 3,
          tableCols: obj.__tableCols || 3,
        });
      }
```

With:

```typescript
      } else if (objType === 'table') {
        elements.push({
          ...base,
          type: 'table',
          tableJSON: obj.__tableJSON || null,
        });
      }
```

- [ ] **Step 5: Update slide deserialization — load tableJSON**

Find the table deserialization section (around line 585-604). Replace:

```typescript
      } else if (el.type === 'table') {
        // Recreate table placeholder rect
        const { Rect: RectCls } = fabricModule;
        const cellW = 120;
        const cellH = 36;
        const tRows = el.tableRows || 3;
        const tCols = el.tableCols || 3;
        obj = new RectCls({
          ...common,
          width: cellW * tCols,
          height: cellH * tRows,
          fill: 'transparent',
          stroke: 'transparent',
          strokeWidth: 0,
        });
        (obj as any).__tableData = el.tableData || Array.from({ length: tRows }, () => Array(tCols).fill(''));
        (obj as any).__tableRows = tRows;
        (obj as any).__tableCols = tCols;
        (obj as any).__isTable = true;
      }
```

With:

```typescript
      } else if (el.type === 'table') {
        // Recreate table placeholder rect
        const { Rect: RectCls } = fabricModule;
        obj = new RectCls({
          ...common,
          width: el.width || 360,
          height: el.height || 108,
          fill: 'transparent',
          stroke: 'transparent',
          strokeWidth: 0,
        });
        (obj as any).__tableJSON = el.tableJSON || null;
        (obj as any).__isTable = true;
      }
```

- [ ] **Step 6: Update addTable to use ProseMirror JSON**

Find the `addTable` function (around line 893). Replace:

```typescript
    // Store table data in the object's custom property
    const tableData: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
    (tableBg as any).__tableData = tableData;
    (tableBg as any).__tableRows = rows;
    (tableBg as any).__tableCols = cols;
    (tableBg as any).__isTable = true;
```

With:

```typescript
    // Store table data as ProseMirror JSON
    const headerCells = Array.from({ length: cols }, () => ({
      type: 'table_header',
      attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
      content: [{ type: 'paragraph' }],
    }));
    const bodyRow = () => ({
      type: 'table_row',
      content: Array.from({ length: cols }, () => ({
        type: 'table_cell',
        attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
        content: [{ type: 'paragraph' }],
      })),
    });
    const tableJSON = {
      type: 'doc',
      content: [{ type: 'table', content: [
        { type: 'table_row', content: headerCells },
        ...Array.from({ length: rows - 1 }, bodyRow),
      ]}],
    };
    (tableBg as any).__tableJSON = tableJSON;
    (tableBg as any).__isTable = true;
```

- [ ] **Step 7: Update presenter mode table rendering**

Find the presenter mode table rendering (around line 2509-2631). Update any references to `__tableData`, `__tableRows`, `__tableCols` to use `__tableJSON`. The presenter renders tables as canvas grid lines. Update the `after:render` handler that draws table grid lines — it needs to extract row/col count from `__tableJSON`:

In the after:render handler, replace references like:
```typescript
const tData: string[][] = (o as any).__tableData || [];
const tRows: number = (o as any).__tableRows || 3;
const tCols: number = (o as any).__tableCols || 3;
```

With:
```typescript
const tJSON = (o as any).__tableJSON;
const tableContent = tJSON?.content?.[0]?.content || [];
const tRows: number = tableContent.length || 3;
const tCols: number = tableContent[0]?.content?.length || 3;
```

Similarly update the presenter slide loader that sets `__tableData`/`__tableRows`/`__tableCols`:
```typescript
(obj as any).__tableJSON = el.tableJSON || null;
(obj as any).__isTable = true;
```

- [ ] **Step 8: Verify build**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
```

Expected: Build succeeds.

- [ ] **Step 9: Browser verification — PPT table**

1. Open ASuite, go to a presentation
2. Insert a table (Table button in toolbar)
3. Click the table to select it — verify selection ring appears
4. Double-click to enter edit mode — verify cells become editable
5. Type text, apply bold/italic via FloatingToolbar
6. Click outside to exit edit mode
7. Navigate to another slide and back — verify table content preserved
8. Drag the table to reposition in selected (non-edit) state

- [ ] **Step 10: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/presentation-editor/PresentationEditor.tsx
git commit -m "feat(ppt): upgrade table to ProseMirror JSON data model with FloatingToolbar integration"
```

---

### Task 5: Add table feature to Diagram editor

**Files:**
- Modify: `shell/src/components/diagram-editor/components/LeftToolbar.tsx`
- Modify: `shell/src/components/diagram-editor/X6DiagramEditor.tsx`

- [ ] **Step 1: Add Table button to LeftToolbar**

In `shell/src/components/diagram-editor/components/LeftToolbar.tsx`:

Add import:
```typescript
import { Type, Brain, ImageIcon, Table2 } from 'lucide-react';
```

Update the `ActiveTool` type:
```typescript
export type ActiveTool = 'select' | 'text' | 'table' | FlowchartShape | 'connector' | 'mindmap';
```

Add a Table tool button in the JSX, after the Image button (find the image button pattern and add after it):

```tsx
        <button
          className={cn(
            'p-2 rounded-lg transition-colors',
            activeTool === 'table' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          onClick={() => onToolChange('table')}
          title="Table"
        >
          <Table2 className="w-5 h-5" />
        </button>
```

- [ ] **Step 2: Add table node creation in X6DiagramEditor**

In `shell/src/components/diagram-editor/X6DiagramEditor.tsx`, find the section where clicking the canvas creates nodes based on `activeTool` (search for `case 'text':` or similar tool handling).

Add imports at the top:
```typescript
import { RichTable } from '@/components/shared/RichTable';
import { DOCS_TABLE_ITEMS } from '@/components/shared/FloatingToolbar/presets';
import { createDocsTableHandler } from '@/components/editor/docs-toolbar-handler';
import { Table2 } from 'lucide-react';
```

Add table node creation logic. When `activeTool === 'table'` and user clicks on canvas, create an X6 node:

```typescript
      if (activeTool === 'table') {
        const defaultTableJSON = {
          type: 'doc',
          content: [{ type: 'table', content: [
            { type: 'table_row', content: Array.from({ length: 3 }, () => ({
              type: 'table_header',
              attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
              content: [{ type: 'paragraph' }],
            }))},
            ...Array.from({ length: 2 }, () => ({
              type: 'table_row',
              content: Array.from({ length: 3 }, () => ({
                type: 'table_cell',
                attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
                content: [{ type: 'paragraph' }],
              })),
            })),
          ]}],
        };
        graph.addNode({
          x: localPos.x - 180,
          y: localPos.y - 54,
          width: 360,
          height: 108,
          data: { type: 'table', tableJSON: defaultTableJSON },
          attrs: {
            body: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0 },
          },
        });
        setActiveTool('select');
        return;
      }
```

- [ ] **Step 3: Add DiagramTableOverlay component**

Add this component in X6DiagramEditor.tsx, before the main `X6DiagramEditor` export:

```typescript
/** DOM overlay for table nodes in the diagram */
function DiagramTableOverlay({ graph, node, containerRef, isSelected }: {
  graph: any;
  node: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isSelected: boolean;
}) {
  const [pos, setPos] = useState({ left: 0, top: 0, width: 360, height: 108 });
  const [editing, setEditing] = useState(false);
  const [tableToolbarInfo, setTableToolbarInfo] = useState<{
    anchor: { top: number; left: number; width: number };
    view: any;
  } | null>(null);

  const tableJSON = node.getData()?.tableJSON || null;

  const updatePos = useCallback(() => {
    if (!graph || !containerRef.current) return;
    const position = node.getPosition();
    const size = node.getSize();
    const topLeft = graph.localToGraph(position.x, position.y);
    const bottomRight = graph.localToGraph(position.x + size.width, position.y + size.height);
    setPos({
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    });
  }, [graph, node, containerRef]);

  useEffect(() => {
    if (!graph) return;
    const handler = () => updatePos();
    graph.on('scale', handler);
    graph.on('translate', handler);
    graph.on('node:moved', handler);
    graph.on('node:resized', handler);
    updatePos();
    return () => {
      graph.off('scale', handler);
      graph.off('translate', handler);
      graph.off('node:moved', handler);
      graph.off('node:resized', handler);
    };
  }, [graph, updatePos]);

  // Double-click to enter edit mode
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSelected) setEditing(true);
  }, [isSelected]);

  // Exit edit mode
  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      const overlay = (e.target as HTMLElement).closest('.diagram-table-overlay');
      if (!overlay) {
        setEditing(false);
        setTableToolbarInfo(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(false);
        setTableToolbarInfo(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [editing]);

  const handleProsemirrorChange = useCallback((json: Record<string, unknown>) => {
    node.setData({ ...node.getData(), tableJSON: json });
  }, [node]);

  if (!tableJSON) return null;

  return (
    <>
      <div
        className="diagram-table-overlay absolute overflow-visible"
        style={{
          left: pos.left,
          top: pos.top,
          width: pos.width,
          minHeight: pos.height,
          zIndex: editing ? 50 : isSelected ? 30 : 10,
          pointerEvents: editing || isSelected ? 'auto' : 'none',
        }}
        onDoubleClick={handleDoubleClick}
      >
        <RichTable
          prosemirrorJSON={tableJSON}
          onProsemirrorChange={editing ? handleProsemirrorChange : undefined}
          onCellToolbar={editing ? (info) => setTableToolbarInfo(info) : undefined}
          config={{
            cellMinWidth: 60,
            showToolbar: false,
            showContextMenu: editing,
            readonly: !editing,
          }}
          width="100%"
        />
        {!editing && isSelected && (
          <div className="absolute inset-0 border-2 border-sidebar-primary/50 rounded pointer-events-none" />
        )}
      </div>
      {tableToolbarInfo && editing && (
        <FloatingToolbar
          items={DOCS_TABLE_ITEMS}
          handler={createDocsTableHandler(tableToolbarInfo.view)}
          anchor={tableToolbarInfo.anchor}
          visible={true}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Render table overlays in X6DiagramEditor JSX**

In the main X6DiagramEditor component, add state to track table nodes:

```typescript
const [tableNodes, setTableNodes] = useState<any[]>([]);
```

In the graph initialization useEffect, after the graph is created, add a listener to track table nodes:

```typescript
    // Track table nodes for DOM overlays
    const refreshTableNodes = () => {
      const nodes = graph.getNodes().filter((n: any) => n.getData()?.type === 'table');
      setTableNodes([...nodes]);
    };
    graph.on('node:added', refreshTableNodes);
    graph.on('node:removed', refreshTableNodes);
    graph.on('node:change:data', refreshTableNodes);
    refreshTableNodes();
```

In the JSX return, add the table overlays (near the other overlays like FloatingToolbar):

```tsx
          {/* Table DOM overlays */}
          {tableNodes.map((tNode) => (
            <DiagramTableOverlay
              key={tNode.id}
              graph={graphRef.current}
              node={tNode}
              containerRef={containerRef}
              isSelected={diagramToolbarCell?.id === tNode.id}
            />
          ))}
```

- [ ] **Step 5: Handle table node serialization in diagram save/load**

Check how diagram data is serialized. X6's `graph.toJSON()` / `graph.fromJSON()` should already handle `node.data` (including `tableJSON`). Verify this by reading the existing serialization code — if it uses `graph.toJSON()`, no changes needed. If it manually iterates nodes, ensure `data.tableJSON` is included.

- [ ] **Step 6: Verify build**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Browser verification — Diagram table**

1. Open ASuite, go to a diagram
2. Click the Table button in the left toolbar
3. Click on the canvas — verify a table appears
4. Select the table node, double-click to enter edit mode
5. Edit cells, apply formatting
6. Click outside to exit edit mode
7. Save the diagram and reload — verify table data persists
8. Pan/zoom the diagram — verify the table overlay follows correctly

- [ ] **Step 8: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/diagram-editor/components/LeftToolbar.tsx \
  shell/src/components/diagram-editor/X6DiagramEditor.tsx
git commit -m "feat(diagram): add table node with RichTable overlay and FloatingToolbar"
```

---

### Task 6: Final integration verification

- [ ] **Step 1: Full build**

```bash
cd /Users/mac/Documents/asuite/shell && npm run build
```

- [ ] **Step 2: Cross-scenario browser verification**

Verify the complete testing checklist from the spec:

**Docs:**
- [ ] Insert table via "/" menu, edit cells with rich text formatting
- [ ] Resize columns, save, reload — colwidth persists
- [ ] Set cell background, save, reload — color persists
- [ ] Merge cells, save, reload — merge persists
- [ ] Cell selection shows FloatingToolbar

**PPT:**
- [ ] Insert table, see on slide in read-only state
- [ ] Click to select, double-click to edit
- [ ] FloatingToolbar appears on cell selection in edit mode
- [ ] Bold/italic preserved after exit/re-enter edit
- [ ] Drag table to reposition
- [ ] Save presentation, reload — data preserved

**Diagram:**
- [ ] Insert table from toolbar
- [ ] Read-only/edit mode toggle
- [ ] Data persists in save/load

**Mobile:**
- [ ] No bottom toolbar (MobileToolbar deleted)

- [ ] **Step 3: Report completion to moonyaan**
