'use client';

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Clock, ChevronRight, X } from 'lucide-react';
import * as gw from '@/lib/api/gateway';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Props {
  contentId: string;
  onClose: () => void;
  onRestored: (data: any) => void | Promise<void>;
}

export default function ContentRevisionHistory({ contentId, onClose, onRestored }: Props) {
  const { t } = useT();
  const [revisions, setRevisions] = useState<gw.ContentRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    gw.listContentRevisions(contentId)
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
  }, [contentId]);

  const handleRestore = useCallback(async () => {
    if (!selectedId) return;
    setRestoring(true);
    try {
      const result = await gw.restoreContentRevision(contentId, selectedId);
      await onRestored(result.data);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Restore failed');
      setRestoring(false);
    }
  }, [selectedId, contentId, onRestored, onClose]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return t('content.justNow') || 'Just now';
    if (mins < 60) return `${mins} ${t('content.minutesAgo') || 'min ago'}`;
    if (hours < 24) return `${hours} ${t('content.hoursAgo') || 'hours ago'}`;
    if (days < 7) return `${days} ${t('content.daysAgo') || 'days ago'}`;

    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock size={14} />
          {t('content.versionHistory') || 'Version History'}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 hover:bg-accent"
          title={t('common.close') || 'Close'}
        >
          <X size={14} />
        </button>
      </div>

      {/* Revision list */}
      <div className="overflow-y-auto flex-1">
        {loading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('content.loading') || 'Loading...'}
          </div>
        )}
        {error && (
          <div className="px-4 py-4 text-sm text-destructive">{error}</div>
        )}
        {!loading && revisions.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('content.noRevisions') || 'No previous versions'}
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
                {formatTime(rev.created_at)}
              </span>
              <ChevronRight size={14} className="text-muted-foreground" />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {rev.created_by || 'Unknown'}
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
              ? (t('content.restoring') || 'Restoring...')
              : (t('content.restoreVersion') || 'Restore this version')}
          </button>
        </div>
      )}
    </div>
  );
}
