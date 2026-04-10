'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, MessageSquare, FileText, Table2, Bot, X, Layout, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import * as gw from '@/lib/api/gateway';
import { useT } from '@/lib/i18n';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { showError } from '@/lib/utils/error';
import { BottomSheet } from '@/components/shared/BottomSheet';

const CONTENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  doc: <FileText className="h-4 w-4" />,
  table: <Table2 className="h-4 w-4" />,
  presentation: <Layout className="h-4 w-4" />,
  diagram: <Workflow className="h-4 w-4" />,
};

const NOTIF_ICON: Record<string, React.ReactNode> = {
  doc_update: <FileText className="h-4 w-4" />,
  comment: <MessageSquare className="h-4 w-4" />,
  comment_reply: <MessageSquare className="h-4 w-4" />,
  comment_on_content: <MessageSquare className="h-4 w-4" />,
  mention: <MessageSquare className="h-4 w-4" />,
  comment_resolved: <Check className="h-4 w-4" />,
  comment_unresolved: <MessageSquare className="h-4 w-4" />,
  table_update: <Table2 className="h-4 w-4" />,
  agent: <Bot className="h-4 w-4" />,
};

function getNotificationIcon(notif: { type: string; meta?: { target_type?: string } | null }): React.ReactNode {
  if (['comment_on_content', 'comment', 'comment_reply', 'mention'].includes(notif.type)) {
    const targetType = notif.meta?.target_type;
    if (targetType && CONTENT_TYPE_ICONS[targetType]) {
      return CONTENT_TYPE_ICONS[targetType];
    }
  }
  return NOTIF_ICON[notif.type] ?? <Bell className="h-4 w-4" />;
}

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  anchorRect?: DOMRect | null;
}

export function NotificationPanel({ open, onClose, anchorRect }: NotificationPanelProps) {
  const { t } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => gw.getNotifications(undefined, 50),
    enabled: open,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: gw.getUnreadCount,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  }, [queryClient]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await gw.markAllNotificationsRead();
      invalidate();
    } catch (e) {
      showError(t('errors.markAllNotificationsReadFailed'), e);
    }
  }, [invalidate]);

  const handleClick = useCallback(async (notif: gw.Notification) => {
    try {
      if (!notif.read) {
        await gw.markNotificationRead(notif.id);
        invalidate();
      }
      if (notif.type === 'agent_registered') {
        window.dispatchEvent(new CustomEvent('open-agents-manager'));
        onClose();
        return;
      }
      if (notif.link) {
        const linkParams = new URLSearchParams(notif.link.split('?')[1] || '');
        const targetId = linkParams.get('id');
        const commentId = linkParams.get('comment_id');

        if (window.location.pathname === '/content' && targetId) {
          // Already on content page — navigate in-app via custom event
          window.dispatchEvent(new CustomEvent('notification-navigate', {
            detail: { targetId, commentId },
          }));
        } else if (isMobile) {
          router.push(notif.link);
        } else {
          window.open(notif.link, '_blank');
        }
      }
      onClose();
    } catch (e) {
      showError(t('errors.notificationClickFailed'), e);
    }
  }, [router, onClose, invalidate, isMobile]);

  if (!open) return null;

  // Shared notification list content
  const notificationList = (
    <div className="flex-1 overflow-y-auto">
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Bell className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-sm">{t('notification.noNotifications')}</p>
        </div>
      ) : (
        notifications.map(notif => (
          <button
            key={notif.id}
            onClick={() => handleClick(notif)}
            className={cn(
              'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 border-l-2',
              notif.read
                ? 'border-l-transparent'
                : 'border-l-sidebar-primary bg-sidebar-primary/5'
            )}
          >
            <span className={cn(
              'mt-0.5 shrink-0',
              notif.read ? 'text-muted-foreground/50' : 'text-sidebar-primary'
            )}>
              {getNotificationIcon(notif)}
            </span>
            <div className="flex-1 min-w-0">
              <p className={cn(
                'text-sm truncate',
                notif.read ? 'text-muted-foreground' : 'text-foreground font-medium'
              )}>
                {notif.title}
              </p>
              {notif.body && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {notif.body}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                {formatRelativeTime(notif.created_at)}
              </p>
            </div>
            {!notif.read && (
              <span className="mt-1.5 h-2 w-2 rounded-full bg-sidebar-primary shrink-0" />
            )}
          </button>
        ))
      )}
    </div>
  );

  // Header actions (mark all read)
  const headerActions = unreadCount > 0 ? (
    <button
      onClick={handleMarkAllRead}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent"
      title={t('toolbar.markAllRead')}
    >
      <Check className="h-3.5 w-3.5 inline mr-1" />
      {t('notification.markAllRead')}
    </button>
  ) : null;

  // Mobile: use BottomSheet
  if (isMobile) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title={`${t('toolbar.notifications')}${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
        initialHeight="full"
      >
        {headerActions && (
          <div className="flex justify-end px-4 pb-2">
            {headerActions}
          </div>
        )}
        {notificationList}
      </BottomSheet>
    );
  }

  // Desktop: positioned popover
  const panelStyle: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 8,
        left: Math.max(8, anchorRect.left - 140),
        zIndex: 50,
      }
    : {
        position: 'fixed',
        top: 56,
        left: 60,
        zIndex: 50,
      };

  return (
    <>
      {/* Click-away backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div
        style={panelStyle}
        className="w-80 max-h-[70vh] bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{t('toolbar.notifications')}</span>
            {unreadCount > 0 && (
              <span className="text-[10px] font-medium bg-sidebar-primary text-sidebar-primary-foreground px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {headerActions}
            <button
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-accent transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {notificationList}
      </div>
    </>
  );
}

/** Small bell badge to use in the sidebar header */
export function NotificationBellBadge() {
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: gw.getUnreadCount,
  });

  if (unreadCount === 0) return null;

  return (
    <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full px-0.5">
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  );
}
