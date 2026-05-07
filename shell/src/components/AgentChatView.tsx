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

  if (!isActive) return null;

  return (
    <div className={cn(
      'flex flex-col h-full',
      isDark ? 'bg-[#1e1e1e] text-[#d4d4d4]' : 'bg-white text-foreground'
    )}>
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {isLoading && (
          <div className="text-xs text-muted-foreground text-center py-4">Loading...</div>
        )}
        {!isLoading && messages.length === 0 && (
          <div className={cn(
            'text-xs text-center py-8',
            isDark ? 'text-[#808080]' : 'text-muted-foreground'
          )}>
            Send a message to {agentName}
          </div>
        )}
        {messages.map((msg) => {
          const isHuman = msg.sender_type === 'human';
          return (
            <div key={msg.id} className={cn('flex', isHuman ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                isHuman
                  ? isDark ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'
                  : isDark ? 'bg-[#2d2d2d] text-[#d4d4d4]' : 'bg-gray-100 text-foreground'
              )}>
                {!isHuman && (
                  <div className={cn(
                    'text-[10px] font-medium mb-1',
                    isDark ? 'text-[#888]' : 'text-muted-foreground'
                  )}>
                    {msg.sender_name || agentName}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                <div className={cn(
                  'text-[10px] mt-1',
                  isHuman
                    ? 'text-blue-200'
                    : isDark ? 'text-[#666]' : 'text-muted-foreground/60'
                )}>
                  {formatTime(msg.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input bar */}
      <div className={cn(
        'shrink-0 border-t px-3 py-2 flex items-end gap-2',
        isDark ? 'border-[#333] bg-[#1e1e1e]' : 'border-border bg-white'
      )}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${agentName}...`}
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-md px-3 py-2 text-sm outline-none',
            'max-h-[120px] overflow-y-auto',
            isDark
              ? 'bg-[#2d2d2d] text-[#d4d4d4] placeholder:text-[#666] border border-[#444] focus:border-[#888]'
              : 'bg-gray-50 text-foreground placeholder:text-muted-foreground border border-border focus:border-blue-400'
          )}
          style={{ minHeight: 36 }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className={cn(
            'shrink-0 p-2 rounded-md transition-colors',
            input.trim() && !sending
              ? isDark ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-blue-500 text-white hover:bg-blue-600'
              : isDark ? 'bg-[#333] text-[#555]' : 'bg-gray-200 text-gray-400'
          )}
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
