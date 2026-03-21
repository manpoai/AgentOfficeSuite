'use client';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, FileText, CheckSquare, Users, Settings, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIMStore } from '@/lib/stores/im';
import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as mm from '@/lib/api/mm';
import { CommandPalette } from './CommandPalette';

const NAV_ITEMS = [
  { id: 'im',       path: '/im',       label: 'IM',     icon: MessageSquare },
  { id: 'content',  path: '/content',  label: '内容',   icon: FileText },
  { id: 'tasks',    path: '/tasks',    label: '任务',   icon: CheckSquare },
  { id: 'contacts', path: '/contacts', label: '联系人', icon: Users },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [showShortcuts, setShowShortcuts] = useState(false);

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
          onClick={() => setShowShortcuts(true)}
          title="快捷键 (?)"
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
              <h3 className="text-sm font-semibold text-foreground">键盘快捷键</h3>
              <button onClick={() => setShowShortcuts(false)} className="text-muted-foreground hover:text-foreground text-xs">ESC</button>
            </div>
            <div className="p-4 space-y-3">
              <ShortcutGroup title="全局">
                <ShortcutRow keys={['⌘', 'K']} desc="打开命令面板" />
                <ShortcutRow keys={['?']} desc="打开此帮助" />
              </ShortcutGroup>
              <ShortcutGroup title="任务">
                <ShortcutRow keys={['N']} desc="新建任务" />
              </ShortcutGroup>
              <ShortcutGroup title="IM">
                <ShortcutRow keys={['Enter']} desc="发送消息" />
                <ShortcutRow keys={['Shift', 'Enter']} desc="换行" />
                <ShortcutRow keys={['Esc']} desc="取消编辑/回复" />
              </ShortcutGroup>
              <ShortcutGroup title="数据表">
                <ShortcutRow keys={['Tab']} desc="下一列" />
                <ShortcutRow keys={['Enter']} desc="下一行" />
                <ShortcutRow keys={['Esc']} desc="取消编辑" />
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
