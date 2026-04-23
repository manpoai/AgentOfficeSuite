'use client';

/**
 * RevisionHistory — Unified version history panel for ALL content types.
 *
 * Shows a list of saved revisions, supports preview selection, manual version
 * creation, and one-click restore. Used by Doc, Table, PPT, and Diagram editors.
 *
 * Desktop: side drawer | Mobile: full-screen panel (handled by parent)
 */

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth';
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
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import { ActorInlineAvatar } from '@/components/shared/ActorInlineAvatar';
import { renderField } from '@/lib/i18n/renderField';
import {
  listContentRevisions,
  restoreContentRevision,
  type ContentRevision,
} from '@/lib/api/gateway';

/** Generic revision item — superset of ContentRevision + TableSnapshot fields */
export interface RevisionItem {
  id: string;
  content_id?: string;
  trigger_type: string | null;
  description?: string | null;
  description_key?: string | null;
  description_params?: string | null;
  data?: any;
  created_at: string;
  created_by?: string | null;
  /** Table-specific */
  version?: number;
  row_count?: number;
  agent?: string | null;
}

export interface RevisionHistoryProps {
  /** Content type for display */
  contentType: 'doc' | 'table' | 'presentation' | 'diagram' | 'canvas' | 'video';
  /** Content ID */
  contentId: string;
  /** Called after a revision is restored */
  onRestore?: (data: any) => void;
  /** Called to create a manual version snapshot */
  onCreateManualVersion?: () => Promise<void>;
  /** Called when a revision is selected for preview (null = deselected) */
  onSelectRevision?: (revision: RevisionItem | null) => void;
  /** Currently selected revision ID (controlled by parent for preview) */
  selectedRevisionId?: string | null;
  /** Custom fetch function (default: listContentRevisions) */
  fetchRevisions?: (contentId: string) => Promise<RevisionItem[]>;
  /** Custom restore function (default: restoreContentRevision) */
  restoreRevision?: (contentId: string, revisionId: string) => Promise<any>;
  /** Render extra metadata per revision item (e.g. row count for tables) */
  renderRevisionMeta?: (revision: RevisionItem) => React.ReactNode;
  /** Additional CSS class */
  className?: string;
  /** Called when panel should close */
  onClose?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  doc: 'content.typeDocument',
  table: 'content.typeTable',
  presentation: 'content.typePresentation',
  diagram: 'content.typeDiagram',
  canvas: 'content.typeCanvas',
};

const TRIGGER_LABELS: Record<string, string> = {
  auto: 'content.triggerAuto',
  manual: 'content.triggerManual',
  pre_restore: 'content.triggerPreRestore',
  pre_agent_edit: 'content.triggerPreAgentEdit',
  post_agent_edit: 'content.triggerPostAgentEdit',
  pre_bulk: 'content.triggerPreBulk',
};

export function RevisionHistory({
  contentType,
  contentId,
  onRestore,
  onCreateManualVersion,
  onSelectRevision,
  selectedRevisionId,
  fetchRevisions,
  restoreRevision,
  renderRevisionMeta,
  className,
  onClose,
}: RevisionHistoryProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { actor } = useAuth();
  const isMobile = useIsMobile();
  // Use internal selection state if parent doesn't control it
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = selectedRevisionId !== undefined ? selectedRevisionId : internalSelectedId;
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [creatingVersion, setCreatingVersion] = useState(false);

  const queryKey = ['revisions', contentId];

  const fetchFn = fetchRevisions || listContentRevisions;
  const restoreFn = restoreRevision || restoreContentRevision;

  const { data: revisions = [], isLoading } = useQuery<RevisionItem[]>({
    queryKey,
    queryFn: () => fetchFn(contentId),
    staleTime: 15_000,
  });

  const [restoreError, setRestoreError] = useState<string | null>(null);

  const restoreMut = useMutation({
    mutationFn: (revisionId: string) => restoreFn(contentId, revisionId),
    onSuccess: (result) => {
      setRestoreError(null);
      queryClient.invalidateQueries({ queryKey });
      setConfirmRestore(null);
      handleSelect(null);
      onRestore?.(result?.data ?? result);
    },
    onError: (error: Error) => {
      setRestoreError(error.message || t('content.restoreVersionFailed'));
    },
  });

  const selectedRevision = revisions.find((r) => r.id === selectedId);

  const handleSelect = (id: string | null) => {
    if (onSelectRevision !== undefined) {
      const rev = id ? revisions.find(r => r.id === id) || null : null;
      onSelectRevision(rev);
    }
    setInternalSelectedId(id);
  };

  const handleCreateVersion = async () => {
    if (!onCreateManualVersion || creatingVersion) return;
    setCreatingVersion(true);
    // Optimistic update: immediately add a placeholder revision so user sees feedback
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticRevision: RevisionItem = {
      id: optimisticId,
      trigger_type: 'manual',
      created_at: new Date().toISOString(),
      description: null,
      created_by: actor?.display_name ?? null,
    };
    queryClient.setQueryData<RevisionItem[]>(queryKey, (old = []) => [optimisticRevision, ...old]);
    try {
      await onCreateManualVersion();
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      console.error('[RevisionHistory] Create manual version failed:', e);
      // Rollback optimistic update on failure
      queryClient.setQueryData<RevisionItem[]>(queryKey, (old = []) => old.filter(r => r.id !== optimisticId));
    } finally {
      setCreatingVersion(false);
    }
  };

  // Shared inner content (used by both desktop and mobile)
  const panelContent = (
    <>
      {/* Create version button */}
      {onCreateManualVersion && (
        <div className="px-4 py-2 border-b border-border">
          <button
            onClick={handleCreateVersion}
            disabled={creatingVersion}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium',
              'border border-border hover:bg-muted transition-colors',
              'disabled:opacity-50',
            )}
          >
            {creatingVersion ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {t('content.createVersion')}
          </button>
        </div>
      )}

      {/* Revision list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : revisions.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t('content.noSavedVersions')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('content.versionsAutoSaved')}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {revisions.map((revision, index) => (
              <button
                key={revision.id}
                onClick={() =>
                  handleSelect(selectedId === revision.id ? null : revision.id)
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
                      {revision.version ? `v${revision.version}` : t('content.versionN', { n: revisions.length - index })}
                    </span>
                    {revision.trigger_type && TRIGGER_LABELS[revision.trigger_type] && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                        {t(TRIGGER_LABELS[revision.trigger_type])}
                      </span>
                    )}
                  </div>
                  {(revision.description_key || revision.description) && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {renderField(t, revision.description_key, revision.description_params, revision.description)}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{formatRelativeTime(revision.created_at)}</span>
                    {(revision.created_by || revision.agent) && (
                      <>
                        <span>&middot;</span>
                        <ActorInlineAvatar name={revision.created_by || revision.agent || ''} />
                        <span>{revision.created_by || revision.agent}</span>
                      </>
                    )}
                  </div>
                  {renderRevisionMeta?.(revision)}
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
        <span className="text-sm font-medium">{t('content.versionHistory')}</span>
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
