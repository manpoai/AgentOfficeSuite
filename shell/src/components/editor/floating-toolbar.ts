/**
 * Floating toolbar plugin for ProseMirror.
 * Appears when text is selected, showing inline formatting options.
 */
import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import type { NodeType } from 'prosemirror-model';
import { schema } from './schema';
import { getT } from '@/lib/i18n';

export const floatingToolbarKey = new PluginKey('floatingToolbar');

type ToolbarSection = 'inline' | 'separator' | 'block';

interface ToolbarAction {
  label: string;
  icon: string;
  mark?: string;
  section: ToolbarSection;
  isActive?: (view: EditorView) => boolean;
  command: (view: EditorView) => void;
}

const LIST_NODE_TYPES = new Set(['bullet_list', 'ordered_list', 'checkbox_list']);

function isBlockActive(view: EditorView, nodeType: NodeType, attrs?: Record<string, any>): boolean {
  const { state } = view;
  const { $from } = state.selection;
  const isListCheck = LIST_NODE_TYPES.has(nodeType.name);

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    // For list types: only check the nearest ancestor list, not all ancestors
    if (isListCheck && LIST_NODE_TYPES.has(node.type.name)) {
      return node.type === nodeType;
    }
    if (node.type === nodeType) {
      if (attrs) {
        return Object.keys(attrs).every(k => node.attrs[k] === attrs[k]);
      }
      return true;
    }
  }
  if ($from.parent.type === nodeType) {
    if (attrs) {
      return Object.keys(attrs).every(k => $from.parent.attrs[k] === attrs[k]);
    }
    return true;
  }
  return false;
}

/** Check if cursor is inside any list */
function isInList(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type;
    if (t === schema.nodes.bullet_list || t === schema.nodes.ordered_list || t === schema.nodes.checkbox_list) return true;
  }
  return false;
}

/** Lift content out of all wrapping lists/blockquotes before changing block type */
function liftOutOfWrapping(view: EditorView): boolean {
  let changed = false;
  // Try lifting out of list items first, then blockquotes
  for (let i = 0; i < 5; i++) {
    const { state } = view;
    const { $from } = state.selection;
    let lifted = false;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type === schema.nodes.list_item || node.type === schema.nodes.checkbox_item) {
        if (liftListItem(node.type)(state, view.dispatch)) {
          lifted = true;
          changed = true;
          break;
        }
      }
    }
    if (!lifted) break;
  }
  // Try lift from blockquote
  if (lift(view.state, view.dispatch)) changed = true;
  return changed;
}

/** Set heading — works inside lists too (schema allows heading as first child of list_item) */
function setHeading(view: EditorView, level: number) {
  if (isBlockActive(view, schema.nodes.heading, { level })) {
    // Toggle off: convert back to paragraph
    setBlockType(schema.nodes.paragraph)(view.state, view.dispatch);
  } else {
    setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch);
  }
  view.focus();
}

/** Toggle list type — converts in-place to preserve indentation */
function toggleList(view: EditorView, listType: NodeType) {
  if (isBlockActive(view, listType)) {
    // Unwrap: lift out of ALL list levels until no longer in a list
    for (let i = 0; i < 10; i++) {
      const { $from } = view.state.selection;
      let lifted = false;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type === schema.nodes.list_item || node.type === schema.nodes.checkbox_item) {
          if (liftListItem(node.type)(view.state, view.dispatch)) {
            lifted = true;
          }
          break;
        }
      }
      if (!lifted) break;
    }
  } else if (isInList(view)) {
    // Already in a list but different type — convert parent list in-place
    convertParentListType(view, listType);
  } else {
    // Not in any list — wrap fresh
    wrapInList(listType)(view.state, view.dispatch);
  }
  view.focus();
}

/** Convert the nearest ancestor list to a different list type, preserving nesting */
function convertParentListType(view: EditorView, targetListType: NodeType) {
  const { state } = view;
  const { $from } = state.selection;
  const targetItemType = targetListType === schema.nodes.checkbox_list
    ? schema.nodes.checkbox_item : schema.nodes.list_item;
  const LIST_TYPES = new Set([schema.nodes.bullet_list, schema.nodes.ordered_list, schema.nodes.checkbox_list]);

  // Find the nearest ancestor list node
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (LIST_TYPES.has(node.type)) {
      const listPos = $from.before(d);
      // Convert items (list_item ↔ checkbox_item) while preserving all content
      const convertedItems: any[] = [];
      node.forEach((item: any) => {
        const newItem = targetItemType.create(
          targetListType === schema.nodes.checkbox_list
            ? { checked: (item.attrs as any)?.checked ?? false } : null,
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

/** Recursively convert nested list content when switching list types */
function convertNestedListContent(content: any, targetListType: NodeType): any {
  const targetItemType = targetListType === schema.nodes.checkbox_list
    ? schema.nodes.checkbox_item : schema.nodes.list_item;
  const LIST_TYPES = new Set([schema.nodes.bullet_list, schema.nodes.ordered_list, schema.nodes.checkbox_list]);
  const result: any[] = [];
  content.forEach((child: any) => {
    if (LIST_TYPES.has(child.type)) {
      // Nested list — convert recursively
      const items: any[] = [];
      child.forEach((item: any) => {
        items.push(targetItemType.create(
          targetListType === schema.nodes.checkbox_list
            ? { checked: (item.attrs as any)?.checked ?? false } : null,
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

/** Toggle blockquote */
function toggleBlockquote(view: EditorView) {
  if (isBlockActive(view, schema.nodes.blockquote)) {
    lift(view.state, view.dispatch);
  } else {
    if (isInList(view)) liftOutOfWrapping(view);
    wrapIn(schema.nodes.blockquote)(view.state, view.dispatch);
  }
  view.focus();
}

// Highlight colors matching Outline
const HIGHLIGHT_COLORS = [
  { name: 'Yellow', color: 'hsl(50 90% 60% / 0.3)', css: 'hsl(50 90% 60% / 0.3)' },
  { name: 'Orange', color: 'hsl(25 90% 60% / 0.3)', css: 'hsl(25 90% 60% / 0.3)' },
  { name: 'Red', color: 'hsl(0 80% 60% / 0.3)', css: 'hsl(0 80% 60% / 0.3)' },
  { name: 'Pink', color: 'hsl(330 80% 65% / 0.3)', css: 'hsl(330 80% 65% / 0.3)' },
  { name: 'Purple', color: 'hsl(270 60% 60% / 0.3)', css: 'hsl(270 60% 60% / 0.3)' },
  { name: 'Blue', color: 'hsl(210 70% 55% / 0.3)', css: 'hsl(210 70% 55% / 0.3)' },
  { name: 'Green', color: 'hsl(142 50% 50% / 0.3)', css: 'hsl(142 50% 50% / 0.3)' },
];

// Lucide SVG icons (16x16, stroke-width 2)
const LUCIDE = {
  bold: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>',
  italic: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>',
  strikethrough: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>',
  underline: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/></svg>',
  highlighter: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
  codeXml: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>',
  quote: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/></svg>',
  heading1: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>',
  heading2: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>',
  heading3: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>',
  listTodo: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><line x1="13" x2="21" y1="6" y2="6"/><line x1="13" x2="21" y1="12" y2="12"/><line x1="13" x2="21" y1="18" y2="18"/></svg>',
  listOrdered: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>',
  list: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
  link: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  messageSquare: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
};

function buildToolbarActions(): ToolbarAction[] {
  const t = getT();
  return [
    // Group 1: Regular styles
    {
      label: t('editor.bold'), icon: LUCIDE.bold, mark: 'strong', section: 'inline',
      command: (view) => { toggleMark(schema.marks.strong)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.italic'), icon: LUCIDE.italic, mark: 'em', section: 'inline',
      command: (view) => { toggleMark(schema.marks.em)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.strikethrough'), icon: LUCIDE.strikethrough, mark: 'strikethrough', section: 'inline',
      command: (view) => { toggleMark(schema.marks.strikethrough)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.underline'), icon: LUCIDE.underline, mark: 'underline', section: 'inline',
      command: (view) => { toggleMark(schema.marks.underline)(view.state, view.dispatch); view.focus(); },
    },
    // Group 2: Advanced styles
    {
      label: t('editor.highlight'), icon: LUCIDE.highlighter, mark: 'highlight', section: 'block',
      command: (view) => { toggleMark(schema.marks.highlight)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.inlineCode'), icon: LUCIDE.codeXml, mark: 'code', section: 'block',
      command: (view) => { toggleMark(schema.marks.code)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.quote'), icon: LUCIDE.quote, section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.blockquote),
      command: (view) => toggleBlockquote(view),
    },
    // Group 3: Headings
    {
      label: t('editor.heading1'), icon: LUCIDE.heading1, section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 1 }),
      command: (view) => setHeading(view, 1),
    },
    {
      label: t('editor.heading2'), icon: LUCIDE.heading2, section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 2 }),
      command: (view) => setHeading(view, 2),
    },
    {
      label: t('editor.heading3'), icon: LUCIDE.heading3, section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 3 }),
      command: (view) => setHeading(view, 3),
    },
    // Group 4: Lists
    {
      label: t('editor.checkboxList') || 'Checkbox', icon: LUCIDE.listTodo, section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.checkbox_list),
      command: (view) => toggleList(view, schema.nodes.checkbox_list),
    },
    {
      label: t('editor.orderedList'), icon: LUCIDE.listOrdered, section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.ordered_list),
      command: (view) => toggleList(view, schema.nodes.ordered_list),
    },
    {
      label: t('editor.bulletList'), icon: LUCIDE.list, section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.bullet_list),
      command: (view) => toggleList(view, schema.nodes.bullet_list),
    },
    // Group 5: Link + Comment
    {
      label: t('editor.link'), icon: LUCIDE.link, section: 'block',
      command: (view) => {
        const { state, dispatch } = view;
        const { from, to } = state.selection;
        if (from === to) return;
        const existingLink = state.doc.rangeHasMark(from, to, schema.marks.link);
        if (existingLink) {
          dispatch(state.tr.removeMark(from, to, schema.marks.link));
          view.focus();
          return;
        }
        const href = prompt(t('editor.linkPrompt'));
        if (href) {
          dispatch(state.tr.addMark(from, to, schema.marks.link.create({ href })));
        }
        view.focus();
      },
    },
    {
      label: t('editor.comment'), icon: LUCIDE.messageSquare, section: 'block',
      command: (view) => {
        const { state } = view;
        const { from, to } = state.selection;
        if (from === to) return;
        const selectedText = state.doc.textBetween(from, to, ' ');
        window.dispatchEvent(new CustomEvent('editor-comment', { detail: { text: selectedText } }));
        view.focus();
      },
    },
  ];
}

function isMarkActive(view: EditorView, markName: string): boolean {
  const { state } = view;
  const { from, $from, to, empty } = state.selection;
  const markType = schema.marks[markName];
  if (!markType) return false;
  if (empty) {
    return !!markType.isInSet(state.storedMarks || $from.marks());
  }
  return state.doc.rangeHasMark(from, to, markType);
}

function createToolbarDOM(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'floating-toolbar';
  el.style.cssText = `
    position: fixed; z-index: 1000; display: none;
    background: hsl(var(--popover, 0 0% 100%)); border: 1px solid hsl(var(--border, 0 0% 90%));
    border-radius: 8px; padding: 2px 3px; gap: 0px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    display: none; flex-direction: row; align-items: center;
    backdrop-filter: blur(8px);
  `;
  return el;
}

function addSeparator(el: HTMLDivElement) {
  const sep = document.createElement('div');
  sep.style.cssText = 'width: 1px; height: 18px; background: hsl(var(--border, 0 0% 90%)); margin: 0 2px;';
  el.appendChild(sep);
}

/** Create a highlight color picker popup */
function createHighlightPicker(view: EditorView, anchorBtn: HTMLElement, toolbarEl: HTMLDivElement): HTMLDivElement {
  // Outer wrapper with padding to bridge the gap between picker and button (prevents mouseleave)
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    padding-bottom: 4px;
  `;
  const picker = document.createElement('div');
  picker.style.cssText = `
    background: hsl(var(--popover, 0 0% 100%)); border: 1px solid hsl(var(--border, 0 0% 90%));
    border-radius: 8px; padding: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    display: flex; gap: 4px;
  `;
  wrapper.appendChild(picker);

  for (const color of HIGHLIGHT_COLORS) {
    const swatch = document.createElement('button');
    swatch.style.cssText = `
      width: 22px; height: 22px; border-radius: 4px; border: 1px solid hsl(var(--border, 0 0% 85%));
      cursor: pointer; background: ${color.css}; padding: 0;
    `;
    swatch.title = color.name;
    swatch.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { from, to } = view.state.selection;
      if (from === to) return;
      // Remove existing highlight first
      let tr = view.state.tr.removeMark(from, to, schema.marks.highlight);
      // Add highlight with color
      tr = tr.addMark(from, to, schema.marks.highlight.create({ color: color.css }));
      view.dispatch(tr);
      view.focus();
      wrapper.remove();
      pickerOpen = false;
      removeClickOutside();
    };
    picker.appendChild(swatch);
  }

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.textContent = '✕';
  removeBtn.style.cssText = `
    width: 22px; height: 22px; border-radius: 4px; border: 1px solid hsl(var(--border, 0 0% 85%));
    cursor: pointer; background: transparent; padding: 0; font-size: 11px;
    color: hsl(var(--muted-foreground, 0 0% 45%));
  `;
  removeBtn.title = 'Remove highlight';
  removeBtn.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const { from, to } = view.state.selection;
    view.dispatch(view.state.tr.removeMark(from, to, schema.marks.highlight));
    view.focus();
    wrapper.remove();
    pickerOpen = false;
    removeClickOutside();
  };
  picker.appendChild(removeBtn);

  // Click outside to close picker
  const onClickOutside = (e: MouseEvent) => {
    if (!wrapper.contains(e.target as Node) && !anchorBtn.contains(e.target as Node)) {
      wrapper.remove();
      pickerOpen = false;
      removeClickOutside();
    }
  };
  const removeClickOutside = () => {
    document.removeEventListener('mousedown', onClickOutside, true);
  };
  // Defer to avoid catching the current mousedown event
  setTimeout(() => {
    document.addEventListener('mousedown', onClickOutside, true);
  }, 0);

  return wrapper;
}

function renderToolbar(el: HTMLDivElement, view: EditorView) {
  el.innerHTML = '';
  const TOOLBAR_ACTIONS = buildToolbarActions();
  // Separator indices: after group1 (4), after group2 (7), after group3 (10), after group4 (13)
  const separatorBefore = new Set([4, 7, 10, 13]);

  TOOLBAR_ACTIONS.forEach((action, i) => {
    if (separatorBefore.has(i)) addSeparator(el);

    const btn = document.createElement('button');
    const active = action.mark
      ? isMarkActive(view, action.mark)
      : action.isActive ? action.isActive(view) : false;

    btn.style.cssText = `
      width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
      border: none; border-radius: 4px; cursor: pointer;
      color: ${active ? '#fff' : 'hsl(var(--muted-foreground, 0 0% 45%))'};
      background: ${active ? 'hsl(var(--sidebar-primary, 228 80% 60%))' : 'transparent'};
      padding: 0;
      transition: all 0.1s;
    `;
    btn.title = action.label;
    btn.innerHTML = action.icon;
    btn.onmouseenter = () => {
      if (!active) { btn.style.background = 'hsl(var(--accent, 0 0% 96%))'; btn.style.color = 'hsl(var(--foreground, 0 0% 9%))'; }
    };
    btn.onmouseleave = () => {
      if (!active) { btn.style.background = 'transparent'; btn.style.color = 'hsl(var(--muted-foreground, 0 0% 45%))'; }
    };

    // Special handling for highlight — click toggles color picker
    if (action.mark === 'highlight') {
      btn.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        // If already highlighted, just toggle off
        if (active) {
          const { from, to } = view.state.selection;
          view.dispatch(view.state.tr.removeMark(from, to, schema.marks.highlight));
          view.focus();
          pickerOpen = false;
          setTimeout(() => renderToolbar(el, view), 0);
          return;
        }
        // Toggle color picker
        const existing = el.querySelector('.highlight-picker');
        if (existing) { existing.remove(); pickerOpen = false; return; }
        pickerOpen = true;
        const picker = createHighlightPicker(view, btn, el);
        picker.className = 'highlight-picker';
        btn.style.position = 'relative';
        btn.appendChild(picker);
      };
    } else {
      btn.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        action.command(view);
        setTimeout(() => renderToolbar(el, view), 0);
      };
    }
    el.appendChild(btn);
  });
}

// Module-level flag: when true, renderToolbar is skipped (e.g. highlight picker is open)
let pickerOpen = false;

export function floatingToolbarPlugin(): Plugin {
  let toolbarEl: HTMLDivElement | null = null;
  let isShown = false;
  let isHovering = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  let isMouseDown = false;
  let showTimeout: ReturnType<typeof setTimeout> | null = null;

  function showAt(view: EditorView, from: number, to: number) {
    if (!toolbarEl) return;
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }

    // Don't re-render if highlight picker is open — it would destroy the picker
    if (!pickerOpen) {
      renderToolbar(toolbarEl, view);
    }

    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    // Use viewport coordinates (fixed positioning)
    // When selection spans multiple lines, use the midpoint of the first line
    const midX = start.top === end.top
      ? (start.left + end.left) / 2
      : (start.left + view.dom.getBoundingClientRect().right) / 2;

    toolbarEl.style.display = 'flex';
    // Force reflow to get accurate dimensions
    const toolbarWidth = toolbarEl.getBoundingClientRect().width || 400;
    const toolbarHeight = toolbarEl.getBoundingClientRect().height || 44;
    const top = start.top - toolbarHeight - 4; // above the selection
    const leftPos = Math.max(8, Math.min(midX - toolbarWidth / 2, window.innerWidth - toolbarWidth - 8));
    let finalTop = Math.max(8, top);
    if (finalTop + toolbarHeight > window.innerHeight - 8) {
      finalTop = window.innerHeight - toolbarHeight - 8;
    }
    toolbarEl.style.left = `${leftPos}px`;
    toolbarEl.style.top = `${finalTop}px`;
    isShown = true;
  }

  function hide() {
    if (!toolbarEl) return;
    if (isHovering) return;
    toolbarEl.style.display = 'none';
    isShown = false;
  }

  function scheduleHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; }
    hideTimeout = setTimeout(() => {
      hideTimeout = null;
      hide();
    }, 150);
  }

  return new Plugin({
    key: floatingToolbarKey,
    view(editorView) {
      toolbarEl = createToolbarDOM();
      toolbarEl.addEventListener('mouseenter', () => { isHovering = true; if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; } });
      toolbarEl.addEventListener('mouseleave', () => { isHovering = false; });
      document.body.appendChild(toolbarEl);

      const onMouseDown = () => { isMouseDown = true; if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; } };
      const onMouseUp = () => {
        isMouseDown = false;
        showTimeout = setTimeout(() => {
          showTimeout = null;
          const { state } = editorView;
          const { selection } = state;
          // Don't show text toolbar for node selections (e.g. image)
          if (selection instanceof NodeSelection) {
            scheduleHide();
            return;
          }
          // Don't show in tables — table-menu-plugin handles its own toolbar
          if (selection instanceof CellSelection) {
            scheduleHide();
            return;
          }
          const { from, to, empty } = selection;
          if (!empty && from !== to) {
            const $from = state.doc.resolve(from);
            if ($from.parent.type !== schema.nodes.code_block) {
              // Don't show floating toolbar when inside a table
              for (let d = $from.depth; d > 0; d--) {
                if ($from.node(d).type.name === 'table') { scheduleHide(); return; }
              }
              showAt(editorView, from, to);
            }
          }
        }, 50);
      };
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);

      return {
        update(view, prevState) {
          const { state } = view;
          const { selection } = state;
          const { from, to, empty } = selection;

          if (empty || from === to) {
            if (isHovering) return;
            scheduleHide();
            return;
          }

          if (isMouseDown) {
            hide();
            return;
          }

          // Hide toolbar for node selections (e.g. image selected)
          if (selection instanceof NodeSelection) {
            scheduleHide();
            return;
          }

          // Don't show in tables — table-menu-plugin handles its own toolbar
          if (selection instanceof CellSelection) {
            scheduleHide();
            return;
          }

          const $from = state.doc.resolve(from);
          if ($from.parent.type === schema.nodes.code_block) {
            scheduleHide();
            return;
          }

          // Don't show floating toolbar when inside a table
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'table') {
              scheduleHide();
              return;
            }
          }

          showAt(view, from, to);
        },
        destroy() {
          if (hideTimeout) clearTimeout(hideTimeout);
          if (showTimeout) clearTimeout(showTimeout);
          document.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mouseup', onMouseUp);
          toolbarEl?.remove();
          toolbarEl = null;
        },
      };
    },
  });
}
