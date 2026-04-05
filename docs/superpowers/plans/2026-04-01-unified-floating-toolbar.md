# Unified FloatingToolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all independent floating toolbar implementations with a single shared `FloatingToolbar` React component configured per-scenario via items arrays and engine-specific handlers.

**Architecture:** One `FloatingToolbar` component renders any toolbar from an `items[]` config. Each editor provides a `ToolbarHandler` that maps button actions to its engine (ProseMirror commands, Fabric.js set, X6 setData). Presets define which buttons appear in each of 10 scenarios.

**Tech Stack:** React, TypeScript, Lucide icons, ProseMirror, Fabric.js, @antv/x6

**Spec:** `docs/superpowers/specs/2026-04-01-unified-floating-toolbar-design.md`

---

## File Structure

```
shell/src/components/shared/FloatingToolbar/
  index.tsx               — FloatingToolbar component (container, positioning, portal)
  ToolbarButton.tsx        — single icon button with active/hover states
  ToolbarSeparator.tsx     — vertical divider between groups
  ToolbarColorPicker.tsx   — color swatch grid popup (highlight, fill, border, cell bg, text color)
  ToolbarDropdown.tsx      — dropdown for multi-option items (font, size, heading, list, shape, etc.)
  types.ts                 — ToolbarItem, ToolbarState, ToolbarHandler interfaces
  presets.ts               — 10 item configurations

shell/src/components/editor/
  docs-toolbar-handler.ts  — DocsToolbarHandler (ProseMirror commands for text + table + image)

shell/src/components/presentation-editor/
  ppt-toolbar-handler.ts   — PPTToolbarHandler (Fabric.js operations for text + image + shape)

shell/src/components/diagram-editor/
  diagram-toolbar-handler.ts — DiagramToolbarHandler (X6 operations for node + edge + image)
```

---

### Task 1: Types and Interfaces

**Files:**
- Create: `shell/src/components/shared/FloatingToolbar/types.ts`

- [ ] **Step 1: Create types file**

```typescript
import type { ReactNode } from 'react';

/** A single button/control in the toolbar */
export interface ToolbarItem {
  /** Unique identifier: 'bold', 'italic', 'fillColor', etc. */
  key: string;
  /** Rendering type */
  type: 'toggle' | 'color' | 'dropdown' | 'action';
  /** Lucide icon element */
  icon: ReactNode;
  /** Tooltip text */
  label: string;
  /** Group name — separators inserted between different groups */
  group: string;
  /** For 'dropdown' type: selectable options */
  options?: { value: string; label: string; icon?: ReactNode }[];
  /** For 'color' type: preset color swatches */
  colors?: { name: string; value: string }[];
  /** Whether to show a "clear/remove" button in the color picker */
  colorClearable?: boolean;
}

/** Current state of toolbar buttons (active flags, selected values) */
export interface ToolbarState {
  [key: string]: boolean | string | undefined;
}

/** Engine-specific action dispatcher */
export interface ToolbarHandler {
  /** Get current active/selected state for all buttons */
  getState(): ToolbarState;
  /** Execute a toolbar action */
  execute(key: string, value?: unknown): void;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/types.ts
git commit -m "feat(toolbar): add ToolbarItem, ToolbarState, ToolbarHandler types"
```

---

### Task 2: ToolbarButton Component

**Files:**
- Create: `shell/src/components/shared/FloatingToolbar/ToolbarButton.tsx`

- [ ] **Step 1: Create ToolbarButton**

```tsx
'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface ToolbarButtonProps {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export function ToolbarButton({ active, onClick, title, children, className }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
      className={cn(
        'w-[26px] h-[26px] flex items-center justify-center rounded transition-colors',
        active
          ? 'bg-sidebar-primary text-white'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/ToolbarButton.tsx
git commit -m "feat(toolbar): add ToolbarButton component"
```

---

### Task 3: ToolbarSeparator Component

**Files:**
- Create: `shell/src/components/shared/FloatingToolbar/ToolbarSeparator.tsx`

- [ ] **Step 1: Create ToolbarSeparator**

```tsx
export function ToolbarSeparator() {
  return <div className="w-px h-[18px] bg-border mx-0.5" />;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/ToolbarSeparator.tsx
git commit -m "feat(toolbar): add ToolbarSeparator component"
```

---

### Task 4: ToolbarColorPicker Component

**Files:**
- Create: `shell/src/components/shared/FloatingToolbar/ToolbarColorPicker.tsx`

- [ ] **Step 1: Create ToolbarColorPicker**

A button that opens a color swatch grid popup. Used for highlight, fill color, border color, text color, cell background.

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ToolbarButton } from './ToolbarButton';
import type { ReactNode } from 'react';

interface ToolbarColorPickerProps {
  icon: ReactNode;
  label: string;
  colors: { name: string; value: string }[];
  active?: boolean;
  currentColor?: string;
  clearable?: boolean;
  onSelect: (color: string | undefined) => void;
}

export function ToolbarColorPicker({
  icon,
  label,
  colors,
  active,
  currentColor,
  clearable,
  onSelect,
}: ToolbarColorPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // Defer to avoid catching current click
    const id = setTimeout(() => document.addEventListener('mousedown', handler, true), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler, true); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <ToolbarButton active={active} onClick={() => setOpen((v) => !v)} title={label}>
        {icon}
      </ToolbarButton>
      {open && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-20 p-1.5 bg-popover border border-border rounded-lg shadow-xl flex gap-1 flex-wrap"
          style={{ minWidth: colors.length > 6 ? 180 : undefined }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {colors.map((c) => (
            <button
              key={c.value}
              onClick={() => { onSelect(c.value); setOpen(false); }}
              title={c.name}
              className={cn(
                'w-[22px] h-[22px] rounded border cursor-pointer p-0',
                currentColor === c.value ? 'border-foreground' : 'border-border hover:border-muted-foreground',
              )}
              style={{ background: c.value }}
            />
          ))}
          {clearable && (
            <button
              onClick={() => { onSelect(undefined); setOpen(false); }}
              title="Remove"
              className="w-[22px] h-[22px] rounded border border-border hover:border-muted-foreground cursor-pointer p-0 text-[11px] text-muted-foreground"
            >
              &times;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/ToolbarColorPicker.tsx
git commit -m "feat(toolbar): add ToolbarColorPicker component"
```

---

### Task 5: ToolbarDropdown Component

**Files:**
- Create: `shell/src/components/shared/FloatingToolbar/ToolbarDropdown.tsx`

- [ ] **Step 1: Create ToolbarDropdown**

Dropdown for multi-option items: font family, font size, shape picker, heading level, list type, connector type, line style, etc.

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface DropdownOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface ToolbarDropdownProps {
  icon?: ReactNode;
  label: string;
  options: DropdownOption[];
  value?: string;
  onSelect: (value: string) => void;
  /** Show current value as text instead of icon */
  showValue?: boolean;
  /** Min width for the dropdown button */
  minWidth?: number;
}

export function ToolbarDropdown({
  icon,
  label,
  options,
  value,
  onSelect,
  showValue,
  minWidth,
}: ToolbarDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler, true), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler, true); };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        title={label}
        className={cn(
          'h-[26px] flex items-center gap-0.5 px-1.5 rounded transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-accent text-xs',
        )}
        style={minWidth ? { minWidth } : undefined}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {showValue && <span className="truncate">{current?.label || value || label}</span>}
        <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-50" />
      </button>
      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 z-20 py-1 bg-popover border border-border rounded-lg shadow-xl min-w-[120px] max-h-[240px] overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onSelect(opt.value); setOpen(false); }}
              className={cn(
                'w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-accent transition-colors',
                opt.value === value && 'bg-accent/50 font-medium',
              )}
            >
              {opt.icon && <span className="flex-shrink-0">{opt.icon}</span>}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/ToolbarDropdown.tsx
git commit -m "feat(toolbar): add ToolbarDropdown component"
```

---

### Task 6: FloatingToolbar Container Component

**Files:**
- Create: `shell/src/components/shared/FloatingToolbar/index.tsx`

- [ ] **Step 1: Create FloatingToolbar**

The main container. Renders items from config, delegates actions to handler. Positioned via portal above an anchor rect.

```tsx
'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarSeparator } from './ToolbarSeparator';
import { ToolbarColorPicker } from './ToolbarColorPicker';
import { ToolbarDropdown } from './ToolbarDropdown';
import type { ToolbarItem, ToolbarHandler, ToolbarState } from './types';

export type { ToolbarItem, ToolbarHandler, ToolbarState };

interface FloatingToolbarProps {
  items: ToolbarItem[];
  handler: ToolbarHandler;
  /** Position anchor (viewport coordinates) */
  anchor: { top: number; left: number; width: number } | null;
  visible: boolean;
  className?: string;
}

export function FloatingToolbar({ items, handler, anchor, visible, className }: FloatingToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ToolbarState>({});
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Refresh state from handler
  const refreshState = useCallback(() => {
    setState(handler.getState());
  }, [handler]);

  useEffect(() => {
    if (visible) refreshState();
  }, [visible, refreshState]);

  // Position toolbar above anchor
  useEffect(() => {
    if (!visible || !anchor || !toolbarRef.current) return;
    const tb = toolbarRef.current.getBoundingClientRect();
    const top = anchor.top - tb.height - 6;
    const left = anchor.left + anchor.width / 2 - tb.width / 2;
    setPosition({
      top: Math.max(8, top),
      left: Math.max(8, Math.min(left, window.innerWidth - tb.width - 8)),
    });
  }, [visible, anchor, state]); // re-position when state changes (toolbar width may change)

  const handleExecute = useCallback((key: string, value?: unknown) => {
    handler.execute(key, value);
    // Refresh state after action
    setState(handler.getState());
  }, [handler]);

  if (!visible || !anchor) return null;

  // Build rendered items with separators between groups
  const rendered: React.ReactNode[] = [];
  let lastGroup: string | undefined;

  for (const item of items) {
    if (lastGroup !== undefined && item.group !== lastGroup) {
      rendered.push(<ToolbarSeparator key={`sep-${item.key}`} />);
    }
    lastGroup = item.group;

    switch (item.type) {
      case 'toggle':
        rendered.push(
          <ToolbarButton
            key={item.key}
            active={!!state[item.key]}
            onClick={() => handleExecute(item.key)}
            title={item.label}
          >
            {item.icon}
          </ToolbarButton>
        );
        break;

      case 'color':
        rendered.push(
          <ToolbarColorPicker
            key={item.key}
            icon={item.icon}
            label={item.label}
            colors={item.colors || []}
            active={!!state[item.key]}
            currentColor={typeof state[item.key] === 'string' ? state[item.key] as string : undefined}
            clearable={item.colorClearable}
            onSelect={(color) => handleExecute(item.key, color)}
          />
        );
        break;

      case 'dropdown':
        rendered.push(
          <ToolbarDropdown
            key={item.key}
            icon={item.icon}
            label={item.label}
            options={item.options || []}
            value={typeof state[item.key] === 'string' ? state[item.key] as string : undefined}
            onSelect={(val) => handleExecute(item.key, val)}
            showValue={true}
          />
        );
        break;

      case 'action':
        rendered.push(
          <ToolbarButton
            key={item.key}
            onClick={() => handleExecute(item.key)}
            title={item.label}
          >
            {item.icon}
          </ToolbarButton>
        );
        break;
    }
  }

  return createPortal(
    <div
      ref={toolbarRef}
      className={cn(
        'fixed z-[1000] flex items-center gap-0 px-[3px] py-[2px]',
        'bg-popover border border-border rounded-lg shadow-xl backdrop-blur-sm',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        className,
      )}
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {rendered}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/mac/Documents/asuite/shell && npx next build 2>&1 | tail -5
```

Expected: Build succeeds (component not imported yet, tree-shaken)

- [ ] **Step 3: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/
git commit -m "feat(toolbar): add unified FloatingToolbar component with sub-components"
```

---

### Task 7: Docs Text Toolbar Preset and Handler

**Files:**
- Create: `shell/src/components/shared/FloatingToolbar/presets.ts`
- Create: `shell/src/components/editor/docs-toolbar-handler.ts`

This is the most complex handler. It wraps all the ProseMirror command logic currently in `floating-toolbar.ts`.

- [ ] **Step 1: Create presets.ts with DOCS_TEXT_ITEMS**

Start with only the Docs text preset. Other presets will be added in later tasks.

```tsx
import {
  Bold, Italic, Strikethrough, Underline, Highlighter, Code2, Quote,
  Heading1, Heading2, Heading3, ListTodo, ListOrdered, List,
  Link, MessageSquare,
} from 'lucide-react';
import type { ToolbarItem } from './types';
import { createElement } from 'react';

const icon = (Icon: any) => createElement(Icon, { className: 'h-4 w-4' });

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: 'hsl(50 90% 60% / 0.3)' },
  { name: 'Orange', value: 'hsl(25 90% 60% / 0.3)' },
  { name: 'Red', value: 'hsl(0 80% 60% / 0.3)' },
  { name: 'Pink', value: 'hsl(330 80% 65% / 0.3)' },
  { name: 'Purple', value: 'hsl(270 60% 60% / 0.3)' },
  { name: 'Blue', value: 'hsl(210 70% 55% / 0.3)' },
  { name: 'Green', value: 'hsl(142 50% 50% / 0.3)' },
];

export const DOCS_TEXT_ITEMS: ToolbarItem[] = [
  { key: 'bold', type: 'toggle', icon: icon(Bold), label: 'Bold (Cmd+B)', group: 'inline' },
  { key: 'italic', type: 'toggle', icon: icon(Italic), label: 'Italic (Cmd+I)', group: 'inline' },
  { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: 'Strikethrough', group: 'inline' },
  { key: 'underline', type: 'toggle', icon: icon(Underline), label: 'Underline (Cmd+U)', group: 'inline' },
  { key: 'highlight', type: 'color', icon: icon(Highlighter), label: 'Highlight', group: 'style', colors: HIGHLIGHT_COLORS, colorClearable: true },
  { key: 'code', type: 'toggle', icon: icon(Code2), label: 'Inline code', group: 'style' },
  { key: 'blockquote', type: 'toggle', icon: icon(Quote), label: 'Quote', group: 'style' },
  { key: 'heading1', type: 'toggle', icon: icon(Heading1), label: 'Heading 1', group: 'heading' },
  { key: 'heading2', type: 'toggle', icon: icon(Heading2), label: 'Heading 2', group: 'heading' },
  { key: 'heading3', type: 'toggle', icon: icon(Heading3), label: 'Heading 3', group: 'heading' },
  { key: 'checkboxList', type: 'toggle', icon: icon(ListTodo), label: 'Checkbox list', group: 'list' },
  { key: 'orderedList', type: 'toggle', icon: icon(ListOrdered), label: 'Ordered list', group: 'list' },
  { key: 'bulletList', type: 'toggle', icon: icon(List), label: 'Bullet list', group: 'list' },
  { key: 'link', type: 'action', icon: icon(Link), label: 'Link', group: 'insert' },
  { key: 'comment', type: 'action', icon: icon(MessageSquare), label: 'Comment', group: 'insert' },
];
```

- [ ] **Step 2: Create docs-toolbar-handler.ts**

Move all ProseMirror command logic from `floating-toolbar.ts` into this handler class. Key functions: `isMarkActive`, `isBlockActive`, `toggleList`, `toggleBlockquote`, `setHeading`, `convertParentListType`, `liftOutOfWrapping`.

```typescript
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import type { EditorView } from 'prosemirror-view';
import type { NodeType } from 'prosemirror-model';
import type { ToolbarHandler, ToolbarState } from '@/components/shared/FloatingToolbar/types';
import { schema } from './schema';

const LIST_NODE_TYPES = new Set(['bullet_list', 'ordered_list', 'checkbox_list']);

function isMarkActive(view: EditorView, markName: string): boolean {
  const { state } = view;
  const { from, $from, to, empty } = state.selection;
  const markType = schema.marks[markName];
  if (!markType) return false;
  if (empty) return !!markType.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, markType);
}

function isBlockActive(view: EditorView, nodeType: NodeType, attrs?: Record<string, any>): boolean {
  const { $from } = view.state.selection;
  const isListCheck = LIST_NODE_TYPES.has(nodeType.name);
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (isListCheck && LIST_NODE_TYPES.has(node.type.name)) return node.type === nodeType;
    if (node.type === nodeType) {
      if (attrs) return Object.keys(attrs).every(k => node.attrs[k] === attrs[k]);
      return true;
    }
  }
  if ($from.parent.type === nodeType) {
    if (attrs) return Object.keys(attrs).every(k => $from.parent.attrs[k] === attrs[k]);
    return true;
  }
  return false;
}

function isInList(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type;
    if (t === schema.nodes.bullet_list || t === schema.nodes.ordered_list || t === schema.nodes.checkbox_list) return true;
  }
  return false;
}

function liftOutOfWrapping(view: EditorView): boolean {
  let changed = false;
  for (let i = 0; i < 5; i++) {
    const { state } = view;
    const { $from } = state.selection;
    let lifted = false;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type === schema.nodes.list_item || node.type === schema.nodes.checkbox_item) {
        if (liftListItem(node.type)(state, view.dispatch)) { lifted = true; changed = true; break; }
      }
    }
    if (!lifted) break;
  }
  if (lift(view.state, view.dispatch)) changed = true;
  return changed;
}

function convertNestedListContent(content: any, targetListType: NodeType): any {
  const targetItemType = targetListType === schema.nodes.checkbox_list
    ? schema.nodes.checkbox_item : schema.nodes.list_item;
  const LIST_TYPES = new Set([schema.nodes.bullet_list, schema.nodes.ordered_list, schema.nodes.checkbox_list]);
  const result: any[] = [];
  content.forEach((child: any) => {
    if (LIST_TYPES.has(child.type)) {
      const items: any[] = [];
      child.forEach((item: any) => {
        items.push(targetItemType.create(
          targetListType === schema.nodes.checkbox_list ? { checked: (item.attrs as any)?.checked ?? false } : null,
          convertNestedListContent(item.content, targetListType),
        ));
      });
      result.push(targetListType.create(child.attrs, items));
    } else {
      result.push(child);
    }
  });
  return result;
}

function convertParentListType(view: EditorView, targetListType: NodeType) {
  const { state } = view;
  const { $from } = state.selection;
  const targetItemType = targetListType === schema.nodes.checkbox_list
    ? schema.nodes.checkbox_item : schema.nodes.list_item;
  const LIST_TYPES = new Set([schema.nodes.bullet_list, schema.nodes.ordered_list, schema.nodes.checkbox_list]);
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (LIST_TYPES.has(node.type)) {
      const listPos = $from.before(d);
      const convertedItems: any[] = [];
      node.forEach((item: any) => {
        const newItem = targetItemType.create(
          targetListType === schema.nodes.checkbox_list ? { checked: (item.attrs as any)?.checked ?? false } : null,
          convertNestedListContent(item.content, targetListType),
        );
        convertedItems.push(newItem);
      });
      const newList = targetListType.create(node.attrs, convertedItems);
      view.dispatch(state.tr.replaceWith(listPos, listPos + node.nodeSize, newList));
      return;
    }
  }
}

function doToggleList(view: EditorView, listType: NodeType) {
  if (isBlockActive(view, listType)) {
    for (let i = 0; i < 10; i++) {
      const { $from } = view.state.selection;
      let lifted = false;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type === schema.nodes.list_item || node.type === schema.nodes.checkbox_item) {
          if (liftListItem(node.type)(view.state, view.dispatch)) lifted = true;
          break;
        }
      }
      if (!lifted) break;
    }
  } else if (isInList(view)) {
    convertParentListType(view, listType);
  } else {
    wrapInList(listType)(view.state, view.dispatch);
  }
  view.focus();
}

function doToggleBlockquote(view: EditorView) {
  if (isBlockActive(view, schema.nodes.blockquote)) {
    lift(view.state, view.dispatch);
  } else {
    if (isInList(view)) liftOutOfWrapping(view);
    wrapIn(schema.nodes.blockquote)(view.state, view.dispatch);
  }
  view.focus();
}

function doSetHeading(view: EditorView, level: number) {
  if (isBlockActive(view, schema.nodes.heading, { level })) {
    setBlockType(schema.nodes.paragraph)(view.state, view.dispatch);
  } else {
    setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch);
  }
  view.focus();
}

export function createDocsTextHandler(view: EditorView): ToolbarHandler {
  return {
    getState(): ToolbarState {
      return {
        bold: isMarkActive(view, 'strong'),
        italic: isMarkActive(view, 'em'),
        strikethrough: isMarkActive(view, 'strikethrough'),
        underline: isMarkActive(view, 'underline'),
        highlight: isMarkActive(view, 'highlight'),
        code: isMarkActive(view, 'code'),
        blockquote: isBlockActive(view, schema.nodes.blockquote),
        heading1: isBlockActive(view, schema.nodes.heading, { level: 1 }),
        heading2: isBlockActive(view, schema.nodes.heading, { level: 2 }),
        heading3: isBlockActive(view, schema.nodes.heading, { level: 3 }),
        checkboxList: isBlockActive(view, schema.nodes.checkbox_list),
        orderedList: isBlockActive(view, schema.nodes.ordered_list),
        bulletList: isBlockActive(view, schema.nodes.bullet_list),
      };
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'bold': toggleMark(schema.marks.strong)(view.state, view.dispatch); view.focus(); break;
        case 'italic': toggleMark(schema.marks.em)(view.state, view.dispatch); view.focus(); break;
        case 'strikethrough': toggleMark(schema.marks.strikethrough)(view.state, view.dispatch); view.focus(); break;
        case 'underline': toggleMark(schema.marks.underline)(view.state, view.dispatch); view.focus(); break;
        case 'code': toggleMark(schema.marks.code)(view.state, view.dispatch); view.focus(); break;
        case 'highlight': {
          const { from, to } = view.state.selection;
          if (from === to) break;
          if (value) {
            let tr = view.state.tr.removeMark(from, to, schema.marks.highlight);
            tr = tr.addMark(from, to, schema.marks.highlight.create({ color: value as string }));
            view.dispatch(tr);
          } else {
            view.dispatch(view.state.tr.removeMark(from, to, schema.marks.highlight));
          }
          view.focus();
          break;
        }
        case 'blockquote': doToggleBlockquote(view); break;
        case 'heading1': doSetHeading(view, 1); break;
        case 'heading2': doSetHeading(view, 2); break;
        case 'heading3': doSetHeading(view, 3); break;
        case 'checkboxList': doToggleList(view, schema.nodes.checkbox_list); break;
        case 'orderedList': doToggleList(view, schema.nodes.ordered_list); break;
        case 'bulletList': doToggleList(view, schema.nodes.bullet_list); break;
        case 'link': {
          const { state, dispatch } = view;
          const { from, to } = state.selection;
          if (from === to) break;
          if (state.doc.rangeHasMark(from, to, schema.marks.link)) {
            dispatch(state.tr.removeMark(from, to, schema.marks.link));
          } else {
            const href = prompt('Enter URL:');
            if (href) dispatch(state.tr.addMark(from, to, schema.marks.link.create({ href })));
          }
          view.focus();
          break;
        }
        case 'comment': {
          const { from, to } = view.state.selection;
          if (from === to) break;
          const selectedText = view.state.doc.textBetween(from, to, ' ');
          window.dispatchEvent(new CustomEvent('editor-comment', { detail: { text: selectedText } }));
          view.focus();
          break;
        }
      }
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/presets.ts shell/src/components/editor/docs-toolbar-handler.ts
git commit -m "feat(toolbar): add DOCS_TEXT preset and DocsToolbarHandler"
```

---

### Task 8: Integrate FloatingToolbar into Docs Editor

**Files:**
- Modify: `shell/src/components/editor/Editor.tsx`
- Modify: `shell/src/components/editor/floating-toolbar.ts` (will be replaced by a minimal plugin that reports selection state)

The old `floating-toolbar.ts` was a ProseMirror Plugin that created its own vanilla DOM toolbar. We need to replace it with a lightweight plugin that only tracks selection position and reports it to the React layer, where the new `FloatingToolbar` renders.

- [ ] **Step 1: Create a new selection-tracking plugin to replace floating-toolbar.ts**

Overwrite `shell/src/components/editor/floating-toolbar.ts` with a minimal plugin that emits selection rect info:

```typescript
/**
 * Floating toolbar selection tracker for ProseMirror.
 * Reports selection position to the React layer via a callback.
 * The actual toolbar UI is rendered by shared/FloatingToolbar.
 */
import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';

export const floatingToolbarKey = new PluginKey('floatingToolbar');

export interface SelectionInfo {
  /** Viewport coordinates for toolbar positioning */
  anchor: { top: number; left: number; width: number };
  /** The EditorView for creating handlers */
  view: EditorView;
}

type SelectionCallback = (info: SelectionInfo | null) => void;

export function floatingToolbarPlugin(onSelection: SelectionCallback): Plugin {
  let isMouseDown = false;
  let showTimeout: ReturnType<typeof setTimeout> | null = null;
  let isHovering = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  function computeAnchor(view: EditorView, from: number, to: number): SelectionInfo['anchor'] {
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    const midX = start.top === end.top
      ? (start.left + end.left) / 2
      : (start.left + view.dom.getBoundingClientRect().right) / 2;
    const width = start.top === end.top ? end.left - start.left : view.dom.getBoundingClientRect().width;
    return { top: start.top, left: midX - width / 2, width };
  }

  function shouldShow(view: EditorView): boolean {
    const { state } = view;
    const { selection } = state;
    const { from, to, empty } = selection;
    if (empty || from === to) return false;
    if (selection instanceof NodeSelection) return false;
    if (selection instanceof CellSelection) return false;
    const $from = state.doc.resolve(from);
    if ($from.parent.type === schema.nodes.code_block) return false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'table') return false;
    }
    return true;
  }

  function scheduleHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; }
    hideTimeout = setTimeout(() => {
      hideTimeout = null;
      if (!isHovering) onSelection(null);
    }, 150);
  }

  function showAt(view: EditorView) {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    const { from, to } = view.state.selection;
    onSelection({ anchor: computeAnchor(view, from, to), view });
  }

  return new Plugin({
    key: floatingToolbarKey,
    view(editorView) {
      // Expose hover tracking for the React toolbar to call
      const el = editorView.dom.closest('.outline-editor');
      if (el) {
        (el as any).__toolbarHover = (hovering: boolean) => {
          isHovering = hovering;
          if (hovering && hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        };
      }

      const onMouseDown = () => { isMouseDown = true; if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; } };
      const onMouseUp = () => {
        isMouseDown = false;
        showTimeout = setTimeout(() => {
          showTimeout = null;
          if (shouldShow(editorView)) showAt(editorView);
          else scheduleHide();
        }, 50);
      };
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);

      return {
        update(view) {
          if (isMouseDown) { onSelection(null); return; }
          if (shouldShow(view)) showAt(view);
          else scheduleHide();
        },
        destroy() {
          if (hideTimeout) clearTimeout(hideTimeout);
          if (showTimeout) clearTimeout(showTimeout);
          document.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mouseup', onMouseUp);
          onSelection(null);
        },
      };
    },
  });
}
```

- [ ] **Step 2: Update Editor.tsx to use FloatingToolbar**

In `Editor.tsx`:

1. Add imports:
```typescript
import { FloatingToolbar } from '../shared/FloatingToolbar';
import { DOCS_TEXT_ITEMS } from '../shared/FloatingToolbar/presets';
import { createDocsTextHandler } from './docs-toolbar-handler';
import type { SelectionInfo } from './floating-toolbar';
```

2. Add state for selection info:
```typescript
const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
```

3. Change the `floatingToolbarPlugin()` call (currently `import('./floating-toolbar')` in the async init) to pass the callback:
```typescript
// In the dynamic imports section, the import stays the same
// But the plugin creation changes from:
//   plugins.push(floatingToolbarPlugin());
// to:
//   plugins.push(floatingToolbarPlugin((info) => setSelectionInfo(info)));
```

4. Remove the `if (!readOnly)` guard around `floatingToolbarPlugin` — it should always be available but the toolbar decides whether to show edit actions based on readOnly.

Actually, keep the guard: in readOnly mode we don't want the toolbar at all.

5. Add the FloatingToolbar JSX before the closing `</div>`:
```tsx
{selectionInfo && !readOnly && (
  <FloatingToolbar
    items={DOCS_TEXT_ITEMS}
    handler={createDocsTextHandler(selectionInfo.view)}
    anchor={selectionInfo.anchor}
    visible={true}
  />
)}
```

6. Add hover tracking: the FloatingToolbar's `onMouseEnter`/`onMouseLeave` should call `editorRef.current?.__toolbarHover?.(true/false)`. Add this to the FloatingToolbar container `div`:
```tsx
onMouseEnter={() => {
  const el = document.querySelector('.outline-editor') as any;
  el?.__toolbarHover?.(true);
}}
onMouseLeave={() => {
  const el = document.querySelector('.outline-editor') as any;
  el?.__toolbarHover?.(false);
}}
```

Wait — this couples FloatingToolbar to Docs specifics. Better approach: pass `onHover` as a prop to FloatingToolbar.

Update `FloatingToolbarProps` to include:
```typescript
onHover?: (hovering: boolean) => void;
```

And in FloatingToolbar's container div:
```tsx
onMouseEnter={() => onHover?.(true)}
onMouseLeave={() => onHover?.(false)}
```

In Editor.tsx, pass:
```tsx
onHover={(hovering) => {
  const el = editorRef.current?.closest('.outline-editor') as any;
  el?.__toolbarHover?.(hovering);
}}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/mac/Documents/asuite/shell && npx next build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 4: Browser verify**

Open the Docs editor, select text, confirm the floating toolbar appears with all 15 buttons. Test:
- B/I/S/U toggles
- Highlight color picker
- Code toggle
- Blockquote
- H1/H2/H3
- Checkbox/ordered/bullet list
- Link
- Comment

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/editor/floating-toolbar.ts shell/src/components/editor/Editor.tsx shell/src/components/shared/FloatingToolbar/index.tsx
git commit -m "feat(toolbar): replace Docs floating toolbar with unified FloatingToolbar"
```

---

### Task 9: PPT Text Toolbar Preset and Handler

**Files:**
- Modify: `shell/src/components/shared/FloatingToolbar/presets.ts` (add PPT_TEXT_ITEMS)
- Create: `shell/src/components/presentation-editor/ppt-toolbar-handler.ts`
- Modify: `shell/src/components/presentation-editor/PresentationEditor.tsx`

- [ ] **Step 1: Add PPT_TEXT_ITEMS to presets.ts**

```tsx
import {
  Type, ALargeSmall, Bold, Italic, Strikethrough, Underline,
  AlignLeft, AlignCenter, AlignRight, Palette, Link, MessageSquare,
} from 'lucide-react';

const TEXT_COLORS = [
  { name: 'Black', value: '#1f2937' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
];

export const PPT_TEXT_ITEMS: ToolbarItem[] = [
  { key: 'textStyle', type: 'dropdown', icon: icon(Type), label: 'Text style', group: 'style',
    options: [
      { value: 'title', label: 'Title' },
      { value: 'headline', label: 'Headline' },
      { value: 'body', label: 'Body' },
      { value: 'caption', label: 'Caption' },
    ]},
  { key: 'fontFamily', type: 'dropdown', icon: null, label: 'Font', group: 'font',
    options: [
      { value: 'Inter', label: 'Inter' },
      { value: 'Roboto', label: 'Roboto' },
      { value: 'Arial', label: 'Arial' },
      { value: 'Georgia', label: 'Georgia' },
      { value: 'Helvetica', label: 'Helvetica' },
      { value: 'Times New Roman', label: 'Times New Roman' },
      { value: 'Courier New', label: 'Courier New' },
      { value: 'Noto Sans SC', label: 'Noto Sans SC' },
      { value: 'Noto Serif SC', label: 'Noto Serif SC' },
      { value: 'LXGW WenKai', label: 'LXGW WenKai' },
      { value: 'Source Code Pro', label: 'Source Code Pro' },
      { value: 'Fira Code', label: 'Fira Code' },
    ]},
  { key: 'fontSize', type: 'dropdown', icon: null, label: 'Font size', group: 'font',
    options: [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96].map(s => ({ value: String(s), label: String(s) })),
  },
  { key: 'bold', type: 'toggle', icon: icon(Bold), label: 'Bold', group: 'format' },
  { key: 'italic', type: 'toggle', icon: icon(Italic), label: 'Italic', group: 'format' },
  { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: 'Strikethrough', group: 'format' },
  { key: 'underline', type: 'toggle', icon: icon(Underline), label: 'Underline', group: 'format' },
  { key: 'align', type: 'dropdown', icon: icon(AlignLeft), label: 'Alignment', group: 'align',
    options: [
      { value: 'left', label: 'Left', icon: icon(AlignLeft) },
      { value: 'center', label: 'Center', icon: icon(AlignCenter) },
      { value: 'right', label: 'Right', icon: icon(AlignRight) },
    ]},
  { key: 'textColor', type: 'color', icon: icon(Palette), label: 'Text color', group: 'color', colors: TEXT_COLORS },
  { key: 'link', type: 'action', icon: icon(Link), label: 'Link', group: 'insert' },
  { key: 'comment', type: 'action', icon: icon(MessageSquare), label: 'Comment', group: 'insert' },
];
```

- [ ] **Step 2: Create ppt-toolbar-handler.ts**

```typescript
import type { ToolbarHandler, ToolbarState } from '@/components/shared/FloatingToolbar/types';

interface PPTTextTarget {
  obj: any;       // Fabric.js Textbox object
  canvas: any;    // Fabric.js Canvas
}

const TEXT_STYLE_MAP: Record<string, { fontSize: number; fontWeight: string; fontFamily: string }> = {
  title: { fontSize: 44, fontWeight: 'bold', fontFamily: 'Inter' },
  headline: { fontSize: 32, fontWeight: 'bold', fontFamily: 'Inter' },
  body: { fontSize: 18, fontWeight: 'normal', fontFamily: 'Inter' },
  caption: { fontSize: 14, fontWeight: 'normal', fontFamily: 'Inter' },
};

export function createPPTTextHandler(target: PPTTextTarget): ToolbarHandler {
  const { obj, canvas } = target;

  function refresh() {
    canvas.renderAll();
    canvas.fire('object:modified', { target: obj });
  }

  return {
    getState(): ToolbarState {
      return {
        textStyle: undefined, // no direct mapping back
        fontFamily: obj.fontFamily || 'Inter',
        fontSize: String(obj.fontSize || 18),
        bold: obj.fontWeight === 'bold',
        italic: obj.fontStyle === 'italic',
        strikethrough: !!obj.linethrough,
        underline: !!obj.underline,
        align: obj.textAlign || 'left',
        textColor: obj.fill || '#1f2937',
      };
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'textStyle': {
          const style = TEXT_STYLE_MAP[value as string];
          if (style) { obj.set(style); refresh(); }
          break;
        }
        case 'fontFamily': obj.set('fontFamily', value); refresh(); break;
        case 'fontSize': obj.set('fontSize', Number(value)); refresh(); break;
        case 'bold': obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold'); refresh(); break;
        case 'italic': obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic'); refresh(); break;
        case 'strikethrough': obj.set('linethrough', !obj.linethrough); refresh(); break;
        case 'underline': obj.set('underline', !obj.underline); refresh(); break;
        case 'align': obj.set('textAlign', value); refresh(); break;
        case 'textColor': obj.set('fill', value); refresh(); break;
        case 'link': { /* TODO: implement when PPT link system is ready */ break; }
        case 'comment': { /* TODO: implement when PPT comment system is ready */ break; }
      }
    },
  };
}
```

- [ ] **Step 3: Integrate into PresentationEditor.tsx**

1. Import `FloatingToolbar`, `PPT_TEXT_ITEMS`, `createPPTTextHandler`
2. Remove the existing `FloatingTextToolbar` function component (the one defined inside PresentationEditor.tsx)
3. Remove all JSX references to `FloatingTextToolbar`
4. Add state: `const [pptToolbarAnchor, setPptToolbarAnchor] = useState<{top:number;left:number;width:number}|null>(null);`
5. In the existing selection handler where `FloatingTextToolbar` was shown, compute anchor from the Fabric.js object's bounding rect and call `setPptToolbarAnchor`
6. Add FloatingToolbar JSX:
```tsx
{pptToolbarAnchor && selectedObj?.type === 'textbox' && canvasRef.current && (
  <FloatingToolbar
    items={PPT_TEXT_ITEMS}
    handler={createPPTTextHandler({ obj: selectedObj, canvas: canvasRef.current })}
    anchor={pptToolbarAnchor}
    visible={true}
  />
)}
```

- [ ] **Step 4: Build and browser verify**

```bash
cd /Users/mac/Documents/asuite/shell && npx next build 2>&1 | tail -10
```

Open PPT editor, select a text box, verify toolbar appears with: text style, font, size, B/I/S/U, align, color, link, comment.

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/presets.ts shell/src/components/presentation-editor/ppt-toolbar-handler.ts shell/src/components/presentation-editor/PresentationEditor.tsx
git commit -m "feat(toolbar): replace PPT text toolbar with unified FloatingToolbar"
```

---

### Task 10: Diagram Node/Edge/Image Toolbar Presets and Handler

**Files:**
- Modify: `shell/src/components/shared/FloatingToolbar/presets.ts` (add DIAGRAM_NODE_ITEMS, DIAGRAM_EDGE_ITEMS, DIAGRAM_IMAGE_ITEMS)
- Create: `shell/src/components/diagram-editor/diagram-toolbar-handler.ts`
- Modify: `shell/src/components/diagram-editor/components/FloatingToolbar.tsx` (replace with unified)
- Modify parent that renders FloatingToolbar (DiagramEditor or its parent)

- [ ] **Step 1: Add diagram presets to presets.ts**

Add `DIAGRAM_NODE_ITEMS`, `DIAGRAM_EDGE_ITEMS`, `DIAGRAM_IMAGE_ITEMS` with icons matching current Diagram FloatingToolbar buttons. Reference `diagram-editor/constants.ts` for color lists, font sizes, edge widths, connector types.

- [ ] **Step 2: Create diagram-toolbar-handler.ts**

```typescript
import type { ToolbarHandler, ToolbarState } from '@/components/shared/FloatingToolbar/types';
import type { Graph, Cell, Node, Edge } from '@antv/x6';

export function createDiagramNodeHandler(graph: Graph, cell: Cell): ToolbarHandler {
  const node = cell as Node;
  return {
    getState(): ToolbarState {
      const data = node.getData() || {};
      return {
        shapeSelect: data.flowchartShape || '',
        fillColor: data.bgColor || '',
        borderColor: data.borderColor || '',
        fontSize: String(data.fontSize || 14),
        bold: data.fontWeight === 'bold',
        italic: data.fontStyle === 'italic',
        strikethrough: !!data.textDecoration?.includes('line-through'),
        underline: !!data.textDecoration?.includes('underline'),
        align: data.textAlign || 'center',
      };
    },
    execute(key: string, value?: unknown) {
      const data = node.getData() || {};
      switch (key) {
        case 'shapeSelect': node.setData({ ...data, flowchartShape: value }); break;
        case 'fillColor': node.setData({ ...data, bgColor: value }); break;
        case 'borderColor': node.setData({ ...data, borderColor: value }); break;
        case 'fontSize': node.setData({ ...data, fontSize: Number(value) }); break;
        case 'bold': node.setData({ ...data, fontWeight: data.fontWeight === 'bold' ? 'normal' : 'bold' }); break;
        case 'italic': node.setData({ ...data, fontStyle: data.fontStyle === 'italic' ? 'normal' : 'italic' }); break;
        case 'strikethrough': {
          const has = data.textDecoration?.includes('line-through');
          node.setData({ ...data, textDecoration: has ? '' : 'line-through' });
          break;
        }
        case 'underline': {
          const has = data.textDecoration?.includes('underline');
          node.setData({ ...data, textDecoration: has ? '' : 'underline' });
          break;
        }
        case 'align': node.setData({ ...data, textAlign: value }); break;
        case 'copy': graph.copy([cell]); graph.paste(); break;
        case 'delete': graph.removeCells([cell]); break;
        case 'zOrder': {
          if (value === 'front') cell.toFront();
          else cell.toBack();
          break;
        }
      }
    },
  };
}

export function createDiagramEdgeHandler(graph: Graph, cell: Cell): ToolbarHandler {
  const edge = cell as Edge;
  return {
    getState(): ToolbarState {
      return {
        lineColor: edge.attr('line/stroke') || '#333',
        lineWidth: String(edge.attr('line/strokeWidth') || 2),
        lineStyle: edge.attr('line/strokeDasharray') ? 'dashed' : 'solid',
        connectorType: (edge.getRouter()?.name || 'manhattan') as string,
        arrowStyle: '', // complex, simplified
        label: (edge.getLabels()?.[0]?.attrs?.label?.text || '') as string,
      };
    },
    execute(key: string, value?: unknown) {
      switch (key) {
        case 'lineColor': edge.attr('line/stroke', value); break;
        case 'lineWidth': edge.attr('line/strokeWidth', Number(value)); break;
        case 'lineStyle': {
          const dashMap: Record<string, string> = { solid: '', dashed: '8,4', dotted: '2,4' };
          edge.attr('line/strokeDasharray', dashMap[value as string] || '');
          break;
        }
        case 'connectorType': {
          // Set router + connector based on type
          const routerMap: Record<string, any> = {
            straight: { name: '' },
            manhattan: { name: 'manhattan' },
            rounded: { name: 'manhattan' },
            smooth: { name: '' },
          };
          const connectorMap: Record<string, any> = {
            straight: { name: 'normal' },
            manhattan: { name: 'normal' },
            rounded: { name: 'rounded' },
            smooth: { name: 'smooth' },
          };
          const r = routerMap[value as string];
          const c = connectorMap[value as string];
          if (r?.name) edge.setRouter(r); else edge.removeRouter();
          if (c) edge.setConnector(c);
          break;
        }
        case 'label': edge.setLabels([{ attrs: { label: { text: value as string } } }]); break;
        case 'copy': graph.copy([cell]); graph.paste(); break;
        case 'delete': graph.removeCells([cell]); break;
        case 'zOrder': {
          if (value === 'front') cell.toFront();
          else cell.toBack();
          break;
        }
      }
    },
  };
}

export function createDiagramImageHandler(graph: Graph, cell: Cell): ToolbarHandler {
  return {
    getState(): ToolbarState { return {}; },
    execute(key: string, value?: unknown) {
      switch (key) {
        case 'replace': {
          graph.trigger('image:replace', { cell });
          break;
        }
        case 'copy': graph.copy([cell]); graph.paste(); break;
        case 'delete': graph.removeCells([cell]); break;
        case 'zOrder': {
          if (value === 'front') cell.toFront();
          else cell.toBack();
          break;
        }
      }
    },
  };
}
```

- [ ] **Step 3: Replace Diagram FloatingToolbar component**

Modify the parent component that currently renders `<FloatingToolbar graph={graph} />` from `diagram-editor/components/FloatingToolbar.tsx`.

Replace with the unified `<FloatingToolbar>` from shared, choosing the correct preset + handler based on selected cell type (node/edge/image).

The existing component tracks selection and position internally. Move that logic to the parent (or keep a thin wrapper) and pass `items`, `handler`, `anchor`, `visible` to the unified component.

- [ ] **Step 4: Build and browser verify**

Verify in Diagram editor: select a node (shape toolbar), select an edge (edge toolbar), select an image node (image toolbar).

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/presets.ts shell/src/components/diagram-editor/
git commit -m "feat(toolbar): replace Diagram toolbars with unified FloatingToolbar"
```

---

### Task 11: Docs Table, Docs Image, PPT Table Presets and Handlers

**Files:**
- Modify: `shell/src/components/shared/FloatingToolbar/presets.ts` (add remaining presets)
- Modify: `shell/src/components/editor/docs-toolbar-handler.ts` (add table + image handlers)
- Modify: `shell/src/components/editor/table-menu-plugin.ts` (replace cell toolbar with unified)
- Modify: `shell/src/components/editor/node-views.ts` (replace image toolbar with unified)

- [ ] **Step 1: Add DOCS_TABLE_ITEMS, PPT_TABLE_ITEMS, DOCS_IMAGE_ITEMS, PPT_IMAGE_ITEMS, PPT_SHAPE_ITEMS, DIAGRAM_IMAGE_ITEMS to presets.ts**

Each preset follows the pattern established in Tasks 7 and 9 — an array of `ToolbarItem` objects with correct groups, icons, types.

- [ ] **Step 2: Add createDocsTableHandler to docs-toolbar-handler.ts**

Wraps table commands from `table-menu-plugin.ts`: `toggleHeaderRow`, `toggleHeaderColumn`, `mergeCells`, `splitCell`, plus inline formatting on CellSelection.

- [ ] **Step 3: Add createDocsImageHandler to docs-toolbar-handler.ts**

Wraps image node operations: align left/center/right/full/fit, replace, download, delete, alt text, comment.

- [ ] **Step 4: Update table-menu-plugin.ts**

Replace `showCellToolbar()` vanilla DOM rendering with a callback that signals the React layer to render `<FloatingToolbar items={DOCS_TABLE_ITEMS} handler={...} />`.

- [ ] **Step 5: Update node-views.ts**

Replace `buildToolbar()` vanilla DOM rendering for images with a callback/event that triggers the React FloatingToolbar with `DOCS_IMAGE_ITEMS`.

- [ ] **Step 6: Build and browser verify all scenarios**

- Docs: select text (text toolbar), select cells (table toolbar), select image (image toolbar)
- PPT: select text box (text toolbar)
- Diagram: select node/edge/image (respective toolbars)

- [ ] **Step 7: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/shared/FloatingToolbar/presets.ts shell/src/components/editor/
git commit -m "feat(toolbar): add Docs table/image and PPT table/image/shape toolbar presets"
```

---

### Task 12: PPT Image + Shape Presets and Handler

**Files:**
- Modify: `shell/src/components/presentation-editor/ppt-toolbar-handler.ts` (add image + shape handlers)
- Modify: `shell/src/components/presentation-editor/PresentationEditor.tsx`

- [ ] **Step 1: Add createPPTImageHandler and createPPTShapeHandler**

PPT image handler: replace, copy, delete, zOrder (4 buttons).
PPT shape handler: shapeSelect, fillColor, borderColor, borderWidth, borderStyle, textColor, cornerRadius, copy, delete, zOrder.

- [ ] **Step 2: Update PresentationEditor.tsx**

Show different toolbar based on selected object type:
- `textbox` → PPT_TEXT_ITEMS + createPPTTextHandler
- `image` → PPT_IMAGE_ITEMS + createPPTImageHandler
- `rect`/`circle`/`triangle` → PPT_SHAPE_ITEMS + createPPTShapeHandler
- table objects → handled by RichTable's own toolbar (unchanged)

- [ ] **Step 3: Build and browser verify**

- [ ] **Step 4: Commit**

```bash
cd /Users/mac/Documents/asuite
git add shell/src/components/presentation-editor/
git commit -m "feat(toolbar): add PPT image and shape toolbars via unified FloatingToolbar"
```

---

### Task 13: Cleanup Dead Code

**Files:**
- Delete: `shell/src/components/shared/TextToolbar.tsx`
- Delete: `shell/src/components/shared/RichText/FloatingToolbar.tsx`
- Delete: `shell/src/components/shared/RichText/toolbar-items.ts`
- Delete or gut: `shell/src/components/diagram-editor/components/FloatingToolbar.tsx`
- Remove: inline `FloatingTextToolbar` from PresentationEditor.tsx (if not already done in Task 9)

- [ ] **Step 1: Delete unused files**

```bash
cd /Users/mac/Documents/asuite
rm shell/src/components/shared/TextToolbar.tsx
rm shell/src/components/shared/RichText/FloatingToolbar.tsx
rm shell/src/components/shared/RichText/toolbar-items.ts
```

- [ ] **Step 2: Verify no imports reference deleted files**

```bash
cd /Users/mac/Documents/asuite/shell
grep -r "TextToolbar\|RichText/FloatingToolbar\|RichText/toolbar-items" src/ --include="*.ts" --include="*.tsx"
```

Expected: No matches (or only the deleted files themselves).

- [ ] **Step 3: Build verify**

```bash
cd /Users/mac/Documents/asuite/shell && npx next build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
cd /Users/mac/Documents/asuite
git add -A shell/src/components/shared/TextToolbar.tsx shell/src/components/shared/RichText/FloatingToolbar.tsx shell/src/components/shared/RichText/toolbar-items.ts shell/src/components/diagram-editor/components/FloatingToolbar.tsx
git commit -m "chore: remove superseded toolbar implementations"
```

---

## Verification Checklist

After all tasks, verify in browser:

- [ ] Docs: select text → 15-button toolbar (B/I/S/U/highlight/code/quote/H1-3/lists/link/comment)
- [ ] Docs: select table cells → table toolbar (header/merge/split/cellBg/formatting)
- [ ] Docs: select image → image toolbar (align/replace/download/delete/alt/comment)
- [ ] PPT: select text box → PPT text toolbar (style/font/size/B/I/S/U/align/color/link/comment)
- [ ] PPT: select image → PPT image toolbar (replace/copy/delete/zOrder)
- [ ] PPT: select shape → PPT shape toolbar (shape/fill/border/color/radius/copy/delete/zOrder)
- [ ] Diagram: select node → node toolbar (shape/fill/border/size/B/I/S/U/align/copy/delete/zOrder)
- [ ] Diagram: select edge → edge toolbar (color/width/style/connector/arrow/label/copy/delete/zOrder)
- [ ] Diagram: select image → image toolbar (replace/copy/delete/zOrder)
- [ ] All toolbars share identical visual style (same padding, border-radius, shadow, button size)
- [ ] Color pickers work consistently across all contexts
- [ ] Toolbar hover keeps it visible (doesn't flicker/disappear)
- [ ] Build passes with no TypeScript errors
