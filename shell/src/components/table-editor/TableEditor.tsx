'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown,
  ArrowLeft, Table2, MoreHorizontal, Type, Hash, Calendar, CheckSquare,
  Link, Mail, AlignLeft, Pencil, Star, Phone, Clock, DollarSign,
  Percent, List, Tags, Braces, Paperclip, User, Sigma, Link2, Search, GitBranch,
  LayoutGrid, Filter, ArrowUpDown, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as nc from '@/lib/api/nocodb';

// ── Column type config ──

interface ColTypeDef {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'text' | 'number' | 'datetime' | 'select' | 'relation' | 'other';
}

const COLUMN_TYPES: ColTypeDef[] = [
  // Text
  { value: 'SingleLineText', label: '单行文本', icon: Type, group: 'text' },
  { value: 'LongText', label: '长文本', icon: AlignLeft, group: 'text' },
  { value: 'Email', label: '邮箱', icon: Mail, group: 'text' },
  { value: 'URL', label: '网址', icon: Link, group: 'text' },
  { value: 'PhoneNumber', label: '电话号码', icon: Phone, group: 'text' },
  // Number
  { value: 'Number', label: '整数', icon: Hash, group: 'number' },
  { value: 'Decimal', label: '小数', icon: Hash, group: 'number' },
  { value: 'Currency', label: '货币', icon: DollarSign, group: 'number' },
  { value: 'Percent', label: '百分比', icon: Percent, group: 'number' },
  { value: 'Rating', label: '评分', icon: Star, group: 'number' },
  // Date & Time
  { value: 'Date', label: '日期', icon: Calendar, group: 'datetime' },
  { value: 'DateTime', label: '日期时间', icon: Calendar, group: 'datetime' },
  { value: 'Time', label: '时间', icon: Clock, group: 'datetime' },
  { value: 'Year', label: '年份', icon: Calendar, group: 'datetime' },
  // Selection
  { value: 'Checkbox', label: '复选框', icon: CheckSquare, group: 'select' },
  { value: 'SingleSelect', label: '单选', icon: List, group: 'select' },
  { value: 'MultiSelect', label: '多选', icon: Tags, group: 'select' },
  // Relation & Computed
  { value: 'Links', label: '关联', icon: Link2, group: 'relation' },
  { value: 'Lookup', label: '查找', icon: Search, group: 'relation' },
  { value: 'Rollup', label: '汇总', icon: Sigma, group: 'relation' },
  { value: 'Formula', label: '公式', icon: GitBranch, group: 'relation' },
  // Other
  { value: 'Attachment', label: '附件', icon: Paperclip, group: 'other' },
  { value: 'JSON', label: 'JSON', icon: Braces, group: 'other' },
  { value: 'User', label: '用户', icon: User, group: 'other' },
];

const GROUP_LABELS: Record<string, string> = {
  text: '文本', number: '数字', datetime: '日期时间', select: '选择', relation: '关联与计算', other: '其他',
};

function getColIcon(uidt: string) {
  return COLUMN_TYPES.find(c => c.value === uidt)?.icon || Type;
}

// ── Select option colors ──

const SELECT_COLORS = [
  '#d4e5ff', '#d1f0e0', '#fde2cc', '#fdd8d8', '#e8d5f5',
  '#d5e8f5', '#fff3bf', '#f0d5e8', '#d5f5e8', '#e8e8d5',
];

function getOptionColor(color?: string, idx?: number) {
  if (color) return color;
  return SELECT_COLORS[(idx || 0) % SELECT_COLORS.length];
}

// ── Read-only column types ──
const READONLY_TYPES = new Set(['ID', 'AutoNumber', 'CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'Formula', 'Rollup', 'Lookup', 'Count', 'Links']);

// ── Filter operators ──
const FILTER_OPS = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'like', label: '包含' },
  { value: 'nlike', label: '不包含' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'is', label: '为空' },
  { value: 'isnot', label: '不为空' },
];

// ── Main component ──

interface TableEditorProps {
  tableId: string;
  onBack: () => void;
  onDeleted?: () => void;
}

export function TableEditor({ tableId, onBack, onDeleted }: TableEditorProps) {
  const [page, setPage] = useState(1);
  const [editingCell, setEditingCell] = useState<{ rowId: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [colMenu, setColMenu] = useState<string | null>(null);
  const [editingColTitle, setEditingColTitle] = useState<string | null>(null);
  const [colTitleValue, setColTitleValue] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColTitle, setNewColTitle] = useState('');
  const [newColType, setNewColType] = useState('SingleLineText');
  const [newColOptions, setNewColOptions] = useState('');
  const [newColFormula, setNewColFormula] = useState('');
  const [newColRelTable, setNewColRelTable] = useState('');
  const [newColRelType, setNewColRelType] = useState('mm');
  const [newColRelCol, setNewColRelCol] = useState(''); // for lookup/rollup: relation column id
  const [newColLookupCol, setNewColLookupCol] = useState(''); // for lookup: field id in related table
  const [newColRollupCol, setNewColRollupCol] = useState(''); // for rollup: field id in related table
  const [newColRollupFn, setNewColRollupFn] = useState('sum');
  const [editingTableTitle, setEditingTableTitle] = useState(false);
  const [tableTitleValue, setTableTitleValue] = useState('');
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [selectDropdown, setSelectDropdown] = useState<{ rowId: number; col: string; options: nc.NCSelectOption[]; multi: boolean } | null>(null);
  // View state
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewMenu, setViewMenu] = useState<string | null>(null);
  const [editingViewTitle, setEditingViewTitle] = useState<string | null>(null);
  const [viewTitleValue, setViewTitleValue] = useState('');
  const [showCreateView, setShowCreateView] = useState(false);
  const [newViewTitle, setNewViewTitle] = useState('');
  // Filter & Sort state
  const [showFilters, setShowFilters] = useState(false);
  const [showSorts, setShowSorts] = useState(false);
  const [newFilterCol, setNewFilterCol] = useState('');
  const [newFilterOp, setNewFilterOp] = useState('eq');
  const [newFilterVal, setNewFilterVal] = useState('');
  const [newSortCol, setNewSortCol] = useState('');
  const [newSortDir, setNewSortDir] = useState<'asc' | 'desc'>('asc');
  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const colTitleRef = useRef<HTMLInputElement>(null);
  const newColRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const pageSize = 50;

  const sortParam = sortCol ? (sortDir === 'desc' ? `-${sortCol}` : sortCol) : undefined;

  const { data: meta } = useQuery({
    queryKey: ['nc-table-meta', tableId],
    queryFn: () => nc.describeTable(tableId),
  });

  // Set active view to default when meta loads
  useEffect(() => {
    if (meta?.views?.length && !activeViewId) {
      const defaultView = meta.views.find(v => v.is_default) || meta.views[0];
      setActiveViewId(defaultView.view_id);
    }
  }, [meta?.views, activeViewId]);

  const views = meta?.views || [];

  const { data: rowsData, isLoading } = useQuery({
    queryKey: ['nc-rows', tableId, activeViewId, page, sortParam],
    queryFn: () => activeViewId
      ? nc.queryRowsByView(tableId, activeViewId, { limit: pageSize, offset: (page - 1) * pageSize, sort: sortParam })
      : nc.queryRows(tableId, { limit: pageSize, offset: (page - 1) * pageSize, sort: sortParam }),
    enabled: !!meta,
  });

  // View filters
  const { data: viewFilters } = useQuery({
    queryKey: ['nc-view-filters', activeViewId],
    queryFn: () => nc.listFilters(activeViewId!),
    enabled: !!activeViewId,
  });

  // View sorts
  const { data: viewSorts } = useQuery({
    queryKey: ['nc-view-sorts', activeViewId],
    queryFn: () => nc.listSorts(activeViewId!),
    enabled: !!activeViewId,
  });

  // All tables (for Links creation)
  const { data: allTables } = useQuery({
    queryKey: ['nc-tables'],
    queryFn: nc.listTables,
    enabled: showAddCol,
  });

  // Related table meta (for Lookup/Rollup field picker)
  const relatedTableId = newColRelTable || (() => {
    // Find the related table from the selected relation column
    if (newColRelCol && meta?.columns) {
      const relCol = meta.columns.find(c => c.column_id === newColRelCol);
      return relCol?.relatedTableId || '';
    }
    return '';
  })();

  const { data: relatedMeta } = useQuery({
    queryKey: ['nc-table-meta', relatedTableId],
    queryFn: () => nc.describeTable(relatedTableId),
    enabled: !!relatedTableId && (newColType === 'Lookup' || newColType === 'Rollup'),
  });

  const displayCols = (meta?.columns || []).filter(c => c.title !== 'created_by');
  const editableCols = displayCols.filter(c => !c.primary_key && !READONLY_TYPES.has(c.type));
  const rows = rowsData?.list || [];
  const totalRows = rowsData?.pageInfo?.totalRows || 0;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['nc-rows', tableId] });
  const refreshMeta = () => queryClient.invalidateQueries({ queryKey: ['nc-table-meta', tableId] });
  const refreshFilters = () => queryClient.invalidateQueries({ queryKey: ['nc-view-filters', activeViewId] });
  const refreshSorts = () => queryClient.invalidateQueries({ queryKey: ['nc-view-sorts', activeViewId] });

  // ── View handlers ──
  const handleCreateView = async () => {
    if (!newViewTitle.trim()) return;
    try {
      const view = await nc.createView(tableId, newViewTitle.trim());
      setNewViewTitle('');
      setShowCreateView(false);
      refreshMeta();
      setActiveViewId(view.view_id);
    } catch {}
  };

  const handleRenameView = async (viewId: string) => {
    if (!viewTitleValue.trim()) { setEditingViewTitle(null); return; }
    try {
      await nc.renameView(viewId, viewTitleValue.trim());
      refreshMeta();
    } catch {}
    setEditingViewTitle(null);
  };

  const handleDeleteView = async (viewId: string) => {
    try {
      await nc.deleteView(viewId);
      refreshMeta();
      if (activeViewId === viewId) setActiveViewId(null);
    } catch {}
    setViewMenu(null);
  };

  const handleAddFilter = async () => {
    if (!activeViewId || !newFilterCol) return;
    try {
      await nc.createFilter(activeViewId, { fk_column_id: newFilterCol, comparison_op: newFilterOp, value: newFilterVal });
      refreshFilters();
      refresh();
      setNewFilterCol('');
      setNewFilterVal('');
    } catch {}
  };

  const handleDeleteFilter = async (filterId: string) => {
    try {
      await nc.deleteFilter(filterId);
      refreshFilters();
      refresh();
    } catch {}
  };

  const handleAddSort = async () => {
    if (!activeViewId || !newSortCol) return;
    try {
      await nc.createSort(activeViewId, { fk_column_id: newSortCol, direction: newSortDir });
      refreshSorts();
      refresh();
      setNewSortCol('');
    } catch {}
  };

  const handleDeleteSort = async (sortId: string) => {
    try {
      await nc.deleteSort(sortId);
      refreshSorts();
      refresh();
    } catch {}
  };

  // ── Sort ──
  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  // ── Cell editing ──
  const startEdit = useCallback((rowId: number, col: string, currentValue: unknown, colType: string) => {
    if (READONLY_TYPES.has(colType) || colType === 'Checkbox') return;
    setEditingCell({ rowId, col });
    setEditValue(currentValue == null ? '' : String(currentValue));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingCell) return;
    setSaving(true);
    try {
      await nc.updateRow(tableId, editingCell.rowId, { [editingCell.col]: editValue });
      refresh();
    } catch (e) {
      console.error('Update failed:', e);
    } finally {
      setSaving(false);
      setEditingCell(null);
    }
  }, [editingCell, editValue, tableId]);

  const toggleCheckbox = async (rowId: number, col: string, current: unknown) => {
    try {
      await nc.updateRow(tableId, rowId, { [col]: !current });
      refresh();
    } catch (e) {
      console.error('Toggle failed:', e);
    }
  };

  const setSelectValue = async (rowId: number, col: string, value: string) => {
    try {
      await nc.updateRow(tableId, rowId, { [col]: value });
      refresh();
    } catch (e) {
      console.error('Set select failed:', e);
    }
    setSelectDropdown(null);
  };

  const toggleMultiSelect = async (rowId: number, col: string, current: unknown, option: string) => {
    const currentStr = current ? String(current) : '';
    const currentItems = currentStr ? currentStr.split(',').map(s => s.trim()) : [];
    const newItems = currentItems.includes(option)
      ? currentItems.filter(i => i !== option)
      : [...currentItems, option];
    try {
      await nc.updateRow(tableId, rowId, { [col]: newItems.join(',') });
      refresh();
    } catch (e) {
      console.error('Toggle multi-select failed:', e);
    }
  };

  const setRating = async (rowId: number, col: string, value: number) => {
    try {
      await nc.updateRow(tableId, rowId, { [col]: value });
      refresh();
    } catch (e) {
      console.error('Set rating failed:', e);
    }
  };

  // Focus edit input
  useEffect(() => {
    if (editingCell && editInputRef.current) editInputRef.current.focus();
  }, [editingCell]);

  // ── Row operations ──
  const handleAddRow = async () => {
    try {
      await nc.insertRow(tableId, {});
      refresh();
    } catch (e) {
      console.error('Insert failed:', e);
    }
  };

  const handleDeleteRow = async (rowId: number) => {
    try {
      await nc.deleteRow(tableId, rowId);
      refresh();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  // ── Column operations ──
  const resetAddColState = () => {
    setNewColTitle('');
    setNewColType('SingleLineText');
    setNewColOptions('');
    setNewColFormula('');
    setNewColRelTable('');
    setNewColRelType('mm');
    setNewColRelCol('');
    setNewColLookupCol('');
    setNewColRollupCol('');
    setNewColRollupFn('sum');
    setShowAddCol(false);
  };

  const handleAddColumn = async () => {
    if (!newColTitle.trim()) return;
    try {
      const opts: Record<string, unknown> = {};
      if ((newColType === 'SingleSelect' || newColType === 'MultiSelect') && newColOptions.trim()) {
        opts.options = newColOptions.split(',').map((s, i) => ({
          title: s.trim(),
          color: SELECT_COLORS[i % SELECT_COLORS.length],
        }));
      }
      if (newColType === 'Formula' && newColFormula.trim()) {
        opts.formula_raw = newColFormula.trim();
      }
      if (newColType === 'Links' && newColRelTable) {
        opts.childId = newColRelTable;
        opts.relationType = newColRelType;
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
      await nc.addColumn(tableId, newColTitle.trim(), newColType, opts);
      resetAddColState();
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Add column failed:', e);
    }
  };

  const handleRenameColumn = async (columnId: string) => {
    if (!colTitleValue.trim()) return;
    try {
      await nc.updateColumn(tableId, columnId, { title: colTitleValue.trim() });
      setEditingColTitle(null);
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Rename column failed:', e);
    }
  };

  const handleChangeColumnType = async (columnId: string, newType: string) => {
    try {
      await nc.updateColumn(tableId, columnId, { uidt: newType });
      setColMenu(null);
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Change column type failed:', e);
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    try {
      await nc.deleteColumn(tableId, columnId);
      setColMenu(null);
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Delete column failed:', e);
    }
  };

  // ── Table operations ──
  const handleRenameTable = async () => {
    if (!tableTitleValue.trim()) return;
    try {
      await nc.renameTable(tableId, tableTitleValue.trim());
      setEditingTableTitle(false);
      refreshMeta();
      queryClient.invalidateQueries({ queryKey: ['nc-tables'] });
    } catch (e) {
      console.error('Rename table failed:', e);
    }
  };

  const handleDeleteTable = async () => {
    if (!confirm('确定删除此数据表？所有数据将丢失。')) return;
    try {
      await nc.deleteTable(tableId);
      queryClient.invalidateQueries({ queryKey: ['nc-tables'] });
      onDeleted?.();
    } catch (e) {
      console.error('Delete table failed:', e);
    }
  };

  // ── Keyboard navigation ──
  const handleCellKeyDown = (e: React.KeyboardEvent, rowIdx: number, col: nc.NCColumn) => {
    if (e.key === 'Escape') { setEditingCell(null); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
      const nextRowIdx = rowIdx + 1;
      if (nextRowIdx < rows.length) {
        const nextRow = rows[nextRowIdx];
        const nextRowId = nextRow.Id as number;
        setTimeout(() => startEdit(nextRowId, col.title, nextRow[col.title], col.type), 50);
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      saveEdit();
      const curColIdx = editableCols.findIndex(c => c.title === col.title);
      const nextColIdx = e.shiftKey ? curColIdx - 1 : curColIdx + 1;
      if (nextColIdx >= 0 && nextColIdx < editableCols.length) {
        const nextCol = editableCols[nextColIdx];
        const rowId = editingCell!.rowId;
        const row = rows.find(r => (r.Id as number) === rowId);
        if (row) setTimeout(() => startEdit(rowId, nextCol.title, row[nextCol.title], nextCol.type), 50);
      }
    }
  };

  useEffect(() => {
    if (showAddCol && newColRef.current) newColRef.current.focus();
  }, [showAddCol]);

  useEffect(() => {
    if (editingColTitle && colTitleRef.current) colTitleRef.current.focus();
  }, [editingColTitle]);

  // ── Get input type for cell editing ──
  const getInputType = (colType: string) => {
    switch (colType) {
      case 'Number': case 'Decimal': case 'Currency': case 'Percent': case 'Rating': case 'Year': return 'number';
      case 'Date': return 'date';
      case 'DateTime': return 'datetime-local';
      case 'Time': return 'time';
      case 'Email': return 'email';
      case 'URL': return 'url';
      case 'PhoneNumber': return 'tel';
      default: return 'text';
    }
  };

  // ── Check if cell needs special editor ──
  const isSelectType = (type: string) => type === 'SingleSelect' || type === 'MultiSelect';

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
        <button onClick={onBack} className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Table2 className="h-4 w-4 text-green-400/70 shrink-0" />
        {editingTableTitle ? (
          <input
            value={tableTitleValue}
            onChange={e => setTableTitleValue(e.target.value)}
            onBlur={handleRenameTable}
            onKeyDown={e => { if (e.key === 'Enter') handleRenameTable(); if (e.key === 'Escape') setEditingTableTitle(false); }}
            className="text-sm font-semibold bg-transparent text-foreground outline-none border-b border-sidebar-primary flex-1"
            autoFocus
          />
        ) : (
          <h2
            className="text-sm font-semibold text-foreground truncate flex-1 cursor-pointer hover:text-sidebar-primary"
            onDoubleClick={() => { setEditingTableTitle(true); setTableTitleValue(meta?.title || ''); }}
          >
            {meta?.title || '加载中...'}
          </h2>
        )}
        <span className="text-xs text-muted-foreground">{totalRows} 行</span>
        <div className="relative">
          <button onClick={() => setShowTableMenu(v => !v)} className="p-1.5 text-muted-foreground hover:text-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {showTableMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowTableMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-40">
                <button
                  onClick={() => { setShowTableMenu(false); setEditingTableTitle(true); setTableTitleValue(meta?.title || ''); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                >
                  <Pencil className="h-3.5 w-3.5" /> 重命名
                </button>
                <div className="border-t border-border my-1" />
                <button
                  onClick={() => { setShowTableMenu(false); handleDeleteTable(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 删除表格
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* View tabs bar */}
      <div className="flex items-center gap-0 px-2 border-b border-border bg-card/50 shrink-0 overflow-x-auto">
        {views.map(v => (
          <div key={v.view_id} className="relative flex items-center">
            {editingViewTitle === v.view_id ? (
              <input
                value={viewTitleValue}
                onChange={e => setViewTitleValue(e.target.value)}
                onBlur={() => handleRenameView(v.view_id)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameView(v.view_id); if (e.key === 'Escape') setEditingViewTitle(null); }}
                className="px-2 py-1 text-xs bg-transparent text-foreground outline-none border-b border-sidebar-primary"
                autoFocus
              />
            ) : (
              <button
                onClick={() => { setActiveViewId(v.view_id); setPage(1); }}
                onDoubleClick={() => { if (!v.is_default) { setEditingViewTitle(v.view_id); setViewTitleValue(v.title); } }}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap transition-colors border-b-2',
                  activeViewId === v.view_id
                    ? 'border-sidebar-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <LayoutGrid className="h-3 w-3" />
                {v.title}
              </button>
            )}
            {!v.is_default && activeViewId === v.view_id && (
              <div className="relative">
                <button
                  onClick={() => setViewMenu(viewMenu === v.view_id ? null : v.view_id)}
                  className="p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
                {viewMenu === v.view_id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setViewMenu(null)} />
                    <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-32">
                      <button
                        onClick={() => { setViewMenu(null); setEditingViewTitle(v.view_id); setViewTitleValue(v.title); }}
                        className="w-full flex items-center gap-2 px-3 py-1 text-xs text-foreground hover:bg-accent"
                      >
                        <Pencil className="h-3 w-3" /> 重命名
                      </button>
                      <button
                        onClick={() => handleDeleteView(v.view_id)}
                        className="w-full flex items-center gap-2 px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" /> 删除视图
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {showCreateView ? (
          <div className="flex items-center gap-1 ml-1">
            <input
              value={newViewTitle}
              onChange={e => setNewViewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateView(); if (e.key === 'Escape') { setShowCreateView(false); setNewViewTitle(''); } }}
              placeholder="视图名称"
              className="px-2 py-1 text-xs bg-muted rounded text-foreground placeholder:text-muted-foreground outline-none w-28"
              autoFocus
            />
            <button onClick={handleCreateView} className="p-0.5 text-sidebar-primary hover:opacity-80"><Plus className="h-3.5 w-3.5" /></button>
            <button onClick={() => { setShowCreateView(false); setNewViewTitle(''); }} className="p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => setShowCreateView(true)} className="ml-1 p-1 text-muted-foreground hover:text-foreground" title="添加视图">
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex-1" />
        {/* Filter & Sort toolbar */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowFilters(v => !v); setShowSorts(false); }}
            className={cn('flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
              (viewFilters?.length || showFilters) ? 'text-sidebar-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Filter className="h-3 w-3" />
            筛选{viewFilters?.length ? ` (${viewFilters.length})` : ''}
          </button>
          <button
            onClick={() => { setShowSorts(v => !v); setShowFilters(false); }}
            className={cn('flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
              (viewSorts?.length || showSorts) ? 'text-sidebar-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ArrowUpDown className="h-3 w-3" />
            排序{viewSorts?.length ? ` (${viewSorts.length})` : ''}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && activeViewId && (
        <div className="px-4 py-2 border-b border-border bg-card/30 space-y-2 shrink-0">
          {viewFilters?.map(f => {
            const col = displayCols.find(c => c.column_id === f.fk_column_id);
            return (
              <div key={f.filter_id} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{col?.title || f.fk_column_id}</span>
                <span className="text-sidebar-primary">{FILTER_OPS.find(o => o.value === f.comparison_op)?.label || f.comparison_op}</span>
                <span className="text-foreground">{f.value}</span>
                <button onClick={() => handleDeleteFilter(f.filter_id)} className="p-0.5 text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <select value={newFilterCol} onChange={e => setNewFilterCol(e.target.value)} className="bg-muted rounded px-2 py-1 text-xs text-foreground outline-none">
              <option value="">字段...</option>
              {displayCols.filter(c => !READONLY_TYPES.has(c.type)).map(c => (
                <option key={c.column_id} value={c.column_id}>{c.title}</option>
              ))}
            </select>
            <select value={newFilterOp} onChange={e => setNewFilterOp(e.target.value)} className="bg-muted rounded px-2 py-1 text-xs text-foreground outline-none">
              {FILTER_OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
            <input
              value={newFilterVal}
              onChange={e => setNewFilterVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddFilter(); }}
              placeholder="值"
              className="bg-muted rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none w-32"
            />
            <button onClick={handleAddFilter} disabled={!newFilterCol} className="px-2 py-1 text-xs text-sidebar-primary hover:opacity-80 disabled:opacity-40">
              添加
            </button>
          </div>
        </div>
      )}

      {/* Sort panel */}
      {showSorts && activeViewId && (
        <div className="px-4 py-2 border-b border-border bg-card/30 space-y-2 shrink-0">
          {viewSorts?.map(s => {
            const col = displayCols.find(c => c.column_id === s.fk_column_id);
            return (
              <div key={s.sort_id} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{col?.title || s.fk_column_id}</span>
                <span className="text-sidebar-primary">{s.direction === 'asc' ? '升序' : '降序'}</span>
                <button onClick={() => handleDeleteSort(s.sort_id)} className="p-0.5 text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <select value={newSortCol} onChange={e => setNewSortCol(e.target.value)} className="bg-muted rounded px-2 py-1 text-xs text-foreground outline-none">
              <option value="">字段...</option>
              {displayCols.filter(c => !READONLY_TYPES.has(c.type)).map(c => (
                <option key={c.column_id} value={c.column_id}>{c.title}</option>
              ))}
            </select>
            <select value={newSortDir} onChange={e => setNewSortDir(e.target.value as 'asc' | 'desc')} className="bg-muted rounded px-2 py-1 text-xs text-foreground outline-none">
              <option value="asc">升序</option>
              <option value="desc">降序</option>
            </select>
            <button onClick={handleAddSort} disabled={!newSortCol} className="px-2 py-1 text-xs text-sidebar-primary hover:opacity-80 disabled:opacity-40">
              添加
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-8 rounded bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30 sticky top-0 z-[5]">
                <th className="px-2 py-1.5 text-center text-[10px] font-normal text-muted-foreground/50 w-10 border-r border-border">#</th>
                {displayCols.map(col => {
                  const ColIcon = getColIcon(col.type);
                  const isSorted = sortCol === col.title;
                  return (
                    <th
                      key={col.column_id}
                      className="relative px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap border-r border-border group min-w-[120px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <ColIcon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                        {editingColTitle === col.column_id ? (
                          <input
                            ref={colTitleRef}
                            value={colTitleValue}
                            onChange={e => setColTitleValue(e.target.value)}
                            onBlur={() => handleRenameColumn(col.column_id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRenameColumn(col.column_id);
                              if (e.key === 'Escape') setEditingColTitle(null);
                            }}
                            className="flex-1 bg-transparent text-foreground outline-none text-xs font-medium border-b border-sidebar-primary"
                          />
                        ) : (
                          <span className="flex-1 cursor-pointer select-none" onClick={() => handleSort(col.title)}>
                            {col.title}
                          </span>
                        )}
                        {col.primary_key && <span className="text-[9px] opacity-40 font-normal">PK</span>}
                        {isSorted && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-sidebar-primary shrink-0" /> : <ArrowDown className="h-3 w-3 text-sidebar-primary shrink-0" />)}
                        {!col.primary_key && !READONLY_TYPES.has(col.type) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setColMenu(colMenu === col.column_id ? null : col.column_id); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-foreground transition-opacity"
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {/* Column menu */}
                      {colMenu === col.column_id && !col.primary_key && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setColMenu(null)} />
                          <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-52 max-h-[70vh] overflow-y-auto">
                            <button
                              onClick={() => { setColMenu(null); setEditingColTitle(col.column_id); setColTitleValue(col.title); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <Pencil className="h-3 w-3" /> 重命名列
                            </button>
                            <div className="border-t border-border my-1" />
                            {Object.entries(GROUP_LABELS).map(([group, label]) => {
                              const types = COLUMN_TYPES.filter(ct => ct.group === group);
                              if (types.length === 0) return null;
                              return (
                                <div key={group}>
                                  <div className="px-3 py-0.5 text-[10px] text-muted-foreground/60 mt-0.5">{label}</div>
                                  {types.map(ct => {
                                    const CtIcon = ct.icon;
                                    return (
                                      <button
                                        key={ct.value}
                                        onClick={() => handleChangeColumnType(col.column_id, ct.value)}
                                        className={cn(
                                          'w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent',
                                          col.type === ct.value ? 'text-sidebar-primary font-medium' : 'text-foreground'
                                        )}
                                      >
                                        <CtIcon className="h-3 w-3" /> {ct.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })}
                            <div className="border-t border-border my-1" />
                            <button
                              onClick={() => handleDeleteColumn(col.column_id)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3 w-3" /> 删除列
                            </button>
                          </div>
                        </>
                      )}
                    </th>
                  );
                })}
                <th className="px-2 py-1.5 w-10 border-r border-border">
                  <button onClick={() => setShowAddCol(true)} className="p-0.5 text-muted-foreground hover:text-foreground" title="添加列">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => {
                const rowId = row.Id as number;
                return (
                  <tr key={rowId ?? rowIdx} className="border-b border-border hover:bg-accent/10 transition-colors group/row">
                    <td className="px-2 py-0 text-center text-[10px] text-muted-foreground/40 border-r border-border w-10 relative">
                      <span className="group-hover/row:hidden">{(page - 1) * pageSize + rowIdx + 1}</span>
                      <button
                        onClick={() => handleDeleteRow(rowId)}
                        className="hidden group-hover/row:block p-0.5 text-muted-foreground hover:text-destructive mx-auto"
                        title="删除行"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                    {displayCols.map(col => {
                      const val = row[col.title];
                      const isEditing = editingCell?.rowId === rowId && editingCell?.col === col.title;
                      const isReadonly = col.primary_key || READONLY_TYPES.has(col.type);

                      return (
                        <td
                          key={col.column_id}
                          className={cn(
                            'px-2 py-0 border-r border-border min-w-[120px] relative',
                            isEditing && 'ring-2 ring-sidebar-primary ring-inset bg-card',
                            !isReadonly && !isEditing && 'cursor-pointer'
                          )}
                          onClick={() => {
                            if (isEditing || isReadonly) return;
                            if (col.type === 'Checkbox') {
                              toggleCheckbox(rowId, col.title, val);
                            } else if (isSelectType(col.type)) {
                              setSelectDropdown({
                                rowId, col: col.title,
                                options: col.options || [],
                                multi: col.type === 'MultiSelect',
                              });
                            } else if (col.type === 'Rating') {
                              // Rating handled by inline stars
                            } else {
                              startEdit(rowId, col.title, val, col.type);
                            }
                          }}
                        >
                          {isEditing ? (
                            col.type === 'LongText' || col.type === 'JSON' ? (
                              <textarea
                                ref={editInputRef as React.RefObject<HTMLTextAreaElement>}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => {
                                  if (e.key === 'Escape') { setEditingCell(null); return; }
                                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                }}
                                className={cn(
                                  'w-full bg-transparent text-xs text-foreground outline-none resize-none py-1.5 min-h-[60px]',
                                  col.type === 'JSON' && 'font-mono'
                                )}
                              />
                            ) : (
                              <input
                                ref={editInputRef as React.RefObject<HTMLInputElement>}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => handleCellKeyDown(e, rowIdx, col)}
                                type={getInputType(col.type)}
                                step={col.type === 'Decimal' || col.type === 'Currency' ? '0.01' : col.type === 'Percent' ? '0.1' : undefined}
                                className="w-full bg-transparent text-xs text-foreground outline-none py-1.5"
                              />
                            )
                          ) : col.type === 'Rating' && !isReadonly ? (
                            <RatingStars value={val as number} onChange={v => setRating(rowId, col.title, v)} />
                          ) : (
                            <CellDisplay value={val} col={col} />
                          )}
                          {/* Select dropdown */}
                          {selectDropdown?.rowId === rowId && selectDropdown?.col === col.title && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setSelectDropdown(null)} />
                              <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-48 max-h-48 overflow-y-auto">
                                {selectDropdown.options.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-muted-foreground">无选项 (请在列菜单中添加)</p>
                                ) : selectDropdown.multi ? (
                                  selectDropdown.options.map((opt, i) => {
                                    const currentItems = val ? String(val).split(',').map(s => s.trim()) : [];
                                    const isSelected = currentItems.includes(opt.title);
                                    return (
                                      <button
                                        key={opt.title}
                                        onClick={(e) => { e.stopPropagation(); toggleMultiSelect(rowId, col.title, val, opt.title); }}
                                        className="w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent"
                                      >
                                        <span className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px]',
                                          isSelected ? 'bg-sidebar-primary border-sidebar-primary text-white' : 'border-border'
                                        )}>
                                          {isSelected && '✓'}
                                        </span>
                                        <span
                                          className="px-1.5 py-0.5 rounded text-[11px]"
                                          style={{ backgroundColor: getOptionColor(opt.color, i), color: '#1a1a2e' }}
                                        >
                                          {opt.title}
                                        </span>
                                      </button>
                                    );
                                  })
                                ) : (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setSelectValue(rowId, col.title, ''); }}
                                      className="w-full px-3 py-1 text-xs text-muted-foreground hover:bg-accent text-left"
                                    >
                                      清除
                                    </button>
                                    {selectDropdown.options.map((opt, i) => (
                                      <button
                                        key={opt.title}
                                        onClick={(e) => { e.stopPropagation(); setSelectValue(rowId, col.title, opt.title); }}
                                        className={cn('w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent',
                                          val === opt.title && 'font-medium'
                                        )}
                                      >
                                        <span
                                          className="px-1.5 py-0.5 rounded text-[11px]"
                                          style={{ backgroundColor: getOptionColor(opt.color, i), color: '#1a1a2e' }}
                                        >
                                          {opt.title}
                                        </span>
                                      </button>
                                    ))}
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-r border-border w-10" />
                  </tr>
                );
              })}
              <tr className="border-b border-border">
                <td className="px-2 py-1 border-r border-border" />
                <td colSpan={displayCols.length + 1} className="px-2 py-1">
                  <button onClick={handleAddRow} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-0.5">
                    <Plus className="h-3 w-3" /> 新增行
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Add column panel */}
      {showAddCol && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={() => setShowAddCol(false)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl p-4 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-3">添加列</h3>
            <div className="space-y-3">
              <input
                ref={newColRef}
                value={newColTitle}
                onChange={e => setNewColTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !isSelectType(newColType)) handleAddColumn(); if (e.key === 'Escape') setShowAddCol(false); }}
                placeholder="列名"
                className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
              {/* Type groups */}
              {Object.entries(GROUP_LABELS).map(([group, label]) => {
                const types = COLUMN_TYPES.filter(ct => ct.group === group);
                return (
                  <div key={group}>
                    <div className="text-[10px] text-muted-foreground/60 mb-1">{label}</div>
                    <div className="flex flex-wrap gap-1">
                      {types.map(ct => {
                        const CtIcon = ct.icon;
                        return (
                          <button
                            key={ct.value}
                            onClick={() => setNewColType(ct.value)}
                            className={cn(
                              'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors',
                              newColType === ct.value
                                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <CtIcon className="h-3 w-3 shrink-0" />
                            {ct.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* Options input for select types */}
              {/* Select options */}
              {isSelectType(newColType) && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">选项（逗号分隔）</div>
                  <input
                    value={newColOptions}
                    onChange={e => setNewColOptions(e.target.value)}
                    placeholder="选项1, 选项2, 选项3"
                    className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                  />
                  {newColOptions && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {newColOptions.split(',').filter(s => s.trim()).map((s, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: SELECT_COLORS[i % SELECT_COLORS.length], color: '#1a1a2e' }}>
                          {s.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Formula */}
              {newColType === 'Formula' && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">公式表达式</div>
                  <input
                    value={newColFormula}
                    onChange={e => setNewColFormula(e.target.value)}
                    placeholder="CONCAT({Name}, ' - ', {Country})"
                    className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none font-mono"
                  />
                  <div className="text-[10px] text-muted-foreground/50 mt-1">
                    用 {'{字段名}'} 引用字段。支持: CONCAT, IF, ADD, SUM, AVG, LEN, NOW, DATEADD 等
                  </div>
                </div>
              )}
              {/* Links — select target table */}
              {newColType === 'Links' && (
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">关联目标表</div>
                    <select
                      value={newColRelTable}
                      onChange={e => setNewColRelTable(e.target.value)}
                      className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground outline-none"
                    >
                      <option value="">选择表...</option>
                      {allTables?.filter(t => t.id !== tableId).map(t => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">关联类型</div>
                    <div className="flex gap-1">
                      {[
                        { value: 'mm', label: '多对多' },
                        { value: 'hm', label: '一对多' },
                        { value: 'bt', label: '多对一' },
                      ].map(rt => (
                        <button
                          key={rt.value}
                          onClick={() => setNewColRelType(rt.value)}
                          className={cn(
                            'flex-1 px-2 py-1 rounded-md text-[11px] transition-colors',
                            newColRelType === rt.value
                              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {rt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {/* Lookup — pick relation column + field from related table */}
              {newColType === 'Lookup' && (
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">关联列</div>
                    <select
                      value={newColRelCol}
                      onChange={e => setNewColRelCol(e.target.value)}
                      className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground outline-none"
                    >
                      <option value="">选择关联列...</option>
                      {displayCols.filter(c => c.type === 'Links' || c.type === 'LinkToAnotherRecord').map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  {relatedMeta && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">查找字段（{relatedMeta.title}）</div>
                      <select
                        value={newColLookupCol}
                        onChange={e => setNewColLookupCol(e.target.value)}
                        className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground outline-none"
                      >
                        <option value="">选择字段...</option>
                        {relatedMeta.columns.filter(c => !READONLY_TYPES.has(c.type) || c.type === 'Formula').map(c => (
                          <option key={c.column_id} value={c.column_id}>{c.title} ({c.type})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {/* Rollup — pick relation column + field + aggregation function */}
              {newColType === 'Rollup' && (
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">关联列</div>
                    <select
                      value={newColRelCol}
                      onChange={e => setNewColRelCol(e.target.value)}
                      className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground outline-none"
                    >
                      <option value="">选择关联列...</option>
                      {displayCols.filter(c => c.type === 'Links' || c.type === 'LinkToAnotherRecord').map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  {relatedMeta && (
                    <>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1">汇总字段（{relatedMeta.title}）</div>
                        <select
                          value={newColRollupCol}
                          onChange={e => setNewColRollupCol(e.target.value)}
                          className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground outline-none"
                        >
                          <option value="">选择字段...</option>
                          {relatedMeta.columns.filter(c => ['Number', 'Decimal', 'Currency', 'Percent', 'Rating', 'Duration'].includes(c.type)).map(c => (
                            <option key={c.column_id} value={c.column_id}>{c.title} ({c.type})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1">聚合函数</div>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { value: 'sum', label: '求和' },
                            { value: 'avg', label: '平均' },
                            { value: 'count', label: '计数' },
                            { value: 'min', label: '最小' },
                            { value: 'max', label: '最大' },
                          ].map(fn => (
                            <button
                              key={fn.value}
                              onClick={() => setNewColRollupFn(fn.value)}
                              className={cn(
                                'px-2 py-1 rounded-md text-[11px] transition-colors',
                                newColRollupFn === fn.value
                                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:text-foreground'
                              )}
                            >
                              {fn.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleAddColumn}
                  disabled={!newColTitle.trim()}
                  className="flex-1 py-1.5 bg-sidebar-primary text-sidebar-primary-foreground text-sm rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  添加
                </button>
                <button onClick={() => { resetAddColState(); }} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-card shrink-0 text-xs text-muted-foreground">
          <span>{totalRows} 行</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 hover:text-foreground disabled:opacity-30">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 hover:text-foreground disabled:opacity-30">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Rating stars ──

function RatingStars({ value, onChange, max = 5 }: { value?: number; onChange: (v: number) => void; max?: number }) {
  const current = typeof value === 'number' ? value : 0;
  return (
    <div className="flex items-center gap-0.5 py-1">
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); onChange(i + 1 === current ? 0 : i + 1); }}
          className="text-sm leading-none hover:scale-125 transition-transform"
        >
          {i < current ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

// ── Cell display ──

function CellDisplay({ value, col }: { value: unknown; col: nc.NCColumn }) {
  const { type: colType, primary_key: isPK } = col;

  if (value == null || value === '') {
    return <span className="text-xs text-muted-foreground/30 py-1.5 block select-none">{isPK ? '' : '—'}</span>;
  }

  const str = String(value);

  // Checkbox
  if (colType === 'Checkbox') {
    return <span className="text-sm py-1 block cursor-pointer select-none">{value ? '✅' : '⬜'}</span>;
  }

  // Rating
  if (colType === 'Rating') {
    const n = typeof value === 'number' ? value : parseInt(str) || 0;
    return <span className="text-sm py-1 block select-none">{'★'.repeat(n)}{'☆'.repeat(Math.max(0, 5 - n))}</span>;
  }

  // SingleSelect
  if (colType === 'SingleSelect') {
    const opt = col.options?.find(o => o.title === str);
    const color = opt?.color || SELECT_COLORS[0];
    return (
      <span className="inline-block px-2 py-0.5 rounded text-[11px] my-1" style={{ backgroundColor: color, color: '#1a1a2e' }}>
        {str}
      </span>
    );
  }

  // MultiSelect
  if (colType === 'MultiSelect') {
    const items = str.split(',').map(s => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-0.5 py-1">
        {items.map((item, i) => {
          const opt = col.options?.find(o => o.title === item);
          const color = opt?.color || SELECT_COLORS[i % SELECT_COLORS.length];
          return (
            <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: color, color: '#1a1a2e' }}>
              {item}
            </span>
          );
        })}
      </div>
    );
  }

  // URL
  if (colType === 'URL') {
    return (
      <a href={str} target="_blank" rel="noopener noreferrer"
        className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px] py-1.5"
        title={str} onClick={e => e.stopPropagation()}
      >
        {str.replace(/^https?:\/\//, '').slice(0, 40)}
      </a>
    );
  }

  // Email
  if (colType === 'Email') {
    return (
      <a href={`mailto:${str}`} className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px] py-1.5" onClick={e => e.stopPropagation()}>
        {str}
      </a>
    );
  }

  // PhoneNumber
  if (colType === 'PhoneNumber') {
    return (
      <a href={`tel:${str}`} className="text-xs text-sidebar-primary hover:underline py-1.5 block" onClick={e => e.stopPropagation()}>
        {str}
      </a>
    );
  }

  // Date / DateTime / CreatedTime / LastModifiedTime
  if (colType === 'Date' || colType === 'DateTime' || colType === 'CreatedTime' || colType === 'LastModifiedTime') {
    const d = new Date(str);
    const formatted = isNaN(d.getTime()) ? str : d.toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      ...(colType !== 'Date' ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
    return <span className="text-xs py-1.5 block text-foreground/70" title={str}>{formatted}</span>;
  }

  // Time
  if (colType === 'Time') {
    return <span className="text-xs py-1.5 block text-foreground/70">{str}</span>;
  }

  // Year
  if (colType === 'Year') {
    return <span className="text-xs tabular-nums py-1.5 block">{str}</span>;
  }

  // Currency
  if (colType === 'Currency') {
    const num = parseFloat(str);
    const formatted = isNaN(num) ? str : num.toLocaleString('zh-CN', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
    return <span className="text-xs tabular-nums py-1.5 block text-right">{formatted}</span>;
  }

  // Percent
  if (colType === 'Percent') {
    const num = parseFloat(str);
    const formatted = isNaN(num) ? str : `${num}%`;
    return <span className="text-xs tabular-nums py-1.5 block text-right">{formatted}</span>;
  }

  // Number / Decimal / AutoNumber
  if (colType === 'Number' || colType === 'Decimal' || colType === 'AutoNumber') {
    return (
      <span className={cn('text-xs tabular-nums py-1.5 block text-right', isPK ? 'text-muted-foreground' : 'text-foreground')} title={str}>
        {str}
      </span>
    );
  }

  // JSON
  if (colType === 'JSON') {
    let display = str;
    try { display = JSON.stringify(JSON.parse(str), null, 1); } catch {}
    return <span className="text-xs py-1.5 block font-mono truncate max-w-[200px] text-foreground/70" title={display}>{display}</span>;
  }

  // Attachment
  if (colType === 'Attachment') {
    try {
      const attachments = JSON.parse(str);
      if (Array.isArray(attachments)) {
        return (
          <div className="flex gap-1 py-1">
            {attachments.slice(0, 3).map((a: any, i: number) => (
              <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded truncate max-w-[80px]" title={a.title || a.path}>
                {a.title || `附件${i + 1}`}
              </span>
            ))}
            {attachments.length > 3 && <span className="text-[10px] text-muted-foreground">+{attachments.length - 3}</span>}
          </div>
        );
      }
    } catch {}
    return <span className="text-xs py-1.5 block text-muted-foreground">{str.slice(0, 30)}</span>;
  }

  // User / CreatedBy / LastModifiedBy
  if (colType === 'User' || colType === 'CreatedBy' || colType === 'LastModifiedBy' || colType === 'Collaborator') {
    return <span className="text-xs py-1.5 block text-foreground/70">{str}</span>;
  }

  // Formula / Rollup / Lookup / Count
  if (READONLY_TYPES.has(colType)) {
    return <span className="text-xs py-1.5 block text-foreground/50 italic">{str}</span>;
  }

  // Default: text
  return (
    <span className={cn('text-xs py-1.5 block truncate max-w-[300px]', isPK ? 'text-muted-foreground' : 'text-foreground')} title={str}>
      {str}
    </span>
  );
}
