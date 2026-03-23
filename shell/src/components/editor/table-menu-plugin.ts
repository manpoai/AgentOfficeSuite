/**
 * Table context menu plugin for ProseMirror.
 * Shows a floating menu when cursor is in a table cell with:
 * - Add/delete row
 * - Add/delete column
 * - Cell alignment (left/center/right)
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  addRowAfter,
  addRowBefore,
  deleteRow,
  addColumnAfter,
  addColumnBefore,
  deleteColumn,
  CellSelection,
  TableMap,
} from 'prosemirror-tables';
import { getT } from '@/lib/i18n';

export const tableMenuKey = new PluginKey('tableMenu');

/** Check if the current selection is inside a table */
function isInTable(state: any): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') return true;
  }
  return false;
}

/** Get the position of the table cell containing the cursor */
function getTableCellPos(state: any): { tablePos: number; cellPos: number; row: number; col: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'table_cell' || node.type.name === 'table_header') {
      const cellPos = $from.before(d);
      // Find the table
      for (let td = d - 1; td > 0; td--) {
        if ($from.node(td).type.name === 'table_row') {
          for (let ttd = td - 1; ttd >= 0; ttd--) {
            if ($from.node(ttd).type.name === 'table') {
              const tablePos = $from.before(ttd);
              const tableNode = $from.node(ttd);
              const map = TableMap.get(tableNode);
              const cellOffset = cellPos - tablePos - 1;
              const cellIndex = map.map.indexOf(cellOffset);
              if (cellIndex === -1) return { tablePos, cellPos, row: 0, col: 0 };
              const row = Math.floor(cellIndex / map.width);
              const col = cellIndex % map.width;
              return { tablePos, cellPos, row, col };
            }
          }
        }
      }
    }
  }
  return null;
}

function setCellAlignment(view: EditorView, alignment: string | null) {
  const { state } = view;
  const { $from } = state.selection;

  // Find the cell node
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'table_cell' || node.type.name === 'table_header') {
      const pos = $from.before(d);
      const tr = state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        alignment,
      });
      view.dispatch(tr);
      return;
    }
  }
}

export function tableMenuPlugin(): Plugin {
  let menuEl: HTMLElement | null = null;
  let isVisible = false;

  function createMenu(view: EditorView): HTMLElement {
    const t = getT();
    const el = document.createElement('div');
    el.className = 'table-context-menu';
    el.contentEditable = 'false';
    el.style.cssText = `
      position: absolute;
      background: hsl(var(--card, 0 0% 100%));
      border: 1px solid hsl(var(--border, 0 0% 90%));
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
      z-index: 30;
      display: flex;
      gap: 2px;
      align-items: center;
      white-space: nowrap;
    `;

    const btnStyle = `
      padding: 4px 6px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 4px;
      font-size: 12px;
      color: hsl(var(--foreground, 0 0% 9%));
      display: flex;
      align-items: center;
      gap: 2px;
      line-height: 1;
    `;

    const buttons = [
      { label: '+ ↓', title: t('content.addRow') || 'Add row below', action: () => addRowAfter(view.state, view.dispatch) },
      { label: '- ↕', title: t('content.deleteRow') || 'Delete row', action: () => deleteRow(view.state, view.dispatch) },
      { sep: true },
      { label: '+ →', title: t('content.addCol') || 'Add column right', action: () => addColumnAfter(view.state, view.dispatch) },
      { label: '- ↔', title: t('content.deleteCol') || 'Delete column', action: () => deleteColumn(view.state, view.dispatch) },
      { sep: true },
      { label: '◁', title: 'Align left', action: () => setCellAlignment(view, 'left') },
      { label: '≡', title: 'Align center', action: () => setCellAlignment(view, 'center') },
      { label: '▷', title: 'Align right', action: () => setCellAlignment(view, 'right') },
    ];

    for (const btn of buttons) {
      if (btn.sep) {
        const sep = document.createElement('span');
        sep.style.cssText = 'display:inline-block;width:1px;height:16px;background:hsl(var(--border, 0 0% 90%));margin:0 2px;';
        el.appendChild(sep);
        continue;
      }

      const b = document.createElement('button');
      b.style.cssText = btnStyle;
      b.textContent = btn.label!;
      b.title = btn.title!;
      b.addEventListener('mouseenter', () => { b.style.background = 'hsl(var(--accent, 0 0% 96%))'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.action!();
      });
      el.appendChild(b);
    }

    return el;
  }

  function showMenu(view: EditorView) {
    if (!menuEl) {
      menuEl = createMenu(view);
      view.dom.parentElement?.appendChild(menuEl);
    }
    menuEl.style.display = 'flex';
    isVisible = true;
    positionMenu(view);
  }

  function hideMenu() {
    if (menuEl) {
      menuEl.style.display = 'none';
    }
    isVisible = false;
  }

  function positionMenu(view: EditorView) {
    if (!menuEl) return;
    const info = getTableCellPos(view.state);
    if (!info) return;

    // Find the table DOM node
    const tableDOM = view.nodeDOM(info.tablePos) as HTMLElement | null;
    if (!tableDOM) return;

    const editorParent = view.dom.parentElement;
    if (!editorParent) return;

    const parentRect = editorParent.getBoundingClientRect();
    const tableRect = tableDOM.getBoundingClientRect();

    // Position above the table
    menuEl.style.left = `${tableRect.left - parentRect.left}px`;
    menuEl.style.top = `${tableRect.top - parentRect.top - 36}px`;
  }

  return new Plugin({
    key: tableMenuKey,
    view(editorView) {
      return {
        update(view) {
          if (isInTable(view.state)) {
            showMenu(view);
          } else {
            hideMenu();
          }
        },
        destroy() {
          if (menuEl && menuEl.parentElement) {
            menuEl.parentElement.removeChild(menuEl);
          }
          menuEl = null;
        },
      };
    },
  });
}
