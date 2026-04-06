/**
 * ProseMirror plugin that highlights text matching comment quotes.
 *
 * Since Outline stores comment marks in the Yjs doc state (not accessible via REST API),
 * we use decorations to visually highlight commented text by matching the quoted text
 * from the comments API against the document content.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export interface CommentQuote {
  id: string;
  text: string; // the quoted text from the comment
}

const commentHighlightKey = new PluginKey('commentHighlight');

/**
 * Find all occurrences of a string in a ProseMirror document.
 * Returns array of { from, to } positions.
 */
function findTextInDoc(doc: any, searchText: string): { from: number; to: number }[] {
  const results: { from: number; to: number }[] = [];
  if (!searchText || searchText.length < 2) return results;

  const fullText: string[] = [];
  const positions: number[] = [];

  doc.descendants((node: any, pos: number) => {
    if (node.isText) {
      for (let i = 0; i < node.text.length; i++) {
        fullText.push(node.text[i]);
        positions.push(pos + i);
      }
    }
    return true;
  });

  const joined = fullText.join('');
  let idx = 0;
  while ((idx = joined.indexOf(searchText, idx)) !== -1) {
    const from = positions[idx];
    const to = positions[idx + searchText.length - 1] + 1;
    results.push({ from, to });
    idx += searchText.length;
  }

  return results;
}

export function commentHighlightPlugin(initialQuotes: CommentQuote[] = []) {
  return new Plugin({
    key: commentHighlightKey,
    state: {
      init(_, state) {
        return buildDecorations(state.doc, initialQuotes);
      },
      apply(tr, oldSet, oldState, newState) {
        const meta = tr.getMeta(commentHighlightKey);
        if (meta?.quotes) {
          return buildDecorations(newState.doc, meta.quotes);
        }
        if (tr.docChanged) {
          // Re-map decorations on doc changes
          const quotes = tr.getMeta('commentQuotes') || oldSet._quotes || initialQuotes;
          return buildDecorations(newState.doc, quotes);
        }
        return oldSet;
      },
    },
    props: {
      decorations(state) {
        return commentHighlightKey.getState(state);
      },
    },
  });
}

/** Known block-comment identifiers that won't match inline text */
const BLOCK_COMMENT_MARKERS = new Set(['Image', 'Table', 'Mermaid diagram', 'Math block', 'Code block', 'Notice', '---']);

/**
 * Try to find a block node matching a comment quote text.
 * Returns the node position if found.
 */
function findBlockForQuote(doc: any, quoteText: string): { pos: number; end: number } | null {
  let found: { pos: number; end: number } | null = null;

  doc.forEach((node: any, offset: number) => {
    if (found) return;
    const name = node.type.name;

    if (quoteText === '---' && name === 'horizontal_rule') {
      found = { pos: offset, end: offset + node.nodeSize };
    } else if (quoteText === getT()('editor.mermaidDiagram') && name === 'mermaid_block') {
      found = { pos: offset, end: offset + node.nodeSize };
    } else if ((quoteText === getT()('editor.mathBlock') || quoteText === node.textContent) && name === 'math_block') {
      found = { pos: offset, end: offset + node.nodeSize };
    } else if (quoteText === getT()('editor.image') && name === 'image') {
      found = { pos: offset, end: offset + node.nodeSize };
    } else if (name === 'image' && (quoteText === (node.attrs.alt || node.attrs.title))) {
      found = { pos: offset, end: offset + node.nodeSize };
    } else if (name === 'table') {
      // Match table by first row content
      const cells: string[] = [];
      node.firstChild?.forEach((cell: any) => { cells.push(cell.textContent); });
      const headerText = cells.join(' | ') || getT()('editor.table');
      if (quoteText === headerText || quoteText.startsWith(headerText.slice(0, 50))) {
        found = { pos: offset, end: offset + node.nodeSize };
      }
    } else if (name === 'code_block' && quoteText === getT()('editor.codeBlock')) {
      found = { pos: offset, end: offset + node.nodeSize };
    } else if (name === 'container_notice' && (quoteText === getT()('editor.notice') || quoteText === node.textContent)) {
      found = { pos: offset, end: offset + node.nodeSize };
    }
  });

  return found;
}

function buildDecorations(doc: any, quotes: CommentQuote[]): DecorationSet {
  const decorations: Decoration[] = [];

  for (const quote of quotes) {
    const matches = findTextInDoc(doc, quote.text);
    // Use only the first match (most likely the correct one)
    if (matches.length > 0) {
      const { from, to } = matches[0];
      decorations.push(
        Decoration.inline(from, to, {
          class: 'comment-marker',
          id: `comment-${quote.id}`,
          'data-comment-id': quote.id,
        })
      );
    } else {
      // No inline text match — try block-level matching
      const block = findBlockForQuote(doc, quote.text);
      if (block) {
        decorations.push(
          Decoration.node(block.pos, block.end, {
            class: 'comment-marker comment-marker-block',
            id: `comment-${quote.id}`,
            'data-comment-id': quote.id,
          })
        );
      }
    }
  }

  const set = DecorationSet.create(doc, decorations);
  (set as any)._quotes = quotes;
  return set;
}

/**
 * Update the comment highlights in a running editor view.
 */
export function updateCommentHighlights(view: any, quotes: CommentQuote[]) {
  if (!view) return;
  const tr = view.state.tr.setMeta(commentHighlightKey, { quotes });
  view.dispatch(tr);
}
