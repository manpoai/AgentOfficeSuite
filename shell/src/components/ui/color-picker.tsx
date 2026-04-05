'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_COLORS = [
  '#ffffff', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827',
  '#fef2f2', '#fee2e2', '#fecaca', '#f87171', '#ef4444', '#dc2626', '#b91c1c',
  '#fffbeb', '#fef3c7', '#fde68a', '#fbbf24', '#f59e0b', '#d97706', '#b45309',
  '#f0fdf4', '#dcfce7', '#bbf7d0', '#4ade80', '#22c55e', '#16a34a', '#15803d',
  '#eff6ff', '#dbeafe', '#bfdbfe', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8',
  '#f5f3ff', '#ede9fe', '#ddd6fe', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9',
  '#fdf2f8', '#fce7f3', '#fbcfe8', '#f472b6', '#ec4899', '#db2777', '#be185d',
];

export interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  allowTransparent?: boolean;
  presetColors?: string[];
  className?: string;
}

export function ColorPicker({
  color,
  onChange,
  label,
  allowTransparent = false,
  presetColors,
  className,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  const colors = presetColors || DEFAULT_COLORS;

  // Position dropdown using fixed positioning (portal-like)
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

  const isTransparent = color === 'transparent';

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        className="h-7 px-1.5 flex items-center gap-1.5 rounded hover:bg-muted text-sm"
        onClick={() => setOpen(!open)}
        title={label || 'Color'}
      >
        <div
          className="w-4 h-4 rounded border border-border shrink-0"
          style={{
            backgroundColor: isTransparent ? '#fff' : color,
            backgroundImage: isTransparent
              ? 'linear-gradient(45deg, #f87171 50%, transparent 50%), linear-gradient(-45deg, #f87171 50%, transparent 50%)'
              : 'none',
            backgroundSize: isTransparent ? '100% 2px, 100% 2px' : 'auto',
          }}
        />
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
        <ChevronDown size={10} className="text-muted-foreground" />
      </button>

      {open && dropdownPos && (
        <div
          ref={dropdownRef}
          className="fixed bg-card rounded-lg shadow-lg border border-border p-2 z-50"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: 232 }}
        >
          {/* Transparent option */}
          {allowTransparent && (
            <button
              className={cn(
                'w-full mb-1.5 px-2 py-1 text-xs text-left rounded flex items-center gap-2 hover:bg-muted',
                isTransparent && 'bg-sidebar-accent text-sidebar-primary',
              )}
              onClick={() => { onChange('transparent'); setOpen(false); }}
            >
              <span className="text-red-500">&#8709;</span>
              <span>No color</span>
            </button>
          )}

          {/* Color grid */}
          <div className="grid grid-cols-10 gap-0.5">
            {colors.filter(c => c !== 'transparent').map((c) => (
              <button
                key={c}
                className={cn(
                  'w-5 h-5 rounded border transition-transform hover:scale-110',
                  color === c && 'ring-2 ring-sidebar-primary',
                )}
                style={{ backgroundColor: c, borderColor: c === '#ffffff' ? '#d1d5db' : 'transparent' }}
                onClick={() => { onChange(c); setOpen(false); }}
                title={c}
              />
            ))}
          </div>

          {/* Custom color input */}
          <div className="mt-2 pt-2 border-t border-border flex items-center gap-2">
            <input
              type="color"
              value={isTransparent ? '#ffffff' : color}
              onChange={(e) => { onChange(e.target.value); }}
              className="w-6 h-6 rounded border border-border cursor-pointer bg-transparent"
            />
            <span className="text-xs text-muted-foreground flex-1">
              {isTransparent ? 'transparent' : color}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
