/**
 * Placeholder plugin for ProseMirror.
 * Shows placeholder text on empty paragraphs and a "+" block handle.
 * - When the document is completely empty: shows full placeholder on the first paragraph
 * - On any empty paragraph that has focus: shows a "+" handle on the left that opens slash menu
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';

export const placeholderKey = new PluginKey('placeholder');

function triggerSlashMenu(view: EditorView) {
  // Insert "/" at the cursor position
  const { state } = view;
  const tr = state.tr.insertText('/');
  view.dispatch(tr);
  view.focus();
  // The slash-menu plugin listens on appendTransaction for programmatic "/" insertion
  // We dispatch a custom DOM event that slash-menu can listen for
  view.dom.dispatchEvent(new CustomEvent('open-slash-menu'));
}

export function placeholderPlugin(text: string): Plugin {
  return new Plugin({
    key: placeholderKey,
    props: {
      decorations(state) {
        const { doc, selection } = state;
        const decorations: Decoration[] = [];

        // Check if entire document is empty (single empty paragraph)
        const isDocEmpty = doc.childCount === 1 &&
          doc.firstChild?.type.name === 'paragraph' &&
          doc.firstChild.content.size === 0;

        if (isDocEmpty) {
          // Show full placeholder on the first (empty) paragraph
          decorations.push(
            Decoration.node(0, doc.firstChild!.nodeSize, {
              class: 'is-empty-placeholder',
              'data-placeholder': text,
            })
          );
        }

        // Show "+" handle on the focused empty paragraph at top level only (depth === 1)
        const { $from } = selection;
        const parentNode = $from.parent;
        if (parentNode.type.name === 'paragraph' && parentNode.content.size === 0 && !isDocEmpty && $from.depth === 1) {
          const pos = $from.before($from.depth);
          const end = $from.after($from.depth);
          decorations.push(
            Decoration.node(pos, end, {
              class: 'is-empty-line',
            })
          );
          // Clickable "+" button widget
          decorations.push(
            Decoration.widget(pos + 1, (view: EditorView) => {
              const btn = document.createElement('button');
              btn.className = 'block-add-handle';
              btn.textContent = '+';
              btn.contentEditable = 'false';
              btn.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                triggerSlashMenu(view);
              };
              return btn;
            }, { side: -1 })
          );
        }

        return DecorationSet.create(doc, decorations);
      },
    },
  });
}
