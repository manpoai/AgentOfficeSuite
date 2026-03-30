'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Graph } from '@antv/x6';
import { SHAPE_META, DEFAULT_NODE_COLOR, type FlowchartShape } from '../constants';
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
    || Object.keys(SHAPE_META).includes(activeTool);

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

  const poly = (points: string) => (
    <svg width={w} height={h}>
      <polygon points={points} fill={fill} stroke={stroke} strokeWidth={2} />
    </svg>
  );

  const pathEl = (d: string, useFill = true) => (
    <svg width={w} height={h}>
      <path d={d} fill={useFill ? fill : 'none'} stroke={stroke} strokeWidth={2} />
    </svg>
  );

  switch (shape) {
    case 'rect':
      return (
        <svg width={w} height={h}>
          <rect x={1} y={1} width={w - 2} height={h - 2} fill={fill} stroke={stroke} strokeWidth={2} />
        </svg>
      );

    case 'diamond':
      return poly(`${w / 2},${s} ${w - s},${h / 2} ${w / 2},${h - s} ${s},${h / 2}`);

    case 'circle':
    case 'ellipse':
      return (
        <svg width={w} height={h}>
          <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - s} ry={h / 2 - s} fill={fill} stroke={stroke} strokeWidth={2} />
        </svg>
      );

    case 'parallelogram':
      return poly(`${w * 0.15},${h - s} ${s},${s} ${w * 0.85},${s} ${w - s},${h - s}`);

    case 'triangle':
      return poly(`${w / 2},${s} ${w - s},${h - s} ${s},${h - s}`);

    case 'stadium':
      return (
        <svg width={w} height={h}>
          <rect x={1} y={1} width={w - 2} height={h - 2} rx={Math.min(h / 2, w / 4)} ry={Math.min(h / 2, w / 4)} fill={fill} stroke={stroke} strokeWidth={2} />
        </svg>
      );

    case 'hexagon':
      return poly(`${w * 0.25},${s} ${w * 0.75},${s} ${w - s},${h / 2} ${w * 0.75},${h - s} ${w * 0.25},${h - s} ${s},${h / 2}`);

    case 'pentagon':
      return poly(`${w / 2},${s} ${w - s},${h * 0.38} ${w * 0.82},${h - s} ${w * 0.18},${h - s} ${s},${h * 0.38}`);

    case 'octagon': {
      const o = Math.min(w, h) * 0.29;
      return poly(`${o},${s} ${w - o},${s} ${w - s},${o} ${w - s},${h - o} ${w - o},${h - s} ${o},${h - s} ${s},${h - o} ${s},${o}`);
    }

    case 'star': {
      const cx = w / 2, cy = h / 2;
      const outerR = Math.min(w, h) / 2 - s;
      const innerR = outerR * 0.38;
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const ao = (Math.PI / 2) + (i * 2 * Math.PI / 5);
        const ai = (Math.PI / 2) + ((i + 0.5) * 2 * Math.PI / 5);
        pts.push(`${cx - outerR * Math.cos(ao)},${cy - outerR * Math.sin(ao)}`);
        pts.push(`${cx - innerR * Math.cos(ai)},${cy - innerR * Math.sin(ai)}`);
      }
      return poly(pts.join(' '));
    }

    case 'cross':
      return poly(`${w * 0.33},${s} ${w * 0.67},${s} ${w * 0.67},${h * 0.33} ${w - s},${h * 0.33} ${w - s},${h * 0.67} ${w * 0.67},${h * 0.67} ${w * 0.67},${h - s} ${w * 0.33},${h - s} ${w * 0.33},${h * 0.67} ${s},${h * 0.67} ${s},${h * 0.33} ${w * 0.33},${h * 0.33}`);

    case 'cloud':
      return pathEl(
        `M${w * 0.25},${h * 0.75} ` +
        `a${w * 0.15},${h * 0.2} 0 0,1 ${w * 0.05},-${h * 0.35} ` +
        `a${w * 0.2},${h * 0.25} 0 0,1 ${w * 0.35},-${h * 0.15} ` +
        `a${w * 0.2},${h * 0.2} 0 0,1 ${w * 0.25},${h * 0.1} ` +
        `a${w * 0.15},${h * 0.2} 0 0,1 ${w * 0.05},${h * 0.3} z`,
      );

    case 'cylinder':
      return (
        <svg width={w} height={h}>
          <ellipse cx={w / 2} cy={h * 0.15} rx={w / 2 - s} ry={h * 0.15 - s} fill={fill} stroke={stroke} strokeWidth={2} />
          <path d={`M${s},${h * 0.15} v${h * 0.7} a${w / 2 - s},${h * 0.15 - s} 0 0,0 ${w - 2 * s},0 v-${h * 0.7}`} fill={fill} stroke={stroke} strokeWidth={2} />
        </svg>
      );

    case 'arrow-right':
      return poly(`${s},${h * 0.2} ${w * 0.65},${h * 0.2} ${w * 0.65},${s} ${w - s},${h / 2} ${w * 0.65},${h - s} ${w * 0.65},${h * 0.8} ${s},${h * 0.8}`);

    case 'arrow-left':
      return poly(`${w - s},${h * 0.2} ${w * 0.35},${h * 0.2} ${w * 0.35},${s} ${s},${h / 2} ${w * 0.35},${h - s} ${w * 0.35},${h * 0.8} ${w - s},${h * 0.8}`);

    case 'arrow-double':
      return poly(`${s},${h / 2} ${w * 0.2},${s} ${w * 0.2},${h * 0.25} ${w * 0.8},${h * 0.25} ${w * 0.8},${s} ${w - s},${h / 2} ${w * 0.8},${h - s} ${w * 0.8},${h * 0.75} ${w * 0.2},${h * 0.75} ${w * 0.2},${h - s}`);

    case 'chevron-right':
      return poly(`${s},${s} ${w * 0.75},${s} ${w - s},${h / 2} ${w * 0.75},${h - s} ${s},${h - s} ${w * 0.25},${h / 2}`);

    case 'chevron-left':
      return poly(`${w - s},${s} ${w * 0.25},${s} ${s},${h / 2} ${w * 0.25},${h - s} ${w - s},${h - s} ${w * 0.75},${h / 2}`);

    case 'trapezoid':
      return poly(`${w * 0.15},${s} ${w * 0.85},${s} ${w - s},${h - s} ${s},${h - s}`);

    case 'callout':
      return pathEl(`M${s},${s} h${w - 2 * s} v${h * 0.7} h-${w * 0.55} l-${w * 0.1},${h * 0.25} v-${h * 0.25} h-${w * 0.35 + s - 2 * s} z`);

    case 'brace-left':
      return pathEl(`M${w - s},${s} Q${w * 0.5},${s} ${w * 0.5},${h * 0.25} T${s},${h / 2} Q${w * 0.5},${h * 0.5} ${w * 0.5},${h * 0.75} T${w - s},${h - s}`, false);

    case 'brace-right':
      return pathEl(`M${s},${s} Q${w * 0.5},${s} ${w * 0.5},${h * 0.25} T${w - s},${h / 2} Q${w * 0.5},${h * 0.5} ${w * 0.5},${h * 0.75} T${s},${h - s}`, false);

    default: // rounded-rect
      return (
        <svg width={w} height={h}>
          <rect x={1} y={1} width={w - 2} height={h - 2} rx={8} ry={8} fill={fill} stroke={stroke} strokeWidth={2} />
        </svg>
      );
  }
}
