'use client';

import { useRef, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  suffix?: string;
  className?: string;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
  className,
}: NumberInputProps) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const clamp = useCallback((v: number) => {
    let result = v;
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return result;
  }, [min, max]);

  const decrement = () => onChange(clamp(value - step));
  const increment = () => onChange(clamp(value + step));

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    if (!isNaN(parsed)) {
      onChange(clamp(parsed));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); increment(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); decrement(); }
  };

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {label && (
        <span className="text-xs text-muted-foreground mr-1 shrink-0">{label}</span>
      )}
      <button
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
        onClick={decrement}
        title={t('toolbar.decrease')}
      >
        <Minus size={12} />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={step < 1 ? value.toFixed(1) : value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className="w-10 h-6 text-center text-xs bg-transparent border border-border rounded outline-none focus:border-primary"
      />
      {suffix && (
        <span className="text-xs text-muted-foreground -ml-0.5">{suffix}</span>
      )}
      <button
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
        onClick={increment}
        title={t('toolbar.increase')}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
