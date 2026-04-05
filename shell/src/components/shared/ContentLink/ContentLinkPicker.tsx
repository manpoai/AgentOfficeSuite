'use client';

/**
 * ContentLinkPicker — Search and select content to insert as a link.
 *
 * Used in document editors, PPT, and diagrams when inserting a link
 * to another content item. Provides a searchable dropdown with
 * recent and matching content items.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import { listContentItems, type ContentItem } from '@/lib/api/gateway';
import { TYPE_ICONS } from './constants';

interface ContentLinkPickerProps {
  /** Called when a content item is selected */
  onSelect: (contentId: string, item: ContentItem) => void;
  /** Called when picker is dismissed */
  onCancel: () => void;
  /** Filter by content type */
  filterType?: 'doc' | 'table' | 'presentation' | 'diagram';
  /** Additional CSS class */
  className?: string;
}

export function ContentLinkPicker({
  onSelect,
  onCancel,
  filterType,
  className,
}: ContentLinkPickerProps) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCancel]);

  const { data: allItems, isLoading } = useQuery<ContentItem[]>({
    queryKey: ['content-items'],
    queryFn: () => listContentItems(),
    staleTime: 30_000,
  });

  const results = useMemo(() => {
    if (!allItems) return [];
    let filtered = allItems;
    if (filterType) {
      filtered = filtered.filter((item) => item.type === filterType);
    }
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(
        (item) => item.title?.toLowerCase().includes(q),
      );
    }
    return filtered.slice(0, 20);
  }, [allItems, query, filterType]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filterType]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (results.length > 0 && results[selectedIndex]) {
          const item = results[selectedIndex];
          onSelect(item.id, item);
        }
        return;
      }
    },
    [onCancel, onSelect, results, selectedIndex],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-72 bg-popover border border-border rounded-lg shadow-xl overflow-hidden',
        className,
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('content.searchContent')}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Results list */}
      <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : results && results.length > 0 ? (
          results.map((item, index) => {
            const TypeIcon = TYPE_ICONS[item.type] ?? FileText;
            const isSelected = index === selectedIndex;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  if (isSelected && el) {
                    el.scrollIntoView({ block: 'nearest' });
                  }
                }}
                onClick={() => onSelect(item.id, item)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-left',
                  'hover:bg-muted transition-colors',
                  isSelected && 'bg-muted',
                )}
              >
                {item.icon ? (
                  <span className="text-sm shrink-0">{item.icon}</span>
                ) : (
                  <TypeIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{item.title || 'Untitled'}</div>
                  {item.updated_at && (
                    <div className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(item.updated_at)}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        ) : (
          <div className="text-center py-6 text-sm text-muted-foreground">
            {query ? 'No results found' : 'No recent content'}
          </div>
        )}
      </div>
    </div>
  );
}
