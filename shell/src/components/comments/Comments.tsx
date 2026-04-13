'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, X, MoreHorizontal, Pencil, Trash2, CheckCircle2, Undo2, Image as ImageIcon, Paperclip, Copy, Link, Reply, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import type { Comment } from '@/lib/api/gateway';
import { useT } from '@/lib/i18n';
import { showError } from '@/lib/utils/error';
import { getPublicOrigin } from '@/lib/remote-access';

interface CommentsProps {
  /** Unique key for React Query caching */
  queryKey: string[];
  /** Function to fetch comments */
  fetchComments: () => Promise<Comment[]>;
  /** Function to post a new comment (optionally as a reply) */
  postComment: (text: string, parentId?: string) => Promise<void>;
  /** Function to edit a comment */
  editComment?: (commentId: string, text: string) => Promise<void>;
  /** Function to delete a comment */
  deleteComment?: (commentId: string) => Promise<void>;
  /** Function to resolve a comment (mark as done) */
  resolveComment?: (commentId: string) => Promise<void>;
  /** Function to unresolve a comment */
  unresolveComment?: (commentId: string) => Promise<void>;
  /** Function to upload an image, returns URL */
  uploadImage?: (file: File) => Promise<string>;
  /** Label shown in header */
  label?: string;
  /** Pre-filled quote from selected text */
  initialQuote?: string;
  /** Called after quote is consumed */
  onQuoteConsumed?: () => void;
  /** Top offset (px) from editor area — positions input near commented text */
  topOffset?: number | null;
}

// timeAgo delegates to the shared formatRelativeTime utility
function timeAgo(dateStr: string): string {
  return formatRelativeTime(dateStr);
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

/** Render comment text with quoted text and inline images */
function CommentBody({ text }: { text: string }) {
  // Detect "> quoted text\n\nrest" format
  const quoteMatch = text.match(/^>\s(.+?)(?:\n\n)([\s\S]*)$/);
  const bodyText = quoteMatch ? quoteMatch[2] : text;
  const quotedText = quoteMatch ? quoteMatch[1] : null;

  // Render text with inline images: ![alt](url) → <img>
  const renderTextWithImages = (t: string) => {
    const parts: React.ReactNode[] = [];
    const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let lastIdx = 0;
    let match;
    let key = 0;
    while ((match = imgRe.exec(t)) !== null) {
      if (match.index > lastIdx) {
        parts.push(t.slice(lastIdx, match.index));
      }
      parts.push(
        <img
          key={key++}
          src={match[2]}
          alt={match[1]}
          className="max-w-full rounded mt-1 mb-1 border border-border"
          style={{ maxHeight: 200 }}
        />
      );
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < t.length) parts.push(t.slice(lastIdx));
    return parts;
  };

  return (
    <div className="mt-1">
      {quotedText && (
        <div className="text-[11px] text-muted-foreground italic border-l-2 border-sidebar-primary/40 pl-2 py-0.5 mb-1 bg-sidebar-primary/5 rounded-r">
          {quotedText}
        </div>
      )}
      {bodyText && (
        <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words">
          {renderTextWithImages(bodyText)}
        </div>
      )}
    </div>
  );
}

/** Context menu for comment actions */
function CommentMenu({ comment, onEdit, onDelete, onResolve, onUnresolve, onCopyLink, onReply }: {
  comment: Comment;
  onEdit?: () => void;
  onDelete?: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
  onCopyLink?: () => void;
  onReply?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useT();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const items = [];
  if (onReply) items.push({ icon: Reply, label: t('comments.reply'), action: () => { onReply(); setOpen(false); } });
  if (onEdit) items.push({ icon: Pencil, label: t('comments.edit'), action: () => { onEdit(); setOpen(false); } });
  if (comment.resolved_by) {
    if (onUnresolve) items.push({ icon: Undo2, label: t('comments.markAsUnresolved'), action: () => { onUnresolve(); setOpen(false); } });
  } else {
    if (onResolve) items.push({ icon: CheckCircle2, label: t('comments.markAsResolved'), action: () => { onResolve(); setOpen(false); } });
  }
  if (onCopyLink) items.push({ icon: Link, label: t('comments.copyLink'), action: () => { onCopyLink(); setOpen(false); } });
  if (onDelete) items.push({ icon: Trash2, label: t('comments.delete'), action: () => { onDelete(); setOpen(false); }, danger: true });

  if (items.length === 0) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-50 min-w-[160px] bg-popover border border-border rounded-lg shadow-lg py-1">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={item.action}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors",
                (item as any).danger ? "text-destructive" : "text-foreground"
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Comments({
  queryKey, fetchComments, postComment, editComment, deleteComment,
  resolveComment, unresolveComment, uploadImage,
  label, initialQuote, onQuoteConsumed, topOffset,
}: CommentsProps) {
  const { t } = useT();
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [quote, setQuote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyToName, setReplyToName] = useState('');
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Handle incoming quote from selection
  useEffect(() => {
    if (initialQuote) {
      setQuote(initialQuote);
      onQuoteConsumed?.();
      setTimeout(() => commentInputRef.current?.focus(), 100);
    }
  }, [initialQuote, onQuoteConsumed]);


  const { data: comments = [], isLoading } = useQuery({
    queryKey,
    queryFn: fetchComments,
  });

  // Filter comments by resolved status
  const filteredComments = comments.filter(c =>
    showResolved ? !!c.resolved_by : !c.resolved_by
  );

  // Group into threads: top-level comments + their replies
  const topLevelComments = filteredComments.filter(c => !c.parent_id);
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of filteredComments) {
    if (c.parent_id) {
      const arr = repliesByParent.get(c.parent_id) || [];
      arr.push(c);
      repliesByParent.set(c.parent_id, arr);
    }
  }

  const handlePost = async () => {
    if (!newComment.trim() || posting) return;
    setPosting(true);
    try {
      const commentText = quote
        ? `> ${quote}\n\n${newComment.trim()}`
        : newComment.trim();
      await postComment(commentText, replyToId || undefined);
      setNewComment('');
      setQuote('');
      setReplyToId(null);
      setReplyToName('');
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      showError(t('errors.postCommentFailed'), e);
    } finally {
      setPosting(false);
    }
  };

  const handleEdit = async (commentId: string) => {
    if (!editComment || !editText.trim()) return;
    try {
      await editComment(commentId, editText.trim());
      setEditingId(null);
      setEditText('');
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      showError(t('errors.editCommentFailed'), e);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!deleteComment) return;
    try {
      await deleteComment(commentId);
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      showError(t('errors.deleteCommentFailed'), e);
    }
  };

  const handleResolve = async (commentId: string) => {
    if (!resolveComment) return;
    try {
      await resolveComment(commentId);
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      showError(t('errors.resolveCommentFailed'), e);
    }
  };

  const handleUnresolve = async (commentId: string) => {
    if (!unresolveComment) return;
    try {
      await unresolveComment(commentId);
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      showError(t('errors.unresolveCommentFailed'), e);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (!uploadImage) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      const imgMarkdown = `![${file.name}](${url})`;
      setNewComment(prev => prev ? `${prev}\n${imgMarkdown}` : imgMarkdown);
      commentInputRef.current?.focus();
    } catch (e) {
      showError(t('errors.imageUploadFailed'), e);
    } finally {
      setUploading(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  // Auto-resize textarea
  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  // Clamp topOffset to prevent input from overflowing the sidebar
  const inputTopStyle = (quote && topOffset != null && topOffset > 0)
    ? { paddingTop: `${Math.max(0, Math.min(topOffset, 400))}px` }
    : undefined;

  const resolvedCount = comments.filter(c => !!c.resolved_by).length;
  const unresolvedCount = comments.filter(c => !c.resolved_by).length;

  // Inline reply state — separate from the bottom input
  const [inlineReplyId, setInlineReplyId] = useState<string | null>(null);
  const [inlineReplyText, setInlineReplyText] = useState('');
  const [inlineReplyPosting, setInlineReplyPosting] = useState(false);
  const inlineReplyRef = useRef<HTMLTextAreaElement>(null);

  const handleInlineReply = async (parentId: string) => {
    if (!inlineReplyText.trim() || inlineReplyPosting) return;
    setInlineReplyPosting(true);
    try {
      await postComment(inlineReplyText.trim(), parentId);
      setInlineReplyText('');
      setInlineReplyId(null);
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      showError(t('errors.replyCommentFailed'), e);
    } finally {
      setInlineReplyPosting(false);
    }
  };

  const renderComment = (c: Comment, opts: { onReply?: () => void; isReply?: boolean; parentId?: string } = {}) => (
    <div>
      <div className={cn("flex gap-2.5 group p-2 rounded-lg hover:bg-accent/30 transition-colors", c.resolved_by && "opacity-60")}>
        <div className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0 mt-0.5',
          getAvatarColor(c.actor)
        )}>
          {getInitial(c.actor)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{c.actor}</span>
            <span className="text-[10px] text-muted-foreground flex-1">{timeAgo(c.created_at)}</span>
            <CommentMenu
              comment={c}
              onEdit={editComment ? () => { setEditingId(c.id); setEditText(c.text); } : undefined}
              onDelete={deleteComment ? () => handleDelete(c.id) : undefined}
              onResolve={!opts.isReply && resolveComment && !c.resolved_by ? () => handleResolve(c.id) : undefined}
              onUnresolve={!opts.isReply && unresolveComment && c.resolved_by ? () => handleUnresolve(c.id) : undefined}
              onCopyLink={() => {
                navigator.clipboard.writeText(`${getPublicOrigin()}${window.location.pathname}${window.location.search}#comment-${c.id}`);
              }}
            />
          </div>
          {editingId === c.id ? (
            <div className="mt-1">
              <textarea
                ref={editInputRef}
                value={editText}
                onChange={e => { setEditText(e.target.value); autoResize(e.target); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(c.id); }
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                rows={2}
                className="w-full text-xs bg-muted rounded-lg px-2 py-1.5 text-foreground outline-none resize-none border border-sidebar-primary/50"
                autoFocus
              />
              <div className="flex items-center gap-1 mt-1">
                <button
                  onClick={() => handleEdit(c.id)}
                  disabled={!editText.trim()}
                  className="text-[10px] px-2 py-0.5 bg-sidebar-primary text-white rounded disabled:opacity-30"
                >
                  {t('comments.save')}
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="text-[10px] px-2 py-0.5 text-muted-foreground hover:text-foreground"
                >
                  {t('comments.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <CommentBody text={c.text} />
              {c.resolved_by && (
                <div className="flex items-center gap-1 mt-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  <span className="text-[10px] text-green-600">{t('comments.resolvedBy', { name: c.resolved_by.name || c.resolved_by.id })}</span>
                </div>
              )}
              {/* Reply button — directly visible under comment content */}
              {opts.onReply && !c.resolved_by && (
                <button
                  onClick={opts.onReply}
                  className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground hover:text-sidebar-primary transition-colors"
                >
                  <Reply className="h-3 w-3" />
                  {t('comments.reply')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {/* Inline reply input — appears right below this comment */}
      {inlineReplyId === (opts.parentId || c.id) && !opts.isReply && (
        <div className="ml-8 mt-1 mb-2">
          <div className="flex gap-2">
            <textarea
              ref={inlineReplyRef}
              value={inlineReplyText}
              onChange={e => { setInlineReplyText(e.target.value); autoResize(e.target); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInlineReply(opts.parentId || c.id); }
                if (e.key === 'Escape') { setInlineReplyId(null); setInlineReplyText(''); }
              }}
              placeholder={t('comments.replyPlaceholder') || t('comments.placeholder')}
              rows={1}
              className="flex-1 text-xs bg-muted rounded-lg px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground resize-none border border-sidebar-primary/30 focus:border-sidebar-primary/60"
              autoFocus
            />
            <div className="flex flex-col gap-1 self-end">
              <button
                onClick={() => handleInlineReply(opts.parentId || c.id)}
                disabled={!inlineReplyText.trim() || inlineReplyPosting}
                className="p-1.5 text-sidebar-primary hover:opacity-80 disabled:opacity-30 transition-opacity rounded"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => { setInlineReplyId(null); setInlineReplyText(''); }}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const inputArea = (
    <div className={cn("px-4 py-3", !quote && "border-t border-border")}>
      {/* Reply indicator */}
      {replyToId && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-sidebar-primary/10 rounded-lg">
          <Reply className="h-3 w-3 text-sidebar-primary shrink-0" />
          <span className="text-[11px] text-sidebar-primary flex-1">{t('comments.replyTo', { name: replyToName })}</span>
          <button onClick={() => { setReplyToId(null); setReplyToName(''); }} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="h-3 w-3" />
          </button>
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
      <div className="relative">
        <textarea
          ref={commentInputRef}
          value={newComment}
          onChange={e => {
            setNewComment(e.target.value);
            setCursorPos(e.target.selectionStart || 0);
            autoResize(e.target);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); }
          }}
          placeholder={t('comments.placeholder')}
          rows={1}
          className="w-full text-xs bg-muted rounded-lg px-3 py-2 pr-20 text-foreground outline-none placeholder:text-muted-foreground resize-none"
        />
        <div className="absolute right-1 bottom-1 flex items-center gap-0.5">
          {uploadImage && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors rounded hover:bg-accent"
                title={t('comments.uploadImage')}
              >
                <ImageIcon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            onClick={handlePost}
            disabled={!newComment.trim() || posting}
            className="p-1.5 text-sidebar-primary hover:opacity-80 disabled:opacity-30 transition-opacity rounded"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
          {(quote || replyToId) && (
            <button
              onClick={() => { setQuote(''); setNewComment(''); setReplyToId(null); setReplyToName(''); }}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded"
              title={t('comments.cancel')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/80 rounded-lg">
            <span className="text-[10px] text-muted-foreground">{t('comments.uploading')}</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Resolved/Unresolved filter — only show if resolving is supported */}
      {resolveComment && (resolvedCount > 0 || unresolvedCount > 0) && (
        <div className="flex items-center gap-1 px-4 pt-2 pb-1">
          <button
            onClick={() => setShowResolved(false)}
            className={cn(
              "text-[11px] px-2 py-0.5 rounded-full transition-colors",
              !showResolved ? "bg-sidebar-primary text-white" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t('comments.open')} ({unresolvedCount})
          </button>
          <button
            onClick={() => setShowResolved(true)}
            className={cn(
              "text-[11px] px-2 py-0.5 rounded-full transition-colors",
              showResolved ? "bg-sidebar-primary text-white" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t('comments.resolved')} ({resolvedCount})
          </button>
        </div>
      )}

      {/* When there's a quote (text selection comment), put input at the top aligned with the text */}
      {quote && (
        <div style={inputTopStyle}>
          {inputArea}
        </div>
      )}

      {/* Comment list — scrollable, takes available space */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">{t('common.loading')}</p>
        ) : topLevelComments.length === 0 && !quote ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">
              {showResolved ? t('comments.noResolved') : t('comments.noComments')}
            </p>
          </div>
        ) : (
          <div className="space-y-1 px-4 py-3">
            {topLevelComments.map((c) => {
              const replies = repliesByParent.get(c.id) || [];
              const hasReplies = replies.length > 0;
              const isExpanded = expandedThreads.has(c.id);
              const triggerReply = () => {
                setInlineReplyId(c.id);
                setInlineReplyText('');
                if (hasReplies && !isExpanded) {
                  setExpandedThreads(prev => new Set(prev).add(c.id));
                }
                setTimeout(() => inlineReplyRef.current?.focus(), 100);
              };
              return (
                <div key={c.id}>
                  {renderComment(c, { onReply: triggerReply })}
                  {/* Thread replies */}
                  {hasReplies && (
                    <div className="ml-8">
                      <button
                        onClick={() => setExpandedThreads(prev => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })}
                        className="flex items-center gap-1 text-[11px] text-sidebar-primary hover:underline py-1"
                      >
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {t('comments.repliesCount', { n: replies.length })}
                      </button>
                      {isExpanded && replies.map(r => (
                        <div key={r.id}>
                          {renderComment(r, {
                            onReply: triggerReply,
                            isReply: true,
                            parentId: c.id,
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input area — at bottom only when there's no active quote */}
      {!quote && inputArea}
    </div>
  );
}
