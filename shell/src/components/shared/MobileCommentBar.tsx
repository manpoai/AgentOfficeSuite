'use client';

import React, { useState, useRef } from 'react';
import { useT } from '@/lib/i18n';
import { Send } from 'lucide-react';
import { createContentComment, commentOnTable, type Comment } from '@/lib/api/gateway';
import { useOptimisticMutation } from '@/lib/hooks/use-optimistic-mutation';

interface MobileCommentBarProps {
  /** Content type */
  targetType: 'doc' | 'table' | 'presentation' | 'diagram';
  /** Content ID (e.g. "doc:abc123" for content items, or raw table ID for tables) */
  targetId: string;
  /** Row ID for table comments */
  rowId?: string;
  /** Optional: extra element to render to the right of the bar (e.g. FAB) */
  rightSlot?: React.ReactNode;
}

/**
 * Bottom comment input bar for mobile views.
 * Matches Figma: rounded pill input with "Add comments" placeholder + send arrow.
 */
export function MobileCommentBar({
  targetType, targetId, rowId, rightSlot }: MobileCommentBarProps) {
  const { t } = useT();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isTable = targetType === 'table';
  const queryKey = ['comments', targetType, targetId, rowId];

  const { mutate: submit, isPending } = useOptimisticMutation<Comment[], string>({
    mutationFn: (comment) =>
      isTable
        ? commentOnTable(targetId, comment, undefined, rowId)
        : createContentComment(targetId, comment),
    queryKey,
    optimisticUpdate: (old = [], comment) => [
      ...old,
      {
        id: `temp-${Date.now()}`,
        text: comment,
        actor_name: 'You',
        actor_type: 'human',
        created_at: new Date().toISOString(),
        parent_id: null,
        resolved_by: null,
        resolved_at: null,
      } as Comment,
    ],
    onSuccess: () => setText(''),
    errorMessage: 'Failed to post comment',
  });

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || isPending) return;
    submit(trimmed);
  };

  return (
    <div className="flex items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2 bg-card border-t border-border md:hidden">
      <div className="flex-1 flex items-center bg-muted/50 rounded-full border border-border px-5 h-16">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder={t('comments.addComment')}
          className="flex-1 bg-transparent text-[18px] outline-none placeholder:text-muted-foreground/50"
          disabled={isPending}
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || isPending}
          className="ml-2 text-muted-foreground/40 disabled:opacity-30 transition-opacity"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
      {rightSlot}
    </div>
  );
}
