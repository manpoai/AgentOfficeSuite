'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarSeparator } from './ToolbarSeparator';
import { ToolbarColorPicker } from './ToolbarColorPicker';
import { ToolbarDropdown } from './ToolbarDropdown';
import type { ToolbarItem, ToolbarHandler, ToolbarState } from './types';

export type { ToolbarItem, ToolbarHandler, ToolbarState };

interface FloatingToolbarProps {
  items: ToolbarItem[];
  handler: ToolbarHandler;
  /** Position anchor (viewport coordinates) */
  anchor: { top: number; left: number; width: number } | null;
  visible: boolean;
  /** Called when mouse enters/leaves the toolbar (for hover-keep-open logic) */
  onHover?: (hovering: boolean) => void;
  className?: string;
}

export function FloatingToolbar({ items, handler, anchor, visible, onHover, className }: FloatingToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ToolbarState>({});
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const refreshState = useCallback(() => {
    setState(handler.getState());
  }, [handler]);

  useEffect(() => {
    if (visible) refreshState();
  }, [visible, refreshState]);

  // Position toolbar above anchor — only recompute when anchor changes, not on state changes
  useEffect(() => {
    if (!visible || !anchor || !toolbarRef.current) return;
    const tb = toolbarRef.current.getBoundingClientRect();
    const top = anchor.top - tb.height - 6;
    const left = anchor.left + anchor.width / 2 - tb.width / 2;
    setPosition({
      top: Math.max(8, top),
      left: Math.max(8, Math.min(left, window.innerWidth - tb.width - 8)),
    });
  }, [visible, anchor]);

  const handleExecute = useCallback((key: string, value?: unknown) => {
    handler.execute(key, value);
    setState(handler.getState());
  }, [handler]);

  if (!visible || !anchor) return null;

  // Build rendered items with separators between groups
  const rendered: React.ReactNode[] = [];
  let lastGroup: string | undefined;

  for (const item of items) {
    if (lastGroup !== undefined && item.group !== lastGroup) {
      rendered.push(<ToolbarSeparator key={`sep-${item.key}`} />);
    }
    lastGroup = item.group;

    switch (item.type) {
      case 'toggle':
        rendered.push(
          <ToolbarButton
            key={item.key}
            active={!!state[item.key]}
            onClick={() => handleExecute(item.key)}
            title={item.label}
          >
            {item.icon}
          </ToolbarButton>
        );
        break;

      case 'color':
        rendered.push(
          <ToolbarColorPicker
            key={item.key}
            icon={item.icon}
            label={item.label}
            colors={item.colors || []}
            active={!!state[item.key]}
            currentColor={typeof state[item.key] === 'string' ? state[item.key] as string : undefined}
            clearable={item.colorClearable}
            onSelect={(color) => handleExecute(item.key, color)}
          />
        );
        break;

      case 'dropdown':
        rendered.push(
          <ToolbarDropdown
            key={item.key}
            icon={item.icon}
            label={item.label}
            options={item.options || []}
            value={typeof state[item.key] === 'string' ? state[item.key] as string : undefined}
            onSelect={(val) => handleExecute(item.key, val)}
            showValue={true}
          />
        );
        break;

      case 'action':
        rendered.push(
          <ToolbarButton
            key={item.key}
            onClick={() => handleExecute(item.key)}
            title={item.label}
          >
            {item.icon}
          </ToolbarButton>
        );
        break;

      case 'custom':
        if (item.renderCustom) {
          rendered.push(
            <span key={item.key}>
              {item.renderCustom(
                typeof state[item.key] === 'string' ? state[item.key] as string : undefined,
                (val) => handleExecute(item.key, val),
              )}
            </span>
          );
        }
        break;
    }
  }

  return createPortal(
    <div
      ref={toolbarRef}
      data-floating-toolbar
      className={cn(
        'fixed z-[1200] flex items-center gap-0 px-[3px] py-[2px]',
        'bg-popover border border-border rounded-lg shadow-xl backdrop-blur-sm',
        className,
      )}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onHover?.(true); // Signal that interaction is on toolbar
      }}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      {rendered}
    </div>,
    document.body,
  );
}
