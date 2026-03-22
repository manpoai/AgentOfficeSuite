'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Comment } from '@/lib/api/gateway';
import { useMentionPopover, MentionPopover, type MentionCandidate } from '@/components/mention-popover';
import { useT } from '@/lib/i18n';

interface CommentsProps {
  /** Unique key for React Query caching */
  queryKey: string[];
  /** Function to fetch comments */
  fetchComments: () => Promise<Comment[]>;
  /** Function to post a new comment */
  postComment: (text: string) => Promise<void>;
  /** Label shown in header */
  label?: string;
  /** Pre-filled quote from selected text */
  initialQuote?: string;
  /** Called after quote is consumed */
  onQuoteConsumed?: () => void;
}

function timeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('comments.justNow');
  if (mins < 60) return t('comments.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('comments.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('comments.daysAgo', { n: days });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = ['bg-blue-600', 'bg-green-600', 'bg-purple-600', 'bg-orange-600', 'bg-pink-600', 'bg-cyan-600'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function Comments({ queryKey, fetchComments, postComment, label, initialQuote, onQuoteConsumed }: CommentsProps) {
  const { t } = useT();
  const displayLabel = label || t('comments.title');
  const [expanded, setExpanded] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [quote, setQuote] = useState('');
  const commentInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Handle incoming quote from selection
  useEffect(() => {
    if (initialQuote) {
      setQuote(initialQuote);
      setExpanded(true);
      onQuoteConsumed?.();
      setTimeout(() => commentInputRef.current?.focus(), 100);
    }
  }, [initialQuote, onQuoteConsumed]);

  const mention = useMentionPopover(newComment, cursorPos);

  const handleMentionSelect = useCallback((candidate: MentionCandidate) => {
    const before = newComment.slice(0, mention.triggerStart);
    const after = newComment.slice(mention.triggerEnd);
    const text = `${before}@${candidate.username} ${after}`;
    setNewComment(text);
    setMentionIdx(0);
    const newPos = mention.triggerStart + candidate.username.length + 2;
    setTimeout(() => {
      const el = commentInputRef.current;
      if (el) { el.focus(); el.setSelectionRange(newPos, newPos); }
    }, 0);
  }, [newComment, mention.triggerStart, mention.triggerEnd]);

  const { data: comments = [], isLoading } = useQuery({
    queryKey,
    queryFn: fetchComments,
  });

  const handlePost = async () => {
    if (!newComment.trim() || posting) return;
    setPosting(true);
    try {
      const commentText = quote
        ? `> ${quote}\n\n${newComment.trim()}`
        : newComment.trim();
      await postComment(commentText);
      setNewComment('');
      setQuote('');
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      console.error('Post comment failed:', e);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageCircle className="h-4 w-4" />
        <span className="flex-1 text-left">{displayLabel} ({comments.length})</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          {/* Comment list */}
          {isLoading ? (
            <p className="text-xs text-muted-foreground py-2">{t('common.loading')}</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">—</p>
          ) : (
            <div className="space-y-3 mb-3 max-h-64 overflow-y-auto">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <div className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0 mt-0.5',
                    getAvatarColor(c.actor)
                  )}>
                    {getInitial(c.actor)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-foreground">{c.actor}</span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_at, t)}</span>
                    </div>
                    <p className="text-xs text-foreground/80 mt-0.5 whitespace-pre-wrap break-words">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quote preview */}
          {quote && (
            <div className="flex items-start gap-2 mb-2 px-2 py-1.5 bg-accent/30 rounded-lg border-l-2 border-sidebar-primary/50">
              <p className="text-[11px] text-muted-foreground italic flex-1 line-clamp-2">&ldquo;{quote}&rdquo;</p>
              <button onClick={() => setQuote('')} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {/* New comment input */}
          <div className="relative flex items-center gap-2">
            <input
              ref={commentInputRef}
              value={newComment}
              onChange={e => { setNewComment(e.target.value); setCursorPos(e.target.selectionStart || 0); }}
              onSelect={e => setCursorPos((e.target as HTMLInputElement).selectionStart || 0)}
              onKeyDown={e => {
                if (mention.isOpen) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % mention.matches.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + mention.matches.length) % mention.matches.length); return; }
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleMentionSelect(mention.matches[mentionIdx]); return; }
                  if (e.key === 'Escape') { e.preventDefault(); setCursorPos(0); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); }
              }}
              placeholder={t('comments.placeholder')}
              className="flex-1 text-xs bg-muted rounded-lg px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={handlePost}
              disabled={!newComment.trim() || posting}
              className="p-2 text-sidebar-primary hover:opacity-80 disabled:opacity-30 transition-opacity"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
            {mention.isOpen && commentInputRef.current && (
              <MentionPopover
                matches={mention.matches}
                selectedIndex={mentionIdx}
                onSelect={handleMentionSelect}
                anchorRect={{
                  left: commentInputRef.current.getBoundingClientRect().left,
                  bottom: commentInputRef.current.getBoundingClientRect().top,
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
