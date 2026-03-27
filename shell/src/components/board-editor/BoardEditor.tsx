'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  ArrowLeft, Maximize2, Minimize2, ArrowLeftToLine, ArrowRightToLine,
  Search, MoreHorizontal, Link2, Download, Trash2, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

import './excalidraw-overrides.css';

// Excalidraw is client-only (no SSR) — dynamically imported in the component
let ExcalidrawComponent: React.ComponentType<any> | null = null;
let MainMenuComponent: React.ComponentType<any> | null = null;
let exportToBlobFn: any = null;
let excalidrawLoaded = false;

function loadExcalidraw() {
  if (excalidrawLoaded) return Promise.resolve();
  return Promise.all([
    import('@excalidraw/excalidraw').then((mod) => {
      ExcalidrawComponent = mod.Excalidraw;
      MainMenuComponent = mod.MainMenu;
      exportToBlobFn = mod.exportToBlob;
    }),
    // Excalidraw requires its CSS for toolbar/UI to render
    import('@excalidraw/excalidraw/index.css'),
  ]).then(() => {
    excalidrawLoaded = true;
  });
}

// Background color presets (matching Excalidraw's defaults)
const BG_COLORS = [
  '#ffffff', '#f8f9fa', '#f5f5dc', '#fdf2f8', '#fff8e1', '#e8f5e9',
  '#e3f2fd', '#f3e5f5', '#fffde7', '#fbe9e7',
];

function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

interface BoardEditorProps {
  boardId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}

export function BoardEditor({
  boardId,
  breadcrumb,
  onBack,
  onDeleted,
  onCopyLink,
  docListVisible,
  onToggleDocList,
}: BoardEditorProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(excalidrawLoaded);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const excalidrawApiRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Load Excalidraw module
  useEffect(() => {
    if (!excalidrawLoaded) {
      loadExcalidraw().then(() => setReady(true));
    }
  }, []);

  // Fetch board data
  const { data: board, isLoading } = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => gw.getBoard(boardId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Current title from breadcrumb (last item)
  const currentTitle = breadcrumb?.[breadcrumb.length - 1]?.title || '';

  // Auto-save on change (debounced 800ms)
  const handleChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const data = {
          type: 'excalidraw',
          version: 2,
          source: 'asuite',
          elements: elements.filter((el: any) => !el.isDeleted),
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            gridSize: appState.gridSize,
          },
          files: files || {},
        };
        gw.saveBoard(boardId, data).catch((err) => {
          console.error('Board auto-save failed:', err);
        });
      }, 800);
    },
    [boardId],
  );

  // Title editing
  const startEditTitle = useCallback(() => {
    setEditTitle(currentTitle || '');
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [currentTitle]);

  const saveTitle = useCallback(async () => {
    setIsEditingTitle(false);
    const newTitle = editTitle.trim();
    if (newTitle !== currentTitle) {
      await gw.updateContentItem(`board:${boardId}`, { title: newTitle });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    }
  }, [editTitle, currentTitle, boardId, queryClient]);

  // Search — trigger Excalidraw's built-in Cmd+F
  const triggerSearch = useCallback(() => {
    // Excalidraw listens for Ctrl/Cmd+F to open its search
    const el = containerRef.current?.querySelector('.excalidraw');
    if (el) {
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f',
        code: 'KeyF',
        metaKey: navigator.platform.includes('Mac'),
        ctrlKey: !navigator.platform.includes('Mac'),
        bubbles: true,
      }));
    }
  }, []);

  // Download as PNG
  const handleDownload = useCallback(async () => {
    setShowMenu(false);
    const api = excalidrawApiRef.current;
    if (!api || !exportToBlobFn) return;
    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      const blob = await exportToBlobFn({
        elements,
        appState: { ...appState, exportWithDarkMode: false },
        files,
        mimeType: 'image/png',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentTitle || 'board'}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Board export failed:', err);
    }
  }, [currentTitle]);

  // Delete board
  const handleDelete = useCallback(async () => {
    setShowMenu(false);
    await gw.deleteContentItem(`board:${boardId}`);
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
    onDeleted?.();
  }, [boardId, queryClient, onDeleted]);

  // Change canvas background
  const handleBgChange = useCallback((color: string) => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    api.updateScene({
      appState: { ...appState, viewBackgroundColor: color },
    });
    // Trigger save
    handleChange(elements, { ...appState, viewBackgroundColor: color }, api.getFiles());
  }, [handleChange]);

  if (isLoading || !ready) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">{t('common.loading') || 'Loading...'}</div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">Board not found</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0 bg-white dark:bg-card">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        {/* Mobile back */}
        <button onClick={onBack} className="md:hidden p-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Toggle sidebar */}
        {onToggleDocList && (
          <button
            onClick={onToggleDocList}
            className="hidden md:flex p-1 text-muted-foreground hover:text-foreground"
            title={docListVisible ? 'Hide sidebar' : 'Show sidebar'}
          >
            {docListVisible ? <ArrowLeftToLine className="h-4 w-4" /> : <ArrowRightToLine className="h-4 w-4" />}
          </button>
        )}

        {/* Title + meta info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm">
            {breadcrumb?.map((crumb, i) => (
              <span key={crumb.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                {i < (breadcrumb.length - 1) ? (
                  <span className="text-muted-foreground truncate">{crumb.title}</span>
                ) : isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') setIsEditingTitle(false);
                    }}
                    className="text-foreground font-medium bg-transparent border-b border-primary outline-none min-w-[100px] max-w-[300px]"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={startEditTitle}
                    className="text-foreground font-medium truncate hover:text-primary transition-colors"
                    title={t('content.rename') || 'Click to rename'}
                  >
                    {crumb.title || (t('content.untitledBoard') || 'Untitled Board')}
                  </button>
                )}
              </span>
            ))}
          </div>
          {/* Updated time + author */}
          <div className="text-[11px] text-muted-foreground/50 mt-0.5">
            {formatRelativeTime(board.updated_at)}
            {board.updated_by && <span> · {board.updated_by}</span>}
          </div>
        </div>

        {/* Right actions: Search + More */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={triggerSearch}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            title={t('content.findReplace') || 'Find on canvas'}
          >
            <Search className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(v => !v)}
              className="p-1.5 text-muted-foreground hover:text-foreground shrink-0"
              title={t('content.moreActions') || 'More'}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-52">
                  {/* Copy Link */}
                  <MenuBtn icon={Link2} label={t('content.copyLink') || 'Copy Link'} onClick={() => {
                    setShowMenu(false);
                    onCopyLink?.();
                  }} />
                  {/* Download */}
                  <MenuBtn icon={Download} label={t('content.download') || 'Download'} onClick={handleDownload} />
                  {/* Canvas Background */}
                  <div className="border-t border-border my-1" />
                  <div className="px-3 py-1.5">
                    <div className="text-xs text-muted-foreground mb-1.5">Canvas background</div>
                    <div className="flex gap-1 flex-wrap">
                      {BG_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => handleBgChange(color)}
                          className={cn(
                            'w-6 h-6 rounded border transition-all',
                            excalidrawApiRef.current?.getAppState()?.viewBackgroundColor === color
                              ? 'border-primary ring-1 ring-primary'
                              : 'border-border hover:border-foreground/30'
                          )}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                  {/* Delete */}
                  <div className="border-t border-border my-1" />
                  <MenuBtn icon={Trash2} label={t('content.delete') || 'Delete'} onClick={handleDelete} danger />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Excalidraw canvas */}
      <div className="flex-1 min-h-0 relative">
        {ExcalidrawComponent && (
          <ExcalidrawComponent
            initialData={board.data}
            onChange={handleChange}
            excalidrawAPI={(api: any) => { excalidrawApiRef.current = api; }}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                export: false,
                saveAsImage: false,
              },
            }}
            theme={
              typeof window !== 'undefined' &&
              document.documentElement.classList.contains('dark')
                ? 'dark'
                : 'light'
            }
          >
            {/* Empty MainMenu hides the native hamburger menu button */}
            {MainMenuComponent && <MainMenuComponent />}
          </ExcalidrawComponent>
        )}
      </div>
    </div>
  );
}

// Reusable menu button (same pattern as DocPanel's DocMenuBtn)
function MenuBtn({ icon: Icon, label, onClick, danger }: {
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
