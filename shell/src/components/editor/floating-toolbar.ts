/**
 * Floating toolbar plugin for ProseMirror.
 * Appears when text is selected, showing inline formatting options.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
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

function buildToolbarActions(): ToolbarAction[] {
  const t = getT();
  return [
    // -- Inline marks --
    {
      label: t('editor.bold'), icon: 'B', mark: 'strong', section: 'inline',
      command: (view) => { toggleMark(schema.marks.strong)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.italic'), icon: 'I', mark: 'em', section: 'inline',
      command: (view) => { toggleMark(schema.marks.em)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.underline'), icon: 'U', mark: 'underline', section: 'inline',
      command: (view) => { toggleMark(schema.marks.underline)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.strikethrough'), icon: 'S', mark: 'strikethrough', section: 'inline',
      command: (view) => { toggleMark(schema.marks.strikethrough)(view.state, view.dispatch); view.focus(); },
    },
    // -- Separator, then link/code --
    {
      label: t('editor.link'), icon: '🔗', section: 'block',
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
      label: t('editor.inlineCode'), icon: '⟨⟩', mark: 'code', section: 'block',
      command: (view) => { toggleMark(schema.marks.code)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.highlight'), icon: '■', mark: 'highlight', section: 'block',
      command: (view) => { toggleMark(schema.marks.highlight)(view.state, view.dispatch); view.focus(); },
    },
    // -- Separator, then headings --
    {
      label: t('editor.heading1'), icon: 'H1', section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 1 }),
      command: (view) => { setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.heading2'), icon: 'H2', section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 2 }),
      command: (view) => { setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.heading3'), icon: 'H3', section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.heading, { level: 3 }),
      command: (view) => { setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch); view.focus(); },
    },
    // -- Separator, then block elements --
    {
      label: t('editor.quote'), icon: '❝', section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.blockquote),
      command: (view) => { wrapIn(schema.nodes.blockquote)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.bulletList'), icon: '•', section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.bullet_list),
      command: (view) => { wrapIn(schema.nodes.bullet_list)(view.state, view.dispatch); view.focus(); },
    },
    {
      label: t('editor.orderedList'), icon: '1.', section: 'block',
      isActive: (view) => isBlockActive(view, schema.nodes.ordered_list),
      command: (view) => { wrapIn(schema.nodes.ordered_list)(view.state, view.dispatch); view.focus(); },
    },
    // -- Comment --
    {
      label: t('editor.comment'), icon: '💬', section: 'block',
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
    border-radius: 8px; padding: 3px 4px; gap: 1px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    display: none; flex-direction: row; align-items: center;
    backdrop-filter: blur(8px);
  `;
  return el;
}

function addSeparator(el: HTMLDivElement) {
  const sep = document.createElement('div');
  sep.style.cssText = 'width: 1px; height: 20px; background: hsl(var(--border, 0 0% 90%)); margin: 0 3px;';
  el.appendChild(sep);
}

function renderToolbar(el: HTMLDivElement, view: EditorView) {
  el.innerHTML = '';
  let lastSection: ToolbarSection = 'inline';
  const TOOLBAR_ACTIONS = buildToolbarActions();

  TOOLBAR_ACTIONS.forEach((action, i) => {
    // Add separator between sections
    if (i > 0 && i === 4) addSeparator(el); // after S, before link
    if (i === 7) addSeparator(el); // before headings
    if (i === 10) addSeparator(el); // before block elements
    if (i === 13) addSeparator(el); // before comment

    const btn = document.createElement('button');
    const active = action.mark
      ? isMarkActive(view, action.mark)
      : action.isActive ? action.isActive(view) : false;

    const isSmallText = action.icon.length <= 2 && !['B','I','U','S'].includes(action.icon);
    btn.style.cssText = `
      min-width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
      border: none; border-radius: 5px; cursor: pointer;
      font-size: ${isSmallText ? '11px' : '13px'};
      font-weight: ${action.icon === 'B' ? '700' : isSmallText ? '600' : '500'};
      font-style: ${action.icon === 'I' ? 'italic' : 'normal'};
      text-decoration: ${action.icon === 'U' ? 'underline' : action.icon === 'S' ? 'line-through' : 'none'};
      color: ${active ? '#fff' : 'hsl(var(--muted-foreground, 0 0% 45%))'};
      background: ${active ? 'hsl(var(--sidebar-primary, 228 80% 60%))' : 'transparent'};
      padding: 0 5px;
      transition: all 0.1s;
    `;
    btn.title = action.label;
    btn.textContent = action.icon;
    btn.onmouseenter = () => {
      if (!active) { btn.style.background = 'hsl(var(--accent, 0 0% 96%))'; btn.style.color = 'hsl(var(--foreground, 0 0% 9%))'; }
    };
    btn.onmouseleave = () => {
      if (!active) { btn.style.background = 'transparent'; btn.style.color = 'hsl(var(--muted-foreground, 0 0% 45%))'; }
    };
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
  let isHovering = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  let isMouseDown = false;
  let showTimeout: ReturnType<typeof setTimeout> | null = null;

  function showAt(view: EditorView, from: number, to: number) {
    if (!toolbarEl) return;
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }

    renderToolbar(toolbarEl, view);

    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    // Use viewport coordinates (fixed positioning)
    const midX = (start.left + end.left) / 2;
    const top = start.top - 44; // above the selection

    toolbarEl.style.display = 'flex';
    // Measure toolbar width for centering
    const toolbarWidth = toolbarEl.offsetWidth || 400;
    const leftPos = Math.max(8, Math.min(midX - toolbarWidth / 2, window.innerWidth - toolbarWidth - 8));
    toolbarEl.style.left = `${leftPos}px`;
    toolbarEl.style.top = `${Math.max(8, top)}px`;
    isShown = true;
  }

  function hide() {
    if (!toolbarEl) return;
    // Don't hide if mouse is over the toolbar
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

      // Track mouse state to avoid showing toolbar during drag selection
      const onMouseDown = () => { isMouseDown = true; if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; } };
      const onMouseUp = () => {
        isMouseDown = false;
        // After mouse up, show toolbar if there's a selection
        showTimeout = setTimeout(() => {
          showTimeout = null;
          const { state } = editorView;
          const { from, to, empty } = state.selection;
          if (!empty && from !== to) {
            const $from = state.doc.resolve(from);
            if ($from.parent.type !== schema.nodes.code_block) {
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

          // Only show for non-empty text selections (not node selections)
          if (empty || from === to) {
            if (isHovering) return;
            scheduleHide();
            return;
          }

          // Don't show while mouse is being dragged (active selection in progress)
          if (isMouseDown) return;

          // Don't show in code blocks
          const $from = state.doc.resolve(from);
          if ($from.parent.type === schema.nodes.code_block) {
            scheduleHide();
            return;
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
