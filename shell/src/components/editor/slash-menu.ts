/**
 * Slash command menu plugin for ProseMirror.
 * Typing "/" at the start of a line opens a popup with block type options.
 * Aligned with Outline's block menu items.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import { setBlockType, wrapIn } from 'prosemirror-commands';
import { getT } from '@/lib/i18n';
import { uploadAndInsert } from './image-plugin';

export const slashMenuKey = new PluginKey('slashMenu');

interface SlashMenuItem {
  label: string;
  description: string;
  icon: string;
  keywords?: string;
  command: (view: EditorView) => void;
}

// Helper: insert a block node at current selection
function insertBlock(view: EditorView, node: ReturnType<typeof schema.nodes.paragraph.create>) {
  const { state, dispatch } = view;
  dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
}

// Helper: wrap current block and insert a paragraph inside
function wrapWithNotice(view: EditorView, style: string) {
  const { state, dispatch } = view;
  const paragraph = schema.nodes.paragraph.create();
  const notice = schema.nodes.container_notice.create({ style }, [paragraph]);
  dispatch(state.tr.replaceSelectionWith(notice).scrollIntoView());
  view.focus();
}

function buildSlashItems(getDocId?: () => string | undefined): SlashMenuItem[] {
  const t = getT();
  return [
    // --- Headings ---
    {
      label: t('editor.heading1'), description: t('editor.heading1Desc'), icon: 'H1', keywords: 'heading h1',
      command: (view) => { setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.heading2'), description: t('editor.heading2Desc'), icon: 'H2', keywords: 'heading h2',
      command: (view) => { setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.heading3'), description: t('editor.heading3Desc'), icon: 'H3', keywords: 'heading h3',
      command: (view) => { setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.heading4'), description: t('editor.heading4Desc'), icon: 'H4', keywords: 'heading h4',
      command: (view) => { setBlockType(schema.nodes.heading, { level: 4 })(view.state, view.dispatch); view.focus(); },
    },
    // --- Lists ---
    {
      label: t('editor.bulletList'), description: t('editor.bulletListDesc'), icon: '•', keywords: 'bullet list ul',
      command: (view) => { wrapIn(schema.nodes.bullet_list)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.orderedList'), description: t('editor.orderedListDesc'), icon: '1.', keywords: 'ordered list ol number',
      command: (view) => { wrapIn(schema.nodes.ordered_list)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.todoList'), description: t('editor.todoListDesc'), icon: '☑', keywords: 'todo task checkbox checklist',
      command: (view) => { wrapIn(schema.nodes.checkbox_list)(view.state, view.dispatch); view.focus(); },
    },
    // --- Structure ---
    {
      label: t('editor.quote'), description: t('editor.quoteDesc'), icon: '❝', keywords: 'quote blockquote',
      command: (view) => { wrapIn(schema.nodes.blockquote)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.codeBlock'), description: t('editor.codeBlockDesc'), icon: '</>', keywords: 'code block pre',
      command: (view) => { setBlockType(schema.nodes.code_block)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.divider'), description: t('editor.dividerDesc'), icon: '—', keywords: 'divider horizontal rule hr separator',
      command: (view) => {
        insertBlock(view, schema.nodes.horizontal_rule.create());
      },
    },
    {
      label: t('editor.table'), description: t('editor.tableDesc'), icon: '⊞', keywords: 'table grid',
      command: (view) => {
        const { state, dispatch } = view;
        const header = schema.nodes.table_header.createAndFill()!;
        const headerRow = schema.nodes.table_row.create(null, [
          header, schema.nodes.table_header.createAndFill()!, schema.nodes.table_header.createAndFill()!,
        ]);
        const cell = schema.nodes.table_cell.createAndFill()!;
        const row = schema.nodes.table_row.create(null, [
          cell, schema.nodes.table_cell.createAndFill()!, schema.nodes.table_cell.createAndFill()!,
        ]);
        const table = schema.nodes.table.create(null, [headerRow, row]);
        dispatch(state.tr.replaceSelectionWith(table).scrollIntoView());
        view.focus();
      },
    },
    // --- Media ---
    {
      label: t('editor.image'), description: t('editor.imageDesc'), icon: '🖼', keywords: 'image picture photo img',
      command: (view) => {
        // Open file picker for image upload
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (file) {
            const { from } = view.state.selection;
            uploadAndInsert(view, file, from, getDocId?.());
          }
          input.remove();
        });
        document.body.appendChild(input);
        input.click();
      },
    },
    // --- Notices / Callouts ---
    {
      label: t('editor.infoNotice'), description: t('editor.infoNoticeDesc'), icon: 'ℹ', keywords: 'info notice callout tip blue',
      command: (view) => { wrapWithNotice(view, 'info'); },
    },
    {
      label: t('editor.successNotice'), description: t('editor.successNoticeDesc'), icon: '✓', keywords: 'success notice callout green done',
      command: (view) => { wrapWithNotice(view, 'success'); },
    },
    {
      label: t('editor.warningNotice'), description: t('editor.warningNoticeDesc'), icon: '⚠', keywords: 'warning notice callout alert orange caution',
      command: (view) => { wrapWithNotice(view, 'warning'); },
    },
    {
      label: t('editor.tip'), description: t('editor.tipDesc'), icon: '💡', keywords: 'tip notice callout hint purple suggestion',
      command: (view) => { wrapWithNotice(view, 'tip'); },
    },
    // --- Advanced blocks ---
    {
      label: t('editor.mathBlock'), description: t('editor.mathBlockDesc'), icon: '∑', keywords: 'math latex formula equation katex',
      command: (view) => {
        insertBlock(view, schema.nodes.math_block.create());
      },
    },
    {
      label: t('editor.mermaid'), description: t('editor.mermaidDesc'), icon: '⊡', keywords: 'mermaid diagram flowchart graph chart',
      command: (view) => {
        const { state, dispatch } = view;
        const node = schema.nodes.code_block.create(
          { language: 'mermaid' },
          schema.text('graph TD\n  A[Start] --> B[End]')
        );
        dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
        view.focus();
      },
    },
    {
      label: t('editor.paragraph'), description: t('editor.paragraphDesc'), icon: '¶', keywords: 'paragraph text plain normal',
      command: (view) => { setBlockType(schema.nodes.paragraph)(view.state, view.dispatch); view.focus(); },
    },
  ];
}

function createMenuDOM(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'slash-menu';
  el.style.cssText = `
    position: fixed; z-index: 1000; display: none;
    background: hsl(var(--popover, 0 0% 100%)); border: 1px solid hsl(var(--border, 0 0% 90%));
    border-radius: 8px; padding: 4px; width: 260px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15); max-height: 420px; overflow-y: auto; overflow-x: hidden;
    color: hsl(var(--popover-foreground, 0 0% 9%));
  `;
  return el;
}

function renderItems(
  el: HTMLDivElement,
  items: SlashMenuItem[],
  selected: number,
  onHover: (i: number) => void,
  onClick: (i: number) => void,
) {
  el.innerHTML = '';
  items.forEach((item, i) => {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 6px; cursor: pointer;
      transition: background 0.1s;
      ${i === selected ? 'background: hsl(var(--accent, 0 0% 96%));' : ''}
    `;
    row.onmouseenter = () => onHover(i);
    // Use mousedown + preventDefault to prevent editor blur
    row.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); onClick(i); };

    const icon = document.createElement('span');
    icon.style.cssText = 'width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: hsl(var(--muted, 0 0% 96%)); border-radius: 6px; font-size: 13px; font-weight: 600; color: hsl(var(--muted-foreground, 0 0% 45%)); flex-shrink: 0;';
    icon.textContent = item.icon;

    const text = document.createElement('div');
    text.style.cssText = 'min-width: 0; flex: 1;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size: 13px; color: hsl(var(--foreground, 0 0% 9%)); font-weight: 500; line-height: 1.3;';
    label.textContent = item.label;
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size: 11px; color: hsl(var(--muted-foreground, 0 0% 45%)); line-height: 1.3;';
    desc.textContent = item.description;
    text.appendChild(label);
    text.appendChild(desc);

    row.appendChild(icon);
    row.appendChild(text);
    el.appendChild(row);
  });
}

export function slashMenuPlugin(getDocId?: () => string | undefined): Plugin {
  let menuEl: HTMLDivElement | null = null;
  let active = false;
  let filterText = '';
  let selectedIndex = 0;
  let slashPos = -1;

  function getFilteredItems(): SlashMenuItem[] {
    const items = buildSlashItems(getDocId);
    if (!filterText) return items;
    const q = filterText.toLowerCase();
    return items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      (item.keywords && item.keywords.toLowerCase().includes(q))
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
    renderItems(menuEl, items, selectedIndex,
      // onHover: just update highlight
      (i) => {
        selectedIndex = i;
        // Re-render to update highlight without re-triggering hover loop
        if (!menuEl) return;
        const rows = menuEl.children;
        for (let j = 0; j < rows.length; j++) {
          (rows[j] as HTMLElement).style.background = j === i ? 'hsl(var(--accent, 0 0% 96%))' : '';
        }
      },
      // onClick: execute command
      (i) => {
        const filtered = getFilteredItems();
        if (filtered[i]) executeItem(view, filtered[i]);
      }
    );
  }

  function updatePosition(view: EditorView) {
    if (!menuEl || slashPos < 0) return;
    try {
      const coords = view.coordsAtPos(slashPos);
      const padding = 8; // min distance from viewport edges

      // Available space below and above the cursor (in viewport coords)
      const spaceBelow = window.innerHeight - coords.bottom - padding - 4;
      const spaceAbove = coords.top - padding - 4;

      // Reset max-height to natural so we can measure content height
      menuEl.style.maxHeight = '9999px';
      const naturalHeight = menuEl.scrollHeight;

      if (naturalHeight <= spaceBelow) {
        // Fits below — place below cursor
        menuEl.style.top = `${coords.bottom + 4}px`;
        menuEl.style.maxHeight = `${spaceBelow}px`;
      } else if (naturalHeight <= spaceAbove) {
        // Fits above — place above cursor
        menuEl.style.top = `${coords.top - naturalHeight - 4}px`;
        menuEl.style.maxHeight = `${spaceAbove}px`;
      } else if (spaceBelow >= spaceAbove) {
        // More space below — use all of it with scroll
        menuEl.style.top = `${coords.bottom + 4}px`;
        menuEl.style.maxHeight = `${spaceBelow}px`;
      } else {
        // More space above — use all of it with scroll
        const cappedHeight = Math.min(naturalHeight, spaceAbove);
        menuEl.style.top = `${coords.top - cappedHeight - 4}px`;
        menuEl.style.maxHeight = `${spaceAbove}px`;
      }

      // Clamp horizontally within viewport
      const menuWidth = menuEl.offsetWidth || 260;
      const clampedLeft = Math.max(padding, Math.min(coords.left, window.innerWidth - menuWidth - padding));
      menuEl.style.left = `${clampedLeft}px`;
    } catch {
      // Position may be invalid if doc changed
    }
  }

  function executeItem(view: EditorView, item: SlashMenuItem) {
    // Delete the slash + filter text first
    const { state, dispatch } = view;
    const from = slashPos;
    const to = state.selection.from;
    if (from >= 0 && to >= from) {
      const tr = state.tr.delete(from, to);
      dispatch(tr);
    }
    hide();
    // Execute the command after state update
    setTimeout(() => {
      item.command(view);
    }, 10);
  }

  return new Plugin({
    key: slashMenuKey,
    view(editorView) {
      menuEl = createMenuDOM();
      document.body.appendChild(menuEl);

      // Listen for programmatic slash menu trigger (from "+" button)
      const handleOpenSlash = () => {
        if (!active) {
          slashPos = editorView.state.selection.from - 1;
          filterText = '';
          selectedIndex = 0;
          show(editorView);
        }
      };
      editorView.dom.addEventListener('open-slash-menu', handleOpenSlash);

      return {
        update(view) {
          if (active) updatePosition(view);
        },
        destroy() {
          editorView.dom.removeEventListener('open-slash-menu', handleOpenSlash);
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
          if (event.key === 'Backspace') {
            // If we'd backspace past the slash, close menu
            const { state } = view;
            if (state.selection.from <= slashPos + 1) {
              // Let backspace happen (deletes the /), then close
              setTimeout(() => hide(), 0);
              return false;
            }
            // Otherwise update filter after backspace
            setTimeout(() => {
              const { state: newState } = view;
              if (slashPos >= 0 && newState.selection.from > slashPos) {
                filterText = newState.doc.textBetween(slashPos + 1, newState.selection.from, '');
                selectedIndex = 0;
                updateMenu(view);
              }
            }, 0);
            return false;
          }
          // Let other keys pass through — handleTextInput will update filter
          return false;
        }
        return false;
      },
      handleTextInput(view, from, to, text) {
        if (text === '/') {
          const { $from } = view.state.selection;
          // Only trigger on empty, top-level paragraphs (not inside lists, blockquotes, etc.)
          const before = $from.parent.textContent.slice(0, $from.parentOffset);
          const isEmptyLine = before.trim() === '';
          // Check that the parent paragraph is a direct child of doc (depth == 1)
          const isTopLevel = $from.depth === 1 && $from.parent.type.name === 'paragraph';
          if (isEmptyLine && isTopLevel) {
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
            if (slashPos >= 0 && state.selection.from > slashPos) {
              filterText = state.doc.textBetween(slashPos + 1, state.selection.from, '');
              selectedIndex = 0;
              updateMenu(view);
            }
          }, 0);
          return false;
        }
        return false;
      },
      handleClick(view) {
        // Close menu on click elsewhere in editor
        if (active) hide();
        return false;
      },
    },
    // Close menu if cursor moved before the slash
    appendTransaction(transactions, oldState, newState) {
      if (!active) return null;
      const { selection } = newState;
      if (selection.from < slashPos) {
        hide();
      }
      return null;
    },
  });
}
