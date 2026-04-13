'use client';

/**
 * TableDialogs — Extracted dialog components: SnapshotPreviewPanel, CSVImportDialog, BulkEditDialog.
 * Extracted from TableEditor.tsx during refactoring — no behavior changes.
 */

import React from 'react';
import { X, Clock, RotateCcw, Plus } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils/time';
import { SnapshotPreview } from './TableHistory';
import { SnapshotCellValue } from './TableGrid';
import * as gw from '@/lib/api/gateway';
import * as br from '@/lib/api/tables';
import { showError } from '@/lib/utils/error';
import { RevisionPreviewBanner } from '@/components/shared/RevisionPreviewBanner';

// ── Snapshot Preview Panel ──

export interface SnapshotPreviewPanelProps {
  previewSnapshot: SnapshotPreview;
  tableId: string;
  onRestore: () => void;
  onClose: () => void;
  queryClient: ReturnType<typeof import('@tanstack/react-query').useQueryClient>;
}

export function SnapshotPreviewPanel({ previewSnapshot, tableId, onRestore, onClose, queryClient }: SnapshotPreviewPanelProps) {
  const { t } = useT();

  const formatTime = () => {
    return formatDateTime(previewSnapshot.createdAt);
  };

  const HIDDEN_SNAPSHOT_UIDTS = new Set(['ID', 'CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'Links', 'LinkToAnotherRecord', 'Lookup', 'Rollup', 'Formula', 'Count']);
  const snapshotCols = previewSnapshot.schema.filter((c: { uidt: string }) => !HIDDEN_SNAPSHOT_UIDTS.has(c.uidt));

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <RevisionPreviewBanner
        createdAt={previewSnapshot.createdAt}
        onExit={onClose}
        onRestore={async () => {
          if (!confirm(t('dataTableHistory.restoreConfirm'))) return;
          try {
            const result = await gw.restoreTableSnapshot(tableId, previewSnapshot.snapshotId);
            console.log('[TableEditor] Restore success:', result);
            onRestore();
            queryClient.removeQueries({ queryKey: ['nc-rows', tableId] });
            queryClient.invalidateQueries({ queryKey: ['nc-table-meta', tableId] });
          } catch (e: unknown) {
            showError(t('errors.restoreVersionFailed'), e);
          }
        }}
      />
      {/* Read-only snapshot table — horizontal scroll like link picker */}
      <div className="flex-1 overflow-auto bg-amber-50/30 dark:bg-amber-950/10">
        {previewSnapshot.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t('dataTable.emptyTable')}</div>
        ) : (
          <table className="text-xs" style={{ minWidth: '100%' }}>
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-[5]">
              <tr>
                <th className="w-10 min-w-[40px] px-2 py-2 text-center text-[10px] font-normal text-muted-foreground/50 border-r border-border sticky left-0 bg-muted/80 z-10">#</th>
                {snapshotCols.map((col: { title: string; uidt: string }, i: number) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[120px]">
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewSnapshot.rows.map((row: Record<string, unknown>, ri: number) => (
                <tr key={ri} className="border-b border-border/30 hover:bg-accent/20">
                  <td className="w-10 min-w-[40px] px-2 py-1.5 text-center text-[10px] text-muted-foreground/50 border-r border-border sticky left-0 bg-amber-50/30 dark:bg-amber-950/10 z-10">{ri + 1}</td>
                  {snapshotCols.map((col: { title: string; uidt: string }, ci: number) => (
                    <td key={ci} className="px-3 py-1.5 text-foreground max-w-[250px]">
                      <SnapshotCellValue value={row[col.title]} colType={col.uidt} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── CSV Import Dialog ──

export interface CSVImportDialogProps {
  csvImportData: { headers: string[]; rows: string[][] };
  csvColMap: Record<number, string>;
  setCsvColMap: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  csvImporting: boolean;
  editableCols: br.BRColumn[];
  onClose: () => void;
  onImport: () => void;
}

export function CSVImportDialog({ csvImportData, csvColMap, setCsvColMap, csvImporting, editableCols, onClose, onImport }: CSVImportDialogProps) {
  const { t } = useT();

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">{t('dataTable.importCSVTitle')}</h3>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-2">
            <p className="text-xs text-muted-foreground mb-3">
              {t('dataTable.importCSVRows', { n: csvImportData.rows.length })}
            </p>
            {csvImportData.headers.map((header, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-foreground w-32 truncate shrink-0" title={header}>
                  {header}
                </span>
                <span className="text-xs text-muted-foreground">&rarr;</span>
                <select
                  value={csvColMap[i] || ''}
                  onChange={e => setCsvColMap(prev => ({ ...prev, [i]: e.target.value }))}
                  className="flex-1 bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none"
                >
                  <option value="">{t('dataTable.skip')}</option>
                  {editableCols.map(c => (
                    <option key={c.column_id} value={c.title}>{c.title}</option>
                  ))}
                </select>
                <span className="text-[10px] text-muted-foreground w-24 truncate" title={csvImportData.rows[0]?.[i]}>
                  {csvImportData.rows[0]?.[i] || '\u2014'}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              {t('dataTable.mappedCols', { mapped: Object.values(csvColMap).filter(Boolean).length, total: csvImportData.headers.length })}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded border border-border"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={onImport}
                disabled={csvImporting || Object.values(csvColMap).filter(Boolean).length === 0}
                className="px-3 py-1.5 text-xs text-white bg-sidebar-primary rounded hover:opacity-90 disabled:opacity-50"
              >
                {csvImporting ? t('dataTable.importing') : t('dataTable.importNRows', { n: csvImportData.rows.length })}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Bulk Edit Dialog ──

export interface BulkEditDialogProps {
  selectedCount: number;
  editableCols: br.BRColumn[];
  bulkEditCol: string;
  setBulkEditCol: (col: string) => void;
  bulkEditVal: string;
  setBulkEditVal: (val: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function BulkEditDialog({ selectedCount, editableCols, bulkEditCol, setBulkEditCol, bulkEditVal, setBulkEditVal, onClose, onSubmit }: BulkEditDialogProps) {
  const { t } = useT();

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl shadow-2xl p-4 w-80">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t('dataTable.batchEditTitle', { n: selectedCount })}</h3>
          <div className="space-y-3">
            <select
              value={bulkEditCol}
              onChange={e => setBulkEditCol(e.target.value)}
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">{t('dataTable.selectField')}</option>
              {editableCols.map(c => (
                <option key={c.column_id} value={c.title}>{c.title}</option>
              ))}
            </select>
            <input
              value={bulkEditVal}
              onChange={e => setBulkEditVal(e.target.value)}
              placeholder={t('dataTable.newValue')}
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded border border-border"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={onSubmit}
                disabled={!bulkEditCol}
                className="px-3 py-1.5 text-xs text-white bg-sidebar-primary rounded hover:opacity-90 disabled:opacity-50"
              >
                {t('dataTable.confirmEdit')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
