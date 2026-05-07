'use client';

import { ClipboardCheck, Users, MessageSquare } from 'lucide-react';
import type { SidebarTab } from './SidebarTopNav';

const TAB_META: Record<Exclude<SidebarTab, 'files'>, { icon: typeof ClipboardCheck; label: string }> = {
  tasks: { icon: ClipboardCheck, label: 'Tasks' },
  skills: { icon: Users, label: 'Skills' },
  memory: { icon: MessageSquare, label: 'Memory' },
};

export function EmptyTabPage({ tab }: { tab: Exclude<SidebarTab, 'files'> }) {
  const { icon: Icon, label } = TAB_META[tab];
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-4">
      <Icon className="h-10 w-10 mb-3 opacity-30" />
      <p className="text-sm font-medium opacity-50">{label}</p>
      <p className="text-xs opacity-30 mt-1">Coming soon</p>
    </div>
  );
}
