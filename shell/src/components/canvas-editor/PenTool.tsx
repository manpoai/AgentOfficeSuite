'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { serializePath, type PathPoint, type ParsedPath } from '@/components/shared/svg-path-utils';

interface PenToolProps {
  scale: number;
  panX: number;
  panY: number;
  frameX?: number;
  frameY?: number;
  frameW: number;
  frameH: number;
  onComplete: (html: string, x: number, y: number, w: number, h: number) => void;
  onCancel: () => void;
}

const ANCHOR_SIZE = 6;
const CLOSE_THRESHOLD = 10;
const DRAG_THRESHOLD = 4;

export function PenTool({
  scale, panX, panY, frameX = 0, frameY = 0, frameW, frameH,
  onComplete, onCancel,
}: PenToolProps) {
  const [points, setPoints] = useState<PathPoint[]>([]);
  const [previewPoint, setPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const clientToCanvas = (clientX: number, clientY: number) => ({
    x: (clientX - panX) / scale - frameX,
    y: (clientY - panY) / scale - frameY,
  });

  const canvasToScreen = (cx: number, cy: number) => ({
    x: panX + (frameX + cx) * scale,
    y: panY + (frameY + cy) * scale,
  });

  const finishPath = useCallback((closed: boolean) => {
    if (points.length < 2) { onCancel(); return; }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of points) {
      minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
    }
    const pad = 4;
    const x = minX - pad, y = minY - pad;
    const w = Math.max(maxX - minX + pad * 2, 1);
    const h = Math.max(maxY - minY + pad * 2, 1);

    const shifted = points.map(pt => ({ ...pt, x: pt.x - x, y: pt.y - y }));
    const d = serializePath({ points: shifted, closed });

    const fill = closed ? '#e0e7ff' : 'none';
    const html = `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${d}" fill="${fill}" stroke="#374151" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>`;

    onComplete(html, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }, [points, onComplete, onCancel]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Enter') { finishPath(false); return; }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [finishPath, onCancel]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
    setIsDragging(false);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    setPreviewPoint({ x, y });

    if (dragStartRef.current && points.length > 0) {
      const dist = Math.hypot(e.clientX - dragStartRef.current.clientX, e.clientY - dragStartRef.current.clientY);
      if (dist > DRAG_THRESHOLD) {
        setIsDragging(true);
        const dx = (e.clientX - dragStartRef.current.clientX) / scale;
        const dy = (e.clientY - dragStartRef.current.clientY) / scale;
        setPoints(prev => {
          const pts = [...prev];
          const last = { ...pts[pts.length - 1] };
          last.handleOut = { x: dx, y: dy };
          last.handleIn = { x: -dx, y: -dy };
          last.type = 'smooth';
          pts[pts.length - 1] = last;
          return pts;
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging && dragStartRef.current) {
      const { x, y } = clientToCanvas(e.clientX, e.clientY);

      if (points.length >= 3) {
        const first = canvasToScreen(points[0].x, points[0].y);
        const dist = Math.hypot(e.clientX - first.x, e.clientY - first.y);
        if (dist < CLOSE_THRESHOLD) { finishPath(true); dragStartRef.current = null; return; }
      }

      setPoints(prev => [...prev, { x, y, type: 'corner' }]);
    }
    dragStartRef.current = null;
    setIsDragging(false);
  };

  return (
    <svg
      className="absolute inset-0 pointer-events-auto"
      style={{ width: '100%', height: '100%', zIndex: 9998, cursor: 'crosshair' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Path preview */}
      {points.length > 0 && (() => {
        const parsed: ParsedPath = { points, closed: false };
        const d = serializePath(parsed);
        const first = canvasToScreen(points[0].x, points[0].y);
        return (
          <g>
            <path d={d} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 3"
              transform={`translate(${panX + frameX * scale}, ${panY + frameY * scale}) scale(${scale})`} />
            {previewPoint && (
              <line
                x1={canvasToScreen(points[points.length - 1].x, points[points.length - 1].y).x}
                y1={canvasToScreen(points[points.length - 1].x, points[points.length - 1].y).y}
                x2={canvasToScreen(previewPoint.x, previewPoint.y).x}
                y2={canvasToScreen(previewPoint.x, previewPoint.y).y}
                stroke="#3b82f6" strokeWidth={1} strokeDasharray="2 2" opacity={0.5}
              />
            )}
          </g>
        );
      })()}

      {/* Anchor points */}
      {points.map((pt, i) => {
        const s = canvasToScreen(pt.x, pt.y);
        return (
          <rect key={i}
            x={s.x - ANCHOR_SIZE} y={s.y - ANCHOR_SIZE}
            width={ANCHOR_SIZE * 2} height={ANCHOR_SIZE * 2}
            fill={i === 0 && points.length >= 3 ? '#ef4444' : 'white'}
            stroke="#3b82f6" strokeWidth={2}
            rx={pt.type === 'corner' ? 0 : ANCHOR_SIZE}
          />
        );
      })}

      {/* Handle lines for last point if dragging */}
      {points.length > 0 && points[points.length - 1].handleOut && (() => {
        const last = points[points.length - 1];
        const anchor = canvasToScreen(last.x, last.y);
        const hOut = canvasToScreen(last.x + (last.handleOut!.x / scale * scale), last.y + (last.handleOut!.y / scale * scale));
        return (
          <>
            <line x1={anchor.x} y1={anchor.y} x2={anchor.x + last.handleOut!.x} y2={anchor.y + last.handleOut!.y}
              stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 2" />
            <circle cx={anchor.x + last.handleOut!.x} cy={anchor.y + last.handleOut!.y} r={4}
              fill="#3b82f6" stroke="white" strokeWidth={1.5} />
          </>
        );
      })()}
    </svg>
  );
}
