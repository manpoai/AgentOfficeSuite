'use client';

/**
 * CommentPanel — Unified comment panel for all content types.
 * Phase 3 rewrite: Figma-spec UI, avatars, quote blocks, @mention menu, real-time polling.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useOptimisticMutation } from '@/lib/hooks/use-optimistic-mutation';
import { useT } from '@/lib/i18n';
import {
  Send,
  CheckCircle2,
  Circle,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  X,
  Bot,
  AtSign,
  Reply,
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
  listAgents,
  resolveAvatarUrl,
  type Comment,
  type Agent,
} from '@/lib/api/gateway';

export interface CommentPanelProps {
  targetType: 'doc' | 'table' | 'presentation' | 'diagram';
  targetId: string;
  rowId?: string;
  anchorType?: string;
  anchorId?: string;
  anchorMeta?: Record<string, unknown>;
  className?: string;
  onClose?: () => void;
  focusCommentId?: string;
  onAnchorUsed?: () => void;
  autoFocus?: boolean;
  onNavigateToAnchor?: (anchor: { type: string; id: string; meta?: Record<string, unknown> }) => void;
  focusAnchor?: { type: string; id: string } | null;
  /** Agent ID of the content creator (e.g. agt_xxx). Used to show typing indicator when content author is an agent. */
  contentCreatorAgentId?: string | null;
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ actor, actorId, avatarUrl, platform, size = 32 }: { actor: string; actorId?: string | null; avatarUrl?: string | null; platform?: string | null; size?: number }) {
  const isAgent = actorId?.startsWith('agt_') || actorId?.startsWith('agent_');
  const style = { width: size, height: size, minWidth: size };

  // 1. Use avatar_url from gateway (already JOINed from actors table)
  if (avatarUrl) {
    return (
      <img
        src={resolveAvatarUrl(avatarUrl) ?? ''}
        alt={actor}
        className="rounded-full object-cover shrink-0"
        style={style}
      />
    );
  }
  // 2. Agent without avatar: use platform icon
  if (isAgent && platform) {
    return (
      <img
        src={`/icons/platform-${platform}.png`}
        alt={actor}
        className="rounded-full object-cover shrink-0"
        style={style}
      />
    );
  }
  // 3. Agent without avatar or platform: Bot icon
  if (isAgent) {
    return (
      <div
        className="rounded-full flex items-center justify-center bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 shrink-0"
        style={style}
      >
        <Bot className="w-4 h-4" />
      </div>
    );
  }
  if (!avatarUrl && !isAgent) {
    // Human without avatar: use default admin avatar
    return (
      <img
        src="/icons/avatar-default.jpg"
        alt={actor}
        className="rounded-full object-cover shrink-0"
        style={style}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center bg-muted text-muted-foreground text-xs font-medium shrink-0"
      style={style}
    >
      {initials}
    </div>
  );
}

// ── Quote block ───────────────────────────────────────────────────────────────

function QuoteBlock({ text, anchor }: { text?: string; anchor?: { label?: string; preview?: string | null; type?: string; id?: string; meta?: Record<string, unknown> } }) {
  const { t } = useT();
  const display = anchor ? (anchor.preview || anchor.label || anchor.type || text || '') : (text || '');
  const label = anchor?.type
    ? t(`comments.anchorTypes.${anchor.type}`, { defaultValue: anchor.label || anchor.type })
    : anchor?.label;
  if (!display && !label) return null;
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 mb-2 bg-muted/50 rounded text-xs text-muted-foreground border-l-2 border-sidebar-primary/30">
      {label && <span className="font-medium shrink-0">{label}:</span>}
      <span className="truncate">{display}</span>
    </div>
  );
}

// ── @mention text highlight ───────────────────────────────────────────────────

function CommentText({ text, agents = [] }: { text: string; agents?: Agent[] }) {
  const parts = text.split(/(@\S+)/g);
  return (
    <p className="text-sm leading-[22px] whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (/^@\S+/.test(part)) {
          const name = part.slice(1); // remove @
          const agent = agents.find(a => a.name === name);
          if (agent) {
            const avatarSrc = agent.avatar_url
              ? resolveAvatarUrl(agent.avatar_url)
              : agent.platform
                ? `/icons/platform-${agent.platform}.png`
                : null;
            return (
              <span key={i} className="inline-flex items-center gap-0.5 text-blue-500 dark:text-blue-400 font-medium align-middle">
                {part}
                {avatarSrc ? (
                  <img src={avatarSrc} alt="" className="w-4 h-4 rounded-full object-cover inline-block" />
                ) : (
                  <Bot className="w-3.5 h-3.5 inline-block" />
                )}
              </span>
            );
          }
          return <span key={i} className="text-blue-500 dark:text-blue-400 font-medium">{part}</span>;
        }
        return part;
      })}
    </p>
  );
}

// ── @mention menu ─────────────────────────────────────────────────────────────

interface MentionMenuProps {
  agents: Agent[];
  query: string;
  onSelect: (agent: Agent) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

function MentionMenu({ agents, query, onSelect, anchorRef }: MentionMenuProps) {
  const { t } = useT();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const filtered = agents.filter(
    a => !query || a.name.toLowerCase().includes(query.toLowerCase()) ||
      (a.display_name || '').toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && filtered[selectedIdx]) { e.preventDefault(); onSelect(filtered[selectedIdx]); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filtered, selectedIdx, onSelect]);

  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 bg-card rounded-lg border border-border shadow-lg py-1 z-50 max-h-48 overflow-y-auto">
      <div className="px-3 py-1 text-xs text-muted-foreground font-medium">{t('comments.selectAgent')}</div>
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">{t('comments.noAgents')}</div>
      ) : (
        filtered.map((agent, i) => (
          <button
            key={agent.agent_id}
            onClick={() => onSelect(agent)}
            className={cn(
              'flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors',
              i === selectedIdx ? 'bg-accent' : 'hover:bg-accent',
            )}
          >
            <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0 overflow-hidden">
              {agent.avatar_url ? (
                <img src={resolveAvatarUrl(agent.avatar_url) ?? ''} alt="" className="w-full h-full object-cover" />
              ) : agent.platform ? (
                <img src={`/icons/platform-${agent.platform}.png`} alt="" className="w-full h-full object-cover" />
              ) : (
                <Bot className="w-3.5 h-3.5" />
              )}
            </div>
            <span className="font-medium">{agent.display_name || agent.name}</span>
            <span className="text-muted-foreground text-xs">@{agent.name}</span>
          </button>
        ))
      )}
    </div>
  );
}

// ── Comment item ──────────────────────────────────────────────────────────────

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
  replyToName,
  focusRef,
  agents,
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
  replyToName?: string;
  focusRef?: React.RefObject<HTMLDivElement | null>;
  agents?: Agent[];
}) {
  const { t } = useT();
  const [showMenu, setShowMenu] = useState(false);
  const isAgent = comment.actor_id?.startsWith('agt_') || comment.actor_id?.startsWith('agent_');
  const anchor = comment.context_payload?.anchor || null;
  const quoteText = (() => {
    if (!anchor) return null;
    if (anchor.type === 'row') {
      return t('comments.commentOnRow', { row: anchor.id });
    }
    return anchor.preview || null;
  })();

  return (
    <div
      ref={focusRef as React.RefObject<HTMLDivElement>}
      className={cn(
        'flex gap-2 pt-2 group/comment',
        isReply && 'pt-3',
      )}
    >
      <Avatar actor={comment.actor} actorId={comment.actor_id} avatarUrl={comment.actor_avatar_url} platform={comment.actor_platform} size={isReply ? 28 : 32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-normal text-foreground truncate">{comment.actor}</span>
            {isAgent && comment.actor_platform && (
              <span className="text-[10px] text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 px-1 rounded shrink-0">
                {comment.actor_platform}
              </span>
            )}
            <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(comment.created_at)}</span>
          </div>
          <div className="relative shrink-0">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-all"
            >
              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-6 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                  {onReply && (
                    <MenuButton onClick={() => { onReply(); setShowMenu(false); }}>
                      {t('comments.reply')}
                    </MenuButton>
                  )}
                  <MenuButton onClick={() => { onEdit(); setShowMenu(false); }}>
                    <Pencil className="w-3 h-3" /> {t('comments.edit')}
                  </MenuButton>
                  {onResolve && (
                    <MenuButton onClick={() => { onResolve(); setShowMenu(false); }}>
                      <CheckCircle2 className="w-3 h-3" /> {t('comments.markAsResolved')}
                    </MenuButton>
                  )}
                  {onUnresolve && (
                    <MenuButton onClick={() => { onUnresolve(); setShowMenu(false); }}>
                      <Circle className="w-3 h-3" /> {t('comments.markAsUnresolved')}
                    </MenuButton>
                  )}
                  <MenuButton onClick={() => { onDelete(); setShowMenu(false); }} danger>
                    <Trash2 className="w-3 h-3" /> {t('comments.delete')}
                  </MenuButton>
                </div>
              </>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="mt-1 space-y-1">
            <textarea
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              rows={2}
              className="w-full resize-none rounded border border-border bg-card px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring text-foreground"
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={onEditSave}
                className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/80"
              >
                {t('comments.save')}
              </button>
              <button onClick={onEditCancel} className="text-xs px-2 py-0.5 rounded hover:bg-accent text-foreground">
                {t('comments.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5">
            {replyToName && (
              <div className="text-xs text-muted-foreground mb-0.5">
                ↩ {t('comments.repliedTo', { name: replyToName })}
              </div>
            )}
            {!isReply && (anchor && anchor.type !== 'row'
              ? <QuoteBlock anchor={anchor} />
              : quoteText
                ? <QuoteBlock text={quoteText} />
                : null
            )}
            <CommentText text={comment.text || ''} agents={agents} />
            {onReply && (
              <button
                onClick={(e) => { e.stopPropagation(); onReply(); }}
                className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60 opacity-0 group-hover/comment:opacity-100 hover:text-sidebar-primary transition-all"
              >
                <Reply className="w-3 h-3" />
                {t('comments.reply')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Comment thread (card) ─────────────────────────────────────────────────────

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
  focusCommentId,
  focusRefs,
  onNavigateToAnchor,
  agents,
  typingAgentsForThread,
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
  focusCommentId?: string;
  focusRefs?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onNavigateToAnchor?: (anchor: { type: string; id: string; meta?: Record<string, unknown> }) => void;
  agents?: Agent[];
  typingAgentsForThread?: Agent[];
}) {
  const anchor = comment.context_payload?.anchor;
  return (
    <div
      className={cn(
        'bg-card rounded-lg border border-border px-3 pb-3 group',
        isResolved && 'opacity-60',
        onNavigateToAnchor && anchor && 'cursor-pointer',
      )}
      onClick={() => {
        if (anchor && onNavigateToAnchor) {
          onNavigateToAnchor({ type: anchor.type, id: anchor.id, meta: anchor.meta });
        }
      }}
    >
      <CommentItem
        comment={comment}
        isEditing={editingId === comment.id}
        editText={editText}
        onReply={() => onReply(comment.id)}
        onEdit={() => onEdit(comment.id, comment.text || '')}
        onEditSave={() => onEditSave(comment.id)}
        onEditCancel={onEditCancel}
        onEditTextChange={onEditTextChange}
        onDelete={() => onDelete(comment.id)}
        onResolve={isResolved ? undefined : () => onResolve(comment.id)}
        onUnresolve={isResolved ? () => onUnresolve(comment.id) : undefined}
        isHighlighted={focusCommentId === comment.id}
        focusRef={focusRefs ? { get current() { return focusRefs.current[comment.id] ?? null; }, set current(el: HTMLDivElement | null) { focusRefs.current[comment.id] = el; } } as React.RefObject<HTMLDivElement | null> : undefined}
        agents={agents}
      />

      {replies.length > 0 && (
        <div className="mt-1 pl-10 space-y-0 border-t border-border/50 pt-1">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              isEditing={editingId === reply.id}
              editText={editText}
              onReply={() => onReply(reply.id)}
              onEdit={() => onEdit(reply.id, reply.text || '')}
              onEditSave={() => onEditSave(reply.id)}
              onEditCancel={onEditCancel}
              onEditTextChange={onEditTextChange}
              onDelete={() => onDelete(reply.id)}
              replyToName={
                reply.parent_id !== comment.id
                  ? replies.find(r => r.id === reply.parent_id)?.actor
                  : undefined
              }
              isReply
              isHighlighted={focusCommentId === reply.id}
              focusRef={focusRefs ? { get current() { return focusRefs.current[reply.id] ?? null; }, set current(el: HTMLDivElement | null) { focusRefs.current[reply.id] = el; } } as React.RefObject<HTMLDivElement | null> : undefined}
              agents={agents}
            />
          ))}
        </div>
      )}

      {/* Typing indicators for agents expected to reply */}
      {typingAgentsForThread && typingAgentsForThread.length > 0 && (
        <div>
          {typingAgentsForThread.map(agent => (
            <TypingIndicator key={agent.agent_id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator({ agent }: { agent: Agent }) {
  const avatarSrc = agent.avatar_url
    ? resolveAvatarUrl(agent.avatar_url)
    : agent.platform
      ? `/icons/platform-${agent.platform}.png`
      : null;
  return (
    <div className="flex items-center gap-2 pt-2 pl-10">
      <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-violet-100 dark:bg-violet-900/30">
        {avatarSrc ? (
          <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
        )}
      </div>
      <span className="text-xs text-muted-foreground">{agent.display_name || agent.name}</span>
      <div className="flex items-center gap-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// ── Menu button ───────────────────────────────────────────────────────────────

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
        danger ? 'text-red-500 hover:bg-destructive/10' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

// ── Main CommentPanel ─────────────────────────────────────────────────────────

export function CommentPanel({
  targetType,
  targetId,
  rowId,
  anchorType,
  anchorId,
  anchorMeta,
  className,
  onClose,
  focusCommentId,
  onAnchorUsed,
  autoFocus,
  onNavigateToAnchor,
  focusAnchor,
  contentCreatorAgentId: contentCreatorAgentIdProp,
}: CommentPanelProps) {
  const { t } = useT();
  const { actor } = useAuth();
  const queryClient = useQueryClient();

  // Derive content creator agent ID from cache if not passed as prop
  const contentCreatorAgentId = contentCreatorAgentIdProp ?? (() => {
    const contentItems = queryClient.getQueryData<{ id: string; created_by: string | null }[]>(['content-items']);
    const rawId = targetId.includes(':') ? targetId.split(':')[1] : targetId;
    const item = contentItems?.find(i => i.id === rawId);
    const createdBy = item?.created_by;
    return createdBy && (createdBy.startsWith('agt_') || createdBy.startsWith('agent_')) ? createdBy : null;
  })();
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  // Typing indicator: agents expected to reply, with timestamp of when we started waiting
  const [typingAgents, setTypingAgents] = useState<{ agent: Agent; since: number; threadKey: string; visible: boolean }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const queryKey = ['comments', targetType, targetId, rowId];

  // Determine if focusCommentId is in resolved set (set showResolved automatically)
  const focusRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey,
    queryFn: () =>
      listContentComments(targetId, rowId ? { anchor_type: 'row', anchor_id: rowId } : undefined),
    staleTime: 5_000,
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: listAgents,
    staleTime: 60_000,
  });

  // Auto-switch to resolved tab if focusCommentId is in resolved set
  useEffect(() => {
    if (!focusCommentId || comments.length === 0) return;
    const target = comments.find(c => c.id === focusCommentId);
    if (target?.resolved_at) setShowResolved(true);
  }, [focusCommentId, comments]);

  // Scroll to focused comment + trigger anchor navigation (notification jump)
  useEffect(() => {
    if (!focusCommentId || comments.length === 0) return;
    const el = focusRefs.current[focusCommentId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (onNavigateToAnchor) {
      const target = comments.find(c => c.id === focusCommentId);
      const anchor = target?.context_payload?.anchor;
      if (anchor) {
        onNavigateToAnchor({ type: anchor.type, id: anchor.id, meta: anchor.meta });
      }
    }
  }, [focusCommentId, comments, onNavigateToAnchor]);

  // Scroll to first comment matching focusAnchor (diagram node/edge click-to-comment)
  useEffect(() => {
    if (!focusAnchor || comments.length === 0) return;
    const target = comments.find(c =>
      !c.resolved_at &&
      c.context_payload?.anchor?.type === focusAnchor.type &&
      c.context_payload?.anchor?.id === focusAnchor.id
    );
    if (!target) return;
    const el = focusRefs.current[target.id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusAnchor, comments]);

  // Auto focus input when panel opens
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  // Clear typing indicators when agent replies arrive
  useEffect(() => {
    if (typingAgents.length === 0) return;
    setTypingAgents(prev => {
      const remaining = prev.filter(entry => {
        // Check if this agent posted a comment after the typing started
        return !comments.some(c =>
          !c.id.startsWith('temp-') &&
          (c.actor_id === entry.agent.agent_id || c.actor === entry.agent.name) &&
          new Date(c.created_at).getTime() > entry.since - 5000 // 5s tolerance
        );
      });
      return remaining.length !== prev.length ? remaining : prev;
    });
  }, [comments, typingAgents]);

  const createMut = useOptimisticMutation<Comment[], { text: string; parentId?: string }>({
    mutationFn: (vars) => {
      const effectiveAnchorType = rowId ? 'row' : anchorType;
      const effectiveAnchorId = rowId || anchorId;
      const effectiveAnchorMeta = rowId ? undefined : anchorMeta;
      return createContentComment(targetId, vars.text, vars.parentId, effectiveAnchorType, effectiveAnchorId, effectiveAnchorMeta);
    },
    queryKey,
    optimisticUpdate: (old = [], vars) => [
      ...old,
      {
        id: `temp-${Date.now()}`,
        text: vars.text,
        actor: actor?.display_name ?? 'You',
        actor_id: actor?.id ?? null,
        actor_avatar_url: actor?.avatar_url ?? null,
        actor_platform: 'human',
        created_at: new Date().toISOString(),
        parent_id: vars.parentId ?? null,
        resolved_by: null,
        resolved_at: null,
      } as Comment,
    ],
    onSuccess: () => {
      setNewComment('');
      setReplyTo(null);
      onAnchorUsed?.();
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    },
    errorMessage: t('comments.postFailed'),
  });

  const editMut = useOptimisticMutation<Comment[], { id: string; text: string }>({
    mutationFn: (vars) => editContentComment(vars.id, vars.text),
    queryKey,
    optimisticUpdate: (old = [], vars) =>
      old.map((c) => (c.id === vars.id ? { ...c, text: vars.text } : c)),
    onSuccess: () => {
      setEditingId(null);
      setEditText('');
      queryClient.invalidateQueries({ queryKey });
    },
    errorMessage: t('comments.editFailed'),
  });

  const deleteMut = useOptimisticMutation<Comment[], string>({
    mutationFn: (id) => deleteContentComment(id),
    queryKey,
    optimisticUpdate: (old = [], id) => old.filter((c) => c.id !== id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    errorMessage: t('comments.deleteFailed'),
  });

  const resolveMut = useOptimisticMutation<Comment[], string>({
    mutationFn: (id) => resolveContentComment(id),
    queryKey,
    optimisticUpdate: (old = [], id) =>
      old.map((c) => (c.id === id ? { ...c, resolved_at: new Date().toISOString(), resolved_by: { id: actor?.id ?? '', name: actor?.display_name ?? 'You' } } : c)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    },
    errorMessage: t('comments.resolveFailed'),
  });

  const unresolveMut = useOptimisticMutation<Comment[], string>({
    mutationFn: (id) => unresolveContentComment(id),
    queryKey,
    optimisticUpdate: (old = [], id) =>
      old.map((c) => (c.id === id ? { ...c, resolved_at: null, resolved_by: null } : c)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    },
    errorMessage: t('comments.unresolveFailed'),
  });

  const handleSubmit = useCallback(() => {
    const text = newComment.trim();
    if (!text) return;
    // Detect agents that should show typing indicator
    if (agents.length > 0) {
      const pending: Agent[] = [];
      // 1. @mentioned agents that are online
      const mentions = text.match(/@(\S+)/g);
      if (mentions) {
        for (const m of mentions) {
          const name = m.slice(1);
          const agent = agents.find(a => a.name === name);
          if (agent?.online) pending.push(agent);
        }
      }
      // 2. Content creator agent (notified on all comments)
      if (contentCreatorAgentId) {
        const creatorAgent = agents.find(a => a.agent_id === contentCreatorAgentId);
        if (creatorAgent?.online && !pending.some(a => a.agent_id === creatorAgent.agent_id)) {
          pending.push(creatorAgent);
        }
      }
      if (pending.length > 0) {
        const threadKey = replyTo
          ? (comments.find(c => c.id === replyTo)?.parent_id || replyTo)
          : `new-${Date.now()}`;
        const now = Date.now();
        const newEntries = pending.map(agent => ({ agent, since: now, threadKey, visible: false }));
        setTypingAgents(prev => [...prev, ...newEntries]);
        // Show after 1s delay
        setTimeout(() => {
          setTypingAgents(prev => prev.map(e => e.since === now ? { ...e, visible: true } : e));
        }, 1000);
        // Auto-clear after 3 min
        setTimeout(() => {
          setTypingAgents(prev => prev.filter(e => e.since !== now));
        }, 180_000);
      }
    }
    createMut.mutate({ text, parentId: replyTo ?? undefined });
  }, [newComment, replyTo, createMut, agents, comments, contentCreatorAgentId]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewComment(val);
    // Detect @mention
    const match = val.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setShowMentionMenu(true);
    } else {
      setShowMentionMenu(false);
    }
  }, []);

  const handleMentionSelect = useCallback((agent: Agent) => {
    const username = agent.name;
    setNewComment(prev => prev.replace(/@\w*$/, `@${username} `));
    setShowMentionMenu(false);
    inputRef.current?.focus();
  }, []);

  const handleAtButtonClick = useCallback(() => {
    setNewComment(prev => prev + '@');
    setMentionQuery('');
    setShowMentionMenu(true);
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showMentionMenu) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowMentionMenu(false);
        }
        return; // mention menu open: don't handle Enter
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, showMentionMenu],
  );

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const rootOf = (c: Comment): string => {
    if (!c.parent_id) return c.id;
    const parent = comments.find(p => p.id === c.parent_id);
    return parent ? rootOf(parent) : c.id;
  };
  const topLevel = comments.filter((c) => !c.parent_id);
  const resolved = topLevel.filter((c) => c.resolved_at);
  const unresolved = topLevel.filter((c) => !c.resolved_at);
  const repliesOf = (rootId: string) =>
    comments
      .filter((c) => c.parent_id && rootOf(c) === rootId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <div
      className={cn('flex flex-col h-full bg-[#F5F7F5] dark:bg-zinc-900', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">{t('comments.title')}</span>
          <button
            onClick={() => setShowResolved(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>
              {showResolved ? t('comments.resolved') : t('comments.open')}
              {showResolved
                ? (resolved.length > 0 ? ` (${resolved.length})` : '')
                : (unresolved.length > 0 ? ` (${unresolved.length})` : '')
              }
            </span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-2">
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
          return visibleComments.map((comment, idx) => {
            const isLast = idx === visibleComments.length - 1;
            const threadTyping = typingAgents.filter(e =>
              e.visible && (e.threadKey === comment.id || (isLast && e.threadKey.startsWith('new-')))
            );
            return (
              <CommentThread
                key={comment.id}
                comment={comment}
                replies={repliesOf(comment.id)}
                replyTo={replyTo}
                editingId={editingId}
                editText={editText}
                onReply={setReplyTo}
                onEdit={(id, text) => { setEditingId(id); setEditText(text); }}
                onEditSave={(id) => editMut.mutate({ id, text: editText })}
                onEditCancel={() => { setEditingId(null); setEditText(''); }}
                onEditTextChange={setEditText}
                onDelete={(id) => deleteMut.mutate(id)}
                onResolve={(id) => resolveMut.mutate(id)}
                onUnresolve={(id) => unresolveMut.mutate(id)}
                isResolved={showResolved}
                focusCommentId={focusCommentId}
                focusRefs={focusRefs}
                onNavigateToAnchor={onNavigateToAnchor}
                agents={agents}
                typingAgentsForThread={threadTyping.map(e => e.agent)}
              />
            );
          });
        })()}

        {/* Typing indicators for new top-level comments (not in any thread yet) */}
      </div>

      {/* Input bar */}
      <div className="px-3 pb-3 pt-1">
        {anchorType && anchorId && !replyTo && (
          <div className="mb-2">
            <QuoteBlock anchor={{
              type: anchorType,
              preview: (anchorMeta?.quote as string)
                || (anchorMeta?.node_label as string)
                || (anchorMeta?.slide_title as string)
                || (anchorMeta?.edge_label as string)
                || '',
            }} />
          </div>
        )}
        {replyTo && (
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <div className="w-0.5 h-4 bg-border rounded-full" />
              <span className="text-xs text-muted-foreground pl-1">
                {t('comments.replyingTo', { name: comments.find(c => c.id === replyTo)?.actor || '' })}
              </span>
            </div>
            <button onClick={() => setReplyTo(null)} className="p-0.5 rounded hover:bg-accent">
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        )}

        <div ref={inputContainerRef as React.RefObject<HTMLDivElement>} className="relative">
          {showMentionMenu && (
            <MentionMenu
              agents={agents}
              query={mentionQuery}
              onSelect={handleMentionSelect}
              anchorRef={inputContainerRef}
            />
          )}
          <div className="flex items-center bg-card rounded-lg border border-border h-12 px-2 gap-1 has-[:focus]:border-sidebar-primary transition-colors">
            <button
              onClick={handleAtButtonClick}
              title={t('comments.mentionUser')}
              aria-label={t('comments.mentionUser')}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <AtSign className="w-4 h-4" />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={newComment}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t('comments.addComment')}
              className="flex-1 text-sm text-foreground placeholder:text-muted-foreground bg-transparent outline-none"
            />
            <button
              onClick={handleSubmit}
              disabled={!newComment.trim() || createMut.isPending}
              title={t('comments.send')}
              aria-label={t('comments.send')}
              className={cn(
                'p-1 rounded transition-colors shrink-0',
                newComment.trim() ? 'text-foreground hover:text-foreground/80' : 'text-muted-foreground/40 cursor-not-allowed',
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
    </div>
  );
}
