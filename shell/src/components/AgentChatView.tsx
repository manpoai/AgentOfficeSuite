'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as gw from '@/lib/api/gateway';

interface AgentChatViewProps {
  agentId: string;
  agentName: string;
  isActive: boolean;
  colorTheme?: 'light' | 'dark';
  agentKind?: string | null;
  originDeviceId?: string | null;
}

export function AgentChatView({ agentId, agentName, isActive, colorTheme = 'dark', agentKind, originDeviceId }: AgentChatViewProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: gw.getSyncStatus,
    staleTime: 60_000,
  });
  const myDeviceId = syncStatus?.device_id || null;

  const { data, isLoading } = useQuery({
    queryKey: ['agent-messages', agentId],
    queryFn: () => gw.listAgentMessages(agentId, 100),
    enabled: isActive,
    refetchInterval: false,
  });

  const messages = data?.messages ? [...data.messages].reverse() : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    if (isActive) inputRef.current?.focus();
  }, [isActive]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');
    try {
      await gw.sendAgentMessage(agentId, text);
      queryClient.invalidateQueries({ queryKey: ['agent-messages', agentId] });
    } catch (e) {
      setInput(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, agentId, queryClient]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const isDark = colorTheme === 'dark';
  const bg = isDark ? '#1a1a2e' : '#EBEFEB';
  const textColor = isDark ? '#e0e0e0' : '#1a1a1a';
  const mutedColor = isDark ? '#808080' : '#999';
  const agentBubbleBg = isDark ? '#2a2a3e' : '#F5F7F5';
  const humanBubbleBg = isDark ? '#1a4a2e' : '#C5E8D3';
  const humanTextColor = isDark ? '#e0e0e0' : '#1a1a1a';
  const humanTimeColor = isDark ? '#80b090' : '#666';

  if (!isActive) return null;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: bg, color: textColor }}>
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {isLoading && (
          <div className="text-xs text-center py-4" style={{ color: mutedColor }}>Loading...</div>
        )}
        {!isLoading && messages.length === 0 && (
          <div className="text-xs text-center py-8" style={{ color: mutedColor }}>
            Send a message to {agentName}
          </div>
        )}
        {messages.map((msg) => {
          const isHuman = msg.sender_type === 'human';
          return (
            <div key={msg.id} className={cn('flex', isHuman ? 'justify-end' : 'justify-start')}>
              <div
                className="max-w-[80%] rounded-lg px-3 py-2 text-xs"
                style={{
                  backgroundColor: isHuman ? humanBubbleBg : agentBubbleBg,
                  color: isHuman ? humanTextColor : textColor,
                }}
              >
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                <div className="text-[10px] mt-1" style={{ color: isHuman ? humanTimeColor : mutedColor }}>
                  {formatTime(msg.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input bar — aligned with CommentPanel style */}
      {(() => {
        const isOwnerDevice = agentKind === 'local' && !!myDeviceId && originDeviceId === myDeviceId;
        const canMessage = agentKind !== 'local' || isOwnerDevice;
        if (!canMessage) {
          return (
            <div className="shrink-0 px-3 py-2 text-center text-xs" style={{ backgroundColor: bg, color: mutedColor }}>
              This agent runs locally on another device
            </div>
          );
        }
        return (
          <div className="shrink-0 px-3 py-2" style={{ backgroundColor: bg }}>
            <div className="flex items-center bg-card rounded-lg border border-border h-10 px-2 gap-1 has-[:focus]:border-sidebar-primary transition-colors">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${agentName}...`}
                className="flex-1 text-xs text-foreground placeholder:text-muted-foreground bg-transparent outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className={cn(
                  'p-1 rounded transition-colors shrink-0',
                  input.trim() && !sending ? 'text-foreground hover:text-foreground/80' : 'text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}
