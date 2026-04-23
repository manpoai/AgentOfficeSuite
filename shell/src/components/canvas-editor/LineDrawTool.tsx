'use client';

import { useState, useEffect } from 'react';

interface LineDrawToolProps {
  scale: number;
  panX: number;
  panY: number;
  frameX?: number;
  frameY?: number;
  onComplete: (html: string, x: number, y: number, w: number, h: number) => void;
  onCancel: () => void;
}

export function LineDrawTool({
  scale, panX, panY, frameX = 0, frameY = 0,
  onComplete, onCancel,
}: LineDrawToolProps) {
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [endPt, setEndPt] = useState<{ x: number; y: number } | null>(null);

  const clientToCanvas = (clientX: number, clientY: number) => ({
    x: (clientX - panX) / scale - frameX,
    y: (clientY - panY) / scale - frameY,
  });

  const canvasToScreen = (cx: number, cy: number) => ({
    x: panX + (frameX + cx) * scale,
    y: panY + (frameY + cy) * scale,
  });

  const snapAngle = (start: { x: number; y: number }, end: { x: number; y: number }, shiftKey: boolean) => {
    if (!shiftKey) return end;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angle = Math.atan2(dy, dx);
    const snapAngles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
    let closest = snapAngles[0];
    let minDiff = Infinity;
    for (const sa of snapAngles) {
      const diff = Math.abs(angle - sa);
      if (diff < minDiff) { minDiff = diff; closest = sa; }
    }
    const len = Math.hypot(dx, dy);
    return { x: start.x + len * Math.cos(closest), y: start.y + len * Math.sin(closest) };
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const pt = clientToCanvas(e.clientX, e.clientY);
    if (!startPt) {
      setStartPt(pt);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startPt) return;
    let pt = clientToCanvas(e.clientX, e.clientY);
    pt = snapAngle(startPt, pt, e.shiftKey);
    setEndPt(pt);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!startPt) return;
    let pt = clientToCanvas(e.clientX, e.clientY);
    pt = snapAngle(startPt, pt, e.shiftKey);

    const x1 = Math.min(startPt.x, pt.x);
    const y1 = Math.min(startPt.y, pt.y);
    const x2 = Math.max(startPt.x, pt.x);
    const y2 = Math.max(startPt.y, pt.y);
    const pad = 4;
    const w = Math.max(x2 - x1 + pad * 2, 1);
    const h = Math.max(y2 - y1 + pad * 2, 1);

    const lx1 = startPt.x - x1 + pad;
    const ly1 = startPt.y - y1 + pad;
    const lx2 = pt.x - x1 + pad;
    const ly2 = pt.y - y1 + pad;

    const d = `M${Math.round(lx1)},${Math.round(ly1)} L${Math.round(lx2)},${Math.round(ly2)}`;
    const html = `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${d}" fill="none" stroke="#374151" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg></div>`;

    onComplete(html, Math.round(x1 - pad), Math.round(y1 - pad), Math.round(w), Math.round(h));
  };

  const s1 = startPt ? canvasToScreen(startPt.x, startPt.y) : null;
  const s2 = endPt ? canvasToScreen(endPt.x, endPt.y) : null;

  return (
    <svg
      className="absolute inset-0 pointer-events-auto"
      style={{ width: '100%', height: '100%', zIndex: 9998, cursor: 'crosshair' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {s1 && s2 && (
        <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y}
          stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 3" />
      )}
      {s1 && <circle cx={s1.x} cy={s1.y} r={4} fill="#3b82f6" stroke="white" strokeWidth={1.5} />}
      {s2 && <circle cx={s2.x} cy={s2.y} r={4} fill="#3b82f6" stroke="white" strokeWidth={1.5} />}
    </svg>
  );
}
