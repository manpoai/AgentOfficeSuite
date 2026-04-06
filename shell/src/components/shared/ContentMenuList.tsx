'use client';

import { cn } from '@/lib/utils';
import type { ContentMenuItem } from './ContentTopBar';

export function ContentMenuList({
  items,
  onItemClick,
  itemClassName,
}: {
  items: ContentMenuItem[];
  onItemClick: (item: ContentMenuItem) => void;
  itemClassName?: string;
}) {
  return (
    <>
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && <div className="border-t border-black/10 dark:border-white/10 my-0.5" />}
          <button
            onClick={() => onItemClick(item)}
            className={cn(
              'w-full flex items-center gap-3 px-4 h-10 text-sm font-medium transition-colors',
              item.danger
                ? 'text-destructive hover:bg-black/[0.04] dark:hover:bg-destructive/10'
                : 'text-black/70 dark:text-white/70 hover:bg-black/[0.04] dark:hover:bg-accent',
              itemClassName,
            )}
          >
            {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && <span className="text-xs text-muted-foreground ml-4 shrink-0">{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </>
  );
}
