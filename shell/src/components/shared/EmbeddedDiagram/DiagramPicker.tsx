// shell/src/components/shared/EmbeddedDiagram/DiagramPicker.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listContentItems, createContentItem, type ContentItem } from '@/lib/api/gateway';
import { Plus, Search, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { showError } from '@/lib/utils/error';
import { formatRelativeTime } from '@/lib/utils/time';

interface DiagramPickerProps {
  onSelect: (diagramId: string, item: ContentItem) => void;
  onCancel: () => void;
  /** When true, newly created diagrams won't appear in the file list */
  embedded?: boolean;
}

export function DiagramPicker({ onSelect, onCancel, embedded }: DiagramPickerProps) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: allItems = [] } = useQuery({
    queryKey: ['content-items'],
    queryFn: listContentItems,
    staleTime: 30_000,
  });

  const diagrams = allItems
    .filter((item) => item.type === 'diagram')
    .filter((item) => !query || item.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 20);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  useEffect(() => {
    if (selectedIndex >= diagrams.length) setSelectedIndex(Math.max(0, diagrams.length - 1));
  }, [diagrams.length, selectedIndex]);

  const handleCreateNew = useCallback(async () => {
    setCreating(true);
    try {
      const item = await createContentItem({
        type: 'diagram',
        title: query || 'Untitled Diagram',
        embedded,
      });
      onSelect(item.id, item);
    } catch (err) {
      showError('Failed to create diagram', err);
    } finally {
      setCreating(false);
    }
  }, [query, onSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, diagrams.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (diagrams.length > 0) {
        const item = diagrams[selectedIndex];
        onSelect(item.id, item);
      } else {
        handleCreateNew();
      }
    }
  }, [diagrams, selectedIndex, onSelect, onCancel, handleCreateNew]);

  const formatTime = (ts: number) => formatRelativeTime(ts);

  return (
    <div
      ref={containerRef}
      className="w-80 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          placeholder={t('diagram.searchDiagrams')}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <button
        onClick={handleCreateNew}
        disabled={creating}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-accent transition-colors border-b border-border"
      >
        <Plus className="w-4 h-4" />
        {creating ? 'Creating...' : `Create new diagram${query ? `: "${query}"` : ''}`}
      </button>

      <div className="max-h-64 overflow-y-auto">
        {diagrams.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            {query ? 'No diagrams match your search' : 'No diagrams yet'}
          </div>
        )}
        {diagrams.map((item, i) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id, item)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
              i === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50'
            }`}
          >
            <span className="shrink-0">🔀</span>
            <span className="flex-1 truncate">{item.title || 'Untitled Diagram'}</span>
            {item.updated_at && (
              <span className="text-xs text-muted-foreground shrink-0">{formatTime(item.updated_at)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
