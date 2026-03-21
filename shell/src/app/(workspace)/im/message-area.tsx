'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIMStore } from '@/lib/stores/im';
import * as mm from '@/lib/api/mm';
import { ArrowLeft, Send } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export function MessageArea({ channelId }: { channelId: string }) {
  const { messages, setMessages, setUsers, users, channels, setMobileView, addMessage } = useIMStore();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const channel = channels.find(c => c.id === channelId);

  // Fetch posts
  const { data: postList, isLoading } = useQuery({
    queryKey: ['mm-posts', channelId],
    queryFn: () => mm.getChannelPosts(channelId),
    enabled: !!channelId,
  });

  // Load posts into store and fetch missing users
  useEffect(() => {
    if (!postList) return;
    const posts = postList.order.map(id => postList.posts[id]).filter(Boolean).reverse();
    setMessages(channelId, posts);

    // Collect unknown user ids
    const unknownIds = new Set<string>();
    posts.forEach(p => {
      if (!users[p.user_id]) unknownIds.add(p.user_id);
    });
    if (unknownIds.size > 0) {
      mm.getUsersByIds(Array.from(unknownIds)).then(setUsers).catch(() => {});
    }
  }, [postList, channelId, setMessages, setUsers, users]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages[channelId]?.length]);

  const channelMessages = messages[channelId] || [];

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const post = await mm.createPost(channelId, text);
      addMessage(post);
      setInput('');
    } catch (e) {
      console.error('Send failed:', e);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        {/* Back button — mobile only */}
        <button
          onClick={() => setMobileView('channels')}
          className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-sm font-semibold text-foreground truncate">
          {channel?.display_name || channelId}
        </h2>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-2 space-y-1">
          {isLoading && (
            <p className="text-sm text-muted-foreground py-8 text-center">加载中...</p>
          )}
          {channelMessages.map((post, i) => {
            const user = users[post.user_id];
            const prevPost = channelMessages[i - 1];
            const showHeader = !prevPost || prevPost.user_id !== post.user_id ||
              (post.create_at - prevPost.create_at > 300_000); // 5min gap

            return (
              <div key={post.id} className={cn('group', showHeader ? 'mt-3' : '')}>
                {showHeader && (
                  <div className="flex items-center gap-2 mb-0.5">
                    <img
                      src={mm.getProfileImageUrl(post.user_id)}
                      alt=""
                      className="w-8 h-8 rounded-full bg-muted shrink-0"
                    />
                    <span className="text-sm font-semibold text-foreground">
                      {user?.nickname || user?.username || post.user_id.slice(0, 8)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatTime(post.create_at)}
                    </span>
                  </div>
                )}
                <div className={cn('text-sm text-foreground/90', showHeader ? 'pl-10' : 'pl-10')}>
                  <MessageContent text={post.message} />
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-3 py-2 border-t border-border bg-card shrink-0">
        <div className="flex items-end gap-2 bg-muted rounded-lg px-3 py-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none max-h-32"
            style={{ minHeight: '20px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-1.5 text-sidebar-primary hover:text-sidebar-primary/80 disabled:text-muted-foreground transition-colors shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}

function MessageContent({ text }: { text: string }) {
  // Simple: render code blocks and plain text
  if (!text) return null;

  // Split by code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).replace(/^\w*\n/, '');
          return (
            <pre key={i} className="bg-background rounded p-2 my-1 text-xs overflow-x-auto">
              <code>{code}</code>
            </pre>
          );
        }
        // Render line breaks
        return (
          <span key={i}>
            {part.split('\n').map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </span>
        );
      })}
    </>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
