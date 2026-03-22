'use client';

import { useState } from 'react';
import { useIMStore } from '@/lib/stores/im';
import * as mm from '@/lib/api/mm';
import { Hash, Lock, User, Users, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useT } from '@/lib/i18n';

function channelIcon(type: string) {
  switch (type) {
    case 'O': return <Hash className="h-4 w-4 shrink-0" />;
    case 'P': return <Lock className="h-4 w-4 shrink-0" />;
    case 'D': return <User className="h-4 w-4 shrink-0" />;
    case 'G': return <Users className="h-4 w-4 shrink-0" />;
    default:  return <Hash className="h-4 w-4 shrink-0" />;
  }
}

export function ChannelList() {
  const { channels, activeChannelId, setActiveChannel, users, channelMembers, setMobileView, myUserId } = useIMStore();
  const [search, setSearch] = useState('');
  const { t } = useT();

  function getDisplayName(ch: typeof channels[0]) {
    if (ch.type === 'D' && ch.name) {
      // DM: show the other user's name (not me)
      const parts = ch.name.split('__');
      const otherUid = parts.find(id => id !== myUserId) || parts[0];
      const u = users[otherUid];
      if (u) return u.nickname || u.username || u.first_name || ch.display_name;
      return ch.display_name || otherUid.slice(0, 8);
    }
    return ch.display_name || ch.name;
  }

  function getUnreadCount(channelId: string) {
    const member = channelMembers[channelId];
    const ch = channels.find(c => c.id === channelId);
    if (!member || !ch) return 0;
    return ch.total_msg_count - member.msg_count;
  }

  const handleSelect = (channelId: string) => {
    setActiveChannel(channelId);
    setMobileView('messages');
  };

  // Filter by search
  const filtered = search
    ? channels.filter(c => getDisplayName(c).toLowerCase().includes(search.toLowerCase()))
    : channels;

  // Group channels
  const publicChannels = filtered.filter(c => c.type === 'O');
  const privateChannels = filtered.filter(c => c.type === 'P');
  const dmChannels = filtered.filter(c => c.type === 'D' || c.type === 'G');

  return (
    <>
      <div className="p-3 border-b border-border space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{t('im.channels')}</h2>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('im.searchChannels')}
            className="w-full bg-muted rounded-lg pl-7 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {channels.length === 0 ? (
            /* Skeleton loading */
            <div className="space-y-1 px-3 py-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 animate-pulse">
                  <div className="w-4 h-4 rounded bg-muted" />
                  <div className="h-3 rounded bg-muted" style={{ width: `${50 + Math.random() * 80}px` }} />
                </div>
              ))}
            </div>
          ) : (
            <>
              {publicChannels.length > 0 && (
                <ChannelGroup label={t('im.publicChannels')} channels={publicChannels} active={activeChannelId} onSelect={handleSelect} getDisplayName={getDisplayName} getUnread={getUnreadCount} />
              )}
              {privateChannels.length > 0 && (
                <ChannelGroup label={t('im.privateChannels')} channels={privateChannels} active={activeChannelId} onSelect={handleSelect} getDisplayName={getDisplayName} getUnread={getUnreadCount} />
              )}
              {dmChannels.length > 0 && (
                <ChannelGroup label={t('im.directMessages')} channels={dmChannels} active={activeChannelId} onSelect={handleSelect} getDisplayName={getDisplayName} getUnread={getUnreadCount} />
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </>
  );
}

function ChannelGroup({
  label, channels, active, onSelect, getDisplayName, getUnread,
}: {
  label: string;
  channels: mm.MMChannel[];
  active: string | null;
  onSelect: (id: string) => void;
  getDisplayName: (ch: mm.MMChannel) => string;
  getUnread: (id: string) => number;
}) {
  return (
    <div className="mb-2">
      <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      {channels.map(ch => {
        const unread = getUnread(ch.id);
        return (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
              active === ch.id
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground/80 hover:bg-accent/50'
            )}
          >
            {channelIcon(ch.type)}
            <span className="truncate flex-1">{getDisplayName(ch)}</span>
            {unread > 0 && (
              <span className="bg-sidebar-primary text-sidebar-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
