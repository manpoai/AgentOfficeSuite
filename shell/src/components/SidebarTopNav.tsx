'use client';

import { FileText, ClipboardCheck, Users, MessageSquare, Bell, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SidebarTab = 'files' | 'tasks' | 'skills' | 'memory';

interface SidebarTopNavProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onNotificationsClick: () => void;
  onSettingsClick: () => void;
  unreadCount: number;
}

const TABS: { id: SidebarTab; icon: typeof FileText }[] = [
  { id: 'files', icon: FileText },
  { id: 'tasks', icon: ClipboardCheck },
  { id: 'skills', icon: Users },
  { id: 'memory', icon: MessageSquare },
];

export function SidebarTopNav({ activeTab, onTabChange, onNotificationsClick, onSettingsClick, unreadCount }: SidebarTopNavProps) {
  return (
    <div className="flex items-center justify-center gap-1 px-2 pt-10 pb-1 shrink-0">
      {TABS.map(({ id, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={cn(
            'p-2 rounded-lg transition-colors',
            activeTab === id
              ? 'bg-sidebar-primary/10 text-sidebar-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
          )}
          title={id.charAt(0).toUpperCase() + id.slice(1)}
        >
          <Icon className="h-5 w-5" />
        </button>
      ))}
      <button
        onClick={onNotificationsClick}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors relative"
        title="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[14px] h-3.5 rounded-full bg-red-500 text-white text-[9px] font-medium flex items-center justify-center px-0.5">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      <button
        onClick={onSettingsClick}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
        title="Settings"
      >
        <Settings className="h-5 w-5" />
      </button>
    </div>
  );
}
