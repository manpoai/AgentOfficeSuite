'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown,
  ArrowLeft, Table2, MoreHorizontal, Type, Hash, Calendar, CheckSquare,
  Link, Mail, AlignLeft, GripVertical, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as nc from '@/lib/api/nocodb';

// ── Column type config ──

const COLUMN_TYPES: { value: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'SingleLineText', label: '单行文本', icon: Type },
  { value: 'LongText', label: '长文本', icon: AlignLeft },
  { value: 'Number', label: '数字', icon: Hash },
  { value: 'Decimal', label: '小数', icon: Hash },
  { value: 'Checkbox', label: '复选框', icon: CheckSquare },
  { value: 'Date', label: '日期', icon: Calendar },
  { value: 'DateTime', label: '日期时间', icon: Calendar },
  { value: 'Email', label: '邮箱', icon: Mail },
  { value: 'URL', label: '网址', icon: Link },
];

function getColIcon(uidt: string) {
  const ct = COLUMN_TYPES.find(c => c.value === uidt);
  return ct?.icon || Type;
}

function getColTypeLabel(uidt: string) {
  return COLUMN_TYPES.find(c => c.value === uidt)?.label || uidt;
}

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
  const [colMenu, setColMenu] = useState<string | null>(null); // column_id of open menu
  const [editingColTitle, setEditingColTitle] = useState<string | null>(null); // column_id being renamed
  const [colTitleValue, setColTitleValue] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColTitle, setNewColTitle] = useState('');
  const [newColType, setNewColType] = useState('SingleLineText');
  const [editingTableTitle, setEditingTableTitle] = useState(false);
  const [tableTitleValue, setTableTitleValue] = useState('');
  const [showTableMenu, setShowTableMenu] = useState(false);
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
  const editableCols = displayCols.filter(c => !c.primary_key);
  const rows = rowsData?.list || [];
  const totalRows = rowsData?.pageInfo?.totalRows || 0;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['nc-rows', tableId] });
  };

  const refreshMeta = () => {
    queryClient.invalidateQueries({ queryKey: ['nc-table-meta', tableId] });
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
    if (colType === 'Checkbox') return; // checkboxes toggle directly
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

  // Focus edit input when cell editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
    }
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
      await nc.addColumn(tableId, newColTitle.trim(), newColType);
      setNewColTitle('');
      setNewColType('SingleLineText');
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
      // Move to next row, same column
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

  // Focus new col input
  useEffect(() => {
    if (showAddCol && newColRef.current) newColRef.current.focus();
  }, [showAddCol]);

  // Focus col rename input
  useEffect(() => {
    if (editingColTitle && colTitleRef.current) colTitleRef.current.focus();
  }, [editingColTitle]);

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
                {/* Row number */}
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
                          <span
                            className="flex-1 cursor-pointer select-none"
                            onClick={() => handleSort(col.title)}
                          >
                            {col.title}
                          </span>
                        )}
                        {col.primary_key && <span className="text-[9px] opacity-40 font-normal">PK</span>}
                        {isSorted && (
                          sortDir === 'asc'
                            ? <ArrowUp className="h-3 w-3 text-sidebar-primary shrink-0" />
                            : <ArrowDown className="h-3 w-3 text-sidebar-primary shrink-0" />
                        )}
                        {/* Column menu trigger */}
                        {!col.primary_key && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setColMenu(colMenu === col.column_id ? null : col.column_id); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-foreground transition-opacity"
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {/* Column menu dropdown */}
                      {colMenu === col.column_id && !col.primary_key && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setColMenu(null)} />
                          <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-48">
                            <button
                              onClick={() => {
                                setColMenu(null);
                                setEditingColTitle(col.column_id);
                                setColTitleValue(col.title);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <Pencil className="h-3 w-3" /> 重命名列
                            </button>
                            <div className="border-t border-border my-1" />
                            <div className="px-3 py-1 text-[10px] text-muted-foreground">列类型</div>
                            {COLUMN_TYPES.map(ct => {
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
                {/* Add column header */}
                <th className="px-2 py-1.5 w-10 border-r border-border">
                  <button
                    onClick={() => setShowAddCol(true)}
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    title="添加列"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => {
                const rowId = row.Id as number;
                return (
                  <tr
                    key={rowId ?? rowIdx}
                    className="border-b border-border hover:bg-accent/10 transition-colors group/row"
                  >
                    {/* Row number */}
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
                      const isCheckbox = col.type === 'Checkbox';

                      return (
                        <td
                          key={col.column_id}
                          className={cn(
                            'px-2 py-0 border-r border-border min-w-[120px] relative',
                            isEditing && 'ring-2 ring-sidebar-primary ring-inset bg-card'
                          )}
                          onClick={() => {
                            if (!isEditing && !col.primary_key) {
                              if (isCheckbox) {
                                toggleCheckbox(rowId, col.title, val);
                              } else {
                                startEdit(rowId, col.title, val, col.type);
                              }
                            }
                          }}
                        >
                          {isEditing ? (
                            col.type === 'LongText' ? (
                              <textarea
                                ref={editInputRef as React.RefObject<HTMLTextAreaElement>}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => {
                                  if (e.key === 'Escape') { setEditingCell(null); return; }
                                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                }}
                                className="w-full bg-transparent text-xs text-foreground outline-none resize-none py-1.5 min-h-[60px]"
                              />
                            ) : (
                              <input
                                ref={editInputRef as React.RefObject<HTMLInputElement>}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => handleCellKeyDown(e, rowIdx, col)}
                                type={col.type === 'Number' || col.type === 'Decimal' ? 'number' : col.type === 'Date' ? 'date' : col.type === 'Email' ? 'email' : col.type === 'URL' ? 'url' : 'text'}
                                className="w-full bg-transparent text-xs text-foreground outline-none py-1.5"
                              />
                            )
                          ) : (
                            <CellDisplay value={val} colType={col.type} isPK={col.primary_key} />
                          )}
                        </td>
                      );
                    })}
                    {/* Empty cell for add-column column */}
                    <td className="border-r border-border w-10" />
                  </tr>
                );
              })}
              {/* Add row button */}
              <tr className="border-b border-border">
                <td className="px-2 py-1 border-r border-border" />
                <td colSpan={displayCols.length + 1} className="px-2 py-1">
                  <button
                    onClick={handleAddRow}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-0.5"
                  >
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
          <div className="bg-card border border-border rounded-xl shadow-2xl p-4 w-72" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-3">添加列</h3>
            <div className="space-y-2">
              <input
                ref={newColRef}
                value={newColTitle}
                onChange={e => setNewColTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddColumn(); if (e.key === 'Escape') setShowAddCol(false); }}
                placeholder="列名"
                className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
              <div className="grid grid-cols-3 gap-1">
                {COLUMN_TYPES.map(ct => {
                  const CtIcon = ct.icon;
                  return (
                    <button
                      key={ct.value}
                      onClick={() => setNewColType(ct.value)}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] transition-colors',
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
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleAddColumn}
                  disabled={!newColTitle.trim()}
                  className="flex-1 py-1.5 bg-sidebar-primary text-sidebar-primary-foreground text-sm rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  添加
                </button>
                <button
                  onClick={() => setShowAddCol(false)}
                  className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
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

// ── Cell display ──

function CellDisplay({ value, colType, isPK }: { value: unknown; colType: string; isPK: boolean }) {
  if (value == null || value === '') {
    return <span className="text-xs text-muted-foreground/30 py-1.5 block select-none">{isPK ? '' : '—'}</span>;
  }

  const str = String(value);

  if (colType === 'Checkbox') {
    return (
      <span className="text-sm py-1 block cursor-pointer select-none">
        {value ? '✅' : '⬜'}
      </span>
    );
  }

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

  if (colType === 'Email') {
    return (
      <a href={`mailto:${str}`}
        className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px] py-1.5"
        onClick={e => e.stopPropagation()}
      >
        {str}
      </a>
    );
  }

  if (colType === 'Date' || colType === 'DateTime') {
    const d = new Date(str);
    const formatted = isNaN(d.getTime()) ? str : d.toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      ...(colType === 'DateTime' ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
    return (
      <span className={cn('text-xs py-1.5 block', isPK ? 'text-muted-foreground' : 'text-foreground')} title={str}>
        {formatted}
      </span>
    );
  }

  if (colType === 'Number' || colType === 'Decimal') {
    return (
      <span className={cn('text-xs tabular-nums py-1.5 block text-right', isPK ? 'text-muted-foreground' : 'text-foreground')} title={str}>
        {str}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'text-xs py-1.5 block truncate max-w-[300px]',
        isPK ? 'text-muted-foreground' : 'text-foreground'
      )}
      title={str}
    >
      {str}
    </span>
  );
}
