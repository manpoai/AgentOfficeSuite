'use client';

/**
 * SwipeBack — Swipe-right gesture to navigate back.
 *
 * Wraps content views on mobile. Detects a right-swipe gesture
 * from the left edge of the screen and calls onBack.
 *
 * Gesture: touch starts within 20px of left edge, swipe right > 80px.
 */

import React, { useRef, useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SwipeBackProps {
  /** Called when swipe-back gesture completes */
  onBack: () => void;
  /** Whether swipe-back is enabled */
  enabled?: boolean;
  /** Additional CSS class */
  className?: string;
  children: React.ReactNode;
}

const EDGE_THRESHOLD = 20; // pixels from left edge to start
const SWIPE_THRESHOLD = 80; // minimum swipe distance to trigger

export function SwipeBack({
  onBack,
  enabled = true,
  className,
  children,
}: SwipeBackProps) {
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  const [translateX, setTranslateX] = useState(0);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      // Only track if touch starts near left edge
      if (touch.clientX > EDGE_THRESHOLD) return;
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      tracking.current = true;
    },
    [enabled],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!tracking.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX.current;
      const dy = Math.abs(touch.clientY - startY.current);

      // Cancel if vertical scroll dominates
      if (dy > dx) {
        tracking.current = false;
        setTranslateX(0);
        return;
      }

      // Only allow rightward swipe
      if (dx > 0) {
        setTranslateX(dx);
      }
    },
    [],
  );

  const handleTouchEnd = useCallback(() => {
    if (!tracking.current) return;
    tracking.current = false;

    if (translateX > SWIPE_THRESHOLD) {
      onBack();
    }
    setTranslateX(0);
  }, [translateX, onBack]);

  const progress = Math.min(translateX / SWIPE_THRESHOLD, 1);

  return (
    <div
      className={cn('relative', className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Swipe-back edge indicator */}
      {translateX > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 z-50 pointer-events-none flex items-center"
          style={{ width: 32 }}
        >
          <div
            className="w-8 h-16 flex items-center justify-center rounded-r-lg bg-primary/20 backdrop-blur-sm transition-opacity"
            style={{ opacity: progress, transform: `translateX(${progress * 12 - 12}px)` }}
          >
            <ArrowLeft className="w-4 h-4 text-primary" style={{ opacity: progress }} />
          </div>
        </div>
      )}
      <div
        className="flex-1 flex flex-col min-w-0 min-h-0"
        style={{
          transform: translateX > 0 ? `translateX(${translateX}px)` : undefined,
          transition: tracking.current ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
