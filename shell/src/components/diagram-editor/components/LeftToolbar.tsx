'use client';

import { useState, useCallback } from 'react';
import type { Graph } from '@antv/x6';
import {
  MousePointer2, Type, Square, Spline, Brain, ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SHAPE_META, DEFAULT_NODE_COLOR,
  type FlowchartShape, type ConnectorType,
  CONNECTOR_META,
} from '../constants';

export type ActiveTool = 'select' | 'text' | FlowchartShape | 'connector' | 'mindmap';

interface LeftToolbarProps {
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
  activeConnector: ConnectorType;
  onConnectorChange: (c: ConnectorType) => void;
  graph: Graph | null;
}

export function LeftToolbar({ activeTool, onToolChange, activeConnector, onConnectorChange, graph }: LeftToolbarProps) {
  const [showShapes, setShowShapes] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);

  const isShapeTool = Object.keys(SHAPE_META).includes(activeTool);

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

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1 bg-white rounded-xl shadow-lg border border-gray-200 p-1.5">
      {/* Select */}
      <ToolButton
        active={activeTool === 'select'}
        onClick={() => { onToolChange('select'); setShowShapes(false); setShowConnectors(false); }}
        title="选择 (V)"
      >
        <MousePointer2 size={18} />
      </ToolButton>

      {/* Text */}
      <ToolButton
        active={activeTool === 'text'}
        onClick={() => { onToolChange('text'); setShowShapes(false); setShowConnectors(false); }}
        title="文本 (T)"
      >
        <Type size={18} />
      </ToolButton>

      {/* Shapes */}
      <div className="relative">
        <ToolButton
          active={isShapeTool}
          onClick={() => { setShowShapes(!showShapes); setShowConnectors(false); }}
          title="图形 (R)"
        >
          <Square size={18} />
        </ToolButton>

        {showShapes && (
          <div className="absolute left-full top-0 ml-2 bg-white rounded-lg shadow-lg border border-gray-200 p-2 w-[200px] grid grid-cols-2 gap-1">
            {(Object.entries(SHAPE_META) as [FlowchartShape, typeof SHAPE_META[FlowchartShape]][]).map(([key, meta]) => (
              <button
                key={key}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-gray-100 transition-colors text-left',
                  activeTool === key && 'bg-blue-50 text-blue-600',
                )}
                onClick={() => { onToolChange(key); setShowShapes(false); }}
                draggable
                onDragStart={handleDragStart(key)}
              >
                <span className="text-base w-5 text-center">{meta.icon}</span>
                <span>{meta.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Connectors */}
      <div className="relative">
        <ToolButton
          active={activeTool === 'connector'}
          onClick={() => { setShowConnectors(!showConnectors); setShowShapes(false); }}
          title="连线 (L)"
        >
          <Spline size={18} />
        </ToolButton>

        {showConnectors && (
          <div className="absolute left-full top-0 ml-2 bg-white rounded-lg shadow-lg border border-gray-200 p-2 w-[160px]">
            {(Object.entries(CONNECTOR_META) as [ConnectorType, typeof CONNECTOR_META[ConnectorType]][]).map(([key, meta]) => (
              <button
                key={key}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-gray-100 transition-colors w-full text-left',
                  activeConnector === key && 'bg-blue-50 text-blue-600',
                )}
                onClick={() => { onConnectorChange(key); onToolChange('connector'); setShowConnectors(false); }}
              >
                {meta.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mindmap */}
      <ToolButton
        active={activeTool === 'mindmap'}
        onClick={() => { onToolChange('mindmap'); setShowShapes(false); setShowConnectors(false); }}
        title="思维导图 (M)"
      >
        <Brain size={18} />
      </ToolButton>

      {/* Image (placeholder) */}
      <ToolButton
        active={false}
        onClick={() => {}}
        title="图片"
        disabled
      >
        <ImageIcon size={18} />
      </ToolButton>
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
        'w-9 h-9 flex items-center justify-center rounded-lg transition-colors',
        active ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
      onClick={disabled ? undefined : onClick}
      title={title}
    >
      {children}
    </button>
  );
}
