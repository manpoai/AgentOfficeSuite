'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Search, Clock, MessageSquare as MessageSquareIcon, Download, Link2, Pin, ExternalLink, AtSign, Share2 } from 'lucide-react';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/utils/time';
import dynamic from 'next/dynamic';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { MobileCommentBar } from '@/components/shared/MobileCommentBar';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import * as gw from '@/lib/api/gateway';
import { EditorSkeleton } from '@/components/shared/Skeleton';
import type { DiagramEditorHandle, DiagramSaveStatus } from '@/components/diagram-editor/X6DiagramEditor';

const DiagramEditor = dynamic(
  () => import('@/components/diagram-editor/X6DiagramEditor'),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

export function DiagramPanel({ diagramId, breadcrumb, onBack, onDeleted, onCopyLink, docListVisible, onToggleDocList, onNavigate }: {
  diagramId: string;
  breadcrumb: { id: string; title: string }[];
  onBack: () => void;
  onDeleted: () => void;
  onCopyLink: () => void;
  docListVisible: boolean;
  onToggleDocList: () => void;
  onNavigate?: (id: string) => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const editorRef = useRef<DiagramEditorHandle>(null);
  const [saveStatus, setSaveStatus] = useState<DiagramSaveStatus>({ saving: false, lastSaved: null });
  const [showComments, setShowComments] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [title, setTitle] = useState('');

  // Get title from content items
  const { data: contentItems } = useQuery({
    queryKey: ['content-items'],
    queryFn: gw.listContentItems,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const item = contentItems?.find((i: any) => i.raw_id === diagramId && i.type === 'diagram');
    if (item) setTitle(item.title || '');
  }, [contentItems, diagramId]);

  // Open comments panel when diagram requests it via context menu
  useEffect(() => {
    const onOpenCommentsPanel = () => {
      setShowComments(true);
      setShowHistory(false);
    };
    window.addEventListener('diagram:open-comments-panel', onOpenCommentsPanel);
    return () => window.removeEventListener('diagram:open-comments-panel', onOpenCommentsPanel);
  }, []);

  const handleTitleChange = useCallback(async (newTitle: string) => {
    setTitle(newTitle);
    try {
      await gw.updateContentItem(`diagram:${diagramId}`, { title: newTitle });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    } catch (e) {
      showError('Failed to update diagram title', e);
    }
  }, [diagramId, queryClient]);

  const handleDelete = useCallback(async () => {
    if (!confirm(t('diagram.deleteConfirm'))) return;
    try {
      await gw.deleteContentItem(`diagram:${diagramId}`);
      onDeleted();
    } catch (e) {
      showError('Delete failed', e);
    }
  }, [diagramId, onDeleted]);

  // Get updated_at/updated_by from content items for metaLine
  const diagramItem = contentItems?.find((i: any) => i.raw_id === diagramId && i.type === 'diagram');

  return (
    <div className="flex-1 min-w-0 flex flex-row h-full">
      {/* Left column: TopBar + editor content — card style */}
      <div className="flex-1 min-w-0 flex flex-col h-full bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] md:overflow-hidden relative z-[1]">
        {/* ContentTopBar — system-level, same as Doc/Table */}
        <div className="flex items-center border-b border-border bg-card shrink-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
          <ContentTopBar
            breadcrumb={breadcrumb}
            onNavigate={onNavigate}
            onBack={onBack}
            docListVisible={docListVisible}
            onToggleDocList={onToggleDocList}
            title={title || 'Untitled Diagram'}
            titlePlaceholder="Untitled Diagram"
            onTitleChange={handleTitleChange}
            statusText={saveStatus.saving ? 'Saving...' : saveStatus.lastSaved ? `Saved ${formatRelativeTime(saveStatus.lastSaved)}` : ''}
            metaLine={
              <button
                onClick={() => { setShowHistory(true); setShowComments(false); }}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
              >
                Last modified: {formatRelativeTime(diagramItem?.updated_at || diagramItem?.created_at)}
                {diagramItem?.updated_by && <span> by {diagramItem.updated_by}</span>}
              </button>
            }
            onHistory={() => { setShowHistory(true); setShowComments(false); }}
            onComments={() => { setShowComments(v => !v); setShowHistory(false); }}
            menuItems={[
              { icon: Link2, label: 'Copy link', shortcut: '⌘⇧L', onClick: () => onCopyLink() },
              { icon: Pin, label: 'Pin to top', onClick: () => {} },
              { icon: Download, label: 'Download', onClick: () => editorRef.current?.exportPNG() },
              { icon: Share2, label: 'Share', onClick: () => {} },
              { icon: Trash2, label: 'Move to Trash', danger: true, onClick: handleDelete },
              { icon: Clock, label: 'Version History', separator: true, shortcut: '⌘⇧H', onClick: () => { setShowHistory(true); setShowComments(false); } },
              { icon: MessageSquareIcon, label: 'Comments', shortcut: '⌘J', onClick: () => { setShowComments(true); setShowHistory(false); } },
              { icon: Search, label: 'Search', shortcut: '⌘F', onClick: () => {} },
            ]}
            actions={<>
              {/* Search */}
              <button className="p-2 text-black/70 dark:text-white/70 hover:text-foreground rounded transition-colors" title={t('toolbar.search')}>
                <Search className="h-4 w-4" />
              </button>
              {/* Share button */}
              <button className="flex items-center gap-1.5 h-8 px-3 ml-1 border border-black/20 dark:border-white/20 rounded-lg text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors">
                <ExternalLink className="h-4 w-4" />
                {t('actions.share')}
              </button>
              {/* History */}
              <button
                onClick={() => { setShowHistory(v => !v); setShowComments(false); }}
                className={cn('flex items-center justify-center w-8 h-8 ml-1 border border-black/20 dark:border-white/20 rounded-lg transition-colors', showHistory ? 'text-sidebar-primary bg-sidebar-primary/10 border-sidebar-primary/20' : 'text-black/70 dark:text-white/70 hover:bg-black/[0.04]')}
                title={t('content.versionHistory')}
              >
                <Clock className="h-4 w-4" />
              </button>
              {/* @ Comments */}
              <button
                onClick={() => { setShowComments(v => !v); setShowHistory(false); }}
                className={cn('flex items-center justify-center w-8 h-8 ml-1 rounded-lg transition-colors', showComments ? 'bg-sidebar-primary/80' : 'bg-sidebar-primary hover:bg-sidebar-primary/90')}
                title={t('content.comments')}
              >
                <AtSign className="h-4 w-4 text-white" />
              </button>
            </>}
          />
        </div>

        {/* DiagramEditor — only the canvas area */}
        <div className="flex-1 min-h-0 flex flex-col">
          <DiagramEditor
            diagramId={diagramId}
            editorRef={editorRef}
            onSaveStatusChange={setSaveStatus}
            onDeleted={onDeleted}
            showComments={false}
            showHistory={false}
          />
        </div>
        {/* Mobile: bottom comment bar — no editing on mobile */}
        <MobileCommentBar
          targetType="diagram"
          targetId={`diagram:${diagramId}`}
        />
      </div>

      {/* Right column: Comments panel — full height */}
      {showComments && !showHistory && (
        <>
          <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
            <CommentPanel
              targetType="diagram"
              targetId={`diagram:${diagramId}`}
              onClose={() => setShowComments(false)}
            />
          </div>
          <BottomSheet open={true} onClose={() => setShowComments(false)} title={t('content.comments')} initialHeight="full">
            <CommentPanel
              targetType="diagram"
              targetId={`diagram:${diagramId}`}
              onClose={() => setShowComments(false)}
            />
          </BottomSheet>
        </>
      )}

      {/* Right column: Version History panel — full height */}
      {showHistory && (
        <>
          <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
            <RevisionHistory
              contentType="diagram"
              contentId={diagramId}
              onClose={() => setShowHistory(false)}
              onRestore={async (data) => {
                await editorRef.current?.restoreFromSnapshot(data);
              }}
            />
          </div>
          <BottomSheet open={true} onClose={() => setShowHistory(false)} title={t('content.versionHistory')} initialHeight="full">
            <RevisionHistory
              contentType="diagram"
              contentId={diagramId}
              onClose={() => setShowHistory(false)}
              onRestore={async (data) => {
                await editorRef.current?.restoreFromSnapshot(data);
              }}
            />
          </BottomSheet>
        </>
      )}

      {/* Mobile: More menu is now handled by ContentTopBar via menuItems */}

    </div>
  );
}
