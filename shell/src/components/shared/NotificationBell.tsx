'use client';

import { useState, useRef, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { Bell } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import * as gw from '@/lib/api/gateway';
import { NotificationPanel } from './NotificationPanel';

interface NotificationBellProps {
  className?: string;
  /** Size variant: 'default' for sidebar, 'mobile' for 44x44 circle */
  variant?: 'default' | 'mobile';
}

/**
 * Notification bell button with unread count badge.
 * Renders NotificationPanel on click.
 *
 * Desktop: sidebar header (default variant)
 * Mobile: 44x44 circular button (mobile variant)
 */
export function NotificationBell({ className, variant = 'default' }: NotificationBellProps) {
  const { t } = useT();
  const [showPanel, setShowPanel] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: gw.getUnreadCount,
    refetchInterval: 30_000,
  });

  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const handleToggle = useCallback(() => {
    setShowPanel(v => {
      if (!v) {
        setAnchorRect(bellRef.current?.getBoundingClientRect() ?? null);
      }
      return !v;
    });
  }, []);

  return (
    <>
      <button
        ref={bellRef}
        onClick={handleToggle}
        className={cn(
          'relative transition-colors',
          variant === 'mobile'
            ? 'w-11 h-11 rounded-full flex items-center justify-center bg-muted hover:bg-accent'
            : 'p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-black/5 dark:hover:bg-white/10',
          className
        )}
        title={t('toolbar.notifications')}
      >
        <Bell className={cn(variant === 'mobile' ? 'h-5 w-5' : 'h-4 w-4')} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full px-0.5">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <NotificationPanel
        open={showPanel}
        onClose={() => setShowPanel(false)}
        anchorRect={anchorRect}
      />
    </>
  );
}
