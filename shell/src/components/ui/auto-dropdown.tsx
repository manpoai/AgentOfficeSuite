'use client';

import { useRef, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * AutoDropdown — a self-positioning dropdown menu that stays within viewport.
 * Replaces hand-written `absolute top-full` patterns.
 *
 * Usage:
 *   <AutoDropdown open={isOpen} onClose={() => setOpen(false)} anchorRef={btnRef} align="right" className="w-40">
 *     <DropdownItem ... />
 *   </AutoDropdown>
 */
interface AutoDropdownProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
  width?: number;
}

export function AutoDropdown({ open, onClose, anchorRef, children, className, align = 'left', width }: AutoDropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!open || !anchorRef.current) return;

    const calculate = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menu = menuRef.current;
      const menuW = width ?? menu?.offsetWidth ?? 160;
      const menuH = menu?.offsetHeight ?? 200;
      const pad = 8;
      const gap = 4;
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      // Vertical
      const spaceBelow = vh - rect.bottom - gap - pad;
      const spaceAbove = rect.top - gap - pad;
      let top: number;
      let maxHeight: number;

      if (menuH <= spaceBelow) {
        top = rect.bottom + gap;
        maxHeight = spaceBelow;
      } else if (menuH <= spaceAbove) {
        top = rect.top - gap - menuH;
        maxHeight = spaceAbove;
      } else if (spaceBelow >= spaceAbove) {
        top = rect.bottom + gap;
        maxHeight = spaceBelow;
      } else {
        top = pad;
        maxHeight = spaceAbove;
      }

      // Horizontal
      let left: number;
      if (align === 'right') {
        left = rect.right - menuW;
      } else {
        left = rect.left;
      }
      if (left + menuW > vw - pad) left = vw - menuW - pad;
      if (left < pad) left = pad;

      setStyle({ top, left, maxHeight, position: 'fixed', zIndex: 50 });
    };

    // Calculate immediately and once more after menu renders
    calculate();
    requestAnimationFrame(calculate);
  }, [open, anchorRef, align, width]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        ref={menuRef}
        className={cn('bg-card border border-border rounded-lg shadow-xl py-1 overflow-y-auto', className)}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}
