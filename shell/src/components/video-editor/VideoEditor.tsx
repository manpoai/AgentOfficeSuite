'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import { API_BASE } from '@/lib/api/config';
import {
  Plus, Minus, Trash2, Play, Pause, SkipBack, SkipForward,
  Type, Minus as LineIcon, ChevronDown, ChevronRight,
  Undo2, Redo2, X, Copy, Diamond, Ban,
  ArrowUp, ArrowDown, Lock, Unlock, Hexagon, ImagePlus,
  Eye, EyeOff, Eclipse, SquareRoundCorner,
  ALargeSmall, Rows3, RulerDimensionLine,
  TextAlignStart, TextAlignCenter, TextAlignEnd,
  ArrowUpToLine, SeparatorHorizontal, ArrowDownToLine,
  Underline, Strikethrough, Settings2,
  Goal, Clock7, Loader,
} from 'lucide-react';
import { exportVideoToBlob, downloadExport, type ExportFormat } from './videoExport';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { formatRelativeTime } from '@/lib/utils/time';
import { useT, getT } from '@/lib/i18n';
import { useKeyboardScope } from '@/lib/keyboard/useKeyboardScope';
import type { ShortcutDef } from '@/lib/keyboard/types';
import { readFileAsDataUrl, extractDroppedImageFiles, isSvgFile, createImageHtml, probeImageSize, uploadImageFile, resolveUploadUrl, canonicalizeUploadUrl } from '@/components/shared/image-upload';
import { parseSvgFileContent } from '@/components/shared/svg-import';
import { parsePath, expandCornerRadii, serializeSubPath, applyCornerRadiiToHtml, parseCornerRadiiFromHtml } from '@/components/shared/svg-path-utils';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { buildFixedTopBarActionItems, renderFixedTopBarActions } from '@/actions/content-topbar-fixed.actions';
import { buildContentTopBarCommonMenuItems } from '@/actions/content-topbar-common.actions';
import { getPublicOrigin } from '@/lib/remote-access';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { RevisionPreviewBanner } from '@/components/shared/RevisionPreviewBanner';
import { SHAPE_MAP, regularPolygonPath, regularStarPath, type ShapeType } from '@/components/shared/ShapeSet';
import { useUndoRedo } from '../canvas-editor/use-undo-redo';
import { CANVAS_FONTS } from '../canvas-editor/fonts';
import { loadGoogleFont } from '../canvas-editor/fontLoader';
import { ColorPicker } from '../canvas-editor/ColorPicker';
import { applySvgMarker, applyStrokeLinecap, type MarkerType } from '../canvas-editor/projection';
import {
  SectionHeader as CanvasSectionHeader,
  SubsectionHeader,
  LabeledNumberInput,
  HexTextInput,
  CornerRadiusField,
  IconBtn,
  SELECT_CLASS,
} from '../canvas-editor/CanvasPropertyPanel';
import type { VideoData, VideoElement, AnimatableProperty, EasingPreset, PropertyChangeOutcome } from './types';
import {
  SIZE_PRESETS, EASING_PRESETS,
  DEFAULT_VIDEO_WIDTH, DEFAULT_VIDEO_HEIGHT, DEFAULT_FPS,
  TIME_EPSILON,
  computeTotalDuration, migrateVideoData,
  getElementSnapshotAt, getPropertyValueAt, getMarkers,
  addMarker as addMarkerToElement, removeMarker as removeMarkerFromElement,
  applyPropertyChange, applyPostAnimationIntent,
  isPropertyAnimated, isOnMarker,
  removeKeyframe as removeKeyframeFromElement,
  clearAnimation as clearAnimationOnProp,
  upsertKeyframe,
  hexToPackedRgb, packedRgbToHex, COLOR_PROPERTIES,
} from './types';

const VIDEO_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'video-play-pause',
    key: ' ',
    handler: () => window.dispatchEvent(new CustomEvent('video:play-pause')),
    label: getT()('shortcuts.video.playPause'),
    category: 'Video',
  },
  {
    id: 'video-add-marker',
    key: 'k',
    handler: () => window.dispatchEvent(new CustomEvent('video:add-marker')),
    label: getT()('shortcuts.video.addMarker'),
    category: 'Video',
  },
];

// ─── Shared UI Components (Canvas-aligned) ────

// Re-export SectionHeader from Canvas for local use
const SectionHeader = CanvasSectionHeader;

// Color swatch + hex input row — uses Canvas's ColorPicker (react-colorful).
function VideoColorRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isNone = !value || value === 'none' || value === 'transparent';
  const hex = isNone ? '' : value.replace('#', '').toUpperCase();
  return (
    <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
      <div className="flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 min-w-0 col-span-2">
        <ColorPicker
          value={value || '#000000'}
          onChange={onChange}
          allowNone
          onClear={() => onChange('none')}
        />
        <HexTextInput
          value={hex}
          onCommit={(raw) => {
            const cleaned = raw.replace(/^#/, '').trim();
            if (!cleaned) { onChange('none'); return; }
            const expanded = cleaned.length <= 3
              ? cleaned.split('').map(c => c + c).join('')
              : cleaned;
            if (/^[0-9a-fA-F]{6}$/.test(expanded)) onChange(`#${expanded}`);
          }}
          className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
        />
      </div>
      <div />
    </div>
  );
}

// Simple select matching Canvas muted style
function VideoSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="relative w-full">
      <select value={value} onChange={e => onChange(e.target.value)} className={SELECT_CLASS}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
    </div>
  );
}

// ─── Alpha & Image Fit helpers (aligned with Canvas) ────

function hexOrRgbToRgba(c: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const rgbaM = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbaM) return `rgba(${rgbaM[1]}, ${rgbaM[2]}, ${rgbaM[3]}, ${a})`;
  const hex = c.replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return c;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function readAlphaFromRgba(c: string): number {
  const m = c.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\)/);
  return m ? parseFloat(m[1]) : 1;
}

type ImageFitMode = 'cover' | 'contain' | 'stretch';

function getImageFitMode(html: string): ImageFitMode {
  const imgParMatch = html.match(/<image\b[^>]*\spreserveAspectRatio="([^"]*)"/);
  if (imgParMatch) {
    if (imgParMatch[1] === 'none') return 'stretch';
    if (imgParMatch[1].includes('meet')) return 'contain';
    return 'cover';
  }
  const bgSizeMatch = html.match(/background-size:\s*([\w%-]+)/);
  if (bgSizeMatch) {
    if (bgSizeMatch[1] === 'contain') return 'contain';
    if (bgSizeMatch[1] === '100%') return 'stretch';
  }
  return 'cover';
}

function applyImageFitMode(html: string, mode: ImageFitMode): string {
  const isSvg = html.includes('<svg');
  if (isSvg) {
    const par = mode === 'stretch' ? 'none' : mode === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
    return html.replace(/(<image\b[^>]*?\s)preserveAspectRatio="[^"]*"/, `$1preserveAspectRatio="${par}"`);
  }
  const bgSize = mode === 'stretch' ? '100% 100%' : mode === 'contain' ? 'contain' : 'cover';
  return html.replace(/background-size:[^;]+;?/, `background-size:${bgSize};`);
}

function applyStrokeAlignment(html: string, newAlign: 'center' | 'inside' | 'outside'): string {
  let h = html;
  const oldAlign = (h.match(/data-stroke-align="([^"]+)"/) ?? [])[1] ?? 'center';
  const oldDoubled = oldAlign === 'inside' || oldAlign === 'outside';
  const newDoubled = newAlign === 'inside' || newAlign === 'outside';
  const swMatch = h.match(/stroke-width="([^"]+)"/);
  const sw = swMatch ? parseFloat(swMatch[1]) : 0;
  if (sw > 0 && oldDoubled !== newDoubled) {
    const visible = oldDoubled ? sw / 2 : sw;
    const physical = newDoubled ? visible * 2 : visible;
    h = h.replace(/stroke-width="[^"]*"/, `stroke-width="${physical}"`);
  }
  h = h.replace(/\s*data-stroke-align="[^"]*"/, '');
  h = h.replace(/\s*paint-order="[^"]*"/, '');
  if (newAlign !== 'center') {
    h = h.replace(/<path /, `<path data-stroke-align="${newAlign}" `);
    if (newAlign === 'outside') {
      h = h.replace(/<path /, '<path paint-order="stroke" ');
    }
  }
  return h;
}

/** Timeline track label cell. Carries the layer-panel responsibilities that
 *  Canvas keeps in a separate Layers sidebar: visibility toggle, lock toggle,
 *  inline rename, z-index reorder. */
function TrackLabel({
  el, isHidden, isLocked, canMoveUp, canMoveDown,
  hasAnimation, expanded,
  onToggleExpanded,
  onToggleVisible, onToggleLock, onRename, onMoveUp, onMoveDown,
  onDelete, onDuplicate, onComment,
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
  onDelete: () => void;
  onDuplicate: () => void;
  onComment?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div className="w-[200px] shrink-0 px-2 flex items-center gap-1 truncate text-xs"
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        const items = [
          { id: 'rename', label: 'Rename', onClick: () => { setDraft(el.name ?? el.type ?? ''); setEditing(true); } },
          { id: 'duplicate', label: 'Duplicate', onClick: onDuplicate },
          { id: 'delete', label: 'Delete', onClick: onDelete, danger: true },
          { id: 'visible', label: isHidden ? 'Show' : 'Hide', onClick: onToggleVisible, separator: true },
          { id: 'lock', label: isLocked ? 'Unlock' : 'Lock', onClick: onToggleLock },
          { id: 'up', label: 'Bring Forward', onClick: onMoveUp, disabled: !canMoveUp, separator: true },
          { id: 'down', label: 'Send Backward', onClick: onMoveDown, disabled: !canMoveDown },
          ...(onComment ? [{ id: 'comment', label: 'Add Comment', onClick: onComment, separator: true }] : []),
        ];
        window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { items, x: e.clientX, y: e.clientY } }));
      }}>
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
    </div>
  );
}

/** Animatable property field — uses Canvas LabeledNumberInput with a keyframe
 *  indicator diamond in the icon column. Right-click to remove animation. */
function AnimatableField({
  label, prop, value, min, max, step = 1, suffix,
  element, playheadLocal,
  onChange, onRemoveAnimation,
}: {
  label: React.ReactNode;
  prop: import('./types').AnimatableProperty;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  element: VideoElement;
  playheadLocal: number;
  onChange: (prop: import('./types').AnimatableProperty, v: number) => void;
  onRemoveAnimation: (prop: import('./types').AnimatableProperty) => void;
}) {
  const animated = isPropertyAnimated(element, prop);
  const propKfs = element.keyframes?.[prop] ?? [];
  const onPropKf = propKfs.some(k => Math.abs(k.t - playheadLocal) <= TIME_EPSILON);
  const onMarker = isOnMarker(element, playheadLocal);
  const labelStr = typeof label === 'string' ? label : String(prop);

  return (
    <div className="relative"
      onContextMenu={e => {
        if (!animated) return;
        e.preventDefault();
        if (window.confirm(`Remove animation from ${labelStr}? This deletes all ${labelStr} keyframes (the static value at t=0 is preserved).`)) {
          onRemoveAnimation(prop);
        }
      }}
      title={animated ? `Right-click to remove ${labelStr} animation` : undefined}
    >
      <LabeledNumberInput label={label} value={Math.round(value * 100) / 100} min={min} max={max} step={step} suffix={suffix}
        onChange={v => onChange(prop, v)} />
      {animated && (
        <span
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 border shrink-0',
            onPropKf ? 'bg-yellow-400 border-yellow-600' : 'border-yellow-500/60',
          )}
          title={onPropKf
            ? `Keyframe at ${playheadLocal.toFixed(2)}s`
            : (onMarker ? `Marker at ${playheadLocal.toFixed(2)}s (no kf for ${labelStr} yet)` : 'Animated, between keyframes')}
        />
      )}
    </div>
  );
}

/** Animatable color field — Canvas ColorPicker + hex input + alpha% + keyframe diamond.
 *  Value is a packed RGB integer. Right-click to remove animation. */
function AnimatableColorField({
  label, prop, value,
  alphaPct, onAlphaChange,
  element, playheadLocal,
  onChange, onRemoveAnimation,
}: {
  label: string;
  prop: AnimatableProperty;
  value: number;
  alphaPct?: number;
  onAlphaChange?: (pct: number) => void;
  element: VideoElement;
  playheadLocal: number;
  onChange: (prop: AnimatableProperty, v: number) => void;
  onRemoveAnimation: (prop: AnimatableProperty) => void;
}) {
  const animated = isPropertyAnimated(element, prop);
  const propKfs = element.keyframes?.[prop] ?? [];
  const onPropKf = propKfs.some(k => Math.abs(k.t - playheadLocal) <= TIME_EPSILON);
  const onMarker = isOnMarker(element, playheadLocal);
  const hex = packedRgbToHex(value);

  return (
    <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
      <div className="flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 min-w-0">
        <ColorPicker
          value={hex}
          onChange={c => onChange(prop, hexToPackedRgb(c))}
        />
        <HexTextInput
          value={hex.replace('#', '').toUpperCase()}
          onCommit={(raw) => {
            const cleaned = raw.replace(/^#/, '').trim();
            if (!cleaned) return;
            const expanded = cleaned.length <= 3
              ? cleaned.split('').map(c => c + c).join('')
              : cleaned;
            if (/^[0-9a-fA-F]{6}$/.test(expanded)) onChange(prop, hexToPackedRgb(expanded));
          }}
          className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
        />
      </div>
      {onAlphaChange ? (
        <LabeledNumberInput label="" value={alphaPct ?? 100} min={0} max={100} step={1} suffix="%" onChange={onAlphaChange} />
      ) : <div />}
      <div className="flex items-center justify-center"
        onContextMenu={e => {
          if (!animated) return;
          e.preventDefault();
          if (window.confirm(`Remove animation from ${label}? This deletes all ${label} keyframes.`)) {
            onRemoveAnimation(prop);
          }
        }}
        title={animated ? `Right-click to remove ${label} animation` : undefined}
      >
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

/** Apply interpolated color/fontSize from the animation snapshot onto the HTML string.
 *  This overwrites the static CSS values in the element's HTML at render time. */
function applyAnimatedStyleOverrides(
  html: string,
  snap: Record<string, number>,
  el: { type: string; html: string },
): string {
  let h = html;
  const isSvg = el.html.includes('<svg');
  const fillHex = packedRgbToHex(snap.fillColor);
  const strokeHex = packedRgbToHex(snap.strokeColor);
  const textHex = packedRgbToHex(snap.textColor);
  const fs = snap.fontSize;

  if (isSvg) {
    const hasImageFill = h.includes('url(#img-fill)');
    if (!hasImageFill) h = h.replace(/fill="[^"]*"/, `fill="${fillHex}"`);
    h = h.replace(/stroke="[^"]*"/, `stroke="${strokeHex}"`);
  } else {
    const hasBackgroundImage = /background-image:\s*url\(/.test(h);
    if (!hasBackgroundImage) {
      if (extractProp(h, 'background')) h = setStyleProp(h, 'background', fillHex);
      else if (extractProp(h, 'background-color')) h = setStyleProp(h, 'background-color', fillHex);
    }
    if (el.type === 'text') {
      const hasTextClip = h.includes('background-clip:') || h.includes('background-clip :');
      if (!hasTextClip) {
        h = setStyleProp(h, 'color', textHex);
      }
      h = setStyleProp(h, 'font-size', `${Math.round(fs)}px`);
    }
  }
  return h;
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

// ─── Text Editing Host (mirrors Canvas EditingOverlay) ────

function EditingHost({ element, zoom, onDone, onSizeChange }: {
  element: VideoElement;
  zoom: number;
  onDone: (newHtml: string | null) => void;
  onSizeChange: (w: number, h: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLElement | null>(null);
  const savedRef = useRef(false);
  const isAutoWidth = element.html.includes('data-text-resize="auto"');

  const finish = useCallback(() => {
    if (savedRef.current || !hostRef.current) return;
    savedRef.current = true;
    onDone(hostRef.current.innerHTML);
  }, [onDone]);

  const handleInput = useCallback(() => {
    const inner = editableRef.current;
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    const w = Math.max(20, Math.ceil(rect.width / zoom));
    const h = Math.max(20, Math.ceil(rect.height / zoom));
    if (isAutoWidth) {
      onSizeChange(w, h);
    } else {
      onSizeChange(element.w, h);
    }
  }, [isAutoWidth, zoom, element.w, onSizeChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = element.html;
    const inner = host.firstElementChild as HTMLElement | null;
    if (!inner) return;
    editableRef.current = inner;
    if (inner.getAttribute('contenteditable') !== 'true') {
      inner.setAttribute('contenteditable', 'true');
    }
    inner.style.outline = 'none';
    const onBlur = () => finish();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
    };
    const onInputEvt = () => handleInput();
    inner.addEventListener('blur', onBlur);
    inner.addEventListener('keydown', onKeyDown);
    inner.addEventListener('input', onInputEvt);
    const raf = requestAnimationFrame(() => {
      inner.focus();
      const sel = window.getSelection();
      if (sel) { sel.selectAllChildren(inner); sel.collapseToEnd(); }
    });
    return () => {
      cancelAnimationFrame(raf);
      inner.removeEventListener('blur', onBlur);
      inner.removeEventListener('keydown', onKeyDown);
      inner.removeEventListener('input', onInputEvt);
      if (!savedRef.current) onDone(host.innerHTML);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={hostRef}
      style={{
        width: isAutoWidth ? 'auto' : '100%',
        height: isAutoWidth ? 'auto' : '100%',
        minWidth: isAutoWidth ? 20 : undefined,
        outline: 'none',
        border: `${2 / zoom}px solid #3b82f6`,
        borderRadius: 2,
        boxSizing: 'border-box',
      }}
    />
  );
}

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

function buildShapeHtml(shapeType: ShapeType, w = 200, h = 200): string {
  const shapeDef = SHAPE_MAP.get(shapeType);
  if (!shapeDef) return '<div style="width:100%;height:100%;background:#D9D9D9;border-radius:8px;"></div>';
  let pathData: string;
  let extraPathAttrs = '';
  if (shapeType === 'polygon') {
    pathData = regularPolygonPath(w, h, 5);
    extraPathAttrs = ' data-shape="polygon" data-sides="5"';
  } else if (shapeType === 'star') {
    pathData = regularStarPath(w, h, 5);
    extraPathAttrs = ' data-shape="star" data-points="5"';
  } else {
    pathData = shapeDef.renderPath(w, h);
  }
  return `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${w + 2} ${h + 2}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${pathData}" fill="#D9D9D9" stroke="none" stroke-width="0" vector-effect="non-scaling-stroke"${extraPathAttrs}/></svg></div>`;
}

function getSvgViewBoxSize(html: string): { w: number; h: number } {
  const m = html.match(/viewBox="[^"]*?(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
  if (m) return { w: Math.round(parseFloat(m[3]) - 2), h: Math.round(parseFloat(m[4]) - 2) };
  return { w: 200, h: 200 };
}

function getParametricShape(html: string): { kind: 'polygon' | 'star'; count: number } | null {
  const polyMatch = html.match(/<path\b[^>]*\sdata-shape="polygon"[^>]*\sdata-sides="(\d+)"/);
  if (polyMatch) return { kind: 'polygon', count: parseInt(polyMatch[1], 10) };
  const starMatch = html.match(/<path\b[^>]*\sdata-shape="star"[^>]*\sdata-points="(\d+)"/);
  if (starMatch) return { kind: 'star', count: parseInt(starMatch[1], 10) };
  return null;
}

function updateParametricShape(html: string, kind: 'polygon' | 'star', count: number, w: number, h: number): string {
  const n = Math.max(3, Math.min(60, Math.round(count)));
  const newD = kind === 'polygon' ? regularPolygonPath(w, h, n) : regularStarPath(w, h, n);
  const attrName = kind === 'polygon' ? 'data-sides' : 'data-points';
  let result = html.replace(/(<path\b[^>]*?\s)d="[^"]*"/, `$1d="${newD}"`);
  result = result.replace(new RegExp(`(${attrName})="\\d+"`), `$1="${n}"`);
  return result;
}

export function VideoEditor({
  videoId, breadcrumb, onBack, onDeleted, onCopyLink,
  docListVisible, onToggleDocList, onNavigate,
  focusCommentId, showComments, onShowComments, onCloseComments, onToggleComments,
  isPinned, onTogglePin,
}: VideoEditorProps) {
  const { t } = useT();
  useKeyboardScope('video', VIDEO_SHORTCUTS);
  const queryClient = useQueryClient();
  const contentId = `video:${videoId}`;

  const [data, setData] = useState<VideoData | null>(null);
  const title = breadcrumb?.[breadcrumb.length - 1]?.title ?? '';
  const [saveStatus, setSaveStatus] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  const [previewRevisionData, setPreviewRevisionData] = useState<VideoData | null>(null);
  const [previewRevisionMeta, setPreviewRevisionMeta] = useState<{ id: string; created_at: string } | null>(null);

  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedMarkerTime, setSelectedMarkerTime] = useState<number | null>(null);
  const [selectedKfProp, setSelectedKfProp] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [commentAnchor, setCommentAnchor] = useState<{ type: string; id: string; meta?: Record<string, unknown> } | null>(null);

  // Drag-to-create insertion (Canvas-aligned).
  type PendingInsert = { type: 'text' } | { type: 'shape'; shapeType: ShapeType } | { type: 'line-draw' };
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null);
  const [createPreview, setCreatePreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const createDragRef = useRef<{ startClientX: number; startClientY: number; origX: number; origY: number; insert: PendingInsert } | null>(null);
  // Line-draw state (two-click: first click = start, mouse move = preview, second click/up = finish)
  const [lineDrawStart, setLineDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [lineDrawEnd, setLineDrawEnd] = useState<{ x: number; y: number } | null>(null);

  // Pending post-animation-interval intent dialog. When the dispatcher returns
  // 'needs-intent', we stash the payload here and surface a modal that lets the
  // user choose between "modify last keyframe" and "add new keyframe at playhead".
  const [pendingIntent, setPendingIntent] = useState<{
    elementId: string;
    prop: AnimatableProperty;
    value: number;
    lastKeyframeTime: number;
    playheadLocal: number;
    batch?: { prop: AnimatableProperty; value: number; lastKeyframeTime: number }[];
  } | null>(null);

  // Export state.
  const [exportProgress, setExportProgress] = useState<{ pct: number; label: string } | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
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

  // Timeline zoom: pixels per second. Default 80, range 20..400.
  const [pxPerSec, setPxPerSec] = useState(80);
  // Resizable timeline height. Default 220, min 120.
  const [timelineHeight, setTimelineHeight] = useState(220);
  const timelineResizeRef = useRef<{ startY: number; origH: number } | null>(null);
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
      if (videoResp.updated_at) setUpdatedAt(videoResp.updated_at);
      if (videoResp.updated_by) setUpdatedBy(videoResp.updated_by);
    }
  }, [videoResp]);

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
        const saveResp = await gw.saveVideo(videoId, toSave);
        if (saveResp.updated_at) setUpdatedAt(saveResp.updated_at);
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

  const handleVideoComment = useCallback((element: VideoElement) => {
    setCommentAnchor({
      type: 'element',
      id: element.id,
      meta: { element_name: element.name ?? element.type ?? 'element', start: element.start, duration: element.duration },
    });
    onShowComments();
    setShowRevisions(false);
  }, [onShowComments]);

  const navigateToAnchor = useCallback((anchor: { type: string; id: string }) => {
    if (anchor.type !== 'element' || !data) return;
    const el = data.elements.find(e => e.id === anchor.id);
    if (el) {
      setSelectedElementId(el.id);
      setCurrentTime(el.start);
    }
  }, [data]);

  // ─── Element CRUD ─────────────────────
  const updateElement = useCallback((elementId: string, updates: Partial<VideoElement>) => {
    updateData(d => ({ ...d, elements: d.elements.map(el => el.id === elementId ? { ...el, ...updates } : el) }));
  }, [updateData]);

  const startTextInsert = useCallback(() => {
    if (!data) return;
    const defaultText = 'Text';
    const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 24px; font-weight: 400; color: #000000; box-sizing: border-box; white-space: nowrap;" contenteditable="true" data-text-resize="auto">${defaultText}</div>`;
    const measure = document.createElement('div');
    measure.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:nowrap;visibility:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:24px;font-weight:400;';
    measure.textContent = defaultText;
    document.body.appendChild(measure);
    const w = Math.max(40, Math.ceil(measure.offsetWidth) + 8);
    const h = Math.max(20, Math.ceil(measure.offsetHeight) + 4);
    document.body.removeChild(measure);
    const newEl: VideoElement = {
      id: crypto.randomUUID(), type: 'text',
      x: data.settings.width / 2 - w / 2, y: data.settings.height / 2 - h / 2, w, h,
      html, start: currentTime, duration: 3,
      z_index: data.elements.length + 1, name: 'Text',
    };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newEl.id);
    setSelectedMarkerTime(null); setSelectedKfProp(null);
  }, [data, currentTime, updateData]);

  const startShapeInsert = useCallback((shapeType: ShapeType) => {
    setPendingInsert({ type: 'shape', shapeType });
    setShowShapes(false);
    setSelectedElementId(null);
  }, []);

  const startLineInsert = useCallback(() => {
    setPendingInsert({ type: 'line-draw' });
    setLineDrawStart(null);
    setLineDrawEnd(null);
    setSelectedElementId(null);
  }, []);

  const insertImageFromFile = useCallback(async (file: File) => {
    if (!data) return;
    const newElId = crypto.randomUUID();
    let html: string, w: number, h: number, elType: 'image' | 'shape' = 'shape';
    if (isSvgFile(file)) {
      const text = await file.text();
      const parsed = parseSvgFileContent(text);
      html = parsed.html; w = parsed.w; h = parsed.h;
    } else {
      const MAX_SIZE = 600;
      const probe = await probeImageSize(file);
      w = probe.w; h = probe.h;
      if (w > MAX_SIZE || h > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      // Upload first, then insert with the canonical server URL. Inserting with
      // a blob URL and swapping later races with autosave — the blob URL would
      // get persisted and become useless on the other device after sync.
      let serverUrl: string;
      try {
        serverUrl = await uploadImageFile(file);
      } catch {
        URL.revokeObjectURL(probe.objectUrl);
        return;
      }
      URL.revokeObjectURL(probe.objectUrl);
      html = createImageHtml(canonicalizeUploadUrl(serverUrl), w, h);
    }
    const newEl: VideoElement = {
      id: newElId, type: elType,
      x: data.settings.width / 2 - w / 2, y: data.settings.height / 2 - h / 2, w, h,
      html, start: currentTime, duration: 3,
      z_index: data.elements.length + 1, name: file.name.replace(/\.[^.]+$/, ''),
    };
    updateData(d => ({ ...d, elements: [...d.elements, newEl] }));
    setSelectedElementId(newElId);
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
    if (selectedElementId === elementId) { setSelectedElementId(null); setSelectedMarkerTime(null); setSelectedKfProp(null); }
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
      setSelectedMarkerTime(null); setSelectedKfProp(null);
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
    const items = pendingIntent.batch ?? [{ prop: pendingIntent.prop, value: pendingIntent.value, lastKeyframeTime: pendingIntent.lastKeyframeTime }];
    let current = el;
    for (const item of items) {
      current = applyPostAnimationIntent(
        current,
        item.prop,
        item.value,
        item.lastKeyframeTime,
        pendingIntent.playheadLocal,
        intent,
      );
    }
    const result = current;
    updateData(d => ({
      ...d,
      elements: d.elements.map(e => e.id === pendingIntent.elementId ? result : e),
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

  /** Run the client-side export pipeline.
   *  - format='webm': just the capture pipeline; no transcode.
   *  - format='mp4': capture webm, then transcode via ffmpeg.wasm. */
  const handleExport = useCallback(async (format: ExportFormat) => {
    if (!data || data.elements.length === 0) {
      showError('Nothing to export', new Error('Add at least one element first.'));
      return;
    }
    if (exportProgress) return;
    setPlaying(false);
    setShowExportMenu(false);
    const ac = new AbortController();
    exportAbortRef.current = ac;
    try {
      setExportProgress({ pct: 0, label: 'Starting…' });
      const result = await exportVideoToBlob(data, {
        format,
        onProgress: (pct, label) => setExportProgress({ pct, label }),
        signal: ac.signal,
      });
      downloadExport(result, title || `video-${videoId}`);
    } catch (e) {
      console.error('[VideoExport] Export error:', e);
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

  // ─── Pinch / Ctrl+Wheel Zoom (canvas + timeline) ───
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rootEl = editorRootRef.current;
    const canvasEl = canvasContainerRef.current;
    const timelineEl = timelineScrollRef.current;
    const canvasHandler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(0.1, Math.min(5, z * factor)));
    };
    const timelineHandler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setPxPerSec(p => Math.max(20, Math.min(400, p * factor)));
    };
    // Prevent browser zoom on the entire editor area
    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    // Safari gesture events
    const preventGesture = (e: Event) => e.preventDefault();
    rootEl?.addEventListener('wheel', preventBrowserZoom, { passive: false });
    rootEl?.addEventListener('gesturestart', preventGesture, { passive: false } as any);
    rootEl?.addEventListener('gesturechange', preventGesture, { passive: false } as any);
    canvasEl?.addEventListener('wheel', canvasHandler, { passive: false });
    timelineEl?.addEventListener('wheel', timelineHandler, { passive: false });
    return () => {
      rootEl?.removeEventListener('wheel', preventBrowserZoom);
      rootEl?.removeEventListener('gesturestart', preventGesture);
      rootEl?.removeEventListener('gesturechange', preventGesture);
      canvasEl?.removeEventListener('wheel', canvasHandler);
      timelineEl?.removeEventListener('wheel', timelineHandler);
    };
    // Re-run when data loads so refs are attached (early return hides them when data is null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);

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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId) {
        e.preventDefault();
        if (selectedMarkerTime !== null && selectedKfProp !== null) {
          deletePropKeyframe(selectedElementId, selectedKfProp as AnimatableProperty, selectedMarkerTime);
          setSelectedMarkerTime(null); setSelectedKfProp(null);
        } else if (selectedMarkerTime !== null) {
          deleteMarker(selectedElementId, selectedMarkerTime);
          setSelectedMarkerTime(null); setSelectedKfProp(null);
        } else {
          deleteElement(selectedElementId);
        }
      }
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
  }, [selectedElementId, selectedMarkerTime, selectedKfProp, deleteElement, deleteMarker, deletePropKeyframe, duplicateElement, handleUndo, handleRedo, handleCopy, handlePaste, handleCut, addMarkerAtPlayhead]);

  // ─── Title & Delete ───────────────────
  const handleTitleChange = useCallback(async (newTitle: string) => {
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
    downloadItem: () => setShowExportMenu(true),
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
  const dragIntentRef = useRef<{ prop: AnimatableProperty; value: number; lastKeyframeTime: number; origLastValue: number }[]>([]);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent, elId: string) => {
    if (!data || editingTextId === elId) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el || el.locked) return;
    e.stopPropagation();
    setSelectedElementId(elId);
    setSelectedMarkerTime(null); setSelectedKfProp(null);
    const snap = getElementSnapshotAt(el, currentTime - el.start);
    dragRef.current = { elId, startX: e.clientX, startY: e.clientY, origX: snap.x, origY: snap.y };
    dragIntentRef.current = [];

    const handleMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / zoom;
      const dy = (ev.clientY - d.startY) / zoom;
      const newX = Math.round(d.origX + dx);
      const newY = Math.round(d.origY + dy);
      const targetId = d.elId;
      const intentItems: typeof dragIntentRef.current = [];
      setData(prev => {
        if (!prev) return prev;
        const pel = prev.elements.find(x => x.id === targetId);
        if (!pel) return prev;
        const playheadLocal = currentTime - pel.start;
        const hasMarkers = pel.markers && pel.markers.length > 0;
        if (hasMarkers) {
          let updated = pel;
          for (const [prop, value] of [['x', newX], ['y', newY]] as [AnimatableProperty, number][]) {
            const outcome = applyPropertyChange(updated, prop, value, playheadLocal);
            if (outcome.kind === 'needs-intent') {
              const lastKfVal = getPropertyValueAt(updated, outcome.prop, outcome.lastKeyframeTime);
              intentItems.push({ prop: outcome.prop, value: outcome.value, lastKeyframeTime: outcome.lastKeyframeTime, origLastValue: lastKfVal });
              updated = applyPostAnimationIntent(updated, outcome.prop, outcome.value, outcome.lastKeyframeTime, outcome.playheadLocal, 'modify-last');
            } else if (outcome.kind !== 'rejected') {
              updated = outcome.element;
            }
          }
          return { ...prev, elements: prev.elements.map(e => e.id === targetId ? updated : e) };
        }
        return { ...prev, elements: prev.elements.map(e => e.id !== targetId ? e : { ...e, x: newX, y: newY }) };
      });
      if (intentItems.length > 0) dragIntentRef.current = intentItems;
    };
    const handleUp = () => {
      const d = dragRef.current;
      const intentItems = [...dragIntentRef.current];
      dragRef.current = null;
      dragIntentRef.current = [];
      if (d && intentItems.length > 0) {
        setData(prev => {
          if (!prev) return prev;
          const pel = prev.elements.find(x => x.id === d.elId);
          if (!pel) return prev;
          const playheadLocal = currentTime - pel.start;
          // Revert modify-last to original values, so intent dialog applies cleanly
          let reverted = pel;
          for (const item of intentItems) {
            reverted = upsertKeyframe(reverted, item.prop, item.lastKeyframeTime, item.origLastValue);
          }
          const next = { ...prev, elements: prev.elements.map(e => e.id === d.elId ? reverted : e) };
          undoRedo.push(next); scheduleSave(next);
          setPendingIntent({
            elementId: d.elId,
            prop: intentItems[0].prop,
            value: intentItems[0].value,
            lastKeyframeTime: intentItems[0].lastKeyframeTime,
            playheadLocal,
            batch: intentItems.map(i => ({ prop: i.prop, value: i.value, lastKeyframeTime: i.lastKeyframeTime })),
          });
          return next;
        });
      } else {
        setData(prev => { if (prev) { undoRedo.push(prev); scheduleSave(prev); } return prev; });
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, zoom, currentTime, editingTextId, undoRedo, scheduleSave]);

  // ─── Resize Handles ──────────────────
  const resizeRef = useRef<{ elId: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);
  const resizeIntentRef = useRef<{ prop: AnimatableProperty; value: number; lastKeyframeTime: number; origLastValue: number }[]>([]);

  const handleResizeStart = useCallback((e: React.PointerEvent, elId: string, handle: string) => {
    if (!data) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el) return;
    e.stopPropagation();
    e.preventDefault();
    const snap = getElementSnapshotAt(el, currentTime - el.start);
    resizeRef.current = { elId, handle, startX: e.clientX, startY: e.clientY, origX: snap.x, origY: snap.y, origW: snap.w, origH: snap.h };
    resizeIntentRef.current = [];

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
      const rX = Math.round(nX), rY = Math.round(nY), rW = Math.round(nW), rH = Math.round(nH);
      const intentItems: typeof resizeIntentRef.current = [];
      setData(prev => {
        if (!prev) return prev;
        const pel = prev.elements.find(x => x.id === r.elId);
        if (!pel) return prev;
        const playheadLocal = currentTime - pel.start;
        const hasMarkers = pel.markers && pel.markers.length > 0;
        if (hasMarkers) {
          let updated = pel;
          for (const [prop, value] of [['x', rX], ['y', rY], ['w', rW], ['h', rH]] as [AnimatableProperty, number][]) {
            const outcome = applyPropertyChange(updated, prop, value, playheadLocal);
            if (outcome.kind === 'needs-intent') {
              const lastKfVal = getPropertyValueAt(updated, outcome.prop, outcome.lastKeyframeTime);
              intentItems.push({ prop: outcome.prop, value: outcome.value, lastKeyframeTime: outcome.lastKeyframeTime, origLastValue: lastKfVal });
              updated = applyPostAnimationIntent(updated, outcome.prop, outcome.value, outcome.lastKeyframeTime, outcome.playheadLocal, 'modify-last');
            } else if (outcome.kind !== 'rejected') {
              updated = outcome.element;
            }
          }
          return { ...prev, elements: prev.elements.map(e => e.id === r.elId ? updated : e) };
        }
        return { ...prev, elements: prev.elements.map(e => e.id === r.elId ? { ...e, x: rX, y: rY, w: rW, h: rH } : e) };
      });
      if (intentItems.length > 0) resizeIntentRef.current = intentItems;
    };
    const handleUp = () => {
      const r = resizeRef.current;
      const intentItems = [...resizeIntentRef.current];
      resizeRef.current = null;
      resizeIntentRef.current = [];
      setData(prev => {
        if (!prev || !r) { if (prev) { undoRedo.push(prev); scheduleSave(prev); } return prev; }
        let pel = prev.elements.find(x => x.id === r.elId);
        if (!pel) { undoRedo.push(prev); scheduleSave(prev); return prev; }
        let elements = prev.elements;

        // Text auto-resize → fixed-width conversion
        if (pel.type === 'text' && /[ew]/.test(r.handle) && pel.html.includes('data-text-resize="auto"')) {
          let newHtml = pel.html
            .replace('data-text-resize="auto"', 'data-text-resize="fixed-width"')
            .replace(/white-space:\s*nowrap;?\s*/, 'white-space: normal; word-wrap: break-word; ');
          const measure = document.createElement('div');
          measure.style.cssText = `position:fixed;left:-99999px;top:0;visibility:hidden;width:${pel.w}px;`;
          measure.innerHTML = newHtml;
          document.body.appendChild(measure);
          const inner = measure.firstElementChild as HTMLElement | null;
          let newH = pel.h;
          if (inner) {
            inner.style.width = `${pel.w}px`;
            newH = Math.max(20, Math.ceil(inner.getBoundingClientRect().height));
          }
          document.body.removeChild(measure);
          elements = elements.map(x => x.id === r.elId ? { ...x, html: newHtml, h: newH } : x);
          pel = elements.find(x => x.id === r.elId)!;
        }

        if (intentItems.length > 0 && pel) {
          const playheadLocal = currentTime - pel.start;
          let reverted = pel;
          for (const item of intentItems) {
            reverted = upsertKeyframe(reverted, item.prop, item.lastKeyframeTime, item.origLastValue);
          }
          elements = elements.map(e => e.id === r.elId ? reverted : e);
          const next = { ...prev, elements };
          undoRedo.push(next); scheduleSave(next);
          setPendingIntent({
            elementId: r.elId,
            prop: intentItems[0].prop,
            value: intentItems[0].value,
            lastKeyframeTime: intentItems[0].lastKeyframeTime,
            playheadLocal,
            batch: intentItems.map(i => ({ prop: i.prop, value: i.value, lastKeyframeTime: i.lastKeyframeTime })),
          });
          return next;
        }

        const next = { ...prev, elements };
        undoRedo.push(next); scheduleSave(next);
        return next;
      });
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, zoom, currentTime, undoRedo, scheduleSave]);

  // ─── Text Double-Click ────────────────
  const handleDoubleClick = useCallback((elId: string) => {
    if (!data) return;
    const el = data.elements.find(e => e.id === elId);
    if (!el || el.type !== 'text') return;
    setEditingTextId(elId);
  }, [data]);

  // ─── Screen→Canvas coordinate conversion ────
  const canvasOuterRef = useRef<HTMLDivElement>(null);
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const el = canvasOuterRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  }, [zoom]);

  // ─── Drag-to-Create (text/shape) ──────
  const handleCanvasCreatePointerDown = useCallback((e: React.PointerEvent) => {
    if (!pendingInsert || !data) return;
    if (pendingInsert.type === 'line-draw') return; // line-draw handled separately
    e.preventDefault();
    e.stopPropagation();
    const pt = screenToCanvas(e.clientX, e.clientY);
    createDragRef.current = { startClientX: e.clientX, startClientY: e.clientY, origX: pt.x, origY: pt.y, insert: pendingInsert };

    const handleMove = (ev: PointerEvent) => {
      const d = createDragRef.current;
      if (!d) return;
      const cur = screenToCanvas(ev.clientX, ev.clientY);
      const x = Math.min(d.origX, cur.x);
      const y = Math.min(d.origY, cur.y);
      const w = Math.abs(cur.x - d.origX);
      const h = Math.abs(cur.y - d.origY);
      setCreatePreview({ x, y, w, h });
    };
    const handleUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const d = createDragRef.current;
      createDragRef.current = null;
      setCreatePreview(null);
      if (!d || !data) return;
      const cur = screenToCanvas(ev.clientX, ev.clientY);
      const dist = Math.hypot(ev.clientX - d.startClientX, ev.clientY - d.startClientY);
      const dragged = dist > 5;
      let x: number, y: number, w: number, h: number;
      if (dragged) {
        x = Math.round(Math.min(d.origX, cur.x));
        y = Math.round(Math.min(d.origY, cur.y));
        w = Math.round(Math.max(20, Math.abs(cur.x - d.origX)));
        h = Math.round(Math.max(20, Math.abs(cur.y - d.origY)));
      } else {
        if (d.insert.type === 'text') {
          w = 100; h = 32;
        } else if (d.insert.type === 'shape') {
          const def = SHAPE_MAP.get(d.insert.shapeType);
          w = (def?.width ?? 100) * 2;
          h = (def?.height ?? 100) * 2;
        } else {
          w = 200; h = 200;
        }
        x = Math.round(d.origX - w / 2);
        y = Math.round(d.origY - h / 2);
      }
      let html: string;
      let elType: string;
      let name: string;
      if (d.insert.type === 'text') {
        const isFixedWidth = dragged && w > 10;
        html = `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 24px; font-weight: 400; color: #000000; box-sizing: border-box; ${isFixedWidth ? 'white-space: normal; word-wrap: break-word;' : 'white-space: nowrap;'}" contenteditable="true" data-text-resize="${isFixedWidth ? 'fixed-width' : 'auto'}"></div>`;
        elType = 'text'; name = 'Text';
      } else if (d.insert.type === 'shape') {
        html = buildShapeHtml(d.insert.shapeType, w, h);
        elType = 'shape'; name = SHAPE_MAP.get(d.insert.shapeType)?.label ?? 'Shape';
      } else {
        return;
      }
      const newEl: VideoElement = {
        id: crypto.randomUUID(), type: elType,
        x, y, w, h, html,
        start: currentTime, duration: 3, z_index: data.elements.length + 1, name,
      };
      updateData(dd => ({ ...dd, elements: [...dd.elements, newEl] }));
      setSelectedElementId(newEl.id);
      setPendingInsert(null);
      if (d.insert.type === 'text') setEditingTextId(newEl.id);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [pendingInsert, data, screenToCanvas, currentTime, updateData]);

  // ─── Line Drawing Tool ────────────────
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

  const handleLineDrawPointerDown = useCallback((e: React.PointerEvent) => {
    if (!pendingInsert || pendingInsert.type !== 'line-draw' || !data) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = screenToCanvas(e.clientX, e.clientY);
    if (!lineDrawStart) {
      setLineDrawStart(pt);
    }
  }, [pendingInsert, data, screenToCanvas, lineDrawStart]);

  const handleLineDrawPointerMove = useCallback((e: React.PointerEvent) => {
    if (!lineDrawStart) return;
    let pt = screenToCanvas(e.clientX, e.clientY);
    pt = snapAngle(lineDrawStart, pt, e.shiftKey);
    setLineDrawEnd(pt);
  }, [lineDrawStart, screenToCanvas]);

  const handleLineDrawPointerUp = useCallback((e: React.PointerEvent) => {
    if (!lineDrawStart || !data) return;
    let pt = screenToCanvas(e.clientX, e.clientY);
    pt = snapAngle(lineDrawStart, pt, e.shiftKey);
    const x1 = Math.min(lineDrawStart.x, pt.x);
    const y1 = Math.min(lineDrawStart.y, pt.y);
    const x2 = Math.max(lineDrawStart.x, pt.x);
    const y2 = Math.max(lineDrawStart.y, pt.y);
    const pad = 4;
    const w = Math.max(x2 - x1 + pad * 2, 1);
    const h = Math.max(y2 - y1 + pad * 2, 1);
    const lx1 = lineDrawStart.x - x1 + pad;
    const ly1 = lineDrawStart.y - y1 + pad;
    const lx2 = pt.x - x1 + pad;
    const ly2 = pt.y - y1 + pad;
    const d = `M${Math.round(lx1)},${Math.round(ly1)} L${Math.round(lx2)},${Math.round(ly2)}`;
    const html = `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${d}" fill="none" stroke="#000000" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>`;
    const newEl: VideoElement = {
      id: crypto.randomUUID(), type: 'shape',
      x: Math.round(x1 - pad), y: Math.round(y1 - pad), w: Math.round(w), h: Math.round(h),
      html, start: currentTime, duration: 3, z_index: data.elements.length + 1, name: 'Line',
    };
    updateData(dd => ({ ...dd, elements: [...dd.elements, newEl] }));
    setSelectedElementId(newEl.id);
    setLineDrawStart(null);
    setLineDrawEnd(null);
    setPendingInsert(null);
  }, [lineDrawStart, data, screenToCanvas, currentTime, updateData]);

  // Escape to cancel pendingInsert
  useEffect(() => {
    if (!pendingInsert) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingInsert(null);
        setLineDrawStart(null);
        setLineDrawEnd(null);
        setCreatePreview(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingInsert]);

  // ─── Snap Helper ──────────────────────
  const getSnapTargets = useCallback((): number[] => {
    if (!data) return [];
    const targets: number[] = [];
    for (let i = 0; i <= Math.ceil(timelineDuration); i++) targets.push(i);
    for (const el of data.elements) {
      targets.push(el.start);
      targets.push(el.start + el.duration);
      for (const m of getMarkers(el)) targets.push(el.start + m);
      for (const list of Object.values(el.keyframes ?? {})) {
        if (!list) continue;
        for (const kf of list) targets.push(el.start + kf.t);
      }
    }
    return [...new Set(targets)].sort((a, b) => a - b);
  }, [data, timelineDuration]);

  const snapTime = useCallback((t: number, thresholdPx: number = 6): number => {
    const targets = getSnapTargets();
    const thresholdSec = thresholdPx / pxPerSec;
    let best = t;
    let bestDist = thresholdSec;
    for (const s of targets) {
      const dist = Math.abs(t - s);
      if (dist < bestDist) { bestDist = dist; best = s; }
    }
    return best;
  }, [getSnapTargets, pxPerSec]);

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
    setSelectedElementId(elId); setSelectedMarkerTime(null); setSelectedKfProp(null);
    const tw = timelineDuration * pxPerSec;
    timelineDragRef.current = { type, elId, startX: e.clientX, origStart: el.start, origDuration: el.duration, timelineWidth: tw };

    const handleMove = (ev: PointerEvent) => {
      const d = timelineDragRef.current;
      if (!d) return;
      const dxTime = ((ev.clientX - d.startX) / d.timelineWidth) * timelineDuration;
      setData(prev => {
        if (!prev) return prev;
        return { ...prev, elements: prev.elements.map(pel => {
          if (pel.id !== d.elId) return pel;
          if (d.type === 'move') {
            const raw = Math.max(0, d.origStart + dxTime);
            return { ...pel, start: Math.round(snapTime(raw) * 100) / 100 };
          }
          if (d.type === 'resize-left') {
            const rawNs = Math.max(0, Math.min(d.origStart + d.origDuration - 0.1, d.origStart + dxTime));
            const ns = Math.round(snapTime(rawNs) * 100) / 100;
            return { ...pel, start: ns, duration: Math.round((d.origDuration - (ns - d.origStart)) * 100) / 100 };
          }
          const rawEnd = d.origStart + Math.max(0.1, d.origDuration + dxTime);
          const snappedEnd = snapTime(rawEnd);
          return { ...pel, duration: Math.round(Math.max(0.1, snappedEnd - d.origStart) * 100) / 100 };
        }) };
      });
    };
    const handleUp = () => {
      const d = timelineDragRef.current;
      timelineDragRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);

      if (d && (d.type === 'resize-left' || d.type === 'resize-right')) {
        setData(prev => {
          if (!prev) return prev;
          const el = prev.elements.find(x => x.id === d.elId);
          if (!el) { undoRedo.push(prev); scheduleSave(prev); return prev; }

          const allMarkers = getMarkers(el);
          const allKfTimes = new Set<number>();
          for (const list of Object.values(el.keyframes ?? {})) {
            if (!list) continue;
            for (const kf of list) allKfTimes.add(kf.t);
          }
          const outsideMarkers = allMarkers.filter(t => t > el.duration + TIME_EPSILON);
          const outsideKfTimes = [...allKfTimes].filter(t => t > el.duration + TIME_EPSILON);
          const hasOutside = outsideMarkers.length > 0 || outsideKfTimes.length > 0;

          if (!hasOutside) { undoRedo.push(prev); scheduleSave(prev); return prev; }

          const count = new Set([...outsideMarkers, ...outsideKfTimes]).size;
          const ok = confirm(`${count} keyframe(s) fall outside the new duration and will be removed. Continue?`);
          if (!ok) {
            return { ...prev, elements: prev.elements.map(pel =>
              pel.id !== d.elId ? pel : { ...pel, start: d.origStart, duration: d.origDuration }
            ) };
          }

          const cleaned = { ...prev, elements: prev.elements.map(pel => {
            if (pel.id !== d.elId) return pel;
            const markers = (pel.markers ?? []).filter(t => t <= pel.duration + TIME_EPSILON);
            const keyframes: typeof pel.keyframes = {};
            for (const [prop, list] of Object.entries(pel.keyframes ?? {})) {
              if (!list) continue;
              const filtered = list.filter(kf => kf.t <= pel.duration + TIME_EPSILON);
              if (filtered.length > 0) keyframes[prop as keyof typeof keyframes] = filtered;
            }
            return { ...pel, markers, keyframes };
          }) };
          undoRedo.push(cleaned); scheduleSave(cleaned);
          return cleaned;
        });
      } else {
        setData(prev => { if (prev) { undoRedo.push(prev); scheduleSave(prev); } return prev; });
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, timelineDuration, pxPerSec, undoRedo, scheduleSave, snapTime]);

  /** Drag an existing marker along its element's local timeline. Cascades any
   *  property keyframes at that marker time so they follow the marker. */
  const markerDragState = useRef<{ elId: string; currentT: number; lastX: number; duration: number }>({ elId: '', currentT: 0, lastX: 0, duration: 1 });
  const handleMarkerDragStart = useCallback((e: React.PointerEvent, elId: string, markerTime: number, _trackEl: HTMLElement) => {
    if (!data) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el) return;
    e.stopPropagation(); e.preventDefault();
    markerDragState.current = { elId, currentT: markerTime, lastX: e.clientX, duration: el.duration };
    setSelectedMarkerTime(markerTime);

    const handleMove = (ev: PointerEvent) => {
      const s = markerDragState.current;
      const dxPx = ev.clientX - s.lastX;
      const dxTime = dxPx / pxPerSec;
      if (Math.abs(dxTime) < 0.001) return;
      const rawLocal = Math.max(TIME_EPSILON, Math.min(s.duration, s.currentT + dxTime));
      const elObj = data.elements.find(x => x.id === s.elId);
      const snappedGlobal = snapTime(rawLocal + (elObj?.start ?? 0));
      const newT = Math.max(TIME_EPSILON, Math.min(s.duration, Math.round((snappedGlobal - (elObj?.start ?? 0)) * 100) / 100));
      const oldT = s.currentT;
      if (Math.abs(newT - oldT) < TIME_EPSILON) return;
      s.currentT = newT;
      s.lastX = ev.clientX;
      setSelectedMarkerTime(newT);
      setData(prev => {
        if (!prev) return prev;
        return { ...prev, elements: prev.elements.map(pel => {
          if (pel.id !== s.elId) return pel;
          const markers = (pel.markers ?? []).map(m =>
            Math.abs(m - oldT) <= TIME_EPSILON ? newT : m,
          ).sort((a, b) => a - b);
          const keyframes: typeof pel.keyframes = {};
          for (const [prop, list] of Object.entries(pel.keyframes ?? {})) {
            if (!list) continue;
            keyframes[prop as keyof typeof keyframes] = list
              .map(k => Math.abs(k.t - oldT) <= TIME_EPSILON ? { ...k, t: newT } : k)
              .sort((a, b) => a.t - b.t);
          }
          return { ...pel, markers, keyframes };
        }) };
      });
    };
    const handleUp = () => {
      setData(prev => { if (prev) { undoRedo.push(prev); scheduleSave(prev); } return prev; });
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, pxPerSec, undoRedo, scheduleSave, snapTime]);

  // ─── Playhead Drag ────────────────────
  const playheadDragRef = useRef<{ startX: number; startTime: number; trackWidth: number } | null>(null);
  const handlePlayheadDragStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const tw = timelineDuration * pxPerSec;
    playheadDragRef.current = { startX: e.clientX, startTime: currentTime, trackWidth: tw };
    const handleMove = (ev: PointerEvent) => {
      const d = playheadDragRef.current;
      if (!d) return;
      const dxSec = ((ev.clientX - d.startX) / d.trackWidth) * timelineDuration;
      const raw = Math.max(0, Math.min(totalDuration, d.startTime + dxSec));
      setCurrentTime(snapTime(raw));
    };
    const handleUp = () => {
      playheadDragRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [currentTime, timelineDuration, pxPerSec, totalDuration, snapTime]);

  // ─── Property Keyframe Drag ───────────
  const propKfDragState = useRef<{
    elId: string; prop: AnimatableProperty; currentT: number;
    lastX: number; duration: number; elStart: number;
  }>({ elId: '', prop: 'x', currentT: 0, lastX: 0, duration: 1, elStart: 0 });

  const handlePropKfDragStart = useCallback((e: React.PointerEvent, elId: string, prop: AnimatableProperty, kfTime: number, _barEl: HTMLElement) => {
    if (!data) return;
    const el = data.elements.find(x => x.id === elId);
    if (!el) return;
    e.stopPropagation(); e.preventDefault();
    propKfDragState.current = {
      elId, prop, currentT: kfTime,
      lastX: e.clientX, duration: el.duration, elStart: el.start,
    };
    setSelectedElementId(elId);
    setSelectedMarkerTime(kfTime);

    const handleMove = (ev: PointerEvent) => {
      const s = propKfDragState.current;
      const dxPx = ev.clientX - s.lastX;
      const dxTime = dxPx / pxPerSec;
      if (Math.abs(dxTime) < 0.001) return;
      const rawLocal = Math.max(TIME_EPSILON, Math.min(s.duration, s.currentT + dxTime));
      const snappedGlobal = snapTime(rawLocal + s.elStart);
      const newT = Math.max(TIME_EPSILON, Math.min(s.duration, Math.round((snappedGlobal - s.elStart) * 100) / 100));
      const oldT = s.currentT;
      if (Math.abs(newT - oldT) < TIME_EPSILON) return;
      s.currentT = newT;
      s.lastX = ev.clientX;
      setSelectedMarkerTime(newT);
      setData(prev => {
        if (!prev) return prev;
        return { ...prev, elements: prev.elements.map(pel => {
          if (pel.id !== s.elId) return pel;
          const markers = pel.markers ?? [];
          const propsAtOldTime = Object.entries(pel.keyframes ?? {}).filter(
            ([, list]) => list?.some(k => Math.abs(k.t - oldT) <= TIME_EPSILON)
          );
          const onlyOnePropAtTime = propsAtOldTime.length <= 1;
          if (onlyOnePropAtTime) {
            const newMarkers = markers.map(m => Math.abs(m - oldT) <= TIME_EPSILON ? newT : m).sort((a, b) => a - b);
            const newKf: typeof pel.keyframes = {};
            for (const [p, list] of Object.entries(pel.keyframes ?? {})) {
              if (!list) continue;
              newKf[p as keyof typeof newKf] = list
                .map(k => Math.abs(k.t - oldT) <= TIME_EPSILON ? { ...k, t: newT } : k)
                .sort((a, b) => a.t - b.t);
            }
            return { ...pel, markers: newMarkers, keyframes: newKf };
          }
          const newKf: typeof pel.keyframes = { ...(pel.keyframes ?? {}) };
          const propList = (newKf[s.prop] ?? []).map(k =>
            Math.abs(k.t - oldT) <= TIME_EPSILON ? { ...k, t: newT } : k
          ).sort((a, b) => a.t - b.t);
          newKf[s.prop] = propList;
          let newMarkers = [...markers];
          if (!newMarkers.some(m => Math.abs(m - newT) <= TIME_EPSILON)) {
            newMarkers.push(newT);
            newMarkers.sort((a, b) => a - b);
          }
          return { ...pel, markers: newMarkers, keyframes: newKf };
        }) };
      });
    };
    const handleUp = () => {
      setData(prev => { if (prev) { undoRedo.push(prev); scheduleSave(prev); } return prev; });
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [data, pxPerSec, snapTime, undoRedo, scheduleSave]);

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
    <div ref={editorRootRef} className="flex-1 flex flex-row min-h-0" style={{ touchAction: 'pan-x pan-y' }}>
      <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] md:overflow-hidden relative z-[1]">
        {/* Top Bar */}
        <div className="flex items-center border-b border-border shrink-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
          <ContentTopBar breadcrumb={breadcrumb} onNavigate={onNavigate} onBack={onBack}
            docListVisible={docListVisible} onToggleDocList={onToggleDocList}
            title={title} titlePlaceholder="Untitled Video" onTitleChange={handleTitleChange}
            metaLine={updatedAt ? (
              <button onClick={() => setShowRevisions(true)}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer">
                {t('content.lastModified')}: {formatRelativeTime(updatedAt)}
                {updatedBy && <span> {t('content.by')} {updatedBy}</span>}
              </button>
            ) : undefined}
            statusText={saveStatus}
            actions={renderFixedTopBarActions(fixedActions, { t, ctx: topBarCtx as any })}
            menuItems={menuItems}
            onHistory={() => setShowRevisions(v => !v)} onComments={onToggleComments} />
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
            {/* Revision preview overlay */}
            {previewRevisionData && previewRevisionMeta && (
              <div className="absolute inset-0 flex flex-col bg-card" style={{ zIndex: 11000 }}
                onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <RevisionPreviewBanner
                  createdAt={previewRevisionMeta.created_at}
                  onExit={() => { setPreviewRevisionData(null); setPreviewRevisionMeta(null); }}
                  onRestore={async () => {
                    if (!confirm(t('content.restoreVersionWarning', { type: 'video' }))) return;
                    try {
                      const result = await gw.restoreContentRevision(contentId, previewRevisionMeta.id);
                      const restored = result?.data ? migrateVideoData(result.data) : null;
                      if (restored) { setData(restored); scheduleSave(restored); }
                      setPreviewRevisionData(null); setPreviewRevisionMeta(null); setShowRevisions(false);
                    } catch (e: unknown) {
                      alert(e instanceof Error ? e.message : t('content.restoreVersionFailed'));
                    }
                  }}
                />
                <div className="flex-1 overflow-auto flex items-center justify-center bg-muted/30 p-6">
                  <VideoRevisionPreview data={previewRevisionData} />
                </div>
              </div>
            )}
            {/* Canvas Preview */}
            <div ref={canvasContainerRef} className="flex-1 flex items-center justify-center overflow-hidden relative"
              style={{ background: '#F5F7F5', cursor: pendingInsert ? 'crosshair' : 'default' }}
              onClick={() => { if (!pendingInsert) { setSelectedElementId(null); setSelectedMarkerTime(null); setSelectedKfProp(null); setShowShapes(false); } }}>

              {/* Floating Toolbar (Canvas style) */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 bg-card rounded border border-black/10 dark:border-white/10 px-3 h-10 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]"
                onClick={e => e.stopPropagation()}>
                <div className="relative">
                  <ToolBtn icon={Hexagon} onClick={() => setShowShapes(v => !v)} active={showShapes || (pendingInsert?.type === 'shape')} title="Shapes" />
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
                            <button key={type} onClick={() => { startShapeInsert(type); setShowShapes(false); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors text-left">
                              <span className="font-medium">{label}</span>
                            </button>
                          ))}
                          <div className="my-1 border-t" />
                          <button onClick={() => { fileInputRef.current?.click(); setShowShapes(false); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                            <ImagePlus className="h-3.5 w-3.5" /> Upload SVG
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <ToolBtn icon={LineIcon} onClick={startLineInsert} active={pendingInsert?.type === 'line-draw'} title="Line (click two points, Shift for angle snap)" />
                <ToolBtn icon={Type} onClick={startTextInsert} title="Add Text" />
                <ToolBtn icon={ImagePlus} onClick={() => fileInputRef.current?.click()} title="Image" />
                <div className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />
                <ToolBtn icon={Undo2} onClick={handleUndo} disabled={!undoRedo.canUndo} title="Undo" />
                <ToolBtn icon={Redo2} onClick={handleRedo} disabled={!undoRedo.canRedo} title="Redo" />
              </div>

              {/* Image upload button (hidden) */}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

              {/* Canvas — outer container at screen pixels, inner at native size scaled via CSS transform */}
              <div ref={canvasOuterRef} style={{
                width: data.settings.width * zoom,
                height: data.settings.height * zoom,
                position: 'relative',
                cursor: pendingInsert ? 'crosshair' : undefined,
              }} className="shadow-2xl overflow-hidden"
                onDrop={handleVideoDrop} onDragOver={handleVideoDragOver}
                onPointerDown={pendingInsert?.type === 'line-draw' ? handleLineDrawPointerDown : pendingInsert ? handleCanvasCreatePointerDown : undefined}
                onPointerMove={pendingInsert?.type === 'line-draw' ? handleLineDrawPointerMove : undefined}
                onPointerUp={pendingInsert?.type === 'line-draw' ? handleLineDrawPointerUp : undefined}>
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

                  const isAutoEditing = isEditing && el.html.includes('data-text-resize="auto"');
                  return (
                    <div key={el.id}
                      className={cn("absolute", !isEditing && "cursor-move")}
                      style={{
                        left: snap.x - (snap.w * snap.scale - snap.w) / 2,
                        top: snap.y - (snap.h * snap.scale - snap.h) / 2,
                        width: isAutoEditing ? 'auto' : snap.w * snap.scale,
                        height: isAutoEditing ? 'auto' : snap.h * snap.scale,
                        opacity: snap.opacity,
                        transform: `rotate(${snap.rotation}deg)`,
                        transformOrigin: 'center center',
                        zIndex: el.z_index ?? 0,
                      }}
                      onClick={(e) => { e.stopPropagation(); setSelectedElementId(el.id); setSelectedMarkerTime(null); setSelectedKfProp(null); }}
                      onContextMenu={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        setSelectedElementId(el.id);
                        const items = [
                          { id: 'duplicate', label: 'Duplicate', onClick: () => duplicateElement(el.id) },
                          { id: 'delete', label: 'Delete', onClick: () => deleteElement(el.id), danger: true },
                          { id: 'comment', label: 'Add Comment', onClick: () => handleVideoComment(el), separator: true },
                        ];
                        window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { items, x: e.clientX, y: e.clientY } }));
                      }}
                      onPointerDown={(e) => handleCanvasPointerDown(e, el.id)}
                      onDoubleClick={() => handleDoubleClick(el.id)}
                    >
                      {isEditing ? (
                        <EditingHost
                          element={el}
                          zoom={zoom}
                          onDone={(newHtml) => {
                            setEditingTextId(null);
                            if (newHtml) updateElement(el.id, { html: newHtml });
                          }}
                          onSizeChange={(w, h) => {
                            updateElement(el.id, { w, h, x: el.x + (el.w - w) / 2, y: el.y + (el.h - h) / 2 });
                          }}
                        />
                      ) : (
                        <StableHtml html={applyAnimatedStyleOverrides(el.html, snap, el)} />
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

                {/* Create preview rect (drag-to-create) */}
                {createPreview && (
                  <div style={{
                    position: 'absolute',
                    left: createPreview.x, top: createPreview.y,
                    width: createPreview.w, height: createPreview.h,
                    border: '2px dashed #3b82f6',
                    background: 'rgba(59,130,246,0.08)',
                    pointerEvents: 'none', zIndex: 9999,
                  }} />
                )}

                {/* Line draw preview */}
                {lineDrawStart && lineDrawEnd && (
                  <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>
                    <line x1={lineDrawStart.x} y1={lineDrawStart.y} x2={lineDrawEnd.x} y2={lineDrawEnd.y}
                      stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 3" />
                    <circle cx={lineDrawStart.x} cy={lineDrawStart.y} r={4} fill="#3b82f6" stroke="white" strokeWidth={1.5} />
                    <circle cx={lineDrawEnd.x} cy={lineDrawEnd.y} r={4} fill="#3b82f6" stroke="white" strokeWidth={1.5} />
                  </svg>
                )}
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
            <div style={{ height: timelineHeight }} className="border-t border-border flex flex-col shrink-0 bg-card relative">
              {/* Resize handle at top */}
              <div className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-20 hover:bg-primary/10"
                onPointerDown={(e) => {
                  e.preventDefault();
                  timelineResizeRef.current = { startY: e.clientY, origH: timelineHeight };
                  const move = (ev: PointerEvent) => {
                    const d = timelineResizeRef.current;
                    if (!d) return;
                    setTimelineHeight(Math.max(120, d.origH - (ev.clientY - d.startY)));
                  };
                  const up = () => {
                    timelineResizeRef.current = null;
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }} />
              {/* Playback controls */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
                <button onClick={() => { setCurrentTime(0); setPlaying(false); }} className="p-1 rounded hover:bg-accent"><SkipBack className="w-3.5 h-3.5" /></button>
                <button onClick={() => setPlaying(p => !p)} className="p-1 rounded hover:bg-accent">
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button onClick={() => { setCurrentTime(totalDuration); setPlaying(false); }} className="p-1 rounded hover:bg-accent"><SkipForward className="w-3.5 h-3.5" /></button>
                <span className="text-xs text-muted-foreground font-mono">{formatTime(currentTime)} / {formatTime(totalDuration)}</span>
                {selectedElementId && selectedMarkerTime !== null && (
                  <button onClick={() => {
                    if (selectedKfProp) deletePropKeyframe(selectedElementId, selectedKfProp as AnimatableProperty, selectedMarkerTime);
                    else deleteMarker(selectedElementId, selectedMarkerTime);
                    setSelectedMarkerTime(null); setSelectedKfProp(null);
                  }}
                    className="p-1 rounded hover:bg-destructive/20 text-destructive" title={selectedKfProp ? `Delete ${selectedKfProp} keyframe (Del)` : "Delete all keyframes at this time (Del)"}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {(() => {
                  if (!selectedElementId) return null;
                  const sel = data?.elements.find(x => x.id === selectedElementId);
                  if (!sel) return null;
                  const localT = currentTime - sel.start;
                  const inLifespan = localT >= 0 && localT <= sel.duration;
                  const atT0 = localT <= TIME_EPSILON;
                  const alreadyHasMarker = isOnMarker(sel, localT);
                  if (!inLifespan || atT0 || alreadyHasMarker) return null;
                  return (
                    <button
                      onClick={() => addMarkerAtPlayhead(selectedElementId)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-blue-500 hover:bg-blue-500/10 border border-blue-500/30"
                      title="Add keyframe at current time (K)">
                      <Diamond className="w-3 h-3" />Add Keyframe
                    </button>
                  );
                })()}
                <div className="flex-1" />
                <button onClick={() => setPxPerSec(p => Math.max(20, p * 0.8))} className="p-1 rounded hover:bg-accent"><Minus className="w-3 h-3" /></button>
                <span className="text-[10px] text-muted-foreground w-8 text-center">{Math.round(pxPerSec)}px</span>
                <button onClick={() => setPxPerSec(p => Math.min(400, p * 1.25))} className="p-1 rounded hover:bg-accent"><Plus className="w-3 h-3" /></button>
              </div>
              {/* Scrollable tracks area with sticky ruler */}
              {(() => {
                const trackContentWidth = Math.max(timelineDuration * pxPerSec, 200);
                const rulerStep = pxPerSec >= 200 ? 0.1 : pxPerSec >= 80 ? 0.5 : pxPerSec >= 40 ? 1 : pxPerSec >= 20 ? 2 : 5;
                const labelStep = pxPerSec >= 200 ? 0.5 : pxPerSec >= 80 ? 1 : pxPerSec >= 40 ? 2 : pxPerSec >= 20 ? 5 : 10;
                const rulerCount = Math.ceil(timelineDuration / rulerStep) + 1;
                return (
              <div ref={timelineScrollRef} className="flex-1 overflow-auto">
                {/* Sticky ruler row */}
                <div className="sticky top-0 z-10 flex bg-muted/30 border-b border-border">
                  <div className="w-[200px] shrink-0" />
                  <div className="relative h-6 cursor-pointer" style={{ width: trackContentWidth }}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const raw = ((e.clientX - rect.left) / trackContentWidth) * timelineDuration;
                      setCurrentTime(snapTime(Math.max(0, Math.min(totalDuration, raw))));
                    }}>
                    {Array.from({ length: rulerCount }, (_, i) => {
                      const t = i * rulerStep;
                      if (t > timelineDuration) return null;
                      const isLabel = Math.abs(t - Math.round(t / labelStep) * labelStep) < rulerStep * 0.01;
                      return (
                        <div key={t} className="absolute top-0 h-full border-l border-border/40" style={{ left: t * pxPerSec }}>
                          {isLabel && <span className="text-[10px] text-muted-foreground ml-1 whitespace-nowrap">{t % 1 === 0 ? `${t}s` : `${t.toFixed(1)}s`}</span>}
                        </div>
                      );
                    })}
                    {/* Playhead (draggable) */}
                    <div className="absolute top-0 h-[2000px] w-0.5 bg-red-500 z-10" style={{ left: currentTime * pxPerSec, pointerEvents: 'none' }}>
                      <div className="w-3 h-3 bg-red-500 rounded-sm -ml-[5px] -mt-0.5 pointer-events-auto cursor-grab active:cursor-grabbing"
                        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)' }}
                        onPointerDown={handlePlayheadDragStart} />
                    </div>
                  </div>
                </div>
                {/* Layer tracks */}
                {[...data.elements].sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0)).map((el, idx, sorted) => {
                  const markers = getMarkers(el);
                  const isHidden = el.visible === false;
                  const isLocked = !!el.locked;
                  const canMoveUp = idx > 0;
                  const canMoveDown = idx < sorted.length - 1;
                  const animatedProps = (Object.keys(el.keyframes ?? {}) as AnimatableProperty[])
                    .filter(p => (el.keyframes?.[p]?.length ?? 0) > 0);
                  const hasAnimation = animatedProps.length > 0;
                  const isExpanded = expandedTracks.has(el.id) && hasAnimation;
                  return (
                    <React.Fragment key={el.id}>
                    <div data-timeline-track className={cn("flex items-center h-8 border-b border-border/50", selectedElementId === el.id && "bg-accent/30", isHidden && "opacity-50")}
                      onClick={() => { setSelectedElementId(el.id); setSelectedMarkerTime(null); setSelectedKfProp(null); }}>
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
                        onMoveDown={() => moveZIndex(el.id, 'down')}
                        onDelete={() => deleteElement(el.id)}
                        onDuplicate={() => duplicateElement(el.id)}
                        onComment={() => handleVideoComment(el)} />
                      <div className="relative h-full" style={{ width: trackContentWidth }}>
                        <div className={cn("absolute top-1 bottom-1 rounded-sm group", selectedElementId === el.id ? "bg-blue-500/60" : "bg-blue-500/30")}
                          style={{ left: el.start * pxPerSec, width: el.duration * pxPerSec }}
                          onContextMenu={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            const localT = currentTime - el.start;
                            const inLifespan = localT >= 0 && localT <= el.duration;
                            const atT0 = localT <= TIME_EPSILON;
                            const alreadyHas = isOnMarker(el, localT);
                            const canAddKf = inLifespan && !atT0 && !alreadyHas;
                            const items = [
                              ...(canAddKf ? [{ id: 'add-kf', label: 'Add Keyframe', onClick: () => addMarkerAtPlayhead(el.id) }] : []),
                              { id: 'duplicate', label: 'Duplicate', onClick: () => duplicateElement(el.id), ...(canAddKf ? { separator: true } : {}) },
                              { id: 'delete', label: 'Delete', onClick: () => deleteElement(el.id), danger: true },
                              { id: 'comment', label: 'Add Comment', onClick: () => handleVideoComment(el), separator: true },
                            ];
                            window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { items, x: e.clientX, y: e.clientY } }));
                          }}>
                          <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/60 rounded-l-sm"
                            onPointerDown={(e) => handleTimelinePointerDown(e, 'resize-left', el.id, e.currentTarget.parentElement!)} />
                          <div className="absolute left-1.5 right-1.5 top-0 bottom-0 cursor-grab active:cursor-grabbing"
                            onPointerDown={(e) => handleTimelinePointerDown(e, 'move', el.id, e.currentTarget.parentElement!)} />
                          <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/60 rounded-r-sm"
                            onPointerDown={(e) => handleTimelinePointerDown(e, 'resize-right', el.id, e.currentTarget.parentElement!)} />
                          {markers.map(t => (
                            <div key={t} className={cn("absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 border cursor-pointer z-10",
                              selectedElementId === el.id && selectedMarkerTime !== null && selectedKfProp === null && Math.abs(selectedMarkerTime - t) <= TIME_EPSILON
                                ? "bg-emerald-400 border-emerald-600 scale-[1.2] ring-2 ring-emerald-400/40"
                                : "bg-yellow-400 border-yellow-600")}
                              style={{ left: t / el.duration * 100 + '%', marginLeft: -5 }}
                              onClick={(e) => { e.stopPropagation(); setSelectedElementId(el.id); setSelectedMarkerTime(t); setSelectedKfProp(null); setCurrentTime(el.start + t); }}
                              onPointerDown={(e) => handleMarkerDragStart(e, el.id, t, e.currentTarget.parentElement!)}
                              onContextMenu={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                window.dispatchEvent(new CustomEvent('show-context-menu', { detail: {
                                  items: [{ id: 'del', label: 'Delete Keyframe', onClick: () => { deleteMarker(el.id, t); setSelectedMarkerTime(null); setSelectedKfProp(null); }, danger: true }],
                                  x: e.clientX, y: e.clientY,
                                } }));
                              }}
                              title={`Keyframe at ${t.toFixed(2)}s — click to seek, drag to move, right-click to delete`} />
                          ))}
                        </div>
                      </div>
                    </div>
                    {isExpanded && animatedProps.map(prop => {
                      const list = (el.keyframes?.[prop] ?? []).slice().sort((a, b) => a.t - b.t);
                      return (
                        <div key={`${el.id}-${prop}`}
                          className={cn('flex items-center h-6 border-b border-border/30', isHidden && 'opacity-50')}>
                          <div className="w-[200px] shrink-0 pl-10 pr-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="truncate">{prop}</span>
                            <span className="text-muted-foreground/60">({list.length})</span>
                          </div>
                          <div className="relative h-full" style={{ width: trackContentWidth }}>
                            <div className="absolute top-1 bottom-1 rounded-sm bg-yellow-500/10 border border-yellow-500/20"
                              style={{ left: el.start * pxPerSec, width: el.duration * pxPerSec }}>
                              {list.map(kf => {
                                const isKfSelected = selectedElementId === el.id && selectedMarkerTime !== null && Math.abs(selectedMarkerTime - kf.t) <= TIME_EPSILON
                                  && (selectedKfProp === null || selectedKfProp === prop);
                                return (
                                <div
                                  key={kf.t}
                                  className={cn("absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 border cursor-pointer z-10",
                                    isKfSelected ? "bg-emerald-400 border-emerald-600 scale-[1.2] ring-2 ring-emerald-400/40" : "bg-yellow-400 border-yellow-600")}
                                  style={{ left: `${(kf.t / el.duration) * 100}%`, marginLeft: -4 }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedElementId(el.id);
                                    setSelectedMarkerTime(kf.t);
                                    setSelectedKfProp(prop);
                                    setCurrentTime(el.start + kf.t);
                                  }}
                                  onPointerDown={(e) => handlePropKfDragStart(e, el.id, prop as AnimatableProperty, kf.t, e.currentTarget.parentElement!)}
                                  onContextMenu={(e) => {
                                    e.preventDefault(); e.stopPropagation();
                                    window.dispatchEvent(new CustomEvent('show-context-menu', { detail: {
                                      items: [{ id: 'del', label: `Delete ${prop} Keyframe`, onClick: () => deletePropKeyframe(el.id, prop, kf.t), danger: true }],
                                      x: e.clientX, y: e.clientY,
                                    } }));
                                  }}
                                  title={`${prop} = ${kf.value.toFixed(2)} at ${kf.t.toFixed(2)}s${kf.easing ? ` · easing in: ${kf.easing}` : ''} — drag to move, right-click to delete`} />
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </React.Fragment>
                  );
                })}
              </div>
                );
              })()}
            </div>
          </div>

          {/* Right Panel — always visible, 240px matching Canvas */}
          <div className="w-[240px] border-l border-border bg-white shrink-0 overflow-y-auto hidden md:block">
            {selectedElement ? (
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
              <SettingsPanel settings={data.settings} onUpdate={updateSettings} />
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
            anchorType={commentAnchor?.type}
            anchorId={commentAnchor?.id}
            anchorMeta={commentAnchor?.meta}
            onAnchorUsed={() => setCommentAnchor(null)}
            onNavigateToAnchor={navigateToAnchor}
          />
        </div>
      )}
      {showRevisions && (
        <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
          <RevisionHistory contentId={contentId} contentType="video"
            selectedRevisionId={previewRevisionMeta?.id ?? null}
            onClose={() => { setShowRevisions(false); setPreviewRevisionData(null); setPreviewRevisionMeta(null); }}
            onCreateManualVersion={async () => { await gw.createContentManualSnapshot(contentId); }}
            onSelectRevision={(rev) => {
              if (!rev) { setPreviewRevisionData(null); setPreviewRevisionMeta(null); return; }
              setPreviewRevisionData(migrateVideoData(rev.data));
              setPreviewRevisionMeta({ id: rev.id, created_at: rev.created_at });
            }}
            onRestore={(revisionData) => {
              const d = migrateVideoData(revisionData);
              setData(d); scheduleSave(d);
              setShowRevisions(false);
              setPreviewRevisionData(null); setPreviewRevisionMeta(null);
            }} />
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

      {/* Export format picker (triggered from more-menu Download) */}
      {showExportMenu && !exportProgress && (
        <div className="fixed inset-0 z-[10100] bg-black/40 flex items-center justify-center" onClick={() => setShowExportMenu(false)}>
          <div className="bg-card rounded-lg shadow-2xl w-[280px] border border-border" onClick={e => e.stopPropagation()}>
            <div className="px-4 pt-4 pb-2">
              <h3 className="text-sm font-semibold">Export Video</h3>
              <p className="text-xs text-muted-foreground mt-1">Choose export format</p>
            </div>
            <div className="px-2 pb-2 space-y-1">
              <button onClick={() => handleExport('mp4')}
                className="w-full text-left px-3 py-2.5 rounded hover:bg-accent">
                <div className="text-xs font-medium">MP4 (H.264)</div>
                <div className="text-[10px] text-muted-foreground">Universal · slower</div>
              </button>
              <button onClick={() => handleExport('webm')}
                className="w-full text-left px-3 py-2.5 rounded hover:bg-accent">
                <div className="text-xs font-medium">WebM (VP9)</div>
                <div className="text-[10px] text-muted-foreground">Faster · web-friendly</div>
              </button>
            </div>
            <div className="px-4 pb-3 flex justify-end">
              <button onClick={() => setShowExportMenu(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export progress modal (Phase 6). */}
      {exportProgress && (
        <ExportProgressDialog
          pct={exportProgress.pct}
          label={exportProgress.label}
          onCancel={cancelExport} />
      )}
    </div>
  );
}

// ─── Export Progress Dialog ────────

function ExportProgressDialog({ pct, label, onCancel }: {
  pct: number; label: string; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[10100] bg-black/40 flex items-center justify-center">
      <div className="bg-card rounded-lg shadow-2xl w-[420px] p-5 border border-border">
        <h3 className="text-sm font-semibold mb-2">Exporting video…</h3>
        <p className="text-xs text-muted-foreground mb-4">{label} · {pct}%</p>
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

// ─── Revision Preview ─────────────────────

function VideoRevisionPreview({ data }: { data: VideoData }) {
  const { settings, elements } = data;
  const maxW = 800;
  const scale = settings.width > 0 ? Math.min(1, maxW / settings.width) : 1;
  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="rounded-lg border border-border shadow-sm overflow-hidden bg-card">
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <span className="text-xs font-medium">Video Preview (t=0)</span>
          <span className="ml-2 text-[11px] text-muted-foreground">{settings.width} × {settings.height}</span>
          <span className="ml-2 text-[11px] text-muted-foreground">{elements.length} elements</span>
        </div>
        <div className="relative" style={{
          width: settings.width * scale,
          height: settings.height * scale,
          background: settings.background_color ?? '#000',
        }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: settings.width, height: settings.height, position: 'relative' }}>
            {elements.filter(el => el.visible !== false).map(el => {
              const snap = getElementSnapshotAt(el, 0);
              const scaledW = snap.w * snap.scale;
              const scaledH = snap.h * snap.scale;
              return (
                <div key={el.id} style={{
                  position: 'absolute',
                  left: snap.x - (scaledW - snap.w) / 2,
                  top: snap.y - (scaledH - snap.h) / 2,
                  width: scaledW,
                  height: scaledH,
                  opacity: snap.opacity,
                  transform: `rotate(${snap.rotation}deg)`,
                  transformOrigin: 'center center',
                  zIndex: el.z_index ?? 0,
                  overflow: 'hidden',
                }} dangerouslySetInnerHTML={{ __html: el.html }} />
              );
            })}
          </div>
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

// ─── Stroke Settings Popover (mirrors Canvas StrokeSettingsPopover) ─────
function VideoStrokeSettingsPopover({
  strokeDash, strokeLinecap, markerStart, markerEnd, isOpenPath,
  onChangeDash, onChangeCap, onChangeMarkerStart, onChangeMarkerEnd,
}: {
  strokeDash: string; strokeLinecap: string; markerStart: string; markerEnd: string;
  isOpenPath: boolean;
  onChangeDash: (v: string) => void; onChangeCap: (v: string) => void;
  onChangeMarkerStart: (v: string) => void; onChangeMarkerEnd: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative">
      <button ref={btnRef}
        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
        onClick={() => setOpen(v => !v)} title="Stroke settings">
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div ref={popRef}
          className="absolute right-0 top-7 z-50 w-[220px] rounded-md border border-border bg-card shadow-lg p-3 space-y-2">
          <div>
            <SubsectionHeader>Dash</SubsectionHeader>
            <select value={strokeDash} onChange={e => onChangeDash(e.target.value)} className={SELECT_CLASS}>
              <option value="">Solid</option>
              <option value="8 4">Dashed</option>
              <option value="2 2">Dotted</option>
              <option value="12 4 4 4">Dash-dot</option>
            </select>
          </div>
          {isOpenPath && (
            <>
              <div>
                <SubsectionHeader>Cap</SubsectionHeader>
                <select value={strokeLinecap} onChange={e => onChangeCap(e.target.value)} className={SELECT_CLASS}>
                  <option value="butt">Butt</option>
                  <option value="round">Round</option>
                  <option value="square">Square</option>
                </select>
              </div>
              <div>
                <SubsectionHeader>Start</SubsectionHeader>
                <select value={markerStart} onChange={e => onChangeMarkerStart(e.target.value)} className={SELECT_CLASS}>
                  <option value="none">None</option>
                  <option value="arrow">Arrow</option>
                  <option value="triangle">Triangle</option>
                  <option value="triangle-reversed">Triangle Rev.</option>
                  <option value="circle">Circle</option>
                  <option value="diamond">Diamond</option>
                </select>
              </div>
              <div>
                <SubsectionHeader>End</SubsectionHeader>
                <select value={markerEnd} onChange={e => onChangeMarkerEnd(e.target.value)} className={SELECT_CLASS}>
                  <option value="none">None</option>
                  <option value="arrow">Arrow</option>
                  <option value="triangle">Triangle</option>
                  <option value="triangle-reversed">Triangle Rev.</option>
                  <option value="circle">Circle</option>
                  <option value="diamond">Diamond</option>
                </select>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Text Settings Popover (mirrors Canvas TextSettingsPopover) ─────
function VideoTextSettingsPopover({
  textAlign, textDecoration,
  onChangeAlign, onChangeDecoration,
}: {
  textAlign: string; textDecoration: string;
  onChangeAlign: (v: string) => void; onChangeDecoration: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative">
      <button ref={btnRef}
        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
        onClick={() => setOpen(v => !v)} title="Text settings">
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div ref={popRef}
          className="absolute right-0 top-7 z-50 w-[220px] rounded-md border border-border bg-card shadow-lg p-3 space-y-2">
          <div>
            <SubsectionHeader>Justify</SubsectionHeader>
            <button
              className={cn('w-full h-6 text-[10px] flex items-center justify-center rounded transition-colors',
                textAlign === 'justify'
                  ? 'bg-white text-foreground ring-1 ring-border'
                  : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
              onClick={() => onChangeAlign(textAlign === 'justify' ? 'left' : 'justify')}>
              {textAlign === 'justify' ? 'On' : 'Off'}
            </button>
          </div>
          <div>
            <SubsectionHeader>Decoration</SubsectionHeader>
            <div className="grid grid-cols-3 gap-0.5">
              {([
                ['none', Minus, 'None'],
                ['underline', Underline, 'Underline'],
                ['line-through', Strikethrough, 'Strikethrough'],
              ] as const).map(([d, Icon, title]) => (
                <button key={d}
                  className={cn('h-6 flex items-center justify-center rounded transition-colors',
                    (textDecoration ?? 'none') === d
                      ? 'bg-white text-foreground ring-1 ring-border'
                      : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
                  onClick={() => onChangeDecoration(d)}
                  title={title}>
                  <Icon className="w-3 h-3" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel (default when no element selected) ─────────────────────

function SettingsPanel({ settings, onUpdate }: {
  settings: gw.VideoSettings; onUpdate: (updates: Partial<gw.VideoSettings>) => void;
}) {
  return (
    <div>
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-medium">Video Settings</span>
      </div>

      <SectionHeader>Canvas</SectionHeader>
      <div className="px-3 py-2 space-y-2">
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <div className="col-span-2">
            <VideoSelect
              value={SIZE_PRESETS.some(p => p.width === settings.width && p.height === settings.height) ? `${settings.width}x${settings.height}` : 'custom'}
              onChange={v => { if (v === 'custom') return; const [w, h] = v.split('x').map(Number); if (w && h) onUpdate({ width: w, height: h }); }}
              options={[...SIZE_PRESETS.map(p => ({ value: `${p.width}x${p.height}`, label: p.label })), { value: 'custom', label: 'Custom' }]} />
          </div>
          <div />
        </div>
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <LabeledNumberInput label="W" value={settings.width} min={100} max={7680} onChange={v => onUpdate({ width: v })} />
          <LabeledNumberInput label="H" value={settings.height} min={100} max={7680} onChange={v => onUpdate({ height: v })} />
          <div />
        </div>
      </div>

      <SectionHeader>Playback</SectionHeader>
      <div className="px-3 py-2 space-y-2">
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <div className="col-span-2">
            <VideoSelect value={String(settings.fps)} onChange={v => onUpdate({ fps: Number(v) })}
              options={[{ value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }]} />
          </div>
          <div />
        </div>
      </div>

      <SectionHeader>Background</SectionHeader>
      <div className="px-3 py-2">
        <VideoColorRow value={settings.background_color ?? '#000000'} onChange={v => onUpdate({ background_color: v })} />
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
  const [showMarkers, setShowMarkers] = useState(true);
  const [showHtml, setShowHtml] = useState(false);
  const markers = getMarkers(element);
  const playheadLocal = currentTime - element.start;
  const playheadInLifespan = playheadLocal >= 0 && playheadLocal <= element.duration;
  const snap = getElementSnapshotAt(element, Math.max(0, Math.min(element.duration, playheadLocal)));

  const isSvg = element.html.includes('<svg');
  const isOpenPath = isSvg && (element.html.includes('<line ') || element.html.includes('<polyline ') || (element.html.includes('<path ') && !element.html.includes(' fill="url(')));
  const strokeWidth = isSvg ? parseFloat((element.html.match(/stroke-width="([^"]+)"/) ?? [])[1] ?? '0') : 0;
  const strokeDash = isSvg ? (element.html.match(/stroke-dasharray="([^"]+)"/) ?? [])[1] ?? '' : '';
  const strokeLinecap = isSvg ? (element.html.match(/stroke-linecap="([^"]+)"/) ?? [])[1] ?? 'butt' : 'butt';
  const markerStart = isSvg ? (element.html.match(/marker-start="url\(#marker-([^-]+)-start\)"/) ?? [])[1] ?? 'none' : 'none';
  const markerEnd = isSvg ? (element.html.match(/marker-end="url\(#marker-([^-]+)-end\)"/) ?? [])[1] ?? 'none' : 'none';
  const strokeAlign = isSvg ? (element.html.match(/data-stroke-align="([^"]+)"/) ?? [])[1] ?? 'center' : 'center';
  const borderRadius = isSvg
    ? String(parseCornerRadiiFromHtml(element.html, 0).find(r => r > 0) ?? 0)
    : extractProp(element.html, 'border-radius') || '0';
  const fontFamily = extractProp(element.html, 'font-family') || 'sans-serif';
  const fontWeight = extractProp(element.html, 'font-weight') || '700';
  const textAlign = extractProp(element.html, 'text-align') || 'center';
  const verticalAlign = (() => {
    const ai = extractProp(element.html, 'align-items');
    if (ai === 'flex-start' || ai === 'start') return 'top';
    if (ai === 'flex-end' || ai === 'end') return 'bottom';
    return 'middle';
  })();
  const lineHeight = extractProp(element.html, 'line-height');
  const letterSpacing = extractProp(element.html, 'letter-spacing');
  const textDecoration = extractProp(element.html, 'text-decoration') || extractProp(element.html, 'text-decoration-line') || 'none';

  // Alpha (opacity) for fill / stroke / text — read from SVG fill-opacity or HTML rgba alpha.
  const fillAlpha = isSvg
    ? parseFloat((element.html.match(/fill-opacity="([^"]+)"/) ?? [])[1] ?? '1')
    : (() => {
        const bg = extractProp(element.html, 'background') || extractProp(element.html, 'background-color') || '';
        return readAlphaFromRgba(bg);
      })();
  const fillAlphaPct = Math.round(fillAlpha * 100);
  const setFillAlpha = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct))) / 100;
    if (isSvg) {
      let html = element.html;
      if (/fill-opacity="[^"]*"/.test(html)) {
        html = html.replace(/fill-opacity="[^"]*"/, `fill-opacity="${clamped}"`);
      } else {
        html = html.replace(/<path /, `<path fill-opacity="${clamped}" `);
      }
      onUpdateHtml(html);
    } else {
      const bg = extractProp(element.html, 'background') || extractProp(element.html, 'background-color') || '#D9D9D9';
      const baseHex = bg.startsWith('#') ? bg : packedRgbToHex(snap.fillColor);
      const rgba = hexOrRgbToRgba(baseHex, clamped);
      onUpdateHtml(setStyleProp(element.html, extractProp(element.html, 'background') ? 'background' : 'background-color', rgba));
    }
  };
  const strokeAlpha = isSvg ? parseFloat((element.html.match(/stroke-opacity="([^"]+)"/) ?? [])[1] ?? '1') : 1;
  const strokeAlphaPct = Math.round(strokeAlpha * 100);
  const setStrokeAlpha = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct))) / 100;
    if (isSvg) {
      let html = element.html;
      if (/stroke-opacity="[^"]*"/.test(html)) {
        html = html.replace(/stroke-opacity="[^"]*"/, `stroke-opacity="${clamped}"`);
      } else {
        html = html.replace(/<path /, `<path stroke-opacity="${clamped}" `);
      }
      onUpdateHtml(html);
    }
  };
  const textAlpha = (() => {
    if (element.type !== 'text') return 1;
    const c = extractProp(element.html, 'color') || '';
    return readAlphaFromRgba(c);
  })();
  const textAlphaPct = Math.round(textAlpha * 100);
  const setTextAlpha = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct))) / 100;
    const color = extractProp(element.html, 'color') || packedRgbToHex(snap.textColor);
    const baseHex = color.startsWith('#') ? color : packedRgbToHex(snap.textColor);
    const rgba = clamped < 1 ? hexOrRgbToRgba(baseHex, clamped) : baseHex;
    onUpdateHtml(setStyleProp(element.html, 'color', rgba));
  };

  const aspectLocked = element.aspect_locked ?? false;
  const aspectRatio = useRef(element.w / element.h);

  const updateSvgAttr = (attr: string, value: string) => {
    const re = new RegExp(`${attr}="[^"]*"`);
    onUpdateHtml(re.test(element.html) ? element.html.replace(re, `${attr}="${value}"`) : element.html.replace(/<path /, `<path ${attr}="${value}" `));
  };

  // Fill mode: detect from html
  type FillMode = 'solid' | 'image' | 'none';
  const detectFillMode = (): FillMode => {
    if (element.type === 'text') {
      if (element.html.includes('background-clip:') || element.html.includes('background-clip :')) return 'image';
      const c = extractProp(element.html, 'color');
      if (c === 'transparent') return 'none';
      return 'solid';
    }
    if (isSvg) {
      if (element.html.includes('url(#img-fill)')) return 'image';
      const fillMatch = element.html.match(/fill="([^"]+)"/);
      if (fillMatch && (fillMatch[1] === 'none' || fillMatch[1] === 'transparent')) return 'none';
      return 'solid';
    }
    if (/background-image:\s*url\(/.test(element.html)) return 'image';
    const bg = extractProp(element.html, 'background');
    if (bg === 'none' || bg === 'transparent') return 'none';
    return 'solid';
  };
  const fillMode = detectFillMode();

  const applyTextFillLocal = (html: string, op: { kind: 'solid'; color: string } | { kind: 'none' } | { kind: 'image'; url: string }): string => {
    const styleMatch = html.match(/^(<div\b[^>]*?\bstyle=")([^"]*)("[^>]*>)/);
    if (!styleMatch) return html;
    const [full, head, styleStr, tail] = styleMatch;
    let s = styleStr;
    s = s.replace(/(?:^|\s|;)\s*color:\s*[^;]+;?/g, ';');
    s = s.replace(/(?:^|\s|;)\s*background-image:\s*[^;]+;?/g, ';');
    s = s.replace(/(?:^|\s|;)\s*background-clip:\s*[^;]+;?/g, ';');
    s = s.replace(/(?:^|\s|;)\s*-webkit-background-clip:\s*[^;]+;?/g, ';');
    s = s.replace(/(?:^|\s|;)\s*background-size:\s*[^;]+;?/g, ';');
    s = s.replace(/(?:^|\s|;)\s*background-position:\s*[^;]+;?/g, ';');
    s = s.replace(/(?:^|\s|;)\s*background-repeat:\s*[^;]+;?/g, ';');
    s = s.replace(/;{2,}/g, ';').replace(/^\s*;/, '').trim();
    if (s && !s.endsWith(';')) s += ';';
    if (op.kind === 'solid') {
      s += ` color: ${op.color};`;
    } else if (op.kind === 'none') {
      s += ` color: transparent;`;
    } else {
      s += ` background-image: url('${op.url}');`;
      s += ` background-size: cover;`;
      s += ` background-position: center;`;
      s += ` -webkit-background-clip: text;`;
      s += ` background-clip: text;`;
      s += ` color: transparent;`;
    }
    return html.replace(full, `${head}${s.trim()}${tail}`);
  };

  const handleFillModeChange = async (mode: FillMode) => {
    if (mode === fillMode) return;
    if (mode === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const blobUrl = URL.createObjectURL(file);
        const applyImage = (url: string) => {
          let html = element.html;
          if (element.type === 'text') {
            html = applyTextFillLocal(html, { kind: 'image', url });
          } else if (isSvg) {
            html = html.replace(/<defs>[\s\S]*?<\/defs>/g, '');
            const defsBlock = `<defs><pattern id="img-fill" patternUnits="objectBoundingBox" width="1" height="1"><image href="${url}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/></pattern></defs>`;
            html = html.replace(/<svg([^>]*)>/, `<svg$1>${defsBlock}`);
            html = html.replace(/fill="[^"]*"/, 'fill="url(#img-fill)"');
          } else {
            html = setStyleProp(html, 'background-image', `url('${url}')`);
            html = setStyleProp(html, 'background-size', 'cover');
            html = setStyleProp(html, 'background-position', 'center');
          }
          onUpdateHtml(html);
        };
        applyImage(blobUrl);
        try {
          const formData = new FormData();
          formData.append('file', file);
          const resp = await fetch(`${API_BASE}/uploads`, { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
          if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
          const respData = await resp.json();
          const rawUrl = respData.url as string;
          const serverUrl = rawUrl?.startsWith('http') ? rawUrl : `${API_BASE}${rawUrl?.replace(/^\/api/, '')}`;
          applyImage(serverUrl);
          requestAnimationFrame(() => URL.revokeObjectURL(blobUrl));
        } catch { /* keep blob url */ }
      };
      input.click();
      return;
    }
    let html = element.html;
    if (fillMode === 'image') {
      if (element.type === 'text') {
        html = applyTextFillLocal(html, mode === 'none' ? { kind: 'none' } : { kind: 'solid', color: '#000000' });
        onUpdateHtml(html);
        return;
      }
      if (isSvg) {
        html = html.replace(/<defs>[\s\S]*?<\/defs>/g, '');
        html = html.replace(/fill="url\(#img-fill\)"/, 'fill="#D9D9D9"');
      } else {
        html = html.replace(/background-image:[^;]+;?\s*/g, '');
        html = html.replace(/background-size:[^;]+;?\s*/g, '');
        html = html.replace(/background-position:[^;]+;?\s*/g, '');
      }
    }
    if (mode === 'none') {
      if (element.type === 'text') html = applyTextFillLocal(html, { kind: 'none' });
      else if (isSvg) html = html.replace(/fill="[^"]*"/, 'fill="none"');
      else html = setStyleProp(html, 'background', 'none');
    } else {
      if (element.type === 'text') html = applyTextFillLocal(html, { kind: 'solid', color: '#000000' });
      else if (isSvg) html = html.replace(/fill="[^"]*"/, 'fill="#D9D9D9"');
      else html = setStyleProp(html, 'background', '#D9D9D9');
    }
    onUpdateHtml(html);
  };

  return (
    <div>
      {/* Header: element name + Copy / Delete / Lock */}
      <div className="px-3 py-2 flex items-center gap-1 shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">{element.name ?? element.type}</span>
        <div className="flex-1" />
        <IconBtn icon={Copy} onClick={onDuplicate} title="Duplicate" />
        <IconBtn icon={Trash2} onClick={onDelete} title="Delete" />
        <IconBtn icon={element.locked ? Lock : Unlock} onClick={() => onUpdate({ locked: !element.locked })}
          title={element.locked ? 'Unlock element' : 'Lock element'} />
      </div>

      {/* Timing */}
      <SectionHeader>Timing</SectionHeader>
      <div className="px-3 pb-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <SubsectionHeader>Start</SubsectionHeader>
            <LabeledNumberInput label={<Goal className="w-3 h-3" />} value={element.start} min={0} step={0.1} suffix="s" onChange={v => onUpdate({ start: v })} />
          </div>
          <div>
            <SubsectionHeader>Duration</SubsectionHeader>
            <LabeledNumberInput label={<Clock7 className="w-3 h-3" />} value={element.duration} min={0.1} step={0.1} suffix="s" onChange={v => onUpdate({ duration: v })} />
          </div>
        </div>
      </div>

      {/* Keyframes */}
      <SectionHeader collapsed={!showMarkers} onToggle={() => setShowMarkers(v => !v)}>
        Keyframes ({markers.length})
      </SectionHeader>
      {showMarkers && (
        <div className="px-3 pb-3 space-y-1">
          {markers.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">No keyframes yet. Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">K</kbd> to add one.</p>
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
              <span className="font-mono text-foreground flex-1">{t.toFixed(2)}s</span>
              <span className="font-mono text-muted-foreground/60 text-[9px]">@{(element.start + t).toFixed(2)}s</span>
              <button onClick={(e) => { e.stopPropagation(); onDeleteMarker(t); }} className="p-0.5 rounded hover:bg-accent text-destructive" title="Delete keyframe">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            onClick={onAddMarker}
            disabled={!playheadInLifespan || playheadLocal <= TIME_EPSILON}
            className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 mt-1 disabled:text-muted-foreground/50 disabled:cursor-not-allowed">
            <Plus className="w-3 h-3" />Add keyframe at {Math.max(0, playheadLocal).toFixed(2)}s
            <span className="text-[10px] text-muted-foreground/60">(K)</span>
          </button>
        </div>
      )}

      {/* Animations */}
      <PropertyAnimationsSection
        element={element}
        onSetKeyframeEasing={onSetKeyframeEasing}
        onDeletePropKeyframe={onDeletePropKeyframe} />

      {/* §1 Position: X/Y side by side + Rotation subsection */}
      <SectionHeader>Position</SectionHeader>
      <div className="px-3 pb-3 space-y-2">
        <div>
          <SubsectionHeader>Position</SubsectionHeader>
          <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
            <AnimatableField label="X" prop="x" value={snap.x} element={element} playheadLocal={playheadLocal}
              onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
            <AnimatableField label="Y" prop="y" value={snap.y} element={element} playheadLocal={playheadLocal}
              onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
            <div />
          </div>
        </div>
        <div>
          <SubsectionHeader>Rotation</SubsectionHeader>
          <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
            <AnimatableField label="∠" prop="rotation" value={snap.rotation} step={1} suffix="°"
              element={element} playheadLocal={playheadLocal}
              onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
            <div />
            <div />
          </div>
        </div>
      </div>

      {/* §2 Dimensions: W/H + aspect lock */}
      <SectionHeader>Dimensions</SectionHeader>
      <div className="px-3 pb-3 space-y-2">
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <AnimatableField label="W" prop="w" value={snap.w} min={20} element={element} playheadLocal={playheadLocal}
            onChange={(p, v) => {
              if (aspectLocked) {
                onChangeAnimatable('w', v);
                onChangeAnimatable('h', Math.round(v / aspectRatio.current));
              } else {
                onChangeAnimatable(p, v);
              }
            }} onRemoveAnimation={onRemoveAnimation} />
          <AnimatableField label="H" prop="h" value={snap.h} min={20} element={element} playheadLocal={playheadLocal}
            onChange={(p, v) => {
              if (aspectLocked) {
                onChangeAnimatable('h', v);
                onChangeAnimatable('w', Math.round(v * aspectRatio.current));
              } else {
                onChangeAnimatable(p, v);
              }
            }} onRemoveAnimation={onRemoveAnimation} />
          <button
            className={cn('w-6 h-6 flex items-center justify-center rounded transition-colors',
              aspectLocked ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')}
            onClick={() => {
              if (!aspectLocked) aspectRatio.current = element.w / element.h;
              onUpdate({ aspect_locked: !aspectLocked });
            }}
            title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          >
            {aspectLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          </button>
        </div>
        <div>
          <SubsectionHeader>Scale</SubsectionHeader>
          <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
            <AnimatableField label="S" prop="scale" value={snap.scale} min={0} max={10} step={0.1}
              element={element} playheadLocal={playheadLocal}
              onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
            <div />
            <div />
          </div>
        </div>
      </div>

      {/* §3 Appearance: Opacity + Corner radius */}
      <SectionHeader>Appearance</SectionHeader>
      <div className="px-3 pb-3 space-y-2">
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-end">
          <div>
            <SubsectionHeader>Opacity</SubsectionHeader>
            <AnimatableField
              label={<Eclipse className="w-3 h-3" />}
              prop="opacity" value={Math.round(snap.opacity * 100)} min={0} max={100} step={1} suffix="%"
              element={element} playheadLocal={playheadLocal}
              onChange={(p, v) => onChangeAnimatable(p, Math.min(1, Math.max(0, v / 100)))}
              onRemoveAnimation={onRemoveAnimation} />
          </div>
          <CornerRadiusField
            value={parseInt(borderRadius) || 0}
            onChange={v => {
              if (isSvg) {
                const origDMatch = element.html.match(/<path\b[^>]*\sdata-orig-d="([^"]*)"/);
                const dMatch = element.html.match(/<path\b[^>]*\sd="([^"]*)"/);
                const sourceD = origDMatch?.[1] || dMatch?.[1];
                if (!sourceD) return;
                const parsed = parsePath(sourceD);
                const subs = parsed.subPaths && parsed.subPaths.length > 0
                  ? parsed.subPaths
                  : [{ points: parsed.points, closed: parsed.closed }];
                const r = Math.max(0, v);
                const allRadii: (number | undefined)[] = [];
                for (const sp of subs) {
                  for (const _pt of sp.points) allRadii.push(r > 0 ? r : undefined);
                }
                let html = element.html;
                if (r > 0) {
                  const expandedSubs = subs.map(sp => {
                    const pts = sp.points.map(pt => ({ ...pt, cornerRadius: r }));
                    return { points: expandCornerRadii({ points: pts, closed: sp.closed }), closed: sp.closed };
                  });
                  const expandedD = expandedSubs.map(sp => serializeSubPath(sp)).join('');
                  const origD = subs.map(sp => serializeSubPath(sp)).join('');
                  html = html.replace(/<path\b([^>]*?)\sd="[^"]*"/, (_match, attrs) => {
                    let a = (attrs as string).replace(/\sdata-orig-d="[^"]*"/, '');
                    a += ` data-orig-d="${origD}"`;
                    return `<path${a} d="${expandedD}"`;
                  });
                } else {
                  const plainD = subs.map(sp => serializeSubPath(sp)).join('');
                  html = html.replace(/<path\b([^>]*?)\sd="[^"]*"/, (_match, attrs) => {
                    let a = (attrs as string).replace(/\sdata-orig-d="[^"]*"/, '');
                    return `<path${a} d="${plainD}"`;
                  });
                }
                html = applyCornerRadiiToHtml(html, 0, allRadii);
                onUpdateHtml(html);
              } else {
                let html = setStyleProp(element.html, 'border-radius', `${Math.max(0, v)}px`);
                onUpdateHtml(html);
              }
            }}
          />
          <div />
        </div>
        {(() => {
          const ps = getParametricShape(element.html);
          if (!ps) return null;
          return (
            <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-end">
              <div>
                <SubsectionHeader>Sides</SubsectionHeader>
                <LabeledNumberInput
                  label={<Loader className="w-3 h-3" />}
                  value={ps.count} min={3} max={60} step={1}
                  onChange={v => {
                    const clamped = Math.max(3, Math.min(60, Math.round(v)));
                    const vb = getSvgViewBoxSize(element.html);
                    let newHtml = updateParametricShape(element.html, ps.kind, clamped, vb.w, vb.h);
                    newHtml = newHtml.replace(/\sdata-orig-d="[^"]*"/, '');
                    const existingRadii = parseCornerRadiiFromHtml(newHtml, 0);
                    const r = existingRadii.find(x => x > 0) ?? 0;
                    if (r > 0) {
                      const dMatch = newHtml.match(/<path\b[^>]*\sd="([^"]*)"/);
                      if (dMatch) {
                        const parsed = parsePath(dMatch[1]);
                        const subs = parsed.subPaths?.length ? parsed.subPaths : [{ points: parsed.points, closed: parsed.closed }];
                        const expandedSubs = subs.map(sp => {
                          const pts = sp.points.map(pt => ({ ...pt, cornerRadius: r }));
                          return { points: expandCornerRadii({ points: pts, closed: sp.closed }), closed: sp.closed };
                        });
                        const expandedD = expandedSubs.map(sp => serializeSubPath(sp)).join('');
                        const origD = subs.map(sp => serializeSubPath(sp)).join('');
                        newHtml = newHtml.replace(/<path\b([^>]*?)\sd="[^"]*"/, (_m, attrs) => {
                          return `<path${attrs} data-orig-d="${origD}" d="${expandedD}"`;
                        });
                      }
                    }
                    onUpdateHtml(newHtml);
                  }}
                />
              </div>
              <div />
              <div />
            </div>
          );
        })()}
      </div>

      {/* §5 Text (text elements only) */}
      {element.type === 'text' && (
        <>
          <SectionHeader>Text</SectionHeader>
          <div className="px-3 pb-3 space-y-2">
            {/* Font family — with System + Google Fonts optgroups */}
            <div className="grid grid-cols-[1fr_24px] gap-2 items-center">
              <select
                value={fontFamily.replace(/['"]/g, '')}
                onChange={e => {
                  const v = e.target.value;
                  if (CANVAS_FONTS.google.includes(v)) loadGoogleFont(v);
                  onUpdateHtml(setStyleProp(element.html, 'font-family', v));
                }}
                className={SELECT_CLASS}
              >
                <optgroup label="System">
                  {CANVAS_FONTS.system.map(f => (
                    <option key={f} value={f}>{f.split(',')[0]}</option>
                  ))}
                </optgroup>
                <optgroup label="Google Fonts">
                  {CANVAS_FONTS.google.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </optgroup>
              </select>
              <div />
            </div>

            {/* Weight + Font size (animatable) */}
            <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
              <VideoSelect value={fontWeight} onChange={v => onUpdateHtml(setStyleProp(element.html, 'font-weight', v))}
                options={[
                  { value: '300', label: 'Light' },
                  { value: '400', label: 'Regular' },
                  { value: '500', label: 'Medium' },
                  { value: '600', label: 'Semibold' },
                  { value: '700', label: 'Bold' },
                  { value: '900', label: 'Black' },
                ]} />
              <AnimatableField label={<ALargeSmall className="w-3 h-3" />} prop="fontSize" value={snap.fontSize} min={1}
                element={element} playheadLocal={playheadLocal}
                onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
              <div />
            </div>

            {/* Line height + Letter spacing */}
            <div>
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 mb-1">
                <SubsectionHeader>Line height</SubsectionHeader>
                <SubsectionHeader>Letter spacing</SubsectionHeader>
                <div />
              </div>
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                <LabeledNumberInput
                  label={<Rows3 className="w-3 h-3" />}
                  value={lineHeight ? parseFloat(lineHeight) : null}
                  min={0.5} max={10} step={0.1}
                  onChange={v => onUpdateHtml(setStyleProp(element.html, 'line-height', String(v)))}
                  placeholder="Auto"
                />
                <LabeledNumberInput
                  label={<RulerDimensionLine className="w-3 h-3" />}
                  value={letterSpacing ? parseFloat(letterSpacing) : 0}
                  step={0.5}
                  onChange={v => onUpdateHtml(setStyleProp(element.html, 'letter-spacing', `${v}px`))}
                  suffix="px"
                />
                <div />
              </div>
            </div>

            {/* Alignment: 3 horizontal + 3 vertical + settings popover */}
            <div>
              <SubsectionHeader>Alignment</SubsectionHeader>
              <div className="flex items-center gap-1">
                <div className="flex-1 grid grid-cols-3 gap-0.5">
                  {([
                    ['left', TextAlignStart],
                    ['center', TextAlignCenter],
                    ['right', TextAlignEnd],
                  ] as const).map(([a, Icon]) => (
                    <button key={a}
                      className={cn('h-6 flex items-center justify-center rounded transition-colors',
                        textAlign === a
                          ? 'bg-white text-foreground ring-1 ring-border'
                          : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
                      onClick={() => onUpdateHtml(setStyleProp(element.html, 'text-align', a))}
                      title={`Align ${a}`}>
                      <Icon className="w-3 h-3" />
                    </button>
                  ))}
                </div>
                <div className="flex-1 grid grid-cols-3 gap-0.5">
                  {([
                    ['top', ArrowUpToLine, 'flex-start'],
                    ['middle', SeparatorHorizontal, 'center'],
                    ['bottom', ArrowDownToLine, 'flex-end'],
                  ] as const).map(([a, Icon, cssVal]) => (
                    <button key={a}
                      className={cn('h-6 flex items-center justify-center rounded transition-colors',
                        verticalAlign === a
                          ? 'bg-white text-foreground ring-1 ring-border'
                          : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
                      onClick={() => onUpdateHtml(setStyleProp(element.html, 'align-items', cssVal))}
                      title={`V-align ${a}`}>
                      <Icon className="w-3 h-3" />
                    </button>
                  ))}
                </div>
                <VideoTextSettingsPopover
                  textAlign={textAlign}
                  textDecoration={textDecoration}
                  onChangeAlign={v => onUpdateHtml(setStyleProp(element.html, 'text-align', v))}
                  onChangeDecoration={v => onUpdateHtml(setStyleProp(element.html, 'text-decoration', v))}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* §6 Fill */}
      <SectionHeader trailing={
        <select value={fillMode} onChange={e => handleFillModeChange(e.target.value as FillMode)}
          className="text-[10px] pl-1.5 pr-1 h-6 rounded bg-transparent hover:bg-accent/30 border-0 text-foreground focus:outline-none cursor-pointer">
          <option value="solid">Solid</option>
          <option value="image">Image</option>
          <option value="none">None</option>
        </select>
      }>Fill</SectionHeader>
      <div className="px-3 pb-3 space-y-2">
        {fillMode === 'solid' && (
          element.type === 'text' ? (
            <AnimatableColorField label="Fill" prop="textColor" value={snap.textColor}
              alphaPct={textAlphaPct} onAlphaChange={setTextAlpha}
              element={element} playheadLocal={playheadLocal}
              onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
          ) : (
            <AnimatableColorField label="Fill" prop="fillColor" value={snap.fillColor}
              alphaPct={fillAlphaPct} onAlphaChange={setFillAlpha}
              element={element} playheadLocal={playheadLocal}
              onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
          )
        )}
        {fillMode === 'image' && (() => {
          const patternMatch = element.html.match(/href="([^"]+)"/);
          const bgMatch = element.html.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
          const currentUrl = (isSvg ? patternMatch?.[1] : bgMatch?.[1]) || '';
          const fitMode = currentUrl ? getImageFitMode(element.html) : 'cover';
          return (
            <div className="grid grid-cols-[auto_1fr_1fr_24px] gap-2 items-center">
              <button
                onClick={() => handleFillModeChange('image')}
                className="w-9 h-6 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] flex items-center justify-center"
                title="Click to replace image"
              >
                {currentUrl ? (
                  <div className="w-4 h-4 rounded bg-cover bg-center shrink-0"
                    style={{ backgroundImage: `url('${currentUrl}')` }} />
                ) : (
                  <ImagePlus className="w-3 h-3 text-muted-foreground" />
                )}
              </button>
              <LabeledNumberInput label="" value={fillAlphaPct} min={0} max={100} step={1} suffix="%" onChange={setFillAlpha} />
              <select value={fitMode}
                onChange={e => onUpdateHtml(applyImageFitMode(element.html, e.target.value as ImageFitMode))}
                className={SELECT_CLASS}>
                <option value="cover">Fill</option>
                <option value="contain">Fit</option>
                <option value="stretch">Stretch</option>
              </select>
              <div />
            </div>
          );
        })()}
        {fillMode === 'none' && null}
      </div>

      {/* §7 Stroke (SVG elements) */}
      {isSvg && (
        <>
          <SectionHeader>Stroke</SectionHeader>
          <div className="px-3 pb-3 space-y-2">
            <AnimatableColorField label="Stroke" prop="strokeColor" value={snap.strokeColor}
              alphaPct={strokeAlphaPct} onAlphaChange={setStrokeAlpha}
              element={element} playheadLocal={playheadLocal}
              onChange={onChangeAnimatable} onRemoveAnimation={onRemoveAnimation} />
            <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
              <select value={strokeAlign}
                onChange={e => onUpdateHtml(applyStrokeAlignment(element.html, e.target.value as 'center' | 'inside' | 'outside'))}
                className={SELECT_CLASS}>
                <option value="center">Center</option>
                <option value="inside">Inside</option>
                <option value="outside">Outside</option>
              </select>
              <LabeledNumberInput label="W" value={strokeAlign === 'center' ? strokeWidth : strokeWidth / 2} min={0} step={0.5}
                onChange={v => {
                  const physical = (strokeAlign === 'inside' || strokeAlign === 'outside') ? v * 2 : v;
                  updateSvgAttr('stroke-width', String(physical));
                }} />
              <VideoStrokeSettingsPopover
                strokeDash={strokeDash}
                strokeLinecap={strokeLinecap}
                markerStart={markerStart}
                markerEnd={markerEnd}
                isOpenPath={isOpenPath}
                onChangeDash={v => updateSvgAttr('stroke-dasharray', v)}
                onChangeCap={v => onUpdateHtml(applyStrokeLinecap(element.html, v as 'butt' | 'round' | 'square'))}
                onChangeMarkerStart={v => onUpdateHtml(applySvgMarker(element.html, 'start', v as MarkerType))}
                onChangeMarkerEnd={v => onUpdateHtml(applySvgMarker(element.html, 'end', v as MarkerType))}
              />
            </div>
          </div>
        </>
      )}

      {/* §10 HTML Code */}
      <SectionHeader collapsed={!showHtml} onToggle={() => setShowHtml(v => !v)}>HTML Code</SectionHeader>
      {showHtml && (
        <div className="px-3 pb-3">
          <textarea value={element.html} onChange={e => onUpdateHtml(e.target.value)} rows={6}
            className="w-full text-[10px] px-2 py-1.5 rounded bg-[#F5F5F5] border-0 focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono resize-y" />
        </div>
      )}
    </div>
  );
}
