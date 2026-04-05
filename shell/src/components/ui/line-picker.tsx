'use client';

import { useState, useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LinePickerProps {
  style: 'solid' | 'dashed' | 'dotted';
  width?: number;
  onStyleChange: (style: 'solid' | 'dashed' | 'dotted') => void;
  onWidthChange?: (width: number) => void;
  className?: string;
}

const LINE_STYLES: { value: 'solid' | 'dashed' | 'dotted'; label: string; dashArray: string }[] = [
  { value: 'solid', label: 'Solid', dashArray: '' },
  { value: 'dashed', label: 'Dashed', dashArray: '8 4' },
  { value: 'dotted', label: 'Dotted', dashArray: '2 4' },
];

const LINE_WIDTHS = [1, 2, 3, 4, 6];

export function LinePicker({
  style,
  width,
  onStyleChange,
  onWidthChange,
  className,
}: LinePickerProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  // Position dropdown
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current && !containerRef.current.contains(e.target as HTMLElement) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const currentDash = LINE_STYLES.find(s => s.value === style) || LINE_STYLES[0];

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        className="h-7 px-1.5 flex items-center gap-1.5 rounded hover:bg-muted"
        onClick={() => setOpen(!open)}
        title={t('toolbar.lineStyle')}
      >
        {/* Preview of current line style */}
        <svg width={20} height={10} className="shrink-0">
          <line
            x1={0} y1={5} x2={20} y2={5}
            stroke="currentColor"
            strokeWidth={Math.min(width || 2, 3)}
            strokeDasharray={currentDash.dashArray}
            className="text-foreground"
          />
        </svg>
        <ChevronDown size={10} className="text-muted-foreground" />
      </button>

      {open && dropdownPos && (
        <div
          ref={dropdownRef}
          className="fixed bg-card rounded-lg shadow-lg border border-border py-1 z-50"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: 140 }}
        >
          {/* Style options */}
          <div className="px-1 pb-1">
            <div className="text-[10px] text-muted-foreground px-2 py-0.5">Style</div>
            {LINE_STYLES.map((ls) => (
              <button
                key={ls.value}
                className={cn(
                  'w-full px-2 py-1.5 flex items-center gap-2 rounded hover:bg-muted',
                  style === ls.value && 'bg-sidebar-accent text-sidebar-primary',
                )}
                onClick={() => { onStyleChange(ls.value); if (!onWidthChange) setOpen(false); }}
              >
                <svg width={40} height={8}>
                  <line
                    x1={0} y1={4} x2={40} y2={4}
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeDasharray={ls.dashArray}
                  />
                </svg>
                <span className="text-xs">{ls.label}</span>
              </button>
            ))}
          </div>

          {/* Width options */}
          {onWidthChange && (
            <div className="px-1 pt-1 border-t border-border">
              <div className="text-[10px] text-muted-foreground px-2 py-0.5">Width</div>
              {LINE_WIDTHS.map((w) => (
                <button
                  key={w}
                  className={cn(
                    'w-full px-2 py-1.5 flex items-center gap-2 rounded hover:bg-muted',
                    width === w && 'bg-sidebar-accent text-sidebar-primary',
                  )}
                  onClick={() => { onWidthChange(w); setOpen(false); }}
                >
                  <div className="flex-1 bg-foreground rounded" style={{ height: Math.max(1, w) }} />
                  <span className="text-xs text-muted-foreground">{w}px</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
