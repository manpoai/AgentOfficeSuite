'use client';

import { useEffect, useRef, type RefObject } from 'react';

export interface UsePinchZoomOptions {
  /** Called when a two-finger pinch gesture changes zoom level */
  onZoom: (scale: number, center: { x: number; y: number }) => void;
  /** Called when a single finger drags on empty area (pan gesture) */
  onPan?: (dx: number, dy: number) => void;
  /** Minimum allowed scale (default 0.2) */
  minScale?: number;
  /** Maximum allowed scale (default 3) */
  maxScale?: number;
  /** Current scale — used to clamp zoom callbacks */
  getCurrentScale?: () => number;
}

/**
 * Hook that attaches touch event listeners for pinch-to-zoom and single-finger pan
 * on canvas-based editors. Designed for both Fabric.js and X6 graph containers.
 *
 * Two fingers: calculates pinch distance delta and calls onZoom with the new scale
 * relative to the current scale.
 *
 * One finger (when onPan provided): calls onPan with dx/dy deltas.
 */
export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  options: UsePinchZoomOptions,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let initialDistance = 0;
    let initialScale = 1;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let isPinching = false;

    function getTouchDistance(t1: Touch, t2: Touch): number {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(t1: Touch, t2: Touch): { x: number; y: number } {
      return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        // Start pinch
        isPinching = true;
        initialDistance = getTouchDistance(e.touches[0], e.touches[1]);
        initialScale = optionsRef.current.getCurrentScale?.() ?? 1;
        e.preventDefault();
      } else if (e.touches.length === 1 && optionsRef.current.onPan) {
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
      }
    }

    function onTouchMove(e: TouchEvent) {
      const opts = optionsRef.current;

      if (e.touches.length === 2 && isPinching) {
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
        const center = getTouchCenter(e.touches[0], e.touches[1]);
        const ratio = currentDistance / initialDistance;
        const minScale = opts.minScale ?? 0.2;
        const maxScale = opts.maxScale ?? 3;
        const newScale = Math.min(maxScale, Math.max(minScale, initialScale * ratio));

        opts.onZoom(newScale, center);
      } else if (e.touches.length === 1 && !isPinching && opts.onPan) {
        const touch = e.touches[0];
        const dx = touch.clientX - lastTouchX;
        const dy = touch.clientY - lastTouchY;
        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;
        opts.onPan(dx, dy);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        isPinching = false;
      }
      if (e.touches.length === 1) {
        // Reset for potential single-finger pan continuation
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [ref]);
}
