'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown,
  ArrowLeft, Table2, MoreHorizontal, Type, Hash, Calendar, CheckSquare,
  Link, Mail, AlignLeft, Pencil, Star, Phone, Clock, DollarSign,
  Percent, List, Tags, Braces, Paperclip, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as nc from '@/lib/api/nocodb';

// ── Column type config ──

interface ColTypeDef {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'text' | 'number' | 'datetime' | 'select' | 'other';
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
  // Other
  { value: 'Attachment', label: '附件', icon: Paperclip, group: 'other' },
  { value: 'JSON', label: 'JSON', icon: Braces, group: 'other' },
  { value: 'User', label: '用户', icon: User, group: 'other' },
];

const GROUP_LABELS: Record<string, string> = {
  text: '文本', number: '数字', datetime: '日期时间', select: '选择', other: '其他',
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
  const [editingTableTitle, setEditingTableTitle] = useState(false);
  const [tableTitleValue, setTableTitleValue] = useState('');
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [selectDropdown, setSelectDropdown] = useState<{ rowId: number; col: string; options: nc.NCSelectOption[]; multi: boolean } | null>(null);
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

  const { data: rowsData, isLoading } = useQuery({
    queryKey: ['nc-rows', tableId, page, sortParam],
    queryFn: () => nc.queryRows(tableId, { limit: pageSize, offset: (page - 1) * pageSize, sort: sortParam }),
    enabled: !!meta,
  });

  const displayCols = (meta?.columns || []).filter(c => c.title !== 'created_by');
  const editableCols = displayCols.filter(c => !c.primary_key && !READONLY_TYPES.has(c.type));
  const rows = rowsData?.list || [];
  const totalRows = rowsData?.pageInfo?.totalRows || 0;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['nc-rows', tableId] });
  const refreshMeta = () => queryClient.invalidateQueries({ queryKey: ['nc-table-meta', tableId] });

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
  const handleAddColumn = async () => {
    if (!newColTitle.trim()) return;
    try {
      const opts: { options?: nc.NCSelectOption[] } = {};
      if ((newColType === 'SingleSelect' || newColType === 'MultiSelect') && newColOptions.trim()) {
        opts.options = newColOptions.split(',').map((s, i) => ({
          title: s.trim(),
          color: SELECT_COLORS[i % SELECT_COLORS.length],
        }));
      }
      await nc.addColumn(tableId, newColTitle.trim(), newColType, opts);
      setNewColTitle('');
      setNewColType('SingleLineText');
      setNewColOptions('');
      setShowAddCol(false);
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
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ backgroundColor: SELECT_COLORS[i % SELECT_COLORS.length], color: '#1a1a2e' }}
                        >
                          {s.trim()}
                        </span>
                      ))}
                    </div>
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
                <button onClick={() => setShowAddCol(false)} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
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
