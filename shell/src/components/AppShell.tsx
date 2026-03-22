'use client';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, FileText, CheckSquare, Users, Settings, Keyboard, Sun, Moon, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIMStore } from '@/lib/stores/im';
import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import * as mm from '@/lib/api/mm';
import { CommandPalette } from './CommandPalette';
import { useT, LOCALE_LABELS, type Locale } from '@/lib/i18n';

const NAV_KEYS = ['im', 'content', 'tasks', 'contacts'] as const;
const NAV_ICONS = { im: MessageSquare, content: FileText, tasks: CheckSquare, contacts: Users } as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const { t, locale, setLocale } = useT();

  const NAV_ITEMS = NAV_KEYS.map(id => ({
    id,
    path: `/${id}`,
    label: t(`nav.${id}`),
    icon: NAV_ICONS[id],
  }));

  const { data: me } = useQuery({
    queryKey: ['mm-me'],
    queryFn: mm.getMe,
    staleTime: 300_000,
  });

  // Global keyboard shortcut: ? for help
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        setShowShortcuts(v => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const { theme, setTheme, resolvedTheme } = useTheme();
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

  return (
    <div className="flex h-screen w-screen flex-col md:flex-row bg-background text-foreground">
      {/* Desktop sidebar — hidden on mobile */}
      <nav className="hidden md:flex w-16 flex-col items-center border-r border-border bg-sidebar py-3 gap-1 shrink-0">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const isActive = activeModule === item.id;
          return (
            <button
              key={item.id}
              onClick={() => router.push(item.path)}
              title={item.label}
              className={cn(
                'relative flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-primary'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">{item.label}</span>
              {item.id === 'im' && totalUnread > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />

        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          title={mounted && resolvedTheme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
          className="flex items-center justify-center w-12 h-12 rounded-xl text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
        >
          {mounted && resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="relative">
          <button
            onClick={() => setShowLangMenu(v => !v)}
            title={LOCALE_LABELS[locale]}
            className="flex items-center justify-center w-12 h-12 rounded-xl text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
          >
            <Globe className="h-4 w-4" />
          </button>
          {showLangMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
              <div className="absolute left-full bottom-0 ml-2 z-50 bg-card border border-border rounded-lg shadow-xl py-1 w-28">
                {(Object.entries(LOCALE_LABELS) as [Locale, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setLocale(key); setShowLangMenu(false); }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-xs transition-colors',
                      locale === key ? 'text-sidebar-primary font-medium bg-accent' : 'text-foreground hover:bg-accent/50'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => setShowShortcuts(true)}
          title={`${t('shortcuts.title')} (?)`}
          className="flex items-center justify-center w-12 h-12 rounded-xl text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
        >
          <Keyboard className="h-4 w-4" />
        </button>

        {me && (
          <div className="mb-2 flex flex-col items-center">
            <img
              src={mm.getProfileImageUrl(me.id)}
              alt=""
              className="w-8 h-8 rounded-full bg-muted"
              title={me.nickname || me.username}
            />
            <span className="text-[8px] text-muted-foreground mt-0.5 truncate max-w-[56px]">
              {me.nickname || me.username}
            </span>
          </div>
        )}
      </nav>

      {/* Main content area — fills remaining space */}
      <main className="flex-1 overflow-hidden min-h-0">
        {children}
      </main>

      {/* Global command palette (Cmd+K) */}
      <CommandPalette />

      {/* Keyboard shortcuts help */}
      {showShortcuts && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowShortcuts(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-2xl w-[380px] max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">{t('shortcuts.title')}</h3>
              <button onClick={() => setShowShortcuts(false)} className="text-muted-foreground hover:text-foreground text-xs">ESC</button>
            </div>
            <div className="p-4 space-y-3">
              <ShortcutGroup title={t('shortcuts.global')}>
                <ShortcutRow keys={['⌘', 'K']} desc={t('shortcuts.openCommandPalette')} />
                <ShortcutRow keys={['?']} desc={t('shortcuts.openHelp')} />
              </ShortcutGroup>
              <ShortcutGroup title={t('shortcuts.tasks')}>
                <ShortcutRow keys={['N']} desc={t('shortcuts.newTask')} />
              </ShortcutGroup>
              <ShortcutGroup title={t('shortcuts.im')}>
                <ShortcutRow keys={['Enter']} desc={t('shortcuts.sendMessage')} />
                <ShortcutRow keys={['Shift', 'Enter']} desc={t('shortcuts.newLine')} />
                <ShortcutRow keys={['Esc']} desc={t('shortcuts.cancelEdit')} />
              </ShortcutGroup>
              <ShortcutGroup title={t('shortcuts.dataTable')}>
                <ShortcutRow keys={['Tab']} desc={t('shortcuts.nextCol')} />
                <ShortcutRow keys={['Enter']} desc={t('shortcuts.nextRow')} />
                <ShortcutRow keys={['Esc']} desc={t('shortcuts.cancel')} />
              </ShortcutGroup>
            </div>
          </div>
        </>
      )}

      {/* Mobile bottom tab bar — visible only on mobile */}
      <nav className="flex md:hidden items-center justify-around border-t border-border bg-sidebar px-1 shrink-0"
           style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
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
              <Icon className="h-5 w-5" />
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

function ShortcutGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ShortcutRow({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-foreground/80">{desc}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i}>
            <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-mono bg-muted border border-border rounded text-muted-foreground">{k}</kbd>
            {i < keys.length - 1 && <span className="text-[10px] text-muted-foreground mx-0.5">+</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
