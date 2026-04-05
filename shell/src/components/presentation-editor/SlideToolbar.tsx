'use client';

import { useState } from 'react';
import {
  Type, Hexagon, Image as ImageIcon, Table2, Workflow,
  Plus, Minus, PanelRightClose, PanelRight,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ShapePicker } from '@/components/shared/ShapeSet';
import type { ShapeType } from '@/components/shared/ShapeSet/shapes';
import { fitCanvasToContainer } from './types';

// ─── Toolbar Button ─────────────────────────────────
function ToolBtn({ icon: Icon, onClick, active, title }: {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-1.5 rounded transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      )}
      title={title}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ─── Floating Toolbar (top center of canvas) ────────
export interface SlideToolbarProps {
  onAddTextbox: () => void;
  onAddShape: (shapeType: ShapeType) => void;
  onAddImage: () => void;
  onAddTable: () => void;
  onInsertDiagram: () => void;
  showPropertyPanel: boolean;
  onTogglePropertyPanel: () => void;
}

export function SlideToolbar({
  onAddTextbox,
  onAddShape,
  onAddImage,
  onAddTable,
  onInsertDiagram,
  showPropertyPanel,
  onTogglePropertyPanel,
}: SlideToolbarProps) {
  const { t } = useT();
  const [showShapePicker, setShowShapePicker] = useState(false);

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-card rounded border border-black/10 dark:border-white/10 px-3 h-10 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
      <ToolBtn icon={Type} onClick={onAddTextbox} title={t('toolbar.text')} />
      <div className="relative">
        <ToolBtn icon={Hexagon} active={showShapePicker} onClick={() => setShowShapePicker(v => !v)} title={t('toolbar.shapes')} />
        {showShapePicker && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowShapePicker(false)} />
            <div className="absolute left-0 top-full mt-1 z-20">
              <ShapePicker onSelect={(s: ShapeType) => { onAddShape(s); setShowShapePicker(false); }} columns={6} />
            </div>
          </>
        )}
      </div>
      <ToolBtn icon={ImageIcon} onClick={onAddImage} title={t('toolbar.image')} />
      <ToolBtn icon={Table2} onClick={onAddTable} title={t('toolbar.table')} />
      <ToolBtn icon={Workflow} onClick={onInsertDiagram} title={t('toolbar.insertDiagram')} />
      <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
      <button
        onClick={onTogglePropertyPanel}
        className={cn(
          'p-1.5 rounded transition-colors',
          showPropertyPanel ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
        )}
        title={showPropertyPanel ? 'Hide properties' : 'Show properties'}
      >
        {showPropertyPanel ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ─── Zoom Bar (bottom right of canvas) ──────────────
export interface ZoomBarProps {
  canvasRef: React.RefObject<any>;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function ZoomBar({ canvasRef, canvasContainerRef }: ZoomBarProps) {
  const { t } = useT();
  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 bg-card/50 backdrop-blur-sm rounded border border-black/10 dark:border-white/10 px-3 h-10">
      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/[0.04] text-black/70 dark:text-white/70"
        onClick={() => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const newZoom = Math.max(0.1, canvas.getZoom() - 0.1);
          canvas.setZoom(newZoom);
          fitCanvasToContainer(canvas, canvasContainerRef.current!);
        }}
        title={t('toolbar.zoomOut')}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="text-sm font-medium text-black/70 dark:text-white/70 w-10 text-center tabular-nums">
        {canvasRef.current ? Math.round(canvasRef.current.getZoom() * 100) : 100}%
      </span>
      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/[0.04] text-black/70 dark:text-white/70"
        onClick={() => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const newZoom = Math.min(3, canvas.getZoom() + 0.1);
          canvas.setZoom(newZoom);
          fitCanvasToContainer(canvas, canvasContainerRef.current!);
        }}
        title={t('toolbar.zoomIn')}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
