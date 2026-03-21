'use client';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, FileText, CheckSquare, Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIMStore } from '@/lib/stores/im';
import { useMemo } from 'react';
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
          onClick={() => router.push('/settings')}
          title="设置"
          className="flex items-center justify-center w-12 h-12 rounded-xl text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors mb-2"
        >
          <Settings className="h-5 w-5" />
        </button>
      </nav>

      {/* Main content area — fills remaining space */}
      <main className="flex-1 overflow-hidden min-h-0">
        {children}
      </main>

      {/* Global command palette (Cmd+K) */}
      <CommandPalette />

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
