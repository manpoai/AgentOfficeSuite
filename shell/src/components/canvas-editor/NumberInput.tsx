'use client';

import { useRef, useCallback } from 'react';
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
}

export function NumberInput({
  value, onChange, min, max, step = 1, suffix, placeholder, className,
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clamp = useCallback((v: number) => {
    let r = v;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return r;
  }, [min, max]);

  const displayValue = value == null ? '' : String(value);

  return (
    <div className={cn('flex items-center', className)}>
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        onChange={e => {
          const parsed = parseFloat(e.target.value);
          if (!isNaN(parsed)) onChange(clamp(parsed));
        }}
        onKeyDown={e => {
          if (value == null) return;
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(clamp(value + step)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(value - step)); }
        }}
        className="w-full text-[11px] px-1.5 py-1 rounded border bg-background font-mono tabular-nums"
      />
      {suffix && <span className="text-[10px] text-muted-foreground ml-0.5 shrink-0">{suffix}</span>}
    </div>
  );
}
