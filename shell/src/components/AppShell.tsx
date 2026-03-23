'use client';
import { usePathname, useRouter } from 'next/navigation';
import { Sun, Moon, Globe, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIMStore } from '@/lib/stores/im';
import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import * as mm from '@/lib/api/mm';
import { CommandPalette } from './CommandPalette';
import { useT, LOCALE_LABELS, type Locale } from '@/lib/i18n';
import Image from 'next/image';

const NAV_KEYS = ['im', 'content', 'tasks', 'contacts'] as const;
const NAV_ICONS: Record<typeof NAV_KEYS[number], string> = {
  im: '/icons/icon-messenger.svg',
  content: '/icons/icon-docs.svg',
  tasks: '/icons/icon-tasks.svg',
  contacts: '/icons/icon-contacts.svg',
};
const NAV_LABELS: Record<typeof NAV_KEYS[number], string> = { im: 'Messenger', content: 'Docs', tasks: 'Tasks', contacts: 'Contacts' };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [showSettings, setShowSettings] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const { t, locale, setLocale } = useT();

  const NAV_ITEMS = NAV_KEYS.map(id => ({
    id,
    path: `/${id}`,
    label: NAV_LABELS[id],
    icon: NAV_ICONS[id],
  }));

  const { data: me } = useQuery({
    queryKey: ['mm-me'],
    queryFn: mm.getMe,
    staleTime: 300_000,
  });

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('asuite-sidebar-collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  // Global keyboard shortcut: ? for help
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        setShowSettings(v => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Close settings menu when clicking outside
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { channels, channelMembers } = useIMStore();
  const totalUnread = useMemo(() => {
    let count = 0;
    for (const ch of channels) {
      const member = channelMembers[ch.id];
      if (member) count += Math.max(0, ch.total_msg_count - member.msg_count);
    }
    return count;
  }, [channels, channelMembers]);

  const activeModule = NAV_ITEMS.find(n => pathname.startsWith(n.path))?.id ?? 'im';

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('asuite-sidebar-collapsed', String(next));
  };

  return (
    <div className="flex h-screen w-screen flex-col md:flex-row bg-background text-foreground">
      {/* Desktop sidebar — hidden on mobile */}
      <nav className={cn(
        'hidden md:flex flex-col border-r border-border shrink-0 transition-all duration-200 ease-in-out relative overflow-hidden bg-[#ECECEC] dark:bg-sidebar',
        collapsed ? 'w-14' : 'w-40'
      )}>
        {/* Logo */}
        <div className="h-[52px] flex items-center px-3 overflow-hidden">
          <span className={cn('text-xl text-foreground font-[family-name:var(--font-allura)] whitespace-nowrap transition-opacity duration-200', collapsed ? 'opacity-0' : 'opacity-100')}>Asuite</span>
        </div>

        {/* Search + Add */}
        <div className="flex items-center gap-1 mb-1 px-2 overflow-hidden">
          <button
            className={cn(
              'flex items-center h-8 rounded-lg text-muted-foreground text-xs transition-all duration-200',
              collapsed ? 'w-8 justify-center' : 'flex-1 px-2 bg-[#E1E2E3] dark:bg-white/10 border border-[#D7D9DA] dark:border-white/10'
            )}
          >
            <span className={cn(collapsed ? 'w-8' : 'w-auto', 'flex items-center justify-center shrink-0')}>
              <img src="/icons/icon-search.svg" alt="" className="h-3.5 w-3.5 opacity-50" />
            </span>
            <span className={cn('whitespace-nowrap transition-opacity duration-200', collapsed ? 'opacity-0 w-0' : 'opacity-100 ml-1.5')}>Search</span>
          </button>
          <button className={cn(
            'flex items-center justify-center h-8 w-8 shrink-0 rounded-lg text-muted-foreground transition-all duration-200',
            collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 bg-[#E1E2E3] dark:bg-white/10 border border-[#D7D9DA] dark:border-white/10'
          )}>
            <img src="/icons/icon-plus.svg" alt="" className="h-3.5 w-3.5 opacity-50" />
          </button>
        </div>

        {/* Nav items — icon always at fixed position to avoid jump on collapse */}
        <div className="flex flex-col gap-0.5 mt-1 px-2">
          {NAV_ITEMS.map(item => {
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => router.push(item.path)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex items-center h-8 rounded-lg text-sm font-medium transition-colors overflow-hidden',
                  'text-left px-0',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10'
                )}
              >
                {/* Fixed-width icon container — always centered in collapsed width */}
                <span className="w-8 flex items-center justify-center shrink-0">
                  <img
                    src={item.icon}
                    alt=""
                    className={cn('h-4 w-4', isActive ? 'opacity-70' : 'opacity-50')}
                  />
                </span>
                <span className={cn('whitespace-nowrap transition-opacity duration-200', collapsed ? 'opacity-0' : 'opacity-100')}>{item.label}</span>
                {item.id === 'im' && totalUnread > 0 && (
                  <span className={cn(
                    'absolute min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full',
                    collapsed ? 'top-0 right-0' : 'right-2'
                  )}>
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Settings + Collapse at bottom */}
        <div className="mb-3 flex flex-col gap-0.5 px-2">
          {/* Settings button with dropdown menu */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings(v => !v)}
              title={collapsed ? 'Settings' : undefined}
              className="flex items-center h-8 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors w-full overflow-hidden px-0"
            >
              <span className="w-8 flex items-center justify-center shrink-0">
                <img src="/icons/icon-settings.svg" alt="" className="h-4 w-4 opacity-50" />
              </span>
              <span className={cn('whitespace-nowrap transition-opacity duration-200', collapsed ? 'opacity-0' : 'opacity-100')}>Settings</span>
            </button>

            {/* Settings dropdown menu */}
            {showSettings && (
              <div className={cn(
                'absolute bottom-full mb-1 bg-card border border-border rounded-lg shadow-lg z-50 py-1 min-w-[200px]',
                collapsed ? 'left-full ml-1' : 'left-0'
              )}>
                {/* Theme toggle */}
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  {t('settings.theme') || 'Theme'}
                </div>
                {mounted && (
                  <div className="px-2 pb-1 flex gap-1">
                    <button
                      onClick={() => setTheme('light')}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded text-xs flex-1',
                        resolvedTheme === 'light' ? 'bg-sidebar-accent text-sidebar-primary font-medium' : 'text-muted-foreground hover:bg-accent/50'
                      )}
                    >
                      <Sun className="h-3.5 w-3.5" />
                      Light
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded text-xs flex-1',
                        resolvedTheme === 'dark' ? 'bg-sidebar-accent text-sidebar-primary font-medium' : 'text-muted-foreground hover:bg-accent/50'
                      )}
                    >
                      <Moon className="h-3.5 w-3.5" />
                      Dark
                    </button>
                  </div>
                )}

                <div className="border-t border-border my-1" />

                {/* Language selector */}
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  {t('settings.language') || 'Language'}
                </div>
                <div className="px-2 pb-1">
                  {(Object.entries(LOCALE_LABELS) as [Locale, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setLocale(key); setShowSettings(false); }}
                      className={cn(
                        'flex items-center gap-2 w-full px-2 py-1 rounded text-xs',
                        locale === key ? 'bg-sidebar-accent text-sidebar-primary font-medium' : 'text-muted-foreground hover:bg-accent/50'
                      )}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="border-t border-border my-1" />

                {/* Keyboard shortcuts */}
                <div className="px-2 pb-1">
                  <button
                    onClick={() => { setShowSettings(false); }}
                    className="flex items-center gap-2 w-full px-2 py-1 rounded text-xs text-muted-foreground hover:bg-accent/50"
                  >
                    <span className="text-[10px]">?</span>
                    <span>{t('shortcuts.title') || 'Keyboard Shortcuts'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Collapse toggle */}
          <button
            onClick={toggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center h-8 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors overflow-hidden px-0"
          >
            <span className="w-8 flex items-center justify-center shrink-0">
              {collapsed
                ? <ChevronRight className="h-4 w-4" />
                : <img src="/icons/icon-collapse.svg" alt="" className="h-4 w-4 opacity-50" />
              }
            </span>
            <span className={cn('whitespace-nowrap transition-opacity duration-200', collapsed ? 'opacity-0' : 'opacity-100')}>Collapse</span>
          </button>
        </div>
      </nav>

      {/* Main content area — fills remaining space */}
      <main className="flex-1 overflow-hidden min-h-0">
        {children}
      </main>

      {/* Global command palette (Cmd+K) */}
      <CommandPalette />

      {/* Mobile bottom tab bar — visible only on mobile */}
      <nav className="flex md:hidden items-center justify-around border-t border-border px-1 shrink-0 bg-[#ECECEC] dark:bg-sidebar"
           style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {NAV_ITEMS.map(item => {
          const isActive = activeModule === item.id;
          return (
            <button
              key={item.id}
              onClick={() => router.push(item.path)}
              className={cn(
                'relative flex flex-col items-center justify-center py-2 px-3 min-w-[64px] transition-colors',
                isActive
                  ? 'text-sidebar-primary'
                  : 'text-muted-foreground'
              )}
            >
              <img
                src={item.icon}
                alt=""
                className={cn('h-5 w-5', isActive ? 'opacity-80' : 'opacity-50')}
              />
              <span className="text-[10px] mt-0.5">{item.label}</span>
              {item.id === 'im' && totalUnread > 0 && (
                <span className="absolute top-1 right-2 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
