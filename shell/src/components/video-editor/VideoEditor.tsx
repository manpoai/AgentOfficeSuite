'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  Plus, Minus, Trash2, Play, Pause, SkipBack, SkipForward,
  Type, Minus as LineIcon, ChevronDown, ChevronRight,
  Undo2, Redo2, X, Settings, Copy, Diamond, Ban,
  ArrowUp, ArrowDown, Lock, Unlock, Hexagon, ImagePlus,
  Eye, EyeOff, Download,
} from 'lucide-react';
import { exportVideoToBlob, downloadExport } from './videoExport';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT } from '@/lib/i18n';
import { readFileAsDataUrl, extractDroppedImageFiles, isSvgFile } from '@/components/shared/image-upload';
import { parseSvgFileContent } from '@/components/shared/svg-import';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { buildFixedTopBarActionItems, renderFixedTopBarActions } from '@/actions/content-topbar-fixed.actions';
import { buildContentTopBarCommonMenuItems } from '@/actions/content-topbar-common.actions';
import { getPublicOrigin } from '@/lib/remote-access';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { ShapePicker, SHAPE_MAP, type ShapeType } from '@/components/shared/ShapeSet';
import { useUndoRedo } from '../canvas-editor/use-undo-redo';
import type { VideoData, VideoElement, AnimatableProperty, EasingPreset, PropertyChangeOutcome } from './types';
import {
  SIZE_PRESETS, EASING_PRESETS,
  DEFAULT_VIDEO_WIDTH, DEFAULT_VIDEO_HEIGHT, DEFAULT_FPS,
  TIME_EPSILON,
  computeTotalDuration, migrateVideoData,
  getElementSnapshotAt, getMarkers,
  addMarker as addMarkerToElement, removeMarker as removeMarkerFromElement,
  applyPropertyChange, applyPostAnimationIntent,
  isPropertyAnimated, isOnMarker,
  removeKeyframe as removeKeyframeFromElement,
  clearAnimation as clearAnimationOnProp,
  upsertKeyframe,
} from './types';

// ─── Shared UI Components (matching Canvas style) ────

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isNone = !value || value === 'none';
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground w-14 shrink-0">{label}</label>
      <div className="flex items-center gap-1 flex-1">
        {isNone ? (
          <button onClick={() => onChange('#000000')} className="w-6 h-6 rounded border border-dashed border-muted-foreground/30 flex items-center justify-center" title="Set color">
            <Ban className="h-3 w-3 text-muted-foreground/40" />
          </button>
        ) : (
          <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-6 h-6 rounded border cursor-pointer" />
        )}
        <input type="text" value={isNone ? '' : value} onChange={e => onChange(e.target.value || 'none')}
          className="flex-1 text-[11px] px-1.5 py-1 rounded border bg-background font-mono" placeholder="none" />
        {!isNone && <button onClick={() => onChange('none')} className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground"><X className="h-3 w-3" /></button>}
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground w-14 shrink-0">{label}</label>
      <input type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="flex-1 text-[11px] px-1.5 py-1 rounded border bg-background font-mono" />
    </div>
  );
}

/** Timeline track label cell. Carries the layer-panel responsibilities that
 *  Canvas keeps in a separate Layers sidebar: visibility toggle, lock toggle,
 *  inline rename, z-index reorder. */
function TrackLabel({
  el, isHidden, isLocked, canMoveUp, canMoveDown,
  hasAnimation, expanded,
  onToggleExpanded,
  onToggleVisible, onToggleLock, onRename, onMoveUp, onMoveDown,
}: {
  el: VideoElement;
  isHidden: boolean;
  isLocked: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  hasAnimation: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onRename: (name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div className="w-[200px] shrink-0 px-2 flex items-center gap-1 truncate text-xs">
      {/* Expand/collapse chevron — only enabled when the element has any
          animated property worth expanding to. */}
      <button
        className={cn('p-0.5 shrink-0 text-muted-foreground hover:text-foreground', !hasAnimation && 'opacity-20')}
        disabled={!hasAnimation}
        onClick={(e) => { e.stopPropagation(); onToggleExpanded(); }}
        title={hasAnimation ? (expanded ? 'Collapse' : 'Expand to per-property keyframes') : 'No animations'}>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      <button
        className="p-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
        title={isHidden ? 'Show element' : 'Hide element'}>
        {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>
      <button
        className={cn('p-0.5 shrink-0', isLocked ? 'text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground')}
        onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
        title={isLocked ? 'Unlock element' : 'Lock element'}>
        {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
      </button>
      {el.type === 'text' ? <Type className="w-3 h-3 shrink-0 text-muted-foreground" /> : <Hexagon className="w-3 h-3 shrink-0 text-muted-foreground" />}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { onRename(draft); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onRename(draft); setEditing(false); }
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={e => e.stopPropagation()}
          className="flex-1 min-w-0 text-xs px-1 py-0.5 rounded border bg-background"
        />
      ) : (
        <span
          className="truncate flex-1 cursor-text"
          onDoubleClick={(e) => { e.stopPropagation(); setDraft(el.name ?? el.type ?? ''); setEditing(true); }}
          title="Double-click to rename">
          {el.name ?? el.type ?? 'element'}
        </span>
      )}
      <button
        disabled={!canMoveUp}
        className="p-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-20"
        onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
        title="Bring forward (higher z-index)">
        <ArrowUp className="w-3 h-3" />
      </button>
      <button
        disabled={!canMoveDown}
        className="p-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-20"
        onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
        title="Send backward (lower z-index)">
        <ArrowDown className="w-3 h-3" />
      </button>
    </div>
  );
}

/** Animatable property field — number input plus an animation-state indicator
 *  and a right-click "Remove animation" affordance. The visible value is the
 *  interpolated snapshot at the current playhead, so changes feel direct. */
function AnimatableField({
  label, prop, value, min, max, step = 1,
  element, playheadLocal,
  onChange, onRemoveAnimation,
}: {
  label: string;
  prop: import('./types').AnimatableProperty;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  element: VideoElement;
  playheadLocal: number;
  onChange: (prop: import('./types').AnimatableProperty, v: number) => void;
  onRemoveAnimation: (prop: import('./types').AnimatableProperty) => void;
}) {
  const animated = isPropertyAnimated(element, prop);
  // Has THIS property got a keyframe at the current playhead?
  const propKfs = element.keyframes?.[prop] ?? [];
  const onPropKf = propKfs.some(k => Math.abs(k.t - playheadLocal) <= TIME_EPSILON);
  const onMarker = isOnMarker(element, playheadLocal);

  return (
    <div className="flex items-center gap-2 group"
      onContextMenu={e => {
        if (!animated) return;
        e.preventDefault();
        if (window.confirm(`Remove animation from ${label}? This deletes all ${label} keyframes (the static value at t=0 is preserved).`)) {
          onRemoveAnimation(prop);
        }
      }}
      title={animated ? `Right-click to remove ${label} animation` : undefined}
    >
      <label className="text-[11px] text-muted-foreground w-14 shrink-0">{label}</label>
      <input type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step}
        onChange={e => onChange(prop, parseFloat(e.target.value) || 0)}
        className={cn(
          'flex-1 text-[11px] px-1.5 py-1 rounded border bg-background font-mono',
          animated && 'border-yellow-500/40',
        )} />
      {animated && (
        <span
          className={cn(
            'w-2.5 h-2.5 rotate-45 border shrink-0',
            onPropKf ? 'bg-yellow-400 border-yellow-600' : 'border-yellow-500/60',
          )}
          title={onPropKf
            ? `Keyframe at ${playheadLocal.toFixed(2)}s`
            : (onMarker ? `Marker at ${playheadLocal.toFixed(2)}s (no kf for ${label} yet)` : 'Animated, between keyframes')}
        />
      )}
    </div>
  );
}

function SelectInput({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground w-14 shrink-0">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="flex-1 text-[11px] px-1.5 py-1 rounded border bg-background">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SectionHeader({ children, collapsed, onToggle }: { children: React.ReactNode; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div className={cn("px-3 py-1.5 border-b border-border", onToggle && "cursor-pointer hover:bg-accent/50")} onClick={onToggle}>
      <div className="flex items-center gap-1">
        {onToggle && (collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />)}
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{children}</span>
      </div>
    </div>
  );
}

// ─── Toolbar Button (matching Canvas) ────

function ToolBtn({ icon: Icon, onClick, active, title, disabled, className: cls }: {
  icon: React.ComponentType<{ className?: string }>; onClick?: () => void; active?: boolean; title?: string; disabled?: boolean; className?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={cn("p-1.5 rounded-md transition-colors", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent", disabled && "opacity-30 pointer-events-none", cls)}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ─── Resize Handles ────

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const HANDLE_POS: Record<string, { top: string; left: string }> = {
  nw: { top: '0', left: '0' }, n: { top: '0', left: '50%' }, ne: { top: '0', left: '100%' },
  e: { top: '50%', left: '100%' }, se: { top: '100%', left: '100%' }, s: { top: '100%', left: '50%' },
  sw: { top: '100%', left: '0' }, w: { top: '50%', left: '0' },
};
const HANDLE_CURSORS: Record<string, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

// ─── HTML projection helpers ────

function extractProp(html: string, prop: string): string {
  const re = new RegExp(`${prop}\\s*:\\s*([^;"\\']+)`);
  const m = html.match(re);
  return m?.[1]?.trim() ?? '';
}

function setStyleProp(html: string, prop: string, value: string): string {
  const re = new RegExp(`(${prop}\\s*:\\s*)([^;"\\']+)`);
  if (re.test(html)) return html.replace(re, `$1${value}`);
  return html.replace(/style="/, `style="${prop}:${value};`);
}

// ─── Stable HTML renderer (prevents CSS animation restart during playback) ────

const StableHtml = memo(function StableHtml({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prevHtml = useRef('');
  useEffect(() => {
    if (ref.current && html !== prevHtml.current) {
      ref.current.innerHTML = html;
      prevHtml.current = html;
    }
  }, [html]);
  return <div ref={ref} className="w-full h-full pointer-events-none" />;
});

// ─── Main Editor ────

interface VideoEditorProps {
  videoId: string;
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

const DEFAULT_DATA: VideoData = {
  elements: [],
  settings: { width: DEFAULT_VIDEO_WIDTH, height: DEFAULT_VIDEO_HEIGHT, fps: DEFAULT_FPS, background_color: '#000000' },
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

function buildShapeHtml(shapeType: ShapeType): string {
  const shapeDef = SHAPE_MAP.get(shapeType);
  if (!shapeDef) return '<div style="width:100%;height:100%;background:#3b82f6;border-radius:8px;"></div>';
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="${shapeDef.renderPath(100, 100)}" fill="#3b82f6" stroke="none" /></svg>`;
}

export function VideoEditor({
  videoId, breadcrumb, onBack, onDeleted, onCopyLink,
  docListVisible, onToggleDocList, onNavigate,
  focusCommentId, showComments, onShowComments, onCloseComments, onToggleComments,
  isPinned, onTogglePin,
}: VideoEditorProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const contentId = `video:${videoId}`;

  const [data, setData] = useState<VideoData | null>(null);
  const [title, setTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [showRevisions, setShowRevisions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShapes, setShowShapes] = useState(false);

  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedMarkerTime, setSelectedMarkerTime] = useState<number | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // Pending post-animation-interval intent dialog. When the dispatcher returns
  // 'needs-intent', we stash the payload here and surface a modal that lets the
  // user choose between "modify last keyframe" and "add new keyframe at playhead".
  const [pendingIntent, setPendingIntent] = useState<{
    elementId: string;
    prop: AnimatableProperty;
    value: number;
    lastKeyframeTime: number;
    playheadLocal: number;
  } | null>(null);

  // Export state.
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Timeline tracks expanded into per-property sub-rows.
  const [expandedTracks, setExpandedTracks] = useState<Set<string>>(new Set());
  const toggleTrackExpanded = useCallback((id: string) => {
    setExpandedTracks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const animFrameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.5);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const undoRedo = useUndoRedo<VideoData>(DEFAULT_DATA);

  // ─── Data Loading ─────────────────────
  const { data: videoResp } = useQuery({
    queryKey: ['video', videoId],
    queryFn: () => gw.getVideo(videoId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (videoResp) {
      const d = migrateVideoData(videoResp.data ?? DEFAULT_DATA);
      setData(d);
      undoRedo.reset(d);
    }
  }, [videoResp]);

  useEffect(() => {
    gw.listContentItems?.().then((items: any[]) => {
      const item = items.find((i: any) => i.id === videoId || i.content_id === videoId);
      if (item?.title) setTitle(item.title);
    }).catch(() => {});
  }, [videoId]);

  // ─── Save ─────────────────────────────
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<VideoData | null>(null);

  const scheduleSave = useCallback((newData: VideoData) => {
    pendingDataRef.current = newData;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const toSave = pendingDataRef.current;
      if (!toSave) return;
      pendingDataRef.current = null;
      setSaveStatus('Saving...');
      try {
        await gw.saveVideo(videoId, toSave);
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(''), 2000);
      } catch (e) { setSaveStatus('Save failed'); showError('Failed to save video', e); }
    }, 800);
  }, [videoId]);

  const updateData = useCallback((updater: (prev: VideoData) => VideoData) => {
    setData(prev => {
      if (!prev) return prev;
      const next = updater(prev);
      undoRedo.push(next);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null; }
      const toSave = pendingDataRef.current;
      if (toSave) { pendingDataRef.current = null; gw.saveVideo(videoId, toSave).catch(() => {}); }
    };
  }, [videoId]);

  const handleUndo = useCallback(() => { const prev = undoRedo.undo(); if (prev) { setData(prev); scheduleSave(prev); } }, [undoRedo, scheduleSave]);
  const handleRedo = useCallback(() => { const next = undoRedo.redo(); if (next) { setData(next); scheduleSave(next); } }, [undoRedo, scheduleSave]);

  // ─── Derived State ────────────────────
  const totalDuration = useMemo(() => data ? computeTotalDuration(data.elements) : 10, [data]);
  const timelineDuration = Math.max(totalDuration + 2, 10);
  const selectedElement = data?.elements.find(el => el.id === selectedElementId) ?? null;

  // ─── Element CRUD ─────────────────────
  const updateElement = useCallback((elementId: string, updates: Partial<VideoElement>) => {
    updateData(d => ({ ...d, elements: d.elements.map(el => el.id === elementId ? { ...el, ...updates } : el) }));
  }, [updateData]);

  const addTextElement = useCallback(() => {
    if (!data) return;
    const s = data.settings;
    const newEl: VideoElement = {
      id: crypto.randomUUID(), type: 'text',
      x: s.width / 2 - 150, y: s.height / 2 - 40, w: 300, h: 80,
      html: '<div style="font-size:48px;color:#ffffff;font-family:sans-serif;font-weight:bold;text-align:center;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">Text</div>',
      start: currentTime, duration: 3, z_index: data.elements.length + 1, name: 'Text',
    };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
    setSelectedMarkerTime(null);
  }, [data, currentTime, updateData]);

  const addShapeElement = useCallback((shapeType: ShapeType) => {
    if (!data) return;
    const s = data.settings;
    const newEl: VideoElement = {
      id: crypto.randomUUID(), type: 'shape',
      x: s.width / 2 - 75, y: s.height / 2 - 75, w: 150, h: 150,
      html: buildShapeHtml(shapeType),
      start: currentTime, duration: 3, z_index: data.elements.length + 1,
      name: SHAPE_MAP.get(shapeType)?.label ?? 'Shape',
    };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
    setShowShapes(false);
  }, [data, currentTime, updateData]);

  const addLineElement = useCallback(() => {
    if (!data) return;
    const s = data.settings;
    const newEl: VideoElement = {
      id: crypto.randomUUID(), type: 'shape',
      x: s.width / 2 - 100, y: s.height / 2 - 2, w: 200, h: 4,
      html: '<div style="width:100%;height:100%;background:#3b82f6;"></div>',
      start: currentTime, duration: 3, z_index: data.elements.length + 1, name: 'Line',
    };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
  }, [data, currentTime, updateData]);

  const insertImageFromFile = useCallback(async (file: File) => {
    if (!data) return;
    let html: string, w = 300, h = 200, elType: 'image' | 'shape' = 'image';
    if (isSvgFile(file)) {
      const text = await file.text();
      const parsed = parseSvgFileContent(text);
      html = parsed.html; w = parsed.w; h = parsed.h; elType = 'shape';
    } else {
      const dataUrl = await readFileAsDataUrl(file);
      html = `<div style="width:100%;height:100%;border-radius:0;overflow:hidden;"><img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`;
    }
    const newEl: VideoElement = {
      id: crypto.randomUUID(), type: elType,
      x: data.settings.width / 2 - w / 2, y: data.settings.height / 2 - h / 2, w, h,
      html, start: currentTime, duration: 3,
      z_index: data.elements.length + 1, name: file.name.replace(/\.[^.]+$/, ''),
    };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
  }, [data, currentTime, updateData]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    insertImageFromFile(file);
    e.target.value = '';
  }, [insertImageFromFile]);

  const handleVideoDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = extractDroppedImageFiles(e.nativeEvent);
    for (const file of files) await insertImageFromFile(file);
  }, [insertImageFromFile]);

  const handleVideoDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const deleteElement = useCallback((elementId: string) => {
    updateData(d => ({ ...d, elements: d.elements.filter(el => el.id !== elementId) }));
    if (selectedElementId === elementId) { setSelectedElementId(null); setSelectedMarkerTime(null); }
  }, [updateData, selectedElementId]);

  const duplicateElement = useCallback((elementId: string) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const newEl: VideoElement = { ...el, id: crypto.randomUUID(), x: el.x + 20, y: el.y + 20, name: `${el.name ?? el.type} copy` };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
  }, [data, updateData]);

  // ─── Marker Management ────────────────
  /** Add an empty marker on the given element at the current playhead (element-local). */
  const addMarkerAtPlayhead = useCallback((elementId: string) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const relTime = currentTime - el.start;
    if (relTime < TIME_EPSILON || relTime > el.duration) return;
    const updated = addMarkerToElement(el, relTime);
    if (updated === el) return;
    updateData(d => ({ ...d, elements: d.elements.map(e => e.id === elementId ? updated : e) }));
    setSelectedMarkerTime(relTime);
  }, [data, currentTime, updateData]);

  /** Remove a marker (cascades any property keyframes at that time). */
  const deleteMarker = useCallback((elementId: string, t: number) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const updated = removeMarkerFromElement(el, t);
    updateData(d => ({ ...d, elements: d.elements.map(e => e.id === elementId ? updated : e) }));
    if (selectedMarkerTime != null && Math.abs(selectedMarkerTime - t) <= TIME_EPSILON) {
      setSelectedMarkerTime(null);
    }
  }, [data, updateData, selectedMarkerTime]);

  /** Single entry-point for all property panel writes that touch animatable
   *  properties (X/Y/W/H/Opacity/Scale/Rotation). Routes through the §3 rule
   *  table; opens the intent dialog when needed. */
  const changeAnimatableProperty = useCallback((elementId: string, prop: AnimatableProperty, value: number) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const playheadLocal = currentTime - el.start;
    const outcome: PropertyChangeOutcome = applyPropertyChange(el, prop, value, playheadLocal);

    switch (outcome.kind) {
      case 'rejected':
        // Out of lifespan — silently drop. (Phase 4 will surface a toast +
        // "extend lifespan" affordance.)
        return;
      case 'static':
      case 'updated':
      case 'animated':
      case 'auto-bend':
        updateData(d => ({
          ...d,
          elements: d.elements.map(e => e.id === elementId ? outcome.element : e),
        }));
        return;
      case 'needs-intent':
        setPendingIntent({
          elementId,
          prop: outcome.prop,
          value: outcome.value,
          lastKeyframeTime: outcome.lastKeyframeTime,
          playheadLocal: outcome.playheadLocal,
        });
        return;
    }
  }, [data, currentTime, updateData]);

  /** User picked an option in the intent dialog. */
  const resolveIntent = useCallback((intent: 'modify-last' | 'add-keyframe') => {
    if (!pendingIntent || !data) return;
    const el = data.elements.find(e => e.id === pendingIntent.elementId);
    if (!el) { setPendingIntent(null); return; }
    const updated = applyPostAnimationIntent(
      el,
      pendingIntent.prop,
      pendingIntent.value,
      pendingIntent.lastKeyframeTime,
      pendingIntent.playheadLocal,
      intent,
    );
    updateData(d => ({
      ...d,
      elements: d.elements.map(e => e.id === pendingIntent.elementId ? updated : e),
    }));
    setPendingIntent(null);
  }, [pendingIntent, data, updateData]);

  /** Remove all animation from a property (right-click "Remove animation"). */
  const removeAnimationOnProp = useCallback((elementId: string, prop: AnimatableProperty) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const updated = clearAnimationOnProp(el, prop);
    updateData(d => ({ ...d, elements: d.elements.map(e => e.id === elementId ? updated : e) }));
  }, [data, updateData]);

  /** Set the easing on an existing keyframe (segment ending at this kf). */
  const setKeyframeEasing = useCallback((elementId: string, prop: AnimatableProperty, t: number, easing: EasingPreset) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const list = el.keyframes?.[prop] ?? [];
    const kf = list.find(k => Math.abs(k.t - t) <= TIME_EPSILON);
    if (!kf) return;
    const updated = upsertKeyframe(el, prop, t, kf.value, easing);
    updateData(d => ({ ...d, elements: d.elements.map(e => e.id === elementId ? updated : e) }));
  }, [data, updateData]);

  /** Delete a single property keyframe at time t. */
  const deletePropKeyframe = useCallback((elementId: string, prop: AnimatableProperty, t: number) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const updated = removeKeyframeFromElement(el, prop, t);
    updateData(d => ({ ...d, elements: d.elements.map(e => e.id === elementId ? updated : e) }));
  }, [data, updateData]);

  // ─── Layer / Track ops (Phase 4) ────
  const toggleVisible = useCallback((elementId: string) => {
    updateData(d => ({
      ...d,
      elements: d.elements.map(e => e.id === elementId ? { ...e, visible: e.visible === false ? true : false } : e),
    }));
  }, [updateData]);

  const toggleLock = useCallback((elementId: string) => {
    updateData(d => ({
      ...d,
      elements: d.elements.map(e => e.id === elementId ? { ...e, locked: !e.locked } : e),
    }));
  }, [updateData]);

  const renameElement = useCallback((elementId: string, name: string) => {
    updateData(d => ({
      ...d,
      elements: d.elements.map(e => e.id === elementId ? { ...e, name: name.trim() || undefined } : e),
    }));
  }, [updateData]);

  /** Run the client-side export pipeline. Outputs webm in iteration 1; mp4
   *  transcoding deferred. */
  const handleExport = useCallback(async () => {
    if (!data || data.elements.length === 0) {
      showError('Nothing to export', new Error('Add at least one element first.'));
      return;
    }
    if (exportProgress) return;  // already running
    setPlaying(false);  // stop preview playback during export
    const ac = new AbortController();
    exportAbortRef.current = ac;
    try {
      setExportProgress({ current: 0, total: 1 });
      const result = await exportVideoToBlob(data, {
        onProgress: (current, total) => setExportProgress({ current, total }),
        signal: ac.signal,
      });
      downloadExport(result, title || `video-${videoId}`);
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') {
        showError('Export failed', e);
      }
    } finally {
      setExportProgress(null);
      exportAbortRef.current = null;
    }
  }, [data, exportProgress, title, videoId]);

  const cancelExport = useCallback(() => {
    exportAbortRef.current?.abort();
  }, []);

  /** Bump z-index — moves element up (toward front) or down (toward back) by
   *  swapping z-index values with the immediate neighbor in z-index order. */
  const moveZIndex = useCallback((elementId: string, direction: 'up' | 'down') => {
    if (!data) return;
    // Stable sort by z-index ascending
    const ordered = [...data.elements].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));
    const i = ordered.findIndex(e => e.id === elementId);
    if (i < 0) return;
    const j = direction === 'up' ? i + 1 : i - 1;  // up = higher z (toward front)
    if (j < 0 || j >= ordered.length) return;
    const a = ordered[i], b = ordered[j];
    const az = a.z_index ?? 0, bz = b.z_index ?? 0;
    updateData(d => ({
      ...d,
      elements: d.elements.map(e => {
        if (e.id === a.id) return { ...e, z_index: bz };
        if (e.id === b.id) return { ...e, z_index: az };
        return e;
      }),
    }));
  }, [data, updateData]);

  // ─── Playback ─────────────────────────
  useEffect(() => {
    if (!playing) { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); return; }
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setCurrentTime(prev => {
        const next = prev + dt;
        if (next >= totalDuration) { setPlaying(false); return totalDuration; }
        return next;
      });
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [playing, totalDuration]);

  // ─── Canvas Zoom (auto-fit) ───────────
  useEffect(() => {
    if (!canvasContainerRef.current || !data) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const pad = 60;
    const sx = (rect.width - pad * 2) / data.settings.width;
    const sy = (rect.height - pad * 2) / data.settings.height;
    setZoom(Math.min(sx, sy, 1));
  }, [data?.settings.width, data?.settings.height]);

  // ─── Clipboard ───────────────────
  const VIDEO_CLIPBOARD_KEY = 'aose-video-clipboard';
  const videoPasteCountRef = useRef(0);

  const handleCopy = useCallback(() => {
    if (!selectedElementId || !data) return;
    const el = data.elements.find(e => e.id === selectedElementId);
    if (!el) return;
    const payload = JSON.stringify({ type: VIDEO_CLIPBOARD_KEY, elements: [el] });
    navigator.clipboard.writeText(payload).catch(() => {});
    videoPasteCountRef.current = 0;
  }, [selectedElementId, data]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      let parsed: { type: string; elements: VideoElement[] };
      try { parsed = JSON.parse(text); } catch { return; }
      if ((parsed.type !== VIDEO_CLIPBOARD_KEY && parsed.type !== 'aose-canvas-clipboard') || !Array.isArray(parsed.elements) || parsed.elements.length === 0) return;
      videoPasteCountRef.current += 1;
      const offset = videoPasteCountRef.current * 20;
      const newEls: VideoElement[] = parsed.elements.map(el => ({
        ...el,
        id: crypto.randomUUID(),
        x: el.x + offset,
        y: el.y + offset,
        start: (el as any).start ?? currentTime,
        duration: (el as any).duration ?? 5,
        type: (el as any).type ?? 'shape',
        // Markers and keyframes are intentionally NOT copied across paste — we copy
        // visual layout only. (Phase 3 will revisit this with proper offsets.)
        markers: undefined,
        keyframes: undefined,
        name: `${el.name ?? (el as any).type ?? 'element'} copy`,
      }));
      updateData(d => ({ ...d, elements: [...d.elements, ...newEls] }));
      if (newEls.length === 1) setSelectedElementId(newEls[0].id);
    } catch {}
  }, [currentTime, updateData]);

  const handleCut = useCallback(() => {
    handleCopy();
    if (selectedElementId) deleteElement(selectedElementId);
  }, [handleCopy, selectedElementId, deleteElement]);

  // ─── Keyboard Shortcuts ───────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId) { e.preventDefault(); deleteElement(selectedElementId); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? handleRedo() : handleUndo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selectedElementId) { e.preventDefault(); duplicateElement(selectedElementId); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !e.shiftKey) { e.preventDefault(); handleCopy(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !e.shiftKey) { e.preventDefault(); handlePaste(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'x' && !e.shiftKey) { e.preventDefault(); handleCut(); }
      // K: add a marker on the selected element at current playhead.
      // Disabled when no element is selected or the playhead is at the element's t=0
      // (which is always the implicit initial keyframe).
      if (e.key === 'k' && !e.metaKey && !e.ctrlKey && !e.shiftKey && selectedElementId) {
        e.preventDefault();
        addMarkerAtPlayhead(selectedElementId);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedElementId, deleteElement, duplicateElement, handleUndo, handleRedo, handleCopy, handlePaste, handleCut, addMarkerAtPlayhead]);

  // ─── Title & Delete ───────────────────
  const handleTitleChange = useCallback(async (newTitle: string) => {
    setTitle(newTitle);
    try { await gw.updateContentItem(contentId, { title: newTitle }); queryClient.invalidateQueries({ queryKey: ['content-items'] }); }
    catch (e) { showError('Failed to update title', e); }
  }, [contentId, queryClient]);
  const handleDelete = useCallback(() => { gw.deleteContentItem(contentId).then(() => onDeleted?.()); }, [contentId, onDeleted]);

  const topBarCtx = useMemo(() => ({
    id: videoId, type: 'video', title, pinned: isPinned ?? false,
    url: typeof window !== 'undefined' ? `${getPublicOrigin()}${window.location.pathname}${window.location.search}` : '',
    startRename: () => {}, openIconPicker: () => {},
    togglePin: () => onTogglePin?.(), deleteItem: handleDelete, shareItem: () => {},
    copyLink: () => onCopyLink?.(),
    showHistory: () => { setShowRevisions(v => !v); onCloseComments(); },
    showComments: () => { onShowComments(); setShowRevisions(false); },
    showHistoryActive: showRevisions, showCommentsActive: showComments,
  }), [videoId, title, isPinned, handleDelete, onTogglePin, onCopyLink, showRevisions, showComments, onCloseComments, onShowComments]);
  const menuItems = useMemo(() => buildContentTopBarCommonMenuItems(t, topBarCtx), [t, topBarCtx]);
  const fixedActions = useMemo(() => buildFixedTopBarActionItems(t, topBarCtx), [t, topBarCtx]);

  const updateSettings = useCallback((updates: Partial<gw.VideoSettings>) => {
    updateData(d => ({ ...d, settings: { ...d.settings, ...updates } }));
  }, [updateData]);

  // ─── Canvas Element Drag ──────────────
  const dragRef = useRef<{ elId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent, elId: string) => {
    if (!data || editingTextId === elId) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el || el.locked) return;
    e.stopPropagation();
    setSelectedElementId(elId);
    setSelectedMarkerTime(null);
    // For Phase 2 we always drag the static x/y. Phase 3 will route through the
    // §3 behavior table (animated property + on-marker → keyframe; etc).
    const snap = getElementSnapshotAt(el, currentTime - el.start);
    dragRef.current = { elId, startX: e.clientX, startY: e.clientY, origX: snap.x, origY: snap.y };

    const handleMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / zoom;
      const dy = (ev.clientY - d.startY) / zoom;
      const newX = Math.round(d.origX + dx);
      const newY = Math.round(d.origY + dy);
      const targetId = d.elId;
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          elements: prev.elements.map(pel =>
            pel.id !== targetId ? pel : { ...pel, x: newX, y: newY },
          ),
        };
      });
    };
    const handleUp = () => {
      dragRef.current = null;
      setData(prev => { if (prev) { undoRedo.push(prev); scheduleSave(prev); } return prev; });
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, zoom, currentTime, editingTextId, undoRedo, scheduleSave]);

  // ─── Resize Handles ──────────────────
  const resizeRef = useRef<{ elId: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent, elId: string, handle: string) => {
    if (!data) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el) return;
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = { elId, handle, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h };

    const handleMove = (ev: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = (ev.clientX - r.startX) / zoom;
      const dy = (ev.clientY - r.startY) / zoom;
      let nX = r.origX, nY = r.origY, nW = r.origW, nH = r.origH;
      if (r.handle.includes('e')) nW = Math.max(20, r.origW + dx);
      if (r.handle.includes('w')) { nW = Math.max(20, r.origW - dx); nX = r.origX + r.origW - nW; }
      if (r.handle.includes('s')) nH = Math.max(20, r.origH + dy);
      if (r.handle.includes('n')) { nH = Math.max(20, r.origH - dy); nY = r.origY + r.origH - nH; }
      setData(prev => {
        if (!prev) return prev;
        return { ...prev, elements: prev.elements.map(pel => pel.id === r.elId ? { ...pel, x: Math.round(nX), y: Math.round(nY), w: Math.round(nW), h: Math.round(nH) } : pel) };
      });
    };
    const handleUp = () => {
      resizeRef.current = null;
      setData(prev => { if (prev) { undoRedo.push(prev); scheduleSave(prev); } return prev; });
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, zoom, undoRedo, scheduleSave]);

  // ─── Text Double-Click ────────────────
  const handleDoubleClick = useCallback((elId: string) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elId);
    if (!el || el.type !== 'text') return;
    setEditingTextId(elId);
  }, [data]);

  const handleTextBlur = useCallback((elId: string, newText: string) => {
    setEditingTextId(null);
    if (!data) return;
    const el = data.elements.find(e => e.id === elId);
    if (!el) return;
    const updatedHtml = el.html.replace(/>([^<]*)<\/div>\s*$/, `>${newText}</div>`);
    updateElement(elId, { html: updatedHtml });
  }, [data, updateElement]);

  // ─── Timeline Drag ────────────────────
  const timelineDragRef = useRef<{
    type: 'move' | 'resize-left' | 'resize-right' | 'marker';
    elId: string; startX: number; origStart: number; origDuration: number;
    origMarkerTime?: number; timelineWidth: number;
  } | null>(null);

  const handleTimelinePointerDown = useCallback((e: React.PointerEvent, type: 'move' | 'resize-left' | 'resize-right', elId: string, barEl: HTMLElement) => {
    if (!data) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el) return;
    e.stopPropagation(); e.preventDefault();
    setSelectedElementId(elId); setSelectedMarkerTime(null);
    const tw = barEl.closest('[data-timeline-track]')?.getBoundingClientRect().width ?? barEl.parentElement!.getBoundingClientRect().width;
    timelineDragRef.current = { type, elId, startX: e.clientX, origStart: el.start, origDuration: el.duration, timelineWidth: tw };

    const handleMove = (ev: PointerEvent) => {
      const d = timelineDragRef.current;
      if (!d) return;
      const dxTime = ((ev.clientX - d.startX) / d.timelineWidth) * timelineDuration;
      setData(prev => {
        if (!prev) return prev;
        return { ...prev, elements: prev.elements.map(pel => {
          if (pel.id !== d.elId) return pel;
          if (d.type === 'move') return { ...pel, start: Math.round(Math.max(0, d.origStart + dxTime) * 10) / 10 };
          if (d.type === 'resize-left') {
            const ns = Math.max(0, Math.min(d.origStart + d.origDuration - 0.1, d.origStart + dxTime));
            return { ...pel, start: Math.round(ns * 10) / 10, duration: Math.round((d.origDuration - (ns - d.origStart)) * 10) / 10 };
          }
          return { ...pel, duration: Math.round(Math.max(0.1, d.origDuration + dxTime) * 10) / 10 };
        }) };
      });
    };
    const handleUp = () => {
      timelineDragRef.current = null;
      setData(prev => { if (prev) { undoRedo.push(prev); scheduleSave(prev); } return prev; });
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, timelineDuration, undoRedo, scheduleSave]);

  /** Drag an existing marker along its element's local timeline. Cascades any
   *  property keyframes at that marker time so they follow the marker. */
  const handleMarkerDragStart = useCallback((e: React.PointerEvent, elId: string, markerTime: number, trackEl: HTMLElement) => {
    if (!data) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el) return;
    e.stopPropagation(); e.preventDefault();
    const tw = trackEl.getBoundingClientRect().width;
    timelineDragRef.current = {
      type: 'marker', elId, startX: e.clientX,
      origStart: el.start, origDuration: el.duration,
      origMarkerTime: markerTime, timelineWidth: tw,
    };
    setSelectedMarkerTime(markerTime);

    const handleMove = (ev: PointerEvent) => {
      const d = timelineDragRef.current;
      if (!d || d.origMarkerTime === undefined) return;
      const dxTime = ((ev.clientX - d.startX) / d.timelineWidth) * d.origDuration;
      const newTime = Math.max(TIME_EPSILON, Math.min(d.origDuration, d.origMarkerTime + dxTime));
      const rounded = Math.round(newTime * 100) / 100;
      setData(prev => {
        if (!prev) return prev;
        return { ...prev, elements: prev.elements.map(pel => {
          if (pel.id !== d.elId) return pel;
          // Move marker
          const markers = (pel.markers ?? []).map(m =>
            Math.abs(m - d.origMarkerTime!) <= TIME_EPSILON ? rounded : m,
          ).sort((a, b) => a - b);
          // Cascade: any property keyframes at the old time follow to the new time
          const keyframes: typeof pel.keyframes = {};
          for (const [prop, list] of Object.entries(pel.keyframes ?? {})) {
            if (!list) continue;
            keyframes[prop as keyof typeof keyframes] = list
              .map(k => Math.abs(k.t - d.origMarkerTime!) <= TIME_EPSILON ? { ...k, t: rounded } : k)
              .sort((a, b) => a.t - b.t);
          }
          return { ...pel, markers, keyframes };
        }) };
      });
    };
    const handleUp = () => {
      const d = timelineDragRef.current;
      timelineDragRef.current = null;
      setData(prev => {
        if (prev) { undoRedo.push(prev); scheduleSave(prev); }
        return prev;
      });
      // Find current marker time after rounding for selection
      if (d && d.origMarkerTime !== undefined) {
        const el = data.elements.find(x => x.id === d.elId);
        if (el) {
          // selection update happens on next render via the markers array — leave as-is
        }
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, undoRedo, scheduleSave]);

  // ─── Render ───────────────────────────
  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)]">
        <div className="text-muted-foreground text-sm">Loading video...</div>
      </div>
    );
  }

  const visibleElements = data.elements.filter(el => {
    if (el.visible === false) return false;
    const relTime = currentTime - el.start;
    return relTime >= 0 && relTime <= el.duration;
  });

  const handleSize = 8 / zoom;

  return (
    <div className="flex-1 flex flex-row min-h-0">
      <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] md:overflow-hidden relative z-[1]">
        {/* Top Bar */}
        <div className="flex items-center border-b border-border shrink-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
          <ContentTopBar breadcrumb={breadcrumb} onNavigate={onNavigate} onBack={onBack}
            docListVisible={docListVisible} onToggleDocList={onToggleDocList}
            title={title} titlePlaceholder="Untitled Video" onTitleChange={handleTitleChange}
            statusText={saveStatus}
            actions={renderFixedTopBarActions(fixedActions, { t, ctx: topBarCtx as any })}
            menuItems={menuItems}
            onHistory={() => setShowRevisions(v => !v)} onComments={onToggleComments} />
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Canvas Preview */}
            <div ref={canvasContainerRef} className="flex-1 bg-muted/50 flex items-center justify-center overflow-hidden relative"
              onClick={() => { setSelectedElementId(null); setSelectedMarkerTime(null); setShowShapes(false); }}>

              {/* Floating Toolbar (Canvas style) */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 bg-card rounded border border-black/10 dark:border-white/10 px-3 h-10 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]"
                onClick={e => e.stopPropagation()}>
                <div className="relative">
                  <ToolBtn icon={Hexagon} onClick={() => setShowShapes(v => !v)} active={showShapes} title="Shapes" />
                  {showShapes && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowShapes(false)} />
                      <div className="absolute top-full left-0 mt-2 z-50">
                        <ShapePicker onSelect={(type) => addShapeElement(type)} columns={6} />
                      </div>
                    </>
                  )}
                </div>
                <ToolBtn icon={LineIcon} onClick={addLineElement} title="Line" />
                <ToolBtn icon={Type} onClick={addTextElement} title="Text" />
                <ToolBtn icon={ImagePlus} onClick={() => fileInputRef.current?.click()} title="Image" />
                <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
                <ToolBtn icon={Undo2} onClick={handleUndo} disabled={!undoRedo.canUndo} title="Undo" />
                <ToolBtn icon={Redo2} onClick={handleRedo} disabled={!undoRedo.canRedo} title="Redo" />
                <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
                <ToolBtn icon={Settings} onClick={() => setShowSettings(v => !v)} active={showSettings} title="Canvas Settings" />
                <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
                <ToolBtn icon={Download} onClick={handleExport} disabled={!!exportProgress} title="Export video (webm)" />
              </div>

              {/* Image upload button (hidden) */}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

              {/* Canvas — outer container at screen pixels, inner at native size scaled via CSS transform */}
              <div style={{
                width: data.settings.width * zoom,
                height: data.settings.height * zoom,
                position: 'relative',
              }} className="shadow-2xl overflow-hidden"
                onDrop={handleVideoDrop} onDragOver={handleVideoDragOver}>
                <div style={{
                  width: data.settings.width,
                  height: data.settings.height,
                  background: data.settings.background_color ?? '#000',
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                  position: 'relative',
                }}>
                {visibleElements.map(el => {
                  const localT = currentTime - el.start;
                  const snap = getElementSnapshotAt(el, localT);
                  const isEditing = editingTextId === el.id;
                  const isSelected = selectedElementId === el.id;

                  return (
                    <div key={el.id}
                      className={cn("absolute", !isEditing && "cursor-move")}
                      style={{
                        left: snap.x, top: snap.y, width: snap.w, height: snap.h, opacity: snap.opacity,
                        transform: `scale(${snap.scale}) rotate(${snap.rotation}deg)`,
                        transformOrigin: 'center center',
                        zIndex: el.z_index ?? 0,
                      }}
                      onClick={(e) => { e.stopPropagation(); setSelectedElementId(el.id); setSelectedMarkerTime(null); }}
                      onPointerDown={(e) => handleCanvasPointerDown(e, el.id)}
                      onDoubleClick={() => handleDoubleClick(el.id)}
                    >
                      {isEditing ? (
                        <div contentEditable suppressContentEditableWarning autoFocus
                          style={{ width: '100%', height: '100%', outline: 'none' }}
                          onBlur={(e) => handleTextBlur(el.id, e.currentTarget.textContent ?? '')}
                          dangerouslySetInnerHTML={{ __html: el.html.replace(/<[^>]+>/g, '') || 'Text' }}
                        />
                      ) : (
                        <StableHtml html={el.html} />
                      )}
                      {/* Selection border + resize handles */}
                      {isSelected && !isEditing && (
                        <>
                          <div style={{ position: 'absolute', inset: -1, border: `${2 / zoom}px solid #3b82f6`, pointerEvents: 'none', borderRadius: 2 }} />
                          {!el.locked && HANDLES.map(h => (
                            <div key={h} style={{
                              position: 'absolute', top: HANDLE_POS[h].top, left: HANDLE_POS[h].left,
                              transform: 'translate(-50%, -50%)', width: handleSize, height: handleSize,
                              background: '#fff', border: `${2 / zoom}px solid #3b82f6`, borderRadius: 2,
                              cursor: HANDLE_CURSORS[h], zIndex: 10, pointerEvents: 'auto', touchAction: 'none',
                            }}
                              onPointerDown={(e) => handleResizeStart(e, el.id, h)}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
                </div>
              </div>

              {/* Zoom indicator (bottom-right, matching Canvas ZoomBar) */}
              <div className="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 bg-card/50 backdrop-blur-sm rounded border border-black/10 dark:border-white/10 px-2 h-10 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]"
                onClick={e => e.stopPropagation()}>
                <button onClick={() => setZoom(z => Math.max(0.1, z * 0.8))} className="p-1 rounded hover:bg-accent"><Minus className="w-3.5 h-3.5" /></button>
                <button onClick={() => {
                  if (!canvasContainerRef.current || !data) return;
                  const rect = canvasContainerRef.current.getBoundingClientRect();
                  const pad = 60;
                  const sx = (rect.width - pad * 2) / data.settings.width;
                  const sy = (rect.height - pad * 2) / data.settings.height;
                  setZoom(Math.min(sx, sy, 1));
                }} className="px-1 py-0.5 rounded hover:bg-accent text-[11px] text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom(z => Math.min(5, z * 1.25))} className="p-1 rounded hover:bg-accent"><Plus className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            {/* Timeline */}
            <div className="h-[220px] border-t border-border flex flex-col shrink-0 bg-card">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
                <button onClick={() => { setCurrentTime(0); setPlaying(false); }} className="p-1 rounded hover:bg-accent"><SkipBack className="w-3.5 h-3.5" /></button>
                <button onClick={() => setPlaying(p => !p)} className="p-1 rounded hover:bg-accent">
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button onClick={() => { setCurrentTime(totalDuration); setPlaying(false); }} className="p-1 rounded hover:bg-accent"><SkipForward className="w-3.5 h-3.5" /></button>
                <span className="text-xs text-muted-foreground font-mono">{formatTime(currentTime)} / {formatTime(totalDuration)}</span>
              </div>
              <div className="flex-1 overflow-auto">
                <div className="h-6 border-b border-border relative bg-muted/30 ml-[200px] cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setCurrentTime(Math.max(0, Math.min(totalDuration, ((e.clientX - rect.left) / rect.width) * timelineDuration)));
                  }}>
                  {Array.from({ length: Math.ceil(timelineDuration) + 1 }, (_, i) => (
                    <div key={i} className="absolute top-0 h-full border-l border-border/50 flex items-end pb-0.5" style={{ left: `${(i / timelineDuration) * 100}%` }}>
                      <span className="text-[10px] text-muted-foreground ml-1">{i}s</span>
                    </div>
                  ))}
                  <div className="absolute top-0 h-[500px] w-0.5 bg-red-500 z-10 pointer-events-none" style={{ left: `${(currentTime / timelineDuration) * 100}%` }}>
                    <div className="w-2.5 h-2.5 bg-red-500 rounded-sm -ml-[4px] -mt-0.5" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)' }} />
                  </div>
                </div>
                {[...data.elements].sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0)).map((el, idx, sorted) => {
                  const markers = getMarkers(el);
                  const isHidden = el.visible === false;
                  const isLocked = !!el.locked;
                  const canMoveUp = idx > 0;            // not at top of list (already highest z)
                  const canMoveDown = idx < sorted.length - 1; // not at bottom
                  const animatedProps = (Object.keys(el.keyframes ?? {}) as AnimatableProperty[])
                    .filter(p => (el.keyframes?.[p]?.length ?? 0) > 0);
                  const hasAnimation = animatedProps.length > 0;
                  const isExpanded = expandedTracks.has(el.id) && hasAnimation;
                  return (
                    <React.Fragment key={el.id}>
                    <div data-timeline-track className={cn("flex items-center h-8 border-b border-border/50", selectedElementId === el.id && "bg-accent/30", isHidden && "opacity-50")}
                      onClick={() => { setSelectedElementId(el.id); setSelectedMarkerTime(null); }}>
                      <TrackLabel
                        el={el} isHidden={isHidden} isLocked={isLocked}
                        canMoveUp={canMoveUp} canMoveDown={canMoveDown}
                        hasAnimation={hasAnimation}
                        expanded={isExpanded}
                        onToggleExpanded={() => toggleTrackExpanded(el.id)}
                        onToggleVisible={() => toggleVisible(el.id)}
                        onToggleLock={() => toggleLock(el.id)}
                        onRename={(name) => renameElement(el.id, name)}
                        onMoveUp={() => moveZIndex(el.id, 'up')}
                        onMoveDown={() => moveZIndex(el.id, 'down')} />
                      <div className="flex-1 relative h-full">
                        <div className={cn("absolute top-1 bottom-1 rounded-sm group", selectedElementId === el.id ? "bg-blue-500/60" : "bg-blue-500/30")}
                          style={{ left: `${(el.start / timelineDuration) * 100}%`, width: `${(el.duration / timelineDuration) * 100}%` }}>
                          <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/60 rounded-l-sm"
                            onPointerDown={(e) => handleTimelinePointerDown(e, 'resize-left', el.id, e.currentTarget.parentElement!)} />
                          <div className="absolute left-1.5 right-1.5 top-0 bottom-0 cursor-grab active:cursor-grabbing"
                            onPointerDown={(e) => handleTimelinePointerDown(e, 'move', el.id, e.currentTarget.parentElement!)} />
                          <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/60 rounded-r-sm"
                            onPointerDown={(e) => handleTimelinePointerDown(e, 'resize-right', el.id, e.currentTarget.parentElement!)} />
                          {/* Markers (element-level time anchors). Each carries
                              the keyframes of any property that's been animated
                              at that moment; right-click to delete (cascades). */}
                          {markers.map(t => (
                            <div key={t} className={cn("absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 border cursor-pointer z-10",
                              selectedElementId === el.id && selectedMarkerTime !== null && Math.abs(selectedMarkerTime - t) <= TIME_EPSILON
                                ? "bg-yellow-300 border-yellow-500 scale-125"
                                : "bg-yellow-400 border-yellow-600")}
                              style={{ left: `${(t / el.duration) * 100}%`, marginLeft: -5 }}
                              onClick={(e) => { e.stopPropagation(); setSelectedElementId(el.id); setSelectedMarkerTime(t); }}
                              onPointerDown={(e) => handleMarkerDragStart(e, el.id, t, e.currentTarget.parentElement!)}
                              onContextMenu={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                if (window.confirm(`Delete marker at ${t.toFixed(2)}s? This also removes any property keyframes at that time.`)) {
                                  deleteMarker(el.id, t);
                                }
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                // Jump playhead to this marker time so panel reflects this moment.
                                setCurrentTime(el.start + t);
                              }}
                              title={`Marker at ${t.toFixed(2)}s — drag to move, click to select, dbl-click to seek, right-click to delete`} />
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* Expanded sub-rows: one per animated property, showing
                        only that property's keyframes. */}
                    {isExpanded && animatedProps.map(prop => {
                      const list = (el.keyframes?.[prop] ?? []).slice().sort((a, b) => a.t - b.t);
                      return (
                        <div key={`${el.id}-${prop}`}
                          className={cn('flex items-center h-6 border-b border-border/30', isHidden && 'opacity-50')}>
                          <div className="w-[200px] shrink-0 pl-10 pr-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="truncate">{prop}</span>
                            <span className="text-muted-foreground/60">({list.length})</span>
                          </div>
                          <div className="flex-1 relative h-full">
                            <div className="absolute top-1 bottom-1 rounded-sm bg-yellow-500/10 border border-yellow-500/20"
                              style={{
                                left: `${(el.start / timelineDuration) * 100}%`,
                                width: `${(el.duration / timelineDuration) * 100}%`,
                              }}>
                              {list.map(kf => (
                                <div
                                  key={kf.t}
                                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-yellow-400 border border-yellow-600 cursor-pointer z-10"
                                  style={{ left: `${(kf.t / el.duration) * 100}%`, marginLeft: -4 }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedElementId(el.id);
                                    setSelectedMarkerTime(kf.t);
                                    setCurrentTime(el.start + kf.t);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault(); e.stopPropagation();
                                    if (window.confirm(`Delete the ${prop} keyframe at ${kf.t.toFixed(2)}s? The marker stays.`)) {
                                      deletePropKeyframe(el.id, prop, kf.t);
                                    }
                                  }}
                                  title={`${prop} = ${kf.value.toFixed(2)} at ${kf.t.toFixed(2)}s${kf.easing ? ` · easing in: ${kf.easing}` : ''}`} />
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Panel — always visible */}
          <div className="w-[280px] border-l border-border bg-sidebar shrink-0 overflow-y-auto hidden md:block">
            {showSettings ? (
              <SettingsPanel settings={data.settings} onUpdate={updateSettings} onClose={() => setShowSettings(false)} />
            ) : selectedElement ? (
              <ElementPropertyPanel element={selectedElement} totalDuration={totalDuration} currentTime={currentTime}
                onUpdate={(updates) => updateElement(selectedElement.id, updates)}
                onUpdateHtml={(html) => updateElement(selectedElement.id, { html })}
                onChangeAnimatable={(prop, v) => changeAnimatableProperty(selectedElement.id, prop, v)}
                onRemoveAnimation={(prop) => removeAnimationOnProp(selectedElement.id, prop)}
                onSetKeyframeEasing={(prop, t, easing) => setKeyframeEasing(selectedElement.id, prop, t, easing)}
                onDeletePropKeyframe={(prop, t) => deletePropKeyframe(selectedElement.id, prop, t)}
                onDelete={() => deleteElement(selectedElement.id)}
                onDuplicate={() => duplicateElement(selectedElement.id)}
                onAddMarker={() => addMarkerAtPlayhead(selectedElement.id)}
                onDeleteMarker={(t) => deleteMarker(selectedElement.id, t)}
                selectedMarkerTime={selectedMarkerTime}
                onSelectMarker={setSelectedMarkerTime} />
            ) : (
              <div className="p-4 text-xs text-muted-foreground">Select an element to edit properties.</div>
            )}
          </div>
        </div>
      </div>

      {showComments && !showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <CommentPanel
            targetType="video"
            targetId={contentId}
            onClose={onCloseComments}
            focusCommentId={focusCommentId}
            anchorType={selectedElement ? 'element' : undefined}
            anchorId={selectedElement?.id}
            anchorMeta={selectedElement ? { node_label: selectedElement.name ?? selectedElement.type ?? 'element' } : undefined}
          />
        </div>
      )}
      {showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <RevisionHistory contentId={contentId} contentType="video"
            onClose={() => setShowRevisions(false)}
            onRestore={(revisionData) => { const d = migrateVideoData(revisionData); setData(d); scheduleSave(d); setShowRevisions(false); }} />
        </div>
      )}

      {/* Post-animation intent dialog (§3 last row). */}
      {pendingIntent && (
        <PostAnimationIntentDialog
          prop={pendingIntent.prop}
          value={pendingIntent.value}
          lastKeyframeTime={pendingIntent.lastKeyframeTime}
          playheadLocal={pendingIntent.playheadLocal}
          onPick={resolveIntent}
          onCancel={() => setPendingIntent(null)} />
      )}

      {/* Export progress modal (Phase 6). */}
      {exportProgress && (
        <ExportProgressDialog
          current={exportProgress.current}
          total={exportProgress.total}
          onCancel={cancelExport} />
      )}
    </div>
  );
}

// ─── Export Progress Dialog ────────

function ExportProgressDialog({ current, total, onCancel }: { current: number; total: number; onCancel: () => void }) {
  const pct = Math.round((current / Math.max(1, total)) * 100);
  return (
    <div className="fixed inset-0 z-[10100] bg-black/40 flex items-center justify-center">
      <div className="bg-card rounded-lg shadow-2xl w-[420px] p-5 border border-border">
        <h3 className="text-sm font-semibold mb-2">Exporting video…</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Frame {current} / {total} · {pct}%
        </p>
        <div className="w-full h-2 bg-muted rounded overflow-hidden mb-4">
          <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Post-Animation Intent Dialog ────────

function PostAnimationIntentDialog({
  prop, value, lastKeyframeTime, playheadLocal, onPick, onCancel,
}: {
  prop: AnimatableProperty;
  value: number;
  lastKeyframeTime: number;
  playheadLocal: number;
  onPick: (intent: 'modify-last' | 'add-keyframe') => void;
  onCancel: () => void;
}) {
  // ESC closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[10100] bg-black/40 flex items-center justify-center"
      onClick={onCancel}>
      <div className="bg-card rounded-lg shadow-2xl w-[420px] p-5 border border-border"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-1">You changed {prop} at {playheadLocal.toFixed(2)}s</h3>
        <p className="text-xs text-muted-foreground mb-4">
          The last <span className="font-mono">{prop}</span> keyframe is at {lastKeyframeTime.toFixed(2)}s.
          The animation currently settles to that value and holds it. What did you mean?
        </p>
        <div className="space-y-2">
          <button onClick={() => onPick('modify-last')}
            className="w-full text-left px-3 py-2 rounded-md border border-border hover:border-primary/40 hover:bg-accent/30 transition-colors">
            <div className="text-sm font-medium">◆ Modify the final value at {lastKeyframeTime.toFixed(2)}s</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              The animation will settle to {value.toFixed(0)} (changes the entire t0→{lastKeyframeTime.toFixed(2)}s curve's destination).
            </div>
          </button>
          <button onClick={() => onPick('add-keyframe')}
            className="w-full text-left px-3 py-2 rounded-md border border-border hover:border-primary/40 hover:bg-accent/30 transition-colors">
            <div className="text-sm font-medium">+ Add a new keyframe at {playheadLocal.toFixed(2)}s</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Extend the animation to this moment. The {prop} value will be {value.toFixed(0)} at {playheadLocal.toFixed(2)}s.
            </div>
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">
            Cancel (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Panel ─────────────────────

function SettingsPanel({ settings, onUpdate, onClose }: {
  settings: gw.VideoSettings; onUpdate: (updates: Partial<gw.VideoSettings>) => void; onClose: () => void;
}) {
  return (
    <div>
      <SectionHeader>Video Settings</SectionHeader>
      <div className="p-3 space-y-2">
        <SelectInput label="Preset"
          value={SIZE_PRESETS.some(p => p.width === settings.width && p.height === settings.height) ? `${settings.width}x${settings.height}` : 'custom'}
          onChange={v => { if (v === 'custom') return; const [w, h] = v.split('x').map(Number); if (w && h) onUpdate({ width: w, height: h }); }}
          options={[...SIZE_PRESETS.map(p => ({ value: `${p.width}x${p.height}`, label: `${p.label}` })), { value: 'custom', label: 'Custom' }]} />
        <NumberInput label="Width" value={settings.width} min={100} max={7680} onChange={v => onUpdate({ width: v })} />
        <NumberInput label="Height" value={settings.height} min={100} max={7680} onChange={v => onUpdate({ height: v })} />
        <SelectInput label="FPS" value={String(settings.fps)} onChange={v => onUpdate({ fps: Number(v) })}
          options={[{ value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }]} />
        <ColorInput label="BG" value={settings.background_color ?? '#000000'} onChange={v => onUpdate({ background_color: v })} />
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground mt-2">Close settings</button>
      </div>
    </div>
  );
}

// ─── Property Animations Section ────────

/** Lists each animated property's keyframes with editable easing. Easing on a
 *  keyframe defines the segment ENDING at that keyframe (incoming-easing). */
function PropertyAnimationsSection({
  element,
  onSetKeyframeEasing,
  onDeletePropKeyframe,
}: {
  element: VideoElement;
  onSetKeyframeEasing: (prop: AnimatableProperty, t: number, easing: EasingPreset) => void;
  onDeletePropKeyframe: (prop: AnimatableProperty, t: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const map = element.keyframes ?? {};
  const animatedProps = (Object.keys(map) as AnimatableProperty[])
    .filter(p => (map[p]?.length ?? 0) > 0);

  return (
    <>
      <SectionHeader collapsed={!open} onToggle={() => setOpen(v => !v)}>
        Animations ({animatedProps.length})
      </SectionHeader>
      {open && (
        <div className="p-3 space-y-3">
          {animatedProps.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">
              No animated properties yet. Add a marker (K) at a time, then change a property to animate it.
            </p>
          )}
          {animatedProps.map(prop => {
            const list = (map[prop] ?? []).slice().sort((a, b) => a.t - b.t);
            return (
              <div key={prop}>
                <div className="text-[11px] font-medium text-foreground mb-1">{prop}</div>
                <div className="space-y-1">
                  {list.map(kf => (
                    <div key={kf.t} className="flex items-center gap-2 text-[11px] bg-muted/30 rounded px-2 py-1">
                      <Diamond className="w-3 h-3 text-yellow-500 shrink-0" />
                      <span className="font-mono text-muted-foreground w-12">{kf.t.toFixed(2)}s</span>
                      <span className="font-mono text-foreground flex-1">{Math.round(kf.value * 100) / 100}</span>
                      <select
                        value={kf.easing ?? 'linear'}
                        onChange={e => onSetKeyframeEasing(prop, kf.t, e.target.value as EasingPreset)}
                        className="text-[10px] px-1 py-0.5 rounded border bg-background"
                        title="Incoming easing for the segment ending here">
                        {EASING_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <button onClick={() => onDeletePropKeyframe(prop, kf.t)}
                        className="p-0.5 rounded hover:bg-accent text-destructive"
                        title="Delete this keyframe (marker stays)">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Element Property Panel (Canvas-aligned) ─────────────

function ElementPropertyPanel({
  element, totalDuration, currentTime,
  onUpdate, onUpdateHtml, onChangeAnimatable, onRemoveAnimation,
  onSetKeyframeEasing, onDeletePropKeyframe,
  onDelete, onDuplicate,
  onAddMarker, onDeleteMarker, selectedMarkerTime, onSelectMarker,
}: {
  element: VideoElement; totalDuration: number; currentTime: number;
  onUpdate: (updates: Partial<VideoElement>) => void;
  onUpdateHtml: (html: string) => void;
  onChangeAnimatable: (prop: AnimatableProperty, value: number) => void;
  onRemoveAnimation: (prop: AnimatableProperty) => void;
  onSetKeyframeEasing: (prop: AnimatableProperty, t: number, easing: EasingPreset) => void;
  onDeletePropKeyframe: (prop: AnimatableProperty, t: number) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddMarker: () => void;
  onDeleteMarker: (t: number) => void;
  selectedMarkerTime: number | null;
  onSelectMarker: (t: number | null) => void;
}) {
  const [showAppearance, setShowAppearance] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showHtml, setShowHtml] = useState(false);
  const markers = getMarkers(element);
  const playheadLocal = currentTime - element.start;
  const playheadInLifespan = playheadLocal >= 0 && playheadLocal <= element.duration;
  // Interpolated snapshot at the current playhead — used to populate the X/Y/W/H
  // and other animatable inputs so the panel reflects what the user is *seeing*
  // at this moment, not the static-only state.
  const snap = getElementSnapshotAt(element, Math.max(0, Math.min(element.duration, playheadLocal)));

  const isSvg = element.html.includes('<svg');
  const fill = isSvg ? (element.html.match(/fill="([^"]+)"/) ?? [])[1] ?? '#3b82f6' : extractProp(element.html, 'background') || extractProp(element.html, 'background-color') || '#3b82f6';
  const stroke = isSvg ? (element.html.match(/stroke="([^"]+)"/) ?? [])[1] ?? 'none' : 'none';
  const strokeWidth = isSvg ? parseFloat((element.html.match(/stroke-width="([^"]+)"/) ?? [])[1] ?? '0') : 0;
  const strokeDash = isSvg ? (element.html.match(/stroke-dasharray="([^"]+)"/) ?? [])[1] ?? '' : '';
  const borderRadius = extractProp(element.html, 'border-radius') || '0';
  const textColor = extractProp(element.html, 'color') || '#ffffff';
  const fontSize = parseFloat(extractProp(element.html, 'font-size') || '48');
  const fontFamily = extractProp(element.html, 'font-family') || 'sans-serif';
  const fontWeight = extractProp(element.html, 'font-weight') || '700';
  const opacity = parseFloat(extractProp(element.html, 'opacity') || '1');

  const updateSvgAttr = (attr: string, value: string) => {
    const re = new RegExp(`${attr}="[^"]*"`);
    onUpdateHtml(re.test(element.html) ? element.html.replace(re, `${attr}="${value}"`) : element.html.replace(/<path /, `<path ${attr}="${value}" `));
  };

  return (
    <div>
      {/* Header with actions */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium truncate">{element.name ?? element.type}</span>
        <div className="flex items-center gap-0.5">
          <button onClick={onDuplicate} className="p-1 rounded hover:bg-accent" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-accent text-destructive" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Position & Size — animatable. Indicators next to each field show
          whether the property is animated and whether the playhead is on a
          marker (filled ◆) or between markers (hollow ◇). */}
      <SectionHeader>Position & Size</SectionHeader>
      <div className="p-3 space-y-2">
        <AnimatableField label="X" prop="x" value={snap.x} element={element} playheadLocal={playheadLocal}
          onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
        <AnimatableField label="Y" prop="y" value={snap.y} element={element} playheadLocal={playheadLocal}
          onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
        <AnimatableField label="W" prop="w" value={snap.w} min={20} element={element} playheadLocal={playheadLocal}
          onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
        <AnimatableField label="H" prop="h" value={snap.h} min={20} element={element} playheadLocal={playheadLocal}
          onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
        <NumberInput label="Z-Index" value={element.z_index ?? 0} onChange={v => onUpdate({ z_index: v })} />
      </div>

      {/* Transform — animatable. Opacity / Scale / Rotation. */}
      <SectionHeader>Transform</SectionHeader>
      <div className="p-3 space-y-2">
        <AnimatableField label="Opacity" prop="opacity" value={snap.opacity} min={0} max={1} step={0.05}
          element={element} playheadLocal={playheadLocal}
          onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
        <AnimatableField label="Scale" prop="scale" value={snap.scale} min={0} max={10} step={0.1}
          element={element} playheadLocal={playheadLocal}
          onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
        <AnimatableField label="Rotation" prop="rotation" value={snap.rotation} step={5}
          element={element} playheadLocal={playheadLocal}
          onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
      </div>

      {/* Timing */}
      <SectionHeader>Timing</SectionHeader>
      <div className="p-3 space-y-2">
        <NumberInput label="Start" value={element.start} min={0} step={0.1} onChange={v => onUpdate({ start: v })} />
        <NumberInput label="Duration" value={element.duration} min={0.1} step={0.1} onChange={v => onUpdate({ duration: v })} />
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-muted-foreground w-14 shrink-0">Name</label>
          <input type="text" value={element.name ?? ''} onChange={e => onUpdate({ name: e.target.value })}
            className="flex-1 text-[11px] px-1.5 py-1 rounded border bg-background" />
        </div>
      </div>

      {/* Appearance */}
      <SectionHeader collapsed={!showAppearance} onToggle={() => setShowAppearance(v => !v)}>Appearance</SectionHeader>
      {showAppearance && (
        <div className="p-3 space-y-2">
          {element.type === 'text' ? (
            <>
              <ColorInput label="Fill" value={extractProp(element.html, 'background') || extractProp(element.html, 'background-color') || 'none'}
                onChange={v => onUpdateHtml(setStyleProp(element.html, 'background', v))} />
              <ColorInput label="Text" value={textColor} onChange={v => onUpdateHtml(setStyleProp(element.html, 'color', v))} />
              <NumberInput label="Font Size" value={fontSize} min={1} onChange={v => onUpdateHtml(setStyleProp(element.html, 'font-size', `${v}px`))} />
              <SelectInput label="Font" value={fontFamily.replace(/['"]/g, '')} onChange={v => onUpdateHtml(setStyleProp(element.html, 'font-family', v))}
                options={[
                  { value: '-apple-system, BlinkMacSystemFont, sans-serif', label: 'System' },
                  { value: 'sans-serif', label: 'Sans Serif' },
                  { value: 'serif', label: 'Serif' },
                  { value: 'monospace', label: 'Monospace' },
                  { value: 'Georgia', label: 'Georgia' },
                  { value: 'Arial', label: 'Arial' },
                  { value: 'Verdana', label: 'Verdana' },
                ]} />
              <SelectInput label="Weight" value={fontWeight} onChange={v => onUpdateHtml(setStyleProp(element.html, 'font-weight', v))}
                options={[
                  { value: '300', label: 'Light' },
                  { value: '400', label: 'Regular' },
                  { value: '500', label: 'Medium' },
                  { value: '600', label: 'Semibold' },
                  { value: '700', label: 'Bold' },
                  { value: '900', label: 'Black' },
                ]} />
            </>
          ) : isSvg ? (
            <>
              <ColorInput label="Fill" value={fill} onChange={v => updateSvgAttr('fill', v)} />
              <ColorInput label="Stroke" value={stroke} onChange={v => updateSvgAttr('stroke', v)} />
              <NumberInput label="Stroke W" value={strokeWidth} min={0} step={0.5} onChange={v => updateSvgAttr('stroke-width', String(v))} />
              <SelectInput label="Dash" value={strokeDash} onChange={v => updateSvgAttr('stroke-dasharray', v)}
                options={[
                  { value: '', label: 'Solid' },
                  { value: '8 4', label: 'Dashed' },
                  { value: '2 2', label: 'Dotted' },
                  { value: '12 4 4 4', label: 'Dash-dot' },
                ]} />
              <NumberInput label="Radius" value={parseInt(borderRadius) || 0} min={0}
                onChange={v => onUpdateHtml(setStyleProp(element.html, 'border-radius', `${v}px`))} />
            </>
          ) : (
            <>
              <ColorInput label="Fill" value={fill} onChange={v => onUpdateHtml(setStyleProp(element.html, 'background', v))} />
              <NumberInput label="Radius" value={parseInt(borderRadius) || 0} min={0}
                onChange={v => onUpdateHtml(setStyleProp(element.html, 'border-radius', `${v}px`))} />
            </>
          )}
          <NumberInput label="Opacity" value={opacity} min={0} max={1} step={0.1}
            onChange={v => onUpdateHtml(setStyleProp(element.html, 'opacity', String(v)))} />
        </div>
      )}

      {/* Markers (element-level time anchors). Property keyframes will appear on
          per-property sub-rows once Phase 3 lands; for now this section just lets
          you add / remove markers. */}
      <SectionHeader collapsed={!showMarkers} onToggle={() => setShowMarkers(v => !v)}>
        Markers ({markers.length})
      </SectionHeader>
      {showMarkers && (
        <div className="p-3 space-y-1">
          {markers.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">No markers yet. Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">K</kbd> at a point in time to add one.</p>
          )}
          {markers.map(t => (
            <div key={t}
              className={cn(
                'flex items-center gap-2 text-[11px] rounded px-2 py-1 cursor-pointer hover:bg-muted/50',
                selectedMarkerTime !== null && Math.abs(selectedMarkerTime - t) <= TIME_EPSILON
                  ? 'bg-yellow-500/10' : 'bg-muted/30',
              )}
              onClick={() => onSelectMarker(t)}>
              <Diamond className="w-3 h-3 text-yellow-500 shrink-0" />
              <span className="font-mono text-muted-foreground flex-1">{t.toFixed(2)}s</span>
              <button onClick={(e) => { e.stopPropagation(); onDeleteMarker(t); }} className="p-0.5 rounded hover:bg-accent text-destructive" title="Delete marker (cascades any property keyframes here)">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            onClick={onAddMarker}
            disabled={!playheadInLifespan || playheadLocal <= TIME_EPSILON}
            className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 mt-1 disabled:text-muted-foreground/50 disabled:cursor-not-allowed">
            <Plus className="w-3 h-3" />Add marker at {Math.max(0, playheadLocal).toFixed(2)}s
            <span className="text-[10px] text-muted-foreground/60">(K)</span>
          </button>
        </div>
      )}

      {/* Property animations — per-property keyframes with editable easing */}
      <PropertyAnimationsSection
        element={element}
        onSetKeyframeEasing={onSetKeyframeEasing}
        onDeletePropKeyframe={onDeletePropKeyframe} />

      {/* HTML Code */}
      <SectionHeader collapsed={!showHtml} onToggle={() => setShowHtml(v => !v)}>HTML Code</SectionHeader>
      {showHtml && (
        <div className="p-3">
          <textarea value={element.html} onChange={e => onUpdateHtml(e.target.value)} rows={6}
            className="w-full text-[11px] px-1.5 py-1 rounded border bg-background font-mono resize-y" />
        </div>
      )}
    </div>
  );
}
