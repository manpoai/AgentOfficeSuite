# RichTable Shared Component — Design Spec

## Overview

Unify the table editing experience across Docs, PPT, and Diagram editors. One shared RichTable engine (ProseMirror-based), same schema, same toolbar (FloatingToolbar), same context menu, same styles — with per-scenario interaction differences only in the outer shell.

## Decisions (confirmed with moonyaan)

| Decision | Choice |
|----------|--------|
| Architecture | Schema + toolbar + styles unified; ProseMirror instances remain separate (Docs = native node in main editor, PPT/Diagram = standalone RichTable) |
| PPT/Diagram cell editing | Basic rich text only: paragraph + bold/italic/underline/strikethrough + text color + alignment. No headings, lists, images, code blocks |
| PPT/Diagram data model | ProseMirror JSON (no backward compat needed — no old data) |
| Toolbar | Unified FloatingToolbar via table-menu-plugin's onCellToolbar callback. Delete TableToolbar.tsx |
| Mobile toolbar | Delete MobileToolbar.tsx (duplicate of FloatingToolbar) |
| Naming | Never use "adapter" — use "overlay" or "integration" |

## Current State

### What exists
- `shared/RichTable/index.tsx` — standalone ProseMirror table editor, minimal schema (paragraph + strong/em/underline)
- `shared/RichTable/TableToolbar.tsx` — custom toolbar (NOT unified FloatingToolbar) — **to be deleted**
- `shared/RichTable/TableContextMenu.tsx` — right-click menu builder — **keep, integrate with table-menu-plugin's context menu**
- `shared/RichTable/adapters/ProseMirrorAdapter.tsx` — creates RichTableActions from EditorView — **not used by Docs, keep for reference**
- `shared/RichTable/adapters/FabricOverlay.tsx` — DOM overlay for PPT — **not used, PPTTableOverlay is inline in PresentationEditor.tsx**
- `shared/RichTable/adapters/X6Overlay.tsx` — DOM overlay for Diagram — **not used, Diagram has no table feature**
- `shared/MobileToolbar.tsx` — mobile editing toolbar — **to be deleted**

### What works in Docs
- Tables are native ProseMirror nodes in the main editor schema
- `table-menu-plugin.ts` (1461 lines): grip bars, insertion dots, column/row context menus, cell selection toolbar
- `docs-toolbar-handler.ts`: `createDocsTableHandler()` already wired to unified FloatingToolbar
- Markdown serialization: `markdown.ts` serializes tables as GFM markdown tables
- **Bug**: `colwidth` not persisted — markdown format doesn't support column widths

### What works in PPT
- `PPTTableOverlay` in PresentationEditor.tsx: DOM div over Fabric.js rect anchor
- Data model: `string[][]` stored as `obj.__tableData` — no rich text, no merge, no colwidth
- Uses RichTable with `readonly: !isSelected`
- No FloatingToolbar integration — table-menu-plugin runs inside RichTable but without onCellToolbar callback

## Architecture

### Schema unification

RichTable's `createTableSchema()` will be upgraded to match the Docs editor's table-related schema:

**Marks to add:**
- `strikethrough` (~~text~~)
- `highlight` (background color mark with `color` attr)

**Cell attributes already supported:**
- `alignment` (text-align)
- `background` (background-color)
- `colwidth` (column widths array — already in prosemirror-tables)

The Docs editor's schema includes these same cell attributes and marks, so cells edited in either context will be compatible at the data level.

### Docs: Fix colwidth persistence

**Root cause:** Markdown (GFM) tables don't support column widths. When a document is serialized to markdown and parsed back, colwidth is lost.

**Fix approach:** Serialize tables with colwidth/background/colspan/rowspan as HTML `<table>` instead of GFM markdown when any cell has non-default attributes. The markdown parser already handles HTML tables via `prosemirror-markdown`'s HTML token handling (th/td/tr tags are mapped).

Specifically:
- In `markdown.ts` table serializer: check if any cell has `colwidth`, `background`, `colspan > 1`, or `rowspan > 1`
- If yes: output `<table>` HTML with `style` attributes on cells and `colgroup`+`col` for widths
- If no: output standard GFM markdown table (current behavior)

For parsing: the markdown parser's HTML token handler (`th`/`td`/`tr` mappings in `markdown.ts`) already creates table nodes from HTML. Need to extend the HTML parsing to extract `style` attributes for `background-color`, `text-align`, and `colgroup`/`col width` into cell node attributes. The `markdown-it` HTML block rule already passes through `<table>` blocks.

This is backward compatible — existing markdown tables parse fine; new tables with rich attributes serialize as HTML and parse back with attributes intact.

### PPT: Upgrade PPTTableOverlay

**Data model change:**
- Remove `string[][]` model (`__tableData`, `__tableRows`, `__tableCols`)
- Store ProseMirror JSON directly: `obj.__tableJSON`
- Remove `stringArrayToRichTableData()` / `richTableDataToStringArray()` conversion functions

**Interaction model:**
1. **Read-only state** (table not selected): RichTable renders with `readonly: true`, user can drag the Fabric.js rect to reposition
2. **Selected state** (table clicked once): Fabric.js selection handles appear, table still read-only but shows selection ring
3. **Edit state** (double-click or Enter on selected table): RichTable becomes editable (`readonly: false`), FloatingToolbar appears on cell selection via table-menu-plugin's onCellToolbar callback
4. **Exit edit** (click outside table or Escape): Back to selected or read-only state

**FloatingToolbar integration:**
- RichTable's internal ProseMirror instance uses table-menu-plugin with `onCellToolbar` callback
- The callback emits position info upward (via props or state) to PPTTableOverlay
- PPTTableOverlay renders FloatingToolbar with DOCS_TABLE_ITEMS + createDocsTableHandler

**Serialization:**
- Slide save: `obj.__tableJSON` (ProseMirror doc JSON) stored directly in slide element data
- Slide load: `obj.__tableJSON` passed as `prosemirrorJSON` prop to RichTable

### Diagram: New table feature

**Architecture:**
- Table is an X6 node (rect with `data.type = 'table'`)
- DOM overlay (`X6TableOverlay` in X6DiagramEditor.tsx) positioned over the node using `graph.localToGraph()`
- Same read-only/edit interaction as PPT

**Insertion:**
- Add "Table" button to diagram toolbar (alongside existing shape/text/image tools)
- Creates X6 node with default 3x3 table ProseMirror JSON in `data.tableJSON`

**Data flow:**
- X6 node `data.tableJSON` → RichTable `prosemirrorJSON` prop
- RichTable `onProsemirrorChange` → updates `node.setData({ tableJSON: ... })`
- Graph serialization already handles `node.data` — no special handling needed

### RichTable component changes

**Props cleanup:**
- Keep: `prosemirrorJSON`, `onProsemirrorChange`, `config`, `className`, `width`, `height`
- Keep: `data` / `onChange` (simplified RichTableData model — useful for simple cases)
- Add: `onCellToolbar?: (info: TableToolbarInfo | null) => void` — forwarded to table-menu-plugin

**Schema upgrade:**
- Add `strikethrough` mark
- Add `highlight` mark (with color attr)
- Ensure cellAttributes include `alignment`, `background`, `colwidth`

**Plugin changes:**
- table-menu-plugin: pass `onCellToolbar` callback when not readonly
- Remove internal toolbar rendering

**Ref handle (`RichTableHandle`):**
- Keep `getView()`, `getData()`, `actions`

### Cleanup

**Delete:**
- `shared/RichTable/TableToolbar.tsx`
- `shared/RichTable/adapters/FabricOverlay.tsx` (unused — PPTTableOverlay is inline)
- `shared/RichTable/adapters/X6Overlay.tsx` (unused — will build new inline)
- `shared/MobileToolbar.tsx`
- MobileToolbar usage in `content/page.tsx` (the items definition, import, and JSX)

**Keep:**
- `shared/RichTable/adapters/ProseMirrorAdapter.tsx` — useful reference, `createProseMirrorActions()` may be used
- `shared/RichTable/TableContextMenu.tsx` — context menu builder, will be integrated

## File changes summary

| File | Action |
|------|--------|
| `shared/RichTable/index.tsx` | Modify: upgrade schema, add onCellToolbar prop, remove toolbar rendering |
| `shared/RichTable/types.ts` | Modify: add onCellToolbar to RichTableProps |
| `shared/RichTable/TableToolbar.tsx` | Delete |
| `shared/RichTable/adapters/FabricOverlay.tsx` | Delete |
| `shared/RichTable/adapters/X6Overlay.tsx` | Delete |
| `shared/MobileToolbar.tsx` | Delete |
| `editor/markdown.ts` | Modify: HTML table serialization for colwidth/bg/merge |
| `editor/table-menu-plugin.ts` | No change (onCellToolbar already supported) |
| `presentation-editor/PresentationEditor.tsx` | Modify: upgrade PPTTableOverlay data model, add FloatingToolbar |
| `diagram-editor/X6DiagramEditor.tsx` | Modify: add table insertion + X6TableOverlay |
| `app/(workspace)/content/page.tsx` | Modify: remove MobileToolbar import and usage |

## Testing checklist

- [ ] Docs: insert table via "/" menu, edit cells, verify rich text formatting works
- [ ] Docs: resize columns, save document, reload — verify colwidth persists
- [ ] Docs: set cell background color, save, reload — verify color persists
- [ ] Docs: merge cells, save, reload — verify merge persists
- [ ] Docs: cell selection shows FloatingToolbar with table items
- [ ] PPT: insert table, see it on slide in read-only state
- [ ] PPT: click table to select, double-click to enter edit mode
- [ ] PPT: in edit mode, cell selection shows FloatingToolbar
- [ ] PPT: edit cell text with bold/italic, exit edit, re-enter — formatting preserved
- [ ] PPT: drag table to reposition in read-only state
- [ ] PPT: save presentation, reload — table data preserved
- [ ] Diagram: insert table from toolbar
- [ ] Diagram: read-only/edit mode toggle works
- [ ] Diagram: table data persists in diagram save/load
- [ ] Mobile: no bottom toolbar shown (MobileToolbar deleted)
- [ ] Mobile: FloatingToolbar works on text selection in docs
