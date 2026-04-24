'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  parsePath, serializePath, extractPathD, updatePathInHtml,
  insertPoint, removePoint,
  type PathPoint, type ParsedPath,
} from '@/components/shared/svg-path-utils';

export interface VectorSelectionInfo {
  points: { index: number; point: PathPoint }[];
  count: number;
}

interface VectorEditorProps {
  elementHtml: string;
  elementX: number;
  elementY: number;
  elementW: number;
  elementH: number;
  scale: number;
  onUpdateHtml: (newHtml: string) => void;
  onExit: () => void;
  onSelectionChange?: (info: VectorSelectionInfo | null) => void;
}

const ANCHOR_SIZE = 6;
const HANDLE_SIZE = 4;

export function VectorEditor({
  elementHtml, elementX, elementY, elementW, elementH,
  scale, onUpdateHtml, onExit, onSelectionChange,
}: VectorEditorProps) {
  const pathD = extractPathD(elementHtml);
  const [parsed, setParsed] = useState<ParsedPath | null>(
    pathD ? parsePath(pathD) : null,
  );
  const [selectedPointIdx, setSelectedPointIdxRaw] = useState<number | null>(null);
  const setSelectedPointIdx = useCallback((idx: number | null) => {
    setSelectedPointIdxRaw(idx);
    if (idx !== null && parsed) {
      const pt = parsed.points[idx];
      if (pt) onSelectionChange?.({ points: [{ index: idx, point: pt }], count: 1 });
    } else {
      onSelectionChange?.(null);
    }
  }, [parsed, onSelectionChange]);
  const [dragState, setDragState] = useState<{
    type: 'anchor' | 'handleIn' | 'handleOut';
    idx: number;
    startX: number; startY: number;
    origX: number; origY: number;
  } | null>(null);

  useEffect(() => {
    if (!parsed || !pathD) return;
    const newD = serializePath(parsed);
    if (newD !== pathD) {
      onUpdateHtml(updatePathInHtml(elementHtml, newD));
    }
  }, [parsed]);

  const viewBox = elementHtml.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
  const vbW = viewBox?.[2] ?? elementW;
  const vbH = viewBox?.[3] ?? elementH;
  const scaleX = elementW / vbW;
  const scaleY = elementH / vbH;

  const toScreen = (px: number, py: number) => ({
    x: (elementX + px * scaleX) * scale,
    y: (elementY + py * scaleY) * scale,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onExit(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPointIdx !== null && parsed) {
        e.preventDefault();
        const updated = removePoint(parsed, selectedPointIdx);
        setParsed(updated);
        setSelectedPointIdx(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPointIdx, parsed, onExit]);

  if (!parsed) return null;

  const handlePointerDown = (
    e: React.PointerEvent,
    type: 'anchor' | 'handleIn' | 'handleOut',
    idx: number,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const pt = parsed.points[idx];
    let origX: number, origY: number;
    if (type === 'anchor') { origX = pt.x; origY = pt.y; }
    else if (type === 'handleIn') { origX = pt.handleIn?.x ?? 0; origY = pt.handleIn?.y ?? 0; }
    else { origX = pt.handleOut?.x ?? 0; origY = pt.handleOut?.y ?? 0; }
    setDragState({ type, idx, startX: e.clientX, startY: e.clientY, origX, origY });
    setSelectedPointIdx(idx);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const dx = (e.clientX - dragState.startX) / scale / scaleX;
    const dy = (e.clientY - dragState.startY) / scale / scaleY;

    setParsed(prev => {
      if (!prev) return prev;
      const points = prev.points.map((pt, i) => {
        if (i !== dragState.idx) return pt;
        if (dragState.type === 'anchor') {
          return { ...pt, x: dragState.origX + dx, y: dragState.origY + dy };
        } else if (dragState.type === 'handleIn') {
          const newHandleIn = { x: dragState.origX + dx, y: dragState.origY + dy };
          if (pt.type === 'symmetric') {
            return { ...pt, handleIn: newHandleIn, handleOut: { x: -newHandleIn.x, y: -newHandleIn.y } };
          }
          return { ...pt, handleIn: newHandleIn };
        } else {
          const newHandleOut = { x: dragState.origX + dx, y: dragState.origY + dy };
          if (pt.type === 'symmetric') {
            return { ...pt, handleOut: newHandleOut, handleIn: { x: -newHandleOut.x, y: -newHandleOut.y } };
          }
          return { ...pt, handleOut: newHandleOut };
        }
      });
      return { ...prev, points };
    });
  };

  const handlePointerUp = () => setDragState(null);

  const handleDoubleClickPoint = (idx: number) => {
    setParsed(prev => {
      if (!prev) return prev;
      const points = prev.points.map((pt, i) => {
        if (i !== idx) return pt;
        if (pt.type === 'corner') {
          return { ...pt, type: 'smooth' as const, handleIn: { x: -20, y: 0 }, handleOut: { x: 20, y: 0 } };
        } else {
          return { ...pt, type: 'corner' as const, handleIn: undefined, handleOut: undefined };
        }
      });
      return { ...prev, points };
    });
  };

  const handleDoubleClickSegment = (afterIndex: number) => {
    setParsed(prev => {
      if (!prev) return prev;
      return insertPoint(prev, afterIndex, 0.5);
    });
  };

  return (
    <svg
      className="absolute inset-0 pointer-events-auto"
      style={{ width: '100%', height: '100%', zIndex: 9999, cursor: 'default' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Segments — clickable for inserting points */}
      {parsed.points.map((pt, i) => {
        if (i === 0) return null;
        const prev = parsed.points[i - 1];
        const from = toScreen(prev.x, prev.y);
        const to = toScreen(pt.x, pt.y);
        return (
          <line key={`seg-${i}`}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke="transparent" strokeWidth={8}
            style={{ cursor: 'pointer' }}
            onDoubleClick={() => handleDoubleClickSegment(i - 1)}
          />
        );
      })}

      {/* Handle lines + handle dots */}
      {parsed.points.map((pt, i) => {
        const anchor = toScreen(pt.x, pt.y);
        const isSelected = selectedPointIdx === i;
        const elements: React.ReactNode[] = [];

        if (pt.handleIn && (pt.handleIn.x !== 0 || pt.handleIn.y !== 0) && isSelected) {
          const hx = pt.x + pt.handleIn.x;
          const hy = pt.y + pt.handleIn.y;
          const h = toScreen(hx, hy);
          elements.push(
            <line key={`hi-line-${i}`} x1={anchor.x} y1={anchor.y} x2={h.x} y2={h.y}
              stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 2" />,
            <circle key={`hi-dot-${i}`} cx={h.x} cy={h.y} r={HANDLE_SIZE}
              fill="#3b82f6" stroke="white" strokeWidth={1.5}
              style={{ cursor: 'grab' }}
              onPointerDown={e => handlePointerDown(e, 'handleIn', i)} />,
          );
        }

        if (pt.handleOut && (pt.handleOut.x !== 0 || pt.handleOut.y !== 0) && isSelected) {
          const hx = pt.x + pt.handleOut.x;
          const hy = pt.y + pt.handleOut.y;
          const h = toScreen(hx, hy);
          elements.push(
            <line key={`ho-line-${i}`} x1={anchor.x} y1={anchor.y} x2={h.x} y2={h.y}
              stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 2" />,
            <circle key={`ho-dot-${i}`} cx={h.x} cy={h.y} r={HANDLE_SIZE}
              fill="#3b82f6" stroke="white" strokeWidth={1.5}
              style={{ cursor: 'grab' }}
              onPointerDown={e => handlePointerDown(e, 'handleOut', i)} />,
          );
        }

        return <g key={`handles-${i}`}>{elements}</g>;
      })}

      {/* Anchor points */}
      {parsed.points.map((pt, i) => {
        const s = toScreen(pt.x, pt.y);
        const isSelected = selectedPointIdx === i;
        return (
          <rect key={`anchor-${i}`}
            x={s.x - ANCHOR_SIZE} y={s.y - ANCHOR_SIZE}
            width={ANCHOR_SIZE * 2} height={ANCHOR_SIZE * 2}
            fill={isSelected ? '#3b82f6' : 'white'}
            stroke="#3b82f6" strokeWidth={2}
            rx={pt.type === 'corner' ? 0 : ANCHOR_SIZE}
            style={{ cursor: 'grab' }}
            onPointerDown={e => handlePointerDown(e, 'anchor', i)}
            onDoubleClick={() => handleDoubleClickPoint(i)}
          />
        );
      })}
    </svg>
  );
}
