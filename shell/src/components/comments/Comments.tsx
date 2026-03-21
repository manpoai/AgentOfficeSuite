'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Comment } from '@/lib/api/gateway';

interface CommentsProps {
  /** Unique key for React Query caching */
  queryKey: string[];
  /** Function to fetch comments */
  fetchComments: () => Promise<Comment[]>;
  /** Function to post a new comment */
  postComment: (text: string) => Promise<void>;
  /** Label shown in header */
  label?: string;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
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

export function Comments({ queryKey, fetchComments, postComment, label = '评论' }: CommentsProps) {
  const [expanded, setExpanded] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const queryClient = useQueryClient();

  const { data: comments = [], isLoading } = useQuery({
    queryKey,
    queryFn: fetchComments,
  });

  const handlePost = async () => {
    if (!newComment.trim() || posting) return;
    setPosting(true);
    try {
      await postComment(newComment.trim());
      setNewComment('');
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
        <span className="flex-1 text-left">{label} ({comments.length})</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          {/* Comment list */}
          {isLoading ? (
            <p className="text-xs text-muted-foreground py-2">加载评论...</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">暂无评论</p>
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
                      <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_at)}</span>
                    </div>
                    <p className="text-xs text-foreground/80 mt-0.5 whitespace-pre-wrap break-words">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* New comment input */}
          <div className="flex items-center gap-2">
            <input
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
              placeholder="添加评论..."
              className="flex-1 text-xs bg-muted rounded-lg px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={handlePost}
              disabled={!newComment.trim() || posting}
              className="p-2 text-sidebar-primary hover:opacity-80 disabled:opacity-30 transition-opacity"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
