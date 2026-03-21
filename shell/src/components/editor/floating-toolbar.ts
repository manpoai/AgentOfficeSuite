/**
 * Floating toolbar plugin for ProseMirror.
 * Appears when text is selected, showing inline formatting options.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { toggleMark } from 'prosemirror-commands';
import { schema } from './schema';

export const floatingToolbarKey = new PluginKey('floatingToolbar');

interface ToolbarAction {
  label: string;
  icon: string;
  mark?: string;
  isActive?: (view: EditorView) => boolean;
  command: (view: EditorView) => void;
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    label: '加粗', icon: 'B', mark: 'strong',
    command: (view) => { toggleMark(schema.marks.strong)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '斜体', icon: 'I', mark: 'em',
    command: (view) => { toggleMark(schema.marks.em)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '下划线', icon: 'U', mark: 'underline',
    command: (view) => { toggleMark(schema.marks.underline)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '删除线', icon: 'S', mark: 'strikethrough',
    command: (view) => { toggleMark(schema.marks.strikethrough)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '行内代码', icon: '⟨⟩', mark: 'code',
    command: (view) => { toggleMark(schema.marks.code)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '高亮', icon: '■', mark: 'highlight',
    command: (view) => { toggleMark(schema.marks.highlight)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '链接', icon: '🔗',
    command: (view) => {
      const { state, dispatch } = view;
      const { from, to } = state.selection;
      if (from === to) return;

      // Check if already has a link
      const existingLink = state.doc.rangeHasMark(from, to, schema.marks.link);
      if (existingLink) {
        // Remove link
        dispatch(state.tr.removeMark(from, to, schema.marks.link));
        view.focus();
        return;
      }

      const href = prompt('链接地址：');
      if (href) {
        dispatch(state.tr.addMark(from, to, schema.marks.link.create({ href })));
      }
      view.focus();
    },
  },
];

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
    position: absolute; z-index: 100; display: none;
    background: hsl(240 6% 14%); border: 1px solid hsl(240 4% 20%);
    border-radius: 8px; padding: 2px; gap: 1px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    display: none; flex-direction: row; align-items: center;
  `;
  return el;
}

function renderToolbar(el: HTMLDivElement, view: EditorView) {
  el.innerHTML = '';
  TOOLBAR_ACTIONS.forEach((action, i) => {
    // Add separator before link
    if (i === TOOLBAR_ACTIONS.length - 1) {
      const sep = document.createElement('div');
      sep.style.cssText = 'width: 1px; height: 20px; background: hsl(240 4% 22%); margin: 0 2px;';
      el.appendChild(sep);
    }

    const btn = document.createElement('button');
    const active = action.mark ? isMarkActive(view, action.mark) : false;
    btn.style.cssText = `
      width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
      border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
      font-weight: ${action.icon === 'B' ? '700' : action.icon === 'I' ? '400' : '500'};
      font-style: ${action.icon === 'I' ? 'italic' : 'normal'};
      text-decoration: ${action.icon === 'U' ? 'underline' : action.icon === 'S' ? 'line-through' : 'none'};
      color: ${active ? '#e4e4e7' : '#a1a1aa'};
      background: ${active ? 'hsl(240 4% 22%)' : 'transparent'};
    `;
    btn.title = action.label;
    btn.textContent = action.icon;
    btn.onmousedown = (e) => {
      e.preventDefault(); // Prevent losing selection
      e.stopPropagation();
      action.command(view);
      // Re-render to update active states
      setTimeout(() => renderToolbar(el, view), 0);
    };
    el.appendChild(btn);
  });
}

export function floatingToolbarPlugin(): Plugin {
  let toolbarEl: HTMLDivElement | null = null;
  let isShown = false;

  function showAt(view: EditorView, from: number, to: number) {
    if (!toolbarEl) return;

    renderToolbar(toolbarEl, view);

    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    const editorRect = view.dom.closest('.outline-editor')?.getBoundingClientRect() || view.dom.getBoundingClientRect();

    // Center above the selection
    const midX = (start.left + end.left) / 2 - editorRect.left;
    const top = start.top - editorRect.top - 40;

    toolbarEl.style.display = 'flex';
    toolbarEl.style.left = `${Math.max(4, midX - 110)}px`;
    toolbarEl.style.top = `${Math.max(4, top)}px`;
    isShown = true;
  }

  function hide() {
    if (!toolbarEl) return;
    toolbarEl.style.display = 'none';
    isShown = false;
  }

  return new Plugin({
    key: floatingToolbarKey,
    view(editorView) {
      toolbarEl = createToolbarDOM();
      const container = editorView.dom.closest('.outline-editor');
      if (container) {
        (container as HTMLElement).style.position = 'relative';
        container.appendChild(toolbarEl);
      }
      return {
        update(view, prevState) {
          const { state } = view;
          const { selection } = state;
          const { from, to, empty } = selection;

          // Only show for non-empty text selections (not node selections)
          if (empty || from === to) {
            hide();
            return;
          }

          // Don't show in code blocks
          const $from = state.doc.resolve(from);
          if ($from.parent.type === schema.nodes.code_block) {
            hide();
            return;
          }

          showAt(view, from, to);
        },
        destroy() {
          toolbarEl?.remove();
          toolbarEl = null;
        },
      };
    },
  });
}
