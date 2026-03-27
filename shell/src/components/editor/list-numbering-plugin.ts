/**
 * Ordered list numbering control plugin.
 * Adds a clickable number indicator on ordered list items that shows
 * a dropdown menu with numbering options:
 * - Continue numbering (from previous list)
 * - Start new list (from 1)
 * - Restart from N
 *
 * Uses widget decorations to add clickable markers.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';

const listNumberingKey = new PluginKey('list-numbering');

/** Find all ordered_list nodes and their positions */
function findOrderedLists(state: EditorState): { pos: number; node: any; prevListEnd: number | null }[] {
  const results: { pos: number; node: any; prevListEnd: number | null }[] = [];
  let prevOlEnd: number | null = null;
  let prevBlockEnd: number | null = null;

  state.doc.forEach((node, offset) => {
    if (node.type.name === 'ordered_list') {
      results.push({ pos: offset, node, prevListEnd: prevOlEnd });
      prevOlEnd = offset + node.nodeSize;
      prevBlockEnd = prevOlEnd;
    } else {
      prevBlockEnd = offset + node.nodeSize;
      // Don't reset prevOlEnd — we want to detect lists separated by non-list blocks
    }
  });

  return results;
}

/** Count items in previous consecutive ordered list (accounting for interruptions) */
function getPrevListItemCount(state: EditorState, currentOlPos: number): number {
  let count = 0;
  let found = false;
  state.doc.forEach((node, offset) => {
    if (offset >= currentOlPos) return false;
    if (node.type.name === 'ordered_list') {
      count = node.attrs.order + node.childCount - 1;
      found = true;
    }
  });
  return found ? count : 0;
}

function createMenu(view: EditorView, olPos: number, olNode: any, anchorRect: DOMRect) {
  // Remove any existing menu
  const existing = document.querySelector('.ol-number-menu');
  existing?.remove();

  const menu = document.createElement('div');
  menu.className = 'ol-number-menu';
  menu.style.cssText = `
    position: fixed;
    left: ${anchorRect.left}px;
    top: ${anchorRect.bottom + 4}px;
    z-index: 50;
    background: hsl(var(--card, 0 0% 100%));
    border: 1px solid hsl(var(--border, 0 0% 90%));
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    min-width: 180px;
    animation: tmMenuFadeIn 0.1s ease-out;
  `;

  const currentOrder = olNode.attrs.order;
  const prevCount = getPrevListItemCount(view.state, olPos);

  const items = [
    {
      label: `Continue numbering (from ${prevCount + 1})`,
      action: () => {
        const tr = view.state.tr.setNodeMarkup(olPos, undefined, { ...olNode.attrs, order: prevCount + 1 });
        view.dispatch(tr);
      },
      disabled: prevCount === 0,
    },
    {
      label: 'Start new list (from 1)',
      action: () => {
        const tr = view.state.tr.setNodeMarkup(olPos, undefined, { ...olNode.attrs, order: 1 });
        view.dispatch(tr);
      },
    },
  ];

  items.forEach(({ label, action, disabled }) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      display: block;
      width: 100%;
      text-align: left;
      padding: 6px 12px;
      border: none;
      background: transparent;
      cursor: ${disabled ? 'default' : 'pointer'};
      border-radius: 4px;
      font-size: 13px;
      color: hsl(var(--foreground, 0 0% 9%));
      opacity: ${disabled ? '0.4' : '1'};
      white-space: nowrap;
    `;
    if (!disabled) {
      btn.addEventListener('mouseover', () => { btn.style.background = 'hsl(var(--accent, 0 0% 96%))'; });
      btn.addEventListener('mouseout', () => { btn.style.background = 'transparent'; });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        action();
        menu.remove();
      });
    }
    menu.appendChild(btn);
  });

  // Restart from N input
  const restartDiv = document.createElement('div');
  restartDiv.style.cssText = 'display: flex; align-items: center; gap: 4px; padding: 4px 12px;';
  const restartLabel = document.createElement('span');
  restartLabel.textContent = 'Start from:';
  restartLabel.style.cssText = 'font-size: 13px; color: hsl(var(--foreground));';
  const restartInput = document.createElement('input');
  restartInput.type = 'number';
  restartInput.min = '1';
  restartInput.value = String(currentOrder);
  restartInput.style.cssText = `
    width: 60px;
    padding: 2px 6px;
    border: 1px solid hsl(var(--border));
    border-radius: 4px;
    font-size: 13px;
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
    outline: none;
  `;
  restartInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = parseInt(restartInput.value, 10);
      if (val >= 1) {
        const tr = view.state.tr.setNodeMarkup(olPos, undefined, { ...olNode.attrs, order: val });
        view.dispatch(tr);
        menu.remove();
      }
    }
    if (e.key === 'Escape') {
      menu.remove();
    }
  });
  restartDiv.appendChild(restartLabel);
  restartDiv.appendChild(restartInput);
  menu.appendChild(restartDiv);

  document.body.appendChild(menu);

  // Close on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('mousedown', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
}

export function listNumberingPlugin() {
  return new Plugin({
    key: listNumberingKey,

    props: {
      handleDOMEvents: {
        click(view: EditorView, event: Event) {
          const mouseEvent = event as MouseEvent;
          // Find the closest <li> from the click target
          const target = mouseEvent.target as HTMLElement;
          const li = target.closest?.('li');
          if (!li) return false;
          // Check if li is inside an <ol>
          const ol = li.closest('ol');
          if (!ol) return false;
          // Check if click is in the marker area (left of content)
          const liRect = li.getBoundingClientRect();
          if (mouseEvent.clientX > liRect.left || mouseEvent.clientX < liRect.left - 40) return false;

          // Find the ordered_list node position
          const pos = view.posAtCoords({ left: liRect.left + 20, top: liRect.top + 5 });
          if (!pos) return false;
          const $pos = view.state.doc.resolve(pos.pos);
          for (let d = $pos.depth; d >= 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'ordered_list') {
              const olPos = $pos.before(d);
              mouseEvent.preventDefault();
              createMenu(view, olPos, node, new DOMRect(mouseEvent.clientX, mouseEvent.clientY, 0, 0));
              return true;
            }
          }
          return false;
        },
        contextmenu(view: EditorView, event: Event) {
          const mouseEvent = event as MouseEvent;
          const target = mouseEvent.target as HTMLElement;
          const li = target.closest?.('li');
          if (!li) return false;
          const ol = li.closest('ol');
          if (!ol) return false;
          const liRect = li.getBoundingClientRect();
          if (mouseEvent.clientX > liRect.left) return false;

          const pos = view.posAtCoords({ left: liRect.left + 20, top: liRect.top + 5 });
          if (!pos) return false;
          const $pos = view.state.doc.resolve(pos.pos);
          for (let d = $pos.depth; d >= 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'ordered_list') {
              const olPos = $pos.before(d);
              mouseEvent.preventDefault();
              createMenu(view, olPos, node, new DOMRect(mouseEvent.clientX, mouseEvent.clientY, 0, 0));
              return true;
            }
          }
          return false;
        },
      },
    },
  });
}
