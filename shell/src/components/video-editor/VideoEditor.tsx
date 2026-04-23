'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  Plus, Minus, Trash2, Play, Pause, SkipBack, SkipForward,
  Type, Minus as LineIcon, ChevronDown, ChevronRight,
  Undo2, Redo2, X, Settings, Copy, Diamond, Ban,
  ArrowUp, ArrowDown, Lock, Unlock, Hexagon, ImagePlus,
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
import { useUndoRedo } from '../canvas-editor/use-undo-redo';
import type { VideoData, VideoElement, VideoKeyframe } from './types';
import {
  interpolateKeyframes, SIZE_PRESETS,
  DEFAULT_VIDEO_WIDTH, DEFAULT_VIDEO_HEIGHT, DEFAULT_FPS,
  computeTotalDuration, migrateVideoData,
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
  const shapeDef = SHAPE_MAP[shapeType];
  if (!shapeDef) return '<div style="width:100%;height:100%;background:#3b82f6;border-radius:8px;"></div>';
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="${shapeDef.path}" fill="#3b82f6" stroke="none" /></svg>`;
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
  const [selectedKeyframeIdx, setSelectedKeyframeIdx] = useState<number | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

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
  const selectedKeyframe = selectedElement && selectedKeyframeIdx !== null
    ? (selectedElement.keyframes ?? [])[selectedKeyframeIdx] ?? null : null;

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
      start: currentTime, duration: 3, keyframes: [], z_index: data.elements.length + 1, name: 'Text',
    };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
    setSelectedKeyframeIdx(null);
  }, [data, currentTime, updateData]);

  const addShapeElement = useCallback((shapeType: ShapeType) => {
    if (!data) return;
    const s = data.settings;
    const newEl: VideoElement = {
      id: crypto.randomUUID(), type: 'shape',
      x: s.width / 2 - 75, y: s.height / 2 - 75, w: 150, h: 150,
      html: buildShapeHtml(shapeType),
      start: currentTime, duration: 3, keyframes: [], z_index: data.elements.length + 1,
      name: SHAPE_MAP[shapeType]?.label ?? 'Shape',
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
      start: currentTime, duration: 3, keyframes: [], z_index: data.elements.length + 1, name: 'Line',
    };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
  }, [data, currentTime, updateData]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !data) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const newEl: VideoElement = {
        id: crypto.randomUUID(), type: 'image',
        x: data.settings.width / 2 - 150, y: data.settings.height / 2 - 100, w: 300, h: 200,
        html: `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;" />`,
        start: currentTime, duration: 3, keyframes: [],
        z_index: data.elements.length + 1, name: file.name.replace(/\.[^.]+$/, ''),
      };
      updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
      setSelectedElementId(newEl.id);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [data, currentTime, updateData]);

  const deleteElement = useCallback((elementId: string) => {
    updateData(d => ({ ...d, elements: d.elements.filter(el => el.id !== elementId) }));
    if (selectedElementId === elementId) { setSelectedElementId(null); setSelectedKeyframeIdx(null); }
  }, [updateData, selectedElementId]);

  const duplicateElement = useCallback((elementId: string) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const newEl: VideoElement = { ...el, id: crypto.randomUUID(), x: el.x + 20, y: el.y + 20, name: `${el.name ?? el.type} copy` };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
  }, [data, updateData]);

  // ─── Keyframe Management ──────────────
  const addKeyframe = useCallback((elementId: string) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el) return;
    const relTime = currentTime - el.start;
    if (relTime < 0 || relTime > el.duration) return;
    const kf: VideoKeyframe = { time: relTime, props: { x: el.x, y: el.y, w: el.w, h: el.h, opacity: 1, scale: 1, rotation: 0 } };
    const existing = el.keyframes ?? [];
    const filtered = existing.filter(k => Math.abs(k.time - relTime) > 0.05);
    const newKfs = [...filtered, kf].sort((a, b) => a.time - b.time);
    updateElement(elementId, { keyframes: newKfs });
    setSelectedKeyframeIdx(newKfs.findIndex(k => Math.abs(k.time - relTime) < 0.05));
  }, [data, currentTime, updateElement]);

  const deleteKeyframe = useCallback((elementId: string, time: number) => {
    if (!data) return;
    updateElement(elementId, { keyframes: (data.elements.find(e => e.id === elementId)?.keyframes ?? []).filter(k => Math.abs(k.time - time) > 0.05) });
    setSelectedKeyframeIdx(null);
  }, [data, updateElement]);

  const updateKeyframeProps = useCallback((elementId: string, kfIdx: number, propUpdates: Partial<VideoKeyframe['props']>) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elementId);
    if (!el?.keyframes?.[kfIdx]) return;
    updateElement(elementId, { keyframes: el.keyframes.map((kf, i) => i === kfIdx ? { ...kf, props: { ...kf.props, ...propUpdates } } : kf) });
  }, [data, updateElement]);

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
        keyframes: (el as any).keyframes ?? [],
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
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedElementId, deleteElement, duplicateElement, handleUndo, handleRedo, handleCopy, handlePaste, handleCut]);

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
    setSelectedKeyframeIdx(null);
    const kfProps = interpolateKeyframes(el, currentTime);
    dragRef.current = { elId, startX: e.clientX, startY: e.clientY, origX: kfProps.x ?? el.x, origY: kfProps.y ?? el.y };

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
        return { ...prev, elements: prev.elements.map(pel => {
          if (pel.id !== targetId) return pel;
          const relTime = currentTime - pel.start;
          const kfs = pel.keyframes ?? [];
          if (kfs.length > 0 && relTime >= 0 && relTime <= pel.duration) {
            let ci = 0, cd = Infinity;
            kfs.forEach((kf, i) => { const d2 = Math.abs(kf.time - relTime); if (d2 < cd) { cd = d2; ci = i; } });
            return { ...pel, keyframes: kfs.map((kf, i) => i === ci ? { ...kf, props: { ...kf.props, x: newX, y: newY } } : kf) };
          }
          return { ...pel, x: newX, y: newY };
        }) };
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
    type: 'move' | 'resize-left' | 'resize-right' | 'keyframe';
    elId: string; startX: number; origStart: number; origDuration: number;
    kfIdx?: number; origKfTime?: number; timelineWidth: number;
  } | null>(null);

  const handleTimelinePointerDown = useCallback((e: React.PointerEvent, type: 'move' | 'resize-left' | 'resize-right', elId: string, barEl: HTMLElement) => {
    if (!data) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el) return;
    e.stopPropagation(); e.preventDefault();
    setSelectedElementId(elId); setSelectedKeyframeIdx(null);
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

  const handleKeyframeDragStart = useCallback((e: React.PointerEvent, elId: string, kfIdx: number, barEl: HTMLElement) => {
    if (!data) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el?.keyframes?.[kfIdx]) return;
    e.stopPropagation(); e.preventDefault();
    const bw = barEl.getBoundingClientRect().width;
    timelineDragRef.current = { type: 'keyframe', elId, startX: e.clientX, origStart: el.start, origDuration: el.duration, kfIdx, origKfTime: el.keyframes[kfIdx].time, timelineWidth: bw };

    const handleMove = (ev: PointerEvent) => {
      const d = timelineDragRef.current;
      if (!d || d.origKfTime === undefined || d.kfIdx === undefined) return;
      const dxTime = ((ev.clientX - d.startX) / d.timelineWidth) * d.origDuration;
      const newTime = Math.max(0, Math.min(d.origDuration, d.origKfTime + dxTime));
      setData(prev => {
        if (!prev) return prev;
        return { ...prev, elements: prev.elements.map(pel => {
          if (pel.id !== d.elId || !pel.keyframes) return pel;
          return { ...pel, keyframes: pel.keyframes.map((kf, i) => i === d.kfIdx ? { ...kf, time: Math.round(newTime * 100) / 100 } : kf).sort((a, b) => a.time - b.time) };
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
              onClick={() => { setSelectedElementId(null); setSelectedKeyframeIdx(null); setShowShapes(false); }}>

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
              </div>

              {/* Image upload button (hidden) */}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

              {/* Canvas — outer container at screen pixels, inner at native size scaled via CSS transform */}
              <div style={{
                width: data.settings.width * zoom,
                height: data.settings.height * zoom,
                position: 'relative',
              }} className="shadow-2xl overflow-hidden">
                <div style={{
                  width: data.settings.width,
                  height: data.settings.height,
                  background: data.settings.background_color ?? '#000',
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                  position: 'relative',
                }}>
                {visibleElements.map(el => {
                  const kfProps = interpolateKeyframes(el, currentTime);
                  const x = kfProps.x ?? el.x;
                  const y = kfProps.y ?? el.y;
                  const w = kfProps.w ?? el.w;
                  const h = kfProps.h ?? el.h;
                  const opacity = kfProps.opacity ?? 1;
                  const elScale = kfProps.scale ?? 1;
                  const rotation = kfProps.rotation ?? 0;
                  const isEditing = editingTextId === el.id;
                  const isSelected = selectedElementId === el.id;

                  return (
                    <div key={el.id}
                      className={cn("absolute", !isEditing && "cursor-move")}
                      style={{
                        left: x, top: y, width: w, height: h, opacity,
                        transform: `scale(${elScale}) rotate(${rotation}deg)`,
                        transformOrigin: 'center center',
                        zIndex: el.z_index ?? 0,
                      }}
                      onClick={(e) => { e.stopPropagation(); setSelectedElementId(el.id); setSelectedKeyframeIdx(null); }}
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
                <div className="h-6 border-b border-border relative bg-muted/30 ml-[140px] cursor-pointer"
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
                {data.elements.map(el => (
                  <div key={el.id} data-timeline-track className={cn("flex items-center h-8 border-b border-border/50", selectedElementId === el.id && "bg-accent/30")}
                    onClick={() => { setSelectedElementId(el.id); setSelectedKeyframeIdx(null); }}>
                    <div className="w-[140px] shrink-0 px-2 flex items-center gap-1.5 truncate text-xs">
                      {el.type === 'text' ? <Type className="w-3 h-3 shrink-0" /> : <Hexagon className="w-3 h-3 shrink-0" />}
                      <span className="truncate">{el.name ?? el.type}</span>
                    </div>
                    <div className="flex-1 relative h-full">
                      <div className={cn("absolute top-1 bottom-1 rounded-sm group", selectedElementId === el.id ? "bg-blue-500/60" : "bg-blue-500/30")}
                        style={{ left: `${(el.start / timelineDuration) * 100}%`, width: `${(el.duration / timelineDuration) * 100}%` }}>
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/60 rounded-l-sm"
                          onPointerDown={(e) => handleTimelinePointerDown(e, 'resize-left', el.id, e.currentTarget.parentElement!)} />
                        <div className="absolute left-1.5 right-1.5 top-0 bottom-0 cursor-grab active:cursor-grabbing"
                          onPointerDown={(e) => handleTimelinePointerDown(e, 'move', el.id, e.currentTarget.parentElement!)} />
                        <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/60 rounded-r-sm"
                          onPointerDown={(e) => handleTimelinePointerDown(e, 'resize-right', el.id, e.currentTarget.parentElement!)} />
                        {(el.keyframes ?? []).map((kf, ki) => (
                          <div key={ki} className={cn("absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 border cursor-pointer z-10",
                            selectedElementId === el.id && selectedKeyframeIdx === ki ? "bg-yellow-300 border-yellow-500 scale-125" : "bg-yellow-400 border-yellow-600")}
                            style={{ left: `${(kf.time / el.duration) * 100}%`, marginLeft: -5 }}
                            onClick={(e) => { e.stopPropagation(); setSelectedElementId(el.id); setSelectedKeyframeIdx(ki); }}
                            onPointerDown={(e) => handleKeyframeDragStart(e, el.id, ki, e.currentTarget.parentElement!)} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Panel — always visible */}
          <div className="w-[280px] border-l border-border bg-sidebar shrink-0 overflow-y-auto hidden md:block">
            {showSettings ? (
              <SettingsPanel settings={data.settings} onUpdate={updateSettings} onClose={() => setShowSettings(false)} />
            ) : selectedElement && selectedKeyframe && selectedKeyframeIdx !== null ? (
              <KeyframePropertyPanel element={selectedElement} keyframe={selectedKeyframe} keyframeIdx={selectedKeyframeIdx}
                onUpdateProps={(props) => updateKeyframeProps(selectedElement.id, selectedKeyframeIdx, props)}
                onDelete={() => deleteKeyframe(selectedElement.id, selectedKeyframe.time)}
                onBack={() => setSelectedKeyframeIdx(null)} />
            ) : selectedElement ? (
              <ElementPropertyPanel element={selectedElement} totalDuration={totalDuration} currentTime={currentTime}
                onUpdate={(updates) => updateElement(selectedElement.id, updates)}
                onUpdateHtml={(html) => updateElement(selectedElement.id, { html })}
                onDelete={() => deleteElement(selectedElement.id)}
                onDuplicate={() => duplicateElement(selectedElement.id)}
                onAddKeyframe={() => addKeyframe(selectedElement.id)}
                onSelectKeyframe={(idx) => setSelectedKeyframeIdx(idx)}
                onDeleteKeyframe={(time) => deleteKeyframe(selectedElement.id, time)} />
            ) : (
              <div className="p-4 text-xs text-muted-foreground">Select an element to edit properties.</div>
            )}
          </div>
        </div>
      </div>

      {showComments && !showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <CommentPanel targetType="video" targetId={contentId} onClose={onCloseComments} focusCommentId={focusCommentId} />
        </div>
      )}
      {showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <RevisionHistory contentId={contentId} contentType="video"
            onClose={() => setShowRevisions(false)}
            onRestore={(revisionData) => { const d = migrateVideoData(revisionData); setData(d); scheduleSave(d); setShowRevisions(false); }} />
        </div>
      )}
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

// ─── Keyframe Property Panel ────────────

function KeyframePropertyPanel({ element, keyframe, keyframeIdx, onUpdateProps, onDelete, onBack }: {
  element: VideoElement; keyframe: VideoKeyframe; keyframeIdx: number;
  onUpdateProps: (props: Partial<VideoKeyframe['props']>) => void; onDelete: () => void; onBack: () => void;
}) {
  return (
    <div>
      <SectionHeader>
        <button onClick={onBack} className="mr-1 hover:text-foreground">←</button>
        Keyframe @ {keyframe.time.toFixed(1)}s
      </SectionHeader>
      <div className="p-3 space-y-2">
        <p className="text-[11px] text-muted-foreground">{element.name ?? element.type}</p>
        <NumberInput label="X" value={keyframe.props.x ?? element.x} onChange={v => onUpdateProps({ x: v })} />
        <NumberInput label="Y" value={keyframe.props.y ?? element.y} onChange={v => onUpdateProps({ y: v })} />
        <NumberInput label="Width" value={keyframe.props.w ?? element.w} min={1} onChange={v => onUpdateProps({ w: v })} />
        <NumberInput label="Height" value={keyframe.props.h ?? element.h} min={1} onChange={v => onUpdateProps({ h: v })} />
        <NumberInput label="Opacity" value={keyframe.props.opacity ?? 1} min={0} max={1} step={0.1} onChange={v => onUpdateProps({ opacity: v })} />
        <NumberInput label="Scale" value={keyframe.props.scale ?? 1} min={0} max={10} step={0.1} onChange={v => onUpdateProps({ scale: v })} />
        <NumberInput label="Rotation" value={keyframe.props.rotation ?? 0} step={5} onChange={v => onUpdateProps({ rotation: v })} />
        <button onClick={onDelete} className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 mt-2">
          <Trash2 className="w-3 h-3" />Delete keyframe
        </button>
      </div>
    </div>
  );
}

// ─── Element Property Panel (Canvas-aligned) ─────────────

function ElementPropertyPanel({ element, totalDuration, currentTime, onUpdate, onUpdateHtml, onDelete, onDuplicate, onAddKeyframe, onSelectKeyframe, onDeleteKeyframe }: {
  element: VideoElement; totalDuration: number; currentTime: number;
  onUpdate: (updates: Partial<VideoElement>) => void;
  onUpdateHtml: (html: string) => void;
  onDelete: () => void; onDuplicate: () => void; onAddKeyframe: () => void;
  onSelectKeyframe: (idx: number) => void; onDeleteKeyframe: (time: number) => void;
}) {
  const [showAppearance, setShowAppearance] = useState(true);
  const [showKeyframes, setShowKeyframes] = useState(true);
  const [showHtml, setShowHtml] = useState(false);

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

      {/* Position & Size */}
      <SectionHeader>Position & Size</SectionHeader>
      <div className="p-3 space-y-2">
        <NumberInput label="X" value={element.x} onChange={v => onUpdate({ x: v })} />
        <NumberInput label="Y" value={element.y} onChange={v => onUpdate({ y: v })} />
        <NumberInput label="W" value={element.w} min={20} onChange={v => onUpdate({ w: v })} />
        <NumberInput label="H" value={element.h} min={20} onChange={v => onUpdate({ h: v })} />
        <NumberInput label="Z-Index" value={element.z_index ?? 0} onChange={v => onUpdate({ z_index: v })} />
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

      {/* Keyframes */}
      <SectionHeader collapsed={!showKeyframes} onToggle={() => setShowKeyframes(v => !v)}>
        Keyframes ({(element.keyframes ?? []).length})
      </SectionHeader>
      {showKeyframes && (
        <div className="p-3 space-y-1">
          {(element.keyframes ?? []).map((kf, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] bg-muted/30 rounded px-2 py-1 cursor-pointer hover:bg-muted/50"
              onClick={() => onSelectKeyframe(i)}>
              <Diamond className="w-3 h-3 text-yellow-500 shrink-0" />
              <span className="font-mono text-muted-foreground">{kf.time.toFixed(1)}s</span>
              <span className="flex-1 truncate text-muted-foreground">
                {Object.entries(kf.props).filter(([_, v]) => v !== undefined).map(([k, v]) => `${k}:${typeof v === 'number' ? Math.round(v) : v}`).join(' ')}
              </span>
              <button onClick={(e) => { e.stopPropagation(); onDeleteKeyframe(kf.time); }} className="p-0.5 rounded hover:bg-accent text-destructive"><X className="w-3 h-3" /></button>
            </div>
          ))}
          <button onClick={onAddKeyframe} className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 mt-1">
            <Plus className="w-3 h-3" />Add keyframe at {Math.max(0, currentTime - element.start).toFixed(1)}s
          </button>
        </div>
      )}

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
