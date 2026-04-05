'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface ToolbarButtonProps {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export function ToolbarButton({ active, onClick, title, children, className }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
      className={cn(
        'w-[26px] h-[26px] flex items-center justify-center rounded transition-colors',
        active
          ? 'bg-sidebar-primary text-white'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}
