'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ol from '@/lib/api/outline';
import * as nc from '@/lib/api/nocodb';
import { FileText, Table2, Plus, ArrowLeft, Save, Trash2, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Search, Clock, FolderOpen, MoreHorizontal, MessageSquare as MessageSquareIcon, Star, Copy, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Editor } from '@/components/editor';
import { Comments } from '@/components/comments/Comments';
import * as gw from '@/lib/api/gateway';

type ContentItem = { type: 'doc'; id: string; title: string; subtitle: string; emoji?: string; updatedAt?: string; sortTime: number }
  | { type: 'table'; id: string; title: string; sortTime: number };

type Selection = { type: 'doc'; id: string } | { type: 'table'; id: string } | null;

type CreateMode = 'doc' | 'table' | null;

export default function ContentPage() {
  const [selection, setSelection] = useState<Selection>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  const { data: docs, isLoading: docsLoading } = useQuery({
    queryKey: ['outline-docs'],
    queryFn: () => ol.listDocuments(),
  });

  const { data: collections } = useQuery({
    queryKey: ['outline-collections'],
    queryFn: ol.listCollections,
  });

  const { data: tables, isLoading: tablesLoading } = useQuery({
    queryKey: ['nc-tables'],
    queryFn: nc.listTables,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['outline-search', searchQuery],
    queryFn: () => ol.searchDocuments(searchQuery),
    enabled: searchQuery.length >= 2,
  });

  const selectedDocId = selection?.type === 'doc' ? selection.id : null;
  const selectedTableId = selection?.type === 'table' ? selection.id : null;

  const { data: selectedDoc } = useQuery({
    queryKey: ['outline-doc', selectedDocId],
    queryFn: () => ol.getDocument(selectedDocId!),
    enabled: !!selectedDocId,
  });

  const collectionMap = new Map<string, string>();
  collections?.forEach(c => collectionMap.set(c.id, c.name));

  // Build unified content list: docs + tables mixed, sorted by time (newest first)
  const items: ContentItem[] = [];
  docs?.forEach(doc => items.push({
    type: 'doc', id: doc.id,
    title: doc.emoji ? `${doc.emoji} ${doc.title || '无标题'}` : (doc.title || '无标题'),
    subtitle: `${collectionMap.get(doc.collectionId) || ''} · ${formatDate(doc.updatedAt)}`,
    emoji: doc.emoji,
    updatedAt: doc.updatedAt,
    sortTime: new Date(doc.updatedAt || 0).getTime(),
  }));
  tables?.forEach(t => items.push({
    type: 'table', id: t.id, title: t.title,
    sortTime: new Date(t.created_at || 0).getTime(),
  }));
  // Sort all items by time, newest first
  items.sort((a, b) => b.sortTime - a.sortTime);

  // Filter by search
  const displayItems = searchQuery.length >= 2
    ? (searchResults
        ? searchResults.map(r => ({
            type: 'doc' as const,
            id: r.document.id,
            title: r.document.title,
            subtitle: r.context?.slice(0, 60) || '',
            emoji: r.document.emoji,
            sortTime: 0,
          }))
        : [])
    : items;

  const handleSelect = (item: ContentItem) => {
    setSelection({ type: item.type, id: item.id });
    setMobileView('detail');
    setCreateMode(null);
  };

  const refreshDocs = () => {
    queryClient.invalidateQueries({ queryKey: ['outline-docs'] });
    if (selectedDocId) queryClient.invalidateQueries({ queryKey: ['outline-doc', selectedDocId] });
  };

  const refreshTables = () => {
    queryClient.invalidateQueries({ queryKey: ['nc-tables'] });
  };

  const isLoading = docsLoading || tablesLoading;

  return (
    <div className="flex h-full overflow-hidden flex-col md:flex-row">
      {/* Unified content list sidebar */}
      <div className={cn(
        'w-full md:w-72 border-r border-border bg-card flex flex-col shrink-0 overflow-hidden',
        mobileView === 'list' ? 'flex' : 'hidden md:flex'
      )}>
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">内容</h2>
          <div className="relative">
            <button
              onClick={() => setShowNewMenu(v => !v)}
              className="p-1 text-muted-foreground hover:text-foreground"
              title="新建"
            >
              <Plus className="h-4 w-4" />
            </button>
            {showNewMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowNewMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg py-1 w-36">
                  <button
                    onClick={() => { setCreateMode('doc'); setSelection(null); setMobileView('detail'); setShowNewMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    <FileText className="h-4 w-4 text-blue-400/70" />
                    新建文档
                  </button>
                  <button
                    onClick={() => { setCreateMode('table'); setSelection(null); setMobileView('detail'); setShowNewMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    <Table2 className="h-4 w-4 text-green-400/70" />
                    新建数据表
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索文档..."
              className="w-full bg-muted rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="py-1">
            {isLoading && (
              <div className="space-y-1 px-3 py-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-start gap-2 py-2 animate-pulse">
                    <div className="w-4 h-4 rounded bg-muted mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3.5 rounded bg-muted" style={{ width: `${60 + Math.random() * 100}px` }} />
                      <div className="h-2.5 rounded bg-muted/60" style={{ width: `${40 + Math.random() * 60}px` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && displayItems.length === 0 && !isLoading && (
              <p className="p-3 text-xs text-muted-foreground">未找到匹配的文档</p>
            )}
            {displayItems.map(item => {
              const isSelected = selection?.type === item.type && selection?.id === item.id;
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  onClick={() => handleSelect(item)}
                  className={cn(
                    'w-full flex items-start gap-2 px-3 py-1.5 text-left transition-colors',
                    isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50'
                  )}
                >
                  {item.type === 'doc'
                    ? <FileText className="h-4 w-4 shrink-0 mt-0.5 text-blue-400/70" />
                    : <Table2 className="h-4 w-4 shrink-0 mt-0.5 text-green-400/70" />
                  }
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{item.title}</p>
                    {item.type === 'doc' && item.subtitle && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Detail area */}
      <div className={cn(
        'flex-1 flex flex-col min-w-0',
        mobileView === 'detail' ? 'flex' : 'hidden md:flex'
      )}>
        {createMode === 'doc' ? (
          <CreateDocPanel
            collections={collections || []}
            onClose={() => { setCreateMode(null); setMobileView('list'); }}
            onCreated={(docId) => { setCreateMode(null); refreshDocs(); setSelection({ type: 'doc', id: docId }); }}
          />
        ) : createMode === 'table' ? (
          <CreateTablePanel
            onClose={() => { setCreateMode(null); setMobileView('list'); }}
            onCreated={(tableId) => { setCreateMode(null); refreshTables(); setSelection({ type: 'table', id: tableId }); }}
          />
        ) : selectedDoc && selection?.type === 'doc' ? (
          <DocPanel
            doc={selectedDoc}
            collectionName={collectionMap.get(selectedDoc.collectionId)}
            onBack={() => setMobileView('list')}
            onSaved={refreshDocs}
            onDeleted={() => { setSelection(null); refreshDocs(); setMobileView('list'); }}
          />
        ) : selectedTableId ? (
          <TableViewer
            tableId={selectedTableId}
            onBack={() => setMobileView('list')}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <div className="flex gap-3 mb-2">
              <FileText className="h-8 w-8 opacity-20" />
              <Table2 className="h-8 w-8 opacity-20" />
            </div>
            <p className="text-sm">选择文档或数据表</p>
            <p className="text-xs text-muted-foreground/50">或点击左上角 + 新建</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Table Viewer (NocoDB)
// ════════════════════════════════════════════════════════════════

function TableViewer({ tableId, onBack }: { tableId: string; onBack: () => void }) {
  const [page, setPage] = useState(1);
  const [editingCell, setEditingCell] = useState<{ rowId: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const queryClient = useQueryClient();
  const pageSize = 25;

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

  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); setSortDir('asc'); } // third click clears sort
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  const displayCols = meta?.columns || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['nc-rows', tableId, page] });
  };

  const startEdit = (rowId: number, col: string, currentValue: unknown) => {
    setEditingCell({ rowId, col });
    setEditValue(currentValue == null ? '' : String(currentValue));
  };

  const saveEdit = async () => {
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
  };

  const handleAddRow = async () => {
    setSaving(true);
    try {
      await nc.insertRow(tableId, newRow);
      setNewRow({});
      setAddingRow(false);
      refresh();
    } catch (e) {
      console.error('Insert failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRow = async (rowId: number) => {
    if (!confirm('确定删除这行？')) return;
    try {
      await nc.deleteRow(tableId, rowId);
      refresh();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const totalRows = rowsData?.pageInfo?.totalRows || 0;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
        <button onClick={onBack} className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Table2 className="h-4 w-4 text-green-400/70 shrink-0" />
        <h2 className="text-sm font-semibold text-foreground truncate flex-1">
          {meta?.title || '加载中...'}
        </h2>
        <span className="text-xs text-muted-foreground">{totalRows} 行</span>
        <button
          onClick={() => { setAddingRow(true); setNewRow({}); }}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-sidebar-primary text-sidebar-primary-foreground rounded-lg hover:opacity-90"
        >
          <Plus className="h-3 w-3" />
          添加行
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">加载中...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 sticky top-0">
                {displayCols.map(col => (
                  <th
                    key={col.column_id}
                    className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleSort(col.title)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.title}
                      {col.primary_key && <span className="text-[10px] opacity-50">PK</span>}
                      {sortCol === col.title && (
                        sortDir === 'asc'
                          ? <ArrowUp className="h-3 w-3 text-sidebar-primary" />
                          : <ArrowDown className="h-3 w-3 text-sidebar-primary" />
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {addingRow && (
                <tr className="border-b border-border bg-accent/30">
                  {displayCols.map(col => (
                    <td key={col.column_id} className="px-3 py-1.5">
                      {col.primary_key ? (
                        <span className="text-xs text-muted-foreground">自动</span>
                      ) : (
                        <input
                          value={newRow[col.title] || ''}
                          onChange={e => setNewRow(prev => ({ ...prev, [col.title]: e.target.value }))}
                          className="w-full bg-card rounded px-2 py-1 text-xs text-foreground outline-none border border-border focus:border-sidebar-primary"
                          placeholder={col.title}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1">
                      <button onClick={handleAddRow} disabled={saving} className="p-1 text-green-500 hover:text-green-400">
                        <Save className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setAddingRow(false)} className="p-1 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {rowsData?.list.map((row, idx) => {
                const rowId = row.Id as number;
                return (
                  <tr key={rowId ?? idx} className="border-b border-border hover:bg-accent/20 transition-colors group">
                    {displayCols.map(col => {
                      const val = row[col.title];
                      const isEditing = editingCell?.rowId === rowId && editingCell?.col === col.title;
                      return (
                        <td key={col.column_id} className="px-3 py-1.5">
                          {isEditing ? (
                            <div className="flex gap-1 items-center">
                              <input
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Escape') { setEditingCell(null); return; }
                                  const editableCols = displayCols.filter(c => !c.primary_key);
                                  const rows = rowsData?.list || [];
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    saveEdit();
                                    // Move to same column, next row
                                    const nextRowIdx = idx + 1;
                                    if (nextRowIdx < rows.length) {
                                      const nextRow = rows[nextRowIdx];
                                      const nextRowId = nextRow.Id as number;
                                      setTimeout(() => startEdit(nextRowId, col.title, nextRow[col.title]), 50);
                                    }
                                  }
                                  if (e.key === 'Tab') {
                                    e.preventDefault();
                                    saveEdit();
                                    const curColIdx = editableCols.findIndex(c => c.title === col.title);
                                    const nextColIdx = e.shiftKey ? curColIdx - 1 : curColIdx + 1;
                                    if (nextColIdx >= 0 && nextColIdx < editableCols.length) {
                                      const nextCol = editableCols[nextColIdx];
                                      setTimeout(() => startEdit(rowId, nextCol.title, row[nextCol.title]), 50);
                                    }
                                  }
                                }}
                                className="flex-1 bg-card rounded px-2 py-0.5 text-xs text-foreground outline-none border border-sidebar-primary"
                                autoFocus
                              />
                              <button onClick={saveEdit} disabled={saving} className="p-0.5 text-green-500">
                                <Save className="h-3 w-3" />
                              </button>
                              <button onClick={() => setEditingCell(null)} className="p-0.5 text-muted-foreground">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <CellDisplay
                              value={val}
                              colType={col.type}
                              isPK={col.primary_key}
                              onClick={col.primary_key ? undefined : () => startEdit(rowId, col.title, val)}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5">
                      <button onClick={() => handleDeleteRow(rowId)} className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100" title="删除行">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 border-t border-border bg-card shrink-0">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// Document sub-components
// ════════════════════════════════════════════════════════════════

/**
 * DocPanel — Outline-style: always editable, auto-save on change.
 * No separate view/edit modes. Title is editable inline.
 */
function DocPanel({ doc, collectionName, onBack, onSaved, onDeleted }: {
  doc: ol.OLDocument;
  collectionName?: string;
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [showDocMenu, setShowDocMenu] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [text, setText] = useState(doc.text);
  const [deleting, setDeleting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ title: doc.title, text: doc.text });

  // Reset state when doc changes
  useEffect(() => {
    setTitle(doc.title);
    setText(doc.text);
    latestRef.current = { title: doc.title, text: doc.text };
    setSaveStatus('saved');
  }, [doc.id, doc.title, doc.text]);

  // Auto-save with debounce
  const scheduleSave = useCallback((newTitle: string, newText: string) => {
    latestRef.current = { title: newTitle, text: newText };
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await ol.updateDocument(doc.id, latestRef.current.title, latestRef.current.text);
        setSaveStatus('saved');
        onSaved();
      } catch (e) {
        console.error('Auto-save failed:', e);
        setSaveStatus('error');
      }
    }, 1500);
  }, [doc.id, onSaved]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    scheduleSave(newTitle, text);
  };

  const handleTextChange = (newText: string) => {
    setText(newText);
    scheduleSave(title, newText);
  };

  const handleDelete = async () => {
    if (!confirm('确定删除这篇文档？')) return;
    setDeleting(true);
    try {
      await ol.deleteDocument(doc.id);
      onDeleted();
    } catch (e) {
      console.error('Delete failed:', e);
    } finally {
      setDeleting(false);
    }
  };

  const statusText = saveStatus === 'saving' ? '保存中...' : saveStatus === 'unsaved' ? '未保存' : saveStatus === 'error' ? '保存失败' : '';

  return (
    <>
      <div className="flex flex-col px-4 py-2 border-b border-border bg-card shrink-0">
        {/* Breadcrumb + actions row */}
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </button>
          {collectionName && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
              <FolderOpen className="h-3 w-3" />
              {collectionName}
              <span className="mx-0.5">/</span>
            </span>
          )}
          <div className="flex-1 min-w-0">
            <input
              value={title}
              onChange={handleTitleChange}
              className="w-full text-sm font-semibold bg-transparent text-foreground outline-none"
              placeholder="文档标题"
            />
          </div>
          {statusText && (
            <span className={cn(
              'text-[10px] shrink-0',
              saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'
            )}>{statusText}</span>
          )}
          <button
            onClick={() => setShowComments(v => !v)}
            className={cn(
              'p-1.5 rounded transition-colors shrink-0',
              showComments ? 'text-sidebar-primary bg-sidebar-primary/10' : 'text-muted-foreground hover:text-foreground'
            )}
            title="评论"
          >
            <MessageSquareIcon className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowDocMenu(v => !v)}
              className="p-1.5 text-muted-foreground hover:text-foreground shrink-0"
              title="更多操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showDocMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDocMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-44">
                  <DocMenuBtn icon={Star} label="收藏" onClick={() => setShowDocMenu(false)} />
                  <DocMenuBtn icon={Clock} label="历史版本" onClick={() => setShowDocMenu(false)} />
                  <DocMenuBtn icon={Copy} label="复制" onClick={() => { navigator.clipboard.writeText(doc.text); setShowDocMenu(false); }} />
                  <DocMenuBtn icon={Download} label="下载" onClick={() => {
                    const blob = new Blob([doc.text], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `${title}.md`; a.click();
                    URL.revokeObjectURL(url);
                    setShowDocMenu(false);
                  }} />
                  <div className="border-t border-border my-1" />
                  <DocMenuBtn icon={Trash2} label="删除" onClick={() => { setShowDocMenu(false); handleDelete(); }} danger />
                </div>
              </>
            )}
          </div>
        </div>
        {/* Last edited info */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 mt-0.5 pl-0 md:pl-0">
          <Clock className="h-2.5 w-2.5" />
          <span>
            {doc.updatedBy?.name || '未知'} 编辑于 {formatDate(doc.updatedAt)}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-hidden flex flex-row">
        <div className="flex-1 overflow-hidden">
          <Editor key={doc.id} defaultValue={doc.text} onChange={handleTextChange} placeholder="输入 / 打开命令菜单..." />
        </div>
        {/* Comments right panel */}
        {showComments && (
          <div className="w-72 border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">评论</h3>
              <button onClick={() => setShowComments(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Comments
              queryKey={['doc-comments', doc.id]}
              fetchComments={() => gw.listDocComments(doc.id)}
              postComment={(text) => gw.commentOnDoc(doc.id, text)}
            />
          </div>
        )}
      </div>
    </>
  );
}

function CreateDocPanel({ collections, onClose, onCreated }: {
  collections: ol.OLCollection[];
  onClose: () => void;
  onCreated: (docId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [collectionId, setCollectionId] = useState(collections[0]?.id || '');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!title.trim() || !collectionId) return;
    setCreating(true);
    setError('');
    try {
      const doc = await ol.createDocument(title.trim(), text, collectionId);
      onCreated(doc.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
        <button onClick={onClose} className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-foreground flex-1">新建文档</span>
        <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-3 pb-1 flex flex-col gap-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full text-lg font-semibold bg-transparent text-foreground outline-none border-b border-border pb-2"
            placeholder="文档标题"
            autoFocus
          />
          {collections.length > 1 && (
            <select
              value={collectionId}
              onChange={e => setCollectionId(e.target.value)}
              className="bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none"
            >
              {collections.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          <Editor defaultValue={text} onChange={setText} placeholder="开始编写..." />
        </div>
        <div className="px-4 pb-3">
          {error && <p className="text-xs text-destructive mb-2">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={!title.trim() || !collectionId || creating}
            className="w-full py-2 bg-sidebar-primary text-sidebar-primary-foreground text-sm rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建文档'}
          </button>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// Create Table Panel
// ════════════════════════════════════════════════════════════════

function CreateTablePanel({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (tableId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [columns, setColumns] = useState([
    { title: 'Name', uidt: 'SingleLineText' },
    { title: 'Notes', uidt: 'LongText' },
  ]);

  const addColumn = () => {
    setColumns([...columns, { title: '', uidt: 'SingleLineText' }]);
  };

  const updateColumn = (idx: number, field: string, value: string) => {
    const newCols = [...columns];
    (newCols[idx] as any)[field] = value;
    setColumns(newCols);
  };

  const removeColumn = (idx: number) => {
    setColumns(columns.filter((_, i) => i !== idx));
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    const validColumns = columns.filter(c => c.title.trim());
    if (validColumns.length === 0) return;

    setCreating(true);
    setError('');
    try {
      const table = await nc.createTable(title.trim(), validColumns);
      onCreated(table.id || (table as any).table_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const COLUMN_TYPES = [
    { value: 'SingleLineText', label: '单行文本' },
    { value: 'LongText', label: '长文本' },
    { value: 'Number', label: '数字' },
    { value: 'Decimal', label: '小数' },
    { value: 'Checkbox', label: '复选框' },
    { value: 'Date', label: '日期' },
    { value: 'DateTime', label: '日期时间' },
    { value: 'Email', label: '邮箱' },
    { value: 'URL', label: '网址' },
  ];

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
        <button onClick={onClose} className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-foreground flex-1">新建数据表</span>
        <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">表名 *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="数据表名称"
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-sidebar-primary"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">列定义</label>
            <div className="space-y-2">
              {columns.map((col, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    value={col.title}
                    onChange={e => updateColumn(idx, 'title', e.target.value)}
                    placeholder="列名"
                    className="flex-1 bg-muted rounded-lg px-3 py-1.5 text-xs text-foreground outline-none"
                  />
                  <select
                    value={col.uidt}
                    onChange={e => updateColumn(idx, 'uidt', e.target.value)}
                    className="bg-muted rounded-lg px-2 py-1.5 text-xs text-foreground outline-none"
                  >
                    {COLUMN_TYPES.map(ct => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                  {columns.length > 1 && (
                    <button onClick={() => removeColumn(idx)} className="p-1 text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addColumn}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                添加列
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={!title.trim() || columns.filter(c => c.title.trim()).length === 0 || creating}
            className="w-full py-2 bg-sidebar-primary text-sidebar-primary-foreground text-sm rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建数据表'}
          </button>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════

function CellDisplay({ value, colType, isPK, onClick }: {
  value: unknown;
  colType: string;
  isPK: boolean;
  onClick?: () => void;
}) {
  if (value == null || value === '') {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }
  const str = String(value);

  // Checkbox
  if (colType === 'Checkbox') {
    return (
      <span className={cn('text-xs', isPK ? 'text-muted-foreground' : 'cursor-pointer')} onClick={onClick}>
        {value ? '✅' : '⬜'}
      </span>
    );
  }

  // URL
  if (colType === 'URL') {
    return (
      <a href={str} target="_blank" rel="noopener noreferrer"
        className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px]"
        title={str}
      >
        {str.replace(/^https?:\/\//, '').slice(0, 40)}
      </a>
    );
  }

  // Email
  if (colType === 'Email') {
    return (
      <a href={`mailto:${str}`} className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px]">
        {str}
      </a>
    );
  }

  // Date / DateTime
  if (colType === 'Date' || colType === 'DateTime') {
    const d = new Date(str);
    const formatted = isNaN(d.getTime()) ? str : d.toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      ...(colType === 'DateTime' ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
    return (
      <span className={cn('text-xs', isPK ? 'text-muted-foreground' : 'text-foreground cursor-pointer hover:text-sidebar-primary')}
        onClick={onClick} title={str}>
        {formatted}
      </span>
    );
  }

  // Number / Decimal
  if (colType === 'Number' || colType === 'Decimal') {
    return (
      <span className={cn('text-xs tabular-nums', isPK ? 'text-muted-foreground' : 'text-foreground cursor-pointer hover:text-sidebar-primary')}
        onClick={onClick} title={str}>
        {str}
      </span>
    );
  }

  // Default: text
  return (
    <span
      className={cn(
        'text-xs block truncate max-w-[200px]',
        isPK ? 'text-muted-foreground' : 'text-foreground cursor-pointer hover:text-sidebar-primary'
      )}
      onClick={onClick}
      title={str}
    >
      {str}
    </span>
  );
}

function DocMenuBtn({ icon: Icon, label, onClick, danger }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
