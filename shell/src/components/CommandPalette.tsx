'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileText, Table2, Presentation, GitBranch, Users, Settings, Search, ArrowRight, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime, formatDate } from '@/lib/utils/time';
import * as gw from '@/lib/api/gateway';
import { useT } from '@/lib/i18n';

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  action: () => void;
  category: string;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  doc: <FileText className="h-4 w-4" />,
  table: <Table2 className="h-4 w-4" />,
  presentation: <Presentation className="h-4 w-4" />,
  diagram: <GitBranch className="h-4 w-4" />,
};

const TYPE_LABEL: Record<string, string> = {
  doc: 'Documents',
  table: 'Tables',
  presentation: 'Presentations',
  diagram: 'Diagrams',
};

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || query.length < 2) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-300/40 dark:bg-yellow-500/30 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function formatTime(ts?: string): string {
  return formatRelativeTime(ts);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { t } = useT();

  // Debounce search query (300ms, min 2 chars)
  useEffect(() => {
    if (query.length < 2) {
      setDebouncedQuery('');
      return;
    }
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Global search API
  const { data: searchData, isFetching: isSearching } = useQuery({
    queryKey: ['global-search', debouncedQuery],
    queryFn: () => gw.globalSearch(debouncedQuery, 20),
    enabled: debouncedQuery.length >= 2,
    staleTime: 10_000,
  });

  // Fetch data for fallback commands
  const { data: contentItems } = useQuery({ queryKey: ['content-items'], queryFn: gw.listContentItems, staleTime: 30_000 });
  const docs = useMemo(() => contentItems?.filter(i => i.type === 'doc').map(i => ({
    id: i.raw_id, title: i.title,
    updated_at: i.updated_at || '',
  })), [contentItems]);
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: gw.listAgents, staleTime: 30_000 });

  // Listen for open-command-palette custom event (dispatched by KeyboardManager)
  useEffect(() => {
    const handler = () => {
      setOpen(v => {
        if (!v) {
          setQuery('');
          setDebouncedQuery('');
          setSelectedIndex(0);
        }
        return !v;
      });
    };
    window.addEventListener('open-command-palette', handler);
    return () => window.removeEventListener('open-command-palette', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const navigate = useCallback((path: string) => {
    router.push(path);
    setOpen(false);
  }, [router]);

  // Determine if we're in search mode (user typed >= 2 chars)
  const isSearchMode = debouncedQuery.length >= 2;

  // Build search result items (grouped by type)
  const searchItems = useMemo<CommandItem[]>(() => {
    if (!isSearchMode || !searchData?.results) return [];
    return searchData.results.map(r => ({
      id: `search-${r.id}`,
      label: r.title,
      sublabel: r.snippet
        ? (r.snippet.length > 80 ? r.snippet.slice(0, 80) + '...' : r.snippet)
        : formatTime(r.updated_at),
      icon: <span className="text-muted-foreground">{TYPE_ICON[r.type] || <FileText className="h-4 w-4" />}</span>,
      action: () => navigate(`/content?id=${r.type}:${r.id}`),
      category: TYPE_LABEL[r.type] || r.type,
    }));
  }, [isSearchMode, searchData, navigate]);

  // Build fallback command items (when no search query)
  const commandItems = useMemo<CommandItem[]>(() => {
    const result: CommandItem[] = [];

    // Navigation commands (always available)
    const navItems = [
      { label: t('command.navContent'), path: '/content', icon: <FileText className="h-4 w-4" /> },
      { label: t('command.navContacts'), path: '/contacts', icon: <Users className="h-4 w-4" /> },
      { label: t('command.navSettings'), path: '/settings', icon: <Settings className="h-4 w-4" /> },
    ];
    navItems.forEach(n => {
      result.push({
        id: `nav-${n.path}`,
        label: n.label,
        icon: n.icon,
        action: () => navigate(n.path),
        category: t('command.catNav'),
      });
    });

    // Docs
    if (docs) {
      docs.forEach(d => {
        result.push({
          id: `doc-${d.id}`,
          label: d.title,
          sublabel: d.updated_at ? formatDate(d.updated_at) : '',
          icon: <FileText className="h-4 w-4 text-muted-foreground" />,
          action: () => navigate('/content'),
          category: t('command.catDocs'),
        });
      });
    }

    // Agents
    if (agents) {
      agents.forEach(a => {
        result.push({
          id: `agent-${a.name}`,
          label: a.display_name || a.name,
          sublabel: a.online ? t('command.online') : t('command.offline'),
          icon: <Users className="h-4 w-4 text-green-400" />,
          action: () => navigate('/contacts'),
          category: 'Agent',
        });
      });
    }

    return result;
  }, [docs, agents, navigate, t]);

  // Items to display: search results in search mode, otherwise filtered commands
  const displayItems = useMemo(() => {
    if (isSearchMode) return searchItems;
    if (!query) return commandItems.slice(0, 15);
    const q = query.toLowerCase();
    return commandItems.filter(item =>
      item.label.toLowerCase().includes(q) ||
      (item.sublabel || '').toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    ).slice(0, 15);
  }, [isSearchMode, searchItems, commandItems, query]);

  // Reset selection on filter change
  useEffect(() => { setSelectedIndex(0); }, [displayItems.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, displayItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && displayItems[selectedIndex]) {
      e.preventDefault();
      displayItems[selectedIndex].action();
    }
  };

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    displayItems.forEach(item => {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    });
    return map;
  }, [displayItems]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-0 md:pt-[15vh]">
      {/* Backdrop (hidden on mobile since we go full-screen) */}
      <div className="absolute inset-0 bg-black/50 hidden md:block" onClick={() => setOpen(false)} />

      {/* Dialog — full-screen on mobile, centered card on desktop */}
      <div className="relative w-full h-full md:h-auto md:max-w-lg bg-card md:border md:border-border md:rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Search input — taller on mobile for comfortable touch */}
        <div className="flex items-center gap-3 px-4 py-4 md:py-3 border-b border-border shrink-0"
             style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 1rem)' }}>
          <Search className="h-5 w-5 md:h-4 md:w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('command.placeholder')}
            className="flex-1 bg-transparent text-base md:text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {isSearching && <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />}
          <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded hidden md:inline">ESC</kbd>
          {/* Mobile close button */}
          <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-muted md:hidden">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Results — fills remaining space on mobile, capped height on desktop */}
        <div className="flex-1 md:flex-none md:max-h-[50vh] overflow-y-auto py-1"
             style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {/* Loading state for search */}
          {isSearchMode && isSearching && displayItems.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">{t('common.searching')}</p>
            </div>
          )}

          {/* No results */}
          {!isSearching && displayItems.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {isSearchMode ? t('common.noResultsFound') : t('command.noResults')}
            </p>
          )}

          {/* Grouped results */}
          {Array.from(grouped.entries()).map(([category, categoryItems]) => (
            <div key={category}>
              <div className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {category}
              </div>
              {categoryItems.map(item => {
                flatIndex++;
                const idx = flatIndex;
                return (
                  <button
                    key={item.id}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2 min-h-[48px] md:min-h-0 text-left transition-colors',
                      selectedIndex === idx ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                  >
                    <span className="text-muted-foreground shrink-0">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground truncate block">
                        {isSearchMode ? highlightMatch(item.label, debouncedQuery) : item.label}
                      </span>
                      {isSearchMode && item.sublabel && (
                        <span className="text-xs text-muted-foreground truncate block mt-0.5">
                          {highlightMatch(item.sublabel, debouncedQuery)}
                        </span>
                      )}
                    </div>
                    {!isSearchMode && item.sublabel && (
                      <span className="text-xs text-muted-foreground shrink-0">{item.sublabel}</span>
                    )}
                    {selectedIndex === idx && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer — hidden on mobile */}
        <div className="px-4 py-2 border-t border-border items-center gap-4 text-[10px] text-muted-foreground hidden md:flex">
          <span><kbd className="bg-muted px-1 py-0.5 rounded">↑↓</kbd> {t('command.navHint').replace('↑↓ ', '')}</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">Enter</kbd> {t('command.enterHint').replace('Enter ', '')}</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">Esc</kbd> {t('command.escHint').replace('Esc ', '')}</span>
        </div>
      </div>
    </div>
  );
}
