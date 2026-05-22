/**
 * ProseMirror plugin that highlights text matching comment quotes.
 *
 * Comment marks are not stored inline in the document; instead we use decorations
 * to visually highlight commented text by matching the quoted text from the
 * comments API against the document content.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { getT } from '@/lib/i18n';

export interface CommentQuote {
  id: string;
  text: string;         // the quoted text (text-range) or anchor preview (block)
  anchorType?: string;  // anchor type — if block type, use findBlockByType
  blockId?: string;     // stable block ID for precise positioning
  blockOffset?: number; // character offset within the block
  blockEndOffset?: number;
}

const commentHighlightKey = new PluginKey('commentHighlight');


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

function findByBlockId(doc: any, blockId: string, blockOffset: number, blockEndOffset: number, quoteText?: string): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  doc.forEach((node: any, offset: number) => {
    if (result) return;
    if (node.attrs?.blockId === blockId) {
      const from = offset + blockOffset;
      const to = offset + blockEndOffset;
      if (from >= offset && to <= offset + node.nodeSize) {
        result = { from, to };
        return;
      }
      // Offsets stale (content edited) — search for quote text within this block
      if (quoteText && quoteText.length >= 2) {
        const blockText = node.textContent || '';
        const idx = blockText.indexOf(quoteText);
        if (idx >= 0) {
          let charsSeen = 0;
          let startPos = -1;
          node.descendants((child: any, childPos: number) => {
            if (startPos >= 0) return false;
            if (child.isText) {
              const textStart = charsSeen;
              const textEnd = charsSeen + child.text.length;
              if (idx >= textStart && idx < textEnd) {
                startPos = offset + 1 + childPos + (idx - textStart);
              }
              charsSeen = textEnd;
            }
          });
          if (startPos >= 0) {
            result = { from: startPos, to: startPos + quoteText.length };
          }
        }
      }
    }
  });
  return result;
}

const BLOCK_ANCHOR_TYPES = new Set(['image', 'table', 'mermaid', 'diagram_embed']);

/**
 * Find the first block node matching an anchor type.
 */
function findBlockByType(doc: any, anchorType: string): { pos: number; end: number } | null {
  const typeMap: Record<string, string> = {
    'image': 'image',
    'table': 'table',
    'mermaid': 'mermaid_block',
    'diagram_embed': 'diagram_embed',
  };
  const pmType = typeMap[anchorType];
  if (!pmType) return null;
  let result: { pos: number; end: number } | null = null;
  doc.descendants((node: any, pos: number) => {
    if (result) return false;
    if (node.type.name === pmType) {
      result = { pos, end: pos + node.nodeSize };
      return false;
    }
  });
  return result;
}

function buildDecorations(doc: any, quotes: CommentQuote[]): DecorationSet {
  const decorations: Decoration[] = [];

  for (const quote of quotes) {
    // Block-type anchor: use structural matching first
    if (quote.anchorType && BLOCK_ANCHOR_TYPES.has(quote.anchorType)) {
      // Try preview text match (more precise) first, then fallback to type-based
      let block: { pos: number; end: number } | null = null;
      if (quote.text) {
        block = findBlockForQuote(doc, quote.text);
      }
      if (!block) {
        block = findBlockByType(doc, quote.anchorType);
      }
      if (block) {
        decorations.push(
          Decoration.node(block.pos, block.end, {
            class: 'comment-marker comment-marker-block',
            id: `comment-${quote.id}`,
            'data-comment-id': quote.id,
          })
        );
      }
      continue;
    }

    // text-range anchor: blockId-based positioning only
    if (quote.blockId && quote.blockOffset != null && quote.blockEndOffset != null) {
      const byBlock = findByBlockId(doc, quote.blockId, quote.blockOffset, quote.blockEndOffset, quote.text);
      if (byBlock) {
        decorations.push(
          Decoration.inline(byBlock.from, byBlock.to, {
            class: 'comment-marker',
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
