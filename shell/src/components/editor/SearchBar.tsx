'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, ChevronUp, ChevronDown, CaseSensitive, Replace } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import {
  setSearchQuery,
  searchNext,
  searchPrev,
  replaceMatch,
  replaceAll,
  getSearchState,
} from './search-plugin';

interface SearchBarProps {
  /** ProseMirror EditorView ref */
  getView: () => any | null;
  /** Whether to show replace field */
  showReplace?: boolean;
  onClose: () => void;
}

export function SearchBar({ getView, showReplace: initialShowReplace = false, onClose }: SearchBarProps) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(initialShowReplace);
  const [matchInfo, setMatchInfo] = useState({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    // Select existing text in editor as initial search query
    const view = getView();
    if (view) {
      const { from, to } = view.state.selection;
      if (from !== to) {
        const selectedText = view.state.doc.textBetween(from, to);
        if (selectedText && selectedText.length < 200) {
          setQuery(selectedText);
        }
      }
    }
  }, [getView]);

  useEffect(() => {
    setShowReplace(initialShowReplace);
  }, [initialShowReplace]);

  // Global Escape listener to close search from anywhere
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const view = getView();
        if (view) setSearchQuery(view, '', false);
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [getView, onClose]);

  // Update search when query or caseSensitive changes
  useEffect(() => {
    const view = getView();
    if (!view) return;
    setSearchQuery(view, query, caseSensitive);
    // Read back match count
    requestAnimationFrame(() => {
      const state = getSearchState(view.state);
      if (state) {
        setMatchInfo({ current: state.matchCount > 0 ? state.currentIndex + 1 : 0, total: state.matchCount });
      }
    });
  }, [query, caseSensitive, getView]);

  const updateMatchInfo = useCallback(() => {
    const view = getView();
    if (!view) return;
    requestAnimationFrame(() => {
      const state = getSearchState(view.state);
      if (state) {
        setMatchInfo({ current: state.matchCount > 0 ? state.currentIndex + 1 : 0, total: state.matchCount });
      }
    });
  }, [getView]);

  const handleNext = useCallback(() => {
    const view = getView();
    if (!view) return;
    searchNext(view);
    updateMatchInfo();
  }, [getView, updateMatchInfo]);

  const handlePrev = useCallback(() => {
    const view = getView();
    if (!view) return;
    searchPrev(view);
    updateMatchInfo();
  }, [getView, updateMatchInfo]);

  const handleReplace = useCallback(() => {
    const view = getView();
    if (!view) return;
    replaceMatch(view, replacement);
    updateMatchInfo();
  }, [getView, replacement, updateMatchInfo]);

  const handleReplaceAll = useCallback(() => {
    const view = getView();
    if (!view) return;
    replaceAll(view, replacement);
    updateMatchInfo();
  }, [getView, replacement, updateMatchInfo]);

  const handleClose = useCallback(() => {
    const view = getView();
    if (view) setSearchQuery(view, '', false);
    onClose();
  }, [getView, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleNext();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handlePrev();
    }
  }, [handleClose, handleNext, handlePrev]);

  return (
    <div className="bg-card border border-border rounded-b-lg shadow-lg px-3 py-2 flex flex-col gap-1.5 min-w-[340px]">
      {/* Find row */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setShowReplace(v => !v)}
          className={cn('p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors', showReplace && 'text-sidebar-primary')}
          title={t('toolbar.toggleReplace')}
        >
          <Replace className="h-3.5 w-3.5" />
        </button>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('search.find')}
          className="flex-1 text-sm bg-muted rounded px-2 py-1 text-foreground outline-none placeholder:text-muted-foreground min-w-0"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
          {matchInfo.total > 0 ? `${matchInfo.current}/${matchInfo.total}` : query ? 'No results' : ''}
        </span>
        <button
          onClick={() => setCaseSensitive(v => !v)}
          className={cn('p-1 rounded transition-colors', caseSensitive ? 'text-sidebar-primary bg-sidebar-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}
          title={t('toolbar.caseSensitive')}
        >
          <CaseSensitive className="h-3.5 w-3.5" />
        </button>
        <button onClick={handlePrev} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title={t('toolbar.prevMatch')}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button onClick={handleNext} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title={t('toolbar.nextMatch')}>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button onClick={handleClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title={t('toolbar.closeSearch')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-1.5 pl-7">
          <input
            value={replacement}
            onChange={e => setReplacement(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('search.replace')}
            className="flex-1 text-sm bg-muted rounded px-2 py-1 text-foreground outline-none placeholder:text-muted-foreground min-w-0"
          />
          <button
            onClick={handleReplace}
            disabled={matchInfo.total === 0}
            className="px-2 py-1 text-xs rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            Replace
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={matchInfo.total === 0}
            className="px-2 py-1 text-xs rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors whitespace-nowrap"
          >
            All
          </button>
        </div>
      )}
    </div>
  );
}
