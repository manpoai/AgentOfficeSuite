/**
 * Floating toolbar selection tracker for ProseMirror.
 * Reports selection position to the React layer via a callback.
 * The actual toolbar UI is rendered by shared/FloatingToolbar.
 */
import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';

export const floatingToolbarKey = new PluginKey('floatingToolbar');

export interface SelectionInfo {
  /** Viewport coordinates for toolbar positioning */
  anchor: { top: number; left: number; width: number };
  /** The EditorView for creating handlers */
  view: EditorView;
}

type SelectionCallback = (info: SelectionInfo | null) => void;

function computeAnchor(view: EditorView, from: number, to: number): SelectionInfo['anchor'] {
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  const midX = start.top === end.top
    ? (start.left + end.left) / 2
    : (start.left + view.dom.getBoundingClientRect().right) / 2;
  const width = start.top === end.top ? end.left - start.left : view.dom.getBoundingClientRect().width;
  return { top: start.top, left: midX - width / 2, width };
}

function shouldShow(view: EditorView): boolean {
  const { state } = view;
  const { selection } = state;
  const { from, to, empty } = selection;
  if (empty || from === to) return false;
  if (selection instanceof NodeSelection) return false;
  if (selection instanceof CellSelection) return false;
  const $from = state.doc.resolve(from);
  if ($from.parent.type === schema.nodes.code_block) return false;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') return false;
  }
  return true;
}

export function floatingToolbarPlugin(onSelection: SelectionCallback): Plugin {
  let isMouseDown = false;
  let showTimeout: ReturnType<typeof setTimeout> | null = null;
  let isHovering = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  function scheduleHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; }
    hideTimeout = setTimeout(() => {
      hideTimeout = null;
      if (!isHovering) onSelection(null);
    }, 150);
  }

  function showAt(view: EditorView) {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    const { from, to } = view.state.selection;
    onSelection({ anchor: computeAnchor(view, from, to), view });
  }

  return new Plugin({
    key: floatingToolbarKey,
    view(editorView) {
      // Expose hover tracking for the React toolbar to call
      const el = editorView.dom.closest('.outline-editor');
      if (el) {
        (el as any).__toolbarHover = (hovering: boolean) => {
          isHovering = hovering;
          if (hovering && hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        };
      }

      const onMouseDown = () => { isMouseDown = true; if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; } };
      const onMouseUp = () => {
        isMouseDown = false;
        showTimeout = setTimeout(() => {
          showTimeout = null;
          if (shouldShow(editorView)) showAt(editorView);
          else scheduleHide();
        }, 50);
      };
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);

      return {
        update(view) {
          if (isMouseDown) { onSelection(null); return; }
          if (shouldShow(view)) showAt(view);
          else scheduleHide();
        },
        destroy() {
          if (hideTimeout) clearTimeout(hideTimeout);
          if (showTimeout) clearTimeout(showTimeout);
          document.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mouseup', onMouseUp);
          onSelection(null);
        },
      };
    },
  });
}
