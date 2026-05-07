'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { API_BASE } from '@/lib/api/config';
import * as gw from '@/lib/api/gateway';

const SSEContext = createContext<EventSource | null>(null);

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!token) return;

    const es = new EventSource(`${API_BASE}/notifications/stream?token=${token}`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        if (event.event === 'notification.created') {
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
        }

        if (event.event === 'comment.changed') {
          // Invalidate all comment queries for the target — queryKey prefix ['comments'] covers all variants
          queryClient.invalidateQueries({ queryKey: ['comments'] });
        }

        if (event.event === 'content.changed') {
          queryClient.invalidateQueries({ queryKey: ['content-items'] });
          if (event.data?.type === 'doc' && event.data?.id) {
            queryClient.invalidateQueries({ queryKey: ['document', event.data.id] });
          }
        }

        if (event.type === 'message.sent') {
          queryClient.invalidateQueries({ queryKey: ['agent-messages', event.agent_id] });
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    // Reconnect SSE and refetch key queries when page becomes visible again
    // (mobile browsers often kill SSE connections when backgrounded)
    const onVisibilityChange = () => {
      if (document.hidden) return;
      if (esRef.current?.readyState === EventSource.CLOSED) {
        esRef.current?.close();
        const newEs = new EventSource(`${API_BASE}/notifications/stream?token=${token}`);
        newEs.onmessage = es.onmessage;
        newEs.onerror = es.onerror;
        esRef.current = newEs;
      }
      // Refetch key data on resume (including any document the user may have open)
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
      queryClient.invalidateQueries({ queryKey: ['document'] });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => { es.close(); esRef.current = null; document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [token, queryClient]);

  return <SSEContext.Provider value={esRef.current}>{children}</SSEContext.Provider>;
}

export const useSSE = () => useContext(SSEContext);
