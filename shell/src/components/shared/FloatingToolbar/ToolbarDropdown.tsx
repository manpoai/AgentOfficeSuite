'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface DropdownOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface ToolbarDropdownProps {
  icon?: ReactNode;
  label: string;
  options: DropdownOption[];
  value?: string;
  onSelect: (value: string) => void;
  /** Show current value as text instead of icon */
  showValue?: boolean;
  /** Min width for the dropdown button */
  minWidth?: number;
}

export function ToolbarDropdown({
  icon,
  label,
  options,
  value,
  onSelect,
  showValue,
  minWidth,
}: ToolbarDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler, true), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler, true); };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        title={label}
        className={cn(
          'h-[26px] flex items-center gap-0.5 px-1.5 rounded transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-accent text-xs',
        )}
        style={minWidth ? { minWidth } : undefined}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {showValue && <span className="truncate">{current?.label || value || label}</span>}
        <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-50" />
      </button>
      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 z-20 py-1 bg-popover border border-border rounded-lg shadow-xl min-w-[120px] max-h-[240px] overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onSelect(opt.value); setOpen(false); }}
              className={cn(
                'w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-accent transition-colors',
                opt.value === value && 'bg-accent/50 font-medium',
              )}
            >
              {opt.icon && <span className="flex-shrink-0">{opt.icon}</span>}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
