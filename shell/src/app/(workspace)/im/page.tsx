'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIMStore } from '@/lib/stores/im';
import * as mm from '@/lib/api/mm';
import { ChannelList } from './channel-list';
import { MessageArea } from './message-area';
import { useMMPolling } from '@/lib/hooks/use-mm-websocket';
import { useT } from '@/lib/i18n';

export default function IMPage() {
  const { setChannels, setChannelMembers, setUsers, setMyUserId, activeChannelId, mobileView } = useIMStore();
  const { t } = useT();

  // Real-time message polling
  useMMPolling();

  // Fetch current user
  const { data: me } = useQuery({
    queryKey: ['mm-me'],
    queryFn: mm.getMe,
  });

  useEffect(() => {
    if (me) {
      setMyUserId(me.id);
      setUsers([me]);
    }
  }, [me, setMyUserId, setUsers]);

  // Fetch teams → channels
  const { data: teams } = useQuery({
    queryKey: ['mm-teams'],
    queryFn: mm.getTeams,
  });

  const teamId = teams?.[0]?.id;

  const { data: channels } = useQuery({
    queryKey: ['mm-channels', teamId],
    queryFn: () => mm.getMyChannels(teamId!),
    enabled: !!teamId,
  });

  const { data: members } = useQuery({
    queryKey: ['mm-channel-members', teamId],
    queryFn: () => mm.getMyChannelMembers(teamId!),
    enabled: !!teamId,
  });

  const { setActiveChannel } = useIMStore();

  // Load channels into store
  useEffect(() => {
    if (channels) {
      setChannels(channels);
      // Collect unique user ids from DM channel names
      const userIds = new Set<string>();
      channels.forEach(ch => {
        if (ch.type === 'D' && ch.name) {
          ch.name.split('__').forEach(id => userIds.add(id));
        }
      });
      if (userIds.size > 0) {
        mm.getUsersByIds(Array.from(userIds)).then(setUsers).catch(() => {});
      }
      // Restore or auto-select channel
      if (!activeChannelId) {
        try {
          const saved = localStorage.getItem('asuite-im-active-channel');
          if (saved && channels.some(ch => ch.id === saved)) {
            setActiveChannel(saved);
            return;
          }
        } catch { /* ignore */ }
        // Auto-select first channel
        if (channels.length > 0) {
          setActiveChannel(channels[0].id);
        }
      }
    }
  }, [channels, setChannels, setUsers, activeChannelId, setActiveChannel]);

  useEffect(() => {
    if (members) setChannelMembers(members);
  }, [members, setChannelMembers]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Channel list — always visible on desktop, toggle on mobile */}
      <div className={`
        w-full md:w-[304px] border-r border-border bg-[#F5F5F5] dark:bg-sidebar flex flex-col shrink-0
        ${mobileView === 'channels' ? 'flex' : 'hidden md:flex'}
      `}>
        <ChannelList />
      </div>

      {/* Message area — always visible on desktop, toggle on mobile */}
      <div className={`
        flex-1 flex flex-col min-w-0 overflow-hidden bg-white dark:bg-card
        ${mobileView === 'messages' ? 'flex' : 'hidden md:flex'}
      `}>
        {activeChannelId ? (
          <MessageArea channelId={activeChannelId} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <p className="text-sm">{t('im.selectChannel')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
