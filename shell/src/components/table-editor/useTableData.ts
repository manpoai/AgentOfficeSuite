/**
 * useTableData — data fetching queries, mutations, row operations.
 * Extracted from TableEditor.tsx during refactoring — no behavior changes.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as br from '@/lib/api/tables';
import * as gw from '@/lib/api/gateway';
import { showError } from '@/lib/utils/error';
import { useT } from '@/lib/i18n';
import { READONLY_TYPES, SELECT_COLORS } from './types';

export function useTableData(tableId: string, pageSize: number = 50) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  // ── Sort param ──
  const sortParam = sortCol ? (sortDir === 'desc' ? `-${sortCol}` : sortCol) : undefined;

  // ── Meta ──
  const { data: meta, isError: metaError, error: metaErrorDetail } = useQuery({
    queryKey: ['nc-table-meta', tableId],
    queryFn: () => br.describeTable(tableId),
    retry: 2,
  });

  // Set active view when meta loads or tableId changes
  useEffect(() => {
    if (!meta || meta.table_id !== tableId) {
      setActiveViewId(null);
      return;
    }
    if (meta.views?.length) {
      const savedViewId = localStorage.getItem(`aose-table-last-view-${tableId}`);
      const savedView = savedViewId ? meta.views.find(v => v.view_id === savedViewId) : null;
      const defaultView = savedView || meta.views.find(v => v.is_default) || meta.views[0];
      setActiveViewId(defaultView.view_id);
    }
  }, [meta?.table_id, tableId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save active view to localStorage when it changes
  useEffect(() => {
    if (activeViewId) {
      localStorage.setItem(`aose-table-last-view-${tableId}`, activeViewId);
    }
  }, [activeViewId, tableId]);

  const views = meta?.views || [];

  // ── View filters ──
  const { data: viewFilters } = useQuery({
    queryKey: ['nc-view-filters', activeViewId],
    queryFn: () => br.listFilters(activeViewId!),
    enabled: !!activeViewId,
  });

  // ── View sorts ──
  const { data: viewSorts } = useQuery({
    queryKey: ['nc-view-sorts', activeViewId],
    queryFn: () => br.listSorts(activeViewId!),
    enabled: !!activeViewId,
  });

  // Build where clause from view filters
  const whereParam = useMemo(() => {
    if (!viewFilters?.length || !meta?.columns) return undefined;
    const parts = viewFilters.map(f => {
      const col = meta.columns.find(c => c.column_id === f.fk_column_id);
      if (!col) return null;
      const field = col.title;
      const op = f.comparison_op;
      if (op === 'is' || op === 'isnot' || op === 'empty' || op === 'notempty'
          || op === 'null' || op === 'notnull' || op === 'blank' || op === 'notblank'
          || op === 'checked' || op === 'notchecked') {
        return `(${field},${op},)`;
      }
      return `(${field},${op},${f.value ?? ''})`;
    }).filter(Boolean);
    if (parts.length === 0) return undefined;
    return parts.join('~and');
  }, [viewFilters, meta?.columns]);

  // Build sort param from view sorts
  const effectiveSortParam = useMemo(() => {
    if (sortParam) return sortParam;
    if (!viewSorts?.length || !meta?.columns) return 'Id';
    const parts = viewSorts
      .sort((a, b) => a.order - b.order)
      .map(s => {
        const col = meta.columns.find(c => c.column_id === s.fk_column_id);
        if (!col) return null;
        return s.direction === 'desc' ? `-${col.title}` : col.title;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(',') : 'Id';
  }, [viewSorts, meta?.columns, sortParam]);

  // ── Row data ──
  const { data: rowsData, isLoading, isFetching } = useQuery({
    queryKey: ['nc-rows', tableId, activeViewId, page, effectiveSortParam, whereParam || '__no_filter__'],
    queryFn: () => br.queryRows(tableId, { limit: pageSize, offset: (page - 1) * pageSize, sort: effectiveSortParam, where: whereParam }),
    enabled: !!meta,
    placeholderData: keepPreviousData,
  });

  // ── View columns ──
  const { data: viewColumns } = useQuery({
    queryKey: ['nc-view-columns', activeViewId],
    queryFn: () => br.listViewColumns(activeViewId!),
    enabled: !!activeViewId,
  });

  // ── Commented rows ──
  const { data: commentedRowsData } = useQuery({
    queryKey: ['commented-rows', tableId],
    queryFn: () => gw.listCommentedRows(tableId),
    enabled: !!tableId,
  });

  const commentedRowIds = useMemo(() => {
    const set = new Set<string>();
    if (commentedRowsData) {
      for (const r of commentedRowsData) set.add(String(r.row_id));
    }
    return set;
  }, [commentedRowsData]);

  // ── Agents list ──
  const { data: agentsList } = useQuery({
    queryKey: ['agents-list'],
    queryFn: gw.listAgents,
    staleTime: 60000,
  });

  // ── Derived data ──
  const displayCols = useMemo(() => {
    const cols = (meta?.columns || []).filter(c => c.title !== 'created_by' && c.type !== 'ID' && !(c.title === 'Id' && c.primary_key));
    if (cols.length > 0 && !cols.some(c => c.primary_key)) {
      cols[0] = { ...cols[0], primary_key: true };
    }
    return cols;
  }, [meta?.columns]);

  const editableCols = displayCols.filter(c => !c.primary_key && !READONLY_TYPES.has(c.type));
  const rows = rowsData?.list || [];
  const totalRows = rowsData?.pageInfo?.totalRows || 0;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  // ── Refresh helpers ──
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['nc-rows', tableId] }), [queryClient, tableId]);
  const refreshMeta = useCallback(() => queryClient.invalidateQueries({ queryKey: ['nc-table-meta', tableId] }), [queryClient, tableId]);
  const refreshFilters = useCallback(() => queryClient.invalidateQueries({ queryKey: ['nc-view-filters', activeViewId] }), [queryClient, activeViewId]);
  const refreshSorts = useCallback(() => queryClient.invalidateQueries({ queryKey: ['nc-view-sorts', activeViewId] }), [queryClient, activeViewId]);
  const refreshViewColumns = useCallback(() => queryClient.invalidateQueries({ queryKey: ['nc-view-columns', activeViewId] }), [queryClient, activeViewId]);

  // ── Sort handler ──
  const handleSort = useCallback((col: string) => {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  }, [sortCol, sortDir]);

  // ── View handlers ──
  const handleCreateView = useCallback(async (title: string, type: string) => {
    if (!title.trim()) return;
    try {
      const view = await br.createView(tableId, title.trim(), type);
      refreshMeta();
      setActiveViewId(view.view_id);
      return view;
    } catch (e) { showError(t('errors.createViewFailed'), e); }
  }, [tableId, refreshMeta]);

  const handleRenameView = useCallback(async (viewId: string, title: string) => {
    if (!title.trim()) return;
    try {
      await br.renameView(viewId, title.trim());
      refreshMeta();
    } catch (e) { showError(t('errors.renameViewFailed'), e); }
  }, [refreshMeta]);

  const handleDeleteView = useCallback(async (viewId: string) => {
    try {
      await br.deleteView(viewId);
      refreshMeta();
      if (activeViewId === viewId) setActiveViewId(null);
    } catch (e) { showError(t('errors.deleteViewFailed'), e); }
  }, [activeViewId, refreshMeta]);

  // ── Filter handlers ──
  const handleAddFilter = useCallback(async (col: string, op: string, val: string) => {
    if (!activeViewId || !col) return;
    try {
      await br.createFilter(activeViewId, { fk_column_id: col, comparison_op: op, value: val });
      refreshFilters();
      refresh();
    } catch (e) { showError(t('errors.addFilterFailed'), e); }
  }, [activeViewId, refreshFilters, refresh]);

  const handleDeleteFilter = useCallback(async (filterId: string) => {
    try {
      await br.deleteFilter(filterId);
      refreshFilters();
      refresh();
    } catch (e) { showError(t('errors.deleteFilterFailed'), e); }
  }, [refreshFilters, refresh]);

  const handleUpdateFilter = useCallback(async (filterId: string, updates: { fk_column_id?: string; comparison_op?: string; value?: string }) => {
    try {
      await br.updateFilter(filterId, updates);
      refreshFilters();
      refresh();
    } catch (e) { showError(t('errors.updateFilterFailed'), e); }
  }, [refreshFilters, refresh]);

  // ── Sort handlers ──
  const handleAddSort = useCallback(async (col: string, direction: 'asc' | 'desc') => {
    if (!activeViewId || !col) return;
    try {
      await br.createSort(activeViewId, { fk_column_id: col, direction });
      refreshSorts();
      refresh();
    } catch (e) { showError(t('errors.addSortFailed'), e); }
  }, [activeViewId, refreshSorts, refresh]);

  const handleColumnSort = useCallback(async (columnId: string, direction: 'asc' | 'desc') => {
    if (!activeViewId) return;
    const existingSort = viewSorts?.find(s => s.fk_column_id === columnId);
    if (existingSort) {
      try { await br.deleteSort(existingSort.sort_id); } catch (e) { showError(t('errors.deleteSortFailed'), e); }
    }
    try {
      await br.createSort(activeViewId, { fk_column_id: columnId, direction });
      refreshSorts();
      refresh();
    } catch (e) { showError(t('errors.createSortFailed'), e); }
  }, [activeViewId, viewSorts, refreshSorts, refresh]);

  const handleDeleteSort = useCallback(async (sortId: string) => {
    try {
      await br.deleteSort(sortId);
      refreshSorts();
      refresh();
    } catch (e) { showError(t('errors.deleteSortFailed'), e); }
  }, [refreshSorts, refresh]);

  const handleUpdateSort = useCallback(async (sortId: string, updates: { fk_column_id?: string; direction?: string }) => {
    try {
      await br.updateSort(sortId, updates);
      refreshSorts();
      refresh();
    } catch (e) { showError(t('errors.updateSortFailed'), e); }
  }, [refreshSorts, refresh]);

  // ── Row operations ──
  const handleAddRow = useCallback(async () => {
    const tempId = `temp-${Date.now()}`;
    const tempRow: Record<string, unknown> = { Id: tempId };
    for (const col of displayCols) {
      if (!col.primary_key) tempRow[col.title] = null;
    }
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: { totalRows?: number } } | undefined;
      if (!data) return { list: [tempRow], pageInfo: { totalRows: 1 } };
      return {
        ...data,
        list: [...data.list, tempRow],
        pageInfo: { ...data.pageInfo, totalRows: (data.pageInfo?.totalRows || 0) + 1 },
      };
    });
    try {
      await br.insertRow(tableId, {});
      refresh();
    } catch (e) {
      showError(t('errors.addRowFailed'), e);
      queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
        const data = old as { list: Record<string, unknown>[]; pageInfo?: { totalRows?: number } } | undefined;
        if (!data) return old;
        return {
          ...data,
          list: data.list.filter(r => r.Id !== tempId),
          pageInfo: { ...data.pageInfo, totalRows: Math.max(0, (data.pageInfo?.totalRows || 1) - 1) },
        };
      });
    }
  }, [tableId, displayCols, queryClient, refresh]);

  const handleDeleteRow = useCallback(async (rowId: number) => {
    try {
      await br.deleteRow(tableId, rowId);
      refresh();
    } catch (e) {
      showError(t('errors.deleteRowFailed'), e);
    }
  }, [tableId, refresh]);

  // ── Cell editing ──
  const startEdit = useCallback((rowId: number, col: string, currentValue: unknown, colType: string) => {
    if (READONLY_TYPES.has(colType) || colType === 'Checkbox') return;
    const result: { rowId: number; col: string; editValue: string } = { rowId, col, editValue: '' };
    if ((colType === 'Date' || colType === 'DateTime') && currentValue) {
      const d = new Date(String(currentValue));
      if (!isNaN(d.getTime())) {
        const yy = String(d.getFullYear());
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        if (colType === 'Date') {
          result.editValue = `${yy}-${mo}-${dd}`;
        } else {
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          result.editValue = `${yy}-${mo}-${dd}T${hh}:${mm}`;
        }
        return result;
      }
    }
    result.editValue = currentValue == null ? '' : String(currentValue);
    return result;
  }, []);

  const saveEdit = useCallback(async (editingCell: { rowId: number; col: string } | null, editValue: string) => {
    if (!editingCell) return;
    const { rowId, col } = editingCell;
    const colDef = meta?.columns?.find(c => c.title === col);
    const colType = colDef?.type;
    let newVal: unknown = editValue;
    if (colType === 'Number' || colType === 'Decimal' || colType === 'AutoNumber' || colType === 'Duration') {
      newVal = editValue === '' ? null : Number(editValue);
      if (typeof newVal === 'number' && isNaN(newVal)) newVal = null;
    }
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      if (!old || typeof old !== 'object' || !('list' in (old as Record<string, unknown>))) return old;
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown };
      if (!Array.isArray(data.list)) return old;
      return {
        ...data,
        list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: newVal } : r),
      };
    });
    try {
      await br.updateRow(tableId, rowId, { [col]: newVal });
      refresh();
    } catch (e) {
      showError(t('errors.updateDataFailed'), e);
      refresh();
    }
  }, [meta?.columns, tableId, queryClient, refresh]);

  const toggleCheckbox = useCallback(async (rowId: number, col: string, current: unknown) => {
    const newVal = !current;
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
      if (!data) return old;
      return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: newVal } : r) };
    });
    try {
      await br.updateRow(tableId, rowId, { [col]: newVal });
    } catch (e) {
      showError(t('errors.toggleCheckboxFailed'), e);
      queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
        const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
        if (!data) return old;
        return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: current } : r) };
      });
    }
  }, [tableId, queryClient]);

  const ensureSelectOption = useCallback(async (colTitle: string, optionTitle: string) => {
    const colDef = meta?.columns?.find(c => c.title === colTitle);
    if (!colDef) return;
    const exists = colDef.options?.some(o => o.title === optionTitle);
    if (!exists) {
      const updatedOptions = [
        ...(colDef.options || []),
        { title: optionTitle, color: SELECT_COLORS[(colDef.options?.length || 0) % SELECT_COLORS.length] },
      ];
      await br.updateColumn(tableId, colDef.column_id, { options: updatedOptions });
    }
  }, [meta?.columns, tableId]);

  const setSelectValue = useCallback(async (rowId: number, col: string, value: string) => {
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
      if (!data) return old;
      return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: value } : r) };
    });
    try {
      if (value) await ensureSelectOption(col, value);
      await br.updateRow(tableId, rowId, { [col]: value });
      refreshMeta();
    } catch (e) {
      showError(t('errors.setOptionFailed'), e);
      refresh();
    }
  }, [tableId, queryClient, ensureSelectOption, refreshMeta, refresh]);

  const toggleMultiSelect = useCallback(async (rowId: number, col: string, current: unknown, option: string) => {
    const currentStr = current ? String(current) : '';
    const currentItems = currentStr ? currentStr.split(',').map(s => s.trim()) : [];
    const newItems = currentItems.includes(option)
      ? currentItems.filter(i => i !== option)
      : [...currentItems, option];
    const newValue = newItems.join(',');
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
      if (!data) return old;
      return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: newValue } : r) };
    });
    try {
      if (!currentItems.includes(option)) await ensureSelectOption(col, option);
      await br.updateRow(tableId, rowId, { [col]: newValue });
      refresh();
      refreshMeta();
    } catch (e) {
      showError(t('errors.toggleMultiSelectFailed'), e);
      refresh();
    }
  }, [tableId, queryClient, ensureSelectOption, refresh, refreshMeta]);

  const setRating = useCallback(async (rowId: number, col: string, value: number) => {
    try {
      queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
        const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
        if (!data) return old;
        return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: value } : r) };
      });
      await br.updateRow(tableId, rowId, { [col]: value });
      refresh();
    } catch (e) {
      showError(t('errors.setRatingFailed'), e);
      refresh();
    }
  }, [tableId, queryClient, refresh]);

  // ── Attachment upload ──
  const handleAttachmentUpload = useCallback(async (rowId: number, colTitle: string, files: FileList, existingRows: Record<string, unknown>[]) => {
    if (files.length === 0) return;
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('files', f));
      const uploadRes = await fetch('/api/gateway/data/upload', { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      const uploaded = await uploadRes.json();
      const row = existingRows.find(r => (r.Id as number) === rowId);
      let existing: unknown[] = [];
      if (row?.[colTitle]) {
        if (Array.isArray(row[colTitle])) {
          existing = row[colTitle] as unknown[];
        } else {
          try { existing = JSON.parse(String(row[colTitle])); } catch {}
        }
      }
      const merged = [...existing, ...uploaded];
      await br.updateRow(tableId, rowId, { [colTitle]: merged });
      refresh();
      return true;
    } catch (e) {
      showError(t('errors.uploadAttachmentFailed'), e);
      return false;
    }
  }, [tableId, refresh]);

  // ── Bulk operations ──
  const handleBulkDelete = useCallback(async (selectedRows: Set<number>) => {
    if (selectedRows.size === 0) return;
    try {
      for (const rowId of selectedRows) {
        await br.deleteRow(tableId, rowId);
      }
      refresh();
    } catch (e) {
      showError(t('errors.batchDeleteFailed'), e);
    }
  }, [tableId, refresh]);

  const handleBulkEdit = useCallback(async (selectedRows: Set<number>, col: string, val: string) => {
    if (selectedRows.size === 0 || !col) return;
    try {
      for (const rowId of selectedRows) {
        await br.updateRow(tableId, rowId, { [col]: val });
      }
      refresh();
    } catch (e) {
      showError(t('errors.batchEditFailed'), e);
    }
  }, [tableId, refresh]);

  // ── CSV Export ──
  const handleExportCSV = useCallback(async (tableMeta: typeof meta) => {
    try {
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      const batchSize = 200;
      while (true) {
        const batch = activeViewId
          ? await br.queryRowsByView(tableId, activeViewId, { limit: batchSize, offset })
          : await br.queryRows(tableId, { limit: batchSize, offset });
        allRows.push(...batch.list);
        if (allRows.length >= (batch.pageInfo?.totalRows || 0) || batch.list.length < batchSize) break;
        offset += batchSize;
      }
      const cols = displayCols;
      const escapeCSV = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = cols.map(c => escapeCSV(c.title)).join(',');
      const lines = allRows.map(row =>
        cols.map(c => escapeCSV(row[c.title])).join(',')
      );
      const csv = [header, ...lines].join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tableMeta?.title || 'table'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showError(t('errors.exportCSVFailed'), e);
    }
  }, [tableId, activeViewId, displayCols]);

  // ── Delete table ──
  const handleDeleteTable = useCallback(async (onDeleted?: () => void) => {
    try {
      await gw.deleteContentItem(`table:${tableId}`);
      onDeleted?.();
    } catch (e) {
      showError(t('errors.deleteTableFailed'), e);
    }
  }, [tableId]);

  return {
    // Queries
    meta,
    metaError,
    metaErrorDetail,
    views,
    viewFilters,
    viewSorts,
    viewColumns,
    rowsData,
    rows,
    isLoading,
    isFetching,
    commentedRowIds,
    agentsList,

    // Derived
    displayCols,
    editableCols,
    totalRows,
    totalPages,

    // Pagination
    page,
    setPage,
    pageSize,

    // Sort
    sortCol,
    setSortCol,
    sortDir,
    setSortDir,
    handleSort,

    // Active view
    activeViewId,
    setActiveViewId,

    // Refresh
    refresh,
    refreshMeta,
    refreshFilters,
    refreshSorts,
    refreshViewColumns,
    queryClient,

    // View handlers
    handleCreateView,
    handleRenameView,
    handleDeleteView,

    // Filter handlers
    handleAddFilter,
    handleDeleteFilter,
    handleUpdateFilter,

    // Sort handlers
    handleAddSort,
    handleColumnSort,
    handleDeleteSort,
    handleUpdateSort,

    // Row handlers
    handleAddRow,
    handleDeleteRow,

    // Cell editing
    startEdit,
    saveEdit,
    toggleCheckbox,
    setSelectValue,
    toggleMultiSelect,
    setRating,
    ensureSelectOption,

    // Attachment
    handleAttachmentUpload,

    // Bulk
    handleBulkDelete,
    handleBulkEdit,

    // CSV / Table ops
    handleExportCSV,
    handleDeleteTable,
  };
}
