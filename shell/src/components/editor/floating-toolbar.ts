/**
 * Floating toolbar plugin for ProseMirror.
 * Appears when text is selected, showing inline formatting options.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { schema } from './schema';

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

function isBlockActive(view: EditorView, nodeType: any, attrs?: Record<string, any>): boolean {
  const { state } = view;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === nodeType) {
      if (attrs) {
        return Object.keys(attrs).every(k => node.attrs[k] === attrs[k]);
      }
      return true;
    }
  }
  // Check parent
  if ($from.parent.type === nodeType) {
    if (attrs) {
      return Object.keys(attrs).every(k => $from.parent.attrs[k] === attrs[k]);
    }
    return true;
  }
  return false;
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  // -- Inline marks --
  {
    label: '加粗', icon: 'B', mark: 'strong', section: 'inline',
    command: (view) => { toggleMark(schema.marks.strong)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '斜体', icon: 'I', mark: 'em', section: 'inline',
    command: (view) => { toggleMark(schema.marks.em)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '下划线', icon: 'U', mark: 'underline', section: 'inline',
    command: (view) => { toggleMark(schema.marks.underline)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '删除线', icon: 'S', mark: 'strikethrough', section: 'inline',
    command: (view) => { toggleMark(schema.marks.strikethrough)(view.state, view.dispatch); view.focus(); },
  },
  // -- Separator, then link/code --
  {
    label: '链接', icon: '🔗', section: 'block',
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
      const href = prompt('链接地址：');
      if (href) {
        dispatch(state.tr.addMark(from, to, schema.marks.link.create({ href })));
      }
      view.focus();
    },
  },
  {
    label: '行内代码', icon: '⟨⟩', mark: 'code', section: 'block',
    command: (view) => { toggleMark(schema.marks.code)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '高亮', icon: '■', mark: 'highlight', section: 'block',
    command: (view) => { toggleMark(schema.marks.highlight)(view.state, view.dispatch); view.focus(); },
  },
  // -- Separator, then headings --
  {
    label: '标题1', icon: 'H1', section: 'block',
    isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 1 }),
    command: (view) => { setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '标题2', icon: 'H2', section: 'block',
    isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 2 }),
    command: (view) => { setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '标题3', icon: 'H3', section: 'block',
    isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 3 }),
    command: (view) => { setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch); view.focus(); },
  },
  // -- Separator, then block elements --
  {
    label: '引用', icon: '❝', section: 'block',
    isActive: (view) => isBlockActive(view, schema.nodes.blockquote),
    command: (view) => { wrapIn(schema.nodes.blockquote)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '无序列表', icon: '•', section: 'block',
    isActive: (view) => isBlockActive(view, schema.nodes.bullet_list),
    command: (view) => { wrapIn(schema.nodes.bullet_list)(view.state, view.dispatch); view.focus(); },
  },
  {
    label: '有序列表', icon: '1.', section: 'block',
    isActive: (view) => isBlockActive(view, schema.nodes.ordered_list),
    command: (view) => { wrapIn(schema.nodes.ordered_list)(view.state, view.dispatch); view.focus(); },
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

function addSeparator(el: HTMLDivElement) {
  const sep = document.createElement('div');
  sep.style.cssText = 'width: 1px; height: 20px; background: hsl(240 4% 22%); margin: 0 3px;';
  el.appendChild(sep);
}

function renderToolbar(el: HTMLDivElement, view: EditorView) {
  el.innerHTML = '';
  let lastSection: ToolbarSection = 'inline';

  TOOLBAR_ACTIONS.forEach((action, i) => {
    // Add separator between sections
    if (i > 0 && i === 4) addSeparator(el); // after S, before link
    if (i === 7) addSeparator(el); // before headings
    if (i === 10) addSeparator(el); // before block elements

    const btn = document.createElement('button');
    const active = action.mark
      ? isMarkActive(view, action.mark)
      : action.isActive ? action.isActive(view) : false;

    const isSmallText = action.icon.length <= 2 && !['B','I','U','S'].includes(action.icon);
    btn.style.cssText = `
      min-width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
      border: none; border-radius: 4px; cursor: pointer;
      font-size: ${isSmallText ? '11px' : '13px'};
      font-weight: ${action.icon === 'B' ? '700' : isSmallText ? '600' : '500'};
      font-style: ${action.icon === 'I' ? 'italic' : 'normal'};
      text-decoration: ${action.icon === 'U' ? 'underline' : action.icon === 'S' ? 'line-through' : 'none'};
      color: ${active ? '#e4e4e7' : '#a1a1aa'};
      background: ${active ? 'hsl(240 4% 22%)' : 'transparent'};
      padding: 0 4px;
    `;
    btn.title = action.label;
    btn.textContent = action.icon;
    btn.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      action.command(view);
      setTimeout(() => renderToolbar(el, view), 0);
    };
    el.appendChild(btn);

    lastSection = action.section;
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
    toolbarEl.style.left = `${Math.max(4, midX - 200)}px`;
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
