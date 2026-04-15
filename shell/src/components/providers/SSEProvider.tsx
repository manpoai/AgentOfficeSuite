'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';

const SSEContext = createContext<EventSource | null>(null);

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!token) return;

    const es = new EventSource(`/api/gateway/notifications/stream?token=${token}`);
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
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => { es.close(); esRef.current = null; };
  }, [token, queryClient]);

  return <SSEContext.Provider value={esRef.current}>{children}</SSEContext.Provider>;
}

export const useSSE = () => useContext(SSEContext);
