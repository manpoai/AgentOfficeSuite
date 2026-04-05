'use client';

/**
 * BottomSheet — Mobile bottom sheet with drag-to-dismiss.
 *
 * A generic bottom panel that slides up from the bottom of the screen.
 * Supports drag gesture to dismiss, multi-height snapping (half/full),
 * and backdrop click to close.
 *
 * Used for: comments, properties, filters, context menus on mobile.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BottomSheetProps {
  /** Whether the sheet is open */
  open: boolean;
  /** Called to close the sheet */
  onClose: () => void;
  /** Sheet title */
  title?: string;
  /** Initial height: 'half' or 'full' */
  initialHeight?: 'half' | 'full';
  /** Whether to show the drag handle */
  showHandle?: boolean;
  /** Additional CSS class for the sheet content */
  className?: string;
  /** Sheet contents */
  children: React.ReactNode;
}

export function BottomSheet({
  open,
  onClose,
  title,
  initialHeight = 'half',
  showHandle = true,
  className,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const currentTranslateY = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  // Prevent body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const rect = sheet.getBoundingClientRect();
    const touchY = e.touches[0].clientY;
    if (touchY - rect.top > 40) return;

    dragStartY.current = e.touches[0].clientY;
    currentTranslateY.current = 0;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return;
      const deltaY = e.touches[0].clientY - dragStartY.current;
      if (deltaY < 0) return;
      currentTranslateY.current = deltaY;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${deltaY}px)`;
      }
    },
    [isDragging],
  );

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    if (currentTranslateY.current > 100) {
      onClose();
    }
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    currentTranslateY.current = 0;
  }, [isDragging, onClose]);

  // Simple approach: mount/unmount immediately, no exit animation.
  // The open flicker was caused by transition delays; the close flicker by exit animation.
  // Clean instant mount/unmount is better UX than a buggy animation.
  if (!open) return null;

  const heightClass =
    initialHeight === 'full'
      ? 'max-h-[90vh]'
      : 'max-h-[50vh]';

  return createPortal(
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop — no animation, instant */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Sheet — instant mount, no animation (avoids flicker) */}
      <div
        ref={sheetRef}
        className={cn(
          'absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl shadow-2xl',
          heightClass,
          'flex flex-col',
        )}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Handle */}
        {showHandle && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
        )}

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 py-2">
            <span className="text-base font-semibold text-foreground">
              {title}
            </span>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className={cn('flex-1 overflow-y-auto', className)}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
