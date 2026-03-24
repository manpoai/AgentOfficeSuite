/**
 * Block handle plugin for ProseMirror.
 *
 * Design (matches Outline):
 * - Hover over a block → handle appears on the left
 * - Handle has TWO parts:
 *   - Left part (⊞ grid icon): click → block type menu + operations
 *   - Right part (⠿ drag dots): mousedown+drag → reorder blocks
 * - Empty paragraphs: no handle (conflicts with slash menu "+")
 * - Debounced positioning to prevent flickering
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { getT } from '@/lib/i18n';

export const blockHandleKey = new PluginKey('blockHandle');

const LIST_TYPES = new Set(['bullet_list', 'ordered_list', 'checkbox_list']);
const LIST_ITEM_TYPES = new Set(['list_item', 'checkbox_item']);
// Node types where menu should only show copy + delete (no type conversion)
const OPAQUE_BLOCK_TYPES = new Set(['table', 'image']);

/**
 * Resolve a mouse-Y to the block under it.
 * For list items: resolves to the individual list_item, not the whole list.
 * For everything else: resolves to the top-level block.
 */
function blockAtCoords(view: EditorView, y: number): { pos: number; end: number; node: any; dom: HTMLElement | null; depth: number; parentListPos: number | null } | null {
  const editorRect = view.dom.getBoundingClientRect();

  // Try posAtCoords at several x positions for robustness
  // Use multiple x positions: left edge, indented (for lists), center, and right
  let coords = view.posAtCoords({ left: editorRect.left + 10, top: y });
  if (!coords) coords = view.posAtCoords({ left: editorRect.left + 60, top: y });
  if (!coords) coords = view.posAtCoords({ left: editorRect.left + editorRect.width / 2, top: y });
  // Try the very left edge — helps when hovering over contenteditable=false (images)
  if (!coords) coords = view.posAtCoords({ left: editorRect.left + 1, top: y });
  if (!coords) return null;

  let $pos = view.state.doc.resolve(coords.pos);

  // If depth is 0 (doc level), try harder with DOM scan
  if ($pos.depth < 1) {
    // Try indented x position first (might land inside list content)
    const altCoords = view.posAtCoords({ left: editorRect.left + 60, top: y });
    if (altCoords) {
      const alt$pos = view.state.doc.resolve(altCoords.pos);
      if (alt$pos.depth >= 1) {
        $pos = alt$pos;
      }
    }
  }

  if ($pos.depth < 1) {
    // Fallback: scan top-level children by DOM bounding rects
    const found = findBlockByDOMScan(view, y);
    if (!found) return null;
    $pos = view.state.doc.resolve(found.pos + 1); // resolve inside the block
  }

  // Check if we're inside a list — resolve to list_item level
  for (let d = $pos.depth; d >= 1; d--) {
    const ancestor = $pos.node(d);
    if (LIST_ITEM_TYPES.has(ancestor.type.name)) {
      const itemPos = $pos.before(d);
      const itemEnd = $pos.after(d);
      const dom = view.nodeDOM(itemPos) as HTMLElement | null;
      const listPos = d > 1 ? $pos.before(d - 1) : null;
      return { pos: itemPos, end: itemEnd, node: ancestor, dom, depth: d, parentListPos: listPos };
    }
  }

  // Default: top-level block
  const pos = $pos.before(1);
  const end = $pos.after(1);
  const node = view.state.doc.nodeAt(pos);
  if (!node) return null;
  const dom = view.nodeDOM(pos) as HTMLElement | null;
  return { pos, end, node, dom, depth: 1, parentListPos: null };
}

/** Fallback: scan top-level doc children via their DOM rects */
function findBlockByDOMScan(view: EditorView, y: number): { pos: number; node: any; dom: HTMLElement } | null {
  let pos = 0;
  for (let i = 0; i < view.state.doc.childCount; i++) {
    const child = view.state.doc.child(i);
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (dom) {
      const rect = dom.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        return { pos, node: child, dom };
      }
    }
    pos += child.nodeSize;
  }
  return null;
}

/** Check if a node is an empty paragraph */
function isEmptyParagraph(node: any): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0;
}

/** Block menu items */
interface BlockMenuItem {
  label: string;
  icon: string;
  action: (view: EditorView, blockPos: number) => void;
  separator?: boolean;
  danger?: boolean;
  /** If set, only show this item for these block type categories */
  scope?: 'all' | 'opaque-only';
}

function buildMenuItems(): BlockMenuItem[] {
  const t = getT();
  return [
    {
      label: t('editor.paragraph') || 'Text',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M13 4H9a4 4 0 0 0 0 8h4"/></svg>`,
      action: (view, pos) => {
        const node = view.state.doc.nodeAt(pos);
        if (!node || node.type.name === 'paragraph') return;
        view.dispatch(view.state.tr.setBlockType(pos, pos + node.nodeSize, view.state.schema.nodes.paragraph));
      },
    },
    {
      label: t('editor.heading1') || 'Heading 1',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12l3-2v8"/></svg>`,
      action: (view, pos) => {
        const node = view.state.doc.nodeAt(pos)!;
        view.dispatch(view.state.tr.setBlockType(pos, pos + node.nodeSize, view.state.schema.nodes.heading, { level: 1 }));
      },
    },
    {
      label: t('editor.heading2') || 'Heading 2',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12h4"/><path d="M21 18h-4c0-4 4-3 4-6"/></svg>`,
      action: (view, pos) => {
        const node = view.state.doc.nodeAt(pos)!;
        view.dispatch(view.state.tr.setBlockType(pos, pos + node.nodeSize, view.state.schema.nodes.heading, { level: 2 }));
      },
    },
    {
      label: t('editor.heading3') || 'Heading 3',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>`,
      action: (view, pos) => {
        const node = view.state.doc.nodeAt(pos)!;
        view.dispatch(view.state.tr.setBlockType(pos, pos + node.nodeSize, view.state.schema.nodes.heading, { level: 3 }));
      },
    },
    {
      label: t('editor.bulletList') || 'Bullet list',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>`,
      separator: true,
      action: (view, pos) => wrapBlockInList(view, pos, 'bullet_list'),
    },
    {
      label: t('editor.orderedList') || 'Ordered list',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="7" fill="currentColor" stroke="none" font-family="system-ui">1.</text><text x="1" y="14" font-size="7" fill="currentColor" stroke="none" font-family="system-ui">2.</text><text x="1" y="20" font-size="7" fill="currentColor" stroke="none" font-family="system-ui">3.</text></svg>`,
      action: (view, pos) => wrapBlockInList(view, pos, 'ordered_list'),
    },
    {
      label: t('editor.checkboxList') || 'Checkbox list',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="M5 8l1.5 1.5L9 7"/><line x1="12" y1="8" x2="21" y2="8"/><rect x="3" y="14" width="6" height="6" rx="1"/><line x1="12" y1="17" x2="21" y2="17"/></svg>`,
      action: (view, pos) => wrapBlockInList(view, pos, 'checkbox_list'),
    },
    {
      label: t('editor.quote') || 'Quote',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3"/></svg>`,
      action: (view, pos) => wrapBlockInNode(view, pos, 'blockquote'),
    },
    {
      label: t('editor.copy') || 'Copy',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="2" width="12" height="12" rx="2"/><path d="M16 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/></svg>`,
      separator: true,
      action: (view, pos) => {
        const node = view.state.doc.nodeAt(pos);
        if (node) navigator.clipboard.writeText(node.textContent).catch(() => {});
      },
    },
    {
      label: t('content.delete') || 'Delete',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
      separator: true,
      danger: true,
      action: (view, pos) => {
        const node = view.state.doc.nodeAt(pos);
        if (!node) return;
        const tr = view.state.tr.delete(pos, pos + node.nodeSize);
        if (view.state.doc.childCount === 1) tr.insert(0, view.state.schema.nodes.paragraph.create());
        view.dispatch(tr);
      },
    },
  ];
}

function wrapBlockInList(view: EditorView, pos: number, listType: string) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const schema = state.schema;
  const listNodeType = schema.nodes[listType];
  if (!listNodeType) return;
  const targetItemType = listType === 'checkbox_list' ? schema.nodes.checkbox_item : schema.nodes.list_item;

  // If already the target list type → unwrap to paragraph
  if (node.type.name === listType) {
    const content = node.firstChild;
    if (content?.firstChild) view.dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, content.firstChild));
    return;
  }

  // Switching between list types — preserve structure (items, indentation, content)
  if (LIST_TYPES.has(node.type.name)) {
    const convertedItems: any[] = [];
    node.forEach((item: any) => {
      // Convert list_item ↔ checkbox_item while preserving content
      const newItem = targetItemType.create(
        listType === 'checkbox_list' ? { checked: (item.attrs as any)?.checked ?? false } : null,
        convertListContent(item.content, schema, listType),
      );
      convertedItems.push(newItem);
    });
    const newList = listNodeType.create(node.attrs, convertedItems);
    view.dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, newList));
    return;
  }

  // Wrap paragraph or heading in a new list (preserve content including heading marks)
  if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
  const contentNode = schema.nodes.paragraph.create(null, node.content);
  const listItem = targetItemType.create(listType === 'checkbox_list' ? { checked: false } : null, contentNode);
  view.dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, listNodeType.create(null, listItem)));
}

/** Recursively convert nested list content when switching list types */
function convertListContent(content: any, schema: any, targetListType: string): any {
  const targetItemType = targetListType === 'checkbox_list' ? schema.nodes.checkbox_item : schema.nodes.list_item;
  const targetListNodeType = schema.nodes[targetListType];
  const result: any[] = [];
  content.forEach((child: any) => {
    if (LIST_TYPES.has(child.type.name)) {
      // Nested list — convert recursively
      const items: any[] = [];
      child.forEach((item: any) => {
        items.push(targetItemType.create(
          targetListType === 'checkbox_list' ? { checked: (item.attrs as any)?.checked ?? false } : null,
          convertListContent(item.content, schema, targetListType),
        ));
      });
      result.push(targetListNodeType.create(child.attrs, items));
    } else {
      // Keep non-list content as-is (paragraphs, headings, etc.)
      result.push(child);
    }
  });
  return result;
}

function wrapBlockInNode(view: EditorView, pos: number, wrapperType: string) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const wrapper = state.schema.nodes[wrapperType];
  if (!wrapper) return;
  if (node.type.name === wrapperType) {
    if (node.firstChild) view.dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, node.firstChild));
    return;
  }
  const inner = (node.type.name === 'paragraph' || node.type.name === 'heading')
    ? state.schema.nodes.paragraph.create(null, node.content)
    : node;
  view.dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, wrapper.create(null, inner)));
}

function moveBlockUp(view: EditorView, pos: number) {
  const { state } = view;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index($pos.depth);
  if (index === 0) return;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const parent = $pos.node($pos.depth);
  let offset = 0;
  for (let i = 0; i < index - 1; i++) offset += parent.child(i).nodeSize;
  const siblingPos = $pos.start($pos.depth) + offset;
  const tr = state.tr;
  tr.delete(pos, pos + node.nodeSize);
  tr.insert(siblingPos, node);
  view.dispatch(tr);
}

function moveBlockDown(view: EditorView, pos: number) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.node($pos.depth);
  const index = $pos.index($pos.depth);
  if (index >= parent.childCount - 1) return;
  const nextNode = parent.child(index + 1);
  const nextPos = pos + node.nodeSize;
  const tr = state.tr;
  tr.insert(nextPos + nextNode.nodeSize, node);
  tr.delete(pos, pos + node.nodeSize);
  view.dispatch(tr);
}

/**
 * Block handle plugin factory.
 */
export function blockHandlePlugin(): Plugin {
  let handleEl: HTMLElement | null = null;
  let menuOverlay: HTMLElement | null = null;
  let currentBlockPos: number | null = null;
  let currentBlockDepth = 1;
  let currentParentListPos: number | null = null;
  let menuVisible = false;
  let lastMouseY = 0;
  let positionRAF: number | null = null;
  let isDragging = false;
  let dragStartY = 0;
  let dragSourcePos: number | null = null;
  let dragIndicator: HTMLElement | null = null;

  function createHandle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'bh-handle';
    wrapper.contentEditable = 'false';
    wrapper.style.cssText = `
      position: absolute;
      display: flex;
      align-items: center;
      gap: 0;
      opacity: 0;
      transition: opacity 0.15s;
      user-select: none;
      z-index: 10;
    `;

    // Left part — click for menu (+ icon)
    const clickPart = document.createElement('div');
    clickPart.className = 'bh-click';
    clickPart.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
    clickPart.style.cssText = `
      width: 20px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border-radius: 4px 0 0 4px;
      color: hsl(var(--muted-foreground, 0 0% 45%));
      transition: background 0.1s, color 0.1s;
    `;
    clickPart.addEventListener('mouseenter', () => {
      clickPart.style.background = 'hsl(var(--accent, 0 0% 96%))';
      clickPart.style.color = 'hsl(var(--foreground, 0 0% 9%))';
    });
    clickPart.addEventListener('mouseleave', () => {
      clickPart.style.background = 'transparent';
      clickPart.style.color = 'hsl(var(--muted-foreground, 0 0% 45%))';
    });
    wrapper.appendChild(clickPart);

    // Right part — drag dots (⠿)
    const dragPart = document.createElement('div');
    dragPart.className = 'bh-drag';
    dragPart.innerHTML = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
      <circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/>
      <circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>
      <circle cx="3" cy="13.5" r="1.3"/><circle cx="7" cy="13.5" r="1.3"/>
    </svg>`;
    dragPart.style.cssText = `
      width: 16px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      border-radius: 0 4px 4px 0;
      color: hsl(var(--muted-foreground, 0 0% 45%));
      transition: background 0.1s, color 0.1s;
    `;
    dragPart.addEventListener('mouseenter', () => {
      dragPart.style.background = 'hsl(var(--accent, 0 0% 96%))';
      dragPart.style.color = 'hsl(var(--foreground, 0 0% 9%))';
    });
    dragPart.addEventListener('mouseleave', () => {
      if (!isDragging) {
        dragPart.style.background = 'transparent';
        dragPart.style.color = 'hsl(var(--muted-foreground, 0 0% 45%))';
      }
    });
    wrapper.appendChild(dragPart);

    return wrapper;
  }

  function showMenu(view: EditorView, blockPos: number) {
    hideMenu();
    if (!handleEl) return;
    const handleRect = handleEl.getBoundingClientRect();

    // Determine if this block is an "opaque" type (table, image) that only supports copy+delete
    const blockNode = view.state.doc.nodeAt(blockPos);
    let isOpaque = false;
    if (blockNode) {
      // Check the block itself or if it's a paragraph containing only an image
      if (blockNode.type.name === 'table') {
        isOpaque = true;
      } else if (blockNode.type.name === 'paragraph') {
        let hasImage = false;
        let hasOther = false;
        blockNode.forEach((child: any) => {
          if (child.type.name === 'image') hasImage = true;
          else hasOther = true;
        });
        if (hasImage && !hasOther) isOpaque = true;
      }
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; inset: 0; z-index: 999;';
    overlay.addEventListener('mousedown', (e) => { e.preventDefault(); hideMenu(); });

    const menu = document.createElement('div');
    menu.className = 'bh-menu';
    menu.contentEditable = 'false';
    menu.style.cssText = `
      position: fixed;
      min-width: 200px;
      background: hsl(var(--card, 0 0% 100%));
      border: 1px solid hsl(var(--border, 0 0% 90%));
      border-radius: 8px;
      padding: 4px 0;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      z-index: 1000;
      max-height: 400px;
      overflow-y: auto;
    `;

    let top = handleRect.bottom + 4;
    let left = handleRect.left;
    if (top + 400 > window.innerHeight) { top = handleRect.top - 400 - 4; if (top < 0) top = 8; }
    if (left < 8) left = 8;
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    let items = buildMenuItems();
    // For opaque blocks (table, image-only paragraph), only show copy + delete
    if (isOpaque) {
      items = items.filter(item => {
        const label = item.label.toLowerCase();
        return item.danger || label.includes('copy') || label.includes('复制');
      });
    }
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height: 1px; background: hsl(var(--border, 0 0% 90%)); margin: 4px 0;';
        menu.appendChild(sep);
      }
      const btn = document.createElement('button');
      btn.style.cssText = `
        display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 12px;
        border: none; background: transparent; cursor: pointer; font-size: 13px;
        color: ${item.danger ? 'hsl(var(--destructive, 0 72% 51%))' : 'hsl(var(--foreground, 0 0% 9%))'};
        text-align: left; border-radius: 0; line-height: 1.4;
      `;
      btn.addEventListener('mouseenter', () => { btn.style.background = 'hsl(var(--accent, 0 0% 96%))'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
      const iconSpan = document.createElement('span');
      iconSpan.innerHTML = item.icon;
      iconSpan.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = item.label;
      btn.appendChild(iconSpan);
      btn.appendChild(labelSpan);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        item.action(view, blockPos);
        hideMenu();
      });
      menu.appendChild(btn);
    }

    overlay.appendChild(menu);
    document.body.appendChild(overlay);
    menuOverlay = overlay;
    menuVisible = true;
  }

  function hideMenu() {
    if (menuOverlay?.parentElement) menuOverlay.parentElement.removeChild(menuOverlay);
    menuOverlay = null;
    menuVisible = false;
  }

  // Hysteresis: remember current block's DOM rect to avoid jitter at edges
  let currentBlockDom: HTMLElement | null = null;

  function positionHandle(view: EditorView, y: number) {
    if (!handleEl) return;

    // Hysteresis: if mouse is still within the current block's rect, don't re-resolve
    // Skip hysteresis for list containers and tables — need to re-resolve within them
    if (currentBlockDom && currentBlockPos != null) {
      const tag = currentBlockDom.tagName?.toLowerCase();
      const skipHysteresis = tag === 'ol' || tag === 'ul' || tag === 'table';
      if (!skipHysteresis) {
        const rect = currentBlockDom.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) {
          // Still in same block — keep handle where it is
          return;
        }
      }
    }

    const result = blockAtCoords(view, y);
    if (!result || !result.dom) {
      handleEl.style.opacity = '0';
      currentBlockPos = null;
      currentBlockDepth = 1;
      currentParentListPos = null;
      currentBlockDom = null;
      return;
    }

    // Skip empty paragraphs and list containers (handle shows on list items, not whole lists)
    if (isEmptyParagraph(result.node) || LIST_TYPES.has(result.node.type.name)) {
      handleEl.style.opacity = '0';
      currentBlockPos = null;
      currentBlockDepth = 1;
      currentParentListPos = null;
      currentBlockDom = null;
      return;
    }

    currentBlockPos = result.pos;
    currentBlockDepth = result.depth;
    currentParentListPos = result.parentListPos;
    currentBlockDom = result.dom;
    const wrapper = handleEl.parentElement;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const blockRect = result.dom.getBoundingClientRect();
    const editorRect = view.dom.getBoundingClientRect();

    // Always position handle at a fixed offset from the editor's left edge
    // This prevents jumping when hovering over indented content (lists, blockquotes)
    const handleLeft = editorRect.left - wrapperRect.left - 42;

    handleEl.style.top = `${blockRect.top - wrapperRect.top + 2}px`;
    handleEl.style.left = `${handleLeft}px`;
    handleEl.style.opacity = '1';
  }

  // ── Drag logic (custom, not HTML5 drag) ──────────────────────

  // Track source info for drag
  let dragSourceDepth = 1;
  let dragSourceParentListPos: number | null = null;

  function onDragMove(view: EditorView, e: MouseEvent) {
    if (!isDragging || dragSourcePos == null) return;

    const y = e.clientY;
    const result = blockAtCoords(view, y);
    if (!result || !result.dom) {
      hideDragIndicator();
      return;
    }

    // Show drop indicator line
    const blockRect = result.dom.getBoundingClientRect();
    const insertBefore = y < blockRect.top + blockRect.height / 2;
    const indicatorY = insertBefore ? blockRect.top : blockRect.bottom;

    if (!dragIndicator) {
      dragIndicator = document.createElement('div');
      dragIndicator.style.cssText = `
        position: fixed; height: 2px; background: hsl(var(--primary, 220 80% 60%));
        z-index: 1000; pointer-events: none; border-radius: 1px;
      `;
      document.body.appendChild(dragIndicator);
    }
    dragIndicator.style.top = `${indicatorY - 1}px`;
    dragIndicator.style.left = `${blockRect.left}px`;
    dragIndicator.style.width = `${blockRect.width}px`;
    dragIndicator.dataset.targetPos = insertBefore ? String(result.pos) : String(result.end);
    dragIndicator.dataset.targetDepth = String(result.depth);
    dragIndicator.dataset.targetParentListPos = result.parentListPos != null ? String(result.parentListPos) : '';
  }

  function onDragEnd(view: EditorView) {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.cursor = '';

    if (dragIndicator && dragSourcePos != null) {
      const targetPos = parseInt(dragIndicator.dataset.targetPos || '');
      const targetDepth = parseInt(dragIndicator.dataset.targetDepth || '1');
      const targetParentListPosStr = dragIndicator.dataset.targetParentListPos || '';
      const targetParentListPos = targetParentListPosStr ? parseInt(targetParentListPosStr) : null;

      if (!isNaN(targetPos) && targetPos !== dragSourcePos) {
        const fromNode = view.state.doc.nodeAt(dragSourcePos);
        if (fromNode) {
          const sourceIsListItem = LIST_ITEM_TYPES.has(fromNode.type.name);
          const targetIsInList = targetDepth > 1;

          // Case 1: List item → within same or another list position
          // Case 2: List item → outside list (extract as paragraph)
          // Case 3: Top-level block → list position (wrap in list item)
          // Case 4: Top-level block → top-level position (simple move)

          if (sourceIsListItem && !targetIsInList) {
            // Dragging list item out of list → extract content as paragraph(s)
            moveListItemToTopLevel(view, dragSourcePos, fromNode, targetPos);
          } else if (!sourceIsListItem && targetIsInList && targetParentListPos != null) {
            // Dragging top-level block into a list → wrap in list_item
            moveTopLevelIntoList(view, dragSourcePos, fromNode, targetPos, targetParentListPos);
          } else {
            // Same-level move (list_item↔list_item, or top↔top)
            simpleMoveBlock(view, dragSourcePos, fromNode, targetPos);
          }
        }
      }
    }

    hideDragIndicator();
    dragSourcePos = null;
    dragSourceDepth = 1;
    dragSourceParentListPos = null;
  }

  /** Simple same-level move (works for both top-level and list items) */
  function simpleMoveBlock(view: EditorView, fromPos: number, fromNode: any, toPos: number) {
    const tr = view.state.tr;
    if (toPos > fromPos) {
      tr.insert(toPos, fromNode);
      tr.delete(fromPos, fromPos + fromNode.nodeSize);
    } else {
      tr.delete(fromPos, fromPos + fromNode.nodeSize);
      tr.insert(toPos, fromNode);
    }
    view.dispatch(tr);
  }

  /** Move a list_item out of a list → becomes paragraph(s) at top level */
  function moveListItemToTopLevel(view: EditorView, fromPos: number, fromNode: any, toPos: number) {
    const tr = view.state.tr;
    const schema = view.state.schema;

    // Extract content from list_item as paragraphs
    const fragments: any[] = [];
    fromNode.forEach((child: any) => {
      if (child.type.name === 'paragraph' || child.isBlock) {
        fragments.push(child);
      } else {
        fragments.push(schema.nodes.paragraph.create(null, child.content));
      }
    });

    // Check if removing this item empties the parent list
    const $from = view.state.doc.resolve(fromPos);
    const parentList = $from.node($from.depth - 1);
    const isLastItem = parentList && LIST_TYPES.has(parentList.type.name) && parentList.childCount === 1;

    if (isLastItem) {
      // Remove entire list since it'll be empty
      const listPos = $from.before($from.depth - 1);
      const listEnd = $from.after($from.depth - 1);
      tr.delete(listPos, listEnd);
      // Adjust target pos if it was after the deleted list
      const adjustedTarget = toPos > listPos ? toPos - (listEnd - listPos) : toPos;
      for (let i = fragments.length - 1; i >= 0; i--) tr.insert(adjustedTarget, fragments[i]);
    } else {
      // Just remove the list item
      tr.delete(fromPos, fromPos + fromNode.nodeSize);
      const adjustedTarget = toPos > fromPos ? toPos - fromNode.nodeSize : toPos;
      for (let i = fragments.length - 1; i >= 0; i--) tr.insert(adjustedTarget, fragments[i]);
    }

    view.dispatch(tr);
  }

  /** Move a top-level block into a list → wraps in list_item */
  function moveTopLevelIntoList(view: EditorView, fromPos: number, fromNode: any, toPos: number, _listPos: number) {
    const tr = view.state.tr;
    const schema = view.state.schema;

    // Determine list item type from target list
    const $target = view.state.doc.resolve(toPos);
    let listItemType = schema.nodes.list_item;
    for (let d = $target.depth; d >= 0; d--) {
      const ancestor = $target.node(d);
      if (ancestor.type.name === 'checkbox_list') {
        listItemType = schema.nodes.checkbox_item;
        break;
      }
    }

    // Wrap content in list_item
    const content = fromNode.type.name === 'paragraph' ? fromNode : schema.nodes.paragraph.create(null, fromNode.content);
    const listItem = listItemType.create(
      listItemType === schema.nodes.checkbox_item ? { checked: false } : null,
      content,
    );

    if (toPos > fromPos) {
      tr.insert(toPos, listItem);
      tr.delete(fromPos, fromPos + fromNode.nodeSize);
    } else {
      tr.delete(fromPos, fromPos + fromNode.nodeSize);
      tr.insert(toPos, listItem);
    }
    view.dispatch(tr);
  }

  function hideDragIndicator() {
    if (dragIndicator?.parentElement) dragIndicator.parentElement.removeChild(dragIndicator);
    dragIndicator = null;
  }

  // Global mouse handlers for drag
  let boundDragMove: ((e: MouseEvent) => void) | null = null;
  let boundDragEnd: ((e: MouseEvent) => void) | null = null;

  return new Plugin({
    key: blockHandleKey,
    view(editorView) {
      handleEl = createHandle();
      const wrapper = editorView.dom.parentElement || editorView.dom;
      wrapper.style.position = 'relative';
      wrapper.appendChild(handleEl);

      // Click part → menu
      const clickPart = handleEl.querySelector('.bh-click')!;
      clickPart.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentBlockPos != null) {
          if (menuVisible) hideMenu();
          else showMenu(editorView, currentBlockPos);
        }
      });

      // Drag part → custom drag
      const dragPart = handleEl.querySelector('.bh-drag')!;
      dragPart.addEventListener('mousedown', (e) => {
        const me = e as MouseEvent;
        if (me.button !== 0) return;
        me.preventDefault();
        me.stopPropagation();
        if (currentBlockPos == null) return;

        isDragging = true;
        dragSourcePos = currentBlockPos;
        dragSourceDepth = currentBlockDepth;
        dragSourceParentListPos = currentParentListPos;
        dragStartY = me.clientY;
        document.body.style.cursor = 'grabbing';

        boundDragMove = (ev: MouseEvent) => onDragMove(editorView, ev);
        boundDragEnd = () => onDragEnd(editorView);
        document.addEventListener('mousemove', boundDragMove);
        document.addEventListener('mouseup', boundDragEnd);
      });

      return {
        update() {},
        destroy() {
          if (handleEl?.parentElement) handleEl.parentElement.removeChild(handleEl);
          hideMenu();
          hideDragIndicator();
          handleEl = null;
          currentBlockDom = null;
          if (boundDragMove) document.removeEventListener('mousemove', boundDragMove);
          if (boundDragEnd) document.removeEventListener('mouseup', boundDragEnd);
        },
      };
    },
    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          if (menuVisible || isDragging) return false;
          const me = event as MouseEvent;
          // Debounce with rAF to prevent flickering
          lastMouseY = me.clientY;
          if (positionRAF == null) {
            positionRAF = requestAnimationFrame(() => {
              positionRAF = null;
              positionHandle(view, lastMouseY);
            });
          }
          return false;
        },
        mouseleave(_view, _event) {
          if (!menuVisible && !isDragging && handleEl) {
            setTimeout(() => {
              if (!menuVisible && !isDragging && handleEl) {
                if (!handleEl.matches(':hover')) {
                  handleEl.style.opacity = '0';
                }
              }
            }, 200);
          }
          return false;
        },
      },
    },
  });
}
