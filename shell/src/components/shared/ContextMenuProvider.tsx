'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { ContextMenuItem } from '@/lib/hooks/use-context-menu';
import { BottomSheet } from './BottomSheet';

interface ContextMenuState {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  visible: boolean;
}

const MENU_MIN_WIDTH = 172;
const VIEWPORT_PADDING = 8;

function isMobile() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 640px)').matches || 'ontouchstart' in window;
}

// ─── Desktop floating context menu ────────────────────────────────────

function FloatingMenu({
  items,
  position,
  onClose,
}: {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: position.y,
    left: position.x,
    zIndex: 9999,
    opacity: 0,
  });

  // Calculate position after first render to get actual menu dimensions
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const menuWidth = el.offsetWidth;
    const menuHeight = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let { x, y } = position;

    // Flip left if overflows right
    if (x + menuWidth > vw - VIEWPORT_PADDING) {
      x = Math.max(VIEWPORT_PADDING, x - menuWidth);
    }
    // Flip up if overflows bottom
    if (y + menuHeight > vh - VIEWPORT_PADDING) {
      y = Math.max(VIEWPORT_PADDING, y - menuHeight);
    }

    setStyle({
      position: 'fixed',
      top: y,
      left: x,
      zIndex: 9999,
      opacity: 1,
    });
  }, [position]);

  return (
    <>
      {/* Invisible backdrop to catch outside clicks */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={menuRef}
        className="fixed z-[9999] w-[172px] bg-popover border border-black/10 dark:border-white/10 rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] py-1 overflow-y-auto transition-opacity duration-75"
        style={style}
        role="menu"
      >
        {items.map((item) => (
          <div key={item.id}>
            {item.separator && <div className="border-t border-black/10 dark:border-white/10 my-0.5" />}
            <button
              role="menuitem"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
                item.onClick();
              }}
              className={cn(
                'w-full flex items-center gap-3 px-4 h-10 text-sm font-medium transition-colors',
                item.danger
                  ? 'text-destructive hover:bg-black/[0.04] dark:hover:bg-destructive/10'
                  : 'text-black/70 dark:text-white/70 hover:bg-black/[0.04] dark:hover:bg-accent',
                item.disabled && 'opacity-40 cursor-not-allowed'
              )}
            >
              {item.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>}
              <span className="flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
              {item.shortcut && (
                <span className="text-xs text-muted-foreground ml-4 shrink-0">{item.shortcut}</span>
              )}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Mobile context menu items (rendered inside shared BottomSheet) ──

function MobileMenuItems({
  items,
  onClose,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  return (
    <div className="px-2 pb-2">
      {items.map((item) => (
        <div key={item.id}>
          {item.separator && <div className="border-t border-border my-1 mx-2" />}
          <button
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 text-base rounded-lg transition-colors min-h-[44px]',
              item.danger
                ? 'text-destructive active:bg-destructive/10'
                : 'text-popover-foreground active:bg-accent',
              item.disabled && 'opacity-40 cursor-not-allowed'
            )}
          >
            {item.icon && <span className="shrink-0 w-5 h-5 flex items-center justify-center">{item.icon}</span>}
            <span className="flex-1 text-left">{item.label}</span>
          </button>
        </div>
      ))}

      {/* Cancel button */}
      <div className="border-t border-border mt-1 pt-1">
        <button
          onClick={onClose}
          className="w-full flex items-center justify-center px-4 py-3 text-base font-medium text-muted-foreground rounded-lg active:bg-accent min-h-[44px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────

export function ContextMenuProvider() {
  const [state, setState] = useState<ContextMenuState>({
    items: [],
    position: { x: 0, y: 0 },
    visible: false,
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  // Listen for the custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const { items, x, y } = (e as CustomEvent).detail;
      setState({ items, position: { x, y }, visible: true });
    };
    window.addEventListener('show-context-menu', handler);
    return () => window.removeEventListener('show-context-menu', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!state.visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [state.visible, handleClose]);

  if (!mounted || !state.visible || state.items.length === 0) return null;

  if (isMobile()) {
    return (
      <BottomSheet open={state.visible} onClose={handleClose} showHandle>
        <MobileMenuItems items={state.items} onClose={handleClose} />
      </BottomSheet>
    );
  }

  return createPortal(
    <FloatingMenu items={state.items} position={state.position} onClose={handleClose} />,
    document.body,
  );
}
