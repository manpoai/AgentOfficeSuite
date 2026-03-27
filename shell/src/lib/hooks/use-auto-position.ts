import { useCallback, useEffect, useRef, type RefObject, type CSSProperties } from 'react';

/**
 * Calculate menu position that stays within viewport bounds.
 * Works for both React (via hook) and vanilla JS (via getAutoPosition).
 *
 * Strategy:
 * - Default: below anchor, left-aligned
 * - If overflows bottom → flip above
 * - If overflows right → align right edge to anchor's right
 * - If overflows left → clamp to left edge
 * - Dynamic max-height based on available space
 */

const PADDING = 8; // min gap from viewport edges
const GAP = 4; // gap between anchor and menu

export interface AutoPositionResult {
  top: number;
  left: number;
  maxHeight: number;
}

/**
 * Pure function: given anchor rect and menu dimensions, return clamped position.
 * Use this in vanilla JS contexts (editor plugins).
 */
export function getAutoPosition(
  anchorRect: DOMRect | { top: number; bottom: number; left: number; right: number; width: number; height: number },
  menuWidth: number,
  menuHeight: number,
  options?: { preferAbove?: boolean; align?: 'left' | 'right' }
): AutoPositionResult {
  const align = options?.align ?? 'left';
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Vertical: check space below vs above
  const spaceBelow = vh - anchorRect.bottom - GAP - PADDING;
  const spaceAbove = anchorRect.top - GAP - PADDING;
  const preferAbove = options?.preferAbove ?? false;

  let top: number;
  let maxHeight: number;

  const fitsBelow = menuHeight <= spaceBelow;
  const fitsAbove = menuHeight <= spaceAbove;

  if (preferAbove && fitsAbove) {
    top = anchorRect.top - GAP - Math.min(menuHeight, spaceAbove);
    maxHeight = spaceAbove;
  } else if (fitsBelow) {
    top = anchorRect.bottom + GAP;
    maxHeight = spaceBelow;
  } else if (fitsAbove) {
    top = anchorRect.top - GAP - Math.min(menuHeight, spaceAbove);
    maxHeight = spaceAbove;
  } else if (spaceBelow >= spaceAbove) {
    top = anchorRect.bottom + GAP;
    maxHeight = spaceBelow;
  } else {
    top = PADDING;
    maxHeight = spaceAbove;
  }

  // Horizontal
  let left: number;
  if (align === 'right') {
    left = anchorRect.right - menuWidth;
  } else {
    left = anchorRect.left;
  }
  // Clamp horizontal
  if (left + menuWidth > vw - PADDING) {
    left = vw - menuWidth - PADDING;
  }
  if (left < PADDING) {
    left = PADDING;
  }

  return { top, left, maxHeight };
}

/**
 * React hook: returns a style object for a fixed-positioned menu.
 * Call with anchor ref and menu ref. Recalculates on open.
 */
export function useAutoPositionStyle(
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  options?: { align?: 'left' | 'right'; width?: number }
): CSSProperties {
  const styleRef = useRef<CSSProperties>({});

  const calculate = useCallback(() => {
    if (!anchorRef.current) return {};
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const menuEl = menuRef.current;
    const menuWidth = options?.width ?? menuEl?.offsetWidth ?? 160;
    const menuHeight = menuEl?.offsetHeight ?? 200;

    const pos = getAutoPosition(anchorRect, menuWidth, menuHeight, { align: options?.align });
    return {
      position: 'fixed' as const,
      top: pos.top,
      left: pos.left,
      maxHeight: pos.maxHeight,
      zIndex: 50,
    };
  }, [anchorRef, menuRef, options?.align, options?.width]);

  useEffect(() => {
    if (isOpen) {
      styleRef.current = calculate();
      // Recalculate after render when menu dimensions are known
      requestAnimationFrame(() => {
        styleRef.current = calculate();
      });
    }
  }, [isOpen, calculate]);

  if (!isOpen) return {};
  return calculate();
}
