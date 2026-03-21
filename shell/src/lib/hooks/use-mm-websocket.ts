'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useIMStore } from '@/lib/stores/im';
import * as mm from '@/lib/api/mm';

const MM_WS_URL = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/mm-ws`
  : '';

/**
 * Mattermost WebSocket hook — uses polling fallback for now.
 * MM WebSocket requires auth token in the handshake which can't be done
 * through a simple proxy. We poll every 3s as a practical alternative.
 */
export function useMMPolling() {
  const { activeChannelId, setMessages, addMessage, setUsers, users, channels, setChannels } = useIMStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollChannel = useCallback(async () => {
    if (!activeChannelId) return;
    try {
      const postList = await mm.getChannelPosts(activeChannelId, 0, 30);
      const posts = postList.order.map(id => postList.posts[id]).filter(Boolean).reverse();
      setMessages(activeChannelId, posts);

      // Fetch unknown users
      const unknownIds: string[] = [];
      posts.forEach(p => {
        if (!users[p.user_id]) unknownIds.push(p.user_id);
      });
      if (unknownIds.length > 0) {
        const unique = Array.from(new Set(unknownIds));
        mm.getUsersByIds(unique).then(setUsers).catch(() => {});
      }
    } catch (e) {
      // Silently fail — will retry
    }
  }, [activeChannelId, setMessages, addMessage, setUsers, users]);

  useEffect(() => {
    if (!activeChannelId) return;

    // Poll every 3 seconds
    intervalRef.current = setInterval(pollChannel, 3000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeChannelId, pollChannel]);
}
