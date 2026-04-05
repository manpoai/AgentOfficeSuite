'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ToolbarButton } from './ToolbarButton';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n';

interface ToolbarColorPickerProps {
  icon: ReactNode;
  label: string;
  colors: { name: string; value: string }[];
  active?: boolean;
  currentColor?: string;
  clearable?: boolean;
  onSelect: (color: string | undefined) => void;
}

export function ToolbarColorPicker({
  icon,
  label,
  colors,
  active,
  currentColor,
  clearable,
  onSelect,
}: ToolbarColorPickerProps) {
  const { t } = useT();
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

  return (
    <div className="relative" ref={ref}>
      <ToolbarButton active={active} onClick={() => setOpen((v) => !v)} title={label}>
        {icon}
      </ToolbarButton>
      {open && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-20 p-1.5 bg-popover border border-border rounded-lg shadow-xl flex gap-1 flex-wrap"
          style={{ minWidth: colors.length > 6 ? 180 : undefined }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {colors.map((c) => (
            <button
              key={c.value}
              onClick={() => { onSelect(c.value); setOpen(false); }}
              title={c.name}
              className={cn(
                'w-[22px] h-[22px] rounded border cursor-pointer p-0',
                currentColor === c.value ? 'border-foreground' : 'border-border hover:border-muted-foreground',
              )}
              style={{ background: c.value }}
            />
          ))}
          {clearable && (
            <button
              onClick={() => { onSelect(undefined); setOpen(false); }}
              title={t('toolbar.removeColor')}
              className="w-[22px] h-[22px] rounded border border-border hover:border-muted-foreground cursor-pointer p-0 text-[11px] text-muted-foreground"
            >
              &times;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
