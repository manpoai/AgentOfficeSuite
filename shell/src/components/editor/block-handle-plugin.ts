/**
 * Block handle plugin for ProseMirror.
 * Shows a drag handle on hover over content blocks.
 * - Hover over a block → drag handle appears on the left
 * - Click drag handle → opens block operation menu
 * - Drag the handle → reorder blocks
 */
import { Plugin, PluginKey, NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Fragment, Slice } from 'prosemirror-model';
import { getT } from '@/lib/i18n';

export const blockHandleKey = new PluginKey('blockHandle');

/** Resolve a mouse-Y to the top-level block position under it */
function blockAtCoords(view: EditorView, y: number): { pos: number; end: number; node: any } | null {
  // Use posAtCoords to find the position, then resolve to the top-level block
  const coords = view.posAtCoords({ left: view.dom.getBoundingClientRect().left + 10, top: y });
  if (!coords) return null;

  const $pos = view.state.doc.resolve(coords.pos);
  // Walk up to depth 1 (top-level block)
  if ($pos.depth < 1) return null;
  const depth = 1;
  const pos = $pos.before(depth);
  const end = $pos.after(depth);
  const node = view.state.doc.nodeAt(pos);
  if (!node) return null;
  return { pos, end, node };
}

/** Find the nearest block-level DOM element at mouse Y for handle positioning */
function nearestBlockDomAtY(view: EditorView, y: number): HTMLElement | null {
  const coords = view.posAtCoords({ left: view.dom.getBoundingClientRect().left + 10, top: y });
  if (!coords) return null;

  const $pos = view.state.doc.resolve(coords.pos);
  // Try progressively shallower depths to find the tightest block
  // that has its own DOM element (paragraph inside list_item, list_item, etc.)
  for (let d = $pos.depth; d >= 1; d--) {
    const nodePos = $pos.before(d);
    const domNode = view.nodeDOM(nodePos) as HTMLElement | null;
    if (domNode && domNode.getBoundingClientRect) {
      const rect = domNode.getBoundingClientRect();
      // Only use this node if its top is reasonably close to the mouse Y
      // (i.e., it's a tight-fitting block, not a giant wrapper)
      if (rect.height < 200 || Math.abs(rect.top - y) < 100) {
        return domNode;
      }
    }
  }

  // Fallback: use the deepest DOM node we can find
  const deepPos = $pos.before($pos.depth >= 1 ? 1 : $pos.depth);
  return view.nodeDOM(deepPos) as HTMLElement | null;
}

/** Block menu items */
interface BlockMenuItem {
  label: string;
  icon: string;
  action: (view: EditorView, blockPos: number) => void;
  separator?: boolean;
}

function buildMenuItems(): BlockMenuItem[] {
  const t = getT();
  return [
    // Block type conversions
    {
      label: t('editor.paragraph') || 'Text',
      icon: 'Aa',
      action: (view, pos) => {
        const { state } = view;
        const node = state.doc.nodeAt(pos);
        if (!node) return;
        if (node.type.name !== 'paragraph') {
          const tr = state.tr.setBlockType(pos, pos + node.nodeSize, state.schema.nodes.paragraph);
          view.dispatch(tr);
        }
      },
    },
    {
      label: t('editor.h1') || 'Heading 1',
      icon: 'H1',
      action: (view, pos) => {
        const { state } = view;
        const tr = state.tr.setBlockType(pos, pos + state.doc.nodeAt(pos)!.nodeSize, state.schema.nodes.heading, { level: 1 });
        view.dispatch(tr);
      },
    },
    {
      label: t('editor.h2') || 'Heading 2',
      icon: 'H2',
      action: (view, pos) => {
        const { state } = view;
        const tr = state.tr.setBlockType(pos, pos + state.doc.nodeAt(pos)!.nodeSize, state.schema.nodes.heading, { level: 2 });
        view.dispatch(tr);
      },
    },
    {
      label: t('editor.h3') || 'Heading 3',
      icon: 'H3',
      action: (view, pos) => {
        const { state } = view;
        const tr = state.tr.setBlockType(pos, pos + state.doc.nodeAt(pos)!.nodeSize, state.schema.nodes.heading, { level: 3 });
        view.dispatch(tr);
      },
    },
    // Separator
    {
      label: t('editor.bulletList') || 'Bullet list',
      icon: '•',
      separator: true,
      action: (view, pos) => wrapBlockInList(view, pos, 'bullet_list'),
    },
    {
      label: t('editor.orderedList') || 'Ordered list',
      icon: '1.',
      action: (view, pos) => wrapBlockInList(view, pos, 'ordered_list'),
    },
    {
      label: t('editor.checkboxList') || 'Checkbox list',
      icon: '☑',
      action: (view, pos) => wrapBlockInList(view, pos, 'checkbox_list'),
    },
    {
      label: t('editor.quote') || 'Quote',
      icon: '❝',
      action: (view, pos) => wrapBlockInNode(view, pos, 'blockquote'),
    },
    // Separator + actions
    {
      label: t('editor.comment') || 'Comment',
      icon: '💬',
      separator: true,
      action: () => { /* Comment functionality - placeholder */ },
    },
    {
      label: t('editor.cut') || 'Cut',
      icon: '✂',
      action: (view, pos) => cutBlock(view, pos),
    },
    {
      label: t('editor.copy') || 'Copy',
      icon: '📋',
      action: (view, pos) => copyBlock(view, pos),
    },
    {
      label: t('editor.delete') || 'Delete',
      icon: '🗑',
      action: (view, pos) => deleteBlock(view, pos),
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

  // If already this list type, unwrap
  if (node.type.name === listType) {
    // Lift content out of list
    const content = node.firstChild; // first list_item
    if (content && content.firstChild) {
      const tr = state.tr.replaceWith(pos, pos + node.nodeSize, content.firstChild);
      view.dispatch(tr);
    }
    return;
  }

  // Convert to list: take content as paragraph, wrap in list_item, wrap in list
  let contentNode;
  if (node.type.name === 'paragraph' || node.type.name === 'heading') {
    contentNode = schema.nodes.paragraph.create(null, node.content);
  } else {
    return; // Can only wrap text-like blocks in lists
  }

  const itemType = listType === 'checkbox_list' ? schema.nodes.checkbox_item : schema.nodes.list_item;
  const listItem = itemType.create(listType === 'checkbox_list' ? { checked: false } : null, contentNode);
  const listNode = listNodeType.create(null, listItem);

  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, listNode);
  view.dispatch(tr);
}

function wrapBlockInNode(view: EditorView, pos: number, wrapperType: string) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;

  const schema = state.schema;
  const wrapper = schema.nodes[wrapperType];
  if (!wrapper) return;

  // If already wrapped, unwrap
  if (node.type.name === wrapperType) {
    const inner = node.firstChild;
    if (inner) {
      const tr = state.tr.replaceWith(pos, pos + node.nodeSize, inner);
      view.dispatch(tr);
    }
    return;
  }

  // Wrap: ensure content is suitable
  let inner;
  if (node.type.name === 'paragraph' || node.type.name === 'heading') {
    inner = schema.nodes.paragraph.create(null, node.content);
  } else {
    inner = node;
  }

  const wrapped = wrapper.create(null, inner);
  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, wrapped);
  view.dispatch(tr);
}

function cutBlock(view: EditorView, pos: number) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;

  // Copy to clipboard
  const slice = new Slice(Fragment.from(node), 0, 0);
  const text = node.textContent;
  navigator.clipboard.writeText(text).catch(() => {});

  // Delete the block
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  view.dispatch(tr);
}

function copyBlock(view: EditorView, pos: number) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;

  const text = node.textContent;
  navigator.clipboard.writeText(text).catch(() => {});
}

function deleteBlock(view: EditorView, pos: number) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;

  const tr = state.tr.delete(pos, pos + node.nodeSize);
  // If doc would be empty, insert an empty paragraph
  if (state.doc.childCount === 1) {
    tr.insert(0, state.schema.nodes.paragraph.create());
  }
  view.dispatch(tr);
}

/**
 * Block handle plugin factory.
 * Creates the drag handle element, positions it, and manages the block menu.
 */
export function blockHandlePlugin(): Plugin {
  let handle: HTMLElement | null = null;
  let menu: HTMLElement | null = null;
  let currentBlockPos: number | null = null;
  let menuVisible = false;

  function createHandle(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'block-drag-handle';
    el.contentEditable = 'false';
    el.draggable = true;
    el.innerHTML = '⠿'; // Braille pattern as drag dots
    el.style.cssText = `
      position: absolute;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: hsl(var(--muted-foreground, 0 0% 45%));
      opacity: 0;
      cursor: grab;
      border-radius: 4px;
      transition: opacity 0.15s;
      user-select: none;
      z-index: 10;
    `;
    return el;
  }

  function createMenu(view: EditorView, blockPos: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'block-handle-menu';
    el.contentEditable = 'false';
    el.style.cssText = `
      position: absolute;
      left: -32px;
      top: 24px;
      min-width: 180px;
      background: hsl(var(--card, 0 0% 100%));
      border: 1px solid hsl(var(--border, 0 0% 90%));
      border-radius: 8px;
      padding: 4px 0;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      z-index: 50;
      max-height: 320px;
      overflow-y: auto;
    `;

    const items = buildMenuItems();
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height: 1px; background: hsl(var(--border, 0 0% 90%)); margin: 4px 0;';
        el.appendChild(sep);
      }

      const btn = document.createElement('button');
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 13px;
        color: hsl(var(--foreground, 0 0% 9%));
        text-align: left;
        border-radius: 0;
        line-height: 1.4;
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'hsl(var(--accent, 0 0% 96%))';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
      });

      const iconSpan = document.createElement('span');
      iconSpan.textContent = item.icon;
      iconSpan.style.cssText = 'width: 20px; text-align: center; flex-shrink: 0; font-size: 14px;';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = item.label;

      btn.appendChild(iconSpan);
      btn.appendChild(labelSpan);

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.action(view, blockPos);
        hideMenu();
      });

      el.appendChild(btn);
    }

    return el;
  }

  function showMenu(view: EditorView, blockPos: number) {
    hideMenu();
    menu = createMenu(view, blockPos);
    if (handle && handle.parentElement) {
      handle.parentElement.appendChild(menu);
    }
    menuVisible = true;
  }

  function hideMenu() {
    if (menu && menu.parentElement) {
      menu.parentElement.removeChild(menu);
    }
    menu = null;
    menuVisible = false;
  }

  function positionHandle(view: EditorView, blockPos: number, mouseY?: number) {
    if (!handle) return;

    const wrapper = handle.parentElement;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();

    // Use nearestBlockDomAtY if mouseY is available — this finds the tightest
    // block element near the cursor, even inside deep nesting (e.g. list items).
    let blockRect: DOMRect | null = null;

    if (mouseY != null) {
      const nearDom = nearestBlockDomAtY(view, mouseY);
      if (nearDom) {
        blockRect = nearDom.getBoundingClientRect();
      }
    }

    if (!blockRect) {
      // Fallback: use the top-level block DOM node
      const domNode = view.nodeDOM(blockPos) as HTMLElement | null;
      if (!domNode || !domNode.getBoundingClientRect) return;
      blockRect = domNode.getBoundingClientRect();
    }

    // Position handle to the left of the block content
    handle.style.top = `${blockRect.top - wrapperRect.top + 2}px`;
    handle.style.left = `${blockRect.left - wrapperRect.left - 28}px`;
    handle.style.opacity = '0.5';
  }

  // Close menu on outside click
  function handleDocumentClick(e: MouseEvent) {
    if (menuVisible && menu && !menu.contains(e.target as Node) &&
        handle && !handle.contains(e.target as Node)) {
      hideMenu();
    }
  }

  return new Plugin({
    key: blockHandleKey,
    view(editorView) {
      handle = createHandle();
      // Append to the editor mount wrapper (parent of ProseMirror contentEditable)
      // ProseMirror manages its own DOM and will remove foreign children
      const wrapper = editorView.dom.parentElement || editorView.dom;
      wrapper.style.position = 'relative';
      wrapper.appendChild(handle);

      // Click handle → toggle menu
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (currentBlockPos != null) {
          if (menuVisible) {
            hideMenu();
          } else {
            showMenu(editorView, currentBlockPos);
          }
        }
      });

      // Drag start
      handle.addEventListener('dragstart', (e) => {
        if (currentBlockPos == null) return;
        const node = editorView.state.doc.nodeAt(currentBlockPos);
        if (!node) return;
        e.dataTransfer?.setData('application/x-block-pos', String(currentBlockPos));
        e.dataTransfer?.setData('text/plain', node.textContent);
        handle!.style.opacity = '0.3';
      });

      handle.addEventListener('dragend', () => {
        if (handle) handle.style.opacity = '0.5';
      });

      document.addEventListener('click', handleDocumentClick);

      return {
        update(view) {
          // Just keep the handle around, positioning happens on mousemove
        },
        destroy() {
          if (handle && handle.parentElement) {
            handle.parentElement.removeChild(handle);
          }
          hideMenu();
          handle = null;
          document.removeEventListener('click', handleDocumentClick);
        },
      };
    },
    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          if (menuVisible) return false; // Don't reposition while menu is open

          const mouseEvent = event as MouseEvent;
          const result = blockAtCoords(view, mouseEvent.clientY);

          if (result && handle) {
            currentBlockPos = result.pos;
            positionHandle(view, result.pos, mouseEvent.clientY);
          } else if (handle) {
            handle.style.opacity = '0';
            currentBlockPos = null;
          }
          return false;
        },
        mouseleave(view, event) {
          if (!menuVisible && handle) {
            // Delay hiding to allow mouse to reach the handle
            setTimeout(() => {
              if (!menuVisible && handle) {
                const hovered = handle.matches(':hover');
                if (!hovered) {
                  handle.style.opacity = '0';
                }
              }
            }, 200);
          }
          return false;
        },
        drop(view, event) {
          const dragEvent = event as DragEvent;
          const posStr = dragEvent.dataTransfer?.getData('application/x-block-pos');
          if (!posStr) return false;

          const fromPos = parseInt(posStr);
          const fromNode = view.state.doc.nodeAt(fromPos);
          if (!fromNode) return false;

          // Find where to drop
          const dropResult = blockAtCoords(view, dragEvent.clientY);
          if (!dropResult) return false;

          let toPos = dropResult.pos;
          if (toPos === fromPos) return false;

          dragEvent.preventDefault();

          const { state } = view;
          let tr = state.tr;

          // If moving down, we need to adjust positions since deletion shifts them
          if (toPos > fromPos) {
            // Insert after the target block, then delete the source
            const insertPos = dropResult.end;
            tr = tr.insert(insertPos, fromNode);
            tr = tr.delete(fromPos, fromPos + fromNode.nodeSize);
          } else {
            // Moving up: delete first, then insert
            tr = tr.delete(fromPos, fromPos + fromNode.nodeSize);
            tr = tr.insert(toPos, fromNode);
          }

          view.dispatch(tr);
          return true;
        },
      },
    },
  });
}
