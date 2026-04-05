'use client';

/**
 * MobileNav — Mobile list view navigation bar.
 *
 * Figma design (35-2914):
 * - Left: User avatar (44px, border) + username → opens Profile
 * - Right: Search (44px white circle) + Bell (44px white circle) + Green @ button (44px) → opens Agents
 */

import React from 'react';
import { Search, Bell, AtSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface MobileNavProps {
  userName?: string;
  avatarUrl?: string;
  unreadCount?: number;
  onSearch: () => void;
  onNotifications: () => void;
  /** Called when left avatar/username is tapped — opens Profile */
  onProfile?: () => void;
  /** Called when right @ button is tapped — opens Agents menu */
  onAgents?: () => void;
  className?: string;
}

export function MobileNav({
  userName = '',
  avatarUrl,
  unreadCount = 0,
  onSearch,
  onNotifications,
  onProfile,
  onAgents,
  className,
}: MobileNavProps) {
  const { t } = useT();
  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2',
        'md:hidden',
        className,
      )}
    >
      {/* Left: User avatar + name — tap to open Profile */}
      <button
        type="button"
        onClick={onProfile}
        className="flex items-center gap-2.5 active:opacity-70 transition-opacity"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover border border-black/20" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-muted border border-black/20 flex items-center justify-center text-base font-medium text-muted-foreground">
            {userName?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <span className="text-base font-normal text-foreground">{userName || 'User'}</span>
      </button>

      {/* Right: Action buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onSearch}
          aria-label={t('toolbar.search')}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-white dark:bg-card active:opacity-60 transition-opacity"
        >
          <Search className="w-5 h-5 text-black dark:text-white" strokeWidth={2} />
        </button>

        <button
          onClick={onNotifications}
          aria-label={t('toolbar.notifications')}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-white dark:bg-card active:opacity-60 transition-opacity"
        >
          <div className="relative">
            <Bell className="w-5 h-5 text-black dark:text-white" strokeWidth={2} />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
        </button>

        {/* Green @ button — opens Agents menu */}
        <button
          type="button"
          onClick={onAgents}
          aria-label={t('toolbar.agents')}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-sidebar-primary active:opacity-80 transition-opacity"
        >
          <AtSign className="w-6 h-6 text-white" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
