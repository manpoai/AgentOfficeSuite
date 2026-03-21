'use client';

import { useIMStore } from '@/lib/stores/im';
import * as mm from '@/lib/api/mm';
import { Hash, Lock, User, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

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

  // Group channels
  const publicChannels = channels.filter(c => c.type === 'O');
  const privateChannels = channels.filter(c => c.type === 'P');
  const dmChannels = channels.filter(c => c.type === 'D' || c.type === 'G');

  return (
    <>
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">频道</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {publicChannels.length > 0 && (
            <ChannelGroup label="公开频道" channels={publicChannels} active={activeChannelId} onSelect={handleSelect} getDisplayName={getDisplayName} getUnread={getUnreadCount} />
          )}
          {privateChannels.length > 0 && (
            <ChannelGroup label="私有频道" channels={privateChannels} active={activeChannelId} onSelect={handleSelect} getDisplayName={getDisplayName} getUnread={getUnreadCount} />
          )}
          {dmChannels.length > 0 && (
            <ChannelGroup label="私信" channels={dmChannels} active={activeChannelId} onSelect={handleSelect} getDisplayName={getDisplayName} getUnread={getUnreadCount} />
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
