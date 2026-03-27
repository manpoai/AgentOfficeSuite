'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import { ArrowLeft, Maximize2, Minimize2, ArrowLeftToLine, ArrowRightToLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

// Excalidraw is client-only (no SSR) — dynamically imported in the component
let ExcalidrawComponent: React.ComponentType<any> | null = null;
let excalidrawLoaded = false;

function loadExcalidraw() {
  if (excalidrawLoaded) return Promise.resolve();
  return Promise.all([
    import('@excalidraw/excalidraw').then((mod) => {
      ExcalidrawComponent = mod.Excalidraw;
    }),
    // Excalidraw requires its CSS for toolbar/UI to render
    import('@excalidraw/excalidraw/index.css'),
  ]).then(() => {
    excalidrawLoaded = true;
  });
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
  const [ready, setReady] = useState(excalidrawLoaded);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const excalidrawApiRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Listen for fullscreen exit via Escape
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground truncate flex-1 min-w-0">
          {breadcrumb?.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/50">/</span>}
              <span className={i === (breadcrumb.length - 1) ? 'text-foreground font-medium' : ''}>
                {crumb.title || (t('content.untitledBoard') || 'Untitled Board')}
              </span>
            </span>
          ))}
        </div>

        {/* Fullscreen toggle */}
        <button
          onClick={toggleFullscreen}
          className="p-1 text-muted-foreground hover:text-foreground"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Excalidraw canvas — needs explicit height for Excalidraw to fill */}
      <div className="flex-1 min-h-0 relative">
        {ExcalidrawComponent && (
          <ExcalidrawComponent
            initialData={board.data}
            onChange={handleChange}
            excalidrawAPI={(api: any) => { excalidrawApiRef.current = api; }}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                export: { saveFileToDisk: true },
              },
            }}
            theme={
              typeof window !== 'undefined' &&
              document.documentElement.classList.contains('dark')
                ? 'dark'
                : 'light'
            }
          />
        )}
      </div>
    </div>
  );
}
