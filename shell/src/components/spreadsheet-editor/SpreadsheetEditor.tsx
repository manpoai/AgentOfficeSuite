'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  ArrowLeft, ArrowLeftToLine, ArrowRightToLine,
  MoreHorizontal, Link2, Download, Trash2, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

// ─── Types ──────────────────────────────────────────
interface SpreadsheetEditorProps {
  spreadsheetId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}

// ─── Univer Dynamic Import (client-only, no SSR) ────
let univerModule: any = null;
let sheetsPresetModule: any = null;
let univerLoaded = false;

function loadUniver() {
  if (univerLoaded) return Promise.resolve();
  return Promise.all([
    import('@univerjs/presets'),
    import('@univerjs/preset-sheets-core'),
    import('@univerjs/preset-sheets-core/lib/locales/en-US'),
    import('@univerjs/preset-sheets-core/lib/index.css'),
  ]).then(([presets, sheetsCore, enUS]) => {
    univerModule = presets;
    sheetsPresetModule = { ...sheetsCore, localeEnUS: enUS.default || enUS };
    univerLoaded = true;
  });
}

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

// ─── Main Component ─────────────────────────────────
export function SpreadsheetEditor({
  spreadsheetId,
  breadcrumb,
  onBack,
  onDeleted,
  onCopyLink,
  docListVisible,
  onToggleDocList,
}: SpreadsheetEditorProps) {
  const { t } = useT();
  const queryClient = useQueryClient();

  // State
  const [ready, setReady] = useState(univerLoaded);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const univerContainerRef = useRef<HTMLDivElement>(null);
  const univerInstanceRef = useRef<any>(null);
  const univerAPIRef = useRef<any>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const initialDataLoadedRef = useRef(false);

  // Load Univer
  useEffect(() => {
    if (!univerLoaded) {
      loadUniver().then(() => setReady(true));
    }
  }, []);

  // Fetch spreadsheet data
  const { data: spreadsheet, isLoading } = useQuery({
    queryKey: ['spreadsheet', spreadsheetId],
    queryFn: () => gw.getSpreadsheet(spreadsheetId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const currentTitle = breadcrumb?.[breadcrumb.length - 1]?.title || '';

  // ─── Auto-save ────────────────────────────────────
  const triggerSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const api = univerAPIRef.current;
      if (!api) return;
      try {
        const workbook = api.getActiveWorkbook();
        if (!workbook) return;
        const snapshot = workbook.getSnapshot();
        gw.saveSpreadsheet(spreadsheetId, snapshot).catch((err: Error) => {
          console.error('Spreadsheet auto-save failed:', err);
        });
      } catch (err) {
        console.error('Spreadsheet serialize failed:', err);
      }
    }, 1500);
  }, [spreadsheetId]);

  // ─── Initialize Univer ────────────────────────────
  useEffect(() => {
    if (!ready || !univerContainerRef.current || univerInstanceRef.current) return;
    if (isLoading) return; // Wait for data

    const { createUniver, LocaleType } = univerModule;
    const { UniverSheetsCorePreset } = sheetsPresetModule;
    const localeEnUS = sheetsPresetModule.localeEnUS;

    // Prepare workbook data from saved snapshot or create default
    const savedData = spreadsheet?.data;
    const hasData = savedData && Object.keys(savedData).length > 0 && savedData.id;

    const { univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: localeEnUS },
      presets: [
        UniverSheetsCorePreset({
          container: univerContainerRef.current,
        }),
      ],
    });

    univerAPIRef.current = univerAPI;

    // Create or load workbook
    if (hasData) {
      univerAPI.createWorkbook(savedData);
    } else {
      univerAPI.createWorkbook({});
    }

    initialDataLoadedRef.current = true;

    // Listen for changes to trigger auto-save
    const disposable = univerAPI.onCommandExecuted((info: any) => {
      // Only save on mutation commands (skip selection, scroll, etc.)
      const cmd = info.id || '';
      if (
        cmd.includes('set-range') ||
        cmd.includes('set-cell') ||
        cmd.includes('insert') ||
        cmd.includes('remove') ||
        cmd.includes('delete') ||
        cmd.includes('set-worksheet') ||
        cmd.includes('set-col') ||
        cmd.includes('set-row') ||
        cmd.includes('rename') ||
        cmd.includes('merge') ||
        cmd.includes('style') ||
        cmd.includes('set-border') ||
        cmd.includes('set-frozen') ||
        cmd.includes('move') ||
        cmd.includes('paste') ||
        cmd.includes('clear') ||
        cmd.includes('undo') ||
        cmd.includes('redo')
      ) {
        triggerSave();
      }
    });

    return () => {
      disposable?.dispose();
      try { univerAPI.dispose?.(); } catch {}
      univerInstanceRef.current = null;
      univerAPIRef.current = null;
      initialDataLoadedRef.current = false;
    };
  }, [ready, isLoading, spreadsheet, triggerSave]);

  // ─── Title Editing ────────────────────────────────
  const startEditTitle = useCallback(() => {
    setEditTitle(currentTitle || '');
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [currentTitle]);

  const saveTitle = useCallback(async () => {
    setIsEditingTitle(false);
    const newTitle = editTitle.trim();
    if (newTitle !== currentTitle) {
      await gw.updateContentItem(`spreadsheet:${spreadsheetId}`, { title: newTitle });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    }
  }, [editTitle, currentTitle, spreadsheetId, queryClient]);

  // ─── Delete ───────────────────────────────────────
  const handleDelete = useCallback(async () => {
    setShowMenu(false);
    await gw.deleteContentItem(`spreadsheet:${spreadsheetId}`);
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
    onDeleted?.();
  }, [spreadsheetId, queryClient, onDeleted]);

  // ─── Export CSV ───────────────────────────────────
  const handleDownload = useCallback(() => {
    setShowMenu(false);
    const api = univerAPIRef.current;
    if (!api) return;
    try {
      const workbook = api.getActiveWorkbook();
      const sheet = workbook?.getActiveSheet();
      if (!sheet) return;
      const range = sheet.getRange(0, 0, sheet.getRowCount(), sheet.getColumnCount());
      const values = range.getValues();
      if (!values) return;

      // Convert to CSV
      const csv = values
        .map((row: any[]) => row.map((cell: any) => {
          const val = cell?.v ?? '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentTitle || 'spreadsheet'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
  }, [currentTitle]);

  // ─── Loading / Not Found ──────────────────────────
  if (isLoading || !ready) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">{t('common.loading') || 'Loading...'}</div>
      </div>
    );
  }

  if (!spreadsheet) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">Spreadsheet not found</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-card">
      {/* ─── Header Bar ─── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <button onClick={onBack} className="md:hidden p-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>

        {onToggleDocList && (
          <button
            onClick={onToggleDocList}
            className="hidden md:flex p-1 text-muted-foreground hover:text-foreground"
            title={docListVisible ? 'Hide sidebar' : 'Show sidebar'}
          >
            {docListVisible ? <ArrowLeftToLine className="h-4 w-4" /> : <ArrowRightToLine className="h-4 w-4" />}
          </button>
        )}

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
                    {crumb.title || (t('content.untitledSpreadsheet') || 'Untitled Spreadsheet')}
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground/50 mt-0.5">
            {formatRelativeTime(spreadsheet.updated_at)}
            {spreadsheet.updated_by && <span> &middot; {spreadsheet.updated_by}</span>}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 shrink-0">
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
                  <MenuBtn icon={Link2} label={t('content.copyLink') || 'Copy Link'} onClick={() => {
                    setShowMenu(false);
                    onCopyLink?.();
                  }} />
                  <MenuBtn icon={Download} label="Export CSV" onClick={handleDownload} />
                  <div className="border-t border-border my-1" />
                  <MenuBtn icon={Trash2} label={t('content.delete') || 'Delete'} onClick={handleDelete} danger />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Univer Container ─── */}
      <div
        ref={univerContainerRef}
        className="flex-1 min-h-0"
        style={{ overflow: 'hidden' }}
      />
    </div>
  );
}

// ─── Menu Button ────────────────────────────────────
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
