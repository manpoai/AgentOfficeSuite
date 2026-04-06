'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RotateCcw, Clock, ChevronRight, X } from 'lucide-react';
import * as docApi from '@/lib/api/documents';
import type { Revision, Document as DocType } from '@/lib/api/documents';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { formatRelativeTime, formatDateTime } from '@/lib/utils/time';

interface Props {
  doc: DocType;
  onClose: () => void;
  onRestored: () => void | Promise<void>;
  /** Called when a revision is selected — parent shows preview in editor area */
  onSelect: (revision: Revision | null, prevRevision: Revision | null) => void;
  /** Whether highlight changes is on */
  highlightChanges: boolean;
  onHighlightChangesToggle: () => void;
}

export default function RevisionHistory({ doc, onClose, onRestored, onSelect, highlightChanges, onHighlightChangesToggle }: Props) {
  const { t } = useT();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    docApi.listRevisions(doc.id)
      .then((revs) => {
        if (!cancelled) {
          setRevisions(revs);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [doc.id]);

  // Use ref for onSelect to avoid re-triggering on parent re-renders
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Notify parent when selection changes
  useEffect(() => {
    if (!selectedId) {
      onSelectRef.current(null, null);
      return;
    }
    const rev = revisions.find(r => r.id === selectedId) || null;
    const idx = revisions.findIndex(r => r.id === selectedId);
    const prev = (idx >= 0 && idx < revisions.length - 1) ? revisions[idx + 1] : null;
    onSelectRef.current(rev, prev);
  }, [selectedId, revisions]);

  const handleRestore = useCallback(async () => {
    if (!selectedId) return;
    setRestoring(true);
    try {
      await docApi.restoreRevision(doc.id, selectedId);
      await onRestored();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Restore failed');
      setRestoring(false);
    }
  }, [selectedId, doc.id, onRestored, onClose]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    // For recent items use relative time; for older items show full date+time
    if (days < 7) return formatRelativeTime(iso);
    return formatDateTime(iso);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header — compact */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock size={14} />
          {t('content.versionHistory')}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onHighlightChangesToggle}
            className={cn(
              'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors',
              highlightChanges ? 'bg-sidebar-primary' : 'bg-muted'
            )}
            title={t('content.highlightChanges')}
          >
            <span className={cn(
              'pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform mt-0.5 ml-0.5',
              highlightChanges ? 'translate-x-3' : 'translate-x-0'
            )} />
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-accent"
            title={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Current version — compact inline */}
      <button
        onClick={() => setSelectedId(null)}
        className={cn(
          'w-full text-left border-b border-border px-4 py-2 transition-colors',
          selectedId === null ? 'bg-accent' : 'hover:bg-accent/50'
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">{t('content.currentVersion')}</span>
          <span className="text-[10px] text-muted-foreground">{formatTime(doc.updated_at)}</span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{doc.updated_by}</div>
      </button>

      {/* Revision list */}
      <div className="overflow-y-auto flex-1">
        {loading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('content.loading')}
          </div>
        )}
        {error && (
          <div className="px-4 py-4 text-sm text-destructive">{error}</div>
        )}
        {!loading && revisions.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('content.noRevisions')}
          </div>
        )}
        {revisions.map((rev) => (
          <button
            key={rev.id}
            onClick={() => setSelectedId(rev.id)}
            className={cn(
              'w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/50',
              selectedId === rev.id && 'bg-accent'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {rev.title || t('content.untitled')}
              </span>
              <ChevronRight size={14} className="text-muted-foreground" />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {rev.createdBy?.name || t('common.unknown')} · {formatTime(rev.createdAt)}
            </div>
          </button>
        ))}
      </div>

      {/* Restore button */}
      {selectedId && (
        <div className="border-t border-border p-4">
          <button
            onClick={handleRestore}
            disabled={restoring}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <RotateCcw size={14} />
            {restoring
              ? t('content.restoring')
              : t('content.restoreVersion')}
          </button>
        </div>
      )}
    </div>
  );
}
