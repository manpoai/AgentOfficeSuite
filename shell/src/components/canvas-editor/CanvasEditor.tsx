'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  Plus, Minus, Trash2,
  Lock, Unlock,
  Type, Hexagon, Frame, ImagePlus, FileUp,
  Square, Image as ImageIcon, Code2, Slash,
  AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter,
  AlignStartHorizontal, AlignEndHorizontal, AlignStartVertical, AlignEndVertical,
  PanelRight, PanelRightClose, Copy, ArrowUp, ArrowDown,
  Undo2, Redo2, X,
  Layers, ChevronDown, ChevronRight, FolderOpen, Folder,
  PenTool as PenToolIcon, Spline, MousePointer2,
  SquaresUnite, SquaresSubtract, SquaresIntersect, SquaresExclude,
  Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT, getT } from '@/lib/i18n';
import { useKeyboardScope } from '@/lib/keyboard/useKeyboardScope';
import type { ShortcutDef } from '@/lib/keyboard/types';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { buildFixedTopBarActionItems, renderFixedTopBarActions } from '@/actions/content-topbar-fixed.actions';
import { buildContentTopBarCommonMenuItems } from '@/actions/content-topbar-common.actions';
import { getPublicOrigin } from '@/lib/remote-access';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { RevisionPreviewBanner } from '@/components/shared/RevisionPreviewBanner';
import { ActorInlineAvatar } from '@/components/shared/ActorInlineAvatar';
import { formatRelativeTime } from '@/lib/utils/time';
import { ShapePicker, SHAPE_MAP, regularPolygonPath, regularStarPath, type ShapeType } from '@/components/shared/ShapeSet';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CanvasElementView, EditingOverlay, getClientPos, HANDLES, HANDLE_POS, HANDLE_CURSORS } from './CanvasElement';
import { VectorEditor, type VectorSelectionInfo } from './VectorEditor';
import { VectorPropertyPanel } from './VectorPropertyPanel';
import { PenTool, type OpenEndpoint } from './PenTool';
import { LineDrawTool } from './LineDrawTool';
import { extractPathD, parsePath, serializePath, serializeSubPath, booleanPathOp, convertShapesToPaths, extractAllPathDs, rescaleSvgHtml, expandCornerRadii, applyCornerRadiiToHtml, bakeRotation, type BooleanOp, type PathPoint } from '@/components/shared/svg-path-utils';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';
import { FramePresetPanel } from './FramePresetPanel';
import { SubElementEditor, type SubElementSelection } from '@/components/shared/SubElementEditor';
import { extractDesignTokens, updateDesignToken, applyProjection } from './projection';
import { useUndoRedo } from './use-undo-redo';
import { uploadImageFile, createImageHtml, extractDroppedImageFiles, isSvgFile, probeImageSize, resolveUploadUrl } from '@/components/shared/image-upload';
import { parseSvgFileContent } from '@/components/shared/svg-import';
import type { CanvasData, CanvasPage, CanvasElement } from './types';
import { createEmptyPage, DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT } from './types';
import { useContextMenu } from '@/lib/hooks/use-context-menu';
import { toContextMenuItems } from '@/surfaces/bridge';
import { buildActionMap } from '@/actions/types';
import { canvasElementActions, type CanvasElementCtx } from '@/actions/canvas-element.actions';
import { canvasFrameActions, type CanvasFrameCtx } from '@/actions/canvas-frame.actions';
import { canvasSurfaces } from '@/surfaces/canvas.surfaces';
import { CanvasFrameExportView, ElementExportView } from './CanvasFrameExportView';
import { exportFramePng, exportFrameSvg, canExportFrameAsSvg, canExportElementAsSvg } from './exportUtils';

const CANVAS_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'canvas-group',
    key: 'g',
    modifiers: { meta: true },
    handler: () => window.dispatchEvent(new CustomEvent('canvas:group')),
    label: getT()('shortcuts.canvas.group'),
    category: 'Canvas',
    priority: 5,
  },
  {
    id: 'canvas-ungroup',
    key: 'g',
    modifiers: { meta: true, shift: true },
    handler: () => window.dispatchEvent(new CustomEvent('canvas:ungroup')),
    label: getT()('shortcuts.canvas.ungroup'),
    category: 'Canvas',
    priority: 6,
  },
  {
    id: 'canvas-select-tool',
    key: 'v',
    handler: () => window.dispatchEvent(new CustomEvent('canvas:tool', { detail: 'select' })),
    label: getT()('shortcuts.canvas.selectTool'),
    category: 'Canvas',
  },
  {
    id: 'canvas-rect-tool',
    key: 'r',
    handler: () => window.dispatchEvent(new CustomEvent('canvas:tool', { detail: 'rect' })),
    label: getT()('shortcuts.canvas.rectTool'),
    category: 'Canvas',
  },
  {
    id: 'canvas-circle-tool',
    key: 'o',
    handler: () => window.dispatchEvent(new CustomEvent('canvas:tool', { detail: 'circle' })),
    label: getT()('shortcuts.canvas.circleTool'),
    category: 'Canvas',
  },
  {
    id: 'canvas-text-tool',
    key: 't',
    handler: () => window.dispatchEvent(new CustomEvent('canvas:tool', { detail: 'text' })),
    label: getT()('shortcuts.canvas.textTool'),
    category: 'Canvas',
  },
  {
    id: 'canvas-frame-tool',
    key: 'a',
    handler: () => window.dispatchEvent(new CustomEvent('canvas:tool', { detail: 'frame' })),
    label: getT()('shortcuts.canvas.frameTool'),
    category: 'Canvas',
  },
  {
    id: 'canvas-line-tool',
    key: 'l',
    handler: () => window.dispatchEvent(new CustomEvent('canvas:tool', { detail: 'line' })),
    label: getT()('shortcuts.canvas.lineTool'),
    category: 'Canvas',
  },
];

type PendingInsert = { type: 'text' } | { type: 'shape'; shapeType: ShapeType } | { type: 'frame' } | { type: 'pen'; continueElementId?: string; initialPoints?: PathPoint[]; appendEnd?: 'start' | 'end' } | { type: 'line-draw' };

interface CanvasEditorProps {
  canvasId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
  onNavigate?: (rawId: string) => void;
  focusCommentId?: string;
  showComments: boolean;
  onShowComments: () => void;
  onCloseComments: () => void;
  onToggleComments: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

const SNAP_THRESHOLD = 6;
const FRAME_LABEL_HEIGHT = 28;
const FRAME_GAP = 100;

type SnapLine =
  | { kind: 'align'; orientation: 'h' | 'v'; position: number }
  | { kind: 'spacing'; x1: number; x2: number; y1: number; y2: number };

function measureTextSize(html: string, fixedWidth?: number): { w: number; h: number } {
  if (typeof document === 'undefined') return { w: 100, h: 32 };

  const measurer = document.createElement('div');
  measurer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
  measurer.innerHTML = html;
  document.body.appendChild(measurer);
  const el = measurer.firstElementChild as HTMLElement;
  if (!el) {
    if (measurer.isConnected) document.body.removeChild(measurer);
    return { w: 100, h: 32 };
  }
  const mode = el.getAttribute('data-text-resize');
  if (mode === 'auto') {
    el.style.width = 'auto';
    el.style.whiteSpace = 'nowrap';
  } else if (mode === 'fixed-width' && fixedWidth !== undefined && fixedWidth > 0) {
    // Constrain measurer width so the text wraps at the same width as the
    // rendered element. Without this, the div grows to the natural single-line
    // width and reports a single-line height.
    el.style.width = `${fixedWidth}px`;
  }
  const rect = el.getBoundingClientRect();
  const w = Math.max(20, Math.ceil(rect.width));
  const h = Math.max(20, Math.ceil(rect.height));
  if (measurer.isConnected) document.body.removeChild(measurer);
  return { w, h };
}

function overlapsVertically(a: {y:number;h:number}, b: {y:number;h:number}): boolean {
  return a.y < b.y + b.h && a.y + a.h > b.y;
}
function overlapsHorizontally(a: {x:number;w:number}, b: {x:number;w:number}): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

function findEqualSpacing(
  movingEl: { x: number; y: number; w: number; h: number },
  otherElements: { x: number; y: number; w: number; h: number }[],
  threshold: number
): { lines: SnapLine[]; snapX?: number; snapY?: number } {
  const result: { lines: SnapLine[]; snapX?: number; snapY?: number } = { lines: [] };

  // Horizontal equal spacing
  const byX = [...otherElements].filter(el => overlapsVertically(el, movingEl)).sort((a, b) => a.x - b.x);
  for (let i = 0; i < byX.length - 1; i++) {
    const a = byX[i], b = byX[i + 1];
    const gap = b.x - (a.x + a.w);
    if (gap < 0) continue;
    const midY = (a.y + a.h / 2);
    // Check: movingEl at right of b
    const targetX = b.x + b.w + gap;
    if (Math.abs(movingEl.x - targetX) < threshold) {
      result.snapX = targetX;
      result.lines.push(
        { kind: 'spacing', x1: a.x + a.w, x2: b.x, y1: midY, y2: midY },
        { kind: 'spacing', x1: b.x + b.w, x2: targetX, y1: midY, y2: midY }
      );
    }
    // Check: movingEl at left of a
    const targetXL = a.x - gap - movingEl.w;
    if (Math.abs(movingEl.x - targetXL) < threshold) {
      result.snapX = targetXL;
      result.lines.push(
        { kind: 'spacing', x1: targetXL + movingEl.w, x2: a.x, y1: midY, y2: midY },
        { kind: 'spacing', x1: a.x + a.w, x2: b.x, y1: midY, y2: midY }
      );
    }
    // Check: movingEl between a and b
    const midGap = (gap - movingEl.w) / 2;
    if (midGap > 0) {
      const targetXM = a.x + a.w + midGap;
      if (Math.abs(movingEl.x - targetXM) < threshold) {
        result.snapX = targetXM;
        result.lines.push(
          { kind: 'spacing', x1: a.x + a.w, x2: targetXM, y1: midY, y2: midY },
          { kind: 'spacing', x1: targetXM + movingEl.w, x2: b.x, y1: midY, y2: midY }
        );
      }
    }
  }

  // Vertical equal spacing
  const byY = [...otherElements].filter(el => overlapsHorizontally(el, movingEl)).sort((a, b) => a.y - b.y);
  for (let i = 0; i < byY.length - 1; i++) {
    const a = byY[i], b = byY[i + 1];
    const gap = b.y - (a.y + a.h);
    if (gap < 0) continue;
    const midX = (a.x + a.w / 2);
    // Check: movingEl below b
    const targetY = b.y + b.h + gap;
    if (Math.abs(movingEl.y - targetY) < threshold) {
      result.snapY = targetY;
      result.lines.push(
        { kind: 'spacing', x1: midX, x2: midX, y1: a.y + a.h, y2: b.y },
        { kind: 'spacing', x1: midX, x2: midX, y1: b.y + b.h, y2: targetY }
      );
    }
    // Check: movingEl above a
    const targetYT = a.y - gap - movingEl.h;
    if (Math.abs(movingEl.y - targetYT) < threshold) {
      result.snapY = targetYT;
      result.lines.push(
        { kind: 'spacing', x1: midX, x2: midX, y1: targetYT + movingEl.h, y2: a.y },
        { kind: 'spacing', x1: midX, x2: midX, y1: a.y + a.h, y2: b.y }
      );
    }
    // Check: movingEl between a and b
    const midGapY = (gap - movingEl.h) / 2;
    if (midGapY > 0) {
      const targetYM = a.y + a.h + midGapY;
      if (Math.abs(movingEl.y - targetYM) < threshold) {
        result.snapY = targetYM;
        result.lines.push(
          { kind: 'spacing', x1: midX, x2: midX, y1: a.y + a.h, y2: targetYM },
          { kind: 'spacing', x1: midX, x2: midX, y1: targetYM + movingEl.h, y2: b.y }
        );
      }
    }
  }

  return result;
}

function findSnapLines(
  movingEl: { x: number; y: number; w: number; h: number },
  otherElements: CanvasElement[], threshold: number,
  frameBounds?: { width: number; height: number },
): { snapX: number | null; snapY: number | null; lines: SnapLine[] } {
  let snapX: number | null = null, snapY: number | null = null;
  const lines: SnapLine[] = [];
  const allElements = frameBounds
    ? [...otherElements, { x: 0, y: 0, w: frameBounds.width, h: frameBounds.height, id: '__frame__', z_index: 0, html: '', locked: false }]
    : otherElements;
  const me = { left: movingEl.x, right: movingEl.x + movingEl.w, cx: movingEl.x + movingEl.w / 2, top: movingEl.y, bottom: movingEl.y + movingEl.h, cy: movingEl.y + movingEl.h / 2 };
  let bestDx = threshold + 1, bestDy = threshold + 1;
  for (const el of allElements) {
    const e = { left: el.x, right: el.x + el.w, cx: el.x + el.w / 2, top: el.y, bottom: el.y + el.h, cy: el.y + el.h / 2 };
    for (const [mv, tgt] of [[me.left, e.left], [me.left, e.right], [me.right, e.left], [me.right, e.right], [me.cx, e.cx]] as [number, number][]) {
      const d = Math.abs(mv - tgt); if (d < threshold && d < bestDx) { bestDx = d; snapX = movingEl.x + (tgt - mv); lines.push({ kind: 'align', orientation: 'v', position: tgt }); }
    }
    for (const [mv, tgt] of [[me.top, e.top], [me.top, e.bottom], [me.bottom, e.top], [me.bottom, e.bottom], [me.cy, e.cy]] as [number, number][]) {
      const d = Math.abs(mv - tgt); if (d < threshold && d < bestDy) { bestDy = d; snapY = movingEl.y + (tgt - mv); lines.push({ kind: 'align', orientation: 'h', position: tgt }); }
    }
  }
  return { snapX, snapY, lines };
}

function createTextElement(x: number, y: number, fixedWidth?: number): CanvasElement {
  const isFixedWidth = fixedWidth !== undefined && fixedWidth > 10;
  return {
    id: `el-${crypto.randomUUID().slice(0, 8)}`, locked: false, z_index: 1,
    x, y,
    w: isFixedWidth ? fixedWidth : 100,
    h: 32,
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 24px; font-weight: 400; color: #000000; box-sizing: border-box; ${isFixedWidth ? 'white-space: normal; word-wrap: break-word;' : 'white-space: nowrap;'}" contenteditable="true" data-text-resize="${isFixedWidth ? 'fixed-width' : 'auto'}"></div>`,
  };
}



function createShapeElement(shapeType: ShapeType, pageW: number, pageH: number): CanvasElement {
  const shapeDef = SHAPE_MAP.get(shapeType);
  if (!shapeDef) return createTextElement(Math.round(pageW / 2 - 50), Math.round(pageH / 2 - 16));
  const scale = 2;
  const w = shapeDef.width * scale, h = shapeDef.height * scale;
  const defaultRadius = shapeType === 'rounded-rect' ? 8 : 0;

  let pathData: string;
  let extraPathAttrs = '';
  if (defaultRadius > 0) {
    const rectPath = `M0 0h${w}v${h}H0z`;
    const parsed = parsePath(rectPath);
    const subs = parsed.subPaths && parsed.subPaths.length > 0
      ? parsed.subPaths : [{ points: parsed.points, closed: parsed.closed }];
    const radii = subs.flatMap(sp => sp.points.map(() => defaultRadius));
    const expandedSubs = subs.map(sp => {
      const pts = sp.points.map(pt => ({ ...pt, cornerRadius: defaultRadius }));
      return { points: expandCornerRadii({ points: pts, closed: sp.closed }), closed: sp.closed };
    });
    pathData = expandedSubs.map(sp => serializeSubPath(sp)).join('');
    extraPathAttrs = ` data-corner-radii="${radii.join(',')}" data-orig-d="${rectPath}"`;
  } else if (shapeType === 'polygon') {
    pathData = regularPolygonPath(w, h, 5);
    extraPathAttrs = ` data-shape="polygon" data-sides="5"`;
  } else if (shapeType === 'star') {
    pathData = regularStarPath(w, h, 5);
    extraPathAttrs = ` data-shape="star" data-points="5"`;
  } else {
    pathData = shapeDef.renderPath(w, h);
  }

  return {
    id: `el-${crypto.randomUUID().slice(0, 8)}`, locked: false, z_index: 1,
    x: Math.round(pageW / 2 - w / 2), y: Math.round(pageH / 2 - h / 2), w, h,
    html: `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${w + 2} ${h + 2}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${pathData}" fill="#D9D9D9" stroke="none" vector-effect="non-scaling-stroke"${extraPathAttrs}/></svg></div>`,
  };
}

function CanvasToolbar({ pendingInsert, onSetPending, onAddShape, onAddImage, onAddSvg, canUndo, canRedo, onUndo, onRedo, rightOffsetPx = 0 }: {
  pendingInsert: PendingInsert | null;
  onSetPending: (p: PendingInsert | null) => void;
  onAddShape: (shapeType: ShapeType) => void;
  onAddImage: () => void;
  onAddSvg: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Width occupied on the right side of the canvas viewport (e.g. property
   *  panel). Toolbar centers itself relative to the *visible* area, so it
   *  doesn't drift left when the property panel is open. */
  rightOffsetPx?: number;
}) {
  const [showShapes, setShowShapes] = useState(false);
  const isFramePending = pendingInsert?.type === 'frame';
  const isTextPending = pendingInsert?.type === 'text';
  const isShapePending = pendingInsert?.type === 'shape';
  const isPenPending = pendingInsert?.type === 'pen';
  const isLineDrawPending = pendingInsert?.type === 'line-draw';
  return (
    <div
      className="absolute top-4 z-20 flex items-center gap-1 bg-card rounded border border-black/10 dark:border-white/10 px-3 h-10 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]"
      style={{ left: `calc(50% - ${rightOffsetPx / 2}px)`, transform: 'translateX(-50%)' }}
      onMouseDown={e => e.stopPropagation()}>
      <ToolBtn icon={MousePointer2} onClick={() => onSetPending(null)} active={!pendingInsert} title="Select (V)" />
      <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
      <ToolBtn icon={Frame} onClick={() => onSetPending(isFramePending ? null : { type: 'frame' })} active={isFramePending} title="New Frame (click canvas to place)" />
      <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
      <div className="relative">
        <ToolBtn icon={Hexagon} onClick={() => setShowShapes(v => !v)} active={showShapes || isShapePending} title="Shapes" />
        {showShapes && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowShapes(false)} />
            <div className="absolute top-full left-0 mt-2 z-50">
              <div className="bg-card rounded-lg border shadow-lg py-1 min-w-[140px]">
                {([
                  { type: 'rect' as ShapeType, label: 'Rect' },
                  { type: 'circle' as ShapeType, label: 'Circle' },
                  { type: 'polygon' as ShapeType, label: 'Polygon' },
                  { type: 'star' as ShapeType, label: 'Star' },
                ]).map(({ type, label }) => (
                  <button key={type} onClick={() => { onAddShape(type); setShowShapes(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors text-left">
                    <span className="font-medium">{label}</span>
                  </button>
                ))}
                <div className="my-1 border-t" />
                <button onClick={() => { onAddSvg(); setShowShapes(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                  <FileUp className="h-3.5 w-3.5" /> Upload SVG
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      <ToolBtn icon={Spline} onClick={() => onSetPending(isLineDrawPending ? null : { type: 'line-draw' })} active={isLineDrawPending} title="Draw line (click & drag)" />
      <ToolBtn icon={PenToolIcon} onClick={() => onSetPending(isPenPending ? null : { type: 'pen' })} active={isPenPending} title="Pen tool (click to add points)" />
      <ToolBtn icon={Type} onClick={() => onSetPending(isTextPending ? null : { type: 'text' })} active={isTextPending} title="Text (click frame to place)" />
      <ToolBtn icon={ImagePlus} onClick={onAddImage} title="Image" />
      <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
      <button onClick={onUndo} disabled={!canUndo}
        className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" title="Undo (⌘Z)">
        <Undo2 className="h-4 w-4" />
      </button>
      <button onClick={onRedo} disabled={!canRedo}
        className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" title="Redo (⌘⇧Z)">
        <Redo2 className="h-4 w-4" />
      </button>
    </div>
  );
}


function ToolBtn({ icon: Icon, onClick, active, title }: { icon: React.ComponentType<{ className?: string }>; onClick: () => void; active?: boolean; title: string; }) {
  return (
    <button onClick={onClick} className={cn('p-1.5 rounded transition-colors', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent')} title={title}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ToolBtnSm({ icon: Icon, onClick, title }: { icon: React.ComponentType<{ className?: string }>; onClick: () => void; title: string; }) {
  return (
    <button onClick={onClick} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title={title}>
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function InlineEdit({ value, defaultValue, onSave }: { value: string; defaultValue: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setText(value); setTimeout(() => inputRef.current?.select(), 0); } }, [editing]);
  if (!editing) return (
    <span className="truncate flex-1" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>
      {value || defaultValue}
    </span>
  );
  return (
    <input ref={inputRef} className="flex-1 text-[11px] px-1 py-0 rounded border bg-background min-w-0"
      value={text} onChange={e => setText(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { onSave(text.trim() || defaultValue); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
      onBlur={() => { onSave(text.trim() || defaultValue); setEditing(false); }}
      onClick={e => e.stopPropagation()} />
  );
}

function recalcGroupBounds(elements: CanvasElement[], groupPath: string[]): CanvasElement[] {
  if (groupPath.length === 0) return elements;
  const [currentGroupId, ...restPath] = groupPath;
  return elements.map(el => {
    if (el.id !== currentGroupId || !el.children) return el;
    const updatedChildren = restPath.length > 0
      ? recalcGroupBounds(el.children, restPath)
      : el.children;
    if (updatedChildren.length === 0) return el;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of updatedChildren) {
      minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h);
    }
    return {
      ...el,
      children: updatedChildren.map(c => ({ ...c, x: c.x - minX, y: c.y - minY })),
      x: el.x + minX, y: el.y + minY,
      w: maxX - minX, h: maxY - minY,
    };
  });
}

function getElementLabel(el: CanvasElement): string {
  if (el.type === 'group') return 'Group';
  if (el.html.includes('<svg')) return 'Shape';
  if (el.html.includes('<img')) return 'Image';
  if (el.html.includes('contenteditable')) return 'Text';
  if (el.html.includes('<iframe') || el.html.includes('<script')) return 'HTML';
  return 'Element';
}

function getElementTypeIcon(el: CanvasElement): React.ElementType {
  if (el.type === 'group') return Folder;
  if (el.html.includes('<svg') && el.html.includes('<line')) return Slash;
  if (el.html.includes('<svg')) return Hexagon;
  if (el.html.includes('<img')) return ImageIcon;
  if (el.html.includes('contenteditable')) return Type;
  if (el.html.includes('<iframe') || el.html.includes('<script')) return Code2;
  return Square;
}

type SelectMode = 'replace' | 'add' | 'range';

function SortableLayerItem({ el, frameId, isSelected, onSelect, onContextMenu, onRename, onToggleVisible, onToggleLock }: {
  el: CanvasElement; frameId: string; isSelected: boolean;
  onSelect: (frameId: string, elementId: string, mode: SelectMode) => void;
  onContextMenu?: (e: React.MouseEvent, frameId: string, elementId: string) => void;
  onRename: (elementId: string, name: string) => void;
  onToggleVisible: (elementId: string) => void;
  onToggleLock: (elementId: string) => void;
}) {
  const [groupExpanded, setGroupExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const defaultLabel = getElementLabel(el);
  const isGroup = el.type === 'group';
  const isHidden = el.visible === false;
  const pickMode = (e: React.MouseEvent): SelectMode =>
    e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'add' : 'replace';
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        className={cn('group flex items-center gap-1 pl-6 pr-1.5 py-0.5 cursor-grab active:cursor-grabbing hover:bg-accent/50 text-[11px] select-none',
          isSelected && 'bg-primary/10 text-primary',
          isHidden && 'opacity-50')}
        onMouseDown={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            e.preventDefault();
            window.getSelection()?.removeAllRanges();
          }
        }}
        onClick={(e) => onSelect(frameId, el.id, pickMode(e))}
        onContextMenu={(e) => onContextMenu?.(e, frameId, el.id)}>
        <button
          className="p-0.5 shrink-0 opacity-0 group-hover:opacity-100 data-[hidden=true]:opacity-100"
          data-hidden={isHidden}
          onMouseDown={e => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleVisible(el.id); }}
          title={isHidden ? 'Show' : 'Hide'}
        >
          {isHidden
            ? <EyeOff className="h-3 w-3 text-muted-foreground" />
            : <Eye className="h-3 w-3 text-muted-foreground" />}
        </button>
        {isGroup && (
          <button className="p-0.5 shrink-0" onMouseDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setGroupExpanded(v => !v); }}>
            {groupExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </button>
        )}
        {isGroup
          ? (groupExpanded ? <FolderOpen className="h-3 w-3 shrink-0" /> : <Folder className="h-3 w-3 shrink-0" />)
          : React.createElement(getElementTypeIcon(el), { className: 'h-3 w-3 shrink-0 text-muted-foreground' })
        }
        <InlineEdit value={el.name || ''} defaultValue={defaultLabel}
          onSave={(v) => onRename(el.id, v === defaultLabel ? '' : v)} />
        <button
          className="p-0.5 shrink-0 opacity-0 group-hover:opacity-100 data-[locked=true]:opacity-100"
          data-locked={el.locked || undefined}
          onMouseDown={e => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleLock(el.id); }}
          title={el.locked ? 'Unlock' : 'Lock'}
        >
          {el.locked
            ? <Lock className="h-2.5 w-2.5 text-muted-foreground" />
            : <Unlock className="h-2.5 w-2.5 text-muted-foreground/30" />}
        </button>
      </div>
      {isGroup && groupExpanded && el.children && (
        <div className="pl-4">
          {el.children.map(child => (
            <SortableLayerItem
              key={child.id}
              el={child}
              frameId={frameId}
              isSelected={false}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onRename={onRename}
              onToggleVisible={onToggleVisible}
              onToggleLock={onToggleLock}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LayerPanel({ data, activeFrameId, selectedIds, onSelectFrame, onSelectElement, onSelectCanvasElement, onClose, onRenameFrame, onRenameElement, onRenameCanvasElement, onReorderElements, onToggleVisible, onToggleLock, onElementContextMenu, onFrameContextMenu }: {
  data: CanvasData;
  activeFrameId: string | null;
  selectedIds: Set<string>;
  onSelectFrame: (frameId: string) => void;
  onSelectElement: (frameId: string, elementId: string, mode: SelectMode) => void;
  onSelectCanvasElement: (elementId: string, mode: SelectMode) => void;
  onClose: () => void;
  onRenameFrame: (frameId: string, title: string) => void;
  onRenameElement: (frameId: string, elementId: string, name: string) => void;
  onRenameCanvasElement: (elementId: string, name: string) => void;
  onReorderElements: (frameId: string, activeId: string, overId: string) => void;
  onToggleVisible: (elementId: string) => void;
  onToggleLock: (elementId: string) => void;
  /** Right-click on an element (frame-scoped or canvas-level). The handler
   *  is responsible for selecting the element first, then opening the menu. */
  onElementContextMenu?: (e: React.MouseEvent, frameId: string | null, elementId: string) => void;
  onFrameContextMenu?: (e: React.MouseEvent, frameId: string) => void;
}) {
  const [collapsedFrames, setCollapsedFrames] = useState<Set<string>>(new Set());
  const toggleCollapse = (fid: string) => setCollapsedFrames(prev => {
    const next = new Set(prev);
    if (next.has(fid)) next.delete(fid); else next.add(fid);
    return next;
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const pickMode = (e: React.MouseEvent): SelectMode =>
    e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'add' : 'replace';

  return (
    <div className="w-[240px] min-w-[240px] border-r border-border flex flex-col shrink-0 bg-card overflow-y-auto select-none"
      onMouseDown={e => e.stopPropagation()}>
      <div className="px-2 py-1.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Layers className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Layers</span>
        </div>
        <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {(data.elements ?? []).slice().sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0)).map(el => {
          const defaultLabel = getElementLabel(el);
          return (
            <div key={el.id}
              className={cn('group flex items-center gap-1 px-3 py-1 cursor-pointer hover:bg-accent/50 text-[11px] select-none',
                !activeFrameId && selectedIds.has(el.id) && 'bg-primary/10 text-primary')}
              onMouseDown={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            e.preventDefault();
            window.getSelection()?.removeAllRanges();
          }
        }}
              onClick={(e) => onSelectCanvasElement(el.id, pickMode(e))}
              onContextMenu={(e) => onElementContextMenu?.(e, null, el.id)}>
              {React.createElement(getElementTypeIcon(el), { className: 'h-3 w-3 shrink-0 text-muted-foreground' })}
              <InlineEdit value={el.name || ''} defaultValue={defaultLabel}
                onSave={(v) => onRenameCanvasElement(el.id, v === defaultLabel ? '' : v)} />
              <button
                className="p-0.5 shrink-0 opacity-0 group-hover:opacity-100 data-[locked=true]:opacity-100"
                data-locked={el.locked || undefined}
                onMouseDown={e => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onToggleLock(el.id); }}
                title={el.locked ? 'Unlock' : 'Lock'}
              >
                {el.locked
                  ? <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                  : <Unlock className="h-2.5 w-2.5 text-muted-foreground/30" />}
              </button>
            </div>
          );
        })}
        {(data.pages ?? []).map(frame => {
          const isActive = frame.page_id === activeFrameId;
          const collapsed = collapsedFrames.has(frame.page_id);
          const sortedEls = frame.elements.slice().sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0));
          return (
            <div key={frame.page_id}>
              <div className={cn('flex items-center gap-1 px-1.5 py-1 cursor-pointer hover:bg-accent/50 text-[11px]',
                isActive && 'bg-primary/5 text-primary')}
                onClick={() => onSelectFrame(frame.page_id)}
                onContextMenu={(e) => onFrameContextMenu?.(e, frame.page_id)}>
                <button className="p-0.5" onClick={(e) => { e.stopPropagation(); toggleCollapse(frame.page_id); }}>
                  {collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                </button>
                <Frame className="h-3 w-3 shrink-0" />
                <InlineEdit value={frame.title || ''} defaultValue="Untitled"
                  onSave={(v) => onRenameFrame(frame.page_id, v)} />
              </div>
              {!collapsed && (
                <DndContext sensors={sensors} collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  onDragEnd={(event: DragEndEvent) => {
                    const { active, over } = event;
                    if (over && active.id !== over.id) onReorderElements(frame.page_id, String(active.id), String(over.id));
                  }}>
                  <SortableContext items={sortedEls.map(e => e.id)} strategy={verticalListSortingStrategy}>
                    {sortedEls.map(el => (
                      <SortableLayerItem key={el.id} el={el} frameId={frame.page_id}
                        isSelected={selectedIds.has(el.id)}
                        onSelect={onSelectElement}
                        onContextMenu={(e, fid, eid) => onElementContextMenu?.(e, fid, eid)}
                        onRename={(eid, name) => onRenameElement(frame.page_id, eid, name)}
                        onToggleVisible={onToggleVisible}
                        onToggleLock={onToggleLock} />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ZoomBar({ zoom, onZoomIn, onZoomOut, onResetZoom }: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onResetZoom: () => void }) {
  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 bg-card/50 backdrop-blur-sm rounded border border-black/10 dark:border-white/10 px-3 h-10"
      onMouseDown={e => e.stopPropagation()}>
      <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/[0.04] text-black/70 dark:text-white/70 disabled:opacity-30" onClick={onZoomOut} disabled={zoom <= 0.1} title="Zoom out"><Minus className="h-3.5 w-3.5" /></button>
      <button className="text-sm font-medium text-black/70 dark:text-white/70 w-10 text-center tabular-nums rounded hover:bg-black/[0.04] cursor-pointer transition-colors" onClick={onResetZoom} title="Reset zoom">{Math.round(zoom * 100)}%</button>
      <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/[0.04] text-black/70 dark:text-white/70 disabled:opacity-30" onClick={onZoomIn} disabled={zoom >= 5} title="Zoom in"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

export function CanvasEditor({
  canvasId, breadcrumb, onBack, onDeleted, onCopyLink,
  docListVisible, onToggleDocList, onNavigate, focusCommentId,
  showComments, onShowComments, onCloseComments, onToggleComments,
  isPinned, onTogglePin,
}: CanvasEditorProps) {
  const { t } = useT();
  useKeyboardScope('canvas', CANVAS_SHORTCUTS);
  const queryClient = useQueryClient();
  const contentId = `canvas:${canvasId}`;
  const containerRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<CanvasData | null>(null);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [frameExplicitlySelected, setFrameExplicitlySelected] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Layer panel multi-select anchor: { scope: frameId | '__canvas__', elementId }.
  // Range select uses [anchor, current] within the same scope; cross-scope shift falls back to replace.
  const layerAnchorRef = useRef<{ scope: string; elementId: string } | null>(null);
  const [scale, setScale] = useState(0.5);
  const [pan, setPan] = useState({ x: 100, y: 100 });
  const [saveStatus, setSaveStatus] = useState('');
  const [showRevisions, setShowRevisions] = useState(false);
  const [previewRevisionData, setPreviewRevisionData] = useState<CanvasData | null>(null);
  const [previewRevisionMeta, setPreviewRevisionMeta] = useState<{ id: string; created_at: string } | null>(null);
  const [commentAnchor, setCommentAnchor] = useState<{ type: string; id: string; meta?: Record<string, unknown> } | null>(null);
  const [showPropertyPanel, setShowPropertyPanel] = useState(true);
  const [showLayers, setShowLayers] = useState(true);
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [isPanning, setIsPanning] = useState(false);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [vectorEditId, setVectorEditId] = useState<string | null>(null);
  const [vectorSelection, setVectorSelection] = useState<VectorSelectionInfo | null>(null);
  const [editingFrameName, setEditingFrameName] = useState<string | null>(null);
  const [subElementEditId, setSubElementEditId] = useState<string | null>(null);
  const [subElementPath, setSubElementPath] = useState<string | null>(null);
  const [subElementSelection, setSubElementSelection] = useState<SubElementSelection | null>(null);
  const [subTextEditCssPath, setSubTextEditCssPath] = useState<string | null>(null);
  const [subTextEditRect, setSubTextEditRect] = useState<DOMRect | null>(null);
  const [subTextEditing, setSubTextEditing] = useState(false);
  const subTextEditingRef = useRef(false);
  const setSubTextEditingBoth = useCallback((v: boolean) => { setSubTextEditing(v); subTextEditingRef.current = v; }, []);
  const [activeGroupPath, setActiveGroupPath] = useState<string[]>([]);
  const activeGroupId = activeGroupPath.length > 0 ? activeGroupPath[activeGroupPath.length - 1] : null;
  const setActiveGroupId = (id: string | null) => setActiveGroupPath(id ? [id] : []);
  const shadowRootRefs = useRef<Map<string, ShadowRoot>>(new Map());
  const subDragOriginRef = useRef<{ left: number; top: number } | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [pendingInsert, _setPendingInsert] = useState<PendingInsert | null>(null);
  const setPendingInsert = useCallback((v: PendingInsert | null) => {
    _setPendingInsert(v);
  }, []);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [createPreview, setCreatePreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const undoRedo = useUndoRedo<CanvasData | null>(null);

  const dragRef = useRef<{
    type: 'move' | 'resize' | 'pan' | 'frame-move' | 'frame-resize' | 'marquee' | 'create' | 'rotate';
    elementId?: string; handle?: string;
    frameId?: string;
    groupId?: string;
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number;
    origRotation?: number; // only used by 'rotate' drag type
    origAspectLocked?: boolean; // only used by 'resize' drag type
    origPanX?: number; origPanY?: number;
    origPositions?: Map<string, { x: number; y: number }>;
    origHtml?: string;
    origChildren?: CanvasElement[];
    createType?: PendingInsert;
    /** Alt+drag duplicate intent. When set, the first mousemove with any
     *  non-zero pixel movement clones the selection into the same pool and
     *  retargets the drag onto the clones. If the user releases without
     *  moving, no clones are created. */
    altPendingClone?: { selectionIds: string[]; primaryId: string; frameId: string | null; groupId: string | null };
  } | null>(null);

  const { data: canvasResp } = useQuery({
    queryKey: ['canvas', canvasId],
    queryFn: () => gw.getCanvas(canvasId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Only seed local state from the first fetch. Subsequent refetches (e.g.
  // from invalidate-after-save to refresh the topbar's updated_at) must NOT
  // overwrite in-flight local edits.
  const initializedFromServerRef = useRef(false);
  useEffect(() => {
    if (canvasResp?.data && !initializedFromServerRef.current) {
      initializedFromServerRef.current = true;
      const d = canvasResp.data;
      if (d.pages.length > 0 && !d.pages[0].frame_x && !d.pages[0].frame_y) {
        let x = 0;
        for (const page of d.pages) {
          page.frame_x = x;
          page.frame_y = 0;
          x += page.width + FRAME_GAP;
        }
      }
      setData(d);
      undoRedo.reset(d);
      if (d.pages.length > 0) setActiveFrameId(d.pages[0].page_id);
    }
  }, [canvasResp]);

  useEffect(() => {
    if (data && !initialized && containerRef.current) {
      fitAllFrames();
      setInitialized(true);
    }
  }, [data, initialized]);

  const activeFrame = data?.pages.find(p => p.page_id === activeFrameId) ?? null;

  // ─── Save ─────────────────────────────
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<CanvasData | null>(null);

  const scheduleSave = useCallback((newData: CanvasData) => {
    pendingDataRef.current = newData;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const toSave = pendingDataRef.current;
      if (!toSave) return;
      pendingDataRef.current = null;
      setSaveStatus('Saving...');
      try {
        await gw.saveCanvas(canvasId, toSave);
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(''), 2000);
        // Refresh updated_at / updated_by in the topbar's metaLine.
        queryClient.invalidateQueries({ queryKey: ['canvas', canvasId] });
      }
      catch (e) { setSaveStatus('Save failed'); showError('Failed to save canvas', e); }
    }, 800);
  }, [canvasId, queryClient]);

  const updateData = useCallback((updater: (prev: CanvasData) => CanvasData) => {
    setData(prev => {
      if (!prev) return prev;
      const next = updater(prev);
      undoRedo.push(next);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const updateFrame = useCallback((frameId: string, updater: (page: CanvasPage) => CanvasPage) => {
    updateData(d => ({ ...d, pages: d.pages.map(p => p.page_id === frameId ? updater(p) : p) }));
  }, [updateData]);

  const updateCanvasElement = useCallback((elementId: string, updates: Partial<CanvasElement>) => {
    updateData(d => ({ ...d, elements: (d.elements ?? []).map(el => el.id === elementId ? { ...el, ...updates } : el) }));
  }, [updateData]);

  // ─── ElementContext: unified element pool abstraction ───
  const elementContext = useMemo(() => {
    if (activeFrameId && data) {
      const frame = data.pages.find(p => p.page_id === activeFrameId);
      return {
        elements: frame?.elements ?? [],
        setElements: (updater: (els: CanvasElement[]) => CanvasElement[]) => {
          updateFrame(activeFrameId, page => ({ ...page, elements: updater(page.elements) }));
        },
        offsetX: frame?.frame_x ?? 0,
        offsetY: frame?.frame_y ?? 0,
        containerWidth: frame?.width ?? 1920,
        containerHeight: frame?.height ?? 1080,
      };
    }
    return {
      elements: data?.elements ?? [],
      setElements: (updater: (els: CanvasElement[]) => CanvasElement[]) => {
        updateData(prev => ({ ...prev, elements: updater(prev.elements ?? []) }));
      },
      offsetX: 0,
      offsetY: 0,
      containerWidth: Infinity,
      containerHeight: Infinity,
    };
  }, [activeFrameId, data, updateFrame, updateData]);

  const resolveGroupByPath = useCallback((path: string[] = activeGroupPath): { group: CanvasElement; absX: number; absY: number } | null => {
    if (path.length === 0) return null;
    const topElements = elementContext.elements;
    if (!topElements) return null;
    let current: CanvasElement | undefined;
    let absX = 0, absY = 0;
    for (let i = 0; i < path.length; i++) {
      const id = path[i];
      if (i === 0) {
        current = topElements.find(e => e.id === id);
      } else {
        current = current?.children?.find(c => c.id === id);
      }
      if (!current || current.type !== 'group' || !current.children) return null;
      absX += current.x;
      absY += current.y;
    }
    return current ? { group: current, absX, absY } : null;
  }, [elementContext.elements, activeGroupPath]);

  const findElementById = useCallback((id: string): CanvasElement | undefined => {
    const findInChildren = (children: CanvasElement[]): CanvasElement | undefined => {
      for (const child of children) {
        if (child.id === id) return child;
        if (child.type === 'group' && child.children) {
          const found = findInChildren(child.children);
          if (found) return found;
        }
      }
      return undefined;
    };
    if (activeGroupPath.length > 0) {
      const resolved = resolveGroupByPath();
      if (resolved?.group.children) {
        const found = findInChildren(resolved.group.children);
        if (found) return found;
      }
    }
    for (const el of elementContext.elements) {
      if (el.id === id) return el;
      if (el.type === 'group' && el.children) {
        const found = findInChildren(el.children);
        if (found) return found;
      }
    }
    return undefined;
  }, [elementContext.elements, activeGroupPath, resolveGroupByPath]);

  const updateElement = useCallback((elementId: string, updates: Partial<CanvasElement>, groupId?: string) => {
    const updateNestedChild = (elements: CanvasElement[], path: string[], childId: string, upd: Partial<CanvasElement>): CanvasElement[] => {
      if (path.length === 0) {
        return elements.map(el => el.id === childId ? { ...el, ...upd } : el);
      }
      const [currentGroupId, ...restPath] = path;
      return elements.map(el => {
        if (el.id === currentGroupId && el.children) {
          return { ...el, children: updateNestedChild(el.children, restPath, childId, upd) };
        }
        return el;
      });
    };
    if (groupId || activeGroupPath.length > 0) {
      const path = activeGroupPath.length > 0 ? activeGroupPath : [groupId!];
      elementContext.setElements(els => updateNestedChild(els, path, elementId, updates));
    } else {
      elementContext.setElements(els => els.map(el => el.id === elementId ? { ...el, ...updates } : el));
    }
  }, [elementContext, activeGroupPath]);

  const reorderElements = useCallback((frameId: string, activeId: string, overId: string) => {
    updateFrame(frameId, page => {
      const sorted = page.elements.slice().sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0));
      const fromIdx = sorted.findIndex(e => e.id === activeId);
      const toIdx = sorted.findIndex(e => e.id === overId);
      if (fromIdx === -1 || toIdx === -1) return page;
      const [moved] = sorted.splice(fromIdx, 1);
      sorted.splice(toIdx, 0, moved);
      const updated = new Map<string, number>();
      sorted.forEach((el, i) => updated.set(el.id, sorted.length - i));
      return { ...page, elements: page.elements.map(el => ({ ...el, z_index: updated.get(el.id) ?? el.z_index ?? 0 })) };
    });
  }, [updateFrame]);

  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { cx: 0, cy: 0 };
    return { cx: (clientX - rect.left - pan.x) / scale, cy: (clientY - rect.top - pan.y) / scale };
  }, [pan, scale]);

  const findFrameAtPoint = useCallback((cx: number, cy: number): CanvasPage | null => {
    if (!data) return null;
    for (const frame of data.pages) {
      const fx = frame.frame_x ?? 0, fy = frame.frame_y ?? 0;
      if (cx >= fx && cx <= fx + frame.width && cy >= fy && cy <= fy + frame.height) return frame;
    }
    return null;
  }, [data]);

  const handleUndo = useCallback(() => {
    const prev = undoRedo.undo();
    if (prev) { setData(prev); scheduleSave(prev); }
  }, [undoRedo, scheduleSave]);

  const handleRedo = useCallback(() => {
    const next = undoRedo.redo();
    if (next) { setData(next); scheduleSave(next); }
  }, [undoRedo, scheduleSave]);

  const handleCreateManualVersion = useCallback(async () => {
    // Flush any pending deferred save before snapshotting so the snapshot
    // captures the latest in-memory state.
    if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null; }
    const pendingToSave = pendingDataRef.current;
    if (pendingToSave) {
      pendingDataRef.current = null;
      await gw.saveCanvas(canvasId, pendingToSave);
    }
    await gw.createContentManualSnapshot(contentId);
  }, [contentId, canvasId]);

  const navigateToAnchor = useCallback((anchor: { type: string; id: string }) => {
    if (anchor.type === 'page') {
      const page = data?.pages.find(p => p.page_id === anchor.id);
      if (page) {
        setActiveFrameId(page.page_id);
        setSelectedIds(new Set());
      }
      return;
    }
    if (anchor.type !== 'element') return;

    const findInElements = (elements: CanvasElement[], id: string): boolean =>
      elements.some(e => e.id === id || (e.children ? findInElements(e.children, id) : false));

    for (const page of data?.pages ?? []) {
      if (findInElements(page.elements, anchor.id)) {
        setActiveFrameId(page.page_id);
        setSelectedIds(new Set([anchor.id]));
        return;
      }
    }
    if (data?.elements && findInElements(data.elements, anchor.id)) {
      setActiveFrameId(null);
      setSelectedIds(new Set([anchor.id]));
    }
  }, [data]);

  const handleCanvasComment = useCallback((type: 'element' | 'page', target: CanvasElement | null) => {
    if (type === 'element' && target) {
      const pageIndex = data?.pages.findIndex(p => p.elements.some(e => e.id === target.id)) ?? -1;
      const page = pageIndex >= 0 ? data!.pages[pageIndex] : null;
      setCommentAnchor({
        type: 'element',
        id: target.id,
        meta: {
          page_index: pageIndex >= 0 ? pageIndex : undefined,
          page_title: page?.title,
          element_name: target.name || getElementLabel(target),
        },
      });
    }
    onShowComments();
    setShowRevisions(false);
  }, [data, onShowComments]);

  const handlePageComment = useCallback((frameId: string, frameTitle: string, frameIndex: number) => {
    setCommentAnchor({
      type: 'page',
      id: frameId,
      meta: { page_index: frameIndex, page_title: frameTitle || `Page ${frameIndex + 1}` },
    });
    onShowComments();
    setShowRevisions(false);
  }, [onShowComments]);

  useEffect(() => {
    const flush = () => {
      if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null; }
      const toSave = pendingDataRef.current;
      if (toSave) { pendingDataRef.current = null; gw.saveCanvas(canvasId, toSave).catch(() => {}); }
    };
    window.addEventListener('flush-canvas-save', flush);
    return () => { flush(); window.removeEventListener('flush-canvas-save', flush); };
  }, [canvasId]);

  // ─── Fit all frames in viewport ─────
  const fitAllFrames = useCallback(() => {
    if (!containerRef.current || !data || data.pages.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const page of data.pages) {
      const fx = page.frame_x ?? 0, fy = page.frame_y ?? 0;
      minX = Math.min(minX, fx);
      minY = Math.min(minY, fy - FRAME_LABEL_HEIGHT);
      maxX = Math.max(maxX, fx + page.width);
      maxY = Math.max(maxY, fy + page.height);
    }
    const contentW = maxX - minX, contentH = maxY - minY;
    const padding = 80;
    const s = Math.min((rect.width - padding * 2) / contentW, (rect.height - padding * 2) / contentH, 1);
    setScale(s);
    setPan({
      x: (rect.width - contentW * s) / 2 - minX * s,
      y: (rect.height - contentH * s) / 2 - minY * s,
    });
  }, [data]);

  const fitToRect = useCallback((rx: number, ry: number, rw: number, rh: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const padding = 80;
    const availW = cRect.width - padding * 2;
    const availH = cRect.height - padding * 2;
    const newScale = Math.min(1, availW / rw, availH / rh);
    const newPanX = cRect.width / 2 - (rx + rw / 2) * newScale;
    const newPanY = cRect.height / 2 - (ry + rh / 2) * newScale;
    setScale(newScale);
    setPan({ x: newPanX, y: newPanY });
  }, []);

  const zoomAroundCenter = useCallback((factor: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    setScale(prevScale => {
      const newScale = Math.min(5, Math.max(0.1, prevScale * factor));
      const ratio = newScale / prevScale;
      setPan(prevPan => ({
        x: cx - (cx - prevPan.x) * ratio,
        y: cy - (cy - prevPan.y) * ratio,
      }));
      return newScale;
    });
  }, []);

  const resetZoomTo100 = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    setPan(prevPan => ({
      x: cx - (cx - prevPan.x) * (1 / scale),
      y: cy - (cy - prevPan.y) * (1 / scale),
    }));
    setScale(1);
  }, [scale]);

  // ─── Drag/resize/pan ───────────────
  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current; if (!d) return;
      const pos = getClientPos(e); if (!pos) return;

      if (d.type === 'pan') { setPan({ x: (d.origPanX ?? 0) + (pos.clientX - d.startX), y: (d.origPanY ?? 0) + (pos.clientY - d.startY) }); return; }

      if (d.type === 'create') {
        const { cx: curCx, cy: curCy } = screenToCanvas(pos.clientX, pos.clientY);
        const x = Math.min(d.origX, curCx);
        const y = Math.min(d.origY, curCy);
        const w = Math.abs(curCx - d.origX);
        const h = Math.abs(curCy - d.origY);
        setCreatePreview({ x, y, w, h });
        return;
      }

      if (d.type === 'frame-move' && d.frameId) {
        const dx = (pos.clientX - d.startX) / scale, dy = (pos.clientY - d.startY) / scale;
        updateFrame(d.frameId, page => ({ ...page, frame_x: Math.round(d.origX + dx), frame_y: Math.round(d.origY + dy) }));
        return;
      }

      if (d.type === 'frame-resize' && d.frameId && d.handle) {
        const dx = (pos.clientX - d.startX) / scale;
        const dy = (pos.clientY - d.startY) / scale;
        let fx = d.origX, fy = d.origY, w = d.origW, h = d.origH;
        if (d.handle.includes('e')) w = Math.max(100, w + dx);
        if (d.handle.includes('w')) { const nw = Math.max(100, w - dx); fx += w - nw; w = nw; }
        if (d.handle.includes('s')) h = Math.max(100, h + dy);
        if (d.handle.includes('n')) { const nh = Math.max(100, h - dy); fy += h - nh; h = nh; }
        updateFrame(d.frameId, page => ({
          ...page, frame_x: Math.round(fx), frame_y: Math.round(fy),
          width: Math.round(w), height: Math.round(h),
        }));
        return;
      }

      if (d.type === 'marquee') {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const curX = pos.clientX - rect.left, curY = pos.clientY - rect.top;
          const x = Math.min(d.origX, curX), y = Math.min(d.origY, curY);
          const w = Math.abs(curX - d.origX), h = Math.abs(curY - d.origY);
          setMarqueeRect({ x, y, w, h });
        }
        return;
      }

      const dx = (pos.clientX - d.startX) / scale, dy = (pos.clientY - d.startY) / scale;

      // Alt+drag: first non-zero movement → clone the selection now and
      // retarget the drag onto the clones. Originals stay put; copies
      // move with the cursor.
      if (d.type === 'move' && d.altPendingClone && (Math.abs(pos.clientX - d.startX) > 0 || Math.abs(pos.clientY - d.startY) > 0)) {
        const { selectionIds, primaryId, frameId: pendFrameId, groupId: pendGroupId } = d.altPendingClone;
        d.altPendingClone = undefined;

        // Resolve the source pool for the clone source/destination.
        // Group: clones go into the group's children.
        // Frame: clones go into the frame's elements.
        // Canvas top: clones go into data.elements.
        let pool: CanvasElement[] = [];
        if (pendGroupId) {
          const ctx = resolveGroupByPath();
          pool = ctx?.group.children ?? [];
        } else if (pendFrameId) {
          pool = data?.pages.find(p => p.page_id === pendFrameId)?.elements ?? [];
        } else {
          pool = data?.elements ?? [];
        }

        const idMap = new Map<string, string>();
        const cloneEl = (src: CanvasElement): CanvasElement => {
          const newId = `el-${crypto.randomUUID().slice(0, 8)}`;
          idMap.set(src.id, newId);
          return {
            ...src,
            id: newId,
            children: src.children ? src.children.map(cloneEl) : undefined,
          };
        };
        const sources = pool.filter(el => selectionIds.includes(el.id) && !el.locked);
        if (sources.length > 0) {
          const clones = sources.map(cloneEl);
          const draggedCloneId = idMap.get(primaryId);
          if (draggedCloneId) {
            const draggedClone = clones.find(c => c.id === draggedCloneId)!;
            // Retarget dragRef onto the clones
            d.elementId = draggedClone.id;
            d.origX = draggedClone.x;
            d.origY = draggedClone.y;
            const newOrigPositions = new Map<string, { x: number; y: number }>();
            if (clones.length > 1) {
              for (const c of clones) newOrigPositions.set(c.id, { x: c.x, y: c.y });
            }
            d.origPositions = newOrigPositions;

            const cloneIdSet = new Set(clones.map(c => c.id));
            flushSync(() => {
              if (pendGroupId) {
                // Insert clones into the deepest group's children via nested update.
                const path = activeGroupPath;
                const insertIntoPath = (els: CanvasElement[], remaining: string[]): CanvasElement[] => {
                  if (remaining.length === 0) return [...els, ...clones];
                  const [head, ...rest] = remaining;
                  return els.map(el => el.id === head && el.children
                    ? { ...el, children: insertIntoPath(el.children, rest) }
                    : el);
                };
                if (pendFrameId) {
                  updateData(prev => ({
                    ...prev,
                    pages: prev.pages.map(p => p.page_id === pendFrameId
                      ? { ...p, elements: insertIntoPath(p.elements, path) }
                      : p),
                  }));
                } else {
                  updateData(prev => ({ ...prev, elements: insertIntoPath(prev.elements ?? [], path) }));
                }
              } else if (pendFrameId) {
                updateData(prev => ({
                  ...prev,
                  pages: prev.pages.map(p => p.page_id === pendFrameId
                    ? { ...p, elements: [...p.elements, ...clones] }
                    : p),
                }));
              } else {
                updateData(prev => ({ ...prev, elements: [...(prev.elements ?? []), ...clones] }));
              }
              setSelectedIds(cloneIdSet);
            });
          }
        }
      }

      if (d.type === 'move' && d.elementId) {
        let newX = Math.round(d.origX + dx), newY = Math.round(d.origY + dy);
        const movingEl = findElementById(d.elementId);
        if (movingEl) {
          const ctxElements = elementContext.elements;
          const snapTargets = d.groupId ? (resolveGroupByPath()?.group.children ?? ctxElements) : ctxElements;
          const otherRects = snapTargets.filter(el => el.id !== d.elementId);
          const container = { width: elementContext.containerWidth, height: elementContext.containerHeight };
          const snap = findSnapLines(
            { x: newX, y: newY, w: movingEl.w, h: movingEl.h },
            otherRects, SNAP_THRESHOLD / scale, container,
          );
          if (snap.snapX !== null) newX = snap.snapX;
          if (snap.snapY !== null) newY = snap.snapY;
          const spacingResult = findEqualSpacing(
            { x: newX, y: newY, w: movingEl.w, h: movingEl.h },
            otherRects, SNAP_THRESHOLD / scale,
          );
          if (spacingResult.snapX !== undefined) newX = spacingResult.snapX;
          if (spacingResult.snapY !== undefined) newY = spacingResult.snapY;
          setSnapLines([...snap.lines, ...spacingResult.lines]);
        }
        if (selectedIds.size > 1 && selectedIds.has(d.elementId)) {
          const ox = newX - d.origX, oy = newY - d.origY;
          elementContext.setElements(els => els.map(el => {
            if (el.id === d.elementId) return { ...el, x: newX, y: newY };
            if (!selectedIds.has(el.id)) return el;
            const orig = d.origPositions?.get(el.id);
            return orig ? { ...el, x: orig.x + ox, y: orig.y + oy } : el;
          }));
        } else { updateElement(d.elementId, { x: newX, y: newY }, d.groupId); }
      } else if (d.type === 'resize' && d.handle && d.elementId) {
        // For rotated elements, transform mouse delta into the element-local
        // frame (rotate by -rotation), do the resize math axis-aligned, then
        // map the new center back to world so the anchor (opposite corner/
        // edge) stays under the cursor visually.
        const rotDeg = d.origRotation || 0;
        const rotRad = (rotDeg * Math.PI) / 180;
        const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
        const localDx = dx * cosR + dy * sinR;
        const localDy = -dx * sinR + dy * cosR;
        let nXLocal = d.origX, nYLocal = d.origY, nW = d.origW, nH = d.origH;
        if (d.handle.includes('e')) nW = Math.max(20, d.origW + localDx);
        if (d.handle.includes('w')) { nW = Math.max(20, d.origW - localDx); nXLocal = d.origX + d.origW - nW; }
        if (d.handle.includes('s')) nH = Math.max(20, d.origH + localDy);
        if (d.handle.includes('n')) { nH = Math.max(20, d.origH - localDy); nYLocal = d.origY + d.origH - nH; }
        const aspectLockActive = (e instanceof MouseEvent && e.shiftKey) || d.origAspectLocked === true;
        if (aspectLockActive && d.origW > 0 && d.origH > 0) {
          const ratio = d.origW / d.origH;
          const isCorner = d.handle.length === 2;
          if (isCorner) {
            // Corner: pick the larger delta as the driver, derive the other.
            const dw = Math.abs(nW - d.origW);
            const dh = Math.abs(nH - d.origH);
            if (dw >= dh) {
              nH = nW / ratio;
              if (d.handle.includes('n')) nYLocal = d.origY + d.origH - nH;
            } else {
              nW = nH * ratio;
              if (d.handle.includes('w')) nXLocal = d.origX + d.origW - nW;
            }
            if (nW < 20) {
              nW = 20;
              nH = nW / ratio;
              if (d.handle.includes('n')) nYLocal = d.origY + d.origH - nH;
              if (d.handle.includes('w')) nXLocal = d.origX + d.origW - nW;
            }
            if (nH < 20) {
              nH = 20;
              nW = nH * ratio;
              if (d.handle.includes('w')) nXLocal = d.origX + d.origW - nW;
              if (d.handle.includes('n')) nYLocal = d.origY + d.origH - nH;
            }
          } else {
            // Edge: derive the orthogonal dimension and grow it symmetrically
            // around the original midline so the dragged edge feels anchored.
            if (d.handle === 'e' || d.handle === 'w') {
              nH = Math.max(20, nW / ratio);
              if (nH * ratio !== nW) nW = nH * ratio;
              nYLocal = d.origY + (d.origH - nH) / 2;
            } else if (d.handle === 'n' || d.handle === 's') {
              nW = Math.max(20, nH * ratio);
              if (nW / ratio !== nH) nH = nW / ratio;
              nXLocal = d.origX + (d.origW - nW) / 2;
            }
          }
        }
        // Map the new center from local-frame delta back to world.
        const newCenterLocalDX = nXLocal + nW / 2 - (d.origX + d.origW / 2);
        const newCenterLocalDY = nYLocal + nH / 2 - (d.origY + d.origH / 2);
        const newCenterWorldDX = newCenterLocalDX * cosR - newCenterLocalDY * sinR;
        const newCenterWorldDY = newCenterLocalDX * sinR + newCenterLocalDY * cosR;
        const newCx = d.origX + d.origW / 2 + newCenterWorldDX;
        const newCy = d.origY + d.origH / 2 + newCenterWorldDY;
        const nX = newCx - nW / 2;
        const nY = newCy - nH / 2;
        const updates: Partial<CanvasElement> = { x: Math.round(nX), y: Math.round(nY), w: Math.round(nW), h: Math.round(nH) };
        if (d.origHtml) {
          updates.html = rescaleSvgHtml(d.origHtml, d.origW, d.origH, Math.round(nW), Math.round(nH));
        }
        // Text element: handle that changes width flips auto-width → fixed-width
        // and re-measures height to fit the new wrapping.
        if (d.origHtml === undefined) {
          const sourceEl = findElementById(d.elementId);
          if (sourceEl?.html?.includes('data-text-resize=') && d.handle && /[ew]/.test(d.handle)) {
            let newHtml = sourceEl.html;
            if (newHtml.includes('data-text-resize="auto"')) {
              newHtml = newHtml
                .replace('data-text-resize="auto"', 'data-text-resize="fixed-width"')
                .replace(/(<div\b[^>]*?\sstyle="[^"]*?)white-space:\s*nowrap;?\s*/, '$1white-space: normal; word-wrap: break-word; ');
            }
            updates.html = newHtml;
            // Re-measure height for the new width.
            if (typeof document !== 'undefined' && !newHtml.includes('data-text-resize="fixed"')) {
              const measurer = document.createElement('div');
              measurer.style.cssText = `position:absolute;left:-9999px;top:-9999px;visibility:hidden;width:${Math.round(nW)}px;`;
              measurer.innerHTML = newHtml;
              document.body.appendChild(measurer);
              const inner = measurer.firstElementChild as HTMLElement | null;
              if (inner) {
                inner.style.width = `${Math.round(nW)}px`;
                const rect = inner.getBoundingClientRect();
                updates.h = Math.max(20, Math.ceil(rect.height));
              }
              if (measurer.isConnected) document.body.removeChild(measurer);
            }
          }
        }
        // Group: scale children proportionally from original positions (recursive)
        if (d.origChildren && d.origW > 0 && d.origH > 0) {
          const scaleX = Math.round(nW) / d.origW;
          const scaleY = Math.round(nH) / d.origH;
          const scaleChildrenRecursive = (children: CanvasElement[], sx: number, sy: number): CanvasElement[] => {
            return children.map(child => {
              const newChild: CanvasElement = {
                ...child,
                x: Math.round(child.x * sx),
                y: Math.round(child.y * sy),
                w: Math.round(child.w * sx),
                h: Math.round(child.h * sy),
              };
              if (child.html && child.html.includes('<svg')) {
                newChild.html = rescaleSvgHtml(child.html, child.w, child.h, newChild.w, newChild.h);
              }
              if (child.type === 'group' && child.children) {
                newChild.children = scaleChildrenRecursive(child.children, sx, sy);
              }
              return newChild;
            });
          };
          updates.children = scaleChildrenRecursive(d.origChildren, scaleX, scaleY);
        }
        updateElement(d.elementId, updates, d.groupId);
      } else if (d.type === 'rotate' && d.elementId) {
        // Rotation pivot in screen coords = element's transform-origin.
        // Element coords are frame-local (or canvas-relative if no frame),
        // so add the frame offset when computing the screen pivot.
        const el = findElementById(d.elementId);
        const originFx = el?.rotationOriginX ?? 0.5;
        const originFy = el?.rotationOriginY ?? 0.5;
        const dragFrame = d.frameId && data ? data.pages.find(p => p.page_id === d.frameId) : null;
        const fx = dragFrame?.frame_x ?? 0;
        const fy = dragFrame?.frame_y ?? 0;
        const cxScreen = pan.x + (fx + d.origX + originFx * d.origW) * scale;
        const cyScreen = pan.y + (fy + d.origY + originFy * d.origH) * scale;
        const startAngle = Math.atan2(d.startY - cyScreen, d.startX - cxScreen);
        const currentAngle = Math.atan2(pos.clientY - cyScreen, pos.clientX - cxScreen);
        let deltaDeg = ((currentAngle - startAngle) * 180) / Math.PI;
        if (e instanceof MouseEvent && e.shiftKey) {
          deltaDeg = Math.round(deltaDeg / 15) * 15;
        }
        let newRotation = (d.origRotation || 0) + deltaDeg;
        newRotation = ((newRotation % 360) + 360) % 360;
        updateElement(d.elementId, { rotation: newRotation }, d.groupId);
      }
    };
    const handleUp = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (d?.type === 'pan') setIsPanning(false);
      if (d?.type === 'move' && d.elementId && d.frameId && !d.groupId && data) {
        const pos2 = getClientPos(e);
        const srcFrame = data.pages.find(p => p.page_id === d.frameId);
        const origEl = srcFrame?.elements.find(e => e.id === d.elementId);
        if (srcFrame && origEl && pos2) {
          const totalDx = (pos2.clientX - d.startX) / scale, totalDy = (pos2.clientY - d.startY) / scale;
          const finalX = Math.round(d.origX + totalDx), finalY = Math.round(d.origY + totalDy);
          const sfx = srcFrame.frame_x ?? 0, sfy = srcFrame.frame_y ?? 0;
          const absX = sfx + finalX, absY = sfy + finalY;
          const absCx = absX + origEl.w / 2, absCy = absY + origEl.h / 2;
          const moveIds = selectedIds.size > 1 && selectedIds.has(d.elementId) ? selectedIds : new Set([d.elementId]);
          const moveEls = srcFrame.elements.filter(e => moveIds.has(e.id));
          let landed = false;
          for (const tgtFrame of data.pages) {
            if (tgtFrame.page_id === d.frameId) continue;
            const tfx = tgtFrame.frame_x ?? 0, tfy = tgtFrame.frame_y ?? 0;
            if (absCx >= tfx && absCx <= tfx + tgtFrame.width && absCy >= tfy && absCy <= tfy + tgtFrame.height) {
              const movedEls = moveEls.map(el => ({
                ...el,
                x: Math.round(sfx + el.x - tfx),
                y: Math.round(sfy + el.y - tfy),
              }));
              updateData(prev => ({
                ...prev,
                pages: prev.pages.map(p => {
                  if (p.page_id === d.frameId) return { ...p, elements: p.elements.filter(e => !moveIds.has(e.id)) };
                  if (p.page_id === tgtFrame.page_id) return { ...p, elements: [...p.elements, ...movedEls] };
                  return p;
                }),
              }));
              setActiveFrameId(tgtFrame.page_id);
              landed = true;
              break;
            }
          }
          if (!landed) {
            const stillInSrc = absCx >= sfx && absCx <= sfx + srcFrame.width && absCy >= sfy && absCy <= sfy + srcFrame.height;
            if (!stillInSrc) {
              const canvasEls = moveEls.map(el => ({
                ...el,
                x: sfx + el.x,
                y: sfy + el.y,
              }));
              updateData(prev => ({
                ...prev,
                pages: prev.pages.map(p => p.page_id === d.frameId ? { ...p, elements: p.elements.filter(e => !moveIds.has(e.id)) } : p),
                elements: [...(prev.elements ?? []), ...canvasEls],
              }));
              setActiveFrameId(null);
            }
          }
        }
      }
      if (d?.type === 'move' && d.elementId && !d.frameId && !d.groupId && data) {
        const pos2 = getClientPos(e);
        const origEl = data.elements?.find(e => e.id === d.elementId);
        if (origEl && pos2) {
          const totalDx = (pos2.clientX - d.startX) / scale, totalDy = (pos2.clientY - d.startY) / scale;
          const finalX = Math.round(d.origX + totalDx), finalY = Math.round(d.origY + totalDy);
          const absCx = finalX + origEl.w / 2, absCy = finalY + origEl.h / 2;
          const moveIds = selectedIds.size > 1 && selectedIds.has(d.elementId) ? selectedIds : new Set([d.elementId]);
          const moveEls = (data.elements ?? []).filter(e => moveIds.has(e.id));
          for (const tgtFrame of data.pages) {
            const tfx = tgtFrame.frame_x ?? 0, tfy = tgtFrame.frame_y ?? 0;
            if (absCx >= tfx && absCx <= tfx + tgtFrame.width && absCy >= tfy && absCy <= tfy + tgtFrame.height) {
              const movedEls = moveEls.map(el => ({
                ...el,
                x: Math.round(el.x - tfx),
                y: Math.round(el.y - tfy),
              }));
              updateData(prev => ({
                ...prev,
                elements: (prev.elements ?? []).filter(e => !moveIds.has(e.id)),
                pages: prev.pages.map(p => p.page_id === tgtFrame.page_id ? { ...p, elements: [...p.elements, ...movedEls] } : p),
              }));
              setActiveFrameId(tgtFrame.page_id);
              break;
            }
          }
        }
      }
      if (d?.type === 'marquee' && data) {
        const mr = marqueeRect;
        if (mr && (mr.w > 5 || mr.h > 5)) {
          // Visual AABB of an element in screen coords, accounting for rotation
          // around the element's transform-origin (which may differ from its
          // geometric center if vector-edit reassemble offset it).
          const visualAabb = (el: CanvasElement, baseX: number, baseY: number) => {
            const originFx = el.rotationOriginX ?? 0.5;
            const originFy = el.rotationOriginY ?? 0.5;
            const cx = baseX + (el.x + originFx * el.w) * scale;
            const cy = baseY + (el.y + originFy * el.h) * scale;
            const elScreenX = baseX + el.x * scale;
            const elScreenY = baseY + el.y * scale;
            const elScreenW = el.w * scale;
            const elScreenH = el.h * scale;
            const corners = [
              [elScreenX, elScreenY],
              [elScreenX + elScreenW, elScreenY],
              [elScreenX + elScreenW, elScreenY + elScreenH],
              [elScreenX, elScreenY + elScreenH],
            ];
            const rot = (el.rotation || 0) * Math.PI / 180;
            const cosR = Math.cos(rot), sinR = Math.sin(rot);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const [px, py] of corners) {
              const dx = px - cx, dy = py - cy;
              const wx = cx + dx * cosR - dy * sinR;
              const wy = cy + dx * sinR + dy * cosR;
              if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
              if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
            }
            return { minX, minY, maxX, maxY };
          };
          const canvasHits = new Set<string>();
          const frameHits = new Map<string, Set<string>>();
          for (const el of (data.elements ?? []).filter(el => el.visible !== false)) {
            const aabb = visualAabb(el, pan.x, pan.y);
            if (aabb.maxX > mr.x && aabb.minX < mr.x + mr.w &&
                aabb.maxY > mr.y && aabb.minY < mr.y + mr.h) {
              canvasHits.add(el.id);
            }
          }
          for (const frame of data.pages) {
            const fx = frame.frame_x ?? 0, fy = frame.frame_y ?? 0;
            for (const el of frame.elements.filter(el => el.visible !== false)) {
              const aabb = visualAabb(el, pan.x + fx * scale, pan.y + fy * scale);
              if (aabb.maxX > mr.x && aabb.minX < mr.x + mr.w &&
                  aabb.maxY > mr.y && aabb.minY < mr.y + mr.h) {
                if (!frameHits.has(frame.page_id)) frameHits.set(frame.page_id, new Set());
                frameHits.get(frame.page_id)!.add(el.id);
              }
            }
          }
          let bestFrameId: string | null = null;
          let bestFrameCount = 0;
          for (const [fid, ids] of frameHits) {
            if (ids.size > bestFrameCount) { bestFrameId = fid; bestFrameCount = ids.size; }
          }
          if (bestFrameCount > 0 && bestFrameCount >= canvasHits.size) {
            setActiveFrameId(bestFrameId);
            setSelectedIds(frameHits.get(bestFrameId!)!);
          } else if (canvasHits.size > 0) {
            setActiveFrameId(null);
            setSelectedIds(canvasHits);
          }
        }
        setMarqueeRect(null);
      }
      if ((d?.type === 'move' || d?.type === 'resize') && d.groupId && activeGroupPath.length > 0) {
        elementContext.setElements(els => recalcGroupBounds(els, activeGroupPath));
      }
      if (d?.type === 'create' && d.createType && data) {
        setCreatePreview(null);
        const pos2 = getClientPos(e);
        const endCx = pos2 ? screenToCanvas(pos2.clientX, pos2.clientY).cx : d.origX;
        const endCy = pos2 ? screenToCanvas(pos2.clientX, pos2.clientY).cy : d.origY;
        const dx = endCx - d.origX;
        const dy = endCy - d.origY;
        const dragged = Math.abs(dx) > 5 || Math.abs(dy) > 5;

        let elW: number, elH: number, elX: number, elY: number;
        if (dragged) {
          elX = Math.min(d.origX, endCx);
          elY = Math.min(d.origY, endCy);
          elW = Math.abs(dx);
          elH = Math.abs(dy);
        } else if (d.createType.type === 'text') {
          // For text on simple click, place the element at the click point
          // so the cursor sits where the user clicked.
          elW = 100;
          elH = 32;
          elX = d.origX;
          elY = d.origY;
        } else if (d.createType.type === 'frame') {
          // Click without drag: inherit last frame's size, or fall back to 800x600.
          // Click point becomes the top-left of the new frame (per moonyaan 2026-04-28).
          const lastFrame = data.pages[data.pages.length - 1];
          elW = lastFrame ? lastFrame.width : 800;
          elH = lastFrame ? lastFrame.height : 600;
          elX = d.origX;
          elY = d.origY;
        } else {
          elW = 200;
          elH = 200;
          elX = d.origX - elW / 2;
          elY = d.origY - elH / 2;
        }

        if (d.createType.type === 'frame') {
          const newPage = createEmptyPage(data.pages.length + 1);
          newPage.frame_x = Math.round(elX);
          newPage.frame_y = Math.round(elY);
          newPage.width = Math.round(elW);
          newPage.height = Math.round(elH);
          updateData(prev => ({ ...prev, pages: [...prev.pages, newPage] }));
          setActiveFrameId(newPage.page_id);
          setSelectedIds(new Set());
          setPendingInsert(null);
        } else {
          const frameId = d.frameId;
          const frame = frameId ? data.pages.find(p => p.page_id === frameId) : null;
          let el: CanvasElement;
          if (d.createType.type === 'text') {
            if (frame) {
              const fx = frame.frame_x ?? 0, fy = frame.frame_y ?? 0;
              const localX = Math.round(elX - fx);
              const localY = Math.round(elY - fy);
              el = dragged ? createTextElement(localX, localY, Math.round(elW)) : createTextElement(localX, localY);
              setActiveFrameId(frameId!);
              updateFrame(frameId!, page => ({ ...page, elements: [...page.elements, el] }));
            } else {
              el = dragged ? createTextElement(Math.round(elX), Math.round(elY), Math.round(elW)) : createTextElement(Math.round(elX), Math.round(elY));
              updateData(prev => ({ ...prev, elements: [...(prev.elements ?? []), el] }));
              setActiveFrameId(null);
            }
            setSelectedIds(new Set([el.id]));
            setEditingElementId(el.id);
            setPendingInsert(null);
          } else if (d.createType.type === 'shape') {
            const shapeType = d.createType.shapeType;
            if (dragged) {
              const shapeDef = SHAPE_MAP.get(shapeType);
              if (shapeDef) {
                const rw = Math.round(elW), rh = Math.round(elH);
                const defaultRadius = shapeType === 'rounded-rect' ? 8 : 0;
                let pd: string;
                let epa = '';
                if (defaultRadius > 0) {
                  const rectPath = `M0 0h${rw}v${rh}H0z`;
                  const pp = parsePath(rectPath);
                  const ss = pp.subPaths && pp.subPaths.length > 0 ? pp.subPaths : [{ points: pp.points, closed: pp.closed }];
                  const rr = ss.flatMap(sp => sp.points.map(() => defaultRadius));
                  const es = ss.map(sp => {
                    const pts = sp.points.map(pt => ({ ...pt, cornerRadius: defaultRadius }));
                    return { points: expandCornerRadii({ points: pts, closed: sp.closed }), closed: sp.closed };
                  });
                  pd = es.map(sp => serializeSubPath(sp)).join('');
                  epa = ` data-corner-radii="${rr.join(',')}" data-orig-d="${rectPath}"`;
                } else if (shapeType === 'polygon') {
                  pd = regularPolygonPath(rw, rh, 5);
                  epa = ` data-shape="polygon" data-sides="5"`;
                } else if (shapeType === 'star') {
                  pd = regularStarPath(rw, rh, 5);
                  epa = ` data-shape="star" data-points="5"`;
                } else {
                  pd = shapeDef.renderPath(rw, rh);
                }
                el = {
                  id: `el-${crypto.randomUUID().slice(0, 8)}`, locked: false, z_index: 1,
                  x: 0, y: 0, w: rw, h: rh,
                  html: `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${rw + 2} ${rh + 2}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${pd}" fill="#D9D9D9" stroke="none" vector-effect="non-scaling-stroke"${epa}/></svg></div>`,
                };
              } else {
                el = createShapeElement(shapeType, Math.round(elW), Math.round(elH));
              }
            } else {
              el = createShapeElement(shapeType, frame ? frame.width : 1920, frame ? frame.height : 1080);
            }
            if (frame) {
              const fx = frame.frame_x ?? 0, fy = frame.frame_y ?? 0;
              el.x = dragged ? Math.round(elX - fx) : Math.round(elX - fx - el.w / 2);
              el.y = dragged ? Math.round(elY - fy) : Math.round(elY - fy - el.h / 2);
              setActiveFrameId(frameId!);
              updateFrame(frameId!, page => ({ ...page, elements: [...page.elements, el] }));
            } else {
              el.x = dragged ? Math.round(elX) : Math.round(elX - el.w / 2);
              el.y = dragged ? Math.round(elY) : Math.round(elY - el.h / 2);
              updateData(prev => ({ ...prev, elements: [...(prev.elements ?? []), el] }));
              setActiveFrameId(null);
            }
            setSelectedIds(new Set([el.id]));
            setPendingInsert(null);
          }
        }
      }
      if (d && (d.type === 'move' || d.type === 'resize' || d.type === 'frame-move' || d.type === 'frame-resize' || d.type === 'rotate') && data) {
        undoRedo.endBatch(data);
      }
      dragRef.current = null; setSnapLines([]);
    };
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false }); window.addEventListener('touchend', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); window.removeEventListener('touchmove', handleMove); window.removeEventListener('touchend', handleUp); };
  }, [scale, updateElement, updateFrame, updateData, selectedIds, data, pan, marqueeRect, undoRedo, screenToCanvas, setPendingInsert, activeGroupPath, activeFrameId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Let overlays inside the canvas (property panel, etc.) handle their
      // own wheel scrolling. They mark themselves with data-overlay-scrollable
      // so we don't preventDefault/swallow the wheel event for them.
      const target = e.target as Element | null;
      if (target?.closest?.('[data-overlay-scrollable]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        setScale(prev => {
          const next = Math.min(5, Math.max(0.1, prev * factor));
          const ratio = next / prev;
          setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
          return next;
        });
      } else {
        setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [data]);

  const handleCanvasPointerDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault(); setIsPanning(true);
      dragRef.current = { type: 'pan', startX: e.clientX, startY: e.clientY, origX: 0, origY: 0, origW: 0, origH: 0, origPanX: pan.x, origPanY: pan.y };
      return;
    }
    if (pendingInsert && e.button === 0) {
      if (pendingInsert.type === 'pen' || pendingInsert.type === 'line-draw') return;
      if ((e.target as HTMLElement).closest('[data-frame-id]')) return;
      const { cx, cy } = screenToCanvas(e.clientX, e.clientY);
      if (!data) return;
      const frame = pendingInsert.type !== 'frame' ? findFrameAtPoint(cx, cy) : null;
      dragRef.current = {
        type: 'create',
        startX: e.clientX, startY: e.clientY,
        origX: cx, origY: cy,
        origW: 0, origH: 0,
        frameId: frame?.page_id,
        createType: pendingInsert,
      };
      return;
    }
    const { cx: clickCx, cy: clickCy } = screenToCanvas(e.clientX, e.clientY);
    if (findFrameAtPoint(clickCx, clickCy)) {
      if (activeGroupId) { setActiveGroupPath([]); setSelectedIds(new Set()); return; }
      return;
    }
    setSelectedIds(new Set()); setEditingElementId(null); setActiveFrameId(null); setActiveGroupPath([]);
    if (e.button === 0 && !pendingInsert) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        dragRef.current = {
          type: 'marquee', startX: e.clientX, startY: e.clientY,
          origX: e.clientX - rect.left, origY: e.clientY - rect.top, origW: 0, origH: 0,
        };
      }
    }
  }, [pan, pendingInsert, screenToCanvas, findFrameAtPoint, data, updateData, updateFrame, activeGroupId]);

  const handleFrameClick = useCallback((frameId: string, e: React.MouseEvent) => {
    if (pendingInsert && pendingInsert.type !== 'frame' && pendingInsert.type !== 'pen' && pendingInsert.type !== 'line-draw') {
      const frame = data?.pages.find(p => p.page_id === frameId);
      if (!frame) return;
      const { cx, cy } = screenToCanvas(e.clientX, e.clientY);
      dragRef.current = {
        type: 'create',
        startX: e.clientX, startY: e.clientY,
        origX: cx, origY: cy,
        origW: 0, origH: 0,
        frameId,
        createType: pendingInsert,
      };
      return;
    }
    setActiveFrameId(frameId);
    setFrameExplicitlySelected(false);
    if ((e.target as HTMLElement).closest('[data-element-id]')) return;
    // Click on frame background exits group mode entirely
    if (activeGroupId) { setActiveGroupPath([]); setSelectedIds(new Set()); return; }
    setSelectedIds(new Set()); setEditingElementId(null);
    if (e.button === 0) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        dragRef.current = {
          type: 'marquee', startX: e.clientX, startY: e.clientY,
          origX: e.clientX - rect.left, origY: e.clientY - rect.top, origW: 0, origH: 0,
        };
      }
    }
  }, [pendingInsert, data, screenToCanvas, updateFrame, activeGroupId]);

  const handleFrameNameMouseDown = useCallback((frameId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveFrameId(frameId);
    setFrameExplicitlySelected(true);
    setSelectedIds(new Set());
    setEditingElementId(null);
    const frame = data?.pages.find(p => p.page_id === frameId);
    if (!frame) return;
    undoRedo.beginBatch();
    dragRef.current = {
      type: 'frame-move', frameId,
      startX: e.clientX, startY: e.clientY,
      origX: frame.frame_x ?? 0, origY: frame.frame_y ?? 0,
      origW: 0, origH: 0,
    };
  }, [data, undoRedo]);

  const handleFrameResizeStart = useCallback((frameId: string, handle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const frame = data?.pages.find(p => p.page_id === frameId);
    if (!frame) return;
    undoRedo.beginBatch();
    dragRef.current = {
      type: 'frame-resize',
      frameId,
      handle,
      startX: e.clientX, startY: e.clientY,
      origX: frame.frame_x ?? 0, origY: frame.frame_y ?? 0,
      origW: frame.width, origH: frame.height,
    };
  }, [data, undoRedo]);

  const handleSelectElement = useCallback((frameId: string | null, id: string, e: React.MouseEvent | React.TouchEvent) => {
    if (subTextEditingRef.current) return;
    setActiveFrameId(frameId);
    setFrameExplicitlySelected(false);
    setEditingElementId(null);
    setVectorEditId(null);
    if ('shiftKey' in e && e.shiftKey) {
      setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    } else {
      setSelectedIds(prev => prev.has(id) && prev.size > 1 ? prev : new Set([id]));
    }
  }, []);

  const handleDoubleClick = useCallback((frameId: string | null, id: string) => {
    const el = findElementById(id);
    if (!el) return;
    // Group: push into group path (supports nested groups)
    if (el.type === 'group') {
      setActiveGroupPath(prev => [...prev, id]);
      setSelectedIds(new Set());
      return;
    }
    const hasSvg = el.html.includes('<svg');
    if (hasSvg) {
      // Vector edit operates on the path geometry as-is. The element's own
      // rotation continues to apply via the outer container, so anchors
      // appear at their rotated visual positions (WYSIWYG).
      const converted = convertShapesToPaths(el.html);
      if (extractAllPathDs(converted).length > 0) {
        if (converted !== el.html) {
          updateElement(id, { html: converted });
        }
        setVectorEditId(id);
        return;
      }
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = el.html;
    const root = tmp.firstElementChild;
    const hasChildren = root && root.children.length > 0;
    if (hasChildren && !el.html.includes('contenteditable')) {
      setSubElementEditId(id);
      return;
    }
    setEditingElementId(id);
  }, [data, updateElement]);

  const handleDragStart = useCallback((frameId: string | null, id: string, e: React.MouseEvent | React.TouchEvent, groupId?: string, elOverride?: CanvasElement) => {
    if (editingElementId === id || subTextEditingRef.current) return;
    const el = elOverride ?? elementContext.elements.find(el => el.id === id);
    if (!el || el.locked) return;
    const pos = getClientPos(e); if (!pos) return;

    const origPositions = new Map<string, { x: number; y: number }>();
    if (selectedIds.size > 1 && selectedIds.has(id)) {
      const sourceList = groupId
        ? (resolveGroupByPath()?.group.children ?? [])
        : elementContext.elements;
      for (const oel of sourceList) {
        if (selectedIds.has(oel.id)) origPositions.set(oel.id, { x: oel.x, y: oel.y });
      }
    }
    undoRedo.beginBatch();

    // Alt/Option held at mousedown → Figma-style duplicate-on-drag.
    // Defer the actual clone until the first mousemove with any non-zero
    // movement, so an Alt+click without drag leaves the canvas unchanged.
    // The cross-frame reparent logic in the drop handler (1283-1361) handles
    // dropping clones into a different frame automatically.
    const isAlt = 'altKey' in e && (e as React.MouseEvent).altKey;
    const selectionIds = selectedIds.has(id) ? Array.from(selectedIds) : [id];

    dragRef.current = {
      type: 'move',
      elementId: id,
      frameId: frameId ?? undefined,
      groupId,
      startX: pos.clientX, startY: pos.clientY,
      origX: el.x, origY: el.y, origW: el.w, origH: el.h,
      origPositions,
      altPendingClone: isAlt
        ? { selectionIds, primaryId: id, frameId: frameId ?? null, groupId: groupId ?? null }
        : undefined,
    };
  }, [elementContext, editingElementId, selectedIds, undoRedo, resolveGroupByPath]);

  const handleResizeStart = useCallback((frameId: string | null, id: string, handle: string, e: React.MouseEvent | React.TouchEvent) => {
    const el = findElementById(id);
    if (!el) return;
    const pos = getClientPos(e); if (!pos) return;
    const deepCloneChildren = (children: CanvasElement[]): CanvasElement[] =>
      children.map(c => ({ ...c, children: c.children ? deepCloneChildren(c.children) : undefined }));
    undoRedo.beginBatch();
    dragRef.current = { type: 'resize', elementId: id, frameId: frameId ?? undefined, handle, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h, origRotation: el.rotation, origAspectLocked: el.aspect_locked === true, origHtml: el.html?.includes('<svg') ? el.html : undefined, origChildren: el.type === 'group' && el.children ? deepCloneChildren(el.children) : undefined };
  }, [data, undoRedo]);

  const handleRotateStart = useCallback((frameId: string | null, id: string, e: React.MouseEvent | React.TouchEvent) => {
    const el = findElementById(id);
    if (!el) return;
    const pos = getClientPos(e); if (!pos) return;
    undoRedo.beginBatch();
    dragRef.current = {
      type: 'rotate', elementId: id, frameId: frameId ?? undefined,
      startX: pos.clientX, startY: pos.clientY,
      origX: el.x, origY: el.y, origW: el.w, origH: el.h,
      origRotation: el.rotation || 0,
    };
  }, [findElementById, undoRedo]);

  // ─── Clipboard ─────────────────────
  const CLIPBOARD_KEY = 'aose-canvas-clipboard';
  const pasteCountRef = useRef(0);

  const handleCopy = useCallback(() => {
    if (selectedIds.size === 0) return;
    const copied = elementContext.elements.filter(el => selectedIds.has(el.id));
    if (copied.length === 0) return;
    const payload = JSON.stringify({ type: CLIPBOARD_KEY, elements: copied });
    navigator.clipboard.writeText(payload).catch(() => {});
    pasteCountRef.current = 0;
  }, [selectedIds, elementContext.elements]);

  // AOSE JSON paste (own clipboard format, copy/paste between canvas elements).
  // Returns true if the text was a valid AOSE JSON payload and was handled.
  const tryPasteAoseJson = useCallback((text: string): boolean => {
    let parsed: { type: string; elements: CanvasElement[] };
    try { parsed = JSON.parse(text); } catch { return false; }
    if ((parsed.type !== CLIPBOARD_KEY && parsed.type !== 'aose-video-clipboard') || !Array.isArray(parsed.elements) || parsed.elements.length === 0) return false;
    pasteCountRef.current += 1;
    const offset = pasteCountRef.current * 20;
    const newEls = parsed.elements.map(el => ({
      ...el,
      id: `el-${crypto.randomUUID().slice(0, 8)}`,
      x: el.x + offset,
      y: el.y + offset,
    }));
    elementContext.setElements(els => [...els, ...newEls]);
    setSelectedIds(new Set(newEls.map(el => el.id)));
    return true;
  }, [elementContext]);

  // Fallback for Cmd+V via keyboard shortcut on browsers/contexts where the
  // native paste event doesn't fire (rare; mostly when the canvas region
  // hasn't been focused). Tries AOSE JSON only — system SVG/image require
  // clipboardData from the paste event.
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      tryPasteAoseJson(text);
    } catch {}
  }, [tryPasteAoseJson]);

  const deleteSelected = useCallback(() => {
    if (activeGroupPath.length > 0) {
      const deleteFromNestedGroup = (elements: CanvasElement[], path: string[], idsToDelete: Set<string>): CanvasElement[] => {
        if (path.length === 0) {
          return elements.filter(el => !idsToDelete.has(el.id));
        }
        const [currentGroupId, ...restPath] = path;
        return elements.map(el => {
          if (el.id !== currentGroupId || !el.children) return el;
          const updatedChildren = restPath.length > 0
            ? deleteFromNestedGroup(el.children, restPath, idsToDelete)
            : el.children.filter(c => !idsToDelete.has(c.id));
          if (updatedChildren.length === 0) return null;
          if (updatedChildren.length === 1) {
            return { ...updatedChildren[0], x: el.x + updatedChildren[0].x, y: el.y + updatedChildren[0].y };
          }
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const c of updatedChildren) {
            minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h);
          }
          return {
            ...el,
            children: updatedChildren.map(c => ({ ...c, x: c.x - minX, y: c.y - minY })),
            x: el.x + minX, y: el.y + minY,
            w: maxX - minX, h: maxY - minY,
          };
        }).filter(Boolean) as CanvasElement[];
      };
      elementContext.setElements(els => deleteFromNestedGroup(els, activeGroupPath, selectedIds));
      setSelectedIds(new Set()); setEditingElementId(null);
      const resolved = resolveGroupByPath();
      if (!resolved || !resolved.group.children || resolved.group.children.filter(c => !selectedIds.has(c.id)).length === 0) {
        setActiveGroupPath(prev => prev.slice(0, -1));
      }
    } else {
      elementContext.setElements(els => els.filter(el => !selectedIds.has(el.id)));
      setSelectedIds(new Set()); setEditingElementId(null);
    }
  }, [elementContext, activeGroupPath, selectedIds, resolveGroupByPath]);

  const handleCut = useCallback(() => {
    handleCopy();
    deleteSelected();
  }, [handleCopy, deleteSelected]);

  // ─── Group / Ungroup ────────────────
  const groupSelected = useCallback(() => {
    if (selectedIds.size < 2) return;
    const selectedEls = elementContext.elements.filter(el => selectedIds.has(el.id));
    if (selectedEls.length < 2) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of selectedEls) {
      minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.w); maxY = Math.max(maxY, el.y + el.h);
    }
    const children: CanvasElement[] = selectedEls.map(el => ({ ...el, x: el.x - minX, y: el.y - minY }));
    const group = {
      id: crypto.randomUUID(), type: 'group' as const, html: '',
      x: minX, y: minY, w: maxX - minX, h: maxY - minY,
      z_index: Math.max(...selectedEls.map(el => el.z_index ?? 0)),
      children,
    };
    elementContext.setElements(els => [...els.filter(el => !selectedIds.has(el.id)), group]);
    setSelectedIds(new Set([group.id]));
  }, [selectedIds, elementContext]);

  const ungroupSelected = useCallback(() => {
    if (selectedIds.size !== 1) return;
    const id = Array.from(selectedIds)[0];
    const group = elementContext.elements.find(el => el.id === id);
    if (!group || group.type !== 'group' || !group.children) return;
    const children = group.children.map(child => ({ ...child, x: child.x + group.x, y: child.y + group.y }));
    elementContext.setElements(els => [...els.filter(el => el.id !== id), ...children]);
    setSelectedIds(new Set(children.map(c => c.id)));
  }, [selectedIds, elementContext]);

  // ─── Keyboard ─────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingElementId) return;
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,[contenteditable]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0 && !vectorEditId && !subElementEditId) { e.preventDefault(); deleteSelected(); }
      if (e.key === 'g' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); groupSelected(); }
      if (e.key === 'g' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); ungroupSelected(); }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedIds(new Set(elementContext.elements.filter(el => el.visible !== false).map(el => el.id)));
      }
      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleCopy(); }
      // Cmd+V is handled via the document-level 'paste' event listener so we
      // can read clipboardData.items (SVG / image / text) — readText alone
      // can't see images. Don't preventDefault here, or the paste event won't fire.
      if (e.key === 'x' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleCut(); }
      if (e.key === 'd' && (e.ctrlKey || e.metaKey) && !e.shiftKey && selectedIds.size > 0) {
        e.preventDefault();
        const newIds: string[] = [];
        elementContext.setElements(els => {
          const toAdd: typeof els = [];
          for (const id of selectedIds) {
            const el = els.find(e => e.id === id);
            if (el) { const nid = `el-${crypto.randomUUID().slice(0, 8)}`; newIds.push(nid); toAdd.push({ ...el, id: nid, x: el.x + 20, y: el.y + 20 }); }
          }
          return [...els, ...toAdd];
        });
        if (newIds.length > 0) setSelectedIds(new Set(newIds));
      }
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert(null); return; }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'shape', shapeType: 'rect' }); return; }
      if (e.key === 'o' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'shape', shapeType: 'circle' }); return; }
      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'text' }); return; }
      if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'frame' }); return; }
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'line-draw' }); return; }
      if (e.key === 'Escape') { if (pendingInsert) { setPendingInsert(null); setCreatePreview(null); return; } if (activeGroupId) { setActiveGroupPath(prev => prev.slice(0, -1)); setSelectedIds(new Set()); return; } setSelectedIds(new Set()); setEditingElementId(null); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, activeFrame, editingElementId, vectorEditId, subElementEditId, handleUndo, handleRedo, pendingInsert, handleCopy, handlePaste, handleCut, groupSelected, ungroupSelected, elementContext]);


  // ─── Sub-element editing ────────────
  const handleSubElementDragMove = useCallback((cssPath: string, totalDx: number, totalDy: number) => {
    if (!subElementEditId) return;
    let el: CanvasElement | undefined;
    for (const page of (data?.pages ?? [])) {
      el = page.elements.find(e => e.id === subElementEditId);
      if (el) break;
    }
    if (!el) el = data?.elements?.find(e => e.id === subElementEditId);
    if (!el) return;
    const div = document.createElement('div');
    div.innerHTML = el.html;
    const root = div.firstElementChild as HTMLElement;
    if (!root) return;
    const target = root.querySelector(cssPath) as HTMLElement;
    if (!target) return;
    const pos = target.style.position;
    if (pos !== 'absolute' && pos !== 'relative' && pos !== 'fixed') return;
    if (!subDragOriginRef.current) {
      subDragOriginRef.current = {
        left: parseFloat(target.style.left) || 0,
        top: parseFloat(target.style.top) || 0,
      };
    }
    target.style.left = (subDragOriginRef.current.left + totalDx) + 'px';
    target.style.top = (subDragOriginRef.current.top + totalDy) + 'px';
    if (target.parentElement) target.parentElement.style.overflow = 'visible';
    updateElement(subElementEditId, { html: div.innerHTML });
  }, [subElementEditId, data, updateElement]);

  const handleSubElementDragEnd = useCallback(() => {
    subDragOriginRef.current = null;
  }, []);

  const handleSubElementResize = useCallback((cssPath: string, changes: { left?: number; top?: number; width?: number; height?: number }) => {
    if (!subElementEditId) return;
    let el: CanvasElement | undefined;
    for (const page of (data?.pages ?? [])) {
      el = page.elements.find(e => e.id === subElementEditId);
      if (el) break;
    }
    if (!el) el = data?.elements?.find(e => e.id === subElementEditId);
    if (!el) return;
    const div = document.createElement('div');
    div.innerHTML = el.html;
    const root = div.firstElementChild as HTMLElement;
    if (!root) return;
    const target = root.querySelector(cssPath) as HTMLElement;
    if (!target) return;
    if (changes.left !== undefined) target.style.left = changes.left + 'px';
    if (changes.top !== undefined) target.style.top = changes.top + 'px';
    if (changes.width !== undefined) target.style.width = changes.width + 'px';
    if (changes.height !== undefined) target.style.height = changes.height + 'px';
    updateElement(subElementEditId, { html: div.innerHTML });
  }, [subElementEditId, data, updateElement]);

  const handleSubElementTextEdit = useCallback((cssPath: string, rect: DOMRect) => {
    setSubTextEditCssPath(cssPath);
    setSubTextEditRect(rect);
  }, []);

  const handleSubTextEditSave = useCallback((newText: string) => {
    if (!subElementEditId || !subTextEditCssPath) return;
    const el = findElementById(subElementEditId);
    if (!el) return;
    const div = document.createElement('div');
    div.innerHTML = el.html;
    const root = div.firstElementChild as HTMLElement;
    if (!root) return;
    const target = root.querySelector(subTextEditCssPath) as HTMLElement;
    if (!target) return;
    target.textContent = newText;
    updateElement(subElementEditId, { html: div.innerHTML });
    setSubTextEditCssPath(null);
    setSubTextEditRect(null);
  }, [subElementEditId, subTextEditCssPath, findElementById, updateElement]);

  useEffect(() => {
    if (subElementEditId && !selectedIds.has(subElementEditId)) {
      setSubElementEditId(null);
      setSubElementPath(null);
      setSubElementSelection(null);
      setSubTextEditCssPath(null);
      setSubTextEditRect(null);
    }
  }, [selectedIds, subElementEditId]);

  useEffect(() => {
    if (!subElementEditId) return;
    const sr = shadowRootRefs.current.get(subElementEditId);
    if (!sr) return;
    const host = sr.host as HTMLElement;
    if (host) {
      host.style.pointerEvents = subTextEditing ? 'auto' : 'none';
      host.style.cursor = subTextEditing ? 'text' : '';
      const wrapper = host.parentElement;
      if (wrapper) wrapper.style.cursor = subTextEditing ? 'text' : '';
    }
  }, [subTextEditing, subElementEditId]);

  // ─── Actions ────────────────────────
  const deleteFrame = (pageId: string) => {
    if (!data || data.pages.length <= 1) return;
    updateData(d => ({ ...d, pages: d.pages.filter(p => p.page_id !== pageId) }));
    if (activeFrameId === pageId) {
      setActiveFrameId(data.pages.find(p => p.page_id !== pageId)?.page_id ?? null);
    }
    setSelectedIds(new Set());
  };

  const getTargetFrame = (): { frame: CanvasPage; frameId: string } | null => {
    if (activeFrame && activeFrameId) return { frame: activeFrame, frameId: activeFrameId };
    if (data && data.pages.length > 0) {
      setActiveFrameId(data.pages[0].page_id);
      return { frame: data.pages[0], frameId: data.pages[0].page_id };
    }
    return null;
  };

  const addShapeFromPicker = (shapeType: ShapeType) => {
    setPendingInsert({ type: 'shape', shapeType });
  };

  const duplicateElement = (id: string) => {
    const el = elementContext.elements.find(e => e.id === id);
    if (!el) return;
    const newEl = { ...el, id: `el-${crypto.randomUUID().slice(0, 8)}`, x: el.x + 20, y: el.y + 20 };
    elementContext.setElements(els => [...els, newEl]);
    setSelectedIds(new Set([newEl.id]));
  };

  const deepCloneFrameChildren = (children: CanvasElement[]): CanvasElement[] =>
    children.map(c => ({
      ...c,
      id: `el-${crypto.randomUUID().slice(0, 8)}`,
      children: c.children ? deepCloneFrameChildren(c.children) : undefined,
    }));

  const duplicateFrame = (pageId: string) => {
    const frame = data?.pages.find(p => p.page_id === pageId);
    if (!frame) return;
    const newFrame: CanvasPage = {
      ...frame,
      page_id: crypto.randomUUID(),
      title: (frame.title || 'Frame') + ' Copy',
      frame_x: (frame.frame_x ?? 0) + frame.width + 40,
      elements: frame.elements.map(el => ({
        ...el,
        id: `el-${crypto.randomUUID().slice(0, 8)}`,
        children: el.children ? deepCloneFrameChildren(el.children) : undefined,
      })),
    };
    updateData(d => ({ ...d, pages: [...d.pages, newFrame] }));
  };

  const imageInputRef = useRef<HTMLInputElement>(null);

  const insertImageFromFile = useCallback(async (file: File, name?: string) => {
    const target = getTargetFrame();
    if (!target) return;
    let probed: { w: number; h: number; objectUrl: string };
    try {
      probed = await probeImageSize(file);
    } catch (err) {
      showError('Failed to read image', err);
      return;
    }
    // Fit longest side to 800px, preserve aspect ratio
    const MAX_SIZE = 800;
    const ratio = probed.w / probed.h;
    let w = probed.w, h = probed.h;
    if (w > MAX_SIZE || h > MAX_SIZE) {
      if (ratio >= 1) { w = MAX_SIZE; h = Math.round(MAX_SIZE / ratio); }
      else { h = MAX_SIZE; w = Math.round(MAX_SIZE * ratio); }
    }
    // Upload to server FIRST, then insert with server URL. Previously we
    // inserted with the blob URL and swapped after upload — but the autosave
    // debounce could fire between insert and swap, persisting the blob URL.
    // After sync round-trip the blob URL is meaningless on the other side,
    // and useless on the originating side after a refresh.
    let serverUrl: string;
    try {
      serverUrl = await uploadImageFile(file);
    } catch (err) {
      showError('Failed to upload image', err);
      URL.revokeObjectURL(probed.objectUrl);
      return;
    }
    URL.revokeObjectURL(probed.objectUrl);

    const elId = `el-${crypto.randomUUID().slice(0, 8)}`;
    const newEl: CanvasElement = {
      id: elId,
      x: Math.round(target.frame.width / 2 - w / 2),
      y: Math.round(target.frame.height / 2 - h / 2),
      w, h,
      html: createImageHtml(serverUrl, w, h),
      locked: false, z_index: target.frame.elements.length + 1,
      name: name ?? 'Image',
    };
    updateFrame(target.frameId, page => ({ ...page, elements: [...page.elements, newEl] }));
    setSelectedIds(new Set([elId]));
  }, [getTargetFrame, updateFrame, updateElement]);

  const handleAddImage = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const svgInputRef = useRef<HTMLInputElement>(null);

  const handleAddSvg = useCallback(() => {
    svgInputRef.current?.click();
  }, []);

  const insertSvgElement = useCallback((parsed: { html: string; w: number; h: number }, name?: string) => {
    const target = getTargetFrame();
    if (!target) return;
    const newEl: CanvasElement = {
      id: `el-${crypto.randomUUID().slice(0, 8)}`,
      x: target.frame.width / 2 - parsed.w / 2, y: target.frame.height / 2 - parsed.h / 2,
      w: parsed.w, h: parsed.h,
      html: parsed.html,
      locked: false, z_index: target.frame.elements.length + 1,
      name: name ?? 'SVG',
    };
    updateFrame(target.frameId, page => ({ ...page, elements: [...page.elements, newEl] }));
    setSelectedIds(new Set([newEl.id]));
  }, [getTargetFrame, updateFrame]);

  // System paste: SVG strings, images, and AOSE JSON. Reads clipboardData
  // directly (the only way to see images). Skipped if focus is inside any
  // editable region — the inner editor handles its own paste.
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (editingElementId || vectorEditId || subElementEditId) return;
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (active.isContentEditable) return;
      }
      const items = Array.from(e.clipboardData?.items ?? []);
      if (items.length === 0) return;

      const svgItem = items.find(i => i.type === 'image/svg+xml');
      if (svgItem) {
        e.preventDefault();
        svgItem.getAsString(s => {
          const parsed = parseSvgFileContent(s);
          insertSvgElement(parsed, 'Pasted SVG');
        });
        return;
      }

      const imgItem = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) {
          e.preventDefault();
          insertImageFromFile(file, 'Pasted Image');
        }
        return;
      }

      const textItem = items.find(i => i.kind === 'string' && i.type === 'text/plain');
      if (textItem) {
        e.preventDefault();
        textItem.getAsString(s => {
          const trimmed = s.trim();
          // AOSE JSON first — its `html` field can contain "<svg ...>" embedded,
          // so don't sniff for <svg substring before we've ruled JSON out.
          if (tryPasteAoseJson(trimmed)) return;
          if (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml')) {
            const parsed = parseSvgFileContent(trimmed);
            insertSvgElement(parsed, 'Pasted SVG');
          }
        });
        return;
      }

      const htmlItem = items.find(i => i.kind === 'string' && i.type === 'text/html');
      if (htmlItem) {
        e.preventDefault();
        htmlItem.getAsString(s => {
          const m = s.match(/<svg[\s\S]*?<\/svg>/i);
          if (m) {
            const parsed = parseSvgFileContent(m[0]);
            insertSvgElement(parsed, 'Pasted SVG');
          }
        });
      }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [editingElementId, vectorEditId, subElementEditId, insertImageFromFile, insertSvgElement, tryPasteAoseJson]);

  const handleImageFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isSvgFile(file)) {
      const text = await file.text();
      const parsed = parseSvgFileContent(text);
      insertSvgElement(parsed, file.name.replace(/\.[^.]+$/, ''));
    } else {
      await insertImageFromFile(file, file.name.replace(/\.[^.]+$/, ''));
    }
    e.target.value = '';
  }, [insertImageFromFile, insertSvgElement]);

  const handleSvgFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseSvgFileContent(text);
    insertSvgElement(parsed, file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  }, [insertSvgElement]);

  const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = extractDroppedImageFiles(e.nativeEvent);
    for (const file of files) {
      if (isSvgFile(file)) {
        const text = await file.text();
        const parsed = parseSvgFileContent(text);
        insertSvgElement(parsed, file.name.replace(/\.[^.]+$/, ''));
      } else {
        await insertImageFromFile(file, file.name.replace(/\.[^.]+$/, ''));
      }
    }
  }, [insertImageFromFile, insertSvgElement]);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const bringForward = useCallback((id: string) => {
    const el = elementContext.elements.find(e => e.id === id);
    updateElement(id, { z_index: (el?.z_index ?? 0) + 1 });
  }, [elementContext.elements, updateElement]);

  const sendBackward = useCallback((id: string) => {
    const el = elementContext.elements.find(e => e.id === id);
    updateElement(id, { z_index: Math.max(0, (el?.z_index ?? 0) - 1) });
  }, [elementContext.elements, updateElement]);

  const bringToFront = useCallback((id: string) => {
    const maxZ = Math.max(0, ...elementContext.elements.map(e => e.z_index ?? 0));
    updateElement(id, { z_index: maxZ + 1 });
  }, [elementContext.elements, updateElement]);

  const sendToBack = useCallback((id: string) => {
    elementContext.setElements(els => {
      const others = els.filter(e => e.id !== id);
      const bumped = others.map(e => ({ ...e, z_index: (e.z_index ?? 0) + 1 }));
      const target = els.find(e => e.id === id);
      return target ? [...bumped, { ...target, z_index: 0 }] : els;
    });
  }, [elementContext]);

  const toggleLock = useCallback((id: string) => {
    const el = findElementById(id);
    if (el) updateElement(id, { locked: !el.locked });
  }, [findElementById, updateElement]);

  const toggleElementVisible = useCallback((id: string) => {
    const el = findElementById(id);
    if (el) updateElement(id, { visible: el.visible === false ? true : false });
  }, [findElementById, updateElement]);

  const renameFrame = useCallback((id: string) => {
    setEditingFrameName(id);
  }, [setEditingFrameName]);

  const handleExportFramePng = useCallback(async (pageId: string) => {
    const frame = data?.pages.find(p => p.page_id === pageId);
    if (!frame) return;

    // Mount a hidden export view, capture PNG, unmount
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;';
    document.body.appendChild(container);

    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const root = createRoot(container);
    const ref = React.createRef<HTMLDivElement>();

    try {
      flushSync(() => {
        root.render(React.createElement(CanvasFrameExportView, { frame, ref }));
      });

      if (ref.current) {
        await exportFramePng(ref.current, frame.title || 'frame');
      }
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  }, [data]);

  const handleExportFrameSvg = useCallback(async (pageId: string) => {
    const frame = data?.pages.find(p => p.page_id === pageId);
    if (!frame) return;

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;';
    document.body.appendChild(container);

    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const root = createRoot(container);
    const ref = React.createRef<HTMLDivElement>();

    try {
      flushSync(() => {
        root.render(React.createElement(CanvasFrameExportView, { frame, ref }));
      });

      if (ref.current) {
        await exportFrameSvg(ref.current, frame.title || 'frame');
      }
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  }, [data]);

  // ─── Property panel export handlers ──────────────────

  const handleExportSelectionPng = useCallback(async () => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;';
    document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const root = createRoot(container);
    const ref = React.createRef<HTMLDivElement>();

    try {
      if (frameExplicitlySelected && activeFrame && selectedIds.size === 0) {
        flushSync(() => {
          root.render(React.createElement(CanvasFrameExportView, { frame: activeFrame, ref }));
        });
        if (ref.current) await exportFramePng(ref.current, activeFrame.title || 'frame');
      } else {
        const resolved = Array.from(selectedIds).map(id => findElementById(id)).filter(Boolean) as CanvasElement[];
        if (resolved.length === 0) return;
        const name = resolved.length === 1 ? (resolved[0].name || 'element') : 'selection';
        flushSync(() => {
          root.render(React.createElement(ElementExportView, { elements: resolved, ref }));
        });
        if (ref.current) await exportFramePng(ref.current, name);
      }
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  }, [frameExplicitlySelected, activeFrame, selectedIds, findElementById]);

  const handleExportSelectionSvg = useCallback(async () => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;';
    document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const root = createRoot(container);
    const ref = React.createRef<HTMLDivElement>();

    try {
      if (frameExplicitlySelected && activeFrame && selectedIds.size === 0) {
        flushSync(() => {
          root.render(React.createElement(CanvasFrameExportView, { frame: activeFrame, ref }));
        });
        if (ref.current) await exportFrameSvg(ref.current, activeFrame.title || 'frame');
      } else {
        const resolved = Array.from(selectedIds).map(id => findElementById(id)).filter(Boolean) as CanvasElement[];
        if (resolved.length === 0) return;
        const name = resolved.length === 1 ? (resolved[0].name || 'element') : 'selection';
        flushSync(() => {
          root.render(React.createElement(ElementExportView, { elements: resolved, ref }));
        });
        if (ref.current) await exportFrameSvg(ref.current, name);
      }
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  }, [frameExplicitlySelected, activeFrame, selectedIds, findElementById]);

  const canSelectionExportSvg = useMemo(() => {
    if (frameExplicitlySelected && activeFrame && selectedIds.size === 0) {
      return canExportFrameAsSvg(activeFrame);
    }
    const resolved = Array.from(selectedIds).map(id => findElementById(id)).filter(Boolean) as CanvasElement[];
    return resolved.length > 0 && resolved.every(el => canExportElementAsSvg(el));
  }, [frameExplicitlySelected, activeFrame, selectedIds, findElementById]);

  const hasExportTarget = frameExplicitlySelected || selectedIds.size > 0;

  // ─── Context menus ──────────────────
  const canvasElementActionMap = useMemo(() => buildActionMap(canvasElementActions), []);
  const canvasFrameActionMap = useMemo(() => buildActionMap(canvasFrameActions), []);

  const getElementMenuItems = useCallback(() => {
    const resolved = Array.from(selectedIds).map(id => findElementById(id)).filter(Boolean) as CanvasElement[];
    const singleSel = resolved.length === 1 ? resolved[0] : null;
    const ctx: CanvasElementCtx = {
      selectedIds,
      singleSelected: singleSel,
      handleCut, handleCopy, handlePaste,
      deleteSelected,
      duplicateElement: (id) => duplicateElement(id),
      bringToFront, bringForward, sendBackward, sendToBack,
      groupSelected, ungroupSelected,
      toggleLock,
      openAiEdit: () => onShowComments(),
      openComments: () => onShowComments(),
      handleCanvasComment,
      selectAll: () => setSelectedIds(new Set(elementContext.elements.filter(el => el.visible !== false).map(el => el.id))),
      fitToView: fitAllFrames,
      resetZoom: resetZoomTo100,
    };
    const surface = selectedIds.size > 1 ? canvasSurfaces.multiMenu : canvasSurfaces.elementMenu;
    return toContextMenuItems(surface, canvasElementActionMap, ctx, t);
  }, [selectedIds, findElementById, handleCut, handleCopy, handlePaste, deleteSelected,
      duplicateElement, bringToFront, bringForward, sendBackward, sendToBack,
      groupSelected, ungroupSelected, toggleLock, canvasElementActionMap, t, onShowComments,
      elementContext.elements, fitAllFrames, resetZoomTo100, handleCanvasComment]);

  const { onContextMenu: onElementContextMenu } = useContextMenu(getElementMenuItems);

  const getBlankMenuItems = useCallback(() => {
    const ctx: CanvasElementCtx = {
      selectedIds: new Set(),
      singleSelected: null,
      handleCut, handleCopy, handlePaste,
      deleteSelected,
      duplicateElement: () => {},
      bringToFront, bringForward, sendBackward, sendToBack,
      groupSelected, ungroupSelected,
      toggleLock,
      openAiEdit: () => {},
      openComments: () => {},
      selectAll: () => setSelectedIds(new Set(elementContext.elements.filter(el => el.visible !== false).map(el => el.id))),
      fitToView: fitAllFrames,
      resetZoom: resetZoomTo100,
    };
    return toContextMenuItems(canvasSurfaces.blankMenu, canvasElementActionMap, ctx, t);
  }, [handleCut, handleCopy, handlePaste, deleteSelected, bringToFront, bringForward, sendBackward, sendToBack,
      groupSelected, ungroupSelected, toggleLock, canvasElementActionMap, t,
      elementContext.elements, fitAllFrames, resetZoomTo100]);

  const { onContextMenu: onBlankContextMenu } = useContextMenu(getBlankMenuItems);

  const getFrameMenuItems = useCallback((frameId: string) => () => {
    const frame = data?.pages.find(p => p.page_id === frameId);
    const frameIndex = data?.pages.findIndex(p => p.page_id === frameId) ?? 0;
    const ctx: CanvasFrameCtx = {
      frameId,
      frameTitle: frame?.title,
      frameIndex,
      renameFrame,
      duplicateFrame,
      deleteFrame,
      exportFramePng: handleExportFramePng,
      exportFrameSvg: handleExportFrameSvg,
      canExportSvg: frame ? canExportFrameAsSvg(frame) : false,
      handlePageComment,
    };
    const surface = frame && canExportFrameAsSvg(frame)
      ? canvasSurfaces.frameMenu
      : canvasSurfaces.frameMenu.filter(s => s !== 'canvas-frame-export-svg') as typeof canvasSurfaces.frameMenu;
    return toContextMenuItems(surface, canvasFrameActionMap, ctx, t);
  }, [renameFrame, duplicateFrame, deleteFrame, handleExportFramePng, handleExportFrameSvg, canvasFrameActionMap, t, data, handlePageComment]);

  const alignElements = (alignment: string) => {
    if (selectedIds.size < 2) return;
    const selected = elementContext.elements.filter(el => selectedIds.has(el.id));
    if (selected.length < 2) return;
    elementContext.setElements(els => els.map(el => {
      if (!selectedIds.has(el.id)) return el;
      switch (alignment) {
        case 'left': return { ...el, x: Math.min(...selected.map(s => s.x)) };
        case 'right': return { ...el, x: Math.max(...selected.map(s => s.x + s.w)) - el.w };
        case 'top': return { ...el, y: Math.min(...selected.map(s => s.y)) };
        case 'bottom': return { ...el, y: Math.max(...selected.map(s => s.y + s.h)) - el.h };
        case 'center-h': return { ...el, x: Math.round(selected.reduce((s, e) => s + e.x + e.w / 2, 0) / selected.length - el.w / 2) };
        case 'center-v': return { ...el, y: Math.round(selected.reduce((s, e) => s + e.y + e.h / 2, 0) / selected.length - el.h / 2) };
        default: return el;
      }
    }));
    if (alignment === 'distribute-h' && selected.length >= 3) {
      const sorted = [...selected].sort((a, b) => a.x - b.x);
      const totalSpan = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w - sorted[0].x;
      const totalElWidth = sorted.reduce((s, e) => s + e.w, 0);
      const gap = (totalSpan - totalElWidth) / (sorted.length - 1);
      let cx = sorted[0].x + sorted[0].w + gap;
      elementContext.setElements(els => els.map(el => {
        const idx = sorted.findIndex(s => s.id === el.id);
        if (idx <= 0 || idx >= sorted.length - 1) return el;
        const newX = Math.round(cx);
        cx += el.w + gap;
        return { ...el, x: newX };
      }));
    }
    if (alignment === 'distribute-v' && selected.length >= 3) {
      const sorted = [...selected].sort((a, b) => a.y - b.y);
      const totalSpan = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h - sorted[0].y;
      const totalElHeight = sorted.reduce((s, e) => s + e.h, 0);
      const gap = (totalSpan - totalElHeight) / (sorted.length - 1);
      let cy = sorted[0].y + sorted[0].h + gap;
      elementContext.setElements(els => els.map(el => {
        const idx = sorted.findIndex(s => s.id === el.id);
        if (idx <= 0 || idx >= sorted.length - 1) return el;
        const newY = Math.round(cy);
        cy += el.h + gap;
        return { ...el, y: newY };
      }));
    }
  };

  const handleBooleanOp = useCallback(async (op: BooleanOp) => {
    if (selectedIds.size !== 2) return;
    const elements = elementContext.elements.filter(el => selectedIds.has(el.id));
    if (elements.length !== 2) return;
    const sorted = [...elements].sort((x, y) => x.z_index - y.z_index);
    const [a, b] = sorted;
    // Bake each element's rotation into the path geometry first, so the
    // boolean op runs on the rotated visual shape (not the local-frame
    // unrotated shape). Use each element's actual rotation pivot
    // (transform-origin), translated into viewBox-local coords.
    const computeBakeCenter = (el: typeof a) => {
      const m = el.html.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
      const vx = m?.[0] ?? 0, vy = m?.[1] ?? 0;
      const vw = m?.[2] ?? el.w, vh = m?.[3] ?? el.h;
      const sx = el.w > 0 ? vw / el.w : 1; // canvas → viewBox
      const sy = el.h > 0 ? vh / el.h : 1;
      const originFx = el.rotationOriginX ?? 0.5;
      const originFy = el.rotationOriginY ?? 0.5;
      // Pivot canvas pos relative to element top-left = originFx*w, originFy*h.
      // In viewBox coords: vbX + canvasOffset * (vbW/elementW).
      const vbCx = vx + (originFx * el.w) * sx;
      const vbCy = vy + (originFy * el.h) * sy;
      return { vbCx, vbCy };
    };
    const aCenter = a.rotation ? computeBakeCenter(a) : null;
    const bCenter = b.rotation ? computeBakeCenter(b) : null;
    const htmlARotated = a.rotation ? bakeRotation(a.html, a.rotation, a.w, a.h, aCenter!.vbCx, aCenter!.vbCy) : a.html;
    const htmlBRotated = b.rotation ? bakeRotation(b.html, b.rotation, b.w, b.h, bCenter!.vbCx, bCenter!.vbCy) : b.html;
    const htmlA = convertShapesToPaths(htmlARotated);
    const htmlB = convertShapesToPaths(htmlBRotated);
    const dA = extractPathD(htmlA);
    const dB = extractPathD(htmlB);
    if (!dA || !dB) return;

    const viewBoxA = a.html.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
    const viewBoxB = b.html.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
    const vbAx = viewBoxA?.[0] ?? 0, vbAy = viewBoxA?.[1] ?? 0;
    const vbBx = viewBoxB?.[0] ?? 0, vbBy = viewBoxB?.[1] ?? 0;
    const vbAw = viewBoxA?.[2] ?? a.w, vbAh = viewBoxA?.[3] ?? a.h;
    const vbBw = viewBoxB?.[2] ?? b.w, vbBh = viewBoxB?.[3] ?? b.h;

    const scaleAx = a.w / vbAw, scaleAy = a.h / vbAh;
    const scaleBx = b.w / vbBw, scaleBy = b.h / vbBh;

    const transformD = (d: string, ox: number, oy: number, sx: number, sy: number, vbx: number, vby: number) => {
      const parsed = parsePath(d);
      const points = parsed.points.map(pt => ({
        ...pt,
        x: ox + (pt.x - vbx) * sx,
        y: oy + (pt.y - vby) * sy,
        handleIn: pt.handleIn ? { x: pt.handleIn.x * sx, y: pt.handleIn.y * sy } : undefined,
        handleOut: pt.handleOut ? { x: pt.handleOut.x * sx, y: pt.handleOut.y * sy } : undefined,
      }));
      return serializeSubPath({ points, closed: parsed.closed });
    };

    const worldDA = transformD(dA, a.x, a.y, scaleAx, scaleAy, vbAx, vbAy);
    const worldDB = transformD(dB, b.x, b.y, scaleBx, scaleBy, vbBx, vbBy);

    try {
      const resultD = await booleanPathOp(worldDA, worldDB, op);
      if (!resultD) return;

      const resultParsed = parsePath(resultD);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of resultParsed.points) {
        minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
      }
      const pad = 2;
      const rx = Math.round(minX - pad), ry = Math.round(minY - pad);
      const rw = Math.max(Math.round(maxX - minX + pad * 2), 1);
      const rh = Math.max(Math.round(maxY - minY + pad * 2), 1);

      const subs = resultParsed.subPaths ?? [{ points: resultParsed.points, closed: resultParsed.closed }];
      const shiftedD = subs.map(sp => {
        const shifted = sp.points.map(pt => ({ ...pt, x: pt.x - rx, y: pt.y - ry }));
        return serializeSubPath({ points: shifted, closed: sp.closed });
      }).join('');

      const fillA = a.html.match(/fill="([^"]*)"/)?.[1] ?? '#D9D9D9';
      const fill = fillA === 'none' ? '#D9D9D9' : fillA;
      const html = `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rw} ${rh}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${shiftedD}" fill="${fill}" stroke="none" vector-effect="non-scaling-stroke"/></svg></div>`;

      const newEl: CanvasElement = {
        id: `el-${crypto.randomUUID().slice(0, 8)}`,
        locked: false, z_index: Math.max(a.z_index, b.z_index), x: rx, y: ry, w: rw, h: rh, html,
      };

      elementContext.setElements(els => [...els.filter(el => !selectedIds.has(el.id)), newEl]);
      setSelectedIds(new Set([newEl.id]));
    } catch (err) {
      console.error('Boolean operation failed:', err);
    }
  }, [selectedIds, elementContext]);

  const handleUpdateFrame = useCallback((pageId: string, updates: Partial<CanvasPage>) => {
    updateFrame(pageId, page => ({ ...page, ...updates }));
  }, [updateFrame]);

  const handleUpdateToken = useCallback((name: string, value: string) => {
    if (!activeFrameId || !activeFrame) return;
    const newHeadHtml = updateDesignToken(activeFrame.head_html || '', name, value);
    updateFrame(activeFrameId, page => ({ ...page, head_html: newHeadHtml }));
  }, [activeFrameId, activeFrame, updateFrame]);

  const togglePropertyPanel = useCallback(() => {
    setShowPropertyPanel(v => !v);
  }, []);

  // ─── Design tokens ─────────────────
  const designTokens = useMemo(() => {
    if (!activeFrame?.head_html) return [];
    return extractDesignTokens(activeFrame.head_html);
  }, [activeFrame?.head_html]);

  // ─── Top bar ────────────────────────
  const title = breadcrumb?.[breadcrumb.length - 1]?.title ?? '';
  const handleTitleChange = useCallback(async (newTitle: string) => {
    try { await gw.updateContentItem(contentId, { title: newTitle }); queryClient.invalidateQueries({ queryKey: ['content-items'] }); }
    catch (e) { showError('Failed to update title', e); }
  }, [contentId, queryClient]);
  const handleDelete = useCallback(() => { gw.deleteContentItem(contentId).then(() => onDeleted?.()); }, [contentId, onDeleted]);

  const topBarCtx = useMemo(() => ({
    id: canvasId, type: 'canvas', title, pinned: isPinned ?? false,
    url: typeof window !== 'undefined' ? `${getPublicOrigin()}${window.location.pathname}${window.location.search}` : '',
    startRename: () => {}, openIconPicker: () => {},
    togglePin: () => onTogglePin?.(), deleteItem: handleDelete, shareItem: () => {},
    copyLink: () => onCopyLink?.(),
    showHistory: () => { setShowRevisions(v => !v); onCloseComments(); },
    showComments: () => { onShowComments(); setShowRevisions(false); },
    showHistoryActive: showRevisions, showCommentsActive: showComments,
  }), [canvasId, title, isPinned, handleDelete, onTogglePin, onCopyLink, showRevisions, showComments, onCloseComments, onShowComments]);

  const menuItems = useMemo(() => buildContentTopBarCommonMenuItems(t, topBarCtx), [t, topBarCtx]);
  const fixedActions = useMemo(() => buildFixedTopBarActionItems(t, topBarCtx), [t, topBarCtx]);

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)]">
        <div className="text-muted-foreground text-sm">Loading canvas...</div>
      </div>
    );
  }

  const selectedElements = Array.from(selectedIds).map(id => findElementById(id)).filter(Boolean) as CanvasElement[];
  const singleSelected = selectedElements.length === 1 ? selectedElements[0] : null;
  const firstSelected = selectedElements[0] ?? null;

  return (
    <div className="flex-1 flex flex-row min-h-0">
      <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] md:overflow-hidden relative z-[1]">
        <div className="flex items-center border-b border-border shrink-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
          <ContentTopBar breadcrumb={breadcrumb} onNavigate={onNavigate} onBack={onBack}
            docListVisible={docListVisible} onToggleDocList={onToggleDocList}
            title={title} titlePlaceholder="Untitled Canvas" onTitleChange={handleTitleChange}
            statusText={saveStatus}
            actions={renderFixedTopBarActions(fixedActions, { t, ctx: topBarCtx as any })}
            menuItems={menuItems}
            metaLine={canvasResp ? (
              <button
                onClick={() => setShowRevisions(true)}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
              >
                {t('content.lastModified')}: {formatRelativeTime(canvasResp.updated_at, t)}
                {canvasResp.updated_by && <span> {t('content.by')} <ActorInlineAvatar name={canvasResp.updated_by} /> {canvasResp.updated_by}</span>}
              </button>
            ) : undefined}
            onHistory={() => setShowRevisions(v => !v)} onComments={onToggleComments} />
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Layers sidebar */}
          {showLayers && data && (
            <LayerPanel data={data} activeFrameId={activeFrameId} selectedIds={selectedIds}
              onSelectFrame={(fid) => { setActiveFrameId(fid); setFrameExplicitlySelected(true); setSelectedIds(new Set()); layerAnchorRef.current = null; }}
              onSelectElement={(fid, eid, mode) => {
                setFrameExplicitlySelected(false);
                const scope = fid;
                if (mode === 'replace') {
                  setActiveFrameId(fid);
                  setSelectedIds(new Set([eid]));
                  layerAnchorRef.current = { scope, elementId: eid };
                } else if (mode === 'add') {
                  setActiveFrameId(fid);
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (next.has(eid)) next.delete(eid); else next.add(eid);
                    return next;
                  });
                  layerAnchorRef.current = { scope, elementId: eid };
                } else {
                  // range — only meaningful within same frame scope (no cross-frame range)
                  const anchor = layerAnchorRef.current;
                  const frame = data?.pages.find(p => p.page_id === fid);
                  if (!anchor || anchor.scope !== scope || !frame) {
                    setActiveFrameId(fid);
                    setSelectedIds(new Set([eid]));
                    layerAnchorRef.current = { scope, elementId: eid };
                    return;
                  }
                  const ordered = frame.elements.slice().sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0));
                  const i = ordered.findIndex(e => e.id === anchor.elementId);
                  const j = ordered.findIndex(e => e.id === eid);
                  if (i < 0 || j < 0) {
                    setActiveFrameId(fid);
                    setSelectedIds(new Set([eid]));
                    layerAnchorRef.current = { scope, elementId: eid };
                    return;
                  }
                  const [lo, hi] = i <= j ? [i, j] : [j, i];
                  const ids = ordered.slice(lo, hi + 1).map(e => e.id);
                  setActiveFrameId(fid);
                  setSelectedIds(new Set(ids));
                  // Anchor stays put for further shift+clicks
                }
              }}
              onSelectCanvasElement={(eid, mode) => {
                setFrameExplicitlySelected(false);
                const scope = '__canvas__';
                if (mode === 'replace') {
                  setActiveFrameId(null);
                  setSelectedIds(new Set([eid]));
                  layerAnchorRef.current = { scope, elementId: eid };
                } else if (mode === 'add') {
                  setActiveFrameId(null);
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (next.has(eid)) next.delete(eid); else next.add(eid);
                    return next;
                  });
                  layerAnchorRef.current = { scope, elementId: eid };
                } else {
                  const anchor = layerAnchorRef.current;
                  const els = data?.elements ?? [];
                  if (!anchor || anchor.scope !== scope) {
                    setActiveFrameId(null);
                    setSelectedIds(new Set([eid]));
                    layerAnchorRef.current = { scope, elementId: eid };
                    return;
                  }
                  const ordered = els.slice().sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0));
                  const i = ordered.findIndex(e => e.id === anchor.elementId);
                  const j = ordered.findIndex(e => e.id === eid);
                  if (i < 0 || j < 0) {
                    setActiveFrameId(null);
                    setSelectedIds(new Set([eid]));
                    layerAnchorRef.current = { scope, elementId: eid };
                    return;
                  }
                  const [lo, hi] = i <= j ? [i, j] : [j, i];
                  const ids = ordered.slice(lo, hi + 1).map(e => e.id);
                  setActiveFrameId(null);
                  setSelectedIds(new Set(ids));
                }
              }}
              onElementContextMenu={(e, fid, eid) => {
                e.preventDefault();
                e.stopPropagation();
                // If right-clicked element isn't already in the selection, replace selection with just it.
                if (!selectedIds.has(eid)) {
                  setActiveFrameId(fid);
                  setFrameExplicitlySelected(false);
                  setSelectedIds(new Set([eid]));
                  layerAnchorRef.current = { scope: fid ?? '__canvas__', elementId: eid };
                } else if (fid !== activeFrameId) {
                  setActiveFrameId(fid);
                }
                onElementContextMenu(e);
              }}
              onFrameContextMenu={(e, fid) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveFrameId(fid);
                setFrameExplicitlySelected(true);
                setSelectedIds(new Set());
                const items = getFrameMenuItems(fid)();
                if (items.length > 0) {
                  window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { items, x: e.clientX, y: e.clientY } }));
                }
              }}
              onClose={() => setShowLayers(false)}
              onRenameFrame={(fid, title) => updateFrame(fid, p => ({ ...p, title }))}
              onRenameElement={(fid, eid, name) => updateFrame(fid, p => ({ ...p, elements: p.elements.map(e => e.id === eid ? { ...e, name } : e) }))}
              onRenameCanvasElement={(eid, name) => updateCanvasElement(eid, { name })}
              onReorderElements={reorderElements}
              onToggleVisible={toggleElementVisible}
              onToggleLock={toggleLock}
            />
          )}

          {/* Infinite canvas viewport */}
          <div className="flex-1 min-w-0 overflow-hidden relative"
            style={{ background: data.background_color || '#F5F7F5', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', cursor: isPanning ? 'grabbing' : pendingInsert ? 'crosshair' : 'default' }}
            ref={containerRef} onMouseDown={handleCanvasPointerDown}
            onDrop={handleCanvasDrop} onDragOver={handleCanvasDragOver}
            onContextMenu={onBlankContextMenu}>

            {/* Revision preview overlay — covers the live editor, read-only grid of frames */}
            {previewRevisionData && previewRevisionMeta && (
              <div
                className="absolute inset-0 flex flex-col bg-card"
                data-overlay-scrollable
                style={{ zIndex: 11000 }}
                onMouseDown={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
              >
                <RevisionPreviewBanner
                  createdAt={previewRevisionMeta.created_at}
                  onExit={() => { setPreviewRevisionData(null); setPreviewRevisionMeta(null); }}
                  onRestore={async () => {
                    if (!confirm(t('content.restoreVersionWarning', { type: t('content.typeCanvas') }))) return;
                    try {
                      const result = await gw.restoreContentRevision(contentId, previewRevisionMeta.id);
                      const restored = (result?.data ?? null) as CanvasData | null;
                      if (restored) {
                        setData(restored);
                        scheduleSave(restored);
                      }
                      setPreviewRevisionData(null);
                      setPreviewRevisionMeta(null);
                      setShowRevisions(false);
                    } catch (e: unknown) {
                      alert(e instanceof Error ? e.message : t('content.restoreVersionFailed'));
                    }
                  }}
                />
                <div className="flex-1 overflow-auto p-6 bg-muted/30">
                  {previewRevisionData.pages && previewRevisionData.pages.length > 0 ? (
                    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
                      {previewRevisionData.pages.map(page => {
                        const targetW = 800;
                        const scale = page.width > 0 ? targetW / page.width : 1;
                        const targetH = page.height * scale;
                        return (
                          <div key={page.page_id} className="rounded-lg border border-border shadow-sm overflow-hidden bg-card">
                            <div className="px-3 py-2 border-b border-border bg-muted/30">
                              <span className="text-xs font-medium">{page.title || 'Frame'}</span>
                              <span className="ml-2 text-[11px] text-muted-foreground">{Math.round(page.width)} × {Math.round(page.height)}</span>
                            </div>
                            <div className="relative bg-white" style={{ width: targetW, height: targetH }}>
                              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                                <CanvasFrameExportView frame={page} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center text-sm text-muted-foreground py-8">{t('content.noPreviewData')}</div>
                  )}
                </div>
              </div>
            )}


            <CanvasToolbar
              pendingInsert={pendingInsert}
              onSetPending={setPendingInsert}
              onAddShape={addShapeFromPicker}
              onAddImage={handleAddImage}
              onAddSvg={handleAddSvg}
              canUndo={undoRedo.canUndo} canRedo={undoRedo.canRedo}
              onUndo={handleUndo} onRedo={handleRedo}
              rightOffsetPx={pendingInsert?.type === 'frame' ? 240 : (showPropertyPanel ? 240 : 0)}
            />
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileSelected} />
            <input ref={svgInputRef} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={handleSvgFileSelected} />


            {/* All frames rendered on infinite canvas */}
            {(data.pages ?? []).map(frame => {
              const fx = frame.frame_x ?? 0;
              const fy = frame.frame_y ?? 0;
              const isActive = frame.page_id === activeFrameId;

              return (
                <div key={frame.page_id} data-frame-id={frame.page_id}
                  onMouseDown={(e) => handleFrameClick(frame.page_id, e)}>
                  {/* Frame name label — drag to reposition, double-click to edit */}
                  <div
                    data-frame-label={frame.page_id}
                    onMouseDown={(e) => { if (editingFrameName !== frame.page_id) handleFrameNameMouseDown(frame.page_id, e); }}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingFrameName(frame.page_id); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const items = getFrameMenuItems(frame.page_id)();
                      if (items.length > 0) {
                        window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { items, x: e.clientX, y: e.clientY } }));
                      }
                    }}
                    style={{
                      position: 'absolute',
                      left: pan.x + fx * scale,
                      top: pan.y + fy * scale - 24,
                      whiteSpace: 'nowrap',
                      cursor: editingFrameName === frame.page_id ? 'text' : 'pointer',
                      zIndex: 5,
                    }}>
                    {editingFrameName === frame.page_id ? (
                      <input
                        autoFocus
                        defaultValue={frame.title || ''}
                        className="text-xs font-medium px-1 py-0.5 rounded border bg-background"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim() || 'Untitled';
                            updateFrame(frame.page_id, p => ({ ...p, title: val }));
                            setEditingFrameName(null);
                          }
                          if (e.key === 'Escape') setEditingFrameName(null);
                        }}
                        onBlur={e => {
                          const val = e.target.value.trim() || 'Untitled';
                          updateFrame(frame.page_id, p => ({ ...p, title: val }));
                          setEditingFrameName(null);
                        }}
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className={cn(
                          'text-xs font-medium px-1 py-0.5 select-none rounded hover:bg-accent/50',
                          isActive ? 'text-primary' : 'text-muted-foreground'
                        )}>
                          {frame.title || 'Untitled'}
                        </span>
                        {data.pages.length > 1 && isActive && (
                          <button onClick={(e) => { e.stopPropagation(); deleteFrame(frame.page_id); }}
                            className="ml-1 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive inline-flex">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Frame content (white rectangle) */}
                  <div style={{
                    position: 'absolute',
                    left: pan.x + fx * scale,
                    top: pan.y + fy * scale,
                    width: frame.width * scale,
                    height: frame.height * scale,
                    overflow: 'visible',
                  }}>
                    <div style={{
                      width: frame.width,
                      height: frame.height,
                      transform: `scale(${scale})`,
                      transformOrigin: '0 0',
                      background: frame.background_color || '#ffffff',
                      backgroundImage: frame.background_image ? `url(${frame.background_image})` : undefined,
                      backgroundSize: frame.background_image ? 'cover' : undefined,
                      boxShadow: isActive
                        ? `0 0 0 2px #3b82f6, ${frame.box_shadow || '0 2px 20px rgba(0,0,0,0.1)'}`
                        : (frame.box_shadow || '0 2px 20px rgba(0,0,0,0.1)'),
                      borderRadius: frame.border_radius ?? 2,
                      border: frame.border_color && frame.border_width
                        ? `${frame.border_width}px ${frame.border_style || 'solid'} ${frame.border_color}`
                        : undefined,
                      overflow: 'hidden',
                      position: 'relative',
                    }}>
                      {/* Snap lines (only for active frame) */}
                      {isActive && snapLines.map((line, i) => {
                        if (line.kind === 'align') {
                          return <div key={i} style={{
                            position: 'absolute',
                            ...(line.orientation === 'v'
                              ? { left: line.position, top: 0, width: 1, height: frame.height }
                              : { left: 0, top: line.position, width: frame.width, height: 1 }),
                            backgroundColor: '#3b82f6', opacity: 0.5, pointerEvents: 'none', zIndex: 9999,
                          }} />;
                        } else {
                          return <div key={i} style={{
                            position: 'absolute',
                            left: Math.min(line.x1, line.x2),
                            top: Math.min(line.y1, line.y2),
                            width: Math.max(1, Math.abs(line.x2 - line.x1)),
                            height: Math.max(1, Math.abs(line.y2 - line.y1)),
                            backgroundColor: '#f43f5e', opacity: 0.8, pointerEvents: 'none', zIndex: 9999,
                          }} />;
                        }
                      })}
                      {/* Render all frame elements normally */}
                      {frame.elements.filter(el => el.visible !== false).slice().sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)).map(el => (
                        <CanvasElementView key={el.id} element={el}
                          selected={isActive && selectedIds.has(el.id) && subElementEditId !== el.id && !(activeGroupPath.includes(el.id))}
                          scale={scale}
                          hovered={hoveredId === el.id && !subElementEditId && !(activeGroupPath.includes(el.id))}
                          editing={editingElementId === el.id}
                          vectorEditing={vectorEditId === el.id}
                          groupChildrenInteractive={false}
                          hideGroupChildren={activeGroupPath.includes(el.id)}
                          onSelect={(id, e) => {
                            if (activeGroupPath.includes(id)) return;
                            if (activeGroupId) { setActiveGroupPath([]); setSelectedIds(new Set()); }
                            handleSelectElement(frame.page_id, id, e);
                          }}
                          onDragStart={(id, e) => {
                            if (activeGroupPath.includes(id)) return;
                            if (activeGroupId) { setActiveGroupPath([]); setSelectedIds(new Set()); }
                            handleDragStart(frame.page_id, id, e);
                          }}
                          onResizeStart={(id, handle, e) => {
                            if (activeGroupPath.includes(id)) return;
                            handleResizeStart(frame.page_id, id, handle, e);
                          }}
                          onRotateStart={(id, e) => {
                            if (activeGroupPath.includes(id)) return;
                            handleRotateStart(frame.page_id, id, e);
                          }}
                          onDoubleClick={(id) => {
                            if (activeGroupPath.includes(id)) return;
                            handleDoubleClick(frame.page_id, id);
                          }}
                          onContextMenu={(id, e) => {
                            if (!selectedIds.has(id)) {
                              setActiveFrameId(frame.page_id);
                              setSelectedIds(new Set([id]));
                            }
                            onElementContextMenu(e);
                          }}
                          onShadowRootReady={(id, sr) => shadowRootRefs.current.set(id, sr)}
                          onMouseEnter={(id) => { if (!activeGroupPath.includes(id)) setHoveredId(id); }}
                          onMouseLeave={(id) => { if (hoveredId === id) setHoveredId(null); }} />
                      ))}
                      {/* Active group children rendered as interactive flat elements on top */}
                      {isActive && (() => {
                        const renderGroupLevel = (pathIdx: number, absX: number, absY: number, group: CanvasElement): React.ReactNode[] => {
                          if (!group.children) return [];
                          const isDeepest = pathIdx >= activeGroupPath.length - 1;
                          const nextInPath = !isDeepest ? activeGroupPath[pathIdx + 1] : null;
                          return group.children.flatMap(child => {
                            const childAbsX = absX + child.x;
                            const childAbsY = absY + child.y;
                            if (child.id === nextInPath && child.type === 'group') {
                              return [
                                <CanvasElementView key={`group-child-${child.id}`}
                                  element={{ ...child, x: childAbsX, y: childAbsY }}
                                  selected={false} scale={scale}
                                  hideGroupChildren
                                  nonInteractive
                                  onSelect={() => {}} onDragStart={() => {}}
                                  onResizeStart={() => {}}
                                  onShadowRootReady={(id, sr) => shadowRootRefs.current.set(id, sr)}
                                  onMouseEnter={() => {}} onMouseLeave={() => {}} />,
                                ...renderGroupLevel(pathIdx + 1, childAbsX, childAbsY, child),
                              ];
                            }
                            const absChild = { ...child, x: childAbsX, y: childAbsY };
                            return [
                              <CanvasElementView key={`group-child-${child.id}`} element={absChild}
                                selected={isDeepest && selectedIds.has(child.id)} scale={scale}
                                hovered={isDeepest && hoveredId === child.id}
                                editing={isDeepest && editingElementId === child.id}
                                vectorEditing={isDeepest && vectorEditId === child.id}
                                nonInteractive={!isDeepest}
                                groupChildrenInteractive={false}
                                onSelect={(id, e) => isDeepest ? handleSelectElement(frame.page_id, id, e) : undefined}
                                onDragStart={(id, e) => {
                                  if (!isDeepest) return;
                                  handleDragStart(frame.page_id, id, e, activeGroupId!, child);
                                }}
                                onResizeStart={(id, handle, e) => {
                                  if (!isDeepest) return;
                                  const pos = getClientPos(e); if (!pos) return;
                                  undoRedo.beginBatch();
                                  dragRef.current = { type: 'resize', elementId: id, frameId: frame.page_id, handle, groupId: activeGroupId!, startX: pos.clientX, startY: pos.clientY, origX: child.x, origY: child.y, origW: child.w, origH: child.h, origRotation: child.rotation, origAspectLocked: child.aspect_locked === true, origHtml: child.html?.includes('<svg') ? child.html : undefined, origChildren: child.type === 'group' && child.children ? child.children : undefined };
                                }}
                                onRotateStart={(id, e) => {
                                  if (!isDeepest) return;
                                  handleRotateStart(frame.page_id, id, e);
                                }}
                                onDoubleClick={(id) => isDeepest ? handleDoubleClick(frame.page_id, id) : undefined}
                                onShadowRootReady={(id, sr) => shadowRootRefs.current.set(id, sr)}
                                onMouseEnter={(id) => isDeepest ? setHoveredId(id) : undefined}
                                onMouseLeave={(id) => { if (hoveredId === id) setHoveredId(null); }} />
                            ];
                          });
                        };
                        const firstGroup = frame.elements.find(e => e.id === activeGroupPath[0]);
                        if (!firstGroup || firstGroup.type !== 'group' || !firstGroup.children) return null;
                        return renderGroupLevel(0, firstGroup.x, firstGroup.y, firstGroup);
                      })()}
                    </div>
                  </div>

                  {/* Frame resize handles + size label when frame is explicitly selected and no element selected */}
                  {isActive && selectedIds.size === 0 && frameExplicitlySelected && activeGroupPath.length === 0 && (
                    <>
                      {/* Size label */}
                      <div style={{
                        position: 'absolute',
                        left: pan.x + fx * scale + frame.width * scale / 2,
                        top: pan.y + fy * scale + frame.height * scale + 8,
                        transform: 'translateX(-50%)',
                        fontSize: 10, padding: '0 6px', lineHeight: '16px',
                        background: '#3b82f6', color: 'white', borderRadius: 3,
                        pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 100,
                      }}>
                        {frame.width} × {frame.height}
                      </div>
                      {/* Resize handles */}
                      {HANDLES.map(h => (
                        <div key={h} style={{
                          position: 'absolute',
                          left: pan.x + fx * scale + (parseFloat(HANDLE_POS[h].left) / 100) * frame.width * scale - 4,
                          top: pan.y + fy * scale + (parseFloat(HANDLE_POS[h].top) / 100) * frame.height * scale - 4,
                          width: 8, height: 8,
                          background: '#fff', border: '2px solid #3b82f6', borderRadius: 2,
                          cursor: HANDLE_CURSORS[h], zIndex: 101, pointerEvents: 'auto',
                        }}
                          onMouseDown={(e) => handleFrameResizeStart(frame.page_id, h, e)}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {/* Canvas-level elements (not in any frame) */}
            {(data.elements ?? []).filter(el => el.visible !== false).slice().sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)).map(el => {
              const zeroed = { ...el, x: 0, y: 0 };
              return (
                <div key={el.id} style={{
                  position: 'absolute',
                  left: pan.x + el.x * scale,
                  top: pan.y + el.y * scale,
                  width: el.w * scale,
                  height: el.h * scale,
                  overflow: 'visible',
                }}>
                  <div style={{ width: el.w, height: el.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                    <CanvasElementView element={zeroed}
                      selected={!activeFrameId && selectedIds.has(el.id) && subElementEditId !== el.id && !activeGroupPath.includes(el.id)} scale={scale}
                      hovered={hoveredId === el.id && !subElementEditId && !activeGroupPath.includes(el.id)}
                      editing={editingElementId === el.id}
                      vectorEditing={vectorEditId === el.id}
                      groupChildrenInteractive={false}
                      hideGroupChildren={activeGroupPath.includes(el.id)}
                      onSelect={(id, e) => {
                        if (activeGroupPath.includes(id)) return;
                        if (activeGroupId) { setActiveGroupPath([]); setSelectedIds(new Set()); }
                        handleSelectElement(null, id, e);
                      }}
                      onDragStart={(id, e) => {
                        if (activeGroupPath.includes(id)) return;
                        if (activeGroupId) { setActiveGroupPath([]); setSelectedIds(new Set()); }
                        handleDragStart(null, id, e);
                      }}
                      onResizeStart={(id, handle, e) => {
                        if (activeGroupPath.includes(id)) return;
                        handleResizeStart(null, id, handle, e);
                      }}
                      onRotateStart={(id, e) => {
                        if (activeGroupPath.includes(id)) return;
                        handleRotateStart(null, id, e);
                      }}
                      onShadowRootReady={(id, sr) => shadowRootRefs.current.set(id, sr)}
                      onMouseEnter={() => { if (!activeGroupPath.includes(el.id)) setHoveredId(el.id); }}
                      onMouseLeave={() => { if (hoveredId === el.id) setHoveredId(null); }}
                      onContextMenu={(id, e) => {
                        if (!selectedIds.has(id)) {
                          setActiveFrameId(null);
                          setSelectedIds(new Set([id]));
                        }
                        onElementContextMenu(e);
                      }}
                      onDoubleClick={(id) => {
                        if (activeGroupPath.includes(id)) return;
                        handleDoubleClick(null, id);
                      }} />
                  </div>
                </div>
              );
            })}
            {/* Active group children for canvas-level groups */}
            {!activeFrameId && activeGroupPath.length > 0 && (() => {
              const renderCanvasGroupLevel = (pathIdx: number, absX: number, absY: number, group: CanvasElement): React.ReactNode[] => {
                if (!group.children) return [];
                const isDeepest = pathIdx >= activeGroupPath.length - 1;
                const nextInPath = !isDeepest ? activeGroupPath[pathIdx + 1] : null;
                return group.children.flatMap(child => {
                  const childAbsX = absX + child.x;
                  const childAbsY = absY + child.y;
                  if (child.id === nextInPath && child.type === 'group') {
                    const zeroed = { ...child, x: 0, y: 0 };
                    return [
                      <div key={`group-child-${child.id}`} style={{
                        position: 'absolute',
                        left: pan.x + childAbsX * scale,
                        top: pan.y + childAbsY * scale,
                        width: child.w * scale, height: child.h * scale, overflow: 'visible',
                      }}>
                        <div style={{ width: child.w, height: child.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                          <CanvasElementView element={zeroed}
                            selected={false} scale={scale}
                            hideGroupChildren nonInteractive
                            onSelect={() => {}} onDragStart={() => {}}
                            onResizeStart={() => {}}
                            onShadowRootReady={(id, sr) => shadowRootRefs.current.set(id, sr)}
                            onMouseEnter={() => {}} onMouseLeave={() => {}} />
                        </div>
                      </div>,
                      ...renderCanvasGroupLevel(pathIdx + 1, childAbsX, childAbsY, child),
                    ];
                  }
                  const absChild = { ...child, x: childAbsX, y: childAbsY };
                  const zeroed = { ...child, x: 0, y: 0 };
                  return [
                    <div key={`group-child-${child.id}`} style={{
                      position: 'absolute',
                      left: pan.x + childAbsX * scale,
                      top: pan.y + childAbsY * scale,
                      width: child.w * scale, height: child.h * scale, overflow: 'visible',
                    }}>
                      <div style={{ width: child.w, height: child.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                        <CanvasElementView element={zeroed}
                          selected={isDeepest && selectedIds.has(child.id)} scale={scale}
                          hovered={isDeepest && hoveredId === child.id}
                          editing={isDeepest && editingElementId === child.id}
                          vectorEditing={isDeepest && vectorEditId === child.id}
                          nonInteractive={!isDeepest}
                          groupChildrenInteractive={false}
                          onSelect={(id, e) => isDeepest ? handleSelectElement(null, id, e) : undefined}
                          onDragStart={(id, e) => {
                            if (!isDeepest) return;
                            handleDragStart(null, id, e, activeGroupId!, child);
                          }}
                          onResizeStart={(id, handle, e) => {
                            if (!isDeepest) return;
                            const pos = getClientPos(e); if (!pos) return;
                            undoRedo.beginBatch();
                            dragRef.current = { type: 'resize', elementId: id, handle, groupId: activeGroupId!, startX: pos.clientX, startY: pos.clientY, origX: child.x, origY: child.y, origW: child.w, origH: child.h, origRotation: child.rotation, origAspectLocked: child.aspect_locked === true, origHtml: child.html?.includes('<svg') ? child.html : undefined, origChildren: child.type === 'group' && child.children ? child.children : undefined };
                          }}
                          onRotateStart={(id, e) => {
                            if (!isDeepest) return;
                            handleRotateStart(null, id, e);
                          }}
                          onDoubleClick={(id) => isDeepest ? handleDoubleClick(null, id) : undefined}
                          onShadowRootReady={(id, sr) => shadowRootRefs.current.set(id, sr)}
                          onMouseEnter={() => isDeepest ? setHoveredId(child.id) : undefined}
                          onMouseLeave={() => { if (hoveredId === child.id) setHoveredId(null); }} />
                      </div>
                    </div>
                  ];
                });
              };
              const firstGroup = (data.elements ?? []).find(e => e.id === activeGroupPath[0]);
              if (!firstGroup || firstGroup.type !== 'group' || !firstGroup.children) return null;
              return renderCanvasGroupLevel(0, firstGroup.x, firstGroup.y, firstGroup);
            })()}

            {/* Editing overlay */}
            {editingElementId && (() => {
              const el = findElementById(editingElementId);
              if (!el) return null;
              const isInFrame = !!activeFrameId;
              const fx = isInFrame ? (activeFrame?.frame_x ?? 0) : 0;
              const fy = isInFrame ? (activeFrame?.frame_y ?? 0) : 0;
              const resolved = activeGroupPath.length > 0 ? resolveGroupByPath() : null;
              const groupOffX = resolved?.absX ?? 0;
              const groupOffY = resolved?.absY ?? 0;
              const elPanX = isInFrame ? pan.x + fx * scale : pan.x;
              const elPanY = isInFrame ? pan.y + fy * scale : pan.y;
              const editEl = { ...el, x: el.x + groupOffX, y: el.y + groupOffY };
              return (
                <EditingOverlay
                  key={editingElementId}
                  element={editEl}
                  scale={scale}
                  panX={elPanX}
                  panY={elPanY}
                  onHtmlChange={(html) => {
                    const updates: Partial<CanvasElement> = { html };
                    const modeMatch = html.match(/data-text-resize="([^"]*)"/);
                    const mode = modeMatch?.[1];
                    if (mode === 'auto') {
                      const size = measureTextSize(html);
                      updates.w = size.w;
                      updates.h = size.h;
                    } else if (mode === 'fixed-width') {
                      // Pass current element.w so the measurer wraps at the
                      // same width and reports the multi-line height.
                      const size = measureTextSize(html, el.w);
                      updates.h = size.h;
                    }
                    // mode === 'fixed' (or undefined): don't touch w/h.
                    updateElement(el.id, updates);
                  }}
                  onSizeChange={(w, h) => {
                    updateElement(el.id, { w, h });
                  }}
                  onDone={() => setEditingElementId(null)}
                />
              );
            })()}

            {/* Vector editing overlay */}
            {vectorEditId && (() => {
              const el = findElementById(vectorEditId);
              if (!el) return null;
              const isInFrame = !!activeFrameId;
              const fx = isInFrame ? (activeFrame?.frame_x ?? 0) : 0;
              const fy = isInFrame ? (activeFrame?.frame_y ?? 0) : 0;
              const resolved = activeGroupPath.length > 0 ? resolveGroupByPath() : null;
              const groupOffX = resolved?.absX ?? 0;
              const groupOffY = resolved?.absY ?? 0;
              return (
                <VectorEditor
                  elementHtml={el.html}
                  elementX={el.x + groupOffX + fx}
                  elementY={el.y + groupOffY + fy}
                  elementW={el.w}
                  elementH={el.h}
                  elementRotation={el.rotation}
                  elementRotationOriginX={el.rotationOriginX}
                  elementRotationOriginY={el.rotationOriginY}
                  scale={scale}
                  panX={pan.x}
                  panY={pan.y}
                  onUpdate={({ html, x, y, w, h, rotationOriginX, rotationOriginY }) => {
                    const updates: Partial<CanvasElement> = { html, x: x - fx - groupOffX, y: y - fy - groupOffY, w, h };
                    if (rotationOriginX !== undefined) updates.rotationOriginX = rotationOriginX;
                    if (rotationOriginY !== undefined) updates.rotationOriginY = rotationOriginY;
                    updateElement(el.id, updates);
                    if (activeGroupPath.length > 0) {
                      elementContext.setElements(els => recalcGroupBounds(els, activeGroupPath));
                    }
                  }}
                  onExit={() => {
                    if (activeGroupPath.length > 0) {
                      elementContext.setElements(els => recalcGroupBounds(els, activeGroupPath));
                    }
                    setVectorEditId(null); setVectorSelection(null);
                  }}
                  onSelectionChange={setVectorSelection}
                />
              );
            })()}

            {/* Sub-element editing overlay */}
            {subElementEditId && (() => {
              let el: CanvasElement | undefined;
              let fx = 0, fy = 0;
              for (const page of data.pages) {
                const found = page.elements.find(e => e.id === subElementEditId);
                if (found) {
                  el = found;
                  fx = page.frame_x ?? 0;
                  fy = page.frame_y ?? 0;
                  break;
                }
              }
              if (!el) el = data.elements?.find(e => e.id === subElementEditId);
              if (!el) return null;
              const sr = shadowRootRefs.current.get(subElementEditId);
              if (!sr) return null;
              return (
                <div style={{
                  position: 'absolute',
                  left: (fx + el.x) * scale + pan.x,
                  top: (fy + el.y) * scale + pan.y,
                  width: el.w * scale,
                  height: el.h * scale,
                  pointerEvents: subTextEditing ? 'none' : 'auto',
                  zIndex: 9999,
                }}>
                  <SubElementEditor
                    containerRef={{ current: sr }}
                    offsetX={0}
                    offsetY={0}
                    scale={scale}
                    onSelect={(sel) => {
                      setSubElementSelection(sel);
                      setSubElementPath(sel?.cssPath ?? null);
                    }}
                    onDragMove={handleSubElementDragMove}
                    onDragEnd={handleSubElementDragEnd}
                    onResize={handleSubElementResize}
                    onTextEditChange={setSubTextEditingBoth}
                    onExit={() => {
                      setSubElementEditId(null);
                      setSubElementPath(null);
                      setSubElementSelection(null);
                      setSubTextEditCssPath(null);
                      setSubTextEditRect(null);
                      setSubTextEditingBoth(false);
                    }}
                  />
                </div>
              );
            })()}

            {/* Pen tool overlay */}
            {pendingInsert?.type === 'pen' && (() => {
              const frame = activeFrame;
              const fx = frame?.frame_x ?? 0;
              const fy = frame?.frame_y ?? 0;
              const fw = frame?.width ?? DEFAULT_PAGE_WIDTH;
              const fh = frame?.height ?? DEFAULT_PAGE_HEIGHT;
              const continueId = pendingInsert.continueElementId;

              // Compute open endpoints from frame/canvas SVG elements
              const openEps: OpenEndpoint[] = [];
              if (!continueId) {
                const allEls = frame ? frame.elements : (data?.elements ?? []);
                for (const el of allEls) {
                  if (!el.html.includes('<svg')) continue;
                  const ds = extractAllPathDs(el.html);
                  for (const d of ds) {
                    const parsed = parsePath(d);
                    const subs = parsed.subPaths?.length ? parsed.subPaths : [{ points: parsed.points, closed: parsed.closed }];
                    for (const sub of subs) {
                      if (sub.closed || sub.points.length < 2) continue;
                      const vb = el.html.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
                      const vbX = vb?.[0] ?? 0, vbY = vb?.[1] ?? 0;
                      const vbW = vb?.[2] ?? el.w, vbH = vb?.[3] ?? el.h;
                      const sX = el.w / vbW, sY = el.h / vbH;
                      const first = sub.points[0];
                      const last = sub.points[sub.points.length - 1];
                      openEps.push({
                        elementId: el.id, points: sub.points, end: 'end',
                        canvasX: el.x + (last.x - vbX) * sX,
                        canvasY: el.y + (last.y - vbY) * sY,
                      });
                      openEps.push({
                        elementId: el.id, points: sub.points, end: 'start',
                        canvasX: el.x + (first.x - vbX) * sX,
                        canvasY: el.y + (first.y - vbY) * sY,
                      });
                    }
                  }
                }
              }

              return (
                <PenTool
                  key={continueId ?? 'new'}
                  scale={scale}
                  panX={pan.x}
                  panY={pan.y}
                  frameX={fx}
                  frameY={fy}
                  frameW={fw}
                  frameH={fh}
                  containerRef={containerRef}
                  initialPoints={pendingInsert.initialPoints}
                  appendEnd={pendingInsert.appendEnd}
                  openEndpoints={continueId ? undefined : openEps}
                  onContinueFrom={(ep) => {
                    // Convert points from viewBox coords to canvas coords
                    const el = (frame ? frame.elements : (data?.elements ?? [])).find(e => e.id === ep.elementId);
                    if (!el) return;
                    const vb = el.html.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
                    const vbX = vb?.[0] ?? 0, vbY = vb?.[1] ?? 0;
                    const vbW = vb?.[2] ?? el.w, vbH = vb?.[3] ?? el.h;
                    const sX = el.w / vbW, sY = el.h / vbH;
                    const canvasPoints = ep.points.map(pt => ({
                      ...pt,
                      x: el.x + (pt.x - vbX) * sX,
                      y: el.y + (pt.y - vbY) * sY,
                      handleIn: pt.handleIn ? { x: pt.handleIn.x * sX, y: pt.handleIn.y * sY } : undefined,
                      handleOut: pt.handleOut ? { x: pt.handleOut.x * sX, y: pt.handleOut.y * sY } : undefined,
                    }));
                    const pts = ep.end === 'start' ? [...canvasPoints].reverse() : canvasPoints;
                    setPendingInsert({
                      type: 'pen',
                      continueElementId: ep.elementId,
                      initialPoints: pts,
                      appendEnd: ep.end,
                    });
                  }}
                  onComplete={(html, x, y, w, h) => {
                    setPendingInsert(null);
                    if (continueId) {
                      updateElement(continueId, { html, x, y, w, h });
                      setSelectedIds(new Set([continueId]));
                    } else {
                      const el: CanvasElement = {
                        id: `el-${crypto.randomUUID().slice(0, 8)}`,
                        locked: false, z_index: 1, x, y, w, h, html,
                      };
                      const targetFrame = data?.pages.find(p => p.page_id === activeFrameId);
                      if (targetFrame) {
                        updateFrame(targetFrame.page_id, page => ({ ...page, elements: [...page.elements, el] }));
                      } else {
                        updateData(d => ({ ...d, elements: [...(d.elements ?? []), el] }));
                      }
                      setSelectedIds(new Set([el.id]));
                    }
                  }}
                  onCancel={() => setPendingInsert(null)}
                />
              );
            })()}

            {/* Line draw tool overlay */}
            {pendingInsert?.type === 'line-draw' && (() => {
              const frame = activeFrame;
              const fx = frame?.frame_x ?? 0;
              const fy = frame?.frame_y ?? 0;
              return (
                <LineDrawTool
                  scale={scale}
                  panX={pan.x}
                  panY={pan.y}
                  frameX={fx}
                  frameY={fy}
                  containerRef={containerRef}
                  onComplete={(html, x, y, w, h) => {
                    setPendingInsert(null);
                    const el: CanvasElement = {
                      id: `el-${crypto.randomUUID().slice(0, 8)}`,
                      locked: false, z_index: 1, x, y, w, h, html,
                    };
                    const targetFrame = data?.pages.find(p => p.page_id === activeFrameId);
                    if (targetFrame) {
                      updateFrame(targetFrame.page_id, page => ({ ...page, elements: [...page.elements, el] }));
                    } else {
                      updateData(d => ({ ...d, elements: [...(d.elements ?? []), el] }));
                    }
                    setSelectedIds(new Set([el.id]));
                  }}
                  onCancel={() => setPendingInsert(null)}
                />
              );
            })()}

            {/* Empty state */}
            {data.pages.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-muted-foreground/50">
                  <Frame className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Click "New Frame" to get started</p>
                  <p className="text-xs mt-1">or let AI agents generate content via comments</p>
                </div>
              </div>
            )}

            {/* Marquee selection rect */}
            {marqueeRect && marqueeRect.w > 2 && (
              <div style={{
                position: 'absolute', left: marqueeRect.x, top: marqueeRect.y,
                width: marqueeRect.w, height: marqueeRect.h,
                border: '1px solid #3b82f6', background: 'rgba(59,130,246,0.1)',
                pointerEvents: 'none', zIndex: 30,
              }} />
            )}

            {/* Create preview rectangle while drag-to-create */}
            {createPreview && (
              <div style={{
                position: 'absolute',
                left: pan.x + createPreview.x * scale,
                top: pan.y + createPreview.y * scale,
                width: createPreview.w * scale,
                height: createPreview.h * scale,
                border: '2px solid #3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                pointerEvents: 'none',
                zIndex: 9000,
              }} />
            )}

            {/* Pending insert hint */}
            {pendingInsert && pendingInsert.type !== 'pen' && pendingInsert.type !== 'line-draw' && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium shadow-lg">
                Click or drag on {pendingInsert.type === 'frame' ? 'canvas' : 'a frame'} to place — Esc to cancel
              </div>
            )}
            {pendingInsert?.type === 'pen' && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium shadow-lg">
                Click to add points, click first point to close — Enter to finish, Esc to cancel
              </div>
            )}
            {pendingInsert?.type === 'line-draw' && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium shadow-lg">
                Click & drag to draw a line — hold Shift for angle snap, Esc to cancel
              </div>
            )}

            {/* Layers toggle (top-left, shown when sidebar is hidden) */}
            {!showLayers && (
              <div className="absolute top-3 left-3 z-20" onMouseDown={e => e.stopPropagation()}>
                <button onClick={() => setShowLayers(true)}
                  className="p-2 rounded bg-card/50 backdrop-blur-sm border border-black/10 dark:border-white/10 transition-colors text-muted-foreground hover:text-foreground"
                  title="Show layers">
                  <Layers className="h-4 w-4" />
                </button>
              </div>
            )}

            <ZoomBar zoom={scale} onZoomIn={() => zoomAroundCenter(1.25)} onZoomOut={() => zoomAroundCenter(0.8)} onResetZoom={fitAllFrames} />
            {/* Frame preset panel (overlay) — shown when frame insert mode is active */}
            {pendingInsert?.type === 'frame' && (
              <div className="absolute top-0 right-0 bottom-0 w-[240px] border-l border-border bg-card shadow-lg" style={{ zIndex: 10000 }} onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <FramePresetPanel onSelect={(w, h, _name) => {
                  const pages = data?.pages ?? [];
                  const lastFrame = pages[pages.length - 1];
                  const newX = lastFrame ? (lastFrame.frame_x ?? 0) + lastFrame.width + 100 : 100;
                  const newY = lastFrame ? (lastFrame.frame_y ?? 0) : 100;
                  const newPage = createEmptyPage(pages.length + 1);
                  newPage.frame_x = Math.round(newX);
                  newPage.frame_y = Math.round(newY);
                  newPage.width = w;
                  newPage.height = h;
                  updateData(prev => ({ ...prev, pages: [...prev.pages, newPage] }));
                  setActiveFrameId(newPage.page_id);
                  setSelectedIds(new Set());
                  setPendingInsert(null);
                  fitToRect(newX, newY, w, h);
                }} />
              </div>
            )}
            {/* Property panel (overlay) */}
            {showPropertyPanel && pendingInsert?.type !== 'frame' && (
              <div className="absolute top-0 right-0 bottom-0" data-overlay-scrollable style={{ zIndex: 10000 }} onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                {vectorEditId && vectorSelection ? (() => {
                  return (
                    <VectorPropertyPanel
                      selectionInfo={vectorSelection}
                      onUpdatePoints={(changes: Partial<PathPoint>) => {
                        (window as any).__vectorEditorUpdatePoints?.(changes);
                      }}
                      cornerRadius={vectorSelection.points.length === 1 ? (vectorSelection.points[0].point?.cornerRadius ?? 0) : 0}
                      onCornerRadiusChange={(v) => {
                        (window as any).__vectorEditorApplyCornerRadius?.(v);
                      }}
                      onClose={() => setShowPropertyPanel(false)}
                    />
                  );
                })() : (
                  <CanvasPropertyPanel
                    element={subElementEditId ? (findElementById(subElementEditId) ?? null) : singleSelected}
                    selectedElements={selectedElements.length > 1 ? selectedElements : undefined}
                    frame={activeGroupPath.length > 0 ? null : (frameExplicitlySelected ? activeFrame : null)}
                    selectedCount={selectedIds.size}
                    designTokens={designTokens}
                    subElementSelection={subElementSelection}
                    canvasBackgroundColor={data.background_color}
                    onUpdateElement={updateElement}
                    onUpdateFrame={handleUpdateFrame}
                    onUpdateToken={handleUpdateToken}
                    onUpdateCanvasBackground={(color) => {
                      const newData = { ...data, background_color: color };
                      setData(newData);
                      scheduleSave(newData);
                    }}
                    onClose={() => setShowPropertyPanel(false)}
                    onDelete={deleteSelected}
                    onDuplicate={singleSelected ? () => duplicateElement(singleSelected.id) : undefined}
                    onGroup={selectedIds.size >= 2 ? groupSelected : undefined}
                    onUngroup={singleSelected?.type === 'group' ? ungroupSelected : undefined}
                    onAlign={alignElements}
                    onLock={singleSelected ? () => updateElement(singleSelected.id, { locked: !singleSelected.locked }) : undefined}
                    onBooleanOp={handleBooleanOp}
                    onRenameElement={(id, name) => updateElement(id, { name })}
                    onRenameFrame={(fid, title) => updateFrame(fid, p => ({ ...p, title }))}
                    onDuplicateFrame={duplicateFrame}
                    onDeleteFrame={deleteFrame}
                    onBringForward={bringForward}
                    onSendBackward={sendBackward}
                    onBringToFront={bringToFront}
                    onSendToBack={sendToBack}
                    onMoveSelection={(dx, dy) => {
                      selectedElements.forEach(el => {
                        updateElement(el.id, { x: el.x + dx, y: el.y + dy });
                      });
                    }}
                    onExportPng={hasExportTarget ? handleExportSelectionPng : undefined}
                    onExportSvg={hasExportTarget ? handleExportSelectionSvg : undefined}
                    canExportSvg={canSelectionExportSvg}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showComments && !showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <CommentPanel
            targetType="canvas"
            targetId={contentId}
            anchorType={commentAnchor?.type}
            anchorId={commentAnchor?.id}
            anchorMeta={commentAnchor?.meta}
            onAnchorUsed={() => setCommentAnchor(null)}
            onNavigateToAnchor={navigateToAnchor}
            onClose={onCloseComments}
            focusCommentId={focusCommentId}
          />
        </div>
      )}
      {showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <RevisionHistory
            contentId={contentId}
            contentType="canvas"
            selectedRevisionId={previewRevisionMeta?.id ?? null}
            onClose={() => { setShowRevisions(false); setPreviewRevisionData(null); setPreviewRevisionMeta(null); }}
            onCreateManualVersion={handleCreateManualVersion}
            onSelectRevision={(rev) => {
              if (!rev) { setPreviewRevisionData(null); setPreviewRevisionMeta(null); return; }
              setPreviewRevisionData(rev.data as CanvasData);
              setPreviewRevisionMeta({ id: rev.id, created_at: rev.created_at });
            }}
            onRestore={(revisionData) => {
              setData(revisionData as CanvasData);
              scheduleSave(revisionData as CanvasData);
              setShowRevisions(false);
              setPreviewRevisionData(null);
              setPreviewRevisionMeta(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
