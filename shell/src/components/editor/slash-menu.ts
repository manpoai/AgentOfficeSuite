/**
 * Slash command menu plugin for ProseMirror.
 * Typing "/" at the start of a line opens a popup with block type options.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import { setBlockType, wrapIn } from 'prosemirror-commands';

export const slashMenuKey = new PluginKey('slashMenu');

interface SlashMenuItem {
  label: string;
  description: string;
  icon: string;
  command: (view: EditorView) => void;
}

const SLASH_ITEMS: SlashMenuItem[] = [
  {
    label: '标题 1', description: '大标题', icon: 'H1',
    command: (view) => { setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '标题 2', description: '中标题', icon: 'H2',
    command: (view) => { setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '标题 3', description: '小标题', icon: 'H3',
    command: (view) => { setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '无序列表', description: '项目符号列表', icon: '•',
    command: (view) => { wrapIn(schema.nodes.bullet_list)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '有序列表', description: '编号列表', icon: '1.',
    command: (view) => { wrapIn(schema.nodes.ordered_list)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '引用', description: '块引用', icon: '❝',
    command: (view) => { wrapIn(schema.nodes.blockquote)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '代码块', description: '代码片段', icon: '<>',
    command: (view) => { setBlockType(schema.nodes.code_block)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '分割线', description: '水平线', icon: '—',
    command: (view) => {
      const { state, dispatch } = view;
      dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView());
      view.focus();
    },
  },
  {
    label: '表格', description: '插入表格', icon: '⊞',
    command: (view) => {
      const { state, dispatch } = view;
      const cell = schema.nodes.table_cell.createAndFill()!;
      const header = schema.nodes.table_header.createAndFill()!;
      const headerRow = schema.nodes.table_row.create(null, [
        header, schema.nodes.table_header.createAndFill()!, schema.nodes.table_header.createAndFill()!,
      ]);
      const row = schema.nodes.table_row.create(null, [
        cell, schema.nodes.table_cell.createAndFill()!, schema.nodes.table_cell.createAndFill()!,
      ]);
      const table = schema.nodes.table.create(null, [headerRow, row]);
      dispatch(state.tr.replaceSelectionWith(table).scrollIntoView());
      view.focus();
    },
  },
];

function createMenuDOM(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'slash-menu';
  el.style.cssText = `
    position: absolute; z-index: 100; display: none;
    background: hsl(240 6% 14%); border: 1px solid hsl(240 4% 20%);
    border-radius: 8px; padding: 4px; width: 240px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4); max-height: 320px; overflow-y: auto;
  `;
  return el;
}

function renderItems(el: HTMLDivElement, items: SlashMenuItem[], selected: number, onSelect: (i: number) => void) {
  el.innerHTML = '';
  items.forEach((item, i) => {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      padding: 6px 10px; border-radius: 6px; cursor: pointer;
      ${i === selected ? 'background: hsl(240 4% 20%);' : ''}
    `;
    row.onmouseenter = () => onSelect(i);
    row.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onSelect(i); };

    const icon = document.createElement('span');
    icon.style.cssText = 'width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: hsl(240 4% 18%); border-radius: 4px; font-size: 12px; font-weight: 600; color: #a1a1aa; flex-shrink: 0;';
    icon.textContent = item.icon;

    const text = document.createElement('div');
    text.style.cssText = 'min-width: 0;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size: 13px; color: #e4e4e7; font-weight: 500;';
    label.textContent = item.label;
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size: 11px; color: #71717a;';
    desc.textContent = item.description;
    text.appendChild(label);
    text.appendChild(desc);

    row.appendChild(icon);
    row.appendChild(text);
    el.appendChild(row);
  });
}

export function slashMenuPlugin(): Plugin {
  let menuEl: HTMLDivElement | null = null;
  let active = false;
  let filterText = '';
  let selectedIndex = 0;
  let slashPos = -1;

  function getFilteredItems(): SlashMenuItem[] {
    if (!filterText) return SLASH_ITEMS;
    const q = filterText.toLowerCase();
    return SLASH_ITEMS.filter(item =>
      item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
    );
  }

  function show(view: EditorView) {
    if (!menuEl) return;
    active = true;
    menuEl.style.display = 'block';
    updatePosition(view);
    updateMenu(view);
  }

  function hide() {
    if (!menuEl) return;
    active = false;
    menuEl.style.display = 'none';
    filterText = '';
    selectedIndex = 0;
    slashPos = -1;
  }

  function updateMenu(view: EditorView) {
    if (!menuEl) return;
    const items = getFilteredItems();
    if (items.length === 0) { hide(); return; }
    selectedIndex = Math.min(selectedIndex, items.length - 1);
    renderItems(menuEl, items, selectedIndex, (i) => {
      selectedIndex = i;
      const filtered = getFilteredItems();
      executeItem(view, filtered[i]);
    });
  }

  function updatePosition(view: EditorView) {
    if (!menuEl || slashPos < 0) return;
    const coords = view.coordsAtPos(slashPos);
    const editorRect = view.dom.closest('.outline-editor')?.getBoundingClientRect() || view.dom.getBoundingClientRect();
    menuEl.style.left = `${coords.left - editorRect.left}px`;
    menuEl.style.top = `${coords.bottom - editorRect.top + 4}px`;
  }

  function executeItem(view: EditorView, item: SlashMenuItem) {
    // Delete the slash + filter text first
    const { state, dispatch } = view;
    const from = slashPos;
    const to = state.selection.from;
    const tr = state.tr.delete(from, to);
    dispatch(tr);
    hide();
    // Execute the command
    setTimeout(() => item.command(view), 0);
  }

  return new Plugin({
    key: slashMenuKey,
    view(editorView) {
      menuEl = createMenuDOM();
      const container = editorView.dom.closest('.outline-editor');
      if (container) {
        (container as HTMLElement).style.position = 'relative';
        container.appendChild(menuEl);
      }
      return {
        destroy() {
          menuEl?.remove();
          menuEl = null;
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        if (active) {
          const items = getFilteredItems();
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateMenu(view);
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            updateMenu(view);
            return true;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (items[selectedIndex]) executeItem(view, items[selectedIndex]);
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            hide();
            return true;
          }
          // Let other keys (typing) pass through — handleTextInput will update filter
          return false;
        }
        return false;
      },
      handleTextInput(view, from, to, text) {
        if (text === '/') {
          const { $from } = view.state.selection;
          // Only trigger at start of line (or after whitespace)
          const before = $from.parent.textContent.slice(0, $from.parentOffset);
          if (before.trim() === '') {
            // Wait for the "/" to be inserted, then activate
            setTimeout(() => {
              slashPos = view.state.selection.from - 1;
              filterText = '';
              selectedIndex = 0;
              show(view);
            }, 0);
          }
          return false;
        }
        if (active) {
          // Update filter based on text after slash
          setTimeout(() => {
            const { state } = view;
            const textAfterSlash = state.doc.textBetween(slashPos + 1, state.selection.from, '');
            filterText = textAfterSlash;
            selectedIndex = 0;
            updateMenu(view);
          }, 0);
          return false;
        }
        return false;
      },
    },
    // Close menu on blur or selection change outside
    appendTransaction(transactions, oldState, newState) {
      if (!active) return null;
      const { selection } = newState;
      // Close if cursor moved before the slash
      if (selection.from < slashPos) {
        hide();
      }
      return null;
    },
  });
}
