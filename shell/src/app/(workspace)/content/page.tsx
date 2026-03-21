'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ol from '@/lib/api/outline';
import * as nc from '@/lib/api/nocodb';
import { FileText, Table2, Plus, ArrowLeft, Trash2, X, Search, Clock, MoreHorizontal, MessageSquare as MessageSquareIcon, Star, Copy, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Editor } from '@/components/editor';
import { Comments } from '@/components/comments/Comments';
import { TableEditor } from '@/components/table-editor/TableEditor';
import * as gw from '@/lib/api/gateway';

type ContentItem = { type: 'doc'; id: string; title: string; subtitle: string; emoji?: string; updatedAt?: string; sortTime: number }
  | { type: 'table'; id: string; title: string; sortTime: number };

type Selection = { type: 'doc'; id: string } | { type: 'table'; id: string } | null;

export default function ContentPage() {
  const [selection, setSelection] = useState<Selection>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [creating, setCreating] = useState(false);
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

  // Build unified content list: docs + tables mixed, sorted by time (newest first)
  const items: ContentItem[] = [];
  docs?.forEach(doc => items.push({
    type: 'doc', id: doc.id,
    title: doc.emoji ? `${doc.emoji} ${doc.title || '无标题'}` : (doc.title || '无标题'),
    subtitle: formatDate(doc.updatedAt),
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
  };

  const refreshDocs = () => {
    queryClient.invalidateQueries({ queryKey: ['outline-docs'] });
    if (selectedDocId) queryClient.invalidateQueries({ queryKey: ['outline-doc', selectedDocId] });
  };

  const refreshTables = () => {
    queryClient.invalidateQueries({ queryKey: ['nc-tables'] });
  };

  const handleCreateDoc = async () => {
    if (creating) return;
    const collectionId = collections?.[0]?.id;
    if (!collectionId) return;
    setCreating(true);
    try {
      const doc = await ol.createDocument('无标题', '', collectionId);
      refreshDocs();
      setSelection({ type: 'doc', id: doc.id });
      setMobileView('detail');
    } catch (e) {
      console.error('Create doc failed:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateTable = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const table = await nc.createTable('无标题表格', [
        { title: 'Name', uidt: 'SingleLineText' },
        { title: 'Notes', uidt: 'LongText' },
      ]);
      refreshTables();
      const tableId = table.id || (table as any).table_id;
      setSelection({ type: 'table', id: tableId });
      setMobileView('detail');
    } catch (e) {
      console.error('Create table failed:', e);
    } finally {
      setCreating(false);
    }
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
                    onClick={() => { setShowNewMenu(false); handleCreateDoc(); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4 text-blue-400/70" />
                    新建文档
                  </button>
                  <button
                    onClick={() => { setShowNewMenu(false); handleCreateTable(); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
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
        {selectedDoc && selection?.type === 'doc' ? (
          <DocPanel
            doc={selectedDoc}
            onBack={() => setMobileView('list')}
            onSaved={refreshDocs}
            onDeleted={() => { setSelection(null); refreshDocs(); setMobileView('list'); }}
          />
        ) : selectedTableId ? (
          <TableEditor
            tableId={selectedTableId}
            onBack={() => setMobileView('list')}
            onDeleted={() => { setSelection(null); setMobileView('list'); }}
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
// Document sub-components
// ════════════════════════════════════════════════════════════════

/**
 * DocPanel — Outline-style: always editable, auto-save on change.
 * No separate view/edit modes. Title is editable inline.
 */
function DocPanel({ doc, onBack, onSaved, onDeleted }: {
  doc: ol.OLDocument;
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [showDocMenu, setShowDocMenu] = useState(false);
  const [commentQuote, setCommentQuote] = useState('');
  const [title, setTitle] = useState(doc.title);
  const [text, setText] = useState(doc.text);
  const [deleting, setDeleting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ title: doc.title, text: doc.text });

  // Listen for selection comment events from the floating toolbar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text) {
        setCommentQuote(detail.text);
        setShowComments(true);
      }
    };
    window.addEventListener('editor-comment', handler);
    return () => window.removeEventListener('editor-comment', handler);
  }, []);

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
              initialQuote={commentQuote}
              onQuoteConsumed={() => setCommentQuote('')}
            />
          </div>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════

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
