# Unified FloatingToolbar Design Spec

## Goal

Replace all 8+ independent floating toolbar implementations across Docs/PPT/Diagram editors with a single shared `FloatingToolbar` React component. Each toolbar scenario is a different `items` configuration; each editor provides a `handler` that maps actions to its engine (ProseMirror / Fabric.js / X6).

## Architecture

```
shared/FloatingToolbar/
  FloatingToolbar.tsx     — container: positioning, portal, mousedown prevention
  ToolbarButton.tsx       — toggle button (icon + active state)
  ToolbarSeparator.tsx    — vertical divider
  ToolbarColorPicker.tsx  — color swatch grid (for highlight, fill, border, text color, cell bg)
  ToolbarDropdown.tsx     — dropdown (for font family, font size, shape picker, heading, list, etc.)
  types.ts                — ToolbarItem, ToolbarState, ToolbarHandler interfaces
  presets.ts              — 10 item configurations (DOCS_TEXT, PPT_TEXT, DIAGRAM_NODE, etc.)
```

## Core Types

```typescript
// Each button in the toolbar
interface ToolbarItem {
  key: string;                          // unique id: 'bold', 'italic', 'fillColor', etc.
  type: 'toggle' | 'color' | 'dropdown' | 'action';
  icon: React.ReactNode;               // lucide icon
  label: string;                       // tooltip text
  group?: string;                      // for separator insertion between groups
  // For dropdowns:
  options?: { value: string; label: string; icon?: React.ReactNode }[];
}

// Current state of all buttons (active/inactive, current values)
interface ToolbarState {
  [key: string]: boolean | string | undefined;
  // e.g. bold: true, italic: false, fontFamily: 'Roboto', fontSize: '16'
}

// Engine-specific action dispatcher
interface ToolbarHandler {
  getState(): ToolbarState;
  execute(key: string, value?: unknown): void;
  // Optional: called when toolbar mounts/unmounts
  onMount?(): void;
  onUnmount?(): void;
}
```

## FloatingToolbar Component

```typescript
interface FloatingToolbarProps {
  items: ToolbarItem[];
  handler: ToolbarHandler;
  anchor: { top: number; left: number; width: number } | null;  // position anchor
  visible: boolean;
  className?: string;
}
```

- Renders via `createPortal` to `document.body`
- `position: fixed`, positioned above the anchor rect
- `onMouseDown={e => e.preventDefault()}` to preserve editor selection
- Auto-clamps to viewport edges
- Separators inserted between different `group` values
- Re-renders button active states by calling `handler.getState()` after each `handler.execute()`

## 10 Toolbar Scenarios (from approved doc)

| # | Preset Key | Items |
|---|-----------|-------|
| 1 | DOCS_TEXT | B, I, S, U, highlight, code, quote, H1, H2, H3, checkbox, ordered, bullet, link, comment |
| 2 | PPT_TEXT | textStyle, fontFamily, fontSize, B, I, S, U, align, textColor, link, comment |
| 3 | DIAGRAM_NODE | shapeSelect, fillColor, borderColor, fontSize, B, I, S, U, align, copy, delete, zOrder |
| 4 | DOCS_TABLE | headerRow, headerCol, merge, split, cellBg, B, I, S, U, highlight, code, quote, headingDrop, listDrop, comment, deleteRow, deleteCol |
| 5 | PPT_TABLE | headerRow, headerCol, merge, split, cellBg, B, I, S, U, highlight, code, deleteRow, deleteCol |
| 6 | DOCS_IMAGE | alignLeft, alignCenter, alignRight, fullWidth, fitWidth, replace, download, delete, altText, comment |
| 7 | PPT_IMAGE | replace, copy, delete, zOrder |
| 8 | DIAGRAM_IMAGE | replace, copy, delete, zOrder |
| 9 | PPT_SHAPE | shapeSelect, fillColor, borderColor, borderWidth, borderStyle, textColor, cornerRadius, copy, delete, zOrder |
| 10 | DIAGRAM_EDGE | lineColor, lineWidth, lineStyle, connectorType, arrowStyle, label, copy, delete, zOrder |

## Handlers (per engine)

### DocsToolbarHandler
Wraps ProseMirror commands. Receives `EditorView` reference.
- `getState()`: checks marks via `isMarkActive()`, block types via `isBlockActive()`
- `execute('bold')`: `toggleMark(schema.marks.strong)(state, dispatch)`
- `execute('highlight', color)`: `addMark(schema.marks.highlight.create({color}))`
- `execute('heading', level)`: `setBlockType(schema.nodes.heading, {level})`
- `execute('link')`: prompt for URL, `addMark(schema.marks.link)`
- `execute('comment')`: `dispatchEvent(new CustomEvent('editor-comment'))`
- All existing logic from `floating-toolbar.ts` moves here (toggleList, toggleBlockquote, setHeading, etc.)

### PPTToolbarHandler
Wraps Fabric.js object manipulation. Receives canvas + active object reference.
- `execute('bold')`: `obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold')`
- `execute('fontFamily', val)`: `obj.set('fontFamily', val)`
- `execute('fillColor', color)`: `obj.set('fill', color)`
- `execute('copy')`: clone active object
- `execute('delete')`: `canvas.remove(obj)`
- `execute('zOrder', 'front'|'back')`: `canvas.bringToFront(obj)`

### DiagramToolbarHandler
Wraps X6 cell operations. Receives graph + selected cell reference.
- `execute('bold')`: `cell.setData({fontWeight: ...})`
- `execute('fillColor', color)`: `cell.setData({bgColor: color})`
- `execute('lineColor', color)`: `edge.attr('line/stroke', color)` (for edges)
- `execute('connectorType', type)`: `edge.setRouter(...)` + `edge.setConnector(...)`

### DocsTableHandler
Extends DocsToolbarHandler with table-specific commands from `table-menu-plugin.ts`.
- `execute('merge')`: `mergeCells(state, dispatch)`
- `execute('headerRow')`: `toggleHeaderRow(state, dispatch)`
- `execute('cellBg', color)`: `setNodeMarkup(pos, undefined, {background: color})`

### DocsImageHandler
Wraps image node operations from `node-views.ts`.
- `execute('alignLeft')`: `setNodeMarkup(pos, undefined, {align: 'left'})`
- `execute('replace')`: open file picker
- `execute('delete')`: `tr.delete(pos, pos + node.nodeSize)`

## Implementation Order

1. **FloatingToolbar base** — component + sub-components + types
2. **DOCS_TEXT preset + DocsToolbarHandler** — replace `floating-toolbar.ts` (most buttons, best validation)
3. **PPT_TEXT preset + PPTToolbarHandler** — replace `FloatingTextToolbar`
4. **DIAGRAM_NODE + DIAGRAM_EDGE + DIAGRAM_IMAGE presets + DiagramToolbarHandler** — replace `FloatingToolbar.tsx`
5. **DOCS_TABLE + PPT_TABLE presets + DocsTableHandler** — replace table-menu-plugin cell toolbar
6. **DOCS_IMAGE + PPT_IMAGE presets + DocsImageHandler/PPTImageHandler**
7. **PPT_SHAPE preset** — new toolbar (currently only in property panel)

## What Gets Deleted After Migration

- `editor/floating-toolbar.ts` (replaced by FloatingToolbar + DocsToolbarHandler)
- `editor/Toolbar.tsx` (already deleted, was dead code)
- `presentation-editor/FloatingTextToolbar` (inline in PresentationEditor.tsx)
- `diagram-editor/components/FloatingToolbar.tsx` (replaced)
- `shared/TextToolbar.tsx` (unused, superseded)
- `shared/RichText/FloatingToolbar.tsx` (superseded)
- `shared/RichText/toolbar-items.ts` (superseded)

## Naming Convention

- Component: `FloatingToolbar`
- Engine dispatchers: `DocsToolbarHandler`, `PPTToolbarHandler`, `DiagramToolbarHandler`
- Presets: `DOCS_TEXT_ITEMS`, `PPT_TEXT_ITEMS`, etc.
- No use of "adapter" (reserved for agent platform integration)
