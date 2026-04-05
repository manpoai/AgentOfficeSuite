'use client';

/**
 * RevisionHistory — Unified version history panel.
 *
 * Shows a list of saved revisions for any content type.
 * Supports preview selection and one-click restore.
 *
 * Desktop: side drawer | Mobile: full-screen panel (handled by parent)
 */

import React, { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { BottomSheet } from '@/components/shared/BottomSheet';
import {
  RotateCcw,
  Clock,
  ChevronRight,
  Loader2,
  X,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import {
  listContentRevisions,
  restoreContentRevision,
  type ContentRevision,
} from '@/lib/api/gateway';

export interface RevisionHistoryProps {
  /** Content type for display */
  contentType: 'doc' | 'table' | 'presentation' | 'diagram';
  /** Content ID (e.g. "doc:abc123") */
  contentId: string;
  /** Called after a revision is restored */
  onRestore?: (data: any) => void;
  /** Additional CSS class */
  className?: string;
  /** Called when panel should close */
  onClose?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  doc: 'Document',
  table: 'Table',
  presentation: 'Presentation',
  diagram: 'Diagram',
};

export function RevisionHistory({
  contentType,
  contentId,
  onRestore,
  className,
  onClose,
}: RevisionHistoryProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  const queryKey = ['revisions', contentId];

  const { data: revisions = [], isLoading } = useQuery<ContentRevision[]>({
    queryKey,
    queryFn: () => listContentRevisions(contentId),
    staleTime: 15_000,
  });

  const [restoreError, setRestoreError] = useState<string | null>(null);

  const restoreMut = useMutation({
    mutationFn: (revisionId: string) =>
      restoreContentRevision(contentId, revisionId),
    onSuccess: (result, revisionId) => {
      setRestoreError(null);
      queryClient.invalidateQueries({ queryKey });
      setConfirmRestore(null);
      setSelectedId(null);
      onRestore?.(result.data);
    },
    onError: (error: Error) => {
      setRestoreError(error.message || 'Failed to restore version. Please try again.');
    },
  });

  const selectedRevision = revisions.find((r) => r.id === selectedId);

  // Shared inner content (used by both desktop and mobile)
  const panelContent = (
    <>
      {/* Revision list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : revisions.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No saved versions yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Versions are saved automatically as you edit
            </p>
          </div>
        ) : (
          <div className="py-1">
            {revisions.map((revision, index) => (
              <button
                key={revision.id}
                onClick={() =>
                  setSelectedId(selectedId === revision.id ? null : revision.id)
                }
                className={cn(
                  'flex items-center w-full px-4 py-2.5 text-left transition-colors',
                  selectedId === revision.id
                    ? 'bg-sidebar-primary/10'
                    : 'hover:bg-muted/50',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {index === 0 ? 'Latest' : `Version ${revisions.length - index}`}
                    </span>
                    {index === 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sidebar-primary/10 text-sidebar-primary font-medium">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{formatRelativeTime(revision.created_at)}</span>
                    {revision.created_by && (
                      <>
                        <span>&middot;</span>
                        <span>{revision.created_by}</span>
                      </>
                    )}
                  </div>
                </div>
                <ChevronRight
                  className={cn(
                    'w-4 h-4 text-muted-foreground transition-transform',
                    selectedId === revision.id && 'rotate-90',
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action bar (shown when a non-current revision is selected) */}
      {selectedRevision && selectedId !== revisions[0]?.id && (
        <div className="border-t border-border px-4 py-3">
          {confirmRestore === selectedId ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-amber-600">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This will replace the current {TYPE_LABELS[contentType]?.toLowerCase() || 'content'} with
                  this version. A backup of the current version will be saved automatically.
                </span>
              </div>
              {restoreError && (
                <div className="flex items-start gap-2 text-xs text-red-600">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{restoreError}</span>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => restoreMut.mutate(selectedId!)}
                  disabled={restoreMut.isPending}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium',
                    'bg-sidebar-primary text-white hover:bg-sidebar-primary/90',
                    'disabled:opacity-50',
                  )}
                >
                  {restoreMut.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Confirm Restore
                </button>
                <button
                  onClick={() => { setConfirmRestore(null); setRestoreError(null); }}
                  className="px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRestore(selectedId)}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium',
                'border border-border hover:bg-muted transition-colors',
              )}
            >
              <RotateCcw className="w-4 h-4" />
              Restore this version
            </button>
          )}
        </div>
      )}
    </>
  );

  // Mobile: use BottomSheet
  if (isMobile) {
    return (
      <BottomSheet
        open={true}
        onClose={onClose ?? (() => {})}
        title={t('content.versionHistory')}
        initialHeight="full"
      >
        {panelContent}
      </BottomSheet>
    );
  }

  // Desktop: side panel
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-medium">Version History</span>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {panelContent}
    </div>
  );
}
