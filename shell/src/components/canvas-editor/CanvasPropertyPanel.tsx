'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  X, Upload, ChevronDown, ChevronRight, Ban, Plus, Trash2,
  Copy, Trash, Group, Ungroup, Lock, Unlock,
  AlignStartHorizontal, AlignHorizontalJustifyCenter, AlignEndHorizontal,
  AlignStartVertical, AlignVerticalJustifyCenter, AlignEndVertical,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  ArrowUp, ArrowDown, ChevronsUp, ChevronsDown,
  Download,
  MoveHorizontal, MoveVertical, Square,
  SquaresUnite, SquaresSubtract, SquaresIntersect, SquaresExclude,
  SquareRoundCorner, Loader, Eclipse, Settings2,
  ALargeSmall, Rows3, RulerDimensionLine,
  TextAlignStart, TextAlignCenter, TextAlignEnd, TextAlignJustify,
  ArrowUpToLine, SeparatorHorizontal, ArrowDownToLine,
  Minus, Underline, Strikethrough,
  Grip,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { pickFile } from '@/lib/utils/pick-file';
import * as gw from '@/lib/api/gateway';
import { API_BASE } from '@/lib/api/config';
import type { CanvasElement, CanvasPage, DesignToken } from './types';
import { projectElement, applyProjection, extractDesignTokens, updateDesignToken, applySvgDropShadow, applySvgMarker, applyStrokeLinecap, hasGradientFill } from './projection';
import type { ProjectedProps, SvgDropShadow, MarkerType } from './projection';
import { flattenToLeaves, computePropertyUnion, aggregateProps, applyToLeaves } from './property-model';
import type { AggregatedProps } from './property-model';
import { NumberInput } from './NumberInput';
import { ColorPicker } from './ColorPicker';
import { regularPolygonPath, regularStarPath } from '@/components/shared/ShapeSet';
import type { SubElementSelection } from '@/components/shared/SubElementEditor';
import { CANVAS_FONTS } from './fonts';
import { loadGoogleFont } from './fontLoader';

// ── Inline edit header ───────────────────────────────────────────────────────

function InlineEditHeader({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); }}
        onKeyDown={e => { if (e.key === 'Enter') { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); } if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
        className="text-[11px] font-medium uppercase tracking-wider bg-transparent border-b border-primary outline-none px-0 py-0 w-full"
      />
    );
  }
  return (
    <span
      className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
      onDoubleClick={() => { setDraft(value); setEditing(true); }}
      title="Double-click to rename"
    >{value}</span>
  );
}

// ── Tool button (small) ──────────────────────────────────────────────────────

function ToolBtn({ icon: Icon, onClick, title }: {
  icon: React.ElementType; onClick: () => void; title: string;
}) {
  return (
    <button onClick={onClick} title={title}
      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

// ── Frame shadow section ─────────────────────────────────────────────────────

function FrameShadowSection({ frame, onUpdateFrame }: {
  frame: CanvasPage;
  onUpdateFrame: (pageId: string, updates: Partial<CanvasPage>) => void;
}) {
  const raw = frame.box_shadow;
  const parse = (s: string) => {
    const m = s.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(#[0-9a-fA-F]+|rgba?\([^)]+\))/);
    if (!m) return null;
    return { x: parseFloat(m[1]), y: parseFloat(m[2]), blur: parseFloat(m[3]), spread: parseFloat(m[4] ?? '0'), color: m[5] };
  };
  const serialize = (s: { x: number; y: number; blur: number; spread: number; color: string }) =>
    `${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}`;

  const parsed = raw ? parse(raw) : null;
  const hasShadow = !!parsed;

  const update = (vals: { x: number; y: number; blur: number; spread: number; color: string }) =>
    onUpdateFrame(frame.page_id, { box_shadow: serialize(vals) });

  if (!hasShadow) {
    return (
      <button onClick={() => update({ x: 0, y: 4, blur: 8, spread: 0, color: 'rgba(0,0,0,0.1)' })}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <Plus className="h-3 w-3" /> Add shadow
      </button>
    );
  }

  const sv = parsed!;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Shadow</span>
        <button onClick={() => onUpdateFrame(frame.page_id, { box_shadow: '' })}
          className="p-0.5 text-muted-foreground/50 hover:text-destructive" title="Remove shadow">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-4">X</span>
          <NumberInput value={sv.x} onChange={v => update({ ...sv, x: v })} step={1} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-4">Y</span>
          <NumberInput value={sv.y} onChange={v => update({ ...sv, y: v })} step={1} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-4">Blur</span>
          <NumberInput value={sv.blur} onChange={v => update({ ...sv, blur: Math.max(0, v) })} min={0} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-4">Sprd</span>
          <NumberInput value={sv.spread} onChange={v => update({ ...sv, spread: v })} />
        </div>
      </div>
      <ColorRow label="Color" value={sv.color} onChange={v => update({ ...sv, color: v })} />
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
// Divider sits ABOVE the header (border-t). Title is mixed-case medium foreground.
// Figma-style: section header reads as a label below the dividing line.

export function SectionHeader({ children, collapsed, onToggle, trailing }: {
  children: React.ReactNode; collapsed?: boolean; onToggle?: () => void;
  /** Optional element rendered right-aligned on the same row as the title */
  trailing?: React.ReactNode;
}) {
  return (
    <div className={cn('px-3 pt-3 pb-1.5 border-t border-border', onToggle && 'cursor-pointer hover:bg-accent/30')}
      onClick={onToggle}>
      <div className="flex items-center gap-1">
        {onToggle && (collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />)}
        <span className="text-[11px] font-medium text-foreground">{children}</span>
        {trailing && (
          <div className="ml-auto" onClick={e => e.stopPropagation()}>
            {trailing}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subsection header (small muted label inside a section) ────────────────────

export function SubsectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-muted-foreground mt-1 mb-1">{children}</div>
  );
}

// ── Labeled number input (icon/letter + value in one rounded box) ─────────────
// Visual: pale gray fill, no border, only the numeric value is editable.
// Used for X/Y/W/H/Rotation/Opacity/Radius and similar across sections.

// Tailwind class string used by selects to match LabeledNumberInput visual.
export const SELECT_CLASS = 'w-full text-[10px] pl-2 pr-5 h-6 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] border-0 focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none cursor-pointer';

// Wraps a <select> so the chevron sits a few pixels in from the right edge
// rather than glued to the border (Figma-style). Use this anywhere we'd
// otherwise spell out className={SELECT_CLASS} on a bare <select>.
function MutedSelect({ value, onChange, children, className }: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative w-full', className)}>
      <select value={value} onChange={e => onChange(e.target.value)} className={SELECT_CLASS}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
    </div>
  );
}

export function LabeledNumberInput({
  label, value, onChange, min, max, step, suffix, placeholder,
}: {
  label: React.ReactNode;
  value: number | null;
  onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
  suffix?: string; placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 px-2 h-6 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 cursor-text">
      <span className="text-[10px] text-muted-foreground shrink-0 select-none">{label}</span>
      <NumberInput
        value={value}
        onChange={onChange}
        min={min} max={max} step={step}
        suffix={suffix}
        placeholder={placeholder}
        className="flex-1"
        inputClassName="w-full bg-transparent border-0 px-0 py-0 text-[10px] text-foreground focus:outline-none font-mono tabular-nums"
      />
    </label>
  );
}

// ── Hex text input (uncontrolled-ish) ─────────────────────────────────────────
// React controlled input was preventing typing because handleHexCommit only
// commits when the draft is a full 3 or 6 hex digits — partial drafts got
// reset back to the prop value on every keystroke. Keep a local draft, sync
// to prop only when prop actually changes (e.g. swatch picker), commit on
// blur / Enter.

export function HexTextInput({ value, onCommit, className }: {
  value: string; onCommit: (raw: string) => void; className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const lastValueRef = useRef(value);
  React.useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setDraft(value);
    }
  }, [value]);
  return (
    <input
      type="text"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
      spellCheck={false}
    />
  );
}

// ── Corner radius input (label + subsection header) ──────────────────────────
// Single source of truth for the "Corner radius" labeled input used by
// element Appearance, Frame Appearance, and Vector anchor Appearance.
// Returns just `<SubsectionHeader>Corner radius</SubsectionHeader>` plus a
// LabeledNumberInput — caller wraps in whatever grid it needs.

export function CornerRadiusField({ value, onChange, placeholder }: {
  value: number | null;
  onChange: (v: number) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <SubsectionHeader>Corner radius</SubsectionHeader>
      <LabeledNumberInput
        label={<SquareRoundCorner className="w-3 h-3" />}
        value={value}
        min={0}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}

// ── Small icon button ─────────────────────────────────────────────────────────

export function IconBtn({ icon: Icon, onClick, title, active, danger }: {
  icon: React.ElementType; onClick: () => void; title: string; active?: boolean; danger?: boolean;
}) {
  return (
    <button onClick={onClick} title={title}
      className={cn(
        'p-1 rounded transition-colors',
        danger ? 'text-destructive hover:bg-destructive/10' :
        active ? 'text-primary bg-primary/10' :
        'text-muted-foreground hover:text-foreground hover:bg-accent/50',
      )}>
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

// ── Row label + value ─────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground w-14 shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ── Color row with ColorPicker ────────────────────────────────────────────────

function ColorRow({ label, value, onChange, allowNone, onClear }: {
  label: string; value: string; onChange: (v: string) => void;
  allowNone?: boolean; onClear?: () => void;
}) {
  const isNone = !value || value === 'none';
  return (
    <Row label={label}>
      <div className="flex items-center gap-1">
        {isNone ? (
          <button onClick={() => onChange('#000000')}
            className="w-6 h-6 rounded border border-dashed border-muted-foreground/30 flex items-center justify-center shrink-0"
            title="Set color">
            <Ban className="h-3 w-3 text-muted-foreground/40" />
          </button>
        ) : (
          <ColorPicker value={value} onChange={onChange} allowNone={allowNone} onClear={onClear} />
        )}
        <input type="text" value={isNone ? '' : value}
          onChange={e => onChange(e.target.value || 'none')}
          className="flex-1 text-[11px] px-1.5 py-1 rounded border bg-background font-mono" placeholder="none" />
        {!isNone && allowNone && onClear && (
          <button onClick={onClear} className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground" title="Remove">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </Row>
  );
}

// ── Text resize mode ───────────────────────────────────────────────────────────

type TextResizeMode = 'auto' | 'fixed-width' | 'fixed';

/** Read text resize mode from element html. Returns null if not a text element. */
function getTextResizeMode(html: string): TextResizeMode | null {
  const m = html.match(/data-text-resize="([^"]*)"/);
  if (!m) return null;
  if (m[1] === 'auto') return 'auto';
  if (m[1] === 'fixed-width') return 'fixed-width';
  if (m[1] === 'fixed') return 'fixed';
  return null;
}

/** Update text resize mode on html: changes data attribute + white-space CSS. */
function setTextResizeMode(html: string, mode: TextResizeMode): string {
  let result = html.replace(/data-text-resize="[^"]*"/, `data-text-resize="${mode}"`);
  // Update white-space + word-wrap inline style on the contenteditable div.
  // auto:  white-space: nowrap (no wrapping; width grows with content)
  // fixed-width: white-space: normal + word-wrap: break-word (wrap; width fixed, height grows)
  // fixed: white-space: normal + word-wrap: break-word (wrap; both fixed; overflow hidden upstream)
  const ws = mode === 'auto' ? 'nowrap' : 'normal';
  const wrap = mode === 'auto' ? '' : 'word-wrap: break-word; ';
  // Strip existing white-space and word-wrap declarations within the style attribute.
  result = result.replace(/(<div\b[^>]*?\sstyle="[^"]*?)white-space:\s*[^;"]*;?\s*/, '$1');
  result = result.replace(/(<div\b[^>]*?\sstyle="[^"]*?)word-wrap:\s*[^;"]*;?\s*/, '$1');
  // Append the new white-space + word-wrap before the closing quote of the FIRST style attribute.
  result = result.replace(/(<div\b[^>]*?\sstyle="[^"]*?)("\s)/, (_m, before, after) => {
    const sep = before.endsWith(';') || before.endsWith('"') ? '' : ';';
    return `${before}${sep} white-space: ${ws}; ${wrap}${after}`;
  });
  return result;
}

// ── Polygon/star shape parametrics ─────────────────────────────────────────────

/** Read shape kind + parametric count from html. Returns null if not a parametric shape. */
function getParametricShape(html: string): { kind: 'polygon' | 'star'; count: number } | null {
  const polyMatch = html.match(/<path\b[^>]*\sdata-shape="polygon"[^>]*\sdata-sides="(\d+)"/);
  if (polyMatch) return { kind: 'polygon', count: parseInt(polyMatch[1], 10) };
  const starMatch = html.match(/<path\b[^>]*\sdata-shape="star"[^>]*\sdata-points="(\d+)"/);
  if (starMatch) return { kind: 'star', count: parseInt(starMatch[1], 10) };
  return null;
}

/** Update polygon/star count: regenerate path d from element's current w/h, update data attr. */
function updateParametricShape(html: string, kind: 'polygon' | 'star', count: number, w: number, h: number): string {
  const n = Math.max(3, Math.min(60, Math.round(count)));
  // We re-render using element w/h (the element box represents the shape's bounding ellipse).
  // viewBox coords for the path use the same w/h ranges.
  const newD = kind === 'polygon' ? regularPolygonPath(w, h, n) : regularStarPath(w, h, n);
  const attrName = kind === 'polygon' ? 'data-sides' : 'data-points';
  // Replace path d
  let result = html.replace(/(<path\b[^>]*?\s)d="[^"]*"/, `$1d="${newD}"`);
  // Replace data-sides / data-points
  result = result.replace(new RegExp(`(${attrName})="\\d+"`), `$1="${n}"`);
  return result;
}

// ── Image fill mode ───────────────────────────────────────────────────────────

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

// ── Fill section (Solid / Image / None) ──────────────────────────────────────

type FillMode = 'solid' | 'image' | 'none';

// Returns the current fill mode of an element from its html.
function isTextElement(element: CanvasElement): boolean {
  return element.html.includes('contenteditable');
}

/**
 * Apply a "fill" change to a text element. Fill on text means:
 *   solid  → style.color = <hex/rgba>; clear bg-image + background-clip
 *   image  → background-image: url(...) + background-clip:text + color: transparent
 *   none   → color: transparent; clear bg-image + background-clip
 * The DOM style serialization order is preserved by editing the wrapper's
 * style attribute string.
 */
function applyTextFill(html: string, op:
  | { kind: 'solid'; color: string }
  | { kind: 'none' }
  | { kind: 'image'; url: string }
): string {
  // Match `<div ... style="..." ...>` where style="" can appear right after
  // <div  or after some other attrs. Don't require an extra leading space —
  // createTextElement starts with `<div style="...">` (single leading space).
  const styleMatch = html.match(/^(<div\b[^>]*?\bstyle=")([^"]*)("[^>]*>)/);
  if (!styleMatch) return html;
  const [full, head, styleStr, tail] = styleMatch;
  let s = styleStr;
  // Strip prior fill-related decls so we have a clean slate.
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
}

/** Expand a short 3-digit hex (e.g. "FA0") to its 6-digit form ("FFAA00").
 *  Returns the input unchanged if it isn't a valid 3- or 6-digit hex. */
function expandHex(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(cleaned)) return cleaned;
  if (/^[0-9A-F]{3}$/.test(cleaned)) return cleaned.split('').map(c => c + c).join('');
  return cleaned;
}

/** Convert any color string (hex/rgb/rgba) to rgba(r,g,b,alpha). */
function hexOrRgbToRgba(c: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const rgbaM = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbaM) {
    return `rgba(${rgbaM[1]}, ${rgbaM[2]}, ${rgbaM[3]}, ${a})`;
  }
  const hex = c.replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return c;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Read the current text color (returns hex or rgba string, or '' if none). */
function readTextColor(html: string): string {
  const m = html.match(/(?:^|;|\")\s*color:\s*([^;\"]+)/);
  const c = m?.[1]?.trim() || '';
  return c === 'transparent' ? '' : c;
}

/** Read the current text fill image URL, or '' if not in image mode. */
function readTextImageUrl(html: string): string {
  if (!/background-clip:\s*text/.test(html) && !/-webkit-background-clip:\s*text/.test(html)) return '';
  const m = html.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
  return m?.[1] || '';
}

function readFillMode(element: CanvasElement, projected: ReturnType<typeof projectElement>): FillMode {
  // ── Text elements: fill drives the TEXT color ──────────────────────────────
  // Solid: style.color is a non-transparent color
  // Image: background-image + background-clip:text (color set to transparent)
  // None:  color === 'transparent' and no background-image
  if (isTextElement(element)) {
    const html = element.html;
    const bgMatch = html.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
    const clippedToText = /-webkit-background-clip:\s*text/.test(html) || /background-clip:\s*text/.test(html);
    if (bgMatch && clippedToText) return 'image';
    const colorMatch = html.match(/(?:^|;|\")\s*color:\s*([^;\"]+)/);
    const c = colorMatch?.[1]?.trim() || '';
    if (!c || c === 'transparent') return 'none';
    return 'solid';
  }

  const isSvg = projected.isSvgShape;
  const currentColor = isSvg ? (projected.svgFill || '') : (projected.backgroundColor || '');
  const isSvgHtml = element.html.includes('<svg');
  const patternMatch = element.html.match(/href="([^"]+)"/);
  const bgMatch = element.html.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
  const currentUrl = (isSvgHtml ? patternMatch?.[1] : bgMatch?.[1]) || '';
  // Empty / 'none' / 'transparent' all map to None. SVG shapes default to a
  // visible fill so an absent fill attr is rare; HTML blocks (text, etc.)
  // commonly have no background and should report None.
  const noFill = !currentColor || currentColor === 'none' || currentColor === 'transparent';
  let mode: FillMode = noFill ? 'none' : 'solid';
  if (currentUrl) mode = 'image';
  return mode;
}

// Small dropdown that switches fill mode. Used in the §7 Fill section header.
function FillModeSelect({ element, projected, onApply, onUpdateElement }: {
  element: CanvasElement;
  projected: ReturnType<typeof projectElement>;
  onApply: (changes: Partial<ProjectedProps>) => void;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
}) {
  const isSvg = projected.isSvgShape;
  const isSvgHtml = element.html.includes('<svg');
  const fillMode = readFillMode(element, projected);

  const isText = isTextElement(element);

  const handleUpload = async () => {
    try {
      const files = await pickFile({ accept: 'image/*' });
      const file = files[0];
      if (!file) return;
      const blobUrl = URL.createObjectURL(file);
      const applyImageFill = (url: string) => {
        let html = element.html;
        if (isText) {
          // Text element: use background-clip: text trick.
          html = applyTextFill(html, { kind: 'image', url });
          onUpdateElement(element.id, { html });
          return;
        }
        if (isSvgHtml) {
          html = html.replace(/<defs>[\s\S]*?<\/defs>/g, '');
          const pathEl = html.match(/<(path|rect|circle|ellipse|polygon)\s/);
          if (pathEl) {
            if (url) {
              const defsBlock = `<defs><pattern id="img-fill" patternUnits="objectBoundingBox" width="1" height="1"><image href="${url}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/></pattern></defs>`;
              html = html.replace(/<svg([^>]*)>/, `<svg$1>${defsBlock}`);
              html = html.replace(/fill="[^"]*"/, 'fill="url(#img-fill)"');
            }
          }
        } else {
          const wrapperStyleMatch = html.match(/^<div\s+style="([^"]*)"/);
          if (wrapperStyleMatch) {
            let style = wrapperStyleMatch[1];
            style = style.replace(/background-image:[^;]+;?\s*/g, '');
            style = style.replace(/background-size:[^;]+;?\s*/g, '');
            style = style.replace(/background-position:[^;]+;?\s*/g, '');
            style = style.replace(/background-repeat:[^;]+;?\s*/g, '');
            if (url) style += `background-image:url('${url}');background-size:cover;background-position:center;`;
            html = html.replace(wrapperStyleMatch[0], `<div style="${style}"`);
          }
        }
        onUpdateElement(element.id, { html });
      };
      applyImageFill(blobUrl);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch(`${API_BASE}/uploads`, { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
        if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
        const respData = await resp.json();
        const rawUrl = respData.url as string;
        const serverUrl = rawUrl?.startsWith('http') ? rawUrl : `${API_BASE}${rawUrl?.replace(/^\/api/, '')}`;
        await new Promise<void>(resolve => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = serverUrl;
        });
        applyImageFill(serverUrl);
        requestAnimationFrame(() => URL.revokeObjectURL(blobUrl));
      } catch (err) {
        URL.revokeObjectURL(blobUrl);
        throw err;
      }
    } catch (err) {
      showError('Failed to upload image', err);
    }
  };

  const switchTo = (m: FillMode) => {
    if (m === fillMode) return;
    if (m === 'image') { handleUpload(); return; }
    if (isText) {
      const next = m === 'none'
        ? applyTextFill(element.html, { kind: 'none' })
        : applyTextFill(element.html, { kind: 'solid', color: '#111827' });
      onUpdateElement(element.id, { html: next });
      return;
    }
    const wasImage = fillMode === 'image';
    let cleared = element.html;
    if (wasImage) {
      if (isSvgHtml) {
        cleared = cleared.replace(/<defs>[\s\S]*?<\/defs>/g, '');
        cleared = cleared.replace(/fill="url\(#img-fill\)"/, 'fill="#D9D9D9"');
      } else {
        const wrapperStyleMatch = cleared.match(/^<div\s+style="([^"]*)"/);
        if (wrapperStyleMatch) {
          let style = wrapperStyleMatch[1];
          style = style.replace(/background-image:[^;]+;?\s*/g, '');
          style = style.replace(/background-size:[^;]+;?\s*/g, '');
          style = style.replace(/background-position:[^;]+;?\s*/g, '');
          style = style.replace(/background-repeat:[^;]+;?\s*/g, '');
          cleared = cleared.replace(wrapperStyleMatch[0], `<div style="${style}"`);
        }
      }
    }
    const targetColor = m === 'none' ? 'none' : (isSvg ? '#D9D9D9' : '#ffffff');
    const next = applyProjection(cleared, isSvg ? { svgFill: targetColor } : { backgroundColor: targetColor }, undefined);
    onUpdateElement(element.id, { html: next });
  };

  return (
    <select
      value={fillMode}
      onChange={e => switchTo(e.target.value as FillMode)}
      className="text-[10px] pl-1.5 pr-1 h-6 rounded bg-transparent hover:bg-accent/30 border-0 text-foreground focus:outline-none cursor-pointer"
    >
      <option value="solid">Solid</option>
      <option value="image">Image</option>
      <option value="none">None</option>
    </select>
  );
}

// Stroke mode = Line (visible stroke) | None.
type StrokeMode = 'line' | 'none';

function readStrokeMode(projected: ReturnType<typeof projectElement>): StrokeMode {
  // SVG: stroke attribute. HTML: borderColor + borderWidth.
  if (projected.isSvgShape) {
    const s = projected.svgStroke;
    return (!s || s === 'none') ? 'none' : 'line';
  }
  const c = projected.borderColor;
  const w = projected.borderWidth ?? 0;
  return (!c || c === 'none' || w === 0) ? 'none' : 'line';
}

function StrokeModeSelect({ projected, onApply }: {
  projected: ReturnType<typeof projectElement>;
  onApply: (changes: Partial<ProjectedProps>) => void;
}) {
  const mode = readStrokeMode(projected);
  const isSvg = projected.isSvgShape;
  const switchTo = (next: StrokeMode) => {
    if (next === mode) return;
    if (next === 'none') {
      isSvg ? onApply({ svgStroke: 'none' }) : onApply({ borderColor: 'none', borderWidth: 0 });
    } else {
      // line: pick a usable default
      isSvg ? onApply({ svgStroke: '#000000', svgStrokeWidth: 1 }) : onApply({ borderColor: '#000000', borderWidth: 1, borderStyle: 'solid' });
    }
  };
  return (
    <select
      value={mode}
      onChange={e => switchTo(e.target.value as StrokeMode)}
      className="text-[10px] pl-1.5 pr-1 h-6 rounded bg-transparent hover:bg-accent/30 border-0 text-foreground focus:outline-none cursor-pointer"
    >
      <option value="line">Line</option>
      <option value="none">None</option>
    </select>
  );
}

// Settings popover trigger + content for stroke detail (dash, cap, markers).
function StrokeSettingsPopover({
  isSvg, isHtmlBlock, projected, applyChange, element, onUpdateElement,
}: {
  isSvg: boolean;
  isHtmlBlock: boolean;
  projected: ReturnType<typeof projectElement>;
  applyChange: (changes: Partial<ProjectedProps>) => void;
  element: CanvasElement;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative">
      <button
        ref={btnRef}
        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
        onClick={() => setOpen(v => !v)}
        title="Stroke settings"
      >
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute right-0 top-7 z-50 w-[220px] rounded-md border border-border bg-card shadow-lg p-3 space-y-2"
        >
          {isSvg && (
            <>
              <div>
                <SubsectionHeader>Dash</SubsectionHeader>
                <select value={projected.svgStrokeDasharray || ''}
                  onChange={e => applyChange({ svgStrokeDasharray: e.target.value })}
                  className={SELECT_CLASS}>
                  <option value="">Solid</option>
                  <option value="8 4">Dashed</option>
                  <option value="2 2">Dotted</option>
                  <option value="12 4 4 4">Dash-dot</option>
                </select>
              </div>
              {projected.isOpenPath && (
                <>
                  <div>
                    <SubsectionHeader>Cap</SubsectionHeader>
                    <select value={projected.svgStrokeLinecap || 'butt'}
                      onChange={e => {
                        const cap = e.target.value as 'butt' | 'round' | 'square';
                        onUpdateElement(element.id, { html: applyStrokeLinecap(element.html, cap) });
                      }}
                      className={SELECT_CLASS}>
                      <option value="butt">Butt</option>
                      <option value="round">Round</option>
                      <option value="square">Square</option>
                    </select>
                  </div>
                  <div>
                    <SubsectionHeader>Start</SubsectionHeader>
                    <select value={projected.svgMarkerStart || 'none'}
                      onChange={e => onUpdateElement(element.id, { html: applySvgMarker(element.html, 'start', e.target.value as MarkerType) })}
                      className={SELECT_CLASS}>
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
                    <select value={projected.svgMarkerEnd || 'none'}
                      onChange={e => onUpdateElement(element.id, { html: applySvgMarker(element.html, 'end', e.target.value as MarkerType) })}
                      className={SELECT_CLASS}>
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
            </>
          )}
          {isHtmlBlock && (
            <div>
              <SubsectionHeader>Dash</SubsectionHeader>
              <select value={projected.borderStyle || 'solid'}
                onChange={e => applyChange({ borderStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })}
                className={SELECT_CLASS}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Settings popover trigger for text typography detail (justify, decoration,
// textTransform). Mirrors StrokeSettingsPopover's interaction.
function TextSettingsPopover({
  projected, applyChange,
}: {
  projected: ReturnType<typeof projectElement>;
  applyChange: (changes: Partial<ProjectedProps>) => void;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative">
      <button
        ref={btnRef}
        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
        onClick={() => setOpen(v => !v)}
        title="Text settings"
      >
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute right-0 top-7 z-50 w-[220px] rounded-md border border-border bg-card shadow-lg p-3 space-y-2"
        >
          <div>
            <SubsectionHeader>Justify</SubsectionHeader>
            <button
              className={cn('w-full h-6 text-[10px] flex items-center justify-center rounded transition-colors',
                projected.textAlign === 'justify'
                  ? 'bg-white text-foreground ring-1 ring-border'
                  : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
              onClick={() => applyChange({ textAlign: projected.textAlign === 'justify' ? 'left' : 'justify' })}>
              {projected.textAlign === 'justify' ? 'On' : 'Off'}
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
                    (projected.textDecoration ?? 'none') === d
                      ? 'bg-white text-foreground ring-1 ring-border'
                      : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
                  onClick={() => applyChange({ textDecoration: d })}
                  title={title}>
                  <Icon className="w-3 h-3" />
                </button>
              ))}
            </div>
          </div>
          <div>
            <SubsectionHeader>Letter case</SubsectionHeader>
            <select
              value={projected.textTransform ?? 'none'}
              onChange={e => applyChange({ textTransform: e.target.value as 'none' | 'uppercase' | 'lowercase' | 'capitalize' })}
              className={SELECT_CLASS}>
              <option value="none">As typed</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function FillSection({ element, projected, onApply, onUpdateElement }: {
  element: CanvasElement;
  projected: ReturnType<typeof projectElement>;
  onApply: (changes: Partial<ProjectedProps>) => void;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
}) {
  const isSvg = projected.isSvgShape;
  const isText = isTextElement(element);
  const isSvgHtml = element.html.includes('<svg');
  // For text elements, fill drives the text color (or text-clipped image).
  const currentColor = isText
    ? readTextColor(element.html)
    : isSvg ? (projected.svgFill || '') : (projected.backgroundColor || '');
  const patternMatch = element.html.match(/href="([^"]+)"/);
  const bgMatch = element.html.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
  const currentUrl = isText ? readTextImageUrl(element.html) : (isSvgHtml ? patternMatch?.[1] : bgMatch?.[1]) || '';

  // Use the same readFillMode as everywhere else for consistency.
  const fillMode: FillMode = readFillMode(element, projected);

  const isGradient = hasGradientFill(element.html);
  const fitMode = currentUrl ? getImageFitMode(element.html) : 'cover';

  const applyImageFill = async (url: string) => {
    let html = element.html;
    if (isText) {
      html = url
        ? applyTextFill(html, { kind: 'image', url })
        : applyTextFill(html, { kind: 'solid', color: '#111827' });
      onUpdateElement(element.id, { html });
      return;
    }
    if (isSvgHtml) {
      html = html.replace(/<defs>[\s\S]*?<\/defs>/g, '');
      const pathEl = html.match(/<(path|rect|circle|ellipse|polygon)\s/);
      if (pathEl) {
        if (url) {
          const defsBlock = `<defs><pattern id="img-fill" patternUnits="objectBoundingBox" width="1" height="1"><image href="${url}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/></pattern></defs>`;
          html = html.replace(/<svg([^>]*)>/, `<svg$1>${defsBlock}`);
          html = html.replace(/fill="[^"]*"/, 'fill="url(#img-fill)"');
        } else {
          html = html.replace(/fill="url\(#img-fill\)"/, 'fill="#D9D9D9"');
        }
      }
    } else {
      const wrapperStyleMatch = html.match(/^<div\s+style="([^"]*)"/);
      if (wrapperStyleMatch) {
        let style = wrapperStyleMatch[1];
        style = style.replace(/background-image:[^;]+;?\s*/g, '');
        style = style.replace(/background-size:[^;]+;?\s*/g, '');
        style = style.replace(/background-position:[^;]+;?\s*/g, '');
        style = style.replace(/background-repeat:[^;]+;?\s*/g, '');
        if (url) style += `background-image:url('${url}');background-size:cover;background-position:center;`;
        html = html.replace(wrapperStyleMatch[0], `<div style="${style}"`);
      }
    }
    onUpdateElement(element.id, { html });
  };

  const handleUpload = async () => {
    try {
      const files = await pickFile({ accept: 'image/*' });
      const file = files[0];
      if (!file) return;
      // Step 1: instant preview with a blob URL so the user sees the image fill immediately.
      const blobUrl = URL.createObjectURL(file);
      applyImageFill(blobUrl);
      // Step 2: upload, preload server URL into cache, then swap blob → server URL.
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch(`${API_BASE}/uploads`, { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
        if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
        const respData = await resp.json();
        const rawUrl = respData.url as string;
        const serverUrl = rawUrl?.startsWith('http') ? rawUrl : `${API_BASE}${rawUrl?.replace(/^\/api/, '')}`;
        await new Promise<void>(resolve => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = serverUrl;
        });
        // Replace the blob URL with the server URL in whatever the latest html is.
        // The state has updated since step 1, so read element.html via a fresh apply.
        applyImageFill(serverUrl);
        requestAnimationFrame(() => URL.revokeObjectURL(blobUrl));
      } catch (err) {
        URL.revokeObjectURL(blobUrl);
        throw err;
      }
    } catch (err) {
      showError('Failed to upload image', err);
    }
  };

  // Display hex without leading '#', uppercase. Convert rgb/rgba → hex for display.
  const hexNoHash = (() => {
    if (!currentColor) return '';
    if (currentColor.startsWith('#')) return currentColor.slice(1).toUpperCase();
    const m = currentColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
      return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
    }
    return currentColor.toUpperCase();
  })();

  const handleHexCommit = (raw: string) => {
    const cleaned = raw.trim().replace(/^#+/, '').toUpperCase();
    if (!/^[0-9A-F]{3}([0-9A-F]{3})?$/.test(cleaned)) return;
    const expanded = expandHex(cleaned);
    const next = '#' + expanded;
    if (isText) {
      // Preserve current alpha if user is using rgba
      const newColor = textColorAlpha < 1 ? hexOrRgbToRgba(next, textColorAlpha) : next;
      onUpdateElement(element.id, { html: applyTextFill(element.html, { kind: 'solid', color: newColor }) });
    } else if (isSvg) {
      onApply({ svgFill: next });
    } else {
      onApply({ backgroundColor: next });
    }
  };

  // Fill alpha (0..100 percent for the UI). Source of truth: SVG → fill-opacity
  // attr; HTML → rgba() alpha channel on background; Text → rgba() on color.
  const textColorAlpha = (() => {
    if (!isText) return 1;
    const c = readTextColor(element.html);
    if (!c) return 1;
    const m = c.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\)/);
    return m ? parseFloat(m[1]) : 1;
  })();
  const fillAlpha = isText
    ? textColorAlpha
    : isSvg
      ? (projected.svgFillOpacity ?? 1)
      : (projected.backgroundColorAlpha ?? 1);
  const fillAlphaPct = Math.round(fillAlpha * 100);
  const setFillAlpha = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct))) / 100;
    if (isText) {
      // Convert current text color (hex or rgb/rgba) to rgba with the new alpha.
      const c = readTextColor(element.html) || '#000000';
      const rgba = hexOrRgbToRgba(c, clamped);
      onUpdateElement(element.id, { html: applyTextFill(element.html, { kind: 'solid', color: rgba }) });
    } else if (isSvg) onApply({ svgFillOpacity: clamped });
    else onApply({ backgroundColorAlpha: clamped });
  };

  return (
    <div className="space-y-2 min-w-0">
      {/* Mode selector lives in the section header; this section just renders
          the body for the current mode. */}
      {fillMode === 'none' && null}
      {fillMode === 'solid' && !isGradient && (
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <div className="flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 min-w-0">
            <ColorPicker
              value={currentColor || '#000000'}
              onChange={c => {
                if (isText) {
                  onUpdateElement(element.id, { html: applyTextFill(element.html, { kind: 'solid', color: c }) });
                } else if (isSvg) {
                  onApply({ svgFill: c });
                } else {
                  onApply({ backgroundColor: c });
                }
              }}
            />
            <HexTextInput
              value={hexNoHash}
              onCommit={handleHexCommit}
              className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
            />
          </div>
          <LabeledNumberInput
            label=""
            value={fillAlphaPct}
            min={0} max={100} step={1}
            suffix="%"
            onChange={setFillAlpha}
          />
          <div />
        </div>
      )}
      {fillMode === 'solid' && isGradient && (
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <div className="col-span-2 flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] text-[10px] text-muted-foreground">
            <Lock className="w-3 h-3 shrink-0" />
            <span className="italic">Gradient (edit HTML)</span>
          </div>
          <div />
        </div>
      )}
      {fillMode === 'image' && (
        <div className="grid grid-cols-[auto_1fr_1fr_24px] gap-2 items-center">
          <button
            onClick={handleUpload}
            className="w-9 h-6 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] flex items-center justify-center"
            title="Click to replace image"
          >
            <div className="w-4 h-4 rounded bg-cover bg-center shrink-0"
              style={{ backgroundImage: `url('${currentUrl}')` }} />
          </button>
          <LabeledNumberInput
            label=""
            value={fillAlphaPct}
            min={0} max={100} step={1}
            suffix="%"
            onChange={setFillAlpha}
          />
          <select value={fitMode}
            onChange={e => {
              const newHtml = applyImageFitMode(element.html, e.target.value as ImageFitMode);
              onUpdateElement(element.id, { html: newHtml });
            }}
            className={SELECT_CLASS}>
            <option value="cover">Fill</option>
            <option value="contain">Fit</option>
            <option value="stretch">Stretch</option>
          </select>
          <div />
        </div>
      )}
    </div>
  );
}

// ── Shadow section ────────────────────────────────────────────────────────────

type ShadowMode = 'none' | 'drop';

function readShadowMode(element: CanvasElement, projected: ReturnType<typeof projectElement>): ShadowMode {
  const isSvg = element.html.includes('<svg');
  if (isSvg) return projected.svgDropShadow ? 'drop' : 'none';
  return projected.boxShadow ? 'drop' : 'none';
}

function ShadowModeSelect({ element, projected, onUpdateElement }: {
  element: CanvasElement;
  projected: ReturnType<typeof projectElement>;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
}) {
  const isSvg = element.html.includes('<svg');
  const mode = readShadowMode(element, projected);
  const switchTo = (next: ShadowMode) => {
    if (next === mode) return;
    if (next === 'drop') {
      if (isSvg) {
        onUpdateElement(element.id, { html: applySvgDropShadow(element.html, { dx: 0, dy: 4, stdDeviation: 4, color: '#000000', opacity: 0.25 }) });
      } else {
        const div = document.createElement('div');
        div.innerHTML = element.html;
        const el = div.firstElementChild as HTMLElement | null;
        if (el) { el.style.boxShadow = '0px 4px 4px 0px rgba(0, 0, 0, 0.25)'; onUpdateElement(element.id, { html: div.innerHTML }); }
      }
    } else {
      if (isSvg) {
        onUpdateElement(element.id, { html: applySvgDropShadow(element.html, null) });
      } else {
        const div = document.createElement('div');
        div.innerHTML = element.html;
        const el = div.firstElementChild as HTMLElement | null;
        if (el) { el.style.boxShadow = ''; onUpdateElement(element.id, { html: div.innerHTML }); }
      }
    }
  };
  return (
    <select
      value={mode}
      onChange={e => switchTo(e.target.value as ShadowMode)}
      className="text-[10px] pl-1.5 pr-1 h-6 rounded bg-transparent hover:bg-accent/30 border-0 text-foreground focus:outline-none cursor-pointer text-right"
    >
      <option value="none">None</option>
      <option value="drop">Drop Shadow</option>
    </select>
  );
}

function ShadowSection({ element, projected, onUpdateElement }: {
  element: CanvasElement;
  projected: ReturnType<typeof projectElement>;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
}) {
  const isSvg = element.html.includes('<svg');

  const parsedShadow = projected.svgDropShadow;
  const boxShadow = projected.boxShadow;

  // Parse box-shadow string for HTML elements
  const parseBoxShadow = (s: string) => {
    const m = s.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(#[0-9a-fA-F]+|rgba?\([^)]+\))/);
    if (!m) return { x: 0, y: 4, blur: 4, spread: 0, color: '#000000', opacity: 0.25 };
    return { x: parseFloat(m[1]), y: parseFloat(m[2]), blur: parseFloat(m[3]), spread: parseFloat(m[4] ?? '0'), color: m[5], opacity: 1 };
  };

  const hasShadow = isSvg ? parsedShadow !== null : !!boxShadow;
  const sh = isSvg
    ? (parsedShadow ?? { dx: 0, dy: 4, stdDeviation: 4, color: '#000000', opacity: 0.25 })
    : parseBoxShadow(boxShadow ?? '0px 4px 4px #00000040');

  const applyHtmlShadow = (vals: { x: number; y: number; blur: number; spread: number; color: string; opacity: number }) => {
    const div = document.createElement('div');
    div.innerHTML = element.html;
    const el = div.firstElementChild as HTMLElement | null;
    if (!el) return;
    el.style.boxShadow = `${vals.x}px ${vals.y}px ${vals.blur}px ${vals.spread}px ${vals.color}`;
    onUpdateElement(element.id, { html: div.innerHTML });
  };

  const applySvgShadowChange = (vals: SvgDropShadow) => {
    const newHtml = applySvgDropShadow(element.html, vals);
    onUpdateElement(element.id, { html: newHtml });
  };

  if (!hasShadow) {
    // Mode is None — header dropdown drives toggling. No body content.
    return null;
  }

  // Both SVG and HTML drop shadows now share the same UI shape:
  // X / Y row, Blur / Spread row, Color row (swatch + hex + alpha %).
  const xVal = isSvg && parsedShadow ? parsedShadow.dx : (sh as any).x ?? 0;
  const yVal = isSvg && parsedShadow ? parsedShadow.dy : (sh as any).y ?? 0;
  const blurVal = isSvg && parsedShadow ? parsedShadow.stdDeviation : (sh as any).blur ?? 0;
  const spreadVal = isSvg && parsedShadow ? (parsedShadow.spread ?? 0) : (sh as any).spread ?? 0;
  const colorVal = isSvg && parsedShadow ? parsedShadow.color : (sh as any).color ?? '#000000';
  const alphaVal = isSvg && parsedShadow ? parsedShadow.opacity : (() => {
    // Try to read alpha from rgba in stored color, fall back to 1.
    const m = String(colorVal).match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\)/);
    return m ? parseFloat(m[1]) : 1;
  })();
  const colorHex = (() => {
    const c = String(colorVal);
    if (c.startsWith('#')) return c.slice(1).slice(0, 6).toUpperCase();
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
      return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
    }
    return '';
  })();

  const writeShadow = (next: { x: number; y: number; blur: number; spread: number; color: string; alpha: number }) => {
    if (isSvg) {
      applySvgShadowChange({ dx: next.x, dy: next.y, stdDeviation: Math.max(0, next.blur), spread: next.spread, color: next.color, opacity: next.alpha });
    } else {
      // Encode alpha into rgba on the color so box-shadow keeps it
      const c = next.color;
      const hex = c.replace(/^#/, '');
      const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex.slice(0, 6);
      let rgba = c;
      if (/^[0-9a-fA-F]{6}$/.test(full)) {
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        rgba = `rgba(${r}, ${g}, ${b}, ${next.alpha})`;
      }
      applyHtmlShadow({ x: next.x, y: next.y, blur: Math.max(0, next.blur), spread: next.spread, color: rgba, opacity: next.alpha });
    }
  };

  const handleHexCommit = (raw: string) => {
    const cleaned = raw.trim().replace(/^#+/, '').toUpperCase();
    if (!/^[0-9A-F]{3}([0-9A-F]{3})?$/.test(cleaned)) return;
    const expanded = expandHex(cleaned);
    const next = '#' + expanded;
    writeShadow({ x: xVal, y: yVal, blur: blurVal, spread: spreadVal, color: next, alpha: alphaVal });
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 mb-1">
          <SubsectionHeader>X offset</SubsectionHeader>
          <SubsectionHeader>Y offset</SubsectionHeader>
          <div />
        </div>
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <LabeledNumberInput label="X" value={xVal} step={1} onChange={v => writeShadow({ x: v, y: yVal, blur: blurVal, spread: spreadVal, color: colorVal, alpha: alphaVal })} />
          <LabeledNumberInput label="Y" value={yVal} step={1} onChange={v => writeShadow({ x: xVal, y: v, blur: blurVal, spread: spreadVal, color: colorVal, alpha: alphaVal })} />
          <div />
        </div>
      </div>
      <div>
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 mb-1">
          <SubsectionHeader>Blur</SubsectionHeader>
          <SubsectionHeader>Spread</SubsectionHeader>
          <div />
        </div>
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <LabeledNumberInput label={<Grip className="w-3 h-3" />} value={blurVal} min={0} step={1} onChange={v => writeShadow({ x: xVal, y: yVal, blur: v, spread: spreadVal, color: colorVal, alpha: alphaVal })} />
          <LabeledNumberInput label={<Loader className="w-3 h-3" />} value={spreadVal} step={1} onChange={v => writeShadow({ x: xVal, y: yVal, blur: blurVal, spread: v, color: colorVal, alpha: alphaVal })} />
          <div />
        </div>
      </div>
      <div>
        <SubsectionHeader>Color</SubsectionHeader>
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
          <div className="flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 min-w-0">
            <ColorPicker
              value={'#' + (colorHex || '000000')}
              onChange={c => writeShadow({ x: xVal, y: yVal, blur: blurVal, spread: spreadVal, color: c, alpha: alphaVal })}
            />
            <HexTextInput
              value={colorHex}
              onCommit={handleHexCommit}
              className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
            />
          </div>
          <LabeledNumberInput
            label=""
            value={Math.round(alphaVal * 100)}
            min={0} max={100} step={1}
            suffix="%"
            onChange={v => {
              const clamped = Math.max(0, Math.min(100, Math.round(v))) / 100;
              writeShadow({ x: xVal, y: yVal, blur: blurVal, spread: spreadVal, color: colorVal, alpha: clamped });
            }}
          />
          <div />
        </div>
      </div>
    </div>
  );
}

// ── Frame image input ─────────────────────────────────────────────────────────

function FrameImageInput({ frame, onUpdateFrame }: {
  frame: CanvasPage;
  onUpdateFrame: (pageId: string, updates: Partial<CanvasPage>) => void;
}) {
  const hasImage = !!frame.background_image;
  const handleUpload = async () => {
    try {
      const files = await pickFile({ accept: 'image/*' });
      const file = files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${API_BASE}/uploads`, { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
      const respData = await resp.json();
      const url = respData.url?.startsWith('http') ? respData.url : `${API_BASE}${respData.url?.replace(/^\/api/, '')}`;
      onUpdateFrame(frame.page_id, { background_image: url });
    } catch (err) {
      showError('Failed to upload image', err);
    }
  };
  return (
    <Row label="Bg Image">
      {hasImage ? (
        <div className="flex items-center gap-1 min-w-0">
          <div className="w-6 h-6 rounded border bg-cover bg-center shrink-0" style={{ backgroundImage: `url('${frame.background_image}')` }} />
          <span className="flex-1 text-[11px] text-muted-foreground truncate">{frame.background_image!.split('/').pop()}</span>
          <button onClick={() => onUpdateFrame(frame.page_id, { background_image: '' })}
            className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground shrink-0" title="Remove image">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button onClick={handleUpload}
          className="w-full text-[11px] px-1.5 py-1 rounded border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50 flex items-center gap-1 justify-center">
          <Upload className="h-3 w-3" /> Upload
        </button>
      )}
    </Row>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CanvasPropertyPanel({
  element,
  selectedElements,
  frame,
  selectedCount,
  designTokens,
  subElementSelection,
  canvasBackgroundColor,
  onUpdateElement,
  onUpdateFrame,
  onUpdateToken,
  onUpdateCanvasBackground,
  onClose,
  onDelete,
  onDuplicate,
  onGroup,
  onUngroup,
  onAlign,
  onLock,
  onBooleanOp,
  onRenameElement,
  onRenameFrame,
  onDuplicateFrame,
  onDeleteFrame,
  onMoveSelection,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onExportPng,
  onExportSvg,
  canExportSvg,
}: {
  element: CanvasElement | null;
  selectedElements?: CanvasElement[];
  frame: CanvasPage | null;
  selectedCount: number;
  designTokens: DesignToken[];
  subElementSelection?: SubElementSelection | null;
  canvasBackgroundColor?: string;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
  onUpdateFrame: (pageId: string, updates: Partial<CanvasPage>) => void;
  onUpdateToken: (name: string, value: string) => void;
  onUpdateCanvasBackground?: (color: string) => void;
  onClose: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onAlign?: (alignment: string) => void;
  onLock?: () => void;
  onBooleanOp?: (op: 'union' | 'difference' | 'intersection' | 'exclusion') => void;
  onRenameElement?: (id: string, name: string) => void;
  onRenameFrame?: (pageId: string, title: string) => void;
  onDuplicateFrame?: (pageId: string) => void;
  onDeleteFrame?: (pageId: string) => void;
  onMoveSelection?: (dx: number, dy: number) => void;
  onBringForward?: (id: string) => void;
  onSendBackward?: (id: string) => void;
  onBringToFront?: (id: string) => void;
  onSendToBack?: (id: string) => void;
  onExportPng?: () => void;
  onExportSvg?: () => void;
  canExportSvg?: boolean;
}) {
  const [showCode, setShowCode] = useState(false);

  // ── Multi-selection: compute leaves + property union ──────────────────────
  const allSelected = useMemo(
    () => selectedElements ?? (element ? [element] : []),
    [selectedElements, element],
  );

  const leaves = useMemo(() => flattenToLeaves(allSelected), [allSelected]);
  const support = useMemo(() => computePropertyUnion(leaves), [leaves]);
  const aggregated = useMemo(() => aggregateProps(leaves), [leaves]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const applyToAll = useCallback((changes: Partial<ProjectedProps>) => {
    for (const el of allSelected) {
      const [updated] = applyToLeaves([el], changes);
      if (updated.type === 'group') {
        if (updated.children !== el.children) onUpdateElement(el.id, { children: updated.children });
      } else {
        if (updated.html !== el.html) onUpdateElement(el.id, { html: updated.html });
      }
    }
  }, [allSelected, onUpdateElement]);

  const applyChange = useCallback((changes: Partial<ProjectedProps>) => {
    if (!element) return;
    const subCssPath = subElementSelection?.cssPath || undefined;
    const newHtml = applyProjection(element.html, changes, subCssPath);
    onUpdateElement(element.id, { html: newHtml });
  }, [element, subElementSelection, onUpdateElement]);

  const isGroup = element?.type === 'group';
  const isSingle = selectedCount === 1 && !!element;
  const isMulti = selectedCount > 1;
  const isSvg = isSingle && element.html.includes('<svg');

  // ── Panel header ──────────────────────────────────────────────────────────

  const allGroups = isMulti && selectedElements?.every(el => el.type === 'group');
  const allSvg = isMulti && selectedElements?.every(el => el.html?.includes('<svg') && !el.html?.includes('contenteditable'));

  const headerTitle = subElementSelection ? 'Sub-Element'
    : isGroup ? 'Group'
    : isSingle ? 'Element'
    : isMulti ? (allGroups ? `${selectedCount} Groups` : `${selectedCount} Selected`)
    : frame ? 'Frame'
    : 'Canvas';

  const panelClass = 'w-[240px] min-w-[240px] border-l border-border flex flex-col shrink-0 bg-card h-full shadow-lg';

  // Aspect lock lives on the element (so drag-resize in CanvasEditor can read it).
  const aspectLocked = element?.aspect_locked === true;
  const aspectRatio = useRef<number>(1);

  const selectionBounds = useMemo(() => {
    if (!selectedElements || selectedElements.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of selectedElements) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.w);
      maxY = Math.max(maxY, el.y + el.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [selectedElements]);

  // ── No selection: Canvas / Frame ──────────────────────────────────────────

  if (!element && selectedCount === 0) {
    return (
      <div className={panelClass} onWheel={e => e.stopPropagation()}>
        {/* Header: "1 selected" / "Canvas" + actions on same row, right-aligned */}
        <div className="px-3 py-2 flex items-center gap-1 shrink-0">
          <span className="text-[12px] font-medium text-foreground">
            {frame ? '1 selected' : 'Canvas'}
          </span>
          <div className="flex-1" />
          {frame && onDuplicateFrame && <IconBtn icon={Copy} onClick={() => onDuplicateFrame(frame.page_id)} title="Duplicate Frame" />}
          {frame && onDeleteFrame && <IconBtn icon={Trash} onClick={() => onDeleteFrame(frame.page_id)} title="Delete Frame" danger />}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
        {frame && (
          <>
            {/* §2 Position */}
            <SectionHeader>Position</SectionHeader>
            <div className="px-3 pb-3">
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                <LabeledNumberInput label="X" value={frame.frame_x ?? 0} onChange={v => onUpdateFrame(frame.page_id, { frame_x: v })} />
                <LabeledNumberInput label="Y" value={frame.frame_y ?? 0} onChange={v => onUpdateFrame(frame.page_id, { frame_y: v })} />
                <div />
              </div>
            </div>
            {/* §3 Dimensions */}
            <SectionHeader>Dimensions</SectionHeader>
            <div className="px-3 pb-3">
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                <LabeledNumberInput label="W" value={frame.width} min={100} onChange={w => onUpdateFrame(frame.page_id, { width: w })} />
                <LabeledNumberInput label="H" value={frame.height} min={100} onChange={h => onUpdateFrame(frame.page_id, { height: h })} />
                <div />
              </div>
            </div>
            {/* §4 Appearance: Corner radius (frame has no opacity yet — only Radius) */}
            <SectionHeader>Appearance</SectionHeader>
            <div className="px-3 pb-3">
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-end">
                <CornerRadiusField
                  value={frame.border_radius ?? 0}
                  onChange={v => onUpdateFrame(frame.page_id, { border_radius: v })}
                />
                <div />
                <div />
              </div>
            </div>
            {/* §5 Fill: header trailing dropdown + body */}
            {(() => {
              const isNone = !frame.background_image && (!frame.background_color || frame.background_color === 'transparent');
              const fillMode: 'solid' | 'image' | 'none' = frame.background_image
                ? 'image'
                : isNone
                  ? 'none'
                  : 'solid';
              const switchTo = (next: 'solid' | 'image' | 'none') => {
                if (next === fillMode) return;
                if (next === 'solid') {
                  const c = (frame.background_color && frame.background_color !== 'transparent') ? frame.background_color : '#ffffff';
                  onUpdateFrame(frame.page_id, { background_color: c, background_image: '' });
                } else if (next === 'image') {
                  onUpdateFrame(frame.page_id, { background_image: frame.background_image || '' });
                } else {
                  onUpdateFrame(frame.page_id, { background_color: 'transparent', background_image: '' });
                }
              };
              const bg = frame.background_color || '#ffffff';
              const hexNoHash = bg.startsWith('#') ? bg.slice(1).toUpperCase() : (() => {
                const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                if (m) {
                  const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
                  return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
                }
                return '';
              })();
              const handleHexCommit = (raw: string) => {
                const cleaned = raw.trim().replace(/^#+/, '').toUpperCase();
                if (!/^[0-9A-F]{3}([0-9A-F]{3})?$/.test(cleaned)) return;
                const expanded = cleaned.length === 3 ? cleaned.split('').map(c => c + c).join('') : cleaned;
                onUpdateFrame(frame.page_id, { background_color: '#' + expanded });
              };
              return (
                <>
                  <SectionHeader trailing={(
                    <select
                      value={fillMode}
                      onChange={e => switchTo(e.target.value as 'solid' | 'image' | 'none')}
                      className="text-[10px] pl-1.5 pr-1 h-6 rounded bg-transparent hover:bg-accent/30 border-0 text-foreground focus:outline-none cursor-pointer text-right"
                    >
                      <option value="solid">Solid</option>
                      <option value="image">Image</option>
                      <option value="none">None</option>
                    </select>
                  )}>Fill</SectionHeader>
                  {fillMode !== 'none' && (
                    <div className="px-3 pb-3 space-y-2">
                      {fillMode === 'solid' && (
                        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                          <div className="col-span-2 flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 min-w-0">
                            <ColorPicker
                              value={bg}
                              onChange={c => onUpdateFrame(frame.page_id, { background_color: c })}
                            />
                            <HexTextInput
                              value={hexNoHash}
                              onCommit={handleHexCommit}
                              className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
                            />
                          </div>
                          <div />
                        </div>
                      )}
                      {fillMode === 'image' && (
                        <FrameImageInput frame={frame} onUpdateFrame={onUpdateFrame} />
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}
        {!frame && onUpdateCanvasBackground && (() => {
          const bg = canvasBackgroundColor || '#F5F7F5';
          const hex = bg.startsWith('#') ? bg.slice(1).toUpperCase() : (() => {
            const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m) {
              const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
              return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
            }
            return '';
          })();
          const handleHexCommit = (raw: string) => {
            const cleaned = raw.trim().replace(/^#+/, '').toUpperCase();
            if (!/^[0-9A-F]{3}([0-9A-F]{3})?$/.test(cleaned)) return;
            const expanded = cleaned.length === 3 ? cleaned.split('').map(c => c + c).join('') : cleaned;
            onUpdateCanvasBackground('#' + expanded);
          };
          return (
            <>
              <SectionHeader>Background</SectionHeader>
              <div className="px-3 pb-3">
                <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                  <div className="col-span-2 flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 min-w-0">
                    <ColorPicker
                      value={bg}
                      onChange={c => onUpdateCanvasBackground(c)}
                    />
                    <HexTextInput
                      value={hex}
                      onCommit={handleHexCommit}
                      className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
                    />
                  </div>
                  <div />
                </div>
              </div>
            </>
          );
        })()}
        {/* Design Tokens + Export only show for frame (canvas-empty has Background only) */}
        {frame && designTokens.length > 0 && (
          <>
            <SectionHeader>Design Tokens</SectionHeader>
            <div className="px-3 pb-3 space-y-2">
              {designTokens.map(token => (
                <ColorRow key={token.name} label={token.name.replace('--', '')}
                  value={token.value} onChange={v => onUpdateToken(token.name, v)} />
              ))}
            </div>
          </>
        )}
        {frame && onExportPng && (
          <>
            <SectionHeader>Export</SectionHeader>
            <div className="px-3 pb-3 flex gap-2">
              <button
                onClick={onExportPng}
                className="flex-1 flex items-center justify-center gap-1.5 h-7 text-[10px] font-medium rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] text-foreground transition-colors"
              >
                <Download className="h-3 w-3" />
                PNG
              </button>
              {canExportSvg && onExportSvg && (
                <button
                  onClick={onExportSvg}
                  className="flex-1 flex items-center justify-center gap-1.5 h-7 text-[10px] font-medium rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" />
                  SVG
                </button>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    );
  }

  // ── Sub-element mode ──────────────────────────────────────────────────────

  if (subElementSelection && element) {
    const projected = projectElement(element.html, subElementSelection.cssPath || undefined);
    return (
      <div className={panelClass} onWheel={e => e.stopPropagation()}>
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Sub-Element</span>
        </div>
        {subElementSelection.breadcrumbs.length > 1 && (
          <div className="px-3 py-1.5 border-b border-border flex items-center gap-1 flex-wrap">
            {subElementSelection.breadcrumbs.map((bc, i) => (
              <span key={i} className="text-[10px] text-muted-foreground">
                {i > 0 && <span className="mx-0.5">&gt;</span>}
                <span className={i === subElementSelection.breadcrumbs.length - 1 ? 'text-foreground font-medium' : ''}>{bc.label}</span>
              </span>
            ))}
          </div>
        )}
        {subElementSelection.isPositioned && (
          <>
            <SectionHeader>Position</SectionHeader>
            <div className="p-3">
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                <Row label="X"><NumberInput value={projected.subLeft ?? 0} onChange={v => applyChange({ subLeft: v })} /></Row>
                <Row label="Y"><NumberInput value={projected.subTop ?? 0} onChange={v => applyChange({ subTop: v })} /></Row>
                <div />
                <Row label="W"><NumberInput value={projected.subWidth ?? 0} min={0} onChange={v => applyChange({ subWidth: v })} /></Row>
                <Row label="H"><NumberInput value={projected.subHeight ?? 0} min={0} onChange={v => applyChange({ subHeight: v })} /></Row>
                <div />
              </div>
            </div>
          </>
        )}
        <SectionHeader>Appearance</SectionHeader>
        <div className="p-3 space-y-2">
          <ColorRow label="Fill" value={projected.backgroundColor || ''} onChange={v => applyChange({ backgroundColor: v })} />
          <ColorRow label="Text" value={projected.color || ''} onChange={v => applyChange({ color: v })} />
          {projected.fontSize !== undefined && (
            <Row label="Font Size"><NumberInput value={projected.fontSize} min={1} onChange={v => applyChange({ fontSize: v })} /></Row>
          )}
          <Row label="Opacity"><NumberInput value={projected.opacity ?? 1} min={0} max={1} step={0.1} onChange={v => applyChange({ opacity: v })} /></Row>
        </div>
      </div>
    );
  }

  // ── Element(s) selected ───────────────────────────────────────────────────

  const projected = isSingle ? projectElement(element!.html) : null;
  const isHtmlBlock = isSingle && projected && !projected.isSvgShape && !element!.html.includes('contenteditable');

  return (
    <div className={panelClass} onWheel={e => e.stopPropagation()}>
      {/* Header: "N selected" + actions on same row, right-aligned */}
      <div className="px-3 py-2 flex items-center gap-1 shrink-0">
        <span className="text-[12px] font-medium text-foreground">
          {selectedCount} selected
        </span>
        <div className="flex-1" />
        {onDuplicate && <IconBtn icon={Copy} onClick={onDuplicate} title="Duplicate" />}
        {onDelete && <IconBtn icon={Trash} onClick={onDelete} title="Delete" danger />}
        {onLock && element && <IconBtn icon={element.locked ? Unlock : Lock} onClick={onLock} title={element.locked ? 'Unlock' : 'Lock'} />}
        {isMulti && onGroup && <IconBtn icon={Group} onClick={onGroup} title="Group (Cmd+G)" />}
        {isGroup && onUngroup && <IconBtn icon={Ungroup} onClick={onUngroup} title="Ungroup (Cmd+Shift+G)" />}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">

      {/* §2 Boolean ops (multi-svg only) — no header, just 4 icons */}
      {isMulti && allSvg && onBooleanOp && (
        <div className="px-3 py-2 flex items-center gap-0.5 border-b border-border">
          <IconBtn icon={SquaresUnite} onClick={() => onBooleanOp('union')} title="Union" />
          <IconBtn icon={SquaresSubtract} onClick={() => onBooleanOp('difference')} title="Subtract" />
          <IconBtn icon={SquaresIntersect} onClick={() => onBooleanOp('intersection')} title="Intersect" />
          <IconBtn icon={SquaresExclude} onClick={() => onBooleanOp('exclusion')} title="Exclude" />
        </div>
      )}

      {/* §3 Position: Alignment (multi) / Position (X,Y) / Rotation as 3 subsections */}
      {((isMulti && onAlign) || (isSingle && !subElementSelection && element) || (isMulti && selectionBounds)) && (
        <>
          <SectionHeader>Position</SectionHeader>
          <div className="px-3 pb-3 space-y-2">
            {isMulti && onAlign && (
              <div>
                <SubsectionHeader>Alignment</SubsectionHeader>
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Horizontal alignment group */}
                  <div className="flex items-center gap-0.5">
                    <IconBtn icon={AlignStartHorizontal} onClick={() => onAlign('left')} title="Align left" />
                    <IconBtn icon={AlignHorizontalJustifyCenter} onClick={() => onAlign('center-h')} title="Center horizontal" />
                    <IconBtn icon={AlignEndHorizontal} onClick={() => onAlign('right')} title="Align right" />
                  </div>
                  {/* Vertical alignment group */}
                  <div className="flex items-center gap-0.5">
                    <IconBtn icon={AlignStartVertical} onClick={() => onAlign('top')} title="Align top" />
                    <IconBtn icon={AlignVerticalJustifyCenter} onClick={() => onAlign('center-v')} title="Center vertical" />
                    <IconBtn icon={AlignEndVertical} onClick={() => onAlign('bottom')} title="Align bottom" />
                  </div>
                  {selectedCount >= 3 && (
                    <div className="flex items-center gap-0.5">
                      <IconBtn icon={AlignHorizontalSpaceAround} onClick={() => onAlign('distribute-h')} title="Distribute horizontally" />
                      <IconBtn icon={AlignVerticalSpaceAround} onClick={() => onAlign('distribute-v')} title="Distribute vertically" />
                    </div>
                  )}
                </div>
              </div>
            )}
            {((isSingle && !subElementSelection && element) || (isMulti && selectionBounds)) && (
              <div>
                <SubsectionHeader>Position</SubsectionHeader>
                <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                  {isSingle && element && !subElementSelection ? (
                    <>
                      <LabeledNumberInput label="X" value={element.x} onChange={v => onUpdateElement(element.id, { x: v })} />
                      <LabeledNumberInput label="Y" value={element.y} onChange={v => onUpdateElement(element.id, { y: v })} />
                      <div />
                    </>
                  ) : isMulti && selectionBounds ? (
                    <>
                      <LabeledNumberInput label="X" value={selectionBounds.x} onChange={v => {
                        const dx = v - selectionBounds.x;
                        if (dx !== 0 && onMoveSelection) onMoveSelection(dx, 0);
                      }} />
                      <LabeledNumberInput label="Y" value={selectionBounds.y} onChange={v => {
                        const dy = v - selectionBounds.y;
                        if (dy !== 0 && onMoveSelection) onMoveSelection(0, dy);
                      }} />
                      <div />
                    </>
                  ) : null}
                </div>
              </div>
            )}
            {isSingle && !subElementSelection && element && (
              <div>
                <SubsectionHeader>Rotation</SubsectionHeader>
                <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                  <LabeledNumberInput
                    label="∠"
                    value={element.rotation ?? 0}
                    step={1}
                    suffix="°"
                    onChange={v => {
                      const normalized = ((v % 360) + 360) % 360;
                      onUpdateElement(element.id, { rotation: normalized });
                    }}
                  />
                  <div />
                  <div />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* §4 Dimensions: W/H + aspect lock + (text resize mode) + (polygon sides/points) */}
      {((isSingle && !subElementSelection && element) || (isMulti && selectionBounds)) && (
        <>
          <SectionHeader>Dimensions</SectionHeader>
          <div className="px-3 pb-3 space-y-2">
            {isSingle && !subElementSelection && element && (
              <>
                <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                  <LabeledNumberInput label="W" value={element.w} min={20} onChange={v => {
                    const textMode = getTextResizeMode(element.html);
                    const updates: Partial<CanvasElement> = aspectLocked
                      ? { w: v, h: Math.round(v / aspectRatio.current) }
                      : { w: v };
                    if (textMode && textMode !== 'fixed') {
                      let newHtml = element.html;
                      if (textMode === 'auto') {
                        newHtml = setTextResizeMode(newHtml, 'fixed-width');
                      }
                      updates.html = newHtml;
                      if (typeof document !== 'undefined') {
                        const measurer = document.createElement('div');
                        measurer.style.cssText = `position:absolute;left:-9999px;top:-9999px;visibility:hidden;width:${v}px;`;
                        measurer.innerHTML = newHtml;
                        document.body.appendChild(measurer);
                        const inner = measurer.firstElementChild as HTMLElement | null;
                        if (inner) {
                          inner.style.width = `${v}px`;
                          const rect = inner.getBoundingClientRect();
                          updates.h = Math.max(20, Math.ceil(rect.height));
                        }
                        if (measurer.isConnected) document.body.removeChild(measurer);
                      }
                    }
                    onUpdateElement(element.id, updates);
                  }} />
                  <LabeledNumberInput label="H" value={element.h} min={20} onChange={v => {
                    if (aspectLocked) {
                      onUpdateElement(element.id, { h: v, w: Math.round(v * aspectRatio.current) });
                    } else {
                      onUpdateElement(element.id, { h: v });
                    }
                  }} />
                  <button
                    className={cn('w-6 h-6 flex items-center justify-center rounded transition-colors',
                      aspectLocked ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')}
                    onClick={() => {
                      if (!aspectLocked && element) aspectRatio.current = element.w / element.h;
                      onUpdateElement(element.id, { aspect_locked: !aspectLocked });
                    }}
                    title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                  >
                    {aspectLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                </div>
                {/* Text Resize mode: only for text elements */}
                {(() => {
                  const mode = getTextResizeMode(element.html);
                  if (!mode) return null;
                  const modes: { key: TextResizeMode; icon: typeof MoveHorizontal; title: string }[] = [
                    { key: 'auto', icon: MoveHorizontal, title: 'Auto width' },
                    { key: 'fixed-width', icon: MoveVertical, title: 'Auto height' },
                    { key: 'fixed', icon: Square, title: 'Fixed size' },
                  ];
                  return (
                    <div>
                      <SubsectionHeader>Resize mode</SubsectionHeader>
                      <div className="flex gap-1">
                        {modes.map(m => {
                          const Icon = m.icon;
                          const active = mode === m.key;
                          return (
                            <button key={m.key} title={m.title}
                              className={cn('flex-1 h-6 flex items-center justify-center rounded transition-colors',
                                active ? 'bg-white text-foreground ring-1 ring-border' : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
                              onClick={() => {
                                const newHtml = setTextResizeMode(element.html, m.key);
                                const updates: Partial<CanvasElement> = { html: newHtml };
                                if (m.key !== 'fixed' && typeof document !== 'undefined') {
                                  const measurer = document.createElement('div');
                                  measurer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
                                  if (m.key === 'fixed-width') measurer.style.width = `${element.w}px`;
                                  measurer.innerHTML = newHtml;
                                  document.body.appendChild(measurer);
                                  const inner = measurer.firstElementChild as HTMLElement | null;
                                  if (inner) {
                                    if (m.key === 'auto') { inner.style.width = 'auto'; inner.style.whiteSpace = 'nowrap'; }
                                    else { inner.style.width = `${element.w}px`; }
                                    const rect = inner.getBoundingClientRect();
                                    if (m.key === 'auto') updates.w = Math.max(20, Math.ceil(rect.width));
                                    updates.h = Math.max(20, Math.ceil(rect.height));
                                  }
                                  if (measurer.isConnected) document.body.removeChild(measurer);
                                }
                                onUpdateElement(element.id, updates);
                              }}>
                              <Icon className="w-3 h-3" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
            {isMulti && selectionBounds && (
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                <div className="flex items-center gap-1.5 px-2 h-6 rounded bg-[#F5F5F5]">
                  <span className="text-[10px] text-muted-foreground select-none">W</span>
                  <span className="text-[10px] text-foreground font-mono tabular-nums">{Math.round(selectionBounds.w)}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 h-6 rounded bg-[#F5F5F5]">
                  <span className="text-[10px] text-muted-foreground select-none">H</span>
                  <span className="text-[10px] text-foreground font-mono tabular-nums">{Math.round(selectionBounds.h)}</span>
                </div>
                <div />
              </div>
            )}
          </div>
        </>
      )}

      {/* §5 Appearance: opacity + corner radius */}
      {(isSingle || isMulti) && (() => {
        const opacityVal = isSingle ? (projected?.opacity ?? 1) : (aggregated.opacity === 'mixed' ? null : (aggregated.opacity ?? null));
        // Display in 0-100 percent. Clamp on commit.
        const opacityPct = opacityVal == null ? null : Math.round(opacityVal * 100);
        // Detect if a Radius input should render
        const hasRadius =
          (isSingle && projected?.isSvgShape) ||
          (isSingle && projected && !projected.isSvgShape && projected.borderRadius !== undefined) ||
          isMulti;
        const radiusValue = !hasRadius ? null
          : isSingle && projected?.isSvgShape && projected.borderRadius === -1 ? null
          : isSingle && projected ? (projected.borderRadius ?? 0)
          : isMulti && aggregated.borderRadius === 'mixed' ? null
          : (aggregated.borderRadius ?? null);
        const radiusPlaceholder =
          (isSingle && projected?.isSvgShape && projected.borderRadius === -1) ||
          (isMulti && aggregated.borderRadius === 'mixed')
            ? 'Mixed' : undefined;
        return (
          <>
            <SectionHeader>Appearance</SectionHeader>
            <div className="px-3 pb-3 space-y-2">
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-end">
                <div>
                  <SubsectionHeader>Opacity</SubsectionHeader>
                  <LabeledNumberInput
                    label={<Eclipse className="w-3 h-3" />}
                    value={opacityPct}
                    min={0} max={100} step={1}
                    suffix="%"
                    onChange={v => {
                      const clamped = Math.min(100, Math.max(0, Math.round(v)));
                      const asFraction = clamped / 100;
                      isSingle ? applyChange({ opacity: asFraction }) : applyToAll({ opacity: asFraction });
                    }}
                    placeholder="Mixed"
                  />
                </div>
                {hasRadius ? (
                  <CornerRadiusField
                    value={radiusValue}
                    onChange={v => {
                      const clamped = Math.max(0, v);
                      isSingle ? applyChange({ borderRadius: clamped }) : applyToAll({ borderRadius: clamped });
                    }}
                    placeholder={radiusPlaceholder}
                  />
                ) : <div />}
                <div />
              </div>
              {/* Polygon sides / star points (single SVG only) */}
              {isSingle && element && (() => {
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
                          const newHtml = updateParametricShape(element.html, ps.kind, clamped, element.w, element.h);
                          onUpdateElement(element.id, { html: newHtml });
                        }}
                      />
                    </div>
                    <div />
                    <div />
                  </div>
                );
              })()}
            </div>
          </>
        );
      })()}

      {/* §6 Typography (non-svg single with font, or multi with font support) */}
      {((isSingle && projected && !projected.isSvgShape && projected.fontSize !== undefined) || (isMulti && support.font)) && (
        <>
          <SectionHeader>Text</SectionHeader>
          <div className="px-3 pb-3 space-y-2">
            {isSingle && projected && !projected.isSvgShape && element && (
              <>
                {/* Font family — keeps the right 24px icon column reserved */}
                {projected.fontFamily !== undefined && (
                  <div className="grid grid-cols-[1fr_24px] gap-2 items-center">
                    <MutedSelect
                      value={projected.fontFamily ?? ''}
                      onChange={family => {
                        if (CANVAS_FONTS.google.includes(family)) loadGoogleFont(family);
                        applyChange({ fontFamily: family });
                      }}>
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
                    </MutedSelect>
                    <div />
                  </div>
                )}
                {/* Weight + Size */}
                <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                  {projected.fontWeight !== undefined ? (
                    <MutedSelect value={projected.fontWeight || '400'}
                      onChange={v => applyChange({ fontWeight: v })}>
                      <option value="300">Light</option>
                      <option value="400">Regular</option>
                      <option value="500">Medium</option>
                      <option value="600">Semibold</option>
                      <option value="700">Bold</option>
                      <option value="900">Black</option>
                    </MutedSelect>
                  ) : <div />}
                  {projected.fontSize !== undefined ? (
                    <LabeledNumberInput
                      label={<ALargeSmall className="w-3 h-3" />}
                      value={projected.fontSize}
                      min={1}
                      onChange={v => applyChange({ fontSize: v })}
                    />
                  ) : <div />}
                  <div />
                </div>
                {projected.fontSize !== undefined && (
                  <>
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
                          value={projected.lineHeight ?? null}
                          min={0.5} max={10} step={0.1}
                          onChange={v => applyChange({ lineHeight: v })}
                          placeholder="Auto"
                        />
                        <LabeledNumberInput
                          label={<RulerDimensionLine className="w-3 h-3" />}
                          value={projected.letterSpacing ?? 0}
                          step={0.5}
                          onChange={v => applyChange({ letterSpacing: v })}
                          suffix="px"
                        />
                        <div />
                      </div>
                    </div>
                    {/* Alignment row: 3 horizontal + 3 vertical + Settings ⚙ */}
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
                                projected.textAlign === a
                                  ? 'bg-white text-foreground ring-1 ring-border'
                                  : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
                              onClick={() => applyChange({ textAlign: a })}
                              title={`Align ${a}`}>
                              <Icon className="w-3 h-3" />
                            </button>
                          ))}
                        </div>
                        <div className="flex-1 grid grid-cols-3 gap-0.5">
                          {([
                            ['top', ArrowUpToLine],
                            ['middle', SeparatorHorizontal],
                            ['bottom', ArrowDownToLine],
                          ] as const).map(([a, Icon]) => (
                            <button key={a}
                              className={cn('h-6 flex items-center justify-center rounded transition-colors',
                                (projected.verticalAlign ?? 'top') === a
                                  ? 'bg-white text-foreground ring-1 ring-border'
                                  : 'bg-[#F5F5F5] text-muted-foreground hover:bg-muted hover:text-foreground')}
                              onClick={() => applyChange({ verticalAlign: a })}
                              title={`V-align ${a}`}>
                              <Icon className="w-3 h-3" />
                            </button>
                          ))}
                        </div>
                        <TextSettingsPopover
                          projected={projected}
                          applyChange={applyChange}
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            {isMulti && support.font && (
              <>
                <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                  <LabeledNumberInput label="Aa"
                    value={aggregated.fontSize === 'mixed' ? null : (aggregated.fontSize ?? null)} min={1}
                    onChange={v => applyToAll({ fontSize: v })} placeholder="Mixed" />
                  <div />
                  <div />
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* §7 Fill */}
      {((isSingle && projected && element) || (isMulti && support.fill)) && (
        <>
          <SectionHeader trailing={isSingle && projected && element ? (
            <FillModeSelect element={element} projected={projected} onApply={applyChange} onUpdateElement={onUpdateElement} />
          ) : undefined}>Fill</SectionHeader>
          <div className="px-3 pb-3 space-y-2">
            {isSingle && projected && element && (
              <FillSection element={element} projected={projected} onApply={applyChange} onUpdateElement={onUpdateElement} />
            )}
            {isMulti && support.fill && (
              <ColorRow label="Fill"
                value={aggregated.svgFill === 'mixed' ? '' : (aggregated.svgFill || aggregated.backgroundColor || aggregated.color || '')}
                onChange={v => {
                  // Text leaves: write color via applyTextFill so the fill maps to text color.
                  // SVG leaves: write svgFill. Other HTML leaves: write backgroundColor.
                  const textLeaves = leaves.filter(l => l.html.includes('contenteditable'));
                  const svgLeaves = leaves.filter(l => l.html.includes('<svg') && !l.html.includes('contenteditable'));
                  const otherHtmlLeaves = leaves.filter(l => !l.html.includes('<svg') && !l.html.includes('contenteditable'));
                  if (textLeaves.length > 0) {
                    textLeaves.forEach(leaf => onUpdateElement(leaf.id, { html: applyTextFill(leaf.html, { kind: 'solid', color: v }) }));
                  }
                  if (svgLeaves.length > 0) applyToAll({ svgFill: v });
                  if (otherHtmlLeaves.length > 0) applyToAll({ backgroundColor: v });
                }}
              />
            )}
          </div>
        </>
      )}

      {/* §8 Stroke — header has Line/None mode select; body shows controls when 'line' */}
      {((isSingle && projected?.isSvgShape) || (isSingle && isHtmlBlock && projected) || (isMulti && support.stroke)) && (() => {
        const strokeMode: StrokeMode = isSingle && projected ? readStrokeMode(projected) : 'line';
        // Resolve colors / opacity for the active branch.
        const isSvg = !!(isSingle && projected?.isSvgShape);
        const strokeColor = isSvg ? (projected?.svgStroke || '') : (projected?.borderColor || '');
        const strokeHex = strokeColor && strokeColor.startsWith('#') ? strokeColor.slice(1).toUpperCase() : (strokeColor || '').toUpperCase();
        const strokeAlpha = isSvg ? (projected?.svgStrokeOpacity ?? 1) : 1; // no html stroke alpha modeled
        const strokeAlphaPct = Math.round(strokeAlpha * 100);
        const setStrokeAlpha = (pct: number) => {
          const clamped = Math.max(0, Math.min(100, Math.round(pct))) / 100;
          if (isSvg) applyChange({ svgStrokeOpacity: clamped });
          // HTML borders: not modeled
        };
        const handleHexCommit = (raw: string) => {
          const cleaned = raw.trim().replace(/^#+/, '').toUpperCase();
          if (!/^[0-9A-F]{3}([0-9A-F]{3})?$/.test(cleaned)) return;
          const expanded = expandHex(cleaned);
          const next = '#' + expanded;
          if (isSvg) applyChange({ svgStroke: next });
          else applyChange({ borderColor: next });
        };
        return (
          <>
            <SectionHeader trailing={isSingle && projected ? (
              <StrokeModeSelect projected={projected} onApply={applyChange} />
            ) : undefined}>Stroke</SectionHeader>
            {strokeMode === 'line' && (
              <div className="px-3 pb-3 space-y-2">
                {isSingle && projected?.isSvgShape && element && (
                  <>
                    {/* Row 1: color swatch + hex + opacity */}
                    <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                      <div className="flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 min-w-0">
                        <ColorPicker
                          value={strokeColor || '#000000'}
                          onChange={c => applyChange({ svgStroke: c })}
                        />
                        <HexTextInput
                          value={strokeHex}
                          onCommit={handleHexCommit}
                          className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
                        />
                      </div>
                      <LabeledNumberInput label="" value={strokeAlphaPct} min={0} max={100} step={1} suffix="%" onChange={setStrokeAlpha} />
                      <div />
                    </div>
                    {/* Row 2: Position + Weight + Settings */}
                    <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                      <select value={projected.svgStrokeAlignment || 'center'}
                        onChange={e => applyChange({ svgStrokeAlignment: e.target.value as 'center' | 'inside' | 'outside' })}
                        className={SELECT_CLASS}>
                        <option value="center">Center</option>
                        <option value="inside">Inside</option>
                        <option value="outside">Outside</option>
                      </select>
                      <LabeledNumberInput label="W" value={projected.svgStrokeWidth ?? 2} min={0} step={0.5}
                        onChange={v => applyChange({ svgStrokeWidth: v })} />
                      <StrokeSettingsPopover
                        isSvg
                        isHtmlBlock={false}
                        projected={projected}
                        applyChange={applyChange}
                        element={element}
                        onUpdateElement={onUpdateElement}
                      />
                    </div>
                  </>
                )}
                {isSingle && isHtmlBlock && projected && element && (
                  <>
                    {/* Row 1: color + (no opacity for html border) */}
                    <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                      <div className="flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:ring-1 focus-within:ring-primary/40 min-w-0">
                        <ColorPicker
                          value={strokeColor || '#000000'}
                          onChange={c => applyChange({ borderColor: c })}
                        />
                        <HexTextInput
                          value={strokeHex}
                          onCommit={handleHexCommit}
                          className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
                        />
                      </div>
                      <div />
                      <div />
                    </div>
                    {/* Row 2: Weight + Settings (HTML border has no Position) */}
                    <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                      <LabeledNumberInput label="W" value={projected.borderWidth ?? 0} min={0} step={0.5}
                        onChange={v => applyChange({ borderWidth: v })} />
                      <div />
                      <StrokeSettingsPopover
                        isSvg={false}
                        isHtmlBlock
                        projected={projected}
                        applyChange={applyChange}
                        element={element}
                        onUpdateElement={onUpdateElement}
                      />
                    </div>
                  </>
                )}
                {isMulti && support.stroke && (
                  <>
                    <ColorRow label="Color"
                      value={aggregated.svgStroke === 'mixed' ? '' : (aggregated.svgStroke || '')}
                      onChange={v => applyToAll({ svgStroke: v })}
                      allowNone onClear={() => applyToAll({ svgStroke: 'none' })} />
                    <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
                      <LabeledNumberInput label="W"
                        value={aggregated.svgStrokeWidth === 'mixed' ? null : (aggregated.svgStrokeWidth ?? null)} min={0} step={0.5}
                        onChange={v => applyToAll({ svgStrokeWidth: v })} placeholder="Mixed" />
                      <div />
                      <div />
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        );
      })()}

      {/* §9 Shadow (single + multi) */}
      {((isSingle && element && projected) || (isMulti && support.shadow)) && (
        <>
          <SectionHeader trailing={isSingle && element && projected ? (
            <ShadowModeSelect element={element} projected={projected} onUpdateElement={onUpdateElement} />
          ) : undefined}>Shadow</SectionHeader>
          <div className="px-3 pb-3">
            {isSingle && element && projected && (
              <ShadowSection element={element} projected={projected} onUpdateElement={onUpdateElement} />
            )}
            {isMulti && support.shadow && (
              <span className="text-[10px] text-muted-foreground italic">Shadow: {aggregated.boxShadow === 'mixed' ? 'Mixed' : (aggregated.boxShadow ? 'Active' : 'None')}</span>
            )}
          </div>
        </>
      )}

      {/* §10 HTML Code (single, non-group) */}
      {isSingle && !isGroup && (
        <>
          <SectionHeader collapsed={!showCode} onToggle={() => setShowCode(v => !v)}>HTML Code</SectionHeader>
          {showCode && element && (
            <div className="px-3 pb-3">
              <textarea
                value={element.html}
                onChange={e => onUpdateElement(element.id, { html: e.target.value })}
                className="w-full h-40 text-[10px] px-2 py-1.5 rounded bg-[#F5F5F5] border-0 focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono resize-y"
                spellCheck={false}
              />
            </div>
          )}
        </>
      )}

      {/* §11 Export */}
      {onExportPng && (
        <>
          <SectionHeader>Export</SectionHeader>
          <div className="px-3 pb-3 flex gap-2">
            <button
              onClick={onExportPng}
              className="flex-1 flex items-center justify-center gap-1.5 h-7 text-[10px] font-medium rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] text-foreground transition-colors"
            >
              <Download className="h-3 w-3" />
              PNG
            </button>
            {canExportSvg && onExportSvg && (
              <button
                onClick={onExportSvg}
                className="flex-1 flex items-center justify-center gap-1.5 h-7 text-[10px] font-medium rounded bg-[#F5F5F5] hover:bg-[#EBEBEB] text-foreground transition-colors"
              >
                <Download className="h-3 w-3" />
                SVG
              </button>
            )}
          </div>
        </>
      )}

      </div>{/* /flex-1 overflow-y-auto */}
    </div>
  );
}
