'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  parsePath, serializeSubPath,
  extractAllPathDs, updateNthPathInHtml,
  insertPoint, removePoint,
  applyCornerRadiiToHtml, parseCornerRadiiFromHtml,
  type PathPoint, type ParsedPath, type SubPath,
} from '@/components/shared/svg-path-utils';

export interface PointSelection {
  pathIdx: number;
  pointIdx: number;
}

export interface VectorSelectionInfo {
  selectedPoints: PointSelection[];
  points: { pathIdx: number; pointIdx: number; point: PathPoint }[];
}

interface VectorEditorProps {
  elementHtml: string;
  elementX: number;
  elementY: number;
  elementW: number;
  elementH: number;
  scale: number;
  panX: number;
  panY: number;
  onUpdate: (updates: { html: string; x: number; y: number; w: number; h: number }) => void;
  onExit: () => void;
  onSelectionChange?: (info: VectorSelectionInfo | null) => void;
  onPointsUpdate?: (pathIdx: number, pointIdx: number, changes: Partial<PathPoint>) => void;
}

const ANCHOR_SIZE = 6;
const HANDLE_SIZE = 4;
const SEGMENT_HOVER_DIST = 12;

interface SubPathEntry {
  pathElIdx: number;
  subIdx: number;
  sub: SubPath;
}

function extractOrigDs(html: string): (string | null)[] {
  const results: (string | null)[] = [];
  const re = /<path\b([^>]*)\/?>(?:\s*<\/path>)?/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const origMatch = m[1].match(/data-orig-d="([^"]*)"/);
    results.push(origMatch ? origMatch[1] : null);
  }
  return results;
}

function parseAllSubPaths(html: string): SubPathEntry[] {
  const ds = extractAllPathDs(html);
  const origDs = extractOrigDs(html);
  const entries: SubPathEntry[] = [];
  ds.forEach((d, pathElIdx) => {
    const sourceD = origDs[pathElIdx] || d;
    const parsed = parsePath(sourceD);
    const subs = parsed.subPaths && parsed.subPaths.length > 0
      ? parsed.subPaths
      : [{ points: parsed.points, closed: parsed.closed }];
    const radii = parseCornerRadiiFromHtml(html, pathElIdx);
    let radiiOffset = 0;
    subs.forEach((sub, subIdx) => {
      if (radii.length > 0) {
        const points = sub.points.map((pt, i) => {
          const cr = radii[radiiOffset + i];
          return cr && cr > 0 ? { ...pt, cornerRadius: cr } : pt;
        });
        entries.push({ pathElIdx, subIdx, sub: { ...sub, points } });
      } else {
        entries.push({ pathElIdx, subIdx, sub });
      }
      radiiOffset += sub.points.length;
    });
  });
  return entries;
}

export function VectorEditor({
  elementHtml, elementX, elementY, elementW, elementH,
  scale, panX, panY, onUpdate, onExit, onSelectionChange,
}: VectorEditorProps) {
  const baseEntries = parseAllSubPaths(elementHtml);

  const viewBox = elementHtml.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
  const vbX = viewBox?.[0] ?? 0;
  const vbY = viewBox?.[1] ?? 0;
  const vbW = viewBox?.[2] ?? elementW;
  const vbH = viewBox?.[3] ?? elementH;
  const scaleX = elementW / vbW;
  const scaleY = elementH / vbH;

  const [selectedPoints, setSelectedPoints] = useState<PointSelection[]>([]);
  const selectedPoint = selectedPoints.length === 1 ? selectedPoints[0] : null;

  const notifySelection = useCallback((sel: PointSelection[], subs: SubPath[]) => {
    if (!onSelectionChange) return;
    if (sel.length === 0) { onSelectionChange(null); return; }
    onSelectionChange({
      selectedPoints: sel,
      points: sel.map(s => ({
        pathIdx: s.pathIdx,
        pointIdx: s.pointIdx,
        point: subs[s.pathIdx]?.points[s.pointIdx],
      })).filter(p => p.point),
    });
  }, [onSelectionChange]);

  const setSelection = useCallback((sel: PointSelection[]) => {
    setSelectedPoints(sel);
    const subs = baseEntries.map(e => e.sub);
    notifySelection(sel, subs);
  }, [baseEntries, notifySelection]);

  const isPointSelected = (pathIdx: number, pointIdx: number) =>
    selectedPoints.some(s => s.pathIdx === pathIdx && s.pointIdx === pointIdx);

  const [dragState, setDragState] = useState<{
    type: 'anchor' | 'handleIn' | 'handleOut';
    pathIdx: number;
    pointIdx: number;
    startX: number; startY: number;
    origX: number; origY: number;
  } | null>(null);
  const [dragOverride, _setDragOverride] = useState<{ subs: SubPath[]; forHtml: string } | null>(null);
  const dragOverrideRef = useRef(dragOverride);
  const setDragOverride = (v: { subs: SubPath[]; forHtml: string } | null) => {
    dragOverrideRef.current = v;
    _setDragOverride(v);
  };

  const [hoverSegment, setHoverSegment] = useState<{
    pathIdx: number; segIdx: number; screenX: number; screenY: number;
  } | null>(null);

  const [boxSelect, setBoxSelect] = useState<{
    startX: number; startY: number; currentX: number; currentY: number;
  } | null>(null);

  const [mergeIndicator, setMergeIndicator] = useState<{ x: number; y: number } | null>(null);
  const [bgDragStart, setBgDragStart] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const toLocal = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const currentSubs: SubPath[] = (dragOverride && dragOverride.forHtml === elementHtml)
    ? dragOverride.subs
    : baseEntries.map(e => e.sub);

  const toScreen = (px: number, py: number) => ({
    x: panX + (elementX + (px - vbX) * scaleX) * scale,
    y: panY + (elementY + (py - vbY) * scaleY) * scale,
  });

  const reassembleAndCommit = useCallback((updatedSubs: SubPath[]) => {
    const pad = 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sp of updatedSubs) {
      for (const pt of sp.points) {
        minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
        if (pt.handleIn) {
          minX = Math.min(minX, pt.x + pt.handleIn.x); minY = Math.min(minY, pt.y + pt.handleIn.y);
          maxX = Math.max(maxX, pt.x + pt.handleIn.x); maxY = Math.max(maxY, pt.y + pt.handleIn.y);
        }
        if (pt.handleOut) {
          minX = Math.min(minX, pt.x + pt.handleOut.x); minY = Math.min(minY, pt.y + pt.handleOut.y);
          maxX = Math.max(maxX, pt.x + pt.handleOut.x); maxY = Math.max(maxY, pt.y + pt.handleOut.y);
        }
      }
    }

    const newVbX = minX - pad;
    const newVbY = minY - pad;
    const newVbW = Math.max(maxX - minX + pad * 2, 1);
    const newVbH = Math.max(maxY - minY + pad * 2, 1);

    const pathElCount = Math.max(...baseEntries.map(e => e.pathElIdx)) + 1;
    let newHtml = elementHtml;
    for (let pei = 0; pei < pathElCount; pei++) {
      const subsForPath = baseEntries
        .map((e, i) => e.pathElIdx === pei ? i : -1)
        .filter(i => i >= 0);
      const expandedD = subsForPath
        .map(i => serializeSubPath(updatedSubs[i]))
        .join('');
      const allRadii: (number | undefined)[] = [];
      let hasAnyRadius = false;
      for (const si of subsForPath) {
        for (const pt of updatedSubs[si].points) {
          allRadii.push(pt.cornerRadius);
          if (pt.cornerRadius && pt.cornerRadius > 0) hasAnyRadius = true;
        }
      }
      const unexpandedD = hasAnyRadius
        ? subsForPath.map(i => {
            const sp = updatedSubs[i];
            const plainPoints = sp.points.map(pt => ({ ...pt, cornerRadius: undefined }));
            return serializeSubPath({ points: plainPoints, closed: sp.closed });
          }).join('')
        : null;
      newHtml = updateNthPathInHtml(newHtml, pei, expandedD);
      newHtml = applyCornerRadiiToHtml(newHtml, pei, allRadii);
      let pathCount = 0;
      newHtml = newHtml.replace(/<path\b([^>]*?)\s*(\/?>)/g, (match, attrs, close) => {
        if (pathCount++ !== pei) return match;
        let a = attrs.replace(/\sdata-orig-d="[^"]*"/, '');
        if (unexpandedD) a += ` data-orig-d="${unexpandedD}"`;
        return `<path${a} ${close}`;
      });
    }

    newHtml = newHtml.replace(
      /viewBox="[^"]*"/,
      `viewBox="${newVbX} ${newVbY} ${newVbW} ${newVbH}"`
    );

    const newX = elementX + (newVbX - vbX) * scaleX;
    const newY = elementY + (newVbY - vbY) * scaleY;
    const newW = newVbW * scaleX;
    const newH = newVbH * scaleY;

    onUpdate({ html: newHtml, x: Math.round(newX), y: Math.round(newY), w: Math.round(newW), h: Math.round(newH) });
  }, [elementHtml, elementX, elementY, vbX, vbY, vbW, vbH, scaleX, scaleY, onUpdate, baseEntries]);

  // Expose updatePoints for property panel
  const updateSelectedPoints = useCallback((changes: Partial<PathPoint>) => {
    if (selectedPoints.length === 0) return;
    const baseSubs = baseEntries.map(e => e.sub);
    const updated = baseSubs.map((sp, pi) => {
      const points = sp.points.map((pt, pti) => {
        if (!selectedPoints.some(s => s.pathIdx === pi && s.pointIdx === pti)) return pt;
        const newPt = { ...pt };
        if (changes.x !== undefined) newPt.x = changes.x;
        if (changes.y !== undefined) newPt.y = changes.y;
        if (changes.type !== undefined) {
          newPt.type = changes.type;
          if (changes.type === 'corner') {
            newPt.handleIn = undefined;
            newPt.handleOut = undefined;
          } else if (changes.type === 'smooth' && !newPt.handleIn && !newPt.handleOut) {
            newPt.handleIn = { x: -20, y: 0 };
            newPt.handleOut = { x: 20, y: 0 };
          } else if (changes.type === 'symmetric' && newPt.handleOut) {
            newPt.handleIn = { x: -newPt.handleOut.x, y: -newPt.handleOut.y };
          }
        }
        return newPt;
      });
      return { ...sp, points };
    });
    reassembleAndCommit(updated);
    notifySelection(selectedPoints, updated);
  }, [selectedPoints, baseEntries, reassembleAndCommit, notifySelection]);

  const applyCornerRadiusToSelected = useCallback((radius: number) => {
    if (selectedPoints.length === 0) return;
    const baseSubs = baseEntries.map(e => e.sub);
    const updated = baseSubs.map((sp, pi) => {
      const points = sp.points.map((pt, pti) => {
        if (!selectedPoints.some(s => s.pathIdx === pi && s.pointIdx === pti)) return pt;
        return { ...pt, cornerRadius: radius > 0 ? radius : undefined };
      });
      return { ...sp, points };
    });
    reassembleAndCommit(updated);
    notifySelection(selectedPoints, updated);
  }, [selectedPoints, baseEntries, reassembleAndCommit, notifySelection]);

  // Make updateSelectedPoints accessible via ref for parent
  const updatePointsRef = useRef(updateSelectedPoints);
  updatePointsRef.current = updateSelectedPoints;
  const cornerRadiusRef = useRef(applyCornerRadiusToSelected);
  cornerRadiusRef.current = applyCornerRadiusToSelected;

  // Attach to window for CanvasEditor to call
  useEffect(() => {
    (window as any).__vectorEditorUpdatePoints = (changes: Partial<PathPoint>) => {
      updatePointsRef.current(changes);
    };
    (window as any).__vectorEditorApplyCornerRadius = (radius: number) => {
      cornerRadiusRef.current(radius);
    };
    return () => {
      delete (window as any).__vectorEditorUpdatePoints;
      delete (window as any).__vectorEditorApplyCornerRadius;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') { onExit(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPoints.length > 0 && baseEntries.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const baseSubs = baseEntries.map(e => e.sub);
        // Delete selected points (process in reverse order to preserve indices)
        const sorted = [...selectedPoints].sort((a, b) =>
          a.pathIdx !== b.pathIdx ? b.pathIdx - a.pathIdx : b.pointIdx - a.pointIdx
        );
        let updated = baseSubs.map(sp => ({ ...sp }));
        for (const sel of sorted) {
          if (sel.pathIdx < updated.length) {
            updated[sel.pathIdx] = removePoint(
              { points: updated[sel.pathIdx].points, closed: updated[sel.pathIdx].closed, subPaths: [] },
              sel.pointIdx
            );
          }
        }
        reassembleAndCommit(updated);
        setSelection([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPoints, baseEntries, onExit, reassembleAndCommit, setSelection]);

  // Notify selection on html change
  useEffect(() => {
    if (selectedPoints.length > 0) {
      const subs = baseEntries.map(e => e.sub);
      notifySelection(selectedPoints, subs);
    }
  }, [elementHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  if (currentSubs.length === 0) return null;

  const applyDrag = (dx: number, dy: number): SubPath[] => {
    if (!dragState) return baseEntries.map(e => e.sub);
    return baseEntries.map((entry, pi) => {
      if (pi !== dragState.pathIdx) return entry.sub;
      const points = entry.sub.points.map((pt, i) => {
        if (i !== dragState.pointIdx) return pt;
        if (dragState.type === 'anchor') {
          return { ...pt, x: dragState.origX + dx, y: dragState.origY + dy };
        } else if (dragState.type === 'handleIn') {
          const newHandleIn = { x: dragState.origX + dx, y: dragState.origY + dy };
          if (pt.type === 'symmetric') {
            return { ...pt, handleIn: newHandleIn, handleOut: { x: -newHandleIn.x, y: -newHandleIn.y } };
          }
          if (pt.type === 'smooth' && pt.handleOut) {
            const len = Math.sqrt(pt.handleOut.x ** 2 + pt.handleOut.y ** 2);
            const inLen = Math.sqrt(newHandleIn.x ** 2 + newHandleIn.y ** 2);
            if (inLen > 0) {
              return { ...pt, handleIn: newHandleIn, handleOut: { x: -newHandleIn.x / inLen * len, y: -newHandleIn.y / inLen * len } };
            }
          }
          return { ...pt, handleIn: newHandleIn };
        } else {
          const newHandleOut = { x: dragState.origX + dx, y: dragState.origY + dy };
          if (pt.type === 'symmetric') {
            return { ...pt, handleOut: newHandleOut, handleIn: { x: -newHandleOut.x, y: -newHandleOut.y } };
          }
          if (pt.type === 'smooth' && pt.handleIn) {
            const len = Math.sqrt(pt.handleIn.x ** 2 + pt.handleIn.y ** 2);
            const outLen = Math.sqrt(newHandleOut.x ** 2 + newHandleOut.y ** 2);
            if (outLen > 0) {
              return { ...pt, handleOut: newHandleOut, handleIn: { x: -newHandleOut.x / outLen * len, y: -newHandleOut.y / outLen * len } };
            }
          }
          return { ...pt, handleOut: newHandleOut };
        }
      });
      return { ...entry.sub, points };
    });
  };

  const handlePointerDown = (
    e: React.PointerEvent,
    type: 'anchor' | 'handleIn' | 'handleOut',
    pathIdx: number,
    pointIdx: number,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const pt = baseEntries[pathIdx].sub.points[pointIdx];
    let origX: number, origY: number;
    if (type === 'anchor') { origX = pt.x; origY = pt.y; }
    else if (type === 'handleIn') { origX = pt.handleIn?.x ?? 0; origY = pt.handleIn?.y ?? 0; }
    else { origX = pt.handleOut?.x ?? 0; origY = pt.handleOut?.y ?? 0; }
    setDragState({ type, pathIdx, pointIdx, startX: e.clientX, startY: e.clientY, origX, origY });

    if (type === 'anchor') {
      if (e.shiftKey) {
        const already = isPointSelected(pathIdx, pointIdx);
        if (already) {
          setSelection(selectedPoints.filter(s => !(s.pathIdx === pathIdx && s.pointIdx === pointIdx)));
        } else {
          setSelection([...selectedPoints, { pathIdx, pointIdx }]);
        }
      } else {
        setSelection([{ pathIdx, pointIdx }]);
      }
    }
    setDragOverride(null);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (boxSelect) {
      const l = toLocal(e.clientX, e.clientY);
      setBoxSelect({ ...boxSelect, currentX: l.x, currentY: l.y });
      return;
    }
    if (dragState) {
      const dx = (e.clientX - dragState.startX) / scale / scaleX;
      const dy = (e.clientY - dragState.startY) / scale / scaleY;
      const updated = applyDrag(dx, dy);
      setDragOverride({ subs: updated, forHtml: elementHtml });
      reassembleAndCommit(updated);
      // Check merge proximity
      if (dragState.type === 'anchor') {
        const draggedPt = updated[dragState.pathIdx]?.points[dragState.pointIdx];
        if (draggedPt) {
          const ds = toScreen(draggedPt.x, draggedPt.y);
          let found = false;
          for (let pi = 0; pi < updated.length && !found; pi++) {
            for (let pti = 0; pti < updated[pi].points.length; pti++) {
              if (pi === dragState.pathIdx && pti === dragState.pointIdx) continue;
              const s = toScreen(updated[pi].points[pti].x, updated[pi].points[pti].y);
              if (Math.sqrt((ds.x - s.x) ** 2 + (ds.y - s.y) ** 2) < 10) {
                setMergeIndicator({ x: s.x, y: s.y });
                found = true;
                break;
              }
            }
          }
          if (!found) setMergeIndicator(null);
        }
      }
      return;
    }
    // Background drag → box select
    if (bgDragStart && !boxSelect) {
      const dx = e.clientX - bgDragStart.clientX;
      const dy = e.clientY - bgDragStart.clientY;
      if (dx * dx + dy * dy > 9) {
        setBoxSelect({ startX: bgDragStart.x, startY: bgDragStart.y, currentX: bgDragStart.x, currentY: bgDragStart.y });
        setBgDragStart(null);
      }
      return;
    }
    // Hover detection for segments
    const l = toLocal(e.clientX, e.clientY);
    checkSegmentHover(l.x, l.y);
  };

  const checkSegmentHover = (clientX: number, clientY: number) => {
    let closest: typeof hoverSegment = null;
    let minDist = SEGMENT_HOVER_DIST;

    for (let pathIdx = 0; pathIdx < currentSubs.length; pathIdx++) {
      const pts = currentSubs[pathIdx].points;
      const len = currentSubs[pathIdx].closed ? pts.length : pts.length - 1;
      for (let i = 0; i < len; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const sa = toScreen(a.x, a.y);
        const sb = toScreen(b.x, b.y);
        // Point-to-segment distance
        const dx = sb.x - sa.x, dy = sb.y - sa.y;
        const lenSq = dx * dx + dy * dy;
        const tRaw = lenSq === 0 ? 0 : ((clientX - sa.x) * dx + (clientY - sa.y) * dy) / lenSq;
        // Gate: cursor must be in the central 40-60% of the segment along its length.
        if (tRaw < 0.4 || tRaw > 0.6) continue;
        // Perpendicular distance from cursor to the segment line.
        const projX = sa.x + tRaw * dx, projY = sa.y + tRaw * dy;
        const perpDist = Math.sqrt((clientX - projX) ** 2 + (clientY - projY) ** 2);
        if (perpDist < minDist) {
          minDist = perpDist;
          // Always render the add-anchor button at the segment midpoint.
          closest = { pathIdx, segIdx: i, screenX: sa.x + 0.5 * dx, screenY: sa.y + 0.5 * dy };
        }
      }
    }
    setHoverSegment(closest);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (boxSelect) {
      // Complete box selection
      const x1 = Math.min(boxSelect.startX, boxSelect.currentX);
      const y1 = Math.min(boxSelect.startY, boxSelect.currentY);
      const x2 = Math.max(boxSelect.startX, boxSelect.currentX);
      const y2 = Math.max(boxSelect.startY, boxSelect.currentY);
      const newSel: PointSelection[] = [];
      for (let pi = 0; pi < currentSubs.length; pi++) {
        for (let pti = 0; pti < currentSubs[pi].points.length; pti++) {
          const pt = currentSubs[pi].points[pti];
          const s = toScreen(pt.x, pt.y);
          if (s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2) {
            newSel.push({ pathIdx: pi, pointIdx: pti });
          }
        }
      }
      if (e.shiftKey) {
        const merged = [...selectedPoints];
        for (const ns of newSel) {
          if (!merged.some(s => s.pathIdx === ns.pathIdx && s.pointIdx === ns.pointIdx)) {
            merged.push(ns);
          }
        }
        setSelection(merged);
      } else {
        setSelection(newSel);
      }
      setBoxSelect(null);
      return;
    }
    const override = dragOverrideRef.current;
    if (dragState && dragState.type === 'anchor' && override) {
      // Check for merge: dragged anchor near another anchor
      const MERGE_THRESHOLD = 10; // screen pixels
      const draggedPt = override.subs[dragState.pathIdx]?.points[dragState.pointIdx];
      if (draggedPt) {
        const dragScreen = toScreen(draggedPt.x, draggedPt.y);
        let mergeTarget: { pathIdx: number; pointIdx: number } | null = null;
        for (let pi = 0; pi < override.subs.length && !mergeTarget; pi++) {
          for (let pti = 0; pti < override.subs[pi].points.length; pti++) {
            if (pi === dragState.pathIdx && pti === dragState.pointIdx) continue;
            const pt = override.subs[pi].points[pti];
            const s = toScreen(pt.x, pt.y);
            const dist = Math.sqrt((dragScreen.x - s.x) ** 2 + (dragScreen.y - s.y) ** 2);
            if (dist < MERGE_THRESHOLD) {
              mergeTarget = { pathIdx: pi, pointIdx: pti };
              break;
            }
          }
        }
        if (mergeTarget) {
          // Merge: remove dragged point (A), keep target point (B)
          const merged = override.subs.map((sp, pi) => {
            if (pi !== dragState.pathIdx) return sp;
            const points = sp.points.filter((_, i) => i !== dragState.pointIdx);
            return { ...sp, points };
          });
          reassembleAndCommit(merged);
          setSelection([]);
          setDragState(null);
          setDragOverride(null);
          setMergeIndicator(null);
          return;
        }
      }
      reassembleAndCommit(override.subs);
    } else if (dragState && override) {
      reassembleAndCommit(override.subs);
    }
    setDragState(null);
    setDragOverride(null);
    setMergeIndicator(null);
    if (bgDragStart) {
      const dx = e.clientX - bgDragStart.clientX;
      const dy = e.clientY - bgDragStart.clientY;
      setBgDragStart(null);
      if (dx * dx + dy * dy <= 9) {
        setSelection([]);
        onExit();
      }
    }
  };

  const handleDoubleClickPoint = (pathIdx: number, pointIdx: number) => {
    const baseSubs = baseEntries.map(e => e.sub);
    const updated = baseSubs.map((sp, i) => {
      if (i !== pathIdx) return sp;
      const points = sp.points.map((pt, j) => {
        if (j !== pointIdx) return pt;
        if (pt.type === 'corner') {
          return { ...pt, type: 'smooth' as const, handleIn: { x: -20, y: 0 }, handleOut: { x: 20, y: 0 } };
        } else {
          return { ...pt, type: 'corner' as const, handleIn: undefined, handleOut: undefined };
        }
      });
      return { ...sp, points };
    });
    reassembleAndCommit(updated);
  };

  const handleSegmentClick = (pathIdx: number, segIdx: number) => {
    const baseSubs = baseEntries.map(e => e.sub);
    const updated = baseSubs.map((sp, i) => {
      if (i !== pathIdx) return sp;
      return insertPoint({ points: sp.points, closed: sp.closed, subPaths: [] }, segIdx, 0.5);
    });
    reassembleAndCommit(updated);
    setSelection([{ pathIdx, pointIdx: segIdx + 1 }]);
  };

  const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.target === e.currentTarget) {
      const l = toLocal(e.clientX, e.clientY);
      setBgDragStart({ x: l.x, y: l.y, clientX: e.clientX, clientY: e.clientY });
    }
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 pointer-events-auto"
      style={{ width: '100%', height: '100%', zIndex: 9999, cursor: 'default' }}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={(e) => { handlePointerUp(e); setHoverSegment(null); }}
    >
      {currentSubs.map((sub, pathIdx) => {
        const color = COLORS[pathIdx % COLORS.length];
        const pts = sub.points;

        return (
          <g key={`path-${pathIdx}`}>
            {/* Clickable segments for closed paths */}
            {pts.map((pt, i) => {
              const nextIdx = (i + 1) % pts.length;
              if (!sub.closed && i === pts.length - 1) return null;
              if (i === 0 && !sub.closed) {
                // handled by i > 0 below
              }
              const prev = pts[i];
              const next = pts[nextIdx];
              const from = toScreen(prev.x, prev.y);
              const to = toScreen(next.x, next.y);
              return (
                <line key={`seg-${pathIdx}-${i}`}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke="transparent" strokeWidth={12}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handleSegmentClick(pathIdx, i); }}
                />
              );
            })}

            {/* Handle lines + dots */}
            {pts.map((pt, i) => {
              const anchor = toScreen(pt.x, pt.y);
              const isSel = isPointSelected(pathIdx, i);
              const elements: React.ReactNode[] = [];

              if (pt.handleIn && (pt.handleIn.x !== 0 || pt.handleIn.y !== 0) && isSel) {
                const h = toScreen(pt.x + pt.handleIn.x, pt.y + pt.handleIn.y);
                elements.push(
                  <line key={`hi-line-${pathIdx}-${i}`} x1={anchor.x} y1={anchor.y} x2={h.x} y2={h.y}
                    stroke={color} strokeWidth={1} strokeDasharray="3 2" />,
                  <circle key={`hi-dot-${pathIdx}-${i}`} cx={h.x} cy={h.y} r={HANDLE_SIZE}
                    fill={color} stroke="white" strokeWidth={1.5}
                    style={{ cursor: 'grab' }}
                    onPointerDown={e => handlePointerDown(e, 'handleIn', pathIdx, i)} />,
                );
              }

              if (pt.handleOut && (pt.handleOut.x !== 0 || pt.handleOut.y !== 0) && isSel) {
                const h = toScreen(pt.x + pt.handleOut.x, pt.y + pt.handleOut.y);
                elements.push(
                  <line key={`ho-line-${pathIdx}-${i}`} x1={anchor.x} y1={anchor.y} x2={h.x} y2={h.y}
                    stroke={color} strokeWidth={1} strokeDasharray="3 2" />,
                  <circle key={`ho-dot-${pathIdx}-${i}`} cx={h.x} cy={h.y} r={HANDLE_SIZE}
                    fill={color} stroke="white" strokeWidth={1.5}
                    style={{ cursor: 'grab' }}
                    onPointerDown={e => handlePointerDown(e, 'handleOut', pathIdx, i)} />,
                );
              }

              return elements.length > 0 ? <g key={`handles-${pathIdx}-${i}`}>{elements}</g> : null;
            })}

            {/* Anchor points */}
            {pts.map((pt, i) => {
              const s = toScreen(pt.x, pt.y);
              const isSel = isPointSelected(pathIdx, i);
              return (
                <circle key={`anchor-${pathIdx}-${i}`}
                  cx={s.x} cy={s.y} r={ANCHOR_SIZE}
                  fill={isSel ? color : 'white'}
                  stroke={color} strokeWidth={2}
                  style={{ cursor: 'grab' }}
                  onPointerDown={e => handlePointerDown(e, 'anchor', pathIdx, i)}
                  onDoubleClick={() => handleDoubleClickPoint(pathIdx, i)}
                />
              );
            })}
          </g>
        );
      })}

      {/* Segment hover add-point indicator */}
      {hoverSegment && !dragState && !boxSelect && (
        <g style={{ cursor: 'pointer' }}
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handleSegmentClick(hoverSegment.pathIdx, hoverSegment.segIdx); }}>
          <circle cx={hoverSegment.screenX} cy={hoverSegment.screenY} r={10}
            fill="white" fillOpacity={0.01} stroke="transparent" />
          <circle cx={hoverSegment.screenX} cy={hoverSegment.screenY} r={8}
            fill="white" stroke="#3b82f6" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
          <line x1={hoverSegment.screenX - 4} y1={hoverSegment.screenY}
            x2={hoverSegment.screenX + 4} y2={hoverSegment.screenY}
            stroke="#3b82f6" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
          <line x1={hoverSegment.screenX} y1={hoverSegment.screenY - 4}
            x2={hoverSegment.screenX} y2={hoverSegment.screenY + 4}
            stroke="#3b82f6" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
        </g>
      )}

      {/* Merge indicator */}
      {mergeIndicator && (
        <g style={{ pointerEvents: 'none' }}>
          <circle cx={mergeIndicator.x} cy={mergeIndicator.y} r={12}
            fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2">
            <animate attributeName="r" values="10;14;10" dur="0.8s" repeatCount="indefinite" />
          </circle>
        </g>
      )}

      {/* Box selection rectangle */}
      {boxSelect && (() => {
        const x = Math.min(boxSelect.startX, boxSelect.currentX);
        const y = Math.min(boxSelect.startY, boxSelect.currentY);
        const w = Math.abs(boxSelect.currentX - boxSelect.startX);
        const h = Math.abs(boxSelect.currentY - boxSelect.startY);
        return (
          <rect x={x} y={y} width={w} height={h}
            fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 2" />
        );
      })()}
    </svg>
  );
}
