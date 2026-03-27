'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, FileText, CheckSquare, Users, Settings, Search, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as gw from '@/lib/api/gateway';
import * as ol from '@/lib/api/outline';
import { useT } from '@/lib/i18n';

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  action: () => void;
  category: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { t } = useT();

  // Fetch data for search
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: gw.listTasks, staleTime: 30_000 });
  const { data: contentItems } = useQuery({ queryKey: ['content-items'], queryFn: gw.listContentItems, staleTime: 30_000 });
  const docs = useMemo(() => contentItems?.filter(i => i.type === 'doc').map(i => ({
    id: i.raw_id, title: i.title, text: '', icon: i.icon || undefined, createdAt: i.created_at || '',
    updatedAt: i.updated_at || '', publishedAt: null, archivedAt: null, deletedAt: null,
    collectionId: i.collection_id || '', parentDocumentId: i.parent_id?.startsWith('doc:') ? i.parent_id.slice(4) : null,
    createdBy: { id: '', name: i.created_by || '' }, updatedBy: { id: '', name: i.updated_by || '' }, revision: 0,
  } as ol.OLDocument)), [contentItems]);
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: gw.listAgents, staleTime: 30_000 });

  // Listen for Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => !v);
        setQuery('');
        setSelectedIndex(0);
      }
      if (e.key === 'Escape' && open) {
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

  // Build command items
  const items = useMemo<CommandItem[]>(() => {
    const result: CommandItem[] = [];

    // Navigation commands (always available)
    const navItems = [
      { label: t('command.navIM'), path: '/im', icon: <MessageSquare className="h-4 w-4" /> },
      { label: t('command.navContent'), path: '/content', icon: <FileText className="h-4 w-4" /> },
      { label: t('command.navTasks'), path: '/tasks', icon: <CheckSquare className="h-4 w-4" /> },
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

    // Tasks
    if (tasks) {
      tasks.forEach(tk => {
        result.push({
          id: `task-${tk.task_id}`,
          label: tk.title,
          sublabel: tk.assignees?.[0] || '',
          icon: <CheckSquare className="h-4 w-4 text-blue-400" />,
          action: () => navigate('/tasks'),
          category: t('command.catTasks'),
        });
      });
    }

    // Docs
    if (docs) {
      docs.forEach(d => {
        result.push({
          id: `doc-${d.id}`,
          label: d.title,
          sublabel: new Date(d.updatedAt).toLocaleDateString('zh-CN'),
          icon: <FileText className="h-4 w-4 text-blue-400" />,
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
  }, [tasks, docs, agents, navigate]);

  // Filter items
  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 15);
    const q = query.toLowerCase();
    return items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      (item.sublabel || '').toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    ).slice(0, 15);
  }, [items, query]);

  // Reset selection on filter change
  useEffect(() => { setSelectedIndex(0); }, [filtered.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
    }
  };

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach(item => {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    });
    return map;
  }, [filtered]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />

      {/* Dialog */}
      <div className="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('command.placeholder')}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">{t('command.noResults')}</p>
          )}
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
                      'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                      selectedIndex === idx ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                  >
                    <span className="text-muted-foreground shrink-0">{item.icon}</span>
                    <span className="text-sm text-foreground flex-1 truncate">{item.label}</span>
                    {item.sublabel && (
                      <span className="text-xs text-muted-foreground shrink-0">{item.sublabel}</span>
                    )}
                    {selectedIndex === idx && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground">
          <span><kbd className="bg-muted px-1 py-0.5 rounded">↑↓</kbd> {t('command.navHint').replace('↑↓ ', '')}</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">Enter</kbd> {t('command.enterHint').replace('Enter ', '')}</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">Esc</kbd> {t('command.escHint').replace('Esc ', '')}</span>
        </div>
      </div>
    </div>
  );
}
