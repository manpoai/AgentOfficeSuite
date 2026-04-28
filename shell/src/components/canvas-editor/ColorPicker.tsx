'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Pipette } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  allowNone?: boolean;
  onClear?: () => void;
}

/**
 * Swatch button + custom popover color picker.
 * - Pops next to the swatch (clamps to viewport edges).
 * - Uses react-colorful for HSV / Hue interaction; updates flow through
 *   onChange on every drag tick so the canvas + panel reflect immediately.
 * - HEX input without leading '#'.
 * - Eyedropper button (EyeDropper API; falls back to nothing on browsers
 *   without support — Safari < 17, etc.).
 * - Visual style mirrors StrokeSettingsPopover (rounded-md, bg-card, shadow).
 */
export function ColorPicker({ value, onChange, allowNone, onClear }: ColorPickerProps) {
  const isNone = !value || value === 'none' || value === 'transparent';
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Compute popover position when opened.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popW = 232;
    const popH = 280;
    const margin = 8;
    let left = rect.left;
    let top = rect.bottom + margin;
    // Clamp to viewport
    if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
    if (left < margin) left = margin;
    if (top + popH > window.innerHeight - margin) {
      // Flip above
      top = rect.top - popH - margin;
      if (top < margin) top = margin;
    }
    setPos({ left, top });
  }, [open]);

  // Close on outside click / Esc
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
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The HexColorPicker expects a hex with '#'. If the current value is rgba()
  // or already hex we map both ways. We just keep '#xxxxxx' as the picker
  // value and let the parent decide what string format to write back.
  const pickerValue = (() => {
    if (!value) return '#000000';
    if (value.startsWith('#')) return value.slice(0, 7);
    const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
    return '#000000';
  })();

  const hexNoHash = pickerValue.slice(1).toUpperCase();
  const [hexDraft, setHexDraft] = useState(hexNoHash);
  useEffect(() => { setHexDraft(hexNoHash); }, [hexNoHash]);

  const commitHex = (raw: string) => {
    const cleaned = raw.trim().replace(/^#+/, '').toUpperCase();
    if (!/^[0-9A-F]{3}([0-9A-F]{3})?$/.test(cleaned)) {
      // Reset draft to current
      setHexDraft(hexNoHash);
      return;
    }
    // Expand 3-digit shorthand to full 6-digit so what users see post-commit
    // matches what's written.
    const expanded = cleaned.length === 3 ? cleaned.split('').map(c => c + c).join('') : cleaned;
    onChange('#' + expanded);
  };

  const useEyeDropper = useCallback(async () => {
    const Ctor = (window as any).EyeDropper;
    if (!Ctor) return;
    try {
      const dropper = new Ctor();
      const result = await dropper.open();
      if (result?.sRGBHex) onChange(result.sRGBHex);
    } catch {
      // user cancelled
    }
  }, [onChange]);

  const supportsEyeDropper = typeof window !== 'undefined' && (window as any).EyeDropper;

  return (
    <>
      <button
        ref={btnRef}
        className="w-4 h-4 rounded shrink-0 relative overflow-hidden"
        style={isNone ? undefined : { backgroundColor: value }}
        onClick={() => setOpen(v => !v)}
        title={isNone ? 'No color' : value}
        type="button"
      >
        {isNone && (
          <Ban className="w-3 h-3 text-muted-foreground/40 absolute inset-0 m-auto" />
        )}
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ left: pos.left, top: pos.top }}
          className="fixed z-[10000] w-[232px] rounded-md border border-border bg-card shadow-lg p-3 space-y-2"
        >
          <HexColorPicker
            color={pickerValue}
            onChange={onChange}
            style={{ width: '100%', height: 160 }}
          />
          <div className="flex items-center gap-2">
            {supportsEyeDropper && (
              <button
                onClick={useEyeDropper}
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                title="Pick color from screen"
                type="button"
              >
                <Pipette className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="flex items-center gap-1.5 h-6 px-2 rounded bg-[#F5F5F5] flex-1 min-w-0">
              <input
                type="text"
                value={hexDraft}
                onChange={e => setHexDraft(e.target.value)}
                onBlur={e => commitHex(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  else if (e.key === 'Escape') { setHexDraft(hexNoHash); (e.target as HTMLInputElement).blur(); }
                }}
                className="flex-1 min-w-0 bg-transparent border-0 text-[10px] text-foreground font-mono tabular-nums uppercase tracking-wide focus:outline-none"
                spellCheck={false}
              />
            </div>
            {allowNone && onClear && (
              <button
                onClick={() => { onClear(); setOpen(false); }}
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent/50"
                title="Remove color"
                type="button"
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
