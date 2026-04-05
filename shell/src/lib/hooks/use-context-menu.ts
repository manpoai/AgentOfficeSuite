import { useCallback, useRef } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  shortcut?: string;
}

/**
 * Hook that returns onContextMenu and onLongPress handlers for triggering
 * the global ContextMenuProvider.
 *
 * @param getItems - function returning menu items (called lazily on trigger)
 */
export function useContextMenu(getItems: () => ContextMenuItem[]) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const show = useCallback((x: number, y: number) => {
    const items = getItems();
    if (items.length === 0) return;
    window.dispatchEvent(
      new CustomEvent('show-context-menu', {
        detail: { items, x, y },
      })
    );
  }, [getItems]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      show(e.clientX, e.clientY);
    },
    [show]
  );

  const onLongPress = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };

      longPressTimer.current = setTimeout(() => {
        if (touchStartPos.current) {
          show(touchStartPos.current.x, touchStartPos.current.y);
        }
      }, 500);
    },
    [show]
  );

  const onTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    // Cancel long press if finger moves too far
    if (touchStartPos.current && longPressTimer.current) {
      const touch = e.touches[0];
      if (touch) {
        const dx = touch.clientX - touchStartPos.current.x;
        const dy = touch.clientY - touchStartPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }
    }
  }, []);

  return { onContextMenu, onTouchStart: onLongPress, onTouchEnd, onTouchMove };
}
