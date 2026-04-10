'use client';

import { useState, useCallback, useRef } from 'react';
import type { Graph } from '@antv/x6';
import {
  Type, ImageIcon, Table2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { pickFile } from '@/lib/utils/pick-file';
import {
  SHAPE_META, DEFAULT_NODE_COLOR,
  type FlowchartShape, type ConnectorType,
} from '../constants';
import { SHAPE_MAP } from '@/components/shared/ShapeSet/shapes';
import { ShapePicker } from '@/components/shared/ShapeSet';

export type ActiveTool = 'select' | 'text' | 'table' | FlowchartShape | 'connector' | 'mindmap';

interface LeftToolbarProps {
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
  activeConnector: ConnectorType;
  onConnectorChange: (c: ConnectorType) => void;
  graph: Graph | null;
}

function ShapeIcon({ shape, size = 20 }: { shape: FlowchartShape; size?: number }) {
  const shapeDef = SHAPE_MAP.get(shape);
  const iconPath = shapeDef?.iconPath ?? '';
  const isBrace = shape === 'brace-left' || shape === 'brace-right';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {isBrace ? (
        <path d={iconPath} fill="none" />
      ) : shape === 'cylinder' ? (
        <>
          <ellipse cx="12" cy="7" rx="8" ry="3" fill="none" />
          <path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" fill="none" />
        </>
      ) : (
        <path d={iconPath} fill="none" />
      )}
    </svg>
  );
}

export function LeftToolbar({ activeTool, onToolChange, activeConnector, onConnectorChange, graph }: LeftToolbarProps) {
  const { t } = useT();
  const [showShapes, setShowShapes] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isShapeTool = SHAPE_MAP.has(activeTool as any);

  const handleDragStart = useCallback((shape: FlowchartShape) => (e: React.DragEvent) => {
    const meta = SHAPE_META[shape];
    e.dataTransfer.setData('application/x6-shape', JSON.stringify({
      shape: 'flowchart-node',
      width: meta.width,
      height: meta.height,
      data: {
        label: '',
        flowchartShape: shape,
        bgColor: DEFAULT_NODE_COLOR.bg,
        borderColor: DEFAULT_NODE_COLOR.border,
        textColor: DEFAULT_NODE_COLOR.text,
        fontSize: 14,
        fontWeight: 'normal',
        fontStyle: 'normal',
      },
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const showShapeList = () => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setShowShapes(true);
  };

  const scheduleHideShapeList = () => {
    hideTimerRef.current = setTimeout(() => setShowShapes(false), 200);
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-card rounded border border-black/10 dark:border-white/10 px-3 h-10 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
      {/* Text */}
      <ToolButton
        active={activeTool === 'text'}
        onClick={() => { onToolChange('text'); setShowShapes(false); }}
        title={t('diagram.tools.text')}
      >
        <Type size={18} />
      </ToolButton>

      {/* Shapes: click = activate default (rounded-rect), hover = expand list */}
      <div
        className="relative"
        onMouseEnter={showShapeList}
        onMouseLeave={scheduleHideShapeList}
      >
        <ToolButton
          active={isShapeTool}
          onClick={() => { onToolChange('rounded-rect'); setShowShapes(false); }}
          title={t('diagram.tools.shape')}
        >
          <ShapeIcon shape="rect" size={18} />
        </ToolButton>

        {showShapes && (
          <div
            className="absolute left-0 top-full mt-2 z-40"
            onMouseEnter={showShapeList}
            onMouseLeave={scheduleHideShapeList}
          >
            <ShapePicker
              onSelect={(shapeType) => { onToolChange(shapeType as FlowchartShape); setShowShapes(false); }}
              selectedShape={isShapeTool ? activeTool as any : undefined}
              draggable
              onDragStart={(shapeType, e) => handleDragStart(shapeType as FlowchartShape)(e)}
              columns={6}
            />
          </div>
        )}
      </div>

      {/* Image */}
      <ToolButton
        active={activeTool === 'image' as any}
        onClick={() => {
          if (!graph) return;
          pickFile({ accept: 'image/*' }).then((files) => {
            const file = files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              const { tx, ty } = graph.translate();
              const { sx } = graph.scale();
              const container = graph.container;
              const cx = (-tx + container.clientWidth / 2) / sx;
              const cy = (-ty + container.clientHeight / 2) / sx;
              const nodeId = `img_${Date.now().toString(36)}`;
              graph.addNode({
                id: nodeId,
                shape: 'image-node',
                x: cx - 100,
                y: cy - 75,
                width: 200,
                height: 150,
                data: { imageUrl: dataUrl },
              });
              graph.select(graph.getCellById(nodeId)!);
              onToolChange('select');
            };
            reader.readAsDataURL(file);
          });
        }}
        title={t('diagram.tools.image')}
      >
        <ImageIcon size={18} />
      </ToolButton>

      {/* Table — temporarily disabled, needs more work */}
      {/* <ToolButton
        active={activeTool === 'table'}
        onClick={() => { onToolChange('table'); setShowShapes(false); }}
        title={t('diagram.tools.table')}
      >
        <Table2 size={18} />
      </ToolButton> */}
    </div>
  );
}

function ToolButton({
  children, active, onClick, title, disabled,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-black/70 dark:text-white/70 hover:bg-black/[0.04]',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
      onClick={disabled ? undefined : onClick}
      title={title}
    >
      {children}
    </button>
  );
}
