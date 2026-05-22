/**
 * Find & Replace plugin for ProseMirror.
 * Highlights all matches with decorations, navigates between them,
 * and supports replace/replace-all.
 */
import { Plugin, PluginKey, EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';

export const searchPluginKey = new PluginKey<SearchState>('search');

interface SearchState {
  query: string;
  caseSensitive: boolean;
  /** Index of the currently focused match (0-based) */
  currentIndex: number;
  /** Total match count (computed from decorations) */
  matchCount: number;
  decorations: DecorationSet;
}

function findMatches(doc: any, query: string, caseSensitive: boolean): { from: number; to: number }[] {
  if (!query) return [];
  const results: { from: number; to: number }[] = [];
  const searchStr = caseSensitive ? query : query.toLowerCase();

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text = caseSensitive ? node.text! : node.text!.toLowerCase();
    let idx = 0;
    while (idx < text.length) {
      const found = text.indexOf(searchStr, idx);
      if (found === -1) break;
      results.push({ from: pos + found, to: pos + found + query.length });
      idx = found + 1;
    }
  });

  return results;
}

function buildDecorations(doc: any, query: string, caseSensitive: boolean, currentIndex: number): { decorations: DecorationSet; matchCount: number } {
  const matches = findMatches(doc, query, caseSensitive);
  if (matches.length === 0) {
    return { decorations: DecorationSet.empty, matchCount: 0 };
  }

  const decos = matches.map((m, i) => {
    const cls = i === currentIndex ? 'search-match search-match-current' : 'search-match';
    return Decoration.inline(m.from, m.to, { class: cls });
  });

  return { decorations: DecorationSet.create(doc, decos), matchCount: matches.length };
}

/** Set or clear the search query */
export function setSearchQuery(view: EditorView, query: string, caseSensitive: boolean = false) {
  const tr = view.state.tr.setMeta(searchPluginKey, { type: 'setQuery', query, caseSensitive });
  view.dispatch(tr);
  if (query) scrollToCurrentMatch(view);
}

/** Navigate to next match */
export function searchNext(view: EditorView) {
  const tr = view.state.tr.setMeta(searchPluginKey, { type: 'next' });
  view.dispatch(tr);
  scrollToCurrentMatch(view);
}

/** Navigate to previous match */
export function searchPrev(view: EditorView) {
  const tr = view.state.tr.setMeta(searchPluginKey, { type: 'prev' });
  view.dispatch(tr);
  scrollToCurrentMatch(view);
}

/** Replace current match */
export function replaceMatch(view: EditorView, replacement: string) {
  const state = searchPluginKey.getState(view.state);
  if (!state || state.matchCount === 0) return;

  const matches = findMatches(view.state.doc, state.query, state.caseSensitive);
  if (matches.length === 0) return;

  const idx = Math.min(state.currentIndex, matches.length - 1);
  const match = matches[idx];

  const tr = view.state.tr.replaceWith(match.from, match.to, view.state.schema.text(replacement));
  tr.setMeta(searchPluginKey, { type: 'replaced' });
  view.dispatch(tr);
}

/** Replace all matches */
export function replaceAll(view: EditorView, replacement: string) {
  const state = searchPluginKey.getState(view.state);
  if (!state || state.matchCount === 0) return;

  const matches = findMatches(view.state.doc, state.query, state.caseSensitive);
  if (matches.length === 0) return;

  // Replace from end to start to keep positions valid
  let tr = view.state.tr;
  for (let i = matches.length - 1; i >= 0; i--) {
    tr = tr.replaceWith(matches[i].from, matches[i].to, view.state.schema.text(replacement));
  }
  tr.setMeta(searchPluginKey, { type: 'replaced' });
  view.dispatch(tr);
}

/** Get current search state */
export function getSearchState(state: EditorState): SearchState | undefined {
  return searchPluginKey.getState(state);
}

function scrollToCurrentMatch(view: EditorView) {
  requestAnimationFrame(() => {
    const el = view.dom.querySelector('.search-match-current');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

export function searchPlugin() {
  return new Plugin<SearchState>({
    key: searchPluginKey,

    state: {
      init(): SearchState {
        return {
          query: '',
          caseSensitive: false,
          currentIndex: 0,
          matchCount: 0,
          decorations: DecorationSet.empty,
        };
      },

      apply(tr: Transaction, prev: SearchState, _oldState: EditorState, newState: EditorState): SearchState {
        const meta = tr.getMeta(searchPluginKey);

        if (meta) {
          if (meta.type === 'setQuery') {
            const { query, caseSensitive } = meta;
            if (!query) {
              return { query: '', caseSensitive, currentIndex: 0, matchCount: 0, decorations: DecorationSet.empty };
            }
            const { decorations, matchCount } = buildDecorations(newState.doc, query, caseSensitive, 0);
            return { query, caseSensitive, currentIndex: 0, matchCount, decorations };
          }

          if (meta.type === 'next' && prev.matchCount > 0) {
            const nextIdx = (prev.currentIndex + 1) % prev.matchCount;
            const { decorations, matchCount } = buildDecorations(newState.doc, prev.query, prev.caseSensitive, nextIdx);
            return { ...prev, currentIndex: nextIdx, matchCount, decorations };
          }

          if (meta.type === 'prev' && prev.matchCount > 0) {
            const prevIdx = (prev.currentIndex - 1 + prev.matchCount) % prev.matchCount;
            const { decorations, matchCount } = buildDecorations(newState.doc, prev.query, prev.caseSensitive, prevIdx);
            return { ...prev, currentIndex: prevIdx, matchCount, decorations };
          }

          if (meta.type === 'replaced') {
            // After replace, rebuild decorations
            const { decorations, matchCount } = buildDecorations(newState.doc, prev.query, prev.caseSensitive, Math.min(prev.currentIndex, Math.max(0, prev.matchCount - 2)));
            const newIdx = matchCount > 0 ? Math.min(prev.currentIndex, matchCount - 1) : 0;
            const rebuilt = buildDecorations(newState.doc, prev.query, prev.caseSensitive, newIdx);
            return { ...prev, currentIndex: newIdx, matchCount: rebuilt.matchCount, decorations: rebuilt.decorations };
          }
        }

        // Doc changed — remap decorations
        if (tr.docChanged && prev.query) {
          const { decorations, matchCount } = buildDecorations(newState.doc, prev.query, prev.caseSensitive, Math.min(prev.currentIndex, Math.max(0, prev.matchCount - 1)));
          const newIdx = matchCount > 0 ? Math.min(prev.currentIndex, matchCount - 1) : 0;
          const rebuilt = buildDecorations(newState.doc, prev.query, prev.caseSensitive, newIdx);
          return { ...prev, currentIndex: newIdx, matchCount: rebuilt.matchCount, decorations: rebuilt.decorations };
        }

        return prev;
      },
    },

    props: {
      decorations(state: EditorState) {
        return searchPluginKey.getState(state)?.decorations || DecorationSet.empty;
      },
    },
  });
}
