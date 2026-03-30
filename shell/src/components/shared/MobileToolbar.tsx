'use client';
import React from 'react';

interface ToolbarItem {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

interface MobileToolbarProps {
  items: ToolbarItem[];
  visible: boolean;
}

export function MobileToolbar({ items, visible }: MobileToolbarProps) {
  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 overflow-x-auto scrollbar-hide">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={item.onClick}
            disabled={item.disabled}
            className={`flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-lg transition-colors
              ${item.active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'}
              ${item.disabled ? 'opacity-30' : ''}`}
            title={item.label}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
