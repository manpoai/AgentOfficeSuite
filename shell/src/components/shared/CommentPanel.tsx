'use client';

/**
 * CommentPanel — Unified comment panel for all content types.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOptimisticMutation } from '@/lib/hooks/use-optimistic-mutation';
import { useT } from '@/lib/i18n';
import {
  MessageSquare,
  Send,
  CheckCircle2,
  Circle,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import {
  listContentComments,
  createContentComment,
  editContentComment,
  deleteContentComment,
  resolveContentComment,
  unresolveContentComment,
  listTableComments,
  commentOnTable,
  editTableComment,
  deleteTableComment,
  resolveTableComment,
  unresolveTableComment,
  type Comment,
} from '@/lib/api/gateway';

export interface CommentPanelProps {
  targetType: 'doc' | 'table' | 'presentation' | 'diagram';
  targetId: string;
  rowId?: string;
  className?: string;
  onClose?: () => void;
}

export function CommentPanel({
  targetType,
  targetId,
  rowId,
  className,
  onClose,
}: CommentPanelProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isTable = targetType === 'table';

  const queryKey = ['comments', targetType, targetId, rowId];

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey,
    queryFn: () =>
      isTable
        ? listTableComments(targetId, rowId)
        : listContentComments(targetId),
    staleTime: 10_000,
  });

  const createMut = useOptimisticMutation<Comment[], { text: string; parentId?: string }>({
    mutationFn: (vars) =>
      isTable
        ? commentOnTable(targetId, vars.text, vars.parentId, rowId)
        : createContentComment(targetId, vars.text, vars.parentId),
    queryKey,
    optimisticUpdate: (old = [], vars) => [
      ...old,
      {
        id: `temp-${Date.now()}`,
        text: vars.text,
        actor_name: 'You',
        actor_type: 'human',
        created_at: new Date().toISOString(),
        parent_id: vars.parentId ?? null,
        resolved_by: null,
        resolved_at: null,
      } as Comment,
    ],
    onSuccess: () => {
      setNewComment('');
      setReplyTo(null);
    },
    errorMessage: t('comments.postFailed'),
  });

  const editMut = useOptimisticMutation<Comment[], { id: string; text: string }>({
    mutationFn: (vars) =>
      isTable
        ? editTableComment(vars.id, vars.text)
        : editContentComment(vars.id, vars.text),
    queryKey,
    optimisticUpdate: (old = [], vars) =>
      old.map((c) => (c.id === vars.id ? { ...c, text: vars.text } : c)),
    onSuccess: () => {
      setEditingId(null);
      setEditText('');
    },
    errorMessage: t('comments.editFailed'),
  });

  const deleteMut = useOptimisticMutation<Comment[], string>({
    mutationFn: (id) =>
      isTable ? deleteTableComment(id) : deleteContentComment(id),
    queryKey,
    optimisticUpdate: (old = [], id) => old.filter((c) => c.id !== id),
    errorMessage: t('comments.deleteFailed'),
  });

  const resolveMut = useOptimisticMutation<Comment[], string>({
    mutationFn: (id) =>
      isTable ? resolveTableComment(id) : resolveContentComment(id),
    queryKey,
    optimisticUpdate: (old = [], id) =>
      old.map((c) => (c.id === id ? { ...c, resolved_at: new Date().toISOString(), resolved_by: 'You' } : c)),
    errorMessage: t('comments.resolveFailed'),
  });

  const unresolveMut = useOptimisticMutation<Comment[], string>({
    mutationFn: (id) =>
      isTable ? unresolveTableComment(id) : unresolveContentComment(id),
    queryKey,
    optimisticUpdate: (old = [], id) =>
      old.map((c) => (c.id === id ? { ...c, resolved_at: null, resolved_by: null } : c)),
    errorMessage: t('comments.unresolveFailed'),
  });

  const handleSubmit = useCallback(() => {
    const text = newComment.trim();
    if (!text) return;
    createMut.mutate({ text, parentId: replyTo ?? undefined });
  }, [newComment, replyTo, createMut]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const topLevel = comments.filter((c) => !c.parent_id);
  const resolved = topLevel.filter((c) => c.resolved_at);
  const unresolved = topLevel.filter((c) => !c.resolved_at);
  const repliesOf = (parentId: string) => comments.filter((c) => c.parent_id === parentId);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center justify-between px-2 py-2.5 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{t('comments.title')}</span>
          <button
            onClick={() => setShowResolved(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{showResolved ? t('comments.resolved') : t('comments.open')}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (() => {
          const visibleComments = showResolved ? resolved : unresolved;
          if (visibleComments.length === 0) {
            return (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {showResolved ? t('comments.noResolved') : t('comments.noComments')}
              </div>
            );
          }
          return visibleComments.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              replies={repliesOf(comment.id)}
              replyTo={replyTo}
              editingId={editingId}
              editText={editText}
              onReply={setReplyTo}
              onEdit={(id, text) => {
                setEditingId(id);
                setEditText(text);
              }}
              onEditSave={(id) => editMut.mutate({ id, text: editText })}
              onEditCancel={() => {
                setEditingId(null);
                setEditText('');
              }}
              onEditTextChange={setEditText}
              onDelete={(id) => deleteMut.mutate(id)}
              onResolve={(id) => resolveMut.mutate(id)}
              onUnresolve={(id) => unresolveMut.mutate(id)}
              isResolved={showResolved}
            />
          ));
        })()}
      </div>

      <div className="border-t border-border px-3 py-2">
        {replyTo && (
          <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
            <span>{t('comments.replyPlaceholder')}</span>
            <button onClick={() => setReplyTo(null)} className="hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="relative">
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('comments.addCommentWithShortcut')}
            className={cn(
              'w-full rounded-md border border-border bg-background pl-3 pr-10 py-2',
              'text-sm placeholder:text-muted-foreground/40 outline-none',
              'focus:ring-1 focus:ring-sidebar-primary/30 focus:border-sidebar-primary/50',
            )}
          />
          <button
            onClick={handleSubmit}
            disabled={!newComment.trim() || createMut.isPending}
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors',
              newComment.trim()
                ? 'text-sidebar-primary hover:text-sidebar-primary/80'
                : 'text-muted-foreground/40 cursor-not-allowed',
            )}
          >
            {createMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentThread({
  comment,
  replies,
  replyTo,
  editingId,
  editText,
  onReply,
  onEdit,
  onEditSave,
  onEditCancel,
  onEditTextChange,
  onDelete,
  onResolve,
  onUnresolve,
  isResolved,
}: {
  comment: Comment;
  replies: Comment[];
  replyTo: string | null;
  editingId: string | null;
  editText: string;
  onReply: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onEditTextChange: (text: string) => void;
  onDelete: (id: string) => void;
  onResolve: (id: string) => void;
  onUnresolve: (id: string) => void;
  isResolved?: boolean;
}) {
  return (
    <div className={cn('py-2', isResolved && 'opacity-60')}>
      <CommentItem
        comment={comment}
        isEditing={editingId === comment.id}
        editText={editText}
        onReply={() => onReply(comment.id)}
        onEdit={() => onEdit(comment.id, comment.text)}
        onEditSave={() => onEditSave(comment.id)}
        onEditCancel={onEditCancel}
        onEditTextChange={onEditTextChange}
        onDelete={() => onDelete(comment.id)}
        onResolve={isResolved ? undefined : () => onResolve(comment.id)}
        onUnresolve={isResolved ? () => onUnresolve(comment.id) : undefined}
        isHighlighted={replyTo === comment.id}
      />
      {replies.length > 0 && (
        <div className="ml-6 mt-1 border-l-2 border-border pl-3 space-y-1">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              isEditing={editingId === reply.id}
              editText={editText}
              onEdit={() => onEdit(reply.id, reply.text)}
              onEditSave={() => onEditSave(reply.id)}
              onEditCancel={onEditCancel}
              onEditTextChange={onEditTextChange}
              onDelete={() => onDelete(reply.id)}
              isReply
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  isEditing,
  editText,
  onReply,
  onEdit,
  onEditSave,
  onEditCancel,
  onEditTextChange,
  onDelete,
  onResolve,
  onUnresolve,
  isReply,
  isHighlighted,
}: {
  comment: Comment;
  isEditing: boolean;
  editText: string;
  onReply?: () => void;
  onEdit: () => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onEditTextChange: (text: string) => void;
  onDelete: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
  isReply?: boolean;
  isHighlighted?: boolean;
}) {
  const { t } = useT();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className={cn(
        'group rounded-md px-2 py-1.5 transition-colors',
        isHighlighted && 'bg-sidebar-primary/5',
        !isHighlighted && 'hover:bg-muted/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium truncate">{comment.actor}</span>
            <span className="text-muted-foreground shrink-0">
              {formatRelativeTime(comment.created_at)}
            </span>
          </div>

          {isEditing ? (
            <div className="mt-1 space-y-1">
              <textarea
                value={editText}
                onChange={(e) => onEditTextChange(e.target.value)}
                rows={2}
                className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-sidebar-primary/30"
                autoFocus
              />
              <div className="flex gap-1">
                <button
                  onClick={onEditSave}
                  className="text-xs px-2 py-0.5 rounded bg-sidebar-primary text-white hover:bg-sidebar-primary/90"
                >
                  {t('comments.save')}
                </button>
                <button
                  onClick={onEditCancel}
                  className="text-xs px-2 py-0.5 rounded hover:bg-muted"
                >
                  {t('comments.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">
              {comment.text}
            </p>
          )}
        </div>

        {!isEditing && (
          <div className="relative shrink-0">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
            >
              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-6 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[120px]">
                  {onReply && (
                    <MenuButton
                      onClick={() => {
                        onReply();
                        setShowMenu(false);
                      }}
                    >
                      <MessageSquare className="w-3 h-3" /> {t('comments.reply')}
                    </MenuButton>
                  )}
                  <MenuButton
                    onClick={() => {
                      onEdit();
                      setShowMenu(false);
                    }}
                  >
                    <Pencil className="w-3 h-3" /> {t('comments.edit')}
                  </MenuButton>
                  {onResolve && (
                    <MenuButton
                      onClick={() => {
                        onResolve();
                        setShowMenu(false);
                      }}
                    >
                      <CheckCircle2 className="w-3 h-3" /> {t('comments.markAsResolved')}
                    </MenuButton>
                  )}
                  {onUnresolve && (
                    <MenuButton
                      onClick={() => {
                        onUnresolve();
                        setShowMenu(false);
                      }}
                    >
                      <Circle className="w-3 h-3" /> {t('comments.markAsUnresolved')}
                    </MenuButton>
                  )}
                  <MenuButton
                    onClick={() => {
                      onDelete();
                      setShowMenu(false);
                    }}
                    danger
                  >
                    <Trash2 className="w-3 h-3" /> {t('comments.delete')}
                  </MenuButton>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors',
        danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
