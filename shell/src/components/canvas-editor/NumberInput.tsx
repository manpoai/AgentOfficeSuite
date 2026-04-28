'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface NumberInputProps {
  value: number | null | undefined;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
  className?: string;
  /** Override the inner <input>'s className. Defaults to bordered light input. */
  inputClassName?: string;
}

/**
 * Number input with a LOCAL DRAFT.
 *
 * Why: a fully-controlled `value={displayValue}` means every keystroke fires
 * onChange → parent state update → re-render → input snaps back to the
 * clamped value. With a min like 20, typing "85" momentarily becomes "8" → 20
 * → user can't type past it. Backspacing from 200 hits 20 and gets stuck.
 *
 * Fix: keep a local string draft while focused, only commit (clamped numeric
 * onChange) on blur / Enter / Arrow keys. Sync draft from prop when prop
 * actually changes (e.g. drag-resize updating w/h on the canvas).
 */
export function NumberInput({
  value, onChange, min, max, step = 1, suffix, placeholder, className, inputClassName,
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clamp = useCallback((v: number) => {
    let r = v;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return r;
  }, [min, max]);

  const propStr = value == null ? '' : String(value);
  const [draft, setDraft] = useState(propStr);
  const lastPropRef = useRef(propStr);
  const focusedRef = useRef(false);

  // Sync from prop when prop actually changes AND user isn't currently typing.
  useEffect(() => {
    if (lastPropRef.current === propStr) return;
    lastPropRef.current = propStr;
    if (!focusedRef.current) setDraft(propStr);
  }, [propStr]);

  const commit = (raw: string) => {
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) {
      // Revert to current prop value
      setDraft(propStr);
      return;
    }
    const clamped = clamp(parsed);
    onChange(clamped);
    // After commit, reflect the clamped value back into draft so user sees
    // the actual stored number (e.g. typed "5" with min=20 → stays "20").
    setDraft(String(clamped));
  };

  return (
    <div className={cn('flex items-center', className)}>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder={placeholder}
        onFocus={() => { focusedRef.current = true; }}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => {
          focusedRef.current = false;
          commit(e.target.value);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(propStr);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const base = parseFloat(draft);
            const baseNum = isNaN(base) ? (value ?? 0) : base;
            const next = clamp(baseNum + step);
            setDraft(String(next));
            onChange(next);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const base = parseFloat(draft);
            const baseNum = isNaN(base) ? (value ?? 0) : base;
            const next = clamp(baseNum - step);
            setDraft(String(next));
            onChange(next);
          }
        }}
        className={inputClassName ?? "w-full text-[11px] px-1.5 py-1 rounded border bg-background font-mono tabular-nums"}
      />
      {suffix && <span className="text-[10px] text-muted-foreground ml-0.5 shrink-0">{suffix}</span>}
    </div>
  );
}
