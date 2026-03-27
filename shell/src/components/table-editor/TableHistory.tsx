'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, X, Plus, Database, Bot, Timer, Shield } from 'lucide-react';
import * as gw from '@/lib/api/gateway';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export interface SnapshotPreview {
  snapshotId: number;
  version: number;
  createdAt: string;
  schema: { title: string; uidt: string }[];
  rows: Record<string, unknown>[];
}

interface Props {
  tableId: string;
  onClose: () => void;
  onRestored: () => void;
  onSelectVersion: (preview: SnapshotPreview | null) => void;
  selectedSnapshotId?: number | null;
}

const TRIGGER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  auto: Timer,
  manual: Plus,
  pre_bulk: Shield,
  pre_restore: Shield,
};

const TRIGGER_LABEL_KEYS: Record<string, string> = {
  auto: 'dataTableHistory.triggerAuto',
  manual: 'dataTableHistory.triggerManual',
  pre_bulk: 'dataTableHistory.triggerPreBulk',
  pre_restore: 'dataTableHistory.triggerPreRestore',
};

export default function TableHistory({ tableId, onClose, onRestored, onSelectVersion, selectedSnapshotId }: Props) {
  const { t } = useT();
  const [snapshots, setSnapshots] = useState<gw.TableSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingSnapshotId, setLoadingSnapshotId] = useState<number | null>(null);

  const loadSnapshots = useCallback(async () => {
    try {
      setLoading(true);
      const list = await gw.listTableSnapshots(tableId);
      setSnapshots(list);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      await gw.createTableSnapshot(tableId);
      await loadSnapshots();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }, [tableId, loadSnapshots]);

  const handleSelectSnapshot = useCallback(async (snap: gw.TableSnapshot) => {
    if (selectedSnapshotId === snap.id) {
      // Deselect
      onSelectVersion(null);
      return;
    }
    setLoadingSnapshotId(snap.id);
    try {
      const full = await gw.getTableSnapshot(tableId, snap.id);
      const schema = JSON.parse(full.schema_json || '[]');
      const rows = JSON.parse(full.data_json || '[]');
      onSelectVersion({
        snapshotId: snap.id,
        version: snap.version,
        createdAt: snap.created_at,
        schema,
        rows,
      });
    } catch {
      onSelectVersion(null);
    } finally {
      setLoadingSnapshotId(null);
    }
  }, [tableId, selectedSnapshotId, onSelectVersion]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return t('time.justNow');
    if (mins < 60) return t('time.minutesAgo', { n: mins });
    if (hours < 24) return t('time.hoursAgo', { n: hours });
    if (days < 7) return t('time.daysAgo', { n: days });
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock size={14} />
          {t('dataTableHistory.title')}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 hover:bg-accent"
          title={t('common.close')}
        >
          <X size={14} />
        </button>
      </div>

      {/* Create version button */}
      <div className="px-4 py-2 border-b border-border">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
        >
          <Plus size={12} />
          {creating ? t('dataTableHistory.creating') : t('dataTableHistory.createVersion')}
        </button>
      </div>

      {/* Snapshot list */}
      <div className="overflow-y-auto flex-1">
        {loading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        )}
        {error && (
          <div className="px-4 py-4 text-sm text-destructive">{error}</div>
        )}
        {!loading && snapshots.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('dataTableHistory.noHistory')}
          </div>
        )}
        {snapshots.map((snap) => {
          const TriggerIcon = TRIGGER_ICONS[snap.trigger_type] || Timer;
          const isSelected = selectedSnapshotId === snap.id;
          const isLoadingThis = loadingSnapshotId === snap.id;
          return (
            <button
              key={snap.id}
              onClick={() => handleSelectSnapshot(snap)}
              disabled={isLoadingThis}
              className={cn(
                'w-full border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-accent/50',
                isSelected && 'bg-accent ring-1 ring-sidebar-primary/30',
                isLoadingThis && 'opacity-60'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <TriggerIcon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium">
                    v{snap.version}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {t(TRIGGER_LABEL_KEYS[snap.trigger_type] || 'dataTableHistory.triggerAuto')}
                  </span>
                  {isLoadingThis && (
                    <span className="text-[10px] text-muted-foreground ml-1">{t('common.loading')}</span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">{formatTime(snap.created_at)}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                {snap.agent && (
                  <span className="flex items-center gap-0.5">
                    <Bot className="h-2.5 w-2.5" />
                    {snap.agent}
                  </span>
                )}
                <span className="flex items-center gap-0.5">
                  <Database className="h-2.5 w-2.5" />
                  {snap.row_count} {t('dataTable.rows')}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
