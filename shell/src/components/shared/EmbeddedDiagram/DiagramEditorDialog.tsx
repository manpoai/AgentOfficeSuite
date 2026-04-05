'use client';

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useT } from '@/lib/i18n';
import type { DiagramEditorHandle } from '@/components/diagram-editor/X6DiagramEditor';
import { EditorSkeleton } from '@/components/shared/Skeleton';

const X6DiagramEditor = dynamic(
  () => import('@/components/diagram-editor/X6DiagramEditor').then((m) => ({ default: m.default })),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

interface DiagramEditorDialogProps {
  diagramId: string;
  onClose: () => void;
}

export function DiagramEditorDialog({ diagramId, onClose }: DiagramEditorDialogProps) {
  const { t } = useT();
  const backdropRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<DiagramEditorHandle>(null);

  const handleClose = useCallback(async () => {
    // Flush pending save and wait for it to complete before notifying listeners
    await editorRef.current?.flushSave();
    window.dispatchEvent(new CustomEvent('diagram-updated', { detail: { diagramId } }));
    onClose();
  }, [diagramId, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [handleClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) handleClose();
  }, [handleClose]);

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50"
    >
      <div className="relative w-[90vw] h-[85vh] bg-background rounded-lg overflow-hidden shadow-2xl border border-border flex flex-col">
        <div className="flex items-center justify-between h-10 px-3 border-b border-border bg-card shrink-0">
          <span className="text-sm font-medium text-foreground">{t('diagram.editDiagram')}</span>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <X6DiagramEditor diagramId={diagramId} embedded editorRef={editorRef} />
        </div>
      </div>
    </div>,
    document.body
  );
}
