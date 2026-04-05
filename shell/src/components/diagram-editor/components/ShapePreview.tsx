'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Graph } from '@antv/x6';
import { SHAPE_META, DEFAULT_NODE_COLOR, type FlowchartShape } from '../constants';
import { SHAPE_MAP } from '@/components/shared/ShapeSet/shapes';
import type { ActiveTool } from './LeftToolbar';

interface ShapePreviewProps {
  activeTool: ActiveTool;
  containerRef: React.RefObject<HTMLDivElement | null>;
  graph: Graph | null;
  onDragCreate?: (localX: number, localY: number, localW: number, localH: number) => void;
}

const DRAG_THRESHOLD = 5;
const CURSOR_OFFSET = 12;

export function ShapePreview({ activeTool, containerRef, graph, onDragCreate }: ShapePreviewProps) {
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const rafRef = useRef(0);
  const isDraggingRef = useRef(false);
  const graphRef = useRef(graph);
  const onDragCreateRef = useRef(onDragCreate);
  graphRef.current = graph;
  onDragCreateRef.current = onDragCreate;

  const isShapeTool = activeTool === 'text'
    || SHAPE_MAP.has(activeTool as any);

  const shapeMeta = activeTool === 'text'
    ? { width: 120, height: 40 }
    : SHAPE_META[activeTool as FlowchartShape] ?? null;

  const shapeKey = activeTool === 'text' ? 'rounded-rect' : activeTool as FlowchartShape;
  const zoom = graph?.zoom() ?? 1;

  // Hover preview: follow mouse
  useEffect(() => {
    if (!isShapeTool || !containerRef.current) {
      setHoverPos(null);
      return;
    }
    const container = containerRef.current;

    const onMove = (e: MouseEvent) => {
      if (isDraggingRef.current) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setHoverPos({ x: e.clientX, y: e.clientY });
      });
    };
    const onLeave = () => {
      if (!isDraggingRef.current) setHoverPos(null);
    };

    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(rafRef.current);
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', onLeave);
    };
  }, [isShapeTool, containerRef]);

  // Drag-to-create: mousedown on container → track drag → mouseup creates node.
  // Uses refs for graph/onDragCreate to avoid effect re-runs during drag.
  useEffect(() => {
    if (!isShapeTool || !containerRef.current) return;
    const container = containerRef.current;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!graphRef.current) return;
      const target = e.target as Element;
      if (target.closest?.('.x6-widget-selection') ||
          target.closest?.('[data-cell-id]') ||
          target.closest?.('foreignObject')) {
        return;
      }

      const g = graphRef.current;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const onMove = (me: MouseEvent) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (!dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          dragging = true;
          isDraggingRef.current = true;
          setHoverPos(null);
        }
        if (dragging) {
          const left = Math.min(startX, me.clientX);
          const top = Math.min(startY, me.clientY);
          const w = Math.abs(me.clientX - startX);
          const h = Math.abs(me.clientY - startY);
          setDragRect({ x: left, y: top, w, h });
        }
      };

      const onUp = (me: MouseEvent) => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);

        if (dragging && onDragCreateRef.current) {
          const startLocal = g.clientToLocal(startX, startY);
          const endLocal = g.clientToLocal(me.clientX, me.clientY);
          const lx = Math.min(startLocal.x, endLocal.x);
          const ly = Math.min(startLocal.y, endLocal.y);
          const lw = Math.abs(endLocal.x - startLocal.x);
          const lh = Math.abs(endLocal.y - startLocal.y);
          if (lw > 5 && lh > 5) {
            onDragCreateRef.current(lx, ly, lw, lh);
          }
        }
        dragging = false;
        isDraggingRef.current = false;
        setDragRect(null);
      };

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    };

    container.addEventListener('mousedown', onMouseDown, true);
    return () => {
      container.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [isShapeTool, containerRef]);

  // ─── Drag rectangle preview ───
  if (dragRect && dragRect.w > DRAG_THRESHOLD && dragRect.h > DRAG_THRESHOLD) {
    return (
      <div
        style={{
          position: 'fixed',
          left: dragRect.x,
          top: dragRect.y,
          width: dragRect.w,
          height: dragRect.h,
          pointerEvents: 'none',
          zIndex: 50,
        }}
      >
        <ShapeSvg shape={shapeKey} width={dragRect.w} height={dragRect.h} />
      </div>
    );
  }

  // ─── Cursor-following preview ───
  if (!shapeMeta || !hoverPos) return null;

  const { width: baseW, height: baseH } = shapeMeta;
  const scaledW = baseW * zoom;
  const scaledH = baseH * zoom;

  return (
    <div
      style={{
        position: 'fixed',
        left: hoverPos.x + CURSOR_OFFSET,
        top: hoverPos.y + CURSOR_OFFSET,
        width: scaledW,
        height: scaledH,
        pointerEvents: 'none',
        opacity: 0.4,
        zIndex: 50,
      }}
    >
      <ShapeSvg shape={shapeKey} width={scaledW} height={scaledH} />
    </div>
  );
}

function ShapeSvg({ shape, width: w, height: h }: { shape: string; width: number; height: number }) {
  const fill = DEFAULT_NODE_COLOR.bg;
  const stroke = DEFAULT_NODE_COLOR.border;
  const s = 2; // stroke inset

  // CSS-based shapes for pixel-perfect rendering
  if (shape === 'rect') {
    return (
      <svg width={w} height={h}>
        <rect x={1} y={1} width={w - 2} height={h - 2} fill={fill} stroke={stroke} strokeWidth={2} />
      </svg>
    );
  }

  if (shape === 'circle' || shape === 'ellipse') {
    return (
      <svg width={w} height={h}>
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - s} ry={h / 2 - s} fill={fill} stroke={stroke} strokeWidth={2} />
      </svg>
    );
  }

  if (shape === 'stadium') {
    return (
      <svg width={w} height={h}>
        <rect x={1} y={1} width={w - 2} height={h - 2} rx={Math.min(h / 2, w / 4)} ry={Math.min(h / 2, w / 4)} fill={fill} stroke={stroke} strokeWidth={2} />
      </svg>
    );
  }

  if (shape === 'rounded-rect') {
    return (
      <svg width={w} height={h}>
        <rect x={1} y={1} width={w - 2} height={h - 2} rx={8} ry={8} fill={fill} stroke={stroke} strokeWidth={2} />
      </svg>
    );
  }

  // Cylinder: special multi-element SVG
  if (shape === 'cylinder') {
    return (
      <svg width={w} height={h}>
        <ellipse cx={w / 2} cy={h * 0.15} rx={w / 2 - s} ry={h * 0.15 - s} fill={fill} stroke={stroke} strokeWidth={2} />
        <path d={`M${s},${h * 0.15} v${h * 0.7} a${w / 2 - s},${h * 0.15 - s} 0 0,0 ${w - 2 * s},0 v-${h * 0.7}`} fill={fill} stroke={stroke} strokeWidth={2} />
      </svg>
    );
  }

  // All other shapes: use shared renderPath
  const shapeDef = SHAPE_MAP.get(shape as any);
  if (shapeDef) {
    const isBrace = shape === 'brace-left' || shape === 'brace-right';
    const pathData = shapeDef.renderPath(w, h);
    return (
      <svg width={w} height={h}>
        <path d={pathData} fill={isBrace ? 'none' : fill} stroke={stroke} strokeWidth={2} />
      </svg>
    );
  }

  // Fallback: rounded-rect
  return (
    <svg width={w} height={h}>
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={8} ry={8} fill={fill} stroke={stroke} strokeWidth={2} />
    </svg>
  );
}
