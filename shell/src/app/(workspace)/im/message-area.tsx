'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIMStore } from '@/lib/stores/im';
import * as mm from '@/lib/api/mm';
import { ArrowLeft, Send, MoreHorizontal, Pencil, Trash2, Smile, Users, Hash, Reply, X, Bold, Italic, Strikethrough, Heading, Link, Code, Quote, List, ListOrdered, Paperclip, AtSign, Bookmark, Pin, Copy } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useMentionPopover, MentionPopover, type MentionCandidate } from '@/components/mention-popover';

const QUICK_EMOJIS = ['👍', '❤️', '😄', '🎉', '👀', '🚀'];

export function MessageArea({ channelId }: { channelId: string }) {
  const { messages, setMessages, setUsers, users, channels, setMobileView, addMessage, myUserId } = useIMStore();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [menuPostId, setMenuPostId] = useState<string | null>(null);
  const [emojiPickerPostId, setEmojiPickerPostId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<mm.MMPost | null>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  const channel = channels.find(c => c.id === channelId);

  // @ mention
  const mention = useMentionPopover(input, cursorPos);

  const handleMentionSelect = useCallback((candidate: MentionCandidate) => {
    const before = input.slice(0, mention.triggerStart);
    const after = input.slice(mention.triggerEnd);
    const newText = `${before}@${candidate.username} ${after}`;
    setInput(newText);
    setMentionIdx(0);
    const newPos = mention.triggerStart + candidate.username.length + 2; // @name + space
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) { el.focus(); el.setSelectionRange(newPos, newPos); }
    }, 0);
  }, [input, mention.triggerStart, mention.triggerEnd]);

  // Fetch channel stats (member count)
  const { data: channelStats } = useQuery({
    queryKey: ['mm-channel-stats', channelId],
    queryFn: () => mm.getChannelStats(channelId),
    enabled: !!channelId,
    staleTime: 60_000,
  });

  const refreshPosts = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['mm-posts', channelId] });
  }, [queryClient, channelId]);

  // Message operations
  const handleEdit = async (postId: string, newText: string) => {
    try {
      await mm.updatePost(postId, newText);
      setEditingPostId(null);
      refreshPosts();
    } catch (e) {
      console.error('Edit failed:', e);
    }
  };

  const handleDelete = async (postId: string) => {
    try {
      await mm.deletePost(postId);
      refreshPosts();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const handleReaction = async (postId: string, emoji: string) => {
    if (!myUserId) return;
    try {
      await mm.addReaction(postId, emoji);
      refreshPosts();
    } catch (e) {
      console.error('Reaction failed:', e);
    }
    setEmojiPickerPostId(null);
  };

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

  // Mark channel as viewed (clears unread)
  useEffect(() => {
    mm.viewChannel(channelId).catch(() => {});
  }, [channelId]);

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
      const post = await mm.createPost(channelId, text, replyTo?.id);
      addMessage(post);
      setInput('');
      setReplyTo(null);
    } catch (e) {
      console.error('Send failed:', e);
    } finally {
      setSending(false);
    }
  };

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
  }, []);

  // Formatting helpers
  const wrapSelection = useCallback((wrapper: string, endWrapper?: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = input.slice(start, end);
    const ew = endWrapper || wrapper;
    const newText = input.slice(0, start) + wrapper + selected + ew + input.slice(end);
    setInput(newText);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + wrapper.length, start + wrapper.length + selected.length);
    }, 0);
  }, [input]);

  const insertPrefix = useCallback((prefix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    // Find start of current line
    const lineStart = input.lastIndexOf('\n', start - 1) + 1;
    const newText = input.slice(0, lineStart) + prefix + input.slice(lineStart);
    setInput(newText);
    setTimeout(() => { el.focus(); el.setSelectionRange(start + prefix.length, start + prefix.length); }, 0);
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Mention navigation
    if (mention.isOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % mention.matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + mention.matches.length) % mention.matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleMentionSelect(mention.matches[mentionIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setCursorPos(0); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <button
          onClick={() => setMobileView('channels')}
          className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {channel?.type === 'O' || channel?.type === 'P' ? (
          <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : null}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {channel?.display_name || channelId}
          </h2>
          {channel?.header && (
            <p className="text-[10px] text-muted-foreground truncate">{channel.header}</p>
          )}
        </div>
        {channelStats && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Users className="h-3 w-3" />
            <span>{channelStats.member_count}</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-2 space-y-1">
          {isLoading && (
            <p className="text-sm text-muted-foreground py-8 text-center">加载中...</p>
          )}
          {channelMessages.map((post, i) => {
            const user = users[post.user_id];
            const prevPost = channelMessages[i - 1];
            const showHeader = !prevPost || prevPost.user_id !== post.user_id ||
              (post.create_at - prevPost.create_at > 300_000); // 5min gap

            // Date separator
            const showDateSep = !prevPost || !isSameDay(prevPost.create_at, post.create_at);

            // Reply parent
            const replyParent = post.root_id ? channelMessages.find(m => m.id === post.root_id) : null;
            const replyUser = replyParent ? users[replyParent.user_id] : null;

            return (
              <div key={post.id}>
                {showDateSep && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 border-t border-border" />
                    <span className="text-[10px] text-muted-foreground font-medium">{formatDateSep(post.create_at)}</span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                )}
              <div className={cn('group relative', showHeader ? 'mt-3' : '')}>
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
                    {post.update_at > post.create_at && (
                      <span className="text-[10px] text-muted-foreground/60">(已编辑)</span>
                    )}
                  </div>
                )}
                {/* Reply indicator */}
                {replyParent && (
                  <div className="pl-10 flex items-center gap-1.5 mb-0.5 group/reply cursor-pointer hover:bg-accent/20 rounded py-0.5 -mx-1 px-1 transition-colors">
                    <div className="w-4 h-3 border-l-2 border-t-2 border-sidebar-primary/40 rounded-tl shrink-0" />
                    <img src={mm.getProfileImageUrl(replyParent.user_id)} alt="" className="w-3.5 h-3.5 rounded-full bg-muted shrink-0" />
                    <span className="text-[10px] text-sidebar-primary/80 font-medium shrink-0">
                      {replyUser?.nickname || replyUser?.username || '...'}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 truncate">
                      {replyParent.message.slice(0, 60)}
                    </span>
                  </div>
                )}
                <div className={cn('text-sm text-foreground/90', 'pl-10')}>
                  {editingPostId === post.id ? (
                    <div className="flex gap-1.5 items-end">
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(post.id, editText); }
                          if (e.key === 'Escape') setEditingPostId(null);
                        }}
                        className="flex-1 bg-muted rounded px-2 py-1 text-sm text-foreground outline-none resize-none border border-sidebar-primary"
                        autoFocus
                        rows={2}
                      />
                      <button onClick={() => handleEdit(post.id, editText)} className="text-xs text-sidebar-primary hover:underline shrink-0 pb-1">保存</button>
                      <button onClick={() => setEditingPostId(null)} className="text-xs text-muted-foreground hover:underline shrink-0 pb-1">取消</button>
                    </div>
                  ) : (
                    <MessageContent text={post.message} files={post.metadata?.files} />
                  )}
                </div>
                {/* Hover action bar */}
                {editingPostId !== post.id && (
                  <div className="absolute right-2 top-0 hidden group-hover:flex items-center gap-0.5 bg-card border border-border rounded-lg shadow-sm px-1 py-0.5">
                    <button
                      onClick={() => setEmojiPickerPostId(emojiPickerPostId === post.id ? null : post.id)}
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                      title="表情"
                    >
                      <Smile className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { setReplyTo(post); textareaRef.current?.focus(); }}
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                      title="回复"
                    >
                      <Reply className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { navigator.clipboard.writeText(post.message); }}
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                      title="复制文字"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setMenuPostId(menuPostId === post.id ? null : post.id)}
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                      title="更多"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {/* More actions dropdown */}
                {menuPostId === post.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuPostId(null)} />
                    <div className="absolute right-2 top-7 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-44">
                      <MenuBtn icon={Bookmark} label="收藏消息" shortcut="S" onClick={() => setMenuPostId(null)} />
                      <MenuBtn icon={Pin} label="Pin 到频道" shortcut="P" onClick={() => setMenuPostId(null)} />
                      <MenuBtn icon={Link} label="复制链接" shortcut="K" onClick={() => setMenuPostId(null)} />
                      {post.user_id === myUserId && (
                        <>
                          <div className="border-t border-border my-1" />
                          <MenuBtn icon={Pencil} label="编辑" shortcut="E" onClick={() => { setEditingPostId(post.id); setEditText(post.message); setMenuPostId(null); }} />
                        </>
                      )}
                      <div className="border-t border-border my-1" />
                      {post.user_id === myUserId && (
                        <MenuBtn icon={Trash2} label="删除" shortcut="" onClick={() => { setMenuPostId(null); if (confirm('删除此消息？')) handleDelete(post.id); }} danger />
                      )}
                    </div>
                  </>
                )}
                {/* Quick emoji picker */}
                {emojiPickerPostId === post.id && (
                  <div className="absolute right-2 top-8 bg-card border border-border rounded-lg shadow-lg p-1.5 flex gap-1 z-10">
                    {QUICK_EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(post.id, emoji)}
                        className="text-base hover:bg-accent rounded p-1 transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-3 py-2 border-t border-border bg-card shrink-0">
        {/* Reply preview */}
        {replyTo && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-accent/30 rounded-t-lg text-xs">
            <Reply className="h-3 w-3 text-sidebar-primary shrink-0" />
            <span className="text-muted-foreground">回复</span>
            <span className="text-foreground font-medium">{users[replyTo.user_id]?.nickname || users[replyTo.user_id]?.username || '...'}</span>
            <span className="text-muted-foreground truncate flex-1">{replyTo.message.slice(0, 60)}</span>
            <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground shrink-0">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="bg-muted rounded-lg border border-border/50 focus-within:border-sidebar-primary/50 transition-colors">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => { setInput(e.target.value); setCursorPos(e.target.selectionStart); autoResize(); }}
              onKeyDown={handleKeyDown}
              onSelect={e => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
              placeholder={replyTo ? '回复消息...' : `发送到 ${channel?.display_name || '频道'}`}
              rows={1}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none px-3 pt-2.5 pb-1 max-h-32"
              style={{ minHeight: '24px' }}
            />
            {mention.isOpen && textareaRef.current && (
              <MentionPopover
                matches={mention.matches}
                selectedIndex={mentionIdx}
                onSelect={handleMentionSelect}
                anchorRect={textareaRef.current ? {
                  left: textareaRef.current.getBoundingClientRect().left + 12,
                  bottom: textareaRef.current.getBoundingClientRect().top,
                } : null}
              />
            )}
          </div>
          {/* Formatting toolbar */}
          <div className="flex items-center justify-between px-2 py-1 border-t border-border/30">
            <div className="flex items-center gap-0.5">
              <FmtBtn icon={Bold} title="粗体" onClick={() => wrapSelection('**')} />
              <FmtBtn icon={Italic} title="斜体" onClick={() => wrapSelection('*')} />
              <FmtBtn icon={Strikethrough} title="删除线" onClick={() => wrapSelection('~~')} />
              <div className="w-px h-4 bg-border/50 mx-0.5" />
              <FmtBtn icon={Heading} title="标题" onClick={() => insertPrefix('### ')} />
              <FmtBtn icon={Link} title="链接" onClick={() => wrapSelection('[', '](url)')} />
              <FmtBtn icon={Code} title="代码" onClick={() => wrapSelection('`')} />
              <FmtBtn icon={Quote} title="引用" onClick={() => insertPrefix('> ')} />
              <div className="w-px h-4 bg-border/50 mx-0.5" />
              <FmtBtn icon={List} title="无序列表" onClick={() => insertPrefix('- ')} />
              <FmtBtn icon={ListOrdered} title="有序列表" onClick={() => insertPrefix('1. ')} />
            </div>
            <div className="flex items-center gap-0.5">
              <FmtBtn icon={Paperclip} title="附件" onClick={() => {}} />
              <FmtBtn icon={Smile} title="表情" onClick={() => {}} />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="ml-1 p-1.5 text-sidebar-primary hover:bg-sidebar-primary/10 disabled:text-muted-foreground/40 rounded transition-colors"
                title="发送 (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuBtn({ icon: Icon, label, shortcut, onClick, danger }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] text-muted-foreground">{shortcut}</span>}
    </button>
  );
}

function FmtBtn({ icon: Icon, title, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function MessageContent({ text, files }: { text: string; files?: mm.MMFileInfo[] }) {
  return (
    <>
      {text && <MarkdownText text={text} />}
      {files && files.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1">
          {files.map(f => (
            <a
              key={f.id}
              href={`/api/mm/files/${f.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs text-foreground/80 hover:bg-accent transition-colors"
            >
              <span className="text-muted-foreground">{getFileIcon(f.extension)}</span>
              <span className="truncate max-w-[150px]">{f.name}</span>
              <span className="text-muted-foreground text-[10px]">{formatFileSize(f.size)}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function getFileIcon(ext: string): string {
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return '🖼';
  if (['pdf'].includes(ext)) return '📄';
  if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext)) return '📎';
  if (['zip','tar','gz','rar'].includes(ext)) return '📦';
  return '📁';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function MarkdownText({ text }: { text: string }) {
  if (!text) return null;

  // Split by code blocks first
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
        // Render lines with inline formatting
        return (
          <span key={i}>
            {part.split('\n').map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <InlineLine text={line} />
              </span>
            ))}
          </span>
        );
      })}
    </>
  );
}

function InlineLine({ text }: { text: string }) {
  // Parse inline markdown: **bold**, *italic*, `code`, [link](url), ~~strike~~
  const tokens: React.ReactNode[] = [];
  // Combined regex for inline elements
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>]+))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Push text before match
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      // **bold**
      tokens.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      tokens.push(<em key={match.index}>{match[3]}</em>);
    } else if (match[4]) {
      // ~~strikethrough~~
      tokens.push(<del key={match.index} className="text-muted-foreground">{match[4]}</del>);
    } else if (match[5]) {
      // `inline code`
      tokens.push(<code key={match.index} className="bg-background rounded px-1 py-0.5 text-xs font-mono">{match[5]}</code>);
    } else if (match[6] && match[7]) {
      // [text](url)
      tokens.push(<a key={match.index} href={match[7]} target="_blank" rel="noopener noreferrer" className="text-sidebar-primary hover:underline">{match[6]}</a>);
    } else if (match[8]) {
      // bare URL
      tokens.push(<a key={match.index} href={match[8]} target="_blank" rel="noopener noreferrer" className="text-sidebar-primary hover:underline">{match[8]}</a>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return <>{tokens.length > 0 ? tokens : text}</>;
}

function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function formatDateSep(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (isSameDay(ts, now.getTime())) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(ts, yesterday.getTime())) return '昨天';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
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
