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
}

export function AgentChatView({ agentId, agentName, isActive, colorTheme = 'dark' }: AgentChatViewProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

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
  const mutedColor = isDark ? '#808080' : '#666';
  const borderColor = isDark ? '#333' : '#d4d6d4';
  const bubbleBg = isDark ? '#2a2a4e' : '#dddedd';
  const inputBg = isDark ? '#12122a' : '#f5f5f3';
  const inputBorderColor = isDark ? '#444' : '#bbb';

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
                className="max-w-[80%] rounded-lg px-3 py-2 text-sm"
                style={{
                  backgroundColor: isHuman ? '#3b82f6' : bubbleBg,
                  color: isHuman ? '#fff' : textColor,
                }}
              >
                {!isHuman && (
                  <div className="text-[10px] font-medium mb-1" style={{ color: mutedColor }}>
                    {msg.sender_name || agentName}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                <div className="text-[10px] mt-1" style={{ color: isHuman ? '#93c5fd' : mutedColor }}>
                  {formatTime(msg.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input bar */}
      <div
        className="shrink-0 px-3 py-2 flex items-end gap-2"
        style={{ borderTop: `1px solid ${borderColor}`, backgroundColor: bg }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${agentName}...`}
          rows={1}
          className="flex-1 resize-none rounded-md px-3 py-2 text-sm outline-none max-h-[120px] overflow-y-auto"
          style={{
            backgroundColor: inputBg,
            color: textColor,
            border: `1px solid ${inputBorderColor}`,
            minHeight: 36,
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="shrink-0 p-2 rounded-md transition-colors"
          style={{
            backgroundColor: input.trim() && !sending ? '#3b82f6' : (isDark ? '#333' : '#d4d6d4'),
            color: input.trim() && !sending ? '#fff' : mutedColor,
          }}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
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
