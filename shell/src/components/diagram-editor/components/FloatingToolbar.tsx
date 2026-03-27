'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Graph, Node, Edge, Cell } from '@antv/x6';
import {
  Bold, Italic, Underline, Trash2, Copy, ArrowUp, ArrowDown, MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NODE_COLORS, SHAPE_META, type FlowchartShape } from '../constants';

interface FloatingToolbarProps {
  graph: Graph | null;
}

export function FloatingToolbar({ graph }: FloatingToolbarProps) {
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [showMore, setShowMore] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Track selection
  useEffect(() => {
    if (!graph) return;

    const updateSelection = () => {
      const cells = graph.getSelectedCells();
      if (cells.length === 1) {
        const cell = cells[0];
        setSelectedCell(cell);
        updatePosition(cell);
      } else {
        setSelectedCell(null);
        setPosition(null);
      }
      setShowMore(false);
    };

    const updatePosition = (cell: Cell) => {
      if (!cell.isNode()) {
        // For edges, show near the midpoint
        const edge = cell as Edge;
        const view = graph.findViewByCell(edge);
        if (view) {
          const bbox = view.getBBox();
          const graphRect = graph.container.getBoundingClientRect();
          setPosition({
            x: bbox.x + bbox.width / 2 - graphRect.x,
            y: bbox.y - 50 - graphRect.y,
          });
        }
        return;
      }
      const node = cell as Node;
      const pos = node.position();
      const size = node.size();
      const graphPoint = graph.localToGraph(pos.x + size.width / 2, pos.y);
      setPosition({ x: graphPoint.x, y: graphPoint.y - 50 });
    };

    graph.on('selection:changed', updateSelection);
    graph.on('node:moved', () => {
      if (selectedCell?.isNode()) updatePosition(selectedCell);
    });

    return () => {
      graph.off('selection:changed', updateSelection);
    };
  }, [graph, selectedCell]);

  // Close toolbar on click outside
  useEffect(() => {
    if (!selectedCell) return;
    const handleClick = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as HTMLElement)) {
        setShowMore(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectedCell]);

  if (!graph || !selectedCell || !position) return null;

  const isNode = selectedCell.isNode();
  const isEdge = selectedCell.isEdge();
  const data = selectedCell.getData() || {};
  const isMindmap = data.mindmapGroupId;

  const updateData = (updates: Record<string, any>) => {
    selectedCell.setData({ ...selectedCell.getData(), ...updates }, { silent: false });
  };

  const handleDelete = () => {
    graph.removeCells([selectedCell]);
    setSelectedCell(null);
    setPosition(null);
  };

  const handleCopy = () => {
    graph.copy([selectedCell]);
  };

  return (
    <div
      ref={toolbarRef}
      className="absolute z-30 flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-gray-200 px-1 py-0.5"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translateX(-50%)',
      }}
    >
      {isNode && !isMindmap && (
        <>
          {/* Shape switch */}
          <ShapeSelector
            current={data.flowchartShape || 'rounded-rect'}
            onChange={(s) => updateData({ flowchartShape: s })}
          />
          <Divider />
          {/* Fill color */}
          <ColorButton
            color={data.bgColor || '#ffffff'}
            onChange={(c) => updateData({ bgColor: c.bg, borderColor: c.border, textColor: c.text })}
          />
          <Divider />
          {/* Font controls */}
          <FontButton
            icon={<Bold size={14} />}
            active={data.fontWeight === 'bold'}
            onClick={() => updateData({ fontWeight: data.fontWeight === 'bold' ? 'normal' : 'bold' })}
          />
          <FontButton
            icon={<Italic size={14} />}
            active={data.fontStyle === 'italic'}
            onClick={() => updateData({ fontStyle: data.fontStyle === 'italic' ? 'normal' : 'italic' })}
          />
        </>
      )}

      {isEdge && (
        <>
          {/* Edge color */}
          <EdgeColorButton edge={selectedCell as Edge} graph={graph} />
          <Divider />
          {/* Line style */}
          <LineStyleButton edge={selectedCell as Edge} graph={graph} />
        </>
      )}

      {isMindmap && (
        <>
          <ColorButton
            color={data.bgColor || '#ffffff'}
            onChange={(c) => updateData({ bgColor: c.bg, borderColor: c.border, textColor: c.text })}
          />
          <Divider />
          <FontButton
            icon={<Bold size={14} />}
            active={data.fontWeight === 'bold'}
            onClick={() => updateData({ fontWeight: data.fontWeight === 'bold' ? 'normal' : 'bold' })}
          />
        </>
      )}

      <Divider />

      {/* Common actions */}
      <FontButton icon={<Copy size={14} />} active={false} onClick={handleCopy} title="复制" />
      <FontButton icon={<Trash2 size={14} />} active={false} onClick={handleDelete} title="删除" />

      {/* More */}
      <div className="relative">
        <FontButton icon={<MoreHorizontal size={14} />} active={showMore} onClick={() => setShowMore(!showMore)} title="更多" />
        {showMore && (
          <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-32">
            <MoreMenuItem label="置顶" onClick={() => { selectedCell.toFront(); setShowMore(false); }} />
            <MoreMenuItem label="置底" onClick={() => { selectedCell.toBack(); setShowMore(false); }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function Divider() {
  return <div className="w-px h-5 bg-gray-200 mx-0.5" />;
}

function FontButton({ icon, active, onClick, title }: { icon: React.ReactNode; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded transition-colors',
        active ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100',
      )}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}

function ShapeSelector({ current, onChange }: { current: FlowchartShape; onChange: (s: FlowchartShape) => void }) {
  const [open, setOpen] = useState(false);
  const meta = SHAPE_META[current] || SHAPE_META['rounded-rect'];

  return (
    <div className="relative">
      <button
        className="h-7 px-1.5 flex items-center gap-1 rounded hover:bg-gray-100 text-sm text-gray-700"
        onClick={() => setOpen(!open)}
      >
        <span>{meta.icon}</span>
        <span className="text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-1.5 grid grid-cols-2 gap-0.5 w-[180px] z-40">
          {(Object.entries(SHAPE_META) as [FlowchartShape, typeof SHAPE_META[FlowchartShape]][]).map(([key, m]) => (
            <button
              key={key}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-gray-100',
                current === key && 'bg-blue-50 text-blue-600',
              )}
              onClick={() => { onChange(key); setOpen(false); }}
            >
              <span>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorButton({ color, onChange }: { color: string; onChange: (c: typeof NODE_COLORS[0]) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
        onClick={() => setOpen(!open)}
        title="填充色"
      >
        <div className="w-4 h-4 rounded border border-gray-300" style={{ backgroundColor: color }} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 flex flex-wrap gap-1 w-[140px] z-40">
          {NODE_COLORS.map((c, i) => (
            <button
              key={i}
              className={cn('w-6 h-6 rounded border transition-transform hover:scale-110', color === c.bg && 'ring-2 ring-blue-500')}
              style={{ backgroundColor: c.bg, borderColor: c.border }}
              onClick={() => { onChange(c); setOpen(false); }}
              title={c.name}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EdgeColorButton({ edge, graph }: { edge: Edge; graph: Graph }) {
  const [open, setOpen] = useState(false);
  const lineAttrs = edge.getAttrs()?.line || {};
  const currentColor = (lineAttrs as any).stroke || '#94a3b8';

  const colors = ['#94a3b8', '#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#f97316', '#374151'];

  return (
    <div className="relative">
      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
        onClick={() => setOpen(!open)}
        title="线条颜色"
      >
        <div className="w-4 h-1 rounded" style={{ backgroundColor: currentColor }} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 flex flex-wrap gap-1 w-[140px] z-40">
          {colors.map((c) => (
            <button
              key={c}
              className={cn('w-6 h-6 rounded border border-gray-200 transition-transform hover:scale-110', currentColor === c && 'ring-2 ring-blue-500')}
              style={{ backgroundColor: c }}
              onClick={() => { edge.attr('line/stroke', c); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LineStyleButton({ edge, graph }: { edge: Edge; graph: Graph }) {
  const [open, setOpen] = useState(false);
  const lineAttrs = edge.getAttrs()?.line || {};
  const isDashed = !!(lineAttrs as any).strokeDasharray;

  return (
    <div className="relative">
      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-xs text-gray-600"
        onClick={() => setOpen(!open)}
        title="线型"
      >
        {isDashed ? '┄' : '━'}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-24 z-40">
          <button className="w-full px-2 py-1 text-xs text-left hover:bg-gray-100" onClick={() => { edge.attr('line/strokeDasharray', ''); setOpen(false); }}>实线 ━</button>
          <button className="w-full px-2 py-1 text-xs text-left hover:bg-gray-100" onClick={() => { edge.attr('line/strokeDasharray', '8 4'); setOpen(false); }}>虚线 ┄</button>
          <button className="w-full px-2 py-1 text-xs text-left hover:bg-gray-100" onClick={() => { edge.attr('line/strokeDasharray', '2 4'); setOpen(false); }}>点线 ┈</button>
        </div>
      )}
    </div>
  );
}

function MoreMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="w-full px-3 py-1.5 text-sm text-left text-gray-700 hover:bg-gray-100" onClick={onClick}>
      {label}
    </button>
  );
}
