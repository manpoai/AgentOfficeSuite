'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  Plus, Minus, Trash2,
  Lock, Unlock,
  Type, Hexagon, Frame, ImagePlus, FileUp,
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
import { useT } from '@/lib/i18n';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { buildFixedTopBarActionItems, renderFixedTopBarActions } from '@/actions/content-topbar-fixed.actions';
import { buildContentTopBarCommonMenuItems } from '@/actions/content-topbar-common.actions';
import { getPublicOrigin } from '@/lib/remote-access';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { ShapePicker, SHAPE_MAP, type ShapeType } from '@/components/shared/ShapeSet';
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
import { extractPathD, parsePath, serializePath, serializeSubPath, booleanPathOp, convertShapesToPaths, extractAllPathDs, rescaleSvgHtml, type BooleanOp, type PathPoint } from '@/components/shared/svg-path-utils';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';
import { FramePresetPanel } from './FramePresetPanel';
import { SubElementEditor, type SubElementSelection } from '@/components/shared/SubElementEditor';
import { extractDesignTokens, updateDesignToken, applyProjection } from './projection';
import { useUndoRedo } from './use-undo-redo';
import { uploadImageFile, createImageHtml, extractDroppedImageFiles, isSvgFile } from '@/components/shared/image-upload';
import { parseSvgFileContent } from '@/components/shared/svg-import';
import type { CanvasData, CanvasPage, CanvasElement } from './types';
import { createEmptyPage, DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT } from './types';
import { useContextMenu } from '@/lib/hooks/use-context-menu';
import { toContextMenuItems } from '@/surfaces/bridge';
import { buildActionMap } from '@/actions/types';
import { canvasElementActions, type CanvasElementCtx } from '@/actions/canvas-element.actions';
import { canvasFrameActions, type CanvasFrameCtx } from '@/actions/canvas-frame.actions';
import { canvasSurfaces } from '@/surfaces/canvas.surfaces';
import { CanvasFrameExportView } from './CanvasFrameExportView';
import { exportFramePng } from './exportUtils';

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

function measureTextSize(html: string): { w: number; h: number } {
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
  const isAuto = el.getAttribute('data-text-resize') === 'auto';
  if (isAuto) { el.style.width = 'auto'; el.style.whiteSpace = 'nowrap'; }
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
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 24px; font-weight: 400; color: #111827; padding: 4px; box-sizing: border-box; ${isFixedWidth ? 'white-space: normal; word-wrap: break-word;' : 'white-space: nowrap;'}" contenteditable="true" data-text-resize="${isFixedWidth ? 'fixed-width' : 'auto'}"></div>`,
  };
}



function createShapeElement(shapeType: ShapeType, pageW: number, pageH: number): CanvasElement {
  const shapeDef = SHAPE_MAP.get(shapeType);
  if (!shapeDef) return createTextElement(Math.round(pageW / 2 - 50), Math.round(pageH / 2 - 16));
  const scale = 2;
  const w = shapeDef.width * scale, h = shapeDef.height * scale;
  const pathData = shapeDef.renderPath(w, h);
  const defaultRadius = shapeType === 'rounded-rect' ? 8 : 0;
  return {
    id: `el-${crypto.randomUUID().slice(0, 8)}`, locked: false, z_index: 1,
    x: Math.round(pageW / 2 - w / 2), y: Math.round(pageH / 2 - h / 2), w, h,
    html: `<div style="width:100%;height:100%;border-radius:${defaultRadius}px;overflow:hidden;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${w + 2} ${h + 2}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:hidden;border-radius:inherit;"><path d="${pathData}" fill="#e0e7ff" stroke="#374151" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>`,
  };
}

function CanvasToolbar({ pendingInsert, onSetPending, onAddShape, onAddImage, onAddSvg, canUndo, canRedo, onUndo, onRedo }: {
  pendingInsert: PendingInsert | null;
  onSetPending: (p: PendingInsert | null) => void;
  onAddShape: (shapeType: ShapeType) => void;
  onAddImage: () => void;
  onAddSvg: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [showShapes, setShowShapes] = useState(false);
  const isFramePending = pendingInsert?.type === 'frame';
  const isTextPending = pendingInsert?.type === 'text';
  const isShapePending = pendingInsert?.type === 'shape';
  const isPenPending = pendingInsert?.type === 'pen';
  const isLineDrawPending = pendingInsert?.type === 'line-draw';
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-card rounded border border-black/10 dark:border-white/10 px-3 h-10 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]"
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
                  { type: 'rect' as ShapeType, label: 'Rect', labelCn: '矩形' },
                  { type: 'circle' as ShapeType, label: 'Circle', labelCn: '圆形' },
                  { type: 'polygon' as ShapeType, label: 'Polygon', labelCn: '多边形' },
                  { type: 'star' as ShapeType, label: 'Star', labelCn: '星形' },
                ] as { type: ShapeType; label: string; labelCn: string }[]).map(({ type, label, labelCn }) => (
                  <button key={type} onClick={() => { onAddShape(type); setShowShapes(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors text-left">
                    <span className="font-medium">{label}</span>
                    <span className="text-muted-foreground text-[11px]">{labelCn}</span>
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

function ElementToolbar({ element, scale, pan, frameOffset, onDelete, onDuplicate, onLock, onBringForward, onSendBackward, onAlign, selectedCount, onTogglePropertyPanel, canBooleanOp, onBooleanOp }: {
  element: CanvasElement;
  scale: number;
  pan: { x: number; y: number };
  frameOffset: { x: number; y: number };
  onDelete: () => void;
  onDuplicate: () => void;
  onLock: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onAlign: (a: string) => void;
  selectedCount: number;
  onTogglePropertyPanel: () => void;
  canBooleanOp?: boolean;
  onBooleanOp?: (op: BooleanOp) => void;
}) {
  const x = pan.x + (frameOffset.x + element.x) * scale;
  const y = pan.y + (frameOffset.y + element.y) * scale - 44;

  return (
    <div className="absolute z-30 flex items-center gap-0.5 bg-card rounded border border-black/10 dark:border-white/10 px-1.5 h-8 shadow-lg"
      style={{ left: Math.max(4, x), top: Math.max(4, y) }}
      onMouseDown={e => e.stopPropagation()}>
      {selectedCount >= 2 && (
        <>
          <ToolBtnSm icon={AlignStartHorizontal} onClick={() => onAlign('left')} title="Align left" />
          <ToolBtnSm icon={AlignHorizontalJustifyCenter} onClick={() => onAlign('center-h')} title="Center H" />
          <ToolBtnSm icon={AlignEndHorizontal} onClick={() => onAlign('right')} title="Align right" />
          <ToolBtnSm icon={AlignStartVertical} onClick={() => onAlign('top')} title="Align top" />
          <ToolBtnSm icon={AlignVerticalJustifyCenter} onClick={() => onAlign('center-v')} title="Center V" />
          <ToolBtnSm icon={AlignEndVertical} onClick={() => onAlign('bottom')} title="Align bottom" />
          <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />
        </>
      )}
      {canBooleanOp && onBooleanOp && (
        <>
          <ToolBtnSm icon={SquaresUnite} onClick={() => onBooleanOp('union')} title="Union" />
          <ToolBtnSm icon={SquaresSubtract} onClick={() => onBooleanOp('difference')} title="Subtract" />
          <ToolBtnSm icon={SquaresIntersect} onClick={() => onBooleanOp('intersection')} title="Intersect" />
          <ToolBtnSm icon={SquaresExclude} onClick={() => onBooleanOp('exclusion')} title="Exclude" />
          <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />
        </>
      )}
      <ToolBtnSm icon={Copy} onClick={onDuplicate} title="Duplicate" />
      <ToolBtnSm icon={ArrowUp} onClick={onBringForward} title="Bring forward" />
      <ToolBtnSm icon={ArrowDown} onClick={onSendBackward} title="Send backward" />
      <ToolBtnSm icon={element.locked ? Unlock : Lock} onClick={onLock} title={element.locked ? 'Unlock' : 'Lock'} />
      <ToolBtnSm icon={PanelRight} onClick={onTogglePropertyPanel} title="Properties" />
      <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />
      <button onClick={onDelete} className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
        <Trash2 className="h-3.5 w-3.5" />
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
  return 'Element';
}

function SortableLayerItem({ el, frameId, isSelected, onSelect, onRename, onToggleVisible }: {
  el: CanvasElement; frameId: string; isSelected: boolean;
  onSelect: (frameId: string, elementId: string) => void;
  onRename: (elementId: string, name: string) => void;
  onToggleVisible: (elementId: string) => void;
}) {
  const [groupExpanded, setGroupExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const defaultLabel = getElementLabel(el);
  const isGroup = el.type === 'group';
  const isHidden = el.visible === false;
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        className={cn('group flex items-center gap-1 pl-6 pr-1.5 py-0.5 cursor-grab active:cursor-grabbing hover:bg-accent/50 text-[11px]',
          isSelected && 'bg-primary/10 text-primary',
          isHidden && 'opacity-50')}
        onClick={() => onSelect(frameId, el.id)}>
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
        {isGroup ? (groupExpanded ? <FolderOpen className="h-3 w-3 shrink-0" /> : <Folder className="h-3 w-3 shrink-0" />) : null}
        <InlineEdit value={el.name || ''} defaultValue={defaultLabel}
          onSave={(v) => onRename(el.id, v === defaultLabel ? '' : v)} />
        {el.locked && <Lock className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />}
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
              onRename={onRename}
              onToggleVisible={onToggleVisible}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LayerPanel({ data, activeFrameId, selectedIds, onSelectFrame, onSelectElement, onSelectCanvasElement, onClose, onRenameFrame, onRenameElement, onRenameCanvasElement, onReorderElements, onToggleVisible }: {
  data: CanvasData;
  activeFrameId: string | null;
  selectedIds: Set<string>;
  onSelectFrame: (frameId: string) => void;
  onSelectElement: (frameId: string, elementId: string) => void;
  onSelectCanvasElement: (elementId: string) => void;
  onClose: () => void;
  onRenameFrame: (frameId: string, title: string) => void;
  onRenameElement: (frameId: string, elementId: string, name: string) => void;
  onRenameCanvasElement: (elementId: string, name: string) => void;
  onReorderElements: (frameId: string, activeId: string, overId: string) => void;
  onToggleVisible: (elementId: string) => void;
}) {
  const [collapsedFrames, setCollapsedFrames] = useState<Set<string>>(new Set());
  const toggleCollapse = (fid: string) => setCollapsedFrames(prev => {
    const next = new Set(prev);
    if (next.has(fid)) next.delete(fid); else next.add(fid);
    return next;
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  return (
    <div className="w-[200px] min-w-[200px] border-r border-border flex flex-col shrink-0 bg-card overflow-y-auto"
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
              className={cn('flex items-center gap-1 px-3 py-1 cursor-pointer hover:bg-accent/50 text-[11px]',
                !activeFrameId && selectedIds.has(el.id) && 'bg-primary/10 text-primary')}
              onClick={() => onSelectCanvasElement(el.id)}>
              <InlineEdit value={el.name || ''} defaultValue={defaultLabel}
                onSave={(v) => onRenameCanvasElement(el.id, v === defaultLabel ? '' : v)} />
              {el.locked && <Lock className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />}
            </div>
          );
        })}
        {data.pages.map(frame => {
          const isActive = frame.page_id === activeFrameId;
          const collapsed = collapsedFrames.has(frame.page_id);
          const sortedEls = frame.elements.slice().sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0));
          return (
            <div key={frame.page_id}>
              <div className={cn('flex items-center gap-1 px-1.5 py-1 cursor-pointer hover:bg-accent/50 text-[11px]',
                isActive && 'bg-primary/5 text-primary')}
                onClick={() => onSelectFrame(frame.page_id)}>
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
                        onRename={(eid, name) => onRenameElement(frame.page_id, eid, name)}
                        onToggleVisible={onToggleVisible} />
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
  const queryClient = useQueryClient();
  const contentId = `canvas:${canvasId}`;
  const containerRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<CanvasData | null>(null);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(0.5);
  const [pan, setPan] = useState({ x: 100, y: 100 });
  const [saveStatus, setSaveStatus] = useState('');
  const [showRevisions, setShowRevisions] = useState(false);
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
    type: 'move' | 'resize' | 'pan' | 'frame-move' | 'frame-resize' | 'marquee' | 'create';
    elementId?: string; handle?: string;
    frameId?: string;
    groupId?: string;
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number;
    origPanX?: number; origPanY?: number;
    origPositions?: Map<string, { x: number; y: number }>;
    origHtml?: string;
    origChildren?: CanvasElement[];
    createType?: PendingInsert;
  } | null>(null);

  const { data: canvasResp } = useQuery({
    queryKey: ['canvas', canvasId],
    queryFn: () => gw.getCanvas(canvasId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (canvasResp?.data) {
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
      try { await gw.saveCanvas(canvasId, toSave); setSaveStatus('Saved'); setTimeout(() => setSaveStatus(''), 2000); }
      catch (e) { setSaveStatus('Save failed'); showError('Failed to save canvas', e); }
    }, 800);
  }, [canvasId]);

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

  const resolveGroupByPath = useCallback((path: string[] = activeGroupPath): { group: CanvasElement; absX: number; absY: number } | null => {
    if (path.length === 0 || !activeFrameId) return null;
    const frame = data?.pages.find(p => p.page_id === activeFrameId);
    if (!frame) return null;
    let current: CanvasElement | undefined;
    let absX = 0, absY = 0;
    for (let i = 0; i < path.length; i++) {
      const id = path[i];
      if (i === 0) {
        current = frame.elements.find(e => e.id === id);
      } else {
        current = current?.children?.find(c => c.id === id);
      }
      if (!current || current.type !== 'group' || !current.children) return null;
      absX += current.x;
      absY += current.y;
    }
    return current ? { group: current, absX, absY } : null;
  }, [data, activeFrameId, activeGroupPath]);

  const findElementById = useCallback((id: string): CanvasElement | undefined => {
    if (activeGroupPath.length > 0 && activeFrameId) {
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
      const resolved = resolveGroupByPath();
      if (resolved?.group.children) {
        const found = findInChildren(resolved.group.children);
        if (found) return found;
      }
    }
    if (activeFrameId) {
      const frame = data?.pages.find(p => p.page_id === activeFrameId);
      const el = frame?.elements.find(e => e.id === id);
      if (el) return el;
    }
    return data?.elements?.find(e => e.id === id);
  }, [data, activeFrameId, activeGroupPath, resolveGroupByPath]);

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
    if ((groupId || activeGroupPath.length > 0) && activeFrameId) {
      const path = activeGroupPath.length > 0 ? activeGroupPath : [groupId!];
      updateFrame(activeFrameId, page => ({
        ...page, elements: updateNestedChild(page.elements, path, elementId, updates),
      }));
    } else if (activeFrameId) {
      updateFrame(activeFrameId, page => ({
        ...page, elements: page.elements.map(el => el.id === elementId ? { ...el, ...updates } : el),
      }));
    } else {
      updateCanvasElement(elementId, updates);
    }
  }, [updateFrame, activeFrameId, activeGroupPath, updateCanvasElement]);

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
    // Check canvas-level elements (no frame)
    if (data?.elements && findInElements(data.elements, anchor.id)) {
      setActiveFrameId(null);
      setSelectedIds(new Set([anchor.id]));
    }
  }, [data]);

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
      const frame = d.frameId ? data?.pages.find(p => p.page_id === d.frameId) : null;

      if (d.type === 'move' && d.elementId && frame) {
        let newX = Math.round(d.origX + dx), newY = Math.round(d.origY + dy);
        const movingEl = findElementById(d.elementId);
        if (movingEl) {
          const snapTargets = d.groupId ? (resolveGroupByPath()?.group.children ?? frame.elements) : frame.elements;
          const otherRects = snapTargets.filter(el => el.id !== d.elementId);
          const snap = findSnapLines(
            { x: newX, y: newY, w: movingEl.w, h: movingEl.h },
            otherRects, SNAP_THRESHOLD / scale,
            { width: frame.width, height: frame.height },
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
          updateFrame(d.frameId!, page => ({ ...page, elements: page.elements.map(el => {
            if (el.id === d.elementId) return { ...el, x: newX, y: newY };
            if (!selectedIds.has(el.id)) return el;
            const orig = d.origPositions?.get(el.id);
            return orig ? { ...el, x: orig.x + ox, y: orig.y + oy } : el;
          }) }));
        } else { updateElement(d.elementId, { x: newX, y: newY }, d.groupId); }
      } else if (d.type === 'move' && d.elementId && !d.frameId) {
        const newX = Math.round(d.origX + dx), newY = Math.round(d.origY + dy);
        if (selectedIds.size > 1 && selectedIds.has(d.elementId)) {
          const ox = newX - d.origX, oy = newY - d.origY;
          updateData(prev => ({ ...prev, elements: (prev.elements ?? []).map(el => {
            if (el.id === d.elementId) return { ...el, x: newX, y: newY };
            if (!selectedIds.has(el.id)) return el;
            const orig = d.origPositions?.get(el.id);
            return orig ? { ...el, x: orig.x + ox, y: orig.y + oy } : el;
          }) }));
        } else { updateCanvasElement(d.elementId, { x: newX, y: newY }); }
      } else if (d.type === 'resize' && d.handle && d.elementId) {
        let nX = d.origX, nY = d.origY, nW = d.origW, nH = d.origH;
        if (d.handle.includes('e')) nW = Math.max(20, d.origW + dx);
        if (d.handle.includes('w')) { nW = Math.max(20, d.origW - dx); nX = d.origX + d.origW - nW; }
        if (d.handle.includes('s')) nH = Math.max(20, d.origH + dy);
        if (d.handle.includes('n')) { nH = Math.max(20, d.origH - dy); nY = d.origY + d.origH - nH; }
        const updates: Partial<CanvasElement> = { x: Math.round(nX), y: Math.round(nY), w: Math.round(nW), h: Math.round(nH) };
        if (d.origHtml) {
          updates.html = rescaleSvgHtml(d.origHtml, d.origW, d.origH, Math.round(nW), Math.round(nH));
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
        if (d.frameId) {
          updateElement(d.elementId, updates);
        } else {
          updateCanvasElement(d.elementId, updates);
        }
      }
    };
    const handleUp = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (d?.type === 'pan') setIsPanning(false);
      if (d?.type === 'move' && d.elementId && d.frameId && data) {
        const pos2 = getClientPos(e);
        const srcFrame = data.pages.find(p => p.page_id === d.frameId);
        const origEl = srcFrame?.elements.find(e => e.id === d.elementId);
        if (srcFrame && origEl && pos2) {
          const totalDx = (pos2.clientX - d.startX) / scale, totalDy = (pos2.clientY - d.startY) / scale;
          const finalX = Math.round(d.origX + totalDx), finalY = Math.round(d.origY + totalDy);
          const sfx = srcFrame.frame_x ?? 0, sfy = srcFrame.frame_y ?? 0;
          const absX = sfx + finalX, absY = sfy + finalY;
          const absCx = absX + origEl.w / 2, absCy = absY + origEl.h / 2;
          let landed = false;
          for (const tgtFrame of data.pages) {
            if (tgtFrame.page_id === d.frameId) continue;
            const tfx = tgtFrame.frame_x ?? 0, tfy = tgtFrame.frame_y ?? 0;
            if (absCx >= tfx && absCx <= tfx + tgtFrame.width && absCy >= tfy && absCy <= tfy + tgtFrame.height) {
              const movedEl = { ...origEl, x: Math.round(absX - tfx), y: Math.round(absY - tfy) };
              updateData(prev => ({
                ...prev,
                pages: prev.pages.map(p => {
                  if (p.page_id === d.frameId) return { ...p, elements: p.elements.filter(e => e.id !== d.elementId) };
                  if (p.page_id === tgtFrame.page_id) return { ...p, elements: [...p.elements, movedEl] };
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
              const canvasEl = { ...origEl, x: absX, y: absY };
              updateData(prev => ({
                ...prev,
                pages: prev.pages.map(p => p.page_id === d.frameId ? { ...p, elements: p.elements.filter(e => e.id !== d.elementId) } : p),
                elements: [...(prev.elements ?? []), canvasEl],
              }));
              setActiveFrameId(null);
            }
          }
        }
      }
      if (d?.type === 'move' && d.elementId && !d.frameId && data) {
        const pos2 = getClientPos(e);
        const origEl = data.elements?.find(e => e.id === d.elementId);
        if (origEl && pos2) {
          const totalDx = (pos2.clientX - d.startX) / scale, totalDy = (pos2.clientY - d.startY) / scale;
          const finalX = Math.round(d.origX + totalDx), finalY = Math.round(d.origY + totalDy);
          const absCx = finalX + origEl.w / 2, absCy = finalY + origEl.h / 2;
          for (const tgtFrame of data.pages) {
            const tfx = tgtFrame.frame_x ?? 0, tfy = tgtFrame.frame_y ?? 0;
            if (absCx >= tfx && absCx <= tfx + tgtFrame.width && absCy >= tfy && absCy <= tfy + tgtFrame.height) {
              const movedEl = { ...origEl, x: Math.round(finalX - tfx), y: Math.round(finalY - tfy) };
              updateData(prev => ({
                ...prev,
                elements: (prev.elements ?? []).filter(e => e.id !== d.elementId),
                pages: prev.pages.map(p => p.page_id === tgtFrame.page_id ? { ...p, elements: [...p.elements, movedEl] } : p),
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
          const selIds = new Set<string>();
          let hitFrame: string | null = null;
          for (const el of (data.elements ?? []).filter(el => el.visible !== false)) {
            const elScreenX = pan.x + el.x * scale;
            const elScreenY = pan.y + el.y * scale;
            if (elScreenX + el.w * scale > mr.x && elScreenX < mr.x + mr.w &&
                elScreenY + el.h * scale > mr.y && elScreenY < mr.y + mr.h) {
              selIds.add(el.id);
            }
          }
          for (const frame of data.pages) {
            const fx = frame.frame_x ?? 0, fy = frame.frame_y ?? 0;
            for (const el of frame.elements.filter(el => el.visible !== false)) {
              const elScreenX = pan.x + (fx + el.x) * scale;
              const elScreenY = pan.y + (fy + el.y) * scale;
              const elScreenW = el.w * scale;
              const elScreenH = el.h * scale;
              if (elScreenX + elScreenW > mr.x && elScreenX < mr.x + mr.w &&
                  elScreenY + elScreenH > mr.y && elScreenY < mr.y + mr.h) {
                selIds.add(el.id);
                hitFrame = frame.page_id;
              }
            }
          }
          if (selIds.size > 0) {
            setActiveFrameId(hitFrame);
            setSelectedIds(selIds);
          }
        }
        setMarqueeRect(null);
      }
      if (d?.type === 'move' && d.groupId && d.frameId && activeGroupPath.length > 0) {
        updateFrame(d.frameId, page => ({
          ...page,
          elements: recalcGroupBounds(page.elements, activeGroupPath),
        }));
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
        } else {
          elW = d.createType.type === 'frame' ? 1920 : 200;
          elH = d.createType.type === 'frame' ? 1080 : 200;
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
                const pathData = shapeDef.renderPath(Math.round(elW), Math.round(elH));
                const defaultRadius = shapeType === 'rounded-rect' ? 8 : 0;
                el = {
                  id: `el-${crypto.randomUUID().slice(0, 8)}`, locked: false, z_index: 1,
                  x: 0, y: 0, w: Math.round(elW), h: Math.round(elH),
                  html: `<div style="width:100%;height:100%;border-radius:${defaultRadius}px;overflow:hidden;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${Math.round(elW) + 2} ${Math.round(elH) + 2}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:hidden;border-radius:inherit;"><path d="${pathData}" fill="#e0e7ff" stroke="#374151" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>`,
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
      if (d && (d.type === 'move' || d.type === 'resize' || d.type === 'frame-move' || d.type === 'frame-resize') && data) {
        undoRedo.endBatch(data);
      }
      dragRef.current = null; setSnapLines([]);
    };
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false }); window.addEventListener('touchend', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); window.removeEventListener('touchmove', handleMove); window.removeEventListener('touchend', handleUp); };
  }, [scale, updateElement, updateFrame, updateData, selectedIds, data, pan, marqueeRect, undoRedo, screenToCanvas, setPendingInsert]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
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
    if ((e.target as HTMLElement).closest('[data-frame-id]')) {
      // If clicking inside a frame while in group mode, exit group
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

  const handleSelectElement = useCallback((frameId: string, id: string, e: React.MouseEvent | React.TouchEvent) => {
    if (subTextEditingRef.current) return;
    setActiveFrameId(frameId);
    setEditingElementId(null);
    setVectorEditId(null);
    if ('shiftKey' in e && e.shiftKey) {
      setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    } else {
      setSelectedIds(prev => prev.has(id) && prev.size > 1 ? prev : new Set([id]));
    }
  }, []);

  const handleDoubleClick = useCallback((frameId: string, id: string) => {
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

  const handleDragStart = useCallback((frameId: string, id: string, e: React.MouseEvent | React.TouchEvent) => {
    if (editingElementId === id || subTextEditingRef.current) return;
    const frame = data?.pages.find(p => p.page_id === frameId);
    const el = frame?.elements.find(el => el.id === id);
    if (!el || el.locked) return;
    const pos = getClientPos(e); if (!pos) return;
    const origPositions = new Map<string, { x: number; y: number }>();
    if (selectedIds.size > 1 && selectedIds.has(id)) {
      for (const fel of frame.elements) {
        if (selectedIds.has(fel.id)) origPositions.set(fel.id, { x: fel.x, y: fel.y });
      }
    }
    undoRedo.beginBatch();
    dragRef.current = { type: 'move', elementId: id, frameId, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h, origPositions };
  }, [data, editingElementId, selectedIds, undoRedo]);

  const handleResizeStart = useCallback((frameId: string, id: string, handle: string, e: React.MouseEvent | React.TouchEvent) => {
    const el = findElementById(id);
    if (!el) return;
    const pos = getClientPos(e); if (!pos) return;
    const deepCloneChildren = (children: CanvasElement[]): CanvasElement[] =>
      children.map(c => ({ ...c, children: c.children ? deepCloneChildren(c.children) : undefined }));
    undoRedo.beginBatch();
    dragRef.current = { type: 'resize', elementId: id, frameId, handle, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h, origHtml: el.html?.includes('<svg') ? el.html : undefined, origChildren: el.type === 'group' && el.children ? deepCloneChildren(el.children) : undefined };
  }, [findElementById, undoRedo]);

  const handleSelectCanvasElement = useCallback((id: string, e: React.MouseEvent | React.TouchEvent) => {
    setActiveFrameId(null);
    setEditingElementId(null);
    if ('shiftKey' in e && e.shiftKey) {
      setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    } else {
      setSelectedIds(prev => prev.has(id) && prev.size > 1 ? prev : new Set([id]));
    }
  }, []);

  const handleCanvasElDragStart = useCallback((id: string, e: React.MouseEvent | React.TouchEvent) => {
    if (editingElementId === id) return;
    const el = data?.elements?.find(el => el.id === id);
    if (!el || el.locked) return;
    const pos = getClientPos(e); if (!pos) return;
    const origPositions = new Map<string, { x: number; y: number }>();
    if (selectedIds.size > 1 && selectedIds.has(id)) {
      for (const cel of (data?.elements ?? [])) {
        if (selectedIds.has(cel.id)) origPositions.set(cel.id, { x: cel.x, y: cel.y });
      }
    }
    undoRedo.beginBatch();
    dragRef.current = { type: 'move', elementId: id, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h, origPositions };
  }, [data, editingElementId, selectedIds, undoRedo]);

  const handleCanvasElResizeStart = useCallback((id: string, handle: string, e: React.MouseEvent | React.TouchEvent) => {
    const el = data?.elements?.find(el => el.id === id);
    if (!el) return;
    const pos = getClientPos(e); if (!pos) return;
    undoRedo.beginBatch();
    dragRef.current = { type: 'resize', elementId: id, handle, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h, origHtml: el.html.includes('<svg') ? el.html : undefined };
  }, [data, undoRedo]);

  // ─── Clipboard ─────────────────────
  const CLIPBOARD_KEY = 'aose-canvas-clipboard';
  const pasteCountRef = useRef(0);

  const handleCopy = useCallback(() => {
    if (selectedIds.size === 0) return;
    const allEls = activeFrame?.elements ?? data?.elements ?? [];
    const copied = allEls.filter(el => selectedIds.has(el.id));
    if (copied.length === 0) return;
    const payload = JSON.stringify({ type: CLIPBOARD_KEY, elements: copied });
    navigator.clipboard.writeText(payload).catch(() => {});
    pasteCountRef.current = 0;
  }, [selectedIds, activeFrame, data]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      let parsed: { type: string; elements: CanvasElement[] };
      try { parsed = JSON.parse(text); } catch { return; }
      if ((parsed.type !== CLIPBOARD_KEY && parsed.type !== 'aose-video-clipboard') || !Array.isArray(parsed.elements) || parsed.elements.length === 0) return;
      pasteCountRef.current += 1;
      const offset = pasteCountRef.current * 20;
      const newEls = parsed.elements.map(el => ({
        ...el,
        id: `el-${crypto.randomUUID().slice(0, 8)}`,
        x: el.x + offset,
        y: el.y + offset,
      }));
      if (activeFrameId) {
        updateFrame(activeFrameId, page => ({ ...page, elements: [...page.elements, ...newEls] }));
      } else {
        updateData(d => ({ ...d, elements: [...(d.elements ?? []), ...newEls] }));
      }
      setSelectedIds(new Set(newEls.map(el => el.id)));
    } catch {}
  }, [activeFrameId, activeFrame, updateFrame, updateData]);

  const deleteSelected = useCallback(() => {
    if (activeGroupPath.length > 0 && activeFrameId) {
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
      updateFrame(activeFrameId, page => ({
        ...page,
        elements: deleteFromNestedGroup(page.elements, activeGroupPath, selectedIds),
      }));
      setSelectedIds(new Set()); setEditingElementId(null);
      const resolved = resolveGroupByPath();
      if (!resolved || !resolved.group.children || resolved.group.children.filter(c => !selectedIds.has(c.id)).length === 0) {
        setActiveGroupPath(prev => prev.slice(0, -1));
      }
    } else if (activeFrameId) {
      updateFrame(activeFrameId, page => ({ ...page, elements: page.elements.filter(el => !selectedIds.has(el.id)) }));
      setSelectedIds(new Set()); setEditingElementId(null);
    } else {
      updateData(d => ({ ...d, elements: (d.elements ?? []).filter(el => !selectedIds.has(el.id)) }));
      setSelectedIds(new Set()); setEditingElementId(null);
    }
  }, [activeFrameId, activeGroupPath, selectedIds, data, updateFrame, updateData, resolveGroupByPath]);

  const handleCut = useCallback(() => {
    handleCopy();
    deleteSelected();
  }, [handleCopy, deleteSelected]);

  // ─── Group / Ungroup ────────────────
  const groupSelected = useCallback(() => {
    if (selectedIds.size < 2 || !activeFrameId || !data) return;
    const frame = data.pages.find(p => p.page_id === activeFrameId);
    if (!frame) return;
    const selectedEls = frame.elements.filter(el => selectedIds.has(el.id));
    if (selectedEls.length < 2) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of selectedEls) {
      minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.w); maxY = Math.max(maxY, el.y + el.h);
    }
    const children: CanvasElement[] = selectedEls.map(el => ({ ...el, x: el.x - minX, y: el.y - minY }));
    const group: CanvasElement = {
      id: crypto.randomUUID(), type: 'group', html: '',
      x: minX, y: minY, w: maxX - minX, h: maxY - minY,
      z_index: Math.max(...selectedEls.map(el => el.z_index ?? 0)),
      children,
    };
    updateFrame(activeFrameId, page => ({
      ...page,
      elements: [...page.elements.filter(el => !selectedIds.has(el.id)), group],
    }));
    setSelectedIds(new Set([group.id]));
  }, [selectedIds, activeFrameId, data, updateFrame]);

  const ungroupSelected = useCallback(() => {
    if (selectedIds.size !== 1 || !activeFrameId || !data) return;
    const id = Array.from(selectedIds)[0];
    const frame = data.pages.find(p => p.page_id === activeFrameId);
    const group = frame?.elements.find(el => el.id === id);
    if (!group || group.type !== 'group' || !group.children) return;
    const children = group.children.map(child => ({ ...child, x: child.x + group.x, y: child.y + group.y }));
    updateFrame(activeFrameId, page => ({
      ...page,
      elements: [...page.elements.filter(el => el.id !== id), ...children],
    }));
    setSelectedIds(new Set(children.map(c => c.id)));
  }, [selectedIds, activeFrameId, data, updateFrame]);

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
        if (activeFrame) setSelectedIds(new Set(activeFrame.elements.map(el => el.id)));
        else if (data?.elements?.length) setSelectedIds(new Set(data.elements.map(el => el.id)));
      }
      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleCopy(); }
      if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handlePaste(); }
      if (e.key === 'x' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleCut(); }
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert(null); return; }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'shape', shapeType: 'rect' }); return; }
      if (e.key === 'o' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'shape', shapeType: 'circle' }); return; }
      if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'frame' }); return; }
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setPendingInsert({ type: 'line-draw' }); return; }
      if (e.key === 'Escape') { if (pendingInsert) { setPendingInsert(null); setCreatePreview(null); return; } if (activeGroupId) { setActiveGroupPath(prev => prev.slice(0, -1)); setSelectedIds(new Set()); return; } setSelectedIds(new Set()); setEditingElementId(null); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, activeFrame, editingElementId, vectorEditId, subElementEditId, handleUndo, handleRedo, pendingInsert, handleCopy, handlePaste, handleCut, groupSelected, ungroupSelected]);

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
    const el = activeFrameId
      ? activeFrame?.elements.find(e => e.id === id)
      : data?.elements?.find(e => e.id === id);
    if (!el) return;
    const newEl = { ...el, id: `el-${crypto.randomUUID().slice(0, 8)}`, x: el.x + 20, y: el.y + 20 };
    if (activeFrameId) {
      updateFrame(activeFrameId, page => ({ ...page, elements: [...page.elements, newEl] }));
    } else {
      updateData(d => ({ ...d, elements: [...(d.elements ?? []), newEl] }));
    }
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

  const insertImageElement = useCallback((url: string, name?: string) => {
    const target = getTargetFrame();
    if (!target) return;
    const newEl: CanvasElement = {
      id: `el-${crypto.randomUUID().slice(0, 8)}`,
      x: target.frame.width / 2 - 150, y: target.frame.height / 2 - 100,
      w: 300, h: 200,
      html: createImageHtml(url),
      locked: false, z_index: target.frame.elements.length + 1,
      name: name ?? 'Image',
    };
    updateFrame(target.frameId, page => ({ ...page, elements: [...page.elements, newEl] }));
    setSelectedIds(new Set([newEl.id]));
  }, [getTargetFrame, updateFrame]);

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

  const handleImageFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isSvgFile(file)) {
      const text = await file.text();
      const parsed = parseSvgFileContent(text);
      insertSvgElement(parsed, file.name.replace(/\.[^.]+$/, ''));
    } else {
      try {
        const url = await uploadImageFile(file);
        insertImageElement(url, file.name.replace(/\.[^.]+$/, ''));
      } catch (err) {
        showError('Failed to upload image', err);
      }
    }
    e.target.value = '';
  }, [insertImageElement, insertSvgElement]);

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
        try {
          const url = await uploadImageFile(file);
          insertImageElement(url, file.name.replace(/\.[^.]+$/, ''));
        } catch (err) {
          showError('Failed to upload image', err);
        }
      }
    }
  }, [insertImageElement, insertSvgElement]);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const bringForward = useCallback((id: string) => {
    const el = activeFrameId ? activeFrame?.elements.find(e => e.id === id) : data?.elements?.find(e => e.id === id);
    updateElement(id, { z_index: (el?.z_index ?? 0) + 1 });
  }, [activeFrameId, activeFrame, data, updateElement]);

  const sendBackward = useCallback((id: string) => {
    const el = activeFrameId ? activeFrame?.elements.find(e => e.id === id) : data?.elements?.find(e => e.id === id);
    updateElement(id, { z_index: Math.max(0, (el?.z_index ?? 0) - 1) });
  }, [activeFrameId, activeFrame, data, updateElement]);

  const bringToFront = useCallback((id: string) => {
    const elements = activeFrame?.elements ?? data?.elements ?? [];
    const maxZ = Math.max(0, ...elements.map(e => e.z_index ?? 0));
    updateElement(id, { z_index: maxZ + 1 });
  }, [activeFrame, data, updateElement]);

  const sendToBack = useCallback((id: string) => {
    const elements = activeFrame?.elements ?? data?.elements ?? [];
    if (!activeFrameId) { updateElement(id, { z_index: 0 }); return; }
    updateFrame(activeFrameId, page => {
      const others = page.elements.filter(e => e.id !== id);
      const bumped = others.map(e => ({ ...e, z_index: (e.z_index ?? 0) + 1 }));
      return { ...page, elements: [...bumped, { ...page.elements.find(e => e.id === id)!, z_index: 0 }] };
    });
  }, [activeFrame, data, activeFrameId, updateElement, updateFrame]);

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
    };
    const surface = selectedIds.size > 1 ? canvasSurfaces.multiMenu : canvasSurfaces.elementMenu;
    return toContextMenuItems(surface, canvasElementActionMap, ctx, t);
  }, [selectedIds, findElementById, handleCut, handleCopy, handlePaste, deleteSelected,
      duplicateElement, bringToFront, bringForward, sendBackward, sendToBack,
      groupSelected, ungroupSelected, toggleLock, canvasElementActionMap, t, onShowComments]);

  const { onContextMenu: onElementContextMenu } = useContextMenu(getElementMenuItems);

  const getFrameMenuItems = useCallback((frameId: string) => () => {
    const ctx: CanvasFrameCtx = {
      frameId,
      renameFrame,
      duplicateFrame,
      deleteFrame,
      exportFramePng: handleExportFramePng,
    };
    return toContextMenuItems(canvasSurfaces.frameMenu, canvasFrameActionMap, ctx, t);
  }, [renameFrame, duplicateFrame, deleteFrame, handleExportFramePng, canvasFrameActionMap, t]);

  const alignElements = (alignment: string) => {
    if (selectedIds.size < 2 || !activeFrame || !activeFrameId) return;
    const selected = activeFrame.elements.filter(el => selectedIds.has(el.id));
    if (selected.length < 2) return;
    updateFrame(activeFrameId, page => ({
      ...page, elements: page.elements.map(el => {
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
      }),
    }));
  };

  const handleBooleanOp = useCallback(async (op: BooleanOp) => {
    if (selectedIds.size !== 2) return;
    const elements = activeFrameId
      ? (activeFrame?.elements.filter(el => selectedIds.has(el.id)) ?? [])
      : (data?.elements ?? []).filter(el => selectedIds.has(el.id));
    if (elements.length !== 2) return;
    const sorted = [...elements].sort((x, y) => x.z_index - y.z_index);
    const [a, b] = sorted;
    const dA = extractPathD(a.html);
    const dB = extractPathD(b.html);
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

      const fillA = a.html.match(/fill="([^"]*)"/)?.[1] ?? '#e0e7ff';
      const fill = fillA === 'none' ? '#e0e7ff' : fillA;
      const html = `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rw} ${rh}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${shiftedD}" fill="${fill}" stroke="#374151" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>`;

      const newEl: CanvasElement = {
        id: `el-${crypto.randomUUID().slice(0, 8)}`,
        locked: false, z_index: Math.max(a.z_index, b.z_index), x: rx, y: ry, w: rw, h: rh, html,
      };

      if (activeFrameId) {
        updateFrame(activeFrameId, page => ({
          ...page,
          elements: [...page.elements.filter(el => !selectedIds.has(el.id)), newEl],
        }));
      } else {
        updateData(d => ({
          ...d,
          elements: [...(d.elements ?? []).filter(el => !selectedIds.has(el.id)), newEl],
        }));
      }
      setSelectedIds(new Set([newEl.id]));
    } catch (err) {
      console.error('Boolean operation failed:', err);
    }
  }, [selectedIds, activeFrameId, activeFrame, data, updateFrame, updateData]);

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
            onHistory={() => setShowRevisions(v => !v)} onComments={onToggleComments} />
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Layers sidebar */}
          {showLayers && data && (
            <LayerPanel data={data} activeFrameId={activeFrameId} selectedIds={selectedIds}
              onSelectFrame={(fid) => { setActiveFrameId(fid); setSelectedIds(new Set()); }}
              onSelectElement={(fid, eid) => { setActiveFrameId(fid); setSelectedIds(new Set([eid])); }}
              onSelectCanvasElement={(eid) => { setActiveFrameId(null); setSelectedIds(new Set([eid])); }}
              onClose={() => setShowLayers(false)}
              onRenameFrame={(fid, title) => updateFrame(fid, p => ({ ...p, title }))}
              onRenameElement={(fid, eid, name) => updateFrame(fid, p => ({ ...p, elements: p.elements.map(e => e.id === eid ? { ...e, name } : e) }))}
              onRenameCanvasElement={(eid, name) => updateCanvasElement(eid, { name })}
              onReorderElements={reorderElements}
              onToggleVisible={toggleElementVisible}
            />
          )}

          {/* Infinite canvas viewport */}
          <div className="flex-1 min-w-0 overflow-hidden bg-[#e8e8e8] dark:bg-zinc-900 relative"
            ref={containerRef} onMouseDown={handleCanvasPointerDown}
            onDrop={handleCanvasDrop} onDragOver={handleCanvasDragOver}
            style={{ touchAction: 'none', cursor: isPanning ? 'grabbing' : pendingInsert ? 'crosshair' : 'default' }}>

            <CanvasToolbar
              pendingInsert={pendingInsert}
              onSetPending={setPendingInsert}
              onAddShape={addShapeFromPicker}
              onAddImage={handleAddImage}
              onAddSvg={handleAddSvg}
              canUndo={undoRedo.canUndo} canRedo={undoRedo.canRedo}
              onUndo={handleUndo} onRedo={handleRedo}
            />
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileSelected} />
            <input ref={svgInputRef} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={handleSvgFileSelected} />


            {/* All frames rendered on infinite canvas */}
            {data.pages.map(frame => {
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
                      {frame.elements.slice().sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)).map(el => (
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
                        const resolved = resolveGroupByPath();
                        if (!resolved?.group.children) return null;
                        return resolved.group.children.map(child => {
                          const absChild = { ...child, x: resolved.absX + child.x, y: resolved.absY + child.y };
                          return (
                            <CanvasElementView key={`group-child-${child.id}`} element={absChild}
                              selected={selectedIds.has(child.id)} scale={scale}
                              hovered={hoveredId === child.id}
                              editing={editingElementId === child.id}
                              onSelect={(id, e) => handleSelectElement(frame.page_id, id, e)}
                              onDragStart={(id, e) => {
                                const pos = getClientPos(e); if (!pos) return;
                                dragRef.current = { type: 'move', elementId: id, frameId: frame.page_id, groupId: activeGroupId!, startX: pos.clientX, startY: pos.clientY, origX: child.x, origY: child.y, origW: absChild.w, origH: absChild.h };
                              }}
                              onResizeStart={(id, handle, e) => handleResizeStart(frame.page_id, id, handle, e)}
                              onDoubleClick={(id) => handleDoubleClick(frame.page_id, id)}
                              onShadowRootReady={(id, sr) => shadowRootRefs.current.set(id, sr)}
                              onMouseEnter={(id) => setHoveredId(id)}
                              onMouseLeave={(id) => { if (hoveredId === id) setHoveredId(null); }} />
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* Frame resize handles + size label when frame is active and no element selected */}
                  {isActive && selectedIds.size === 0 && (
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
            {(data.elements ?? []).slice().sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)).map(el => {
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
                      selected={!activeFrameId && selectedIds.has(el.id) && subElementEditId !== el.id} scale={scale}
                      hovered={hoveredId === el.id && !subElementEditId}
                      editing={editingElementId === el.id}
                      onSelect={(id, e) => handleSelectCanvasElement(id, e)}
                      onDragStart={(id, e) => handleCanvasElDragStart(id, e)}
                      onResizeStart={(id, handle, e) => handleCanvasElResizeStart(id, handle, e)}
                      onShadowRootReady={(id, sr) => shadowRootRefs.current.set(id, sr)}
                      onMouseEnter={() => setHoveredId(el.id)}
                      onMouseLeave={() => { if (hoveredId === el.id) setHoveredId(null); }}
                      onContextMenu={(id, e) => {
                        if (!selectedIds.has(id)) {
                          setActiveFrameId(null);
                          setSelectedIds(new Set([id]));
                        }
                        onElementContextMenu(e);
                      }}
                      onDoubleClick={(id) => {
                        setActiveFrameId(null);
                        const el = data.elements?.find(e => e.id === id);
                        if (!el) return;
                        if (el.html.includes('<svg')) {
                          const converted = convertShapesToPaths(el.html);
                          if (extractAllPathDs(converted).length > 0) {
                            if (converted !== el.html) updateCanvasElement(id, { html: converted });
                            setVectorEditId(id);
                            return;
                          }
                        }
                        const tmp = document.createElement('div');
                        tmp.innerHTML = el.html;
                        const root = tmp.firstElementChild;
                        if (root && root.children.length > 0 && !el.html.includes('contenteditable')) {
                          setSubElementEditId(id);
                          return;
                        }
                        setEditingElementId(id);
                      }} />
                  </div>
                </div>
              );
            })}

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
                    const size = measureTextSize(html);
                    const isAutoWidth = html.includes('data-text-resize="auto"');
                    const updates: Partial<CanvasElement> = { html };
                    if (isAutoWidth) {
                      updates.w = size.w;
                      updates.h = size.h;
                    } else {
                      updates.h = size.h;
                    }
                    if (isInFrame) updateElement(el.id, updates);
                    else updateCanvasElement(el.id, updates);
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
                  scale={scale}
                  panX={pan.x}
                  panY={pan.y}
                  onUpdate={({ html, x, y, w, h }) => {
                    const updates = { html, x: x - fx - groupOffX, y: y - fy - groupOffY, w, h };
                    if (isInFrame) updateElement(el.id, updates);
                    else updateCanvasElement(el.id, updates);
                  }}
                  onExit={() => { setVectorEditId(null); setVectorSelection(null); }}
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
              <div className="absolute top-0 right-0 bottom-0 w-[220px] bg-background border-l overflow-y-auto" style={{ zIndex: 10000 }} onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
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
            {showPropertyPanel && (
              <div className="absolute top-0 right-0 bottom-0" style={{ zIndex: 10000 }} onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
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
                    frame={activeFrame}
                    selectedCount={selectedIds.size}
                    designTokens={designTokens}
                    subElementSelection={subElementSelection}
                    onUpdateElement={updateElement}
                    onUpdateFrame={handleUpdateFrame}
                    onUpdateToken={handleUpdateToken}
                    onClose={() => setShowPropertyPanel(false)}
                    onDelete={deleteSelected}
                    onDuplicate={singleSelected ? () => duplicateElement(singleSelected.id) : undefined}
                    onGroup={selectedIds.size >= 2 ? groupSelected : undefined}
                    onUngroup={singleSelected?.type === 'group' ? ungroupSelected : undefined}
                    onAlign={alignElements}
                    onLock={singleSelected ? () => updateElement(singleSelected.id, { locked: !singleSelected.locked }) : undefined}
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
            anchorType={singleSelected ? 'element' : undefined}
            anchorId={singleSelected?.id}
            anchorMeta={singleSelected ? { node_label: singleSelected.name || getElementLabel(singleSelected) } : undefined}
            onNavigateToAnchor={navigateToAnchor}
            onClose={onCloseComments}
            focusCommentId={focusCommentId}
          />
        </div>
      )}
      {showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <RevisionHistory contentId={contentId} contentType="canvas" onClose={() => setShowRevisions(false)}
            onCreateManualVersion={handleCreateManualVersion}
            onRestore={(revisionData) => { setData(revisionData as CanvasData); scheduleSave(revisionData as CanvasData); setShowRevisions(false); }} />
        </div>
      )}
    </div>
  );
}
