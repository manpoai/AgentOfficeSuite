'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Search, Link2, Check, ChevronLeft, ChevronRight, Paperclip } from 'lucide-react';
import * as br from '@/lib/api/tables';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { formatDate } from '@/lib/utils/time';

interface LinkRecordPickerProps {
  tableId: string;
  rowId: number;
  column: br.BRColumn;
  onClose: () => void;
  onRefresh: () => void;
}

const HIDDEN_TYPES = new Set(['Formula', 'Rollup', 'Lookup', 'Count', 'Links']);
const PAGE_SIZE = 25;


export function LinkRecordPicker({ tableId, rowId, column, onClose, onRefresh }: LinkRecordPickerProps) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [linking, setLinking] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const relatedTableId = column.relatedTableId || '';

  // Debounce search
  const searchTimerRef = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (searchTimerRef[0]) clearTimeout(searchTimerRef[0]);
    searchTimerRef[0] = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300);
  }, [searchTimerRef]);

  // Fetch linked records for this row+column
  const { data: linkedData, refetch: refetchLinked } = useQuery({
    queryKey: ['nc-linked-records', tableId, rowId, column.column_id],
    queryFn: () => br.listLinkedRecords(tableId, rowId, column.column_id, { limit: 200 }),
    enabled: !!relatedTableId,
  });

  // Fetch related table meta
  const { data: relatedMeta } = useQuery({
    queryKey: ['nc-table-meta', relatedTableId],
    queryFn: () => br.describeTable(relatedTableId),
    enabled: !!relatedTableId,
  });

  // Columns to display: display column first, then all non-hidden columns (horizontal scroll)
  const visibleCols = useMemo(() => {
    if (!relatedMeta?.columns) return [];
    // Find display column (primary_key / pv)
    const displayCol = relatedMeta.columns.find(c => c.primary_key);
    const others = relatedMeta.columns.filter(c =>
      c !== displayCol && !HIDDEN_TYPES.has(c.type) && c.title !== 'created_by' && c.type !== 'ID'
    );
    return displayCol ? [displayCol, ...others] : others;
  }, [relatedMeta]);

  const displayCol = visibleCols[0];
  const displayColTitle = displayCol?.title || t('dataTable.defaultColumnTitle');

  // Build option color map from column definitions
  const optionColorMap = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    if (!relatedMeta?.columns) return map;
    for (const col of relatedMeta.columns) {
      if ((col.type === 'SingleSelect' || col.type === 'MultiSelect') && col.options) {
        map[col.title] = {};
        for (const opt of col.options) {
          if (opt.color) map[col.title][opt.title] = opt.color;
        }
      }
    }
    return map;
  }, [relatedMeta]);

  // Fetch records with server-side search and pagination
  const { data: allRecords, isLoading } = useQuery({
    queryKey: ['nc-rows', relatedTableId, 'link-picker', debouncedSearch, page],
    queryFn: () => br.queryRows(relatedTableId, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      ...(debouncedSearch ? { where: `(${displayColTitle},like,%${debouncedSearch}%)` } : {}),
    }),
    enabled: !!relatedTableId && !!relatedMeta,
  });

  const linkedIds = useMemo(() => new Set((linkedData?.list || []).map(r => r.Id as number)), [linkedData]);
  const records = allRecords?.list || [];
  const totalRows = allRecords?.pageInfo?.totalRows || 0;
  const totalPages = Math.ceil(totalRows / PAGE_SIZE) || 1;

  const handleToggle = async (targetRowId: number) => {
    const isLinked = linkedIds.has(targetRowId);
    setLinking(prev => new Set(prev).add(targetRowId));
    try {
      if (isLinked) {
        await br.unlinkRecords(tableId, rowId, column.column_id, [targetRowId]);
      } else {
        await br.linkRecords(tableId, rowId, column.column_id, [targetRowId]);
      }
      refetchLinked();
      onRefresh();
    } catch (e) {
      showError(t('errors.linkToggleFailed'), e);
    } finally {
      setLinking(prev => { const s = new Set(prev); s.delete(targetRowId); return s; });
    }
  };

  if (!relatedTableId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-card border border-border rounded-xl shadow-2xl p-4 w-80">
          <p className="text-sm text-muted-foreground">{t('linkPicker.noRelatedTable')}</p>
          <button onClick={onClose} className="mt-2 text-xs text-sidebar-primary">{t('common.close')}</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-sidebar-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                {column.title}
                <span className="text-xs text-muted-foreground ml-2">→ {relatedMeta?.title || '...'}</span>
              </h3>
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {linkedIds.size} {t('linkPicker.linked').toLowerCase()}
              </span>
            </div>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-2 border-b border-border">
            <div className="flex items-center gap-2 bg-muted rounded-lg px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder={t('linkPicker.searchRecords')}
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
              {search && (
                <button onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(1); }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="text-xs" style={{ minWidth: '100%' }}>
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr>
                  <th className="w-10 min-w-[40px] px-2 py-2 text-center sticky left-0 bg-muted/80 z-10">
                    <Check className="h-3 w-3 mx-auto text-muted-foreground/50" />
                  </th>
                  {visibleCols.map(col => (
                    <th key={col.column_id} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[120px]">
                      {col.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td colSpan={visibleCols.length + 1} className="px-3 py-2">
                        <div className="h-4 bg-muted/50 rounded animate-pulse" />
                      </td>
                    </tr>
                  ))
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={visibleCols.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                      {debouncedSearch ? t('linkPicker.noAvailable') : t('linkPicker.noAvailable')}
                    </td>
                  </tr>
                ) : (
                  records.map(row => {
                    const rid = row.Id as number;
                    const isLinked = linkedIds.has(rid);
                    const isProcessing = linking.has(rid);
                    return (
                      <tr
                        key={rid}
                        onClick={() => !isProcessing && handleToggle(rid)}
                        className={cn(
                          'border-b border-border/30 cursor-pointer transition-colors',
                          isLinked ? 'bg-sidebar-primary/5' : 'hover:bg-accent/50',
                          isProcessing && 'opacity-50 pointer-events-none'
                        )}
                      >
                        <td className="w-10 min-w-[40px] px-2 py-1.5 text-center sticky left-0 z-10" style={{ backgroundColor: isLinked ? 'var(--sidebar-primary-5, rgba(var(--sidebar-primary), 0.05))' : 'var(--card)' }}>
                          <div
                            className={cn(
                              'w-4 h-4 rounded border flex items-center justify-center mx-auto transition-colors cursor-pointer',
                              isLinked ? 'bg-sidebar-primary border-sidebar-primary' : 'border-border hover:border-sidebar-primary/50'
                            )}
                            onClick={(e) => { e.stopPropagation(); if (!isProcessing) handleToggle(rid); }}
                          >
                            {isLinked && <Check className="h-2.5 w-2.5 text-sidebar-primary-foreground" />}
                          </div>
                        </td>
                        {visibleCols.map(col => (
                          <td key={col.column_id} className="px-3 py-1.5 text-foreground max-w-[250px]">
                            <CellValue value={row[col.title]} colType={col.type} colTitle={col.title} colorMap={optionColorMap} />
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
              <span>{totalRows} {t('linkPicker.available').toLowerCase()}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1 hover:text-foreground disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span>{page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1 hover:text-foreground disabled:opacity-30"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Cell value renderer with type-specific formatting ──

const DEFAULT_COLORS = [
  '#d4e5ff', '#d1f0e0', '#fde2cc', '#fdd8d8', '#e8d5f5',
  '#d5e8f5', '#fff3bf', '#f0d5e8', '#d5f5e8', '#e8e8d5',
];

function CellValue({ value, colType, colTitle, colorMap }: {
  value: unknown;
  colType: string;
  colTitle: string;
  colorMap: Record<string, Record<string, string>>;
}) {
  if (value == null || value === '') return null;

  // Checkbox
  if (colType === 'Checkbox') {
    return <span>{value ? '✓' : ''}</span>;
  }

  // SingleSelect
  if (colType === 'SingleSelect') {
    const label = String(value);
    const color = colorMap[colTitle]?.[label] || DEFAULT_COLORS[Math.abs(hashStr(label)) % DEFAULT_COLORS.length];
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight" style={{ backgroundColor: color }}>
        {label}
      </span>
    );
  }

  // MultiSelect
  if (colType === 'MultiSelect') {
    const items = String(value).split(',').map(s => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-0.5">
        {items.map((item, i) => {
          const color = colorMap[colTitle]?.[item] || DEFAULT_COLORS[Math.abs(hashStr(item)) % DEFAULT_COLORS.length];
          return (
            <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight" style={{ backgroundColor: color }}>
              {item}
            </span>
          );
        })}
      </div>
    );
  }

  // Date/DateTime
  if (colType === 'Date' || colType === 'DateTime' || colType === 'CreatedTime' || colType === 'LastModifiedTime') {
    try { return <span>{formatDate(String(value))}</span>; } catch { return <span>{String(value)}</span>; }
  }

  // Attachment
  if (colType === 'Attachment') {
    const files = Array.isArray(value) ? value : [];
    if (files.length === 0) return null;
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <Paperclip className="h-3 w-3 shrink-0" />
        <span className="truncate">{files.map((f: any) => f.title || f.fileName || 'file').join(', ')}</span>
      </div>
    );
  }

  // Number/Decimal/Currency/Percent/Rating
  if (colType === 'Number' || colType === 'Decimal' || colType === 'Currency' || colType === 'Percent' || colType === 'Rating') {
    return <span>{String(value)}</span>;
  }

  // User/CreatedBy/LastModifiedBy
  if (colType === 'User' || colType === 'CreatedBy' || colType === 'LastModifiedBy') {
    if (typeof value === 'string') return <span>{value}</span>;
    if (Array.isArray(value)) return <span>{value.map((v: any) => v.display_name || v.email || String(v)).join(', ')}</span>;
    if (typeof value === 'object' && value !== null) return <span>{(value as any).display_name || (value as any).email || JSON.stringify(value)}</span>;
    return <span>{String(value)}</span>;
  }

  // Array (generic)
  if (Array.isArray(value)) {
    return <span className="truncate">{value.map(v => typeof v === 'object' ? ((v as any).title || JSON.stringify(v)) : String(v)).join(', ')}</span>;
  }

  // Object (generic)
  if (typeof value === 'object') {
    return <span className="truncate text-muted-foreground">{JSON.stringify(value)}</span>;
  }

  // Default: string
  return <span className="truncate">{String(value)}</span>;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
