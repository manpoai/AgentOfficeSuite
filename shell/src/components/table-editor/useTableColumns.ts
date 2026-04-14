/**
 * useTableColumns — column definitions, column type mapping, column operations.
 * Extracted from TableEditor.tsx during refactoring — no behavior changes.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as br from '@/lib/api/tables';
import { SELECT_COLORS, READONLY_TYPES, isSelectType } from './types';
import { showError } from '@/lib/utils/error';
import { getT } from '@/lib/i18n';

export function useTableColumns({
  tableId,
  activeViewId,
  displayCols,
  viewColumns,
  refreshMeta,
  refresh,
  refreshViewColumns,
  meta,
  t,
}: {
  tableId: string;
  activeViewId: string | null;
  displayCols: br.BRColumn[];
  viewColumns: br.BRViewColumn[] | undefined;
  refreshMeta: () => void;
  refresh: () => void;
  refreshViewColumns: () => void;
  meta: br.BRTableMeta | undefined;
  t: (key: string, opts?: any) => string;
}) {
  const queryClient = useQueryClient();

  // ── Hidden columns / widths ──
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  // ── Column menu state ──
  const [colMenu, setColMenu] = useState<string | null>(null);
  const [editingColTitle, setEditingColTitle] = useState<string | null>(null);
  const [colTitleValue, setColTitleValue] = useState('');

  // ── Add/Edit field dialog state ──
  const [showAddCol, setShowAddCol] = useState(false);
  const [editFieldColId, setEditFieldColId] = useState<string | null>(null);
  const [editFieldAnchor, setEditFieldAnchor] = useState<{ x: number; y: number } | null>(null);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [numFormat, setNumFormat] = useState<{ decimals: number; thousands: boolean; prefix: string; suffix: string }>({ decimals: 0, thousands: false, prefix: '', suffix: '' });
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [decimalPrecision, setDecimalPrecision] = useState(2);
  const [durationFormat, setDurationFormat] = useState(0);
  const [ratingMax, setRatingMax] = useState(5);
  const [ratingIcon, setRatingIcon] = useState('star');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [newColTitle, setNewColTitle] = useState('');
  const [newColType, setNewColType] = useState('SingleLineText');
  const [newColOptions, setNewColOptions] = useState('');
  const [newColOptionsList, setNewColOptionsList] = useState<string[]>([]);
  const [newColFormula, setNewColFormula] = useState('');
  const [newColRelTable, setNewColRelTable] = useState('');
  const [newColRelType, setNewColRelType] = useState('mm');
  const [newColRelMulti, setNewColRelMulti] = useState(true);
  const [newColRelBidirectional, setNewColRelBidirectional] = useState(true);
  const [newColRelCol, setNewColRelCol] = useState('');
  const [newColLookupCol, setNewColLookupCol] = useState('');
  const [newColRollupCol, setNewColRollupCol] = useState('');
  const [newColRollupFn, setNewColRollupFn] = useState('sum');
  const [newColUserNotify, setNewColUserNotify] = useState(false);

  // ── Insert column position ──
  const [insertColPosition, setInsertColPosition] = useState<{ afterColId: string } | null>(null);

  // ── Freeze columns ──
  const [frozenColCount, setFrozenColCountRaw] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`aose-table-frozen-${tableId}`);
      return saved ? parseInt(saved, 10) : 1;
    }
    return 1;
  });
  const setFrozenColCount = useCallback((v: number | ((prev: number) => number)) => {
    setFrozenColCountRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      localStorage.setItem(`aose-table-frozen-${tableId}`, String(next));
      return next;
    });
  }, [tableId]);

  // ── Sync hiddenCols and colWidths from view column settings ──
  useEffect(() => {
    if (!viewColumns) return;
    const hidden = new Set<string>();
    const widths: Record<string, number> = {};
    for (const vc of viewColumns) {
      if (!vc.show) hidden.add(vc.fk_column_id);
      if (vc.width) {
        const w = typeof vc.width === 'number' ? vc.width : parseInt(vc.width, 10);
        if (w > 0) widths[vc.fk_column_id] = w;
      }
    }
    setHiddenCols(hidden);
    setColWidths(widths);
  }, [viewColumns]);

  // ── Visible columns (sorted by view column order) ──
  const visibleCols = useMemo(() => {
    return displayCols.filter(c => !hiddenCols.has(c.column_id)).sort((a, b) => {
      if (a.primary_key && !b.primary_key) return -1;
      if (!a.primary_key && b.primary_key) return 1;
      if (!viewColumns) return 0;
      const aVc = viewColumns.find(vc => vc.fk_column_id === a.column_id);
      const bVc = viewColumns.find(vc => vc.fk_column_id === b.column_id);
      const aOrder = aVc?.order ?? 9999;
      const bOrder = bVc?.order ?? 9999;
      return aOrder - bOrder;
    });
  }, [displayCols, hiddenCols, viewColumns]);

  // ── Sorted display columns for field panel ──
  const sortedDisplayCols = useMemo(() => {
    return [...displayCols].sort((a, b) => {
      if (a.primary_key && !b.primary_key) return -1;
      if (!a.primary_key && b.primary_key) return 1;
      if (!viewColumns) return 0;
      const aVc = viewColumns.find((vc: { fk_column_id: string }) => vc.fk_column_id === a.column_id);
      const bVc = viewColumns.find((vc: { fk_column_id: string }) => vc.fk_column_id === b.column_id);
      const aOrder = aVc?.order ?? 9999;
      const bOrder = bVc?.order ?? 9999;
      return aOrder - bOrder;
    });
  }, [displayCols, viewColumns]);

  // ── Toggle column visibility ──
  const toggleColVisibility = useCallback((columnId: string, forceHide?: boolean) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      const shouldHide = forceHide !== undefined ? forceHide : !next.has(columnId);
      if (shouldHide) next.add(columnId);
      else next.delete(columnId);
      if (activeViewId) {
        br.updateViewColumn(activeViewId, columnId, { show: !shouldHide }).catch(() => {});
      }
      return next;
    });
  }, [activeViewId]);

  // ── Persist column width ──
  const persistColWidth = useCallback((columnId: string, width: number) => {
    if (activeViewId) {
      br.updateViewColumn(activeViewId, columnId, { width }).catch(() => {});
    }
  }, [activeViewId]);

  // ── Column resize ──
  const handleResizeStart = useCallback((colId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingCol(colId);
    resizeStartX.current = e.clientX;
    resizeStartW.current = colWidths[colId] || 180;
    let lastWidth = resizeStartW.current;
    const onMouseMove = (ev: MouseEvent) => {
      const diff = ev.clientX - resizeStartX.current;
      lastWidth = Math.max(60, resizeStartW.current + diff);
      setColWidths(prev => ({ ...prev, [colId]: lastWidth }));
    };
    const onMouseUp = () => {
      setResizingCol(null);
      persistColWidth(colId, lastWidth);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [colWidths, persistColWidth]);

  // ── Reset add col state ──
  const resetAddColState = useCallback(() => {
    setNewColTitle('');
    setNewColType('SingleLineText');
    setNewColOptions('');
    setNewColOptionsList([]);
    setNewColFormula('');
    setNewColRelTable('');
    setNewColRelType('mm');
    setNewColRelMulti(true);
    setNewColRelBidirectional(true);
    setNewColRelCol('');
    setNewColLookupCol('');
    setNewColRollupCol('');
    setNewColRollupFn('sum');
    setNumFormat({ decimals: 0, thousands: false, prefix: '', suffix: '' });
    setCurrencySymbol('$');
    setDecimalPrecision(2);
    setDurationFormat(0);
    setRatingMax(5);
    setRatingIcon('star');
    setDateFormat('YYYY-MM-DD');
    setNewColUserNotify(false);
    setShowAddCol(false);
    setShowTypeSelector(false);
    setEditFieldAnchor(null);
  }, []);

  // ── Add column ──
  const handleAddColumn = useCallback(async () => {
    const colTitle = newColTitle.trim() || t(`dataTable.colTypes.${newColType}`);
    if (!colTitle) return;
    try {
      const opts: Record<string, unknown> = {};
      if ((newColType === 'SingleSelect' || newColType === 'MultiSelect') && newColOptionsList.length > 0) {
        opts.options = newColOptionsList.filter(s => s.trim()).map((s, i) => ({
          title: s.trim(),
          color: SELECT_COLORS[i % SELECT_COLORS.length],
        }));
      }
      if (newColType === 'Formula' && newColFormula.trim()) {
        opts.formula_raw = newColFormula.trim();
      }
      if (newColType === 'Links' && newColRelTable) {
        opts.childId = newColRelTable;
        opts.relationType = newColRelMulti ? 'mm' : 'bt';
      }
      if (newColType === 'Lookup' && newColRelCol && newColLookupCol) {
        opts.fk_relation_column_id = newColRelCol;
        opts.fk_lookup_column_id = newColLookupCol;
      }
      if (newColType === 'Rollup' && newColRelCol && newColRollupCol) {
        opts.fk_relation_column_id = newColRelCol;
        opts.fk_rollup_column_id = newColRollupCol;
        opts.rollup_function = newColRollupFn;
      }
      if (newColType === 'Decimal') {
        opts.meta = { precision: decimalPrecision };
      }
      if (newColType === 'Currency') {
        opts.meta = { currency_code: currencySymbol };
      }
      if (newColType === 'Duration') {
        opts.meta = { duration: durationFormat };
      }
      if (newColType === 'Rating') {
        opts.meta = { max: ratingMax, iconIdx: ratingIcon };
      }
      if (newColType === 'Date' || newColType === 'DateTime') {
        opts.meta = { date_format: dateFormat };
      }
      if (newColType === 'User') {
        opts.meta = { ...(opts.meta as Record<string, unknown> || {}), notify: newColUserNotify };
      }
      const newCol = await br.addColumn(tableId, colTitle, newColType, opts);
      if (insertColPosition && activeViewId) {
        const existingVcIds = new Set((viewColumns || []).map(vc => vc.fk_column_id));
        const allCols = [...displayCols.map(c => c.column_id), newCol.column_id];
        for (let i = 0; i < allCols.length; i++) {
          if (!existingVcIds.has(allCols[i])) {
            await br.updateViewColumn(activeViewId, allCols[i], { order: (i + 1) * 10 });
          }
        }
        const freshVc = await br.listViewColumns(activeViewId);
        if (insertColPosition.afterColId === '__first__') {
          await br.updateViewColumn(activeViewId, newCol.column_id, { order: 0 });
          for (const vc of freshVc) {
            if (vc.fk_column_id !== newCol.column_id) {
              await br.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
            }
          }
        } else {
          const afterViewCol = freshVc.find(vc => vc.fk_column_id === insertColPosition.afterColId);
          const afterOrder = afterViewCol?.order ?? 0;
          await br.updateViewColumn(activeViewId, newCol.column_id, { order: afterOrder + 1 });
          for (const vc of freshVc) {
            if (vc.fk_column_id !== newCol.column_id && (vc.order ?? 0) > afterOrder) {
              await br.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
            }
          }
        }
        refreshViewColumns();
      }
      setInsertColPosition(null);
      resetAddColState();
      refreshMeta();
      refresh();
    } catch (e) {
      showError(getT()('errors.addColumnFailed'), e);
    }
  }, [newColTitle, newColType, newColOptionsList, newColFormula, newColRelTable, newColRelMulti,
      newColRelCol, newColLookupCol, newColRollupCol, newColRollupFn, decimalPrecision,
      currencySymbol, durationFormat, ratingMax, ratingIcon, dateFormat, newColUserNotify,
      insertColPosition, activeViewId, viewColumns, displayCols, tableId, t,
      resetAddColState, refreshMeta, refresh, refreshViewColumns]);

  // ── Rename column ──
  const handleRenameColumn = useCallback(async (columnId: string) => {
    if (!colTitleValue.trim()) return;
    try {
      await br.updateColumn(tableId, columnId, { title: colTitleValue.trim() });
      setEditingColTitle(null);
      refreshMeta();
      refresh();
    } catch (e) {
      showError(getT()('errors.renameColumnFailed'), e);
    }
  }, [colTitleValue, tableId, refreshMeta, refresh]);

  // ── Change column type ──
  const handleChangeColumnType = useCallback(async (columnId: string, newType: string) => {
    try {
      await br.updateColumn(tableId, columnId, { uidt: newType });
      setColMenu(null);
      refreshMeta();
      refresh();
    } catch (e) {
      showError(getT()('errors.changeColumnTypeFailed'), e);
    }
  }, [tableId, refreshMeta, refresh]);

  // ── Delete column ──
  const handleDeleteColumn = useCallback(async (columnId: string) => {
    const col = displayCols.find(c => c.column_id === columnId);
    const colTitle = col?.title || columnId;
    if (!window.confirm(t('dataTable.deleteFieldConfirm', { name: colTitle }))) return;
    try {
      await br.deleteColumn(tableId, columnId);
      setColMenu(null);
      refreshMeta();
      refresh();
    } catch (e) {
      showError(getT()('errors.deleteColumnFailed'), e);
    }
  }, [displayCols, tableId, t, refreshMeta, refresh]);

  // ── Duplicate column ──
  const handleDuplicateColumn = useCallback(async (col: br.BRColumn) => {
    setColMenu(null);
    try {
      const opts: Record<string, unknown> = {};
      if ((col.type === 'SingleSelect' || col.type === 'MultiSelect') && col.options?.length) {
        opts.options = col.options.map((o, i) => ({ title: o.title, color: o.color || SELECT_COLORS[i % SELECT_COLORS.length] }));
      }
      const newCol = await br.addColumn(tableId, `${col.title} (copy)`, col.type, opts);
      if (activeViewId) {
        const existingVcIds = new Set((viewColumns || []).map(vc => vc.fk_column_id));
        const allCols = [...displayCols.map(c => c.column_id), newCol.column_id];
        for (let i = 0; i < allCols.length; i++) {
          if (!existingVcIds.has(allCols[i])) {
            await br.updateViewColumn(activeViewId, allCols[i], { order: (i + 1) * 10 });
          }
        }
        const freshVc = await br.listViewColumns(activeViewId);
        const srcViewCol = freshVc.find(vc => vc.fk_column_id === col.column_id);
        const srcOrder = srcViewCol?.order ?? 0;
        await br.updateViewColumn(activeViewId, newCol.column_id, { order: srcOrder + 1 });
        for (const vc of freshVc) {
          if (vc.fk_column_id !== col.column_id && vc.fk_column_id !== newCol.column_id && (vc.order ?? 0) > srcOrder) {
            await br.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
          }
        }
        refreshViewColumns();
      }
      refreshMeta();
      refresh();
    } catch (e) {
      showError(getT()('errors.duplicateColumnFailed'), e);
    }
  }, [tableId, activeViewId, viewColumns, displayCols, refreshMeta, refresh, refreshViewColumns]);

  // ── Insert column left/right ──
  const handleInsertColumn = useCallback((position: 'left' | 'right', col: br.BRColumn) => {
    setColMenu(null);
    if (position === 'left') {
      const idx = visibleCols.findIndex(c => c.column_id === col.column_id);
      if (idx > 0) {
        setInsertColPosition({ afterColId: visibleCols[idx - 1].column_id });
      } else {
        setInsertColPosition({ afterColId: '__first__' });
      }
    } else {
      setInsertColPosition({ afterColId: col.column_id });
    }
    // Open add field
    resetAddColState();
    setEditFieldColId(null);
    setShowAddCol(true);
  }, [visibleCols, resetAddColState]);

  // ── Open edit field dialog ──
  const openEditField = useCallback((col: br.BRColumn, anchorEl?: HTMLElement | null) => {
    setColMenu(null);
    setEditFieldColId(col.column_id);
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setEditFieldAnchor({ x: Math.min(rect.left, window.innerWidth - 400), y: rect.bottom + 8 });
    } else {
      const headerEl = document.querySelector(`[data-col-id="${col.column_id}"]`) as HTMLElement | null;
      if (headerEl) {
        const rect = headerEl.getBoundingClientRect();
        setEditFieldAnchor({ x: Math.min(rect.left, window.innerWidth - 400), y: rect.bottom + 8 });
      } else {
        setEditFieldAnchor(null);
      }
    }
    setNewColTitle(col.title);
    setNewColType(col.type);
    setNewColOptions(col.options?.map(o => o.title).join(', ') || '');
    setNewColOptionsList(col.options?.map(o => o.title) || []);
    setNewColRelTable(col.relatedTableId || '');
    setNewColRelType(col.relationType || 'mm');
    setNewColRelMulti(col.relationType !== 'bt');
    setNewColRelBidirectional(true);
    if (col.meta) {
      const m = col.meta as Record<string, unknown>;
      setNumFormat({
        decimals: (m.decimals as number) ?? 0,
        thousands: !!m.thousands,
        prefix: (m.prefix as string) || '',
        suffix: (m.suffix as string) || '',
      });
      if (m.iconIdx !== undefined) setRatingIcon(String(m.iconIdx));
      if (m.currency_code) setCurrencySymbol(String(m.currency_code));
      if (m.precision !== undefined) setDecimalPrecision(m.precision as number);
      if (m.duration !== undefined) setDurationFormat(m.duration as number);
    }
    if (col.type === 'Rating' && col.meta) {
      setRatingMax((col.meta as any).max || 5);
    }
    if ((col.type === 'Date' || col.type === 'DateTime') && col.meta) {
      setDateFormat((col.meta as any).date_format || 'YYYY-MM-DD');
    }
    if ((col.type === 'User' || col.type === 'Collaborator') && col.meta) {
      setNewColUserNotify(!!(col.meta as any).notify);
    }
    setShowAddCol(true);
  }, []);

  // ── Open add field ──
  const openAddField = useCallback(() => {
    resetAddColState();
    setEditFieldColId(null);
    setShowAddCol(true);
  }, [resetAddColState]);

  // ── Save field (add or edit) ──
  const handleSaveField = useCallback(async () => {
    const effectiveTitle = newColTitle.trim() || t(`dataTable.colTypes.${newColType}`);
    if (!effectiveTitle) return;
    if (editFieldColId) {
      try {
        const updates: Record<string, unknown> = { title: effectiveTitle, uidt: newColType };
        if (isSelectType(newColType) && newColOptionsList.length > 0) {
          updates.options = newColOptionsList.filter(s => s.trim()).map((s, i) => ({
            title: s.trim(),
            color: SELECT_COLORS[i % SELECT_COLORS.length],
          }));
        }
        if (newColType === 'Decimal') {
          updates.meta = JSON.stringify({ precision: decimalPrecision });
        }
        if (newColType === 'Currency') {
          updates.meta = JSON.stringify({ currency_code: currencySymbol });
        }
        if (newColType === 'Duration') {
          updates.meta = JSON.stringify({ duration: durationFormat });
        }
        if (newColType === 'Rating') {
          updates.meta = JSON.stringify({ max: ratingMax, iconIdx: ratingIcon });
        }
        if (newColType === 'Date' || newColType === 'DateTime') {
          updates.meta = JSON.stringify({ date_format: dateFormat });
        }
        if (newColType === 'User') {
          updates.meta = JSON.stringify({ notify: newColUserNotify });
        }
        await br.updateColumn(tableId, editFieldColId, updates);
        resetAddColState();
        setEditFieldColId(null);
        refreshMeta();
        refresh();
      } catch (e) {
        showError(getT()('errors.updateFieldFailed'), e);
      }
    } else {
      await handleAddColumn();
    }
  }, [newColTitle, newColType, newColOptionsList, decimalPrecision, currencySymbol, durationFormat,
      ratingMax, ratingIcon, dateFormat, newColUserNotify, editFieldColId, tableId, t,
      resetAddColState, refreshMeta, refresh, handleAddColumn]);

  return {
    // Visibility / width
    hiddenCols,
    setHiddenCols,
    colWidths,
    setColWidths,
    resizingCol,
    visibleCols,
    sortedDisplayCols,
    toggleColVisibility,
    persistColWidth,
    handleResizeStart,

    // Frozen columns
    frozenColCount,
    setFrozenColCount,

    // Column menu
    colMenu,
    setColMenu,
    editingColTitle,
    setEditingColTitle,
    colTitleValue,
    setColTitleValue,

    // Add/Edit field dialog
    showAddCol,
    setShowAddCol,
    editFieldColId,
    setEditFieldColId,
    editFieldAnchor,
    setEditFieldAnchor,
    showTypeSelector,
    setShowTypeSelector,
    numFormat,
    setNumFormat,
    currencySymbol,
    setCurrencySymbol,
    decimalPrecision,
    setDecimalPrecision,
    durationFormat,
    setDurationFormat,
    ratingMax,
    setRatingMax,
    ratingIcon,
    setRatingIcon,
    dateFormat,
    setDateFormat,
    newColTitle,
    setNewColTitle,
    newColType,
    setNewColType,
    newColOptions,
    setNewColOptions,
    newColOptionsList,
    setNewColOptionsList,
    newColFormula,
    setNewColFormula,
    newColRelTable,
    setNewColRelTable,
    newColRelType,
    setNewColRelType,
    newColRelMulti,
    setNewColRelMulti,
    newColRelBidirectional,
    setNewColRelBidirectional,
    newColRelCol,
    setNewColRelCol,
    newColLookupCol,
    setNewColLookupCol,
    newColRollupCol,
    setNewColRollupCol,
    newColRollupFn,
    setNewColRollupFn,
    newColUserNotify,
    setNewColUserNotify,
    insertColPosition,
    setInsertColPosition,

    // Actions
    resetAddColState,
    handleAddColumn,
    handleRenameColumn,
    handleChangeColumnType,
    handleDeleteColumn,
    handleDuplicateColumn,
    handleInsertColumn,
    openEditField,
    openAddField,
    handleSaveField,
  };
}
