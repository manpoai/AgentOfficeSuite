'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Search, Plus, Minus, Link2 } from 'lucide-react';
import * as nc from '@/lib/api/nocodb';

interface LinkRecordPickerProps {
  tableId: string;
  rowId: number;
  column: nc.NCColumn;
  onClose: () => void;
  onRefresh: () => void;
}

export function LinkRecordPicker({ tableId, rowId, column, onClose, onRefresh }: LinkRecordPickerProps) {
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const relatedTableId = column.relatedTableId || '';

  // Fetch linked records for this row+column
  const { data: linkedData, refetch: refetchLinked } = useQuery({
    queryKey: ['nc-linked-records', tableId, rowId, column.column_id],
    queryFn: () => nc.listLinkedRecords(tableId, rowId, column.column_id, { limit: 100 }),
    enabled: !!relatedTableId,
  });

  // Fetch related table meta to know which column is the display column
  const { data: relatedMeta } = useQuery({
    queryKey: ['nc-table-meta', relatedTableId],
    queryFn: () => nc.describeTable(relatedTableId),
    enabled: !!relatedTableId,
  });

  // Fetch all records from related table for the picker
  const { data: allRecords } = useQuery({
    queryKey: ['nc-rows', relatedTableId, 'link-picker', search],
    queryFn: () => nc.queryRows(relatedTableId, {
      limit: 50,
      ...(search ? { where: `(${displayColTitle},like,${search})` } : {}),
    }),
    enabled: !!relatedTableId && !!relatedMeta,
  });

  const linkedRows = linkedData?.list || [];
  const linkedIds = new Set(linkedRows.map(r => r.Id as number));
  const availableRows = (allRecords?.list || []).filter(r => !linkedIds.has(r.Id as number));

  // Find display column (first non-PK text column, or first column)
  const displayCol = relatedMeta?.columns?.find(c => c.primary_key) || relatedMeta?.columns?.[0];
  const displayColTitle = displayCol?.title || 'Id';

  const handleLink = async (targetRowId: number) => {
    setLinking(targetRowId);
    try {
      await nc.linkRecords(tableId, rowId, column.column_id, [targetRowId]);
      refetchLinked();
      onRefresh();
    } catch (e) {
      console.error('Link failed:', e);
    } finally {
      setLinking(null);
    }
  };

  const handleUnlink = async (targetRowId: number) => {
    setLinking(targetRowId);
    try {
      await nc.unlinkRecords(tableId, rowId, column.column_id, [targetRowId]);
      refetchLinked();
      onRefresh();
    } catch (e) {
      console.error('Unlink failed:', e);
    } finally {
      setLinking(null);
    }
  };

  if (!relatedTableId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-card border border-border rounded-xl shadow-2xl p-4 w-80">
          <p className="text-sm text-muted-foreground">此列未配置关联表</p>
          <button onClick={onClose} className="mt-2 text-xs text-sidebar-primary">关闭</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-sidebar-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                {column.title}
                <span className="text-xs text-muted-foreground ml-2">→ {relatedMeta?.title || '...'}</span>
              </h3>
            </div>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Linked records */}
          <div className="px-4 py-2 border-b border-border">
            <div className="text-[10px] text-muted-foreground mb-1">已关联 ({linkedRows.length})</div>
            {linkedRows.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 py-1">无关联记录</p>
            ) : (
              <div className="space-y-0.5 max-h-32 overflow-y-auto">
                {linkedRows.map(row => {
                  const rid = row.Id as number;
                  return (
                    <div key={rid} className="flex items-center justify-between px-2 py-1 rounded hover:bg-accent/50 group">
                      <span className="text-xs text-foreground truncate flex-1">
                        {String(row[displayColTitle] || row.Title || row.Id)}
                      </span>
                      <button
                        onClick={() => handleUnlink(rid)}
                        disabled={linking === rid}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-opacity"
                        title="取消关联"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="px-4 py-2">
            <div className="flex items-center gap-2 bg-muted rounded-lg px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索记录..."
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* Available records */}
          <div className="flex-1 overflow-y-auto px-4 pb-3">
            <div className="text-[10px] text-muted-foreground mb-1">可关联的记录</div>
            {availableRows.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 py-2">无可关联记录</p>
            ) : (
              <div className="space-y-0.5">
                {availableRows.map(row => {
                  const rid = row.Id as number;
                  return (
                    <div key={rid} className="flex items-center justify-between px-2 py-1 rounded hover:bg-accent/50 group">
                      <span className="text-xs text-foreground truncate flex-1">
                        {String(row[displayColTitle] || row.Title || row.Id)}
                      </span>
                      <button
                        onClick={() => handleLink(rid)}
                        disabled={linking === rid}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-sidebar-primary hover:opacity-80 transition-opacity"
                        title="添加关联"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
