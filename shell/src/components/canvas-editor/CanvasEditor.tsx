'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  Plus, Minus, Trash2,
  Lock, Unlock,
  Type, Hexagon, Frame,
  AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter,
  AlignStartHorizontal, AlignEndHorizontal, AlignStartVertical, AlignEndVertical,
  PanelRight, PanelRightClose, Copy, ArrowUp, ArrowDown,
  Undo2, Redo2, X,
  Layers, ChevronDown, ChevronRight,
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
import { CanvasElementView, EditingOverlay, getClientPos } from './CanvasElement';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';
import { extractDesignTokens, updateDesignToken } from './projection';
import { useUndoRedo } from './use-undo-redo';
import type { CanvasData, CanvasPage, CanvasElement } from './types';
import { createEmptyPage, DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT } from './types';

type PendingInsert = { type: 'text' } | { type: 'line' } | { type: 'shape'; shapeType: ShapeType } | { type: 'frame' };

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

interface SnapLine { orientation: 'h' | 'v'; position: number; }

function findSnapLines(
  movingEl: { x: number; y: number; w: number; h: number },
  otherElements: CanvasElement[], threshold: number,
): { snapX: number | null; snapY: number | null; lines: SnapLine[] } {
  let snapX: number | null = null, snapY: number | null = null;
  const lines: SnapLine[] = [];
  const me = { left: movingEl.x, right: movingEl.x + movingEl.w, cx: movingEl.x + movingEl.w / 2, top: movingEl.y, bottom: movingEl.y + movingEl.h, cy: movingEl.y + movingEl.h / 2 };
  let bestDx = threshold + 1, bestDy = threshold + 1;
  for (const el of otherElements) {
    const e = { left: el.x, right: el.x + el.w, cx: el.x + el.w / 2, top: el.y, bottom: el.y + el.h, cy: el.y + el.h / 2 };
    for (const [mv, tgt] of [[me.left, e.left], [me.left, e.right], [me.right, e.left], [me.right, e.right], [me.cx, e.cx]] as [number, number][]) {
      const d = Math.abs(mv - tgt); if (d < threshold && d < bestDx) { bestDx = d; snapX = movingEl.x + (tgt - mv); lines.push({ orientation: 'v', position: tgt }); }
    }
    for (const [mv, tgt] of [[me.top, e.top], [me.top, e.bottom], [me.bottom, e.top], [me.bottom, e.bottom], [me.cy, e.cy]] as [number, number][]) {
      const d = Math.abs(mv - tgt); if (d < threshold && d < bestDy) { bestDy = d; snapY = movingEl.y + (tgt - mv); lines.push({ orientation: 'h', position: tgt }); }
    }
  }
  return { snapX, snapY, lines };
}

function createTextElement(pageW: number, pageH: number): CanvasElement {
  return {
    id: `el-${crypto.randomUUID().slice(0, 8)}`, locked: false, z_index: 1,
    x: pageW / 2 - 200, y: pageH / 2 - 40, w: 400, h: 80,
    html: "<div style='font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 24px; font-weight: 600; color: #111827; padding: 16px; height: 100%; box-sizing: border-box; display: flex; align-items: center;' contenteditable='true'>Double-click to edit</div>",
  };
}


function createLineElement(pageW: number, pageH: number): CanvasElement {
  return {
    id: `el-${crypto.randomUUID().slice(0, 8)}`, locked: false, z_index: 1,
    x: pageW / 2 - 150, y: pageH / 2, w: 300, h: 4,
    html: "<div style='width:100%;height:100%;background:#374151;border-radius:2px;'></div>",
  };
}

function createShapeElement(shapeType: ShapeType, pageW: number, pageH: number): CanvasElement {
  const shapeDef = SHAPE_MAP.get(shapeType);
  if (!shapeDef) return createTextElement(pageW, pageH);
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

function CanvasToolbar({ pendingInsert, onSetPending, onAddShape, showPropertyPanel, onTogglePropertyPanel, canUndo, canRedo, onUndo, onRedo }: {
  pendingInsert: PendingInsert | null;
  onSetPending: (p: PendingInsert | null) => void;
  onAddShape: (shapeType: ShapeType) => void;
  showPropertyPanel: boolean;
  onTogglePropertyPanel: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [showShapes, setShowShapes] = useState(false);
  const isFramePending = pendingInsert?.type === 'frame';
  const isTextPending = pendingInsert?.type === 'text';
  const isLinePending = pendingInsert?.type === 'line';
  const isShapePending = pendingInsert?.type === 'shape';
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-card rounded border border-black/10 dark:border-white/10 px-3 h-10 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]"
      onMouseDown={e => e.stopPropagation()}>
      <ToolBtn icon={Frame} onClick={() => onSetPending(isFramePending ? null : { type: 'frame' })} active={isFramePending} title="New Frame (click canvas to place)" />
      <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
      <div className="relative">
        <ToolBtn icon={Hexagon} onClick={() => setShowShapes(v => !v)} active={showShapes || isShapePending} title="Shapes" />
        {showShapes && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowShapes(false)} />
            <div className="absolute top-full left-0 mt-2 z-50">
              <ShapePicker onSelect={(type) => { onAddShape(type); setShowShapes(false); }} columns={6} />
            </div>
          </>
        )}
      </div>
      <ToolBtn icon={Minus} onClick={() => onSetPending(isLinePending ? null : { type: 'line' })} active={isLinePending} title="Line (click frame to place)" />
      <ToolBtn icon={Type} onClick={() => onSetPending(isTextPending ? null : { type: 'text' })} active={isTextPending} title="Text (click frame to place)" />
      <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
      <button onClick={onUndo} disabled={!canUndo}
        className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" title="Undo (⌘Z)">
        <Undo2 className="h-4 w-4" />
      </button>
      <button onClick={onRedo} disabled={!canRedo}
        className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" title="Redo (⌘⇧Z)">
        <Redo2 className="h-4 w-4" />
      </button>
      <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
      <button onClick={onTogglePropertyPanel}
        className={cn('p-1.5 rounded transition-colors', showPropertyPanel ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
        title={showPropertyPanel ? 'Hide properties' : 'Show properties'}>
        {showPropertyPanel ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
      </button>
    </div>
  );
}

function ElementToolbar({ element, scale, pan, frameOffset, onDelete, onDuplicate, onLock, onBringForward, onSendBackward, onAlign, selectedCount, onTogglePropertyPanel }: {
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

function getElementLabel(html: string): string {
  if (html.includes('<svg')) return 'Shape';
  if (html.includes('<img')) return 'Image';
  if (html.includes('contenteditable')) return 'Text';
  return 'Element';
}

function SortableLayerItem({ el, frameId, isSelected, onSelect, onRename }: {
  el: CanvasElement; frameId: string; isSelected: boolean;
  onSelect: (frameId: string, elementId: string) => void;
  onRename: (elementId: string, name: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const defaultLabel = getElementLabel(el.html);
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={cn('flex items-center gap-1 pl-6 pr-1.5 py-0.5 cursor-grab active:cursor-grabbing hover:bg-accent/50 text-[11px]',
        isSelected && 'bg-primary/10 text-primary')}
      onClick={() => onSelect(frameId, el.id)}>
      <InlineEdit value={el.name || ''} defaultValue={defaultLabel}
        onSave={(v) => onRename(el.id, v === defaultLabel ? '' : v)} />
      {el.locked && <Lock className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />}
    </div>
  );
}

function LayerPanel({ data, activeFrameId, selectedIds, onSelectFrame, onSelectElement, onSelectCanvasElement, onClose, onRenameFrame, onRenameElement, onRenameCanvasElement, onReorderElements }: {
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
          const defaultLabel = el.html.includes('<svg') ? 'Shape' : el.html.includes('<img') ? 'Image' : 'Element';
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
                        onRename={(eid, name) => onRenameElement(frame.page_id, eid, name)} />
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(0.5);
  const [pan, setPan] = useState({ x: 100, y: 100 });
  const [saveStatus, setSaveStatus] = useState('');
  const [showRevisions, setShowRevisions] = useState(false);
  const [showPropertyPanel, setShowPropertyPanel] = useState(false);
  const [showLayers, setShowLayers] = useState(true);
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [isPanning, setIsPanning] = useState(false);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [editingFrameName, setEditingFrameName] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const undoRedo = useUndoRedo<CanvasData | null>(null);

  const dragRef = useRef<{
    type: 'move' | 'resize' | 'pan' | 'frame-move' | 'marquee';
    elementId?: string; handle?: string;
    frameId?: string;
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number;
    origPanX?: number; origPanY?: number;
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

  const updateElement = useCallback((elementId: string, updates: Partial<CanvasElement>) => {
    if (activeFrameId) {
      updateFrame(activeFrameId, page => ({
        ...page, elements: page.elements.map(el => el.id === elementId ? { ...el, ...updates } : el),
      }));
    } else {
      updateCanvasElement(elementId, updates);
    }
  }, [updateFrame, activeFrameId, updateCanvasElement]);

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

  const handleUndo = useCallback(() => {
    const prev = undoRedo.undo();
    if (prev) { setData(prev); scheduleSave(prev); }
  }, [undoRedo, scheduleSave]);

  const handleRedo = useCallback(() => {
    const next = undoRedo.redo();
    if (next) { setData(next); scheduleSave(next); }
  }, [undoRedo, scheduleSave]);

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

      if (d.type === 'frame-move' && d.frameId) {
        const dx = (pos.clientX - d.startX) / scale, dy = (pos.clientY - d.startY) / scale;
        updateFrame(d.frameId, page => ({ ...page, frame_x: Math.round(d.origX + dx), frame_y: Math.round(d.origY + dy) }));
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
        const movingEl = frame.elements.find(el => el.id === d.elementId);
        if (movingEl) {
          const snap = findSnapLines({ x: newX, y: newY, w: movingEl.w, h: movingEl.h },
            frame.elements.filter(el => el.id !== d.elementId), SNAP_THRESHOLD / scale);
          if (snap.snapX !== null) newX = snap.snapX;
          if (snap.snapY !== null) newY = snap.snapY;
          setSnapLines(snap.lines);
        }
        if (selectedIds.size > 1 && selectedIds.has(d.elementId)) {
          const ox = newX - d.origX, oy = newY - d.origY;
          updateFrame(d.frameId!, page => ({ ...page, elements: page.elements.map(el => {
            if (el.id === d.elementId) return { ...el, x: newX, y: newY };
            if (!selectedIds.has(el.id)) return el;
            const orig = frame.elements.find(o => o.id === el.id);
            return orig ? { ...el, x: orig.x + ox, y: orig.y + oy } : el;
          }) }));
        } else { updateElement(d.elementId, { x: newX, y: newY }); }
      } else if (d.type === 'move' && d.elementId && !d.frameId) {
        const newX = Math.round(d.origX + dx), newY = Math.round(d.origY + dy);
        if (selectedIds.size > 1 && selectedIds.has(d.elementId)) {
          const ox = newX - d.origX, oy = newY - d.origY;
          const canvasEls = data?.elements ?? [];
          updateData(prev => ({ ...prev, elements: (prev.elements ?? []).map(el => {
            if (el.id === d.elementId) return { ...el, x: newX, y: newY };
            if (!selectedIds.has(el.id)) return el;
            const orig = canvasEls.find(o => o.id === el.id);
            return orig ? { ...el, x: orig.x + ox, y: orig.y + oy } : el;
          }) }));
        } else { updateCanvasElement(d.elementId, { x: newX, y: newY }); }
      } else if (d.type === 'resize' && d.handle && d.elementId) {
        let nX = d.origX, nY = d.origY, nW = d.origW, nH = d.origH;
        if (d.handle.includes('e')) nW = Math.max(20, d.origW + dx);
        if (d.handle.includes('w')) { nW = Math.max(20, d.origW - dx); nX = d.origX + d.origW - nW; }
        if (d.handle.includes('s')) nH = Math.max(20, d.origH + dy);
        if (d.handle.includes('n')) { nH = Math.max(20, d.origH - dy); nY = d.origY + d.origH - nH; }
        if (d.frameId) {
          updateElement(d.elementId, { x: Math.round(nX), y: Math.round(nY), w: Math.round(nW), h: Math.round(nH) });
        } else {
          updateCanvasElement(d.elementId, { x: Math.round(nX), y: Math.round(nY), w: Math.round(nW), h: Math.round(nH) });
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
          for (const el of (data.elements ?? [])) {
            const elScreenX = pan.x + el.x * scale;
            const elScreenY = pan.y + el.y * scale;
            if (elScreenX + el.w * scale > mr.x && elScreenX < mr.x + mr.w &&
                elScreenY + el.h * scale > mr.y && elScreenY < mr.y + mr.h) {
              selIds.add(el.id);
            }
          }
          for (const frame of data.pages) {
            const fx = frame.frame_x ?? 0, fy = frame.frame_y ?? 0;
            for (const el of frame.elements) {
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
      dragRef.current = null; setSnapLines([]);
    };
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false }); window.addEventListener('touchend', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); window.removeEventListener('touchmove', handleMove); window.removeEventListener('touchend', handleUp); };
  }, [scale, updateElement, updateFrame, updateData, selectedIds, data, pan, marqueeRect]);

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

  const handleCanvasPointerDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault(); setIsPanning(true);
      dragRef.current = { type: 'pan', startX: e.clientX, startY: e.clientY, origX: 0, origY: 0, origW: 0, origH: 0, origPanX: pan.x, origPanY: pan.y };
      return;
    }
    if (pendingInsert && e.button === 0) {
      const { cx, cy } = screenToCanvas(e.clientX, e.clientY);
      if (!data) return;
      if (pendingInsert.type === 'frame') {
        const newPage = createEmptyPage(data.pages.length + 1);
        newPage.frame_x = cx;
        newPage.frame_y = cy;
        updateData(d => ({ ...d, pages: [...d.pages, newPage] }));
        setActiveFrameId(newPage.page_id);
        setSelectedIds(new Set());
        setPendingInsert(null);
      } else {
        const frame = findFrameAtPoint(cx, cy);
        let el: CanvasElement;
        if (pendingInsert.type === 'text') {
          el = createTextElement(1920, 1080);
        } else if (pendingInsert.type === 'line') {
          el = createLineElement(1920, 1080);
        } else {
          el = createShapeElement(pendingInsert.shapeType, 1920, 1080);
        }
        if (frame) {
          const fx = frame.frame_x ?? 0, fy = frame.frame_y ?? 0;
          const localX = cx - fx, localY = cy - fy;
          el.x = Math.round(localX - el.w / 2); el.y = Math.round(localY - el.h / 2);
          setActiveFrameId(frame.page_id);
          updateFrame(frame.page_id, page => ({ ...page, elements: [...page.elements, el] }));
        } else {
          el.x = Math.round(cx - el.w / 2); el.y = Math.round(cy - el.h / 2);
          updateData(d => ({ ...d, elements: [...(d.elements ?? []), el] }));
          setActiveFrameId(null);
        }
        setSelectedIds(new Set([el.id]));
        setPendingInsert(null);
      }
      return;
    }
    if ((e.target as HTMLElement).closest('[data-frame-id]')) return;
    setSelectedIds(new Set()); setEditingElementId(null); setActiveFrameId(null);
    if (e.button === 0 && !pendingInsert) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        dragRef.current = {
          type: 'marquee', startX: e.clientX, startY: e.clientY,
          origX: e.clientX - rect.left, origY: e.clientY - rect.top, origW: 0, origH: 0,
        };
      }
    }
  }, [pan, pendingInsert, screenToCanvas, findFrameAtPoint, data, updateData, updateFrame]);

  const handleFrameClick = useCallback((frameId: string, e: React.MouseEvent) => {
    if (pendingInsert && pendingInsert.type !== 'frame') {
      const frame = data?.pages.find(p => p.page_id === frameId);
      if (!frame) return;
      const { cx, cy } = screenToCanvas(e.clientX, e.clientY);
      const fx = frame.frame_x ?? 0, fy = frame.frame_y ?? 0;
      const localX = cx - fx, localY = cy - fy;
      let el: CanvasElement;
      if (pendingInsert.type === 'text') {
        el = createTextElement(frame.width, frame.height);
        el.x = Math.round(localX - el.w / 2); el.y = Math.round(localY - el.h / 2);
      } else if (pendingInsert.type === 'line') {
        el = createLineElement(frame.width, frame.height);
        el.x = Math.round(localX - el.w / 2); el.y = Math.round(localY);
      } else {
        el = createShapeElement(pendingInsert.shapeType, frame.width, frame.height);
        el.x = Math.round(localX - el.w / 2); el.y = Math.round(localY - el.h / 2);
      }
      setActiveFrameId(frameId);
      updateFrame(frameId, page => ({ ...page, elements: [...page.elements, el] }));
      setSelectedIds(new Set([el.id]));
      setPendingInsert(null);
      return;
    }
    setActiveFrameId(frameId);
    if ((e.target as HTMLElement).closest('[data-element-id]')) return;
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
  }, [pendingInsert, data, screenToCanvas, updateFrame]);

  const handleFrameNameMouseDown = useCallback((frameId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveFrameId(frameId);
    setSelectedIds(new Set());
    setEditingElementId(null);
    const frame = data?.pages.find(p => p.page_id === frameId);
    if (!frame) return;
    dragRef.current = {
      type: 'frame-move', frameId,
      startX: e.clientX, startY: e.clientY,
      origX: frame.frame_x ?? 0, origY: frame.frame_y ?? 0,
      origW: 0, origH: 0,
    };
  }, [data]);

  const handleSelectElement = useCallback((frameId: string, id: string, e: React.MouseEvent | React.TouchEvent) => {
    setActiveFrameId(frameId);
    setEditingElementId(null);
    if ('shiftKey' in e && e.shiftKey) {
      setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    } else {
      setSelectedIds(prev => prev.has(id) && prev.size > 1 ? prev : new Set([id]));
    }
  }, []);

  const handleDoubleClick = useCallback((_frameId: string, id: string) => {
    setEditingElementId(id);
  }, []);

  const handleDragStart = useCallback((frameId: string, id: string, e: React.MouseEvent | React.TouchEvent) => {
    if (editingElementId === id) return;
    const frame = data?.pages.find(p => p.page_id === frameId);
    const el = frame?.elements.find(el => el.id === id);
    if (!el || el.locked) return;
    const pos = getClientPos(e); if (!pos) return;
    dragRef.current = { type: 'move', elementId: id, frameId, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h };
  }, [data, editingElementId]);

  const handleResizeStart = useCallback((frameId: string, id: string, handle: string, e: React.MouseEvent | React.TouchEvent) => {
    const frame = data?.pages.find(p => p.page_id === frameId);
    const el = frame?.elements.find(el => el.id === id);
    if (!el) return;
    const pos = getClientPos(e); if (!pos) return;
    dragRef.current = { type: 'resize', elementId: id, frameId, handle, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h };
  }, [data]);

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
    dragRef.current = { type: 'move', elementId: id, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h };
  }, [data, editingElementId]);

  const handleCanvasElResizeStart = useCallback((id: string, handle: string, e: React.MouseEvent | React.TouchEvent) => {
    const el = data?.elements?.find(el => el.id === id);
    if (!el) return;
    const pos = getClientPos(e); if (!pos) return;
    dragRef.current = { type: 'resize', elementId: id, handle, startX: pos.clientX, startY: pos.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h };
  }, [data]);

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
      if (parsed.type !== CLIPBOARD_KEY || !Array.isArray(parsed.elements) || parsed.elements.length === 0) return;
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

  const handleCut = useCallback(() => {
    handleCopy();
    deleteSelected();
  }, [handleCopy, deleteSelected]);

  // ─── Keyboard ─────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingElementId) return;
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,[contenteditable]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) { e.preventDefault(); deleteSelected(); }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (activeFrame) setSelectedIds(new Set(activeFrame.elements.map(el => el.id)));
        else if (data?.elements?.length) setSelectedIds(new Set(data.elements.map(el => el.id)));
      }
      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleCopy(); }
      if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handlePaste(); }
      if (e.key === 'x' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleCut(); }
      if (e.key === 'Escape') { if (pendingInsert) { setPendingInsert(null); return; } setSelectedIds(new Set()); setEditingElementId(null); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, activeFrame, editingElementId, handleUndo, handleRedo, pendingInsert, handleCopy, handlePaste, handleCut]);

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

  const deleteSelected = () => {
    if (activeFrameId) {
      updateFrame(activeFrameId, page => ({ ...page, elements: page.elements.filter(el => !selectedIds.has(el.id)) }));
    } else {
      updateData(d => ({ ...d, elements: (d.elements ?? []).filter(el => !selectedIds.has(el.id)) }));
    }
    setSelectedIds(new Set()); setEditingElementId(null);
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

  const bringForward = (id: string) => {
    const el = activeFrameId ? activeFrame?.elements.find(e => e.id === id) : data?.elements?.find(e => e.id === id);
    updateElement(id, { z_index: (el?.z_index ?? 0) + 1 });
  };
  const sendBackward = (id: string) => {
    const el = activeFrameId ? activeFrame?.elements.find(e => e.id === id) : data?.elements?.find(e => e.id === id);
    updateElement(id, { z_index: Math.max(0, (el?.z_index ?? 0) - 1) });
  };

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

  const selectedElements = activeFrameId
    ? (activeFrame?.elements.filter(el => selectedIds.has(el.id)) ?? [])
    : (data.elements ?? []).filter(el => selectedIds.has(el.id));
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
            />
          )}

          {/* Infinite canvas viewport */}
          <div className="flex-1 min-w-0 overflow-hidden bg-[#e8e8e8] dark:bg-zinc-900 relative"
            ref={containerRef} onMouseDown={handleCanvasPointerDown}
            style={{ touchAction: 'none', cursor: isPanning ? 'grabbing' : pendingInsert ? 'crosshair' : 'default' }}>

            <CanvasToolbar
              pendingInsert={pendingInsert}
              onSetPending={setPendingInsert}
              onAddShape={addShapeFromPicker}
              showPropertyPanel={showPropertyPanel}
              onTogglePropertyPanel={togglePropertyPanel}
              canUndo={undoRedo.canUndo} canRedo={undoRedo.canRedo}
              onUndo={handleUndo} onRedo={handleRedo}
            />

            {firstSelected && selectedIds.size > 0 && !editingElementId && (
              <ElementToolbar
                element={firstSelected}
                scale={scale} pan={pan}
                frameOffset={activeFrame ? { x: activeFrame.frame_x ?? 0, y: activeFrame.frame_y ?? 0 } : { x: 0, y: 0 }}
                onDelete={deleteSelected}
                onDuplicate={() => singleSelected && duplicateElement(singleSelected.id)}
                onLock={() => singleSelected && updateElement(singleSelected.id, { locked: !singleSelected.locked })}
                onBringForward={() => singleSelected && bringForward(singleSelected.id)}
                onSendBackward={() => singleSelected && sendBackward(singleSelected.id)}
                onAlign={alignElements}
                selectedCount={selectedIds.size}
                onTogglePropertyPanel={() => { setShowPropertyPanel(true); }}
              />
            )}

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
                      backgroundSize: 'cover',
                      boxShadow: isActive ? '0 0 0 2px #3b82f6, 0 2px 20px rgba(0,0,0,0.1)' : '0 2px 20px rgba(0,0,0,0.1)',
                      borderRadius: frame.border_radius ?? 2,
                      overflow: 'hidden',
                      position: 'relative',
                    }}>
                      {/* Snap lines (only for active frame) */}
                      {isActive && snapLines.map((line, i) => (
                        <div key={i} style={{ position: 'absolute', background: '#3b82f6', opacity: 0.5, zIndex: 9999,
                          ...(line.orientation === 'v' ? { left: line.position, top: 0, width: 1, height: frame.height } : { left: 0, top: line.position, width: frame.width, height: 1 }) }} />
                      ))}
                      {frame.elements.slice().sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)).map(el => (
                        <CanvasElementView key={el.id} element={el}
                          selected={isActive && selectedIds.has(el.id)} scale={scale}
                          editing={editingElementId === el.id}
                          onSelect={(id, e) => handleSelectElement(frame.page_id, id, e)}
                          onDragStart={(id, e) => handleDragStart(frame.page_id, id, e)}
                          onResizeStart={(id, handle, e) => handleResizeStart(frame.page_id, id, handle, e)}
                          onDoubleClick={(id) => handleDoubleClick(frame.page_id, id)} />
                      ))}
                    </div>
                  </div>
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
                      selected={!activeFrameId && selectedIds.has(el.id)} scale={scale}
                      editing={editingElementId === el.id}
                      onSelect={(id, e) => handleSelectCanvasElement(id, e)}
                      onDragStart={(id, e) => handleCanvasElDragStart(id, e)}
                      onResizeStart={(id, handle, e) => handleCanvasElResizeStart(id, handle, e)}
                      onDoubleClick={(id) => { setActiveFrameId(null); setEditingElementId(id); }} />
                  </div>
                </div>
              );
            })}

            {/* Editing overlay */}
            {editingElementId && (() => {
              const frameEl = activeFrame?.elements.find(e => e.id === editingElementId);
              const canvasEl = data.elements?.find(e => e.id === editingElementId);
              const el = frameEl || canvasEl;
              if (!el) return null;
              const fx = frameEl ? (activeFrame?.frame_x ?? 0) : 0;
              const fy = frameEl ? (activeFrame?.frame_y ?? 0) : 0;
              const elPanX = frameEl ? pan.x + fx * scale : pan.x;
              const elPanY = frameEl ? pan.y + fy * scale : pan.y;
              return (
                <EditingOverlay
                  key={editingElementId}
                  element={el}
                  scale={scale}
                  panX={elPanX}
                  panY={elPanY}
                  onHtmlChange={(html) => {
                    if (frameEl) updateElement(el.id, { html });
                    else updateCanvasElement(el.id, { html });
                  }}
                  onDone={() => setEditingElementId(null)}
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

            {/* Pending insert hint */}
            {pendingInsert && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium shadow-lg">
                Click on {pendingInsert.type === 'frame' ? 'canvas' : 'a frame'} to place — Esc to cancel
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
            {/* Property panel (overlay) */}
            {showPropertyPanel && (
              <div className="absolute top-0 right-0 bottom-0 z-20" onMouseDown={e => e.stopPropagation()}>
                <CanvasPropertyPanel
                  element={singleSelected}
                  selectedElements={selectedElements.length > 1 ? selectedElements : undefined}
                  frame={activeFrame}
                  selectedCount={selectedIds.size}
                  designTokens={designTokens}
                  onUpdateElement={updateElement}
                  onUpdateFrame={handleUpdateFrame}
                  onUpdateToken={handleUpdateToken}
                  onClose={() => setShowPropertyPanel(false)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {showComments && !showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <CommentPanel targetType="canvas" targetId={contentId} onClose={onCloseComments} focusCommentId={focusCommentId} />
        </div>
      )}
      {showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <RevisionHistory contentId={contentId} contentType="canvas" onClose={() => setShowRevisions(false)}
            onRestore={(revisionData) => { setData(revisionData as CanvasData); scheduleSave(revisionData as CanvasData); setShowRevisions(false); }} />
        </div>
      )}
    </div>
  );
}
