'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  X, Upload, ChevronDown, ChevronRight, Ban, Plus, Trash2,
  Copy, Trash, Group, Ungroup, Lock, Unlock,
  AlignStartHorizontal, AlignHorizontalJustifyCenter, AlignEndHorizontal,
  AlignStartVertical, AlignVerticalJustifyCenter, AlignEndVertical,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  ArrowUp, ArrowDown, ChevronsUp, ChevronsDown,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { pickFile } from '@/lib/utils/pick-file';
import * as gw from '@/lib/api/gateway';
import type { CanvasElement, CanvasPage, DesignToken } from './types';
import { projectElement, applyProjection, extractDesignTokens, updateDesignToken, applySvgDropShadow, applySvgMarker, applyStrokeLinecap, hasGradientFill } from './projection';
import type { ProjectedProps, SvgDropShadow, MarkerType } from './projection';
import { flattenToLeaves, computePropertyUnion, aggregateProps, applyToLeaves } from './property-model';
import type { AggregatedProps } from './property-model';
import { NumberInput } from './NumberInput';
import { ColorPicker } from './ColorPicker';
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

function SectionHeader({ children, collapsed, onToggle }: {
  children: React.ReactNode; collapsed?: boolean; onToggle?: () => void;
}) {
  return (
    <div className={cn('px-3 py-1.5 border-b border-border', onToggle && 'cursor-pointer hover:bg-accent/50')}
      onClick={onToggle}>
      <div className="flex items-center gap-1">
        {onToggle && (collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />)}
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{children}</span>
      </div>
    </div>
  );
}

// ── Small icon button ─────────────────────────────────────────────────────────

function IconBtn({ icon: Icon, onClick, title, active, danger }: {
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

function FillSection({ element, projected, onApply, onUpdateElement }: {
  element: CanvasElement;
  projected: ReturnType<typeof projectElement>;
  onApply: (changes: Partial<ProjectedProps>) => void;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
}) {
  const isSvg = projected.isSvgShape;
  const currentColor = isSvg ? (projected.svgFill || '') : (projected.backgroundColor || '');
  const isSvgHtml = element.html.includes('<svg');
  const patternMatch = element.html.match(/href="([^"]+)"/);
  const bgMatch = element.html.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
  const currentUrl = (isSvgHtml ? patternMatch?.[1] : bgMatch?.[1]) || '';

  let fillMode: FillMode = currentColor === 'none' ? 'none' : 'solid';
  if (currentUrl) fillMode = 'image';

  const isGradient = hasGradientFill(element.html);
  const fitMode = currentUrl ? getImageFitMode(element.html) : 'cover';

  const applyImageFill = async (url: string) => {
    let html = element.html;
    if (isSvgHtml) {
      html = html.replace(/<defs>[\s\S]*?<\/defs>/g, '');
      const pathEl = html.match(/<(path|rect|circle|ellipse|polygon)\s/);
      if (pathEl) {
        if (url) {
          const defsBlock = `<defs><pattern id="img-fill" patternUnits="objectBoundingBox" width="1" height="1"><image href="${url}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/></pattern></defs>`;
          html = html.replace(/<svg([^>]*)>/, `<svg$1>${defsBlock}`);
          html = html.replace(/fill="[^"]*"/, 'fill="url(#img-fill)"');
        } else {
          html = html.replace(/fill="url\(#img-fill\)"/, 'fill="#e0e7ff"');
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
        const resp = await fetch('/api/gateway/uploads', { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
        if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
        const respData = await resp.json();
        const rawUrl = respData.url as string;
        const serverUrl = rawUrl?.startsWith('http') ? rawUrl : `/api/gateway${rawUrl?.replace(/^\/api/, '')}`;
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

  return (
    <div className="space-y-2">
      {/* Mode selector */}
      <Row label="Fill">
        <div className="flex gap-1">
          {(['solid', 'image', 'none'] as FillMode[]).map(m => (
            <button key={m}
              className={cn('flex-1 text-[11px] px-1.5 py-0.5 rounded border transition-colors',
                fillMode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-muted-foreground')}
              onClick={() => {
                if (m === 'none') {
                  isSvg ? onApply({ svgFill: 'none' }) : onApply({ backgroundColor: 'none' });
                } else if (m === 'solid') {
                  isSvg ? onApply({ svgFill: '#e0e7ff' }) : onApply({ backgroundColor: '#ffffff' });
                } else {
                  handleUpload();
                }
              }}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </Row>

      {fillMode === 'solid' && !isGradient && (
        <ColorRow label="Color"
          value={currentColor}
          onChange={v => isSvg ? onApply({ svgFill: v }) : onApply({ backgroundColor: v })}
          allowNone onClear={() => isSvg ? onApply({ svgFill: 'none' }) : onApply({ backgroundColor: 'none' })}
        />
      )}
      {fillMode === 'solid' && isGradient && (
        <Row label="Color">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 rounded text-[11px] text-muted-foreground">
            <Lock className="w-3 h-3 shrink-0" />
            <span className="italic">Gradient (edit HTML)</span>
          </div>
        </Row>
      )}
      {fillMode === 'image' && (
        <>
          <Row label="Image">
            <div className="flex items-center gap-1 min-w-0">
              <div className="w-6 h-6 rounded border bg-cover bg-center shrink-0"
                style={{ backgroundImage: `url('${currentUrl}')` }} />
              <span className="flex-1 text-[11px] text-muted-foreground truncate">{currentUrl.split('/').pop()}</span>
              <button onClick={() => applyImageFill('')}
                className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground shrink-0" title="Remove image">
                <X className="h-3 w-3" />
              </button>
            </div>
          </Row>
          <Row label="Fit">
            <select value={fitMode}
              onChange={e => {
                const newHtml = applyImageFitMode(element.html, e.target.value as ImageFitMode);
                onUpdateElement(element.id, { html: newHtml });
              }}
              className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
              <option value="cover">Fill (crop)</option>
              <option value="contain">Fit (letterbox)</option>
              <option value="stretch">Stretch</option>
            </select>
          </Row>
        </>
      )}
    </div>
  );
}

// ── Shadow section ────────────────────────────────────────────────────────────

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
    return (
      <button onClick={() => {
        if (isSvg) {
          const newHtml = applySvgDropShadow(element.html, { dx: 0, dy: 4, stdDeviation: 4, color: '#000000', opacity: 0.25 });
          onUpdateElement(element.id, { html: newHtml });
        } else {
          applyHtmlShadow({ x: 0, y: 4, blur: 4, spread: 0, color: '#000000', opacity: 0.25 });
        }
      }}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <Plus className="h-3 w-3" /> Add shadow
      </button>
    );
  }

  const removeShadow = () => {
    if (isSvg) {
      onUpdateElement(element.id, { html: applySvgDropShadow(element.html, null) });
    } else {
      const div = document.createElement('div');
      div.innerHTML = element.html;
      const el = div.firstElementChild as HTMLElement | null;
      if (el) { el.style.boxShadow = ''; onUpdateElement(element.id, { html: div.innerHTML }); }
    }
  };

  if (isSvg && parsedShadow !== null) {
    const sv = parsedShadow!;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Drop shadow</span>
          <button onClick={removeShadow} className="p-0.5 text-muted-foreground/50 hover:text-destructive" title="Remove shadow">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground w-4">X</span>
            <NumberInput value={sv.dx} onChange={v => applySvgShadowChange({ ...sv, dx: v })} step={1} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground w-4">Y</span>
            <NumberInput value={sv.dy} onChange={v => applySvgShadowChange({ ...sv, dy: v })} step={1} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground w-4">B</span>
            <NumberInput value={sv.stdDeviation} onChange={v => applySvgShadowChange({ ...sv, stdDeviation: Math.max(0, v) })} min={0} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground w-4">O</span>
            <NumberInput value={Math.round(sv.opacity * 100)} onChange={v => applySvgShadowChange({ ...sv, opacity: Math.min(1, Math.max(0, v / 100)) })} min={0} max={100} suffix="%" />
          </div>
        </div>
        <ColorRow label="Color" value={sv.color} onChange={v => applySvgShadowChange({ ...sv, color: v })} />
      </div>
    );
  }

  const hv = parseBoxShadow(boxShadow ?? '0px 4px 4px #00000040');
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Drop shadow</span>
        <button onClick={removeShadow} className="p-0.5 text-muted-foreground/50 hover:text-destructive" title="Remove shadow">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-4">X</span>
          <NumberInput value={hv.x} onChange={v => applyHtmlShadow({ ...hv, x: v })} step={1} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-4">Y</span>
          <NumberInput value={hv.y} onChange={v => applyHtmlShadow({ ...hv, y: v })} step={1} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-4">Blur</span>
          <NumberInput value={hv.blur} onChange={v => applyHtmlShadow({ ...hv, blur: Math.max(0, v) })} min={0} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-4">Spread</span>
          <NumberInput value={hv.spread} onChange={v => applyHtmlShadow({ ...hv, spread: v })} />
        </div>
      </div>
      <ColorRow label="Color" value={hv.color} onChange={v => applyHtmlShadow({ ...hv, color: v })} />
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
      const resp = await fetch('/api/gateway/uploads', { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
      const respData = await resp.json();
      const url = respData.url?.startsWith('http') ? respData.url : `/api/gateway${respData.url?.replace(/^\/api/, '')}`;
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

  const panelClass = 'w-[280px] min-w-[280px] border-l border-border flex flex-col shrink-0 bg-card h-full shadow-lg';

  const [aspectLocked, setAspectLocked] = useState(false);
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
        <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
          {frame && onRenameFrame ? (
            <InlineEditHeader value={frame.title || 'Frame'} onSave={v => onRenameFrame(frame.page_id, v)} />
          ) : (
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Canvas</span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
        {frame && (
          <>
            {(onDuplicateFrame || onDeleteFrame) && (
              <div className="px-3 py-1.5 flex items-center gap-0.5 border-b border-border">
                {onDuplicateFrame && <ToolBtn icon={Copy} onClick={() => onDuplicateFrame(frame.page_id)} title="Duplicate Frame" />}
                {onDeleteFrame && <ToolBtn icon={Trash2} onClick={() => onDeleteFrame(frame.page_id)} title="Delete Frame" />}
              </div>
            )}
            <SectionHeader>Position & Size</SectionHeader>
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Row label="X"><NumberInput value={frame.frame_x ?? 0} onChange={v => onUpdateFrame(frame.page_id, { frame_x: v })} /></Row>
                <Row label="Y"><NumberInput value={frame.frame_y ?? 0} onChange={v => onUpdateFrame(frame.page_id, { frame_y: v })} /></Row>
                <Row label="W"><NumberInput value={frame.width} min={100} onChange={w => onUpdateFrame(frame.page_id, { width: w })} /></Row>
                <Row label="H"><NumberInput value={frame.height} min={100} onChange={h => onUpdateFrame(frame.page_id, { height: h })} /></Row>
              </div>
            </div>
            <SectionHeader>Appearance</SectionHeader>
            <div className="p-3 space-y-2">
              <ColorRow label="Bg Color" value={frame.background_color || '#ffffff'}
                onChange={v => onUpdateFrame(frame.page_id, { background_color: v })} />
              <Row label="Radius">
                <NumberInput value={frame.border_radius ?? 0} min={0} onChange={v => onUpdateFrame(frame.page_id, { border_radius: v })} />
              </Row>
              <ColorRow label="Border" value={frame.border_color || ''} allowNone
                onChange={v => onUpdateFrame(frame.page_id, { border_color: v })}
                onClear={() => onUpdateFrame(frame.page_id, { border_color: '' })} />
              <Row label="Border W">
                <NumberInput value={frame.border_width ?? 0} min={0} step={0.5}
                  onChange={v => onUpdateFrame(frame.page_id, { border_width: v })} />
              </Row>
              <Row label="Border Style">
                <select value={frame.border_style || 'solid'}
                  onChange={e => onUpdateFrame(frame.page_id, { border_style: e.target.value as 'solid' | 'dashed' | 'dotted' })}
                  className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </Row>
              <FrameShadowSection frame={frame} onUpdateFrame={onUpdateFrame} />
              <FrameImageInput frame={frame} onUpdateFrame={onUpdateFrame} />
            </div>
          </>
        )}
        {!frame && onUpdateCanvasBackground && (
          <>
            <SectionHeader>Appearance</SectionHeader>
            <div className="p-3 space-y-2">
              <ColorRow label="Background" value={canvasBackgroundColor || '#e8e8e8'}
                onChange={v => onUpdateCanvasBackground(v)} />
            </div>
          </>
        )}
        {designTokens.length > 0 && (
          <>
            <SectionHeader>Design Tokens</SectionHeader>
            <div className="p-3 space-y-2">
              {designTokens.map(token => (
                <ColorRow key={token.name} label={token.name.replace('--', '')}
                  value={token.value} onChange={v => onUpdateToken(token.name, v)} />
              ))}
            </div>
          </>
        )}
        {onExportPng && (
          <>
            <SectionHeader>Export</SectionHeader>
            <div className="p-3 flex gap-2">
              <button
                onClick={onExportPng}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded border bg-background hover:bg-accent/50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                PNG
              </button>
              {canExportSvg && onExportSvg && (
                <button
                  onClick={onExportSvg}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded border bg-background hover:bg-accent/50 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
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
              <div className="grid grid-cols-2 gap-2">
                <Row label="X"><NumberInput value={projected.subLeft ?? 0} onChange={v => applyChange({ subLeft: v })} /></Row>
                <Row label="Y"><NumberInput value={projected.subTop ?? 0} onChange={v => applyChange({ subTop: v })} /></Row>
                <Row label="W"><NumberInput value={projected.subWidth ?? 0} min={0} onChange={v => applyChange({ subWidth: v })} /></Row>
                <Row label="H"><NumberInput value={projected.subHeight ?? 0} min={0} onChange={v => applyChange({ subHeight: v })} /></Row>
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
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        {isSingle && element && onRenameElement ? (
          <InlineEditHeader value={element.name || (isGroup ? 'Group' : 'Element')} onSave={v => onRenameElement(element.id, v)} />
        ) : (
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{headerTitle}</span>
        )}
      </div>

      {/* Operations */}
      <div className="px-2 py-1.5 border-b border-border flex flex-wrap gap-0.5 shrink-0">
        {onDuplicate && <IconBtn icon={Copy} onClick={onDuplicate} title="Duplicate" />}
        {onDelete && <IconBtn icon={Trash} onClick={onDelete} title="Delete" danger />}
        {onLock && element && <IconBtn icon={element.locked ? Unlock : Lock} onClick={onLock} title={element.locked ? 'Unlock' : 'Lock'} />}
        {isMulti && onGroup && <IconBtn icon={Group} onClick={onGroup} title="Group (Cmd+G)" />}
        {isGroup && onUngroup && <IconBtn icon={Ungroup} onClick={onUngroup} title="Ungroup (Cmd+Shift+G)" />}
        {isMulti && onAlign && (
          <>
            <div className="w-px bg-border mx-0.5 self-stretch" />
            <IconBtn icon={AlignStartHorizontal} onClick={() => onAlign('left')} title="Align left" />
            <IconBtn icon={AlignHorizontalJustifyCenter} onClick={() => onAlign('center-h')} title="Center horizontal" />
            <IconBtn icon={AlignEndHorizontal} onClick={() => onAlign('right')} title="Align right" />
            <IconBtn icon={AlignStartVertical} onClick={() => onAlign('top')} title="Align top" />
            <IconBtn icon={AlignVerticalJustifyCenter} onClick={() => onAlign('center-v')} title="Center vertical" />
            <IconBtn icon={AlignEndVertical} onClick={() => onAlign('bottom')} title="Align bottom" />
            {selectedCount >= 3 && (
              <>
                <IconBtn icon={AlignHorizontalSpaceAround} onClick={() => onAlign('distribute-h')} title="Distribute horizontally" />
                <IconBtn icon={AlignVerticalSpaceAround} onClick={() => onAlign('distribute-v')} title="Distribute vertically" />
              </>
            )}
          </>
        )}
        {isMulti && allSvg && onBooleanOp && (
          <>
            <div className="w-px bg-border mx-0.5 self-stretch" />
            <IconBtn icon={Group} onClick={() => onBooleanOp('union')} title="Union" />
            <IconBtn icon={Ban} onClick={() => onBooleanOp('difference')} title="Subtract" />
            <IconBtn icon={Copy} onClick={() => onBooleanOp('intersection')} title="Intersect" />
            <IconBtn icon={X} onClick={() => onBooleanOp('exclusion')} title="Exclude" />
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Position & Size (for non-sub-element single selection) */}
      {isSingle && !subElementSelection && element && (
        <>
          <SectionHeader>Position & Size</SectionHeader>
          <div className="p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Row label="X"><NumberInput value={element.x} onChange={v => onUpdateElement(element.id, { x: v })} /></Row>
              <Row label="Y"><NumberInput value={element.y} onChange={v => onUpdateElement(element.id, { y: v })} /></Row>
              <Row label="W"><NumberInput value={element.w} min={20} onChange={v => {
                if (aspectLocked) {
                  onUpdateElement(element.id, { w: v, h: Math.round(v / aspectRatio.current) });
                } else {
                  onUpdateElement(element.id, { w: v });
                }
              }} /></Row>
              <Row label="H"><NumberInput value={element.h} min={20} onChange={v => {
                if (aspectLocked) {
                  onUpdateElement(element.id, { h: v, w: Math.round(v * aspectRatio.current) });
                } else {
                  onUpdateElement(element.id, { h: v });
                }
              }} /></Row>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={cn('p-0.5 rounded', aspectLocked ? 'text-primary' : 'text-muted-foreground')}
                onClick={() => {
                  if (!aspectLocked && element) aspectRatio.current = element.w / element.h;
                  setAspectLocked(!aspectLocked);
                }}
                title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              >
                {aspectLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
              <span className="text-[10px] text-muted-foreground">{aspectLocked ? 'Aspect locked' : 'Aspect unlocked'}</span>
            </div>
            <Row label="Z-Index">
              <div className="flex items-center gap-1">
                <NumberInput value={element.z_index ?? 0} onChange={v => onUpdateElement(element.id, { z_index: v })} />
                <button className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50" title="Send to back" onClick={() => onSendToBack?.(element.id)}><ChevronsDown className="w-3 h-3" /></button>
                <button className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50" title="Send backward" onClick={() => onSendBackward?.(element.id)}><ArrowDown className="w-3 h-3" /></button>
                <button className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50" title="Bring forward" onClick={() => onBringForward?.(element.id)}><ArrowUp className="w-3 h-3" /></button>
                <button className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50" title="Bring to front" onClick={() => onBringToFront?.(element.id)}><ChevronsUp className="w-3 h-3" /></button>
              </div>
            </Row>
            <Row label="Rotation"><NumberInput value={element.rotation ?? 0} step={1} suffix="°" onChange={v => onUpdateElement(element.id, { rotation: v })} /></Row>
          </div>
        </>
      )}

      {/* Multi-selection: position & size */}
      {isMulti && selectionBounds && (
        <>
          <SectionHeader>Position & Size</SectionHeader>
          <div className="p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Row label="X"><NumberInput value={selectionBounds.x} onChange={v => {
                const dx = v - selectionBounds.x;
                if (dx !== 0 && onMoveSelection) onMoveSelection(dx, 0);
              }} /></Row>
              <Row label="Y"><NumberInput value={selectionBounds.y} onChange={v => {
                const dy = v - selectionBounds.y;
                if (dy !== 0 && onMoveSelection) onMoveSelection(0, dy);
              }} /></Row>
              <Row label="W"><span className="text-[11px] text-muted-foreground">{Math.round(selectionBounds.w)}</span></Row>
              <Row label="H"><span className="text-[11px] text-muted-foreground">{Math.round(selectionBounds.h)}</span></Row>
            </div>
          </div>
        </>
      )}

      {/* Appearance */}
      {(isSingle || isMulti) && (
        <>
          <SectionHeader>Appearance</SectionHeader>
          <div className="p-3 space-y-2">

            {/* SVG: Fill */}
            {isSingle && projected?.isSvgShape && element && (
              <FillSection element={element} projected={projected} onApply={applyChange} onUpdateElement={onUpdateElement} />
            )}

            {/* Multi SVG: fill */}
            {isMulti && support.fill && (
              <ColorRow label="Fill"
                value={aggregated.svgFill === 'mixed' ? '' : (aggregated.svgFill || aggregated.backgroundColor || '')}
                onChange={v => {
                  const hasSvg = leaves.some(l => l.html.includes('<svg'));
                  const hasNonSvg = leaves.some(l => !l.html.includes('<svg'));
                  if (hasSvg) applyToAll({ svgFill: v });
                  if (hasNonSvg) applyToAll({ backgroundColor: v });
                }}
              />
            )}

            {/* Non-SVG single: fill */}
            {isSingle && projected && !projected.isSvgShape && element && (
              <FillSection element={element} projected={projected} onApply={applyChange} onUpdateElement={onUpdateElement} />
            )}

            {/* SVG single: stroke */}
            {isSingle && projected?.isSvgShape && (
              <>
                <ColorRow label="Stroke" value={projected.svgStroke || ''}
                  onChange={v => applyChange({ svgStroke: v })}
                  allowNone onClear={() => applyChange({ svgStroke: 'none' })} />
                <Row label="Stroke W">
                  <NumberInput value={projected.svgStrokeWidth ?? 2} min={0} step={0.5}
                    onChange={v => applyChange({ svgStrokeWidth: v })} />
                </Row>
                <Row label="Dash">
                  <select value={projected.svgStrokeDasharray || ''}
                    onChange={e => applyChange({ svgStrokeDasharray: e.target.value })}
                    className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
                    <option value="">Solid</option>
                    <option value="8 4">Dashed</option>
                    <option value="2 2">Dotted</option>
                    <option value="12 4 4 4">Dash-dot</option>
                  </select>
                </Row>
                <Row label="Align">
                  <select value={projected.svgStrokeAlignment || 'center'}
                    onChange={e => applyChange({ svgStrokeAlignment: e.target.value as 'center' | 'inside' | 'outside' })}
                    className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
                    <option value="center">Center</option>
                    <option value="inside">Inside</option>
                    <option value="outside">Outside</option>
                  </select>
                </Row>
              </>
            )}

            {/* HTML Block: CSS border (#9) */}
            {isSingle && isHtmlBlock && projected && (
              <>
                <ColorRow label="Border" value={projected.borderColor || ''}
                  onChange={v => applyChange({ borderColor: v })}
                  allowNone onClear={() => applyChange({ borderColor: 'none', borderWidth: 0 })} />
                <Row label="Border W">
                  <NumberInput value={projected.borderWidth ?? 0} min={0} step={0.5}
                    onChange={v => applyChange({ borderWidth: v })} />
                </Row>
                <Row label="Border S">
                  <select value={projected.borderStyle || 'solid'}
                    onChange={e => applyChange({ borderStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })}
                    className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                </Row>
              </>
            )}

            {/* Multi-select: stroke (#10) */}
            {isMulti && support.stroke && (
              <>
                <ColorRow label="Stroke"
                  value={aggregated.svgStroke === 'mixed' ? '' : (aggregated.svgStroke || '')}
                  onChange={v => applyToAll({ svgStroke: v })}
                  allowNone onClear={() => applyToAll({ svgStroke: 'none' })} />
                <Row label="Stroke W">
                  <NumberInput value={aggregated.svgStrokeWidth === 'mixed' ? null : (aggregated.svgStrokeWidth ?? null)} min={0} step={0.5}
                    onChange={v => applyToAll({ svgStrokeWidth: v })} placeholder="Mixed" />
                </Row>
              </>
            )}

            {/* SVG: corner radius */}
            {isSingle && projected?.isSvgShape && (
              <Row label="Radius">
                {projected.borderRadius === -1 ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-muted-foreground italic">mixed</span>
                    <input type="number" min={0} step={1} placeholder="set all"
                      className="flex-1 text-[11px] px-1.5 py-1 rounded border bg-background"
                      onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) applyChange({ borderRadius: v }); }} />
                  </div>
                ) : (
                  <NumberInput value={projected.borderRadius ?? 0} min={0} onChange={v => applyChange({ borderRadius: v })} />
                )}
              </Row>
            )}

            {/* Non-SVG: text color, font */}
            {isSingle && projected && !projected.isSvgShape && (
              <>
                <ColorRow label="Text" value={projected.color || ''}
                  onChange={v => applyChange({ color: v })} />
                {projected.fontSize !== undefined && (
                  <Row label="Font Size"><NumberInput value={projected.fontSize} min={1} onChange={v => applyChange({ fontSize: v })} /></Row>
                )}
                {projected.fontFamily !== undefined && (
                  <Row label="Font">
                    <select
                      value={projected.fontFamily ?? ''}
                      onChange={e => {
                        const family = e.target.value;
                        if (CANVAS_FONTS.google.includes(family)) loadGoogleFont(family);
                        applyChange({ fontFamily: family });
                      }}
                      className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
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
                  </Row>
                )}
                {projected.fontWeight !== undefined && (
                  <Row label="Weight">
                    <select value={projected.fontWeight || '400'}
                      onChange={e => applyChange({ fontWeight: e.target.value })}
                      className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
                      <option value="300">Light</option>
                      <option value="400">Regular</option>
                      <option value="500">Medium</option>
                      <option value="600">Semibold</option>
                      <option value="700">Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </Row>
                )}
                {projected.fontSize !== undefined && (
                  <>
                    <Row label="Align">
                      <div className="flex gap-0.5">
                        {(['left', 'center', 'right', 'justify'] as const).map(a => (
                          <button key={a}
                            className={cn('flex-1 text-[10px] px-1 py-0.5 rounded border transition-colors',
                              projected.textAlign === a
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'border-border hover:border-muted-foreground')}
                            onClick={() => applyChange({ textAlign: a })}>
                            {a.charAt(0).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </Row>
                    <Row label="V-Align">
                      <div className="flex gap-0.5">
                        {(['top', 'middle', 'bottom'] as const).map(a => (
                          <button key={a}
                            className={cn('flex-1 text-[10px] px-1 py-0.5 rounded border transition-colors',
                              (projected.verticalAlign ?? 'top') === a
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'border-border hover:border-muted-foreground')}
                            onClick={() => applyChange({ verticalAlign: a })}>
                            {a.charAt(0).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </Row>
                    <Row label="Line H">
                      <NumberInput value={projected.lineHeight ?? 1.4} min={0.5} max={10} step={0.1}
                        onChange={v => applyChange({ lineHeight: v })} />
                    </Row>
                    <Row label="Spacing">
                      <NumberInput value={projected.letterSpacing ?? 0} step={0.5}
                        onChange={v => applyChange({ letterSpacing: v })} suffix="px" />
                    </Row>
                    <Row label="Decoration">
                      <div className="flex gap-0.5">
                        {(['none', 'underline', 'line-through'] as const).map(d => (
                          <button key={d}
                            className={cn('flex-1 text-[10px] px-1 py-0.5 rounded border transition-colors',
                              (projected.textDecoration ?? 'none') === d
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'border-border hover:border-muted-foreground')}
                            onClick={() => applyChange({ textDecoration: d })}>
                            {d === 'none' ? 'N' : d === 'underline' ? 'U' : 'S'}
                          </button>
                        ))}
                      </div>
                    </Row>
                  </>
                )}
                {projected.borderRadius !== undefined && (
                  <Row label="Radius"><NumberInput value={projected.borderRadius} min={0} onChange={v => applyChange({ borderRadius: v })} /></Row>
                )}
              </>
            )}

            {/* Multi: common props */}
            {isMulti && (
              <>
                {support.font && (
                  <>
                    <ColorRow label="Text"
                      value={aggregated.color === 'mixed' ? '' : (aggregated.color || '')}
                      onChange={v => applyToAll({ color: v })} />
                    <Row label="Font Size">
                      <NumberInput value={aggregated.fontSize === 'mixed' ? null : (aggregated.fontSize ?? null)} min={1}
                        onChange={v => applyToAll({ fontSize: v })} placeholder="Mixed" />
                    </Row>
                  </>
                )}
                <Row label="Radius">
                  <NumberInput value={aggregated.borderRadius === 'mixed' ? null : (aggregated.borderRadius ?? null)} min={0}
                    onChange={v => applyToAll({ borderRadius: v })} placeholder="Mixed" />
                </Row>
              </>
            )}

            {/* Opacity — always shown */}
            <Row label="Opacity">
              <NumberInput
                value={isSingle ? (projected?.opacity ?? 1) : (aggregated.opacity === 'mixed' ? null : (aggregated.opacity ?? null))}
                min={0} max={1} step={0.1}
                onChange={v => {
                  const clamped = Math.min(1, Math.max(0, v));
                  isSingle ? applyChange({ opacity: clamped }) : applyToAll({ opacity: clamped });
                }}
                placeholder="Mixed"
              />
            </Row>
          </div>
        </>
      )}

      {/* Stroke Endpoints (SVG single) */}
      {isSingle && isSvg && projected && (
        <>
          <SectionHeader>Stroke Endpoints</SectionHeader>
          <div className="p-3 space-y-2">
            <Row label="Cap">
              <select value={projected.svgStrokeLinecap || 'butt'}
                onChange={e => {
                  const cap = e.target.value as 'butt' | 'round' | 'square';
                  onUpdateElement(element!.id, { html: applyStrokeLinecap(element!.html, cap) });
                }}
                className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
                <option value="butt">Butt</option>
                <option value="round">Round</option>
                <option value="square">Square</option>
              </select>
            </Row>
            <Row label="Start">
              <select value={projected.svgMarkerStart || 'none'}
                onChange={e => onUpdateElement(element!.id, { html: applySvgMarker(element!.html, 'start', e.target.value as MarkerType) })}
                className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
                <option value="none">None</option>
                <option value="arrow">Arrow</option>
                <option value="triangle">Triangle</option>
                <option value="triangle-reversed">Triangle Rev.</option>
                <option value="circle">Circle</option>
                <option value="diamond">Diamond</option>
              </select>
            </Row>
            <Row label="End">
              <select value={projected.svgMarkerEnd || 'none'}
                onChange={e => onUpdateElement(element!.id, { html: applySvgMarker(element!.html, 'end', e.target.value as MarkerType) })}
                className="w-full text-[11px] px-1.5 py-1 rounded border bg-background">
                <option value="none">None</option>
                <option value="arrow">Arrow</option>
                <option value="triangle">Triangle</option>
                <option value="triangle-reversed">Triangle Rev.</option>
                <option value="circle">Circle</option>
                <option value="diamond">Diamond</option>
              </select>
            </Row>
          </div>
        </>
      )}

      {/* Effects / Shadow */}
      {isSingle && element && projected && (
        <>
          <SectionHeader>Effects</SectionHeader>
          <div className="p-3">
            <ShadowSection element={element} projected={projected} onUpdateElement={onUpdateElement} />
          </div>
        </>
      )}

      {/* Multi-select: shadow (#11) */}
      {isMulti && support.shadow && (
        <>
          <SectionHeader>Effects</SectionHeader>
          <div className="p-3">
            <span className="text-[11px] text-muted-foreground italic">Shadow: {aggregated.boxShadow === 'mixed' ? 'Mixed' : (aggregated.boxShadow ? 'Active' : 'None')}</span>
          </div>
        </>
      )}

      {/* HTML Code */}
      {isSingle && !isGroup && (
        <>
          <SectionHeader collapsed={!showCode} onToggle={() => setShowCode(v => !v)}>HTML Code</SectionHeader>
          {showCode && element && (
            <div className="p-3">
              <textarea
                value={element.html}
                onChange={e => onUpdateElement(element.id, { html: e.target.value })}
                className="w-full h-40 text-[11px] px-2 py-1.5 rounded border bg-background font-mono resize-y"
                spellCheck={false}
              />
            </div>
          )}
        </>
      )}

      {/* Export */}
      {onExportPng && (
        <>
          <SectionHeader>Export</SectionHeader>
          <div className="p-3 flex gap-2">
            <button
              onClick={onExportPng}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded border bg-background hover:bg-accent/50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              PNG
            </button>
            {canExportSvg && onExportSvg && (
              <button
                onClick={onExportSvg}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded border bg-background hover:bg-accent/50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
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
