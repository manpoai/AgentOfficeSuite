'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sun, Moon, Monitor, Globe, ChevronRight, ChevronDown, FolderOpen, Trash2, Plus, PlusCircle, FileText, Table2, Presentation, GitBranch, Search, Link2, Settings, PanelLeftClose, Users, HelpCircle, MessageSquare, AtSign, Pencil, Bell, Camera, Key, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/auth';
import { useT, LOCALE_LABELS, type Locale } from '@/lib/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NotificationPanel, NotificationBellBadge } from '@/components/shared/NotificationPanel';
import { AgentPanelContent } from '@/components/shared/AgentPanelContent';
import * as gw from '@/lib/api/gateway';
import { resolveAvatarUrl } from '@/lib/api/gateway';
import { showError } from '@/lib/utils/error';
import { formatRelativeTime } from '@/lib/utils/time';
import { CREATE_CONTENT_ITEMS } from '@/actions/create-content.actions';
import type { CreatableType } from '@/actions/entity-names';
import { useIsMobile } from '@/lib/hooks/use-mobile';

interface ContentSidebarProps {
  /** Whether the sidebar is collapsed (56px) or expanded (232px) */
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  /** Whether the sidebar is visible on desktop (used by detail panels) */
  visible: boolean;
  /** Content tree rendering slot - passed as children */
  children: React.ReactNode;
  /** Open trash overlay */
  onToggleTrash: () => void;
  /** Open change password dialog */
  onOpenChangePassword: () => void;
  showNewMenu: boolean;
  onShowNewMenuChange: (show: boolean) => void;
  creating: boolean;
  onCreateByType: (type: CreatableType) => void;
  /** Search */
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ContentSidebar({
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  visible,
  children,
  onToggleTrash,
  onOpenChangePassword,
  showNewMenu,
  onShowNewMenuChange,
  creating,
  onCreateByType,
  searchQuery,
  onSearchChange,
}: ContentSidebarProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { actor, logout, refreshActor } = useAuth();
  const { t, locale, setLocale } = useT();
  const { setTheme, theme } = useTheme();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showAgentsMenu, setShowAgentsMenu] = useState(false);
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [isDraggingWidth, setIsDraggingWidth] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const agentsRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const agentsBtnRef = useRef<HTMLButtonElement>(null);
  const messageBtnRef = useRef<HTMLButtonElement>(null);
  const cPlusBtnRef = useRef<HTMLButtonElement>(null);
  const cSearchBtnRef = useRef<HTMLButtonElement>(null);
  const cAgentsBtnRef = useRef<HTMLButtonElement>(null);
  const cMessageBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<Record<string, { top: number; left: number }>>({});
  /** Calculate dropdown position: 8px below the trigger button, left-aligned.
   *  In collapsed mode (toRight=true): menu appears 8px to the right of button, top-aligned. */
  const calcMenuPos = (btnRef: React.RefObject<HTMLElement | null>, menuWidth: number, alignLeft = true, toRight = false) => {
    if (!btnRef.current) return { top: 0, left: 0 };
    const rect = btnRef.current.getBoundingClientRect();
    if (toRight) {
      return { top: rect.top, left: rect.right + 8 };
    }
    return {
      top: rect.bottom + 8,
      left: alignLeft ? rect.left : Math.max(0, rect.right - menuWidth),
    };
  };

  // Notifications for message dropdown
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => gw.getNotifications(undefined, 50),
    enabled: showMessageMenu,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: gw.getUnreadCount,
  });

  useEffect(() => setMounted(true), []);

  // Close settings menu when clicking outside
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  // Close profile menu when clicking outside
  useEffect(() => {
    if (!showProfileMenu) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
        setShowLangMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProfileMenu]);

  // Close agents menu when clicking outside
  useEffect(() => {
    if (!showAgentsMenu) return;
    const handler = (e: MouseEvent) => {
      if (agentsRef.current && !agentsRef.current.contains(e.target as Node)) {
        setShowAgentsMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAgentsMenu]);

  // Open agents manager from cross-panel events (e.g. notifications)
  useEffect(() => {
    const handler = () => {
      setShowNotifications(false);
      setShowMessageMenu(false);
      setShowAgentsMenu(true);
    };
    window.addEventListener('open-agents-manager', handler);
    return () => window.removeEventListener('open-agents-manager', handler);
  }, []);

  // Close message menu when clicking outside
  useEffect(() => {
    if (!showMessageMenu) return;
    const handler = (e: MouseEvent) => {
      if (messageRef.current && !messageRef.current.contains(e.target as Node)) {
        setShowMessageMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMessageMenu]);

  const handleDoubleClick = () => {
    onWidthChange(232);
  };

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    setIsDraggingWidth(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      onWidthChange(Math.max(200, Math.min(480, startWidth + delta)));
    };

    const cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragCleanupRef.current = null;
      setIsDraggingWidth(false);
    };

    dragCleanupRef.current = cleanup;

    const onMouseUp = () => {
      cleanup();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={cn(
        'hidden md:flex flex-col shrink-0 bg-sidebar h-full overflow-hidden relative',
        collapsed ? 'w-14 transition-all duration-200 ease-in-out' : isDraggingWidth ? '' : 'transition-[width] duration-200 ease-in-out'
      )}
      style={collapsed ? undefined : { width: `${width}px` }}
    >
      {!collapsed && (
        <div
          className="hidden md:block absolute top-0 right-0 w-1 h-full cursor-col-resize z-10"
          onMouseDown={handleDragStart}
          onDoubleClick={handleDoubleClick}
        />
      )}

      {/* ─── Top: Profile row ─── */}
      {!collapsed ? (
        <div className="px-3 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-2 group/header" ref={profileRef}>
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0 border border-black/10">
              {resolveAvatarUrl(actor?.avatar_url) ? (
                <img src={resolveAvatarUrl(actor?.avatar_url)!} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-medium text-muted-foreground">
                  {(actor?.display_name || actor?.username || '?')[0].toUpperCase()}
                </div>
              )}
            </div>
            {/* Username + dropdown */}
            <button
              ref={profileBtnRef}
              onClick={() => {
                setMenuPos(p => ({ ...p, profile: calcMenuPos(profileRef, 232) }));
                setShowProfileMenu(v => !v);
              }}
              className="flex items-center gap-1 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors min-w-0"
            >
              <span className="truncate">{actor?.display_name || actor?.username || t('common.user')}</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-0 group-hover/header:opacity-50 transition-opacity" />
            </button>
            {/* + button (far right) — PlusCircle with circle border */}
            <button
              ref={plusBtnRef}
              onClick={() => {
                setMenuPos(p => ({ ...p, plus: calcMenuPos(plusBtnRef, 168, true) }));
                onShowNewMenuChange(!showNewMenu);
              }}
              className="ml-auto p-1 text-black/70 dark:text-white/70 hover:text-foreground rounded transition-colors shrink-0"
              title={t('common.new')}
            >
              <PlusCircle className="h-4 w-4" strokeWidth={1.5} />
            </button>

            {/* Profile dropdown — Figma 72-4121: 232×304, white bg, 8px below header row */}
            {showProfileMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setShowProfileMenu(false); setShowLangMenu(false); setEditingName(false); }} />
                <div className="fixed z-50 bg-white dark:bg-card border border-black/10 dark:border-border rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)]"
                  style={{ top: `${menuPos.profile?.top ?? 54}px`, left: `${menuPos.profile?.left ?? 12}px`, width: '232px' }}
                >
                  {/* Avatar (48×48) + name + edit icon */}
                  <div className="px-4 pt-4 pb-2 flex items-center gap-3">
                    {/* Avatar with hover upload overlay */}
                    <div className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0 border border-black/10 relative group cursor-pointer"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {resolveAvatarUrl(actor?.avatar_url) ? (
                        <img src={resolveAvatarUrl(actor?.avatar_url)!} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg font-medium text-muted-foreground">
                          {(actor?.display_name || actor?.username || '?')[0].toUpperCase()}
                        </div>
                      )}
                      {/* Upload overlay on hover */}
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                        <Camera className="h-5 w-5 text-white" />
                      </div>
                    </div>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setSavingProfile(true);
                        try {
                          await gw.uploadUserAvatar(file);
                          await refreshActor();
                        } catch (err) { showError(t('settings.avatarUploadFailed'), err); }
                        setSavingProfile(false);
                        e.target.value = '';
                      }}
                    />
                    {/* Name display or edit */}
                    {editingName ? (
                      <input
                        autoFocus
                        value={editNameValue}
                        onChange={e => setEditNameValue(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && editNameValue.trim().length >= 2) {
                            setSavingProfile(true);
                            try {
                              await gw.updateProfile({ name: editNameValue.trim() });
                              await refreshActor();
                            } catch (err) { showError(t('settings.nameUpdateFailed'), err); }
                            setSavingProfile(false);
                            setEditingName(false);
                          } else if (e.key === 'Escape') {
                            setEditingName(false);
                          }
                        }}
                        onBlur={() => setEditingName(false)}
                        className="text-sm font-medium text-foreground bg-transparent border-b border-sidebar-primary outline-none min-w-0 flex-1"
                        disabled={savingProfile}
                      />
                    ) : (
                      <span className="text-sm font-medium text-foreground truncate">{actor?.display_name || actor?.username || t('common.user')}</span>
                    )}
                    <button
                      onClick={() => {
                        if (!editingName) {
                          setEditNameValue(actor?.display_name || actor?.username || '');
                          setEditingName(true);
                        }
                      }}
                      className="shrink-0 p-0.5 hover:bg-black/[0.04] rounded transition-colors"
                    >
                      <Pencil className="h-4 w-4 opacity-40" />
                    </button>
                  </div>

                  {/* Menu items — proper icons from Lucide */}
                  <button
                    onClick={() => { setShowProfileMenu(false); onOpenChangePassword(); }}
                    className="flex items-center gap-3 w-full h-10 px-4 text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                  >
                    <Key className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                    {t('settings.password')}
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setShowLangMenu(v => !v)}
                      className="flex items-center gap-3 w-full h-10 px-4 text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                    >
                      <Globe className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                      {t('settings.language')}
                      <ChevronRight className="h-3.5 w-3.5 ml-auto opacity-40" />
                    </button>
                    {/* Language sub-menu — separate popup to the right */}
                    {showLangMenu && (
                      <div className="absolute left-full top-0 ml-1 bg-white dark:bg-card border border-black/10 dark:border-border rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] py-1 min-w-[120px] z-30">
                        {(Object.entries(LOCALE_LABELS) as [Locale, string][]).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => { setLocale(key); setShowProfileMenu(false); setShowLangMenu(false); }}
                            className={cn(
                              'flex items-center w-full px-4 py-2 text-sm',
                              locale === key ? 'text-sidebar-primary font-medium' : 'text-foreground/50 hover:text-foreground/70 hover:bg-black/[0.04]'
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => { setShowProfileMenu(false); onToggleTrash(); }}
                    className="flex items-center gap-3 w-full h-10 px-4 text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                  >
                    <Trash2 className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                    {t('settings.trash')}
                  </button>
                  <button
                    onClick={() => { setShowProfileMenu(false); logout(); }}
                    className="flex items-center gap-3 w-full h-10 px-4 text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                  >
                    <LogOut className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                    {t('settings.logout')}
                  </button>

                  {/* Theme toggle — NO icons, text only. pb-6 = 24px bottom padding */}
                  <div className="px-4 pt-3 pb-6 flex gap-1">
                    {mounted && (['light', 'dark', 'system'] as const).map((th) => (
                      <button
                        key={th}
                        onClick={() => setTheme(th)}
                        className={cn(
                          'flex items-center justify-center h-8 rounded text-xs font-medium flex-1 border',
                          theme === th
                            ? 'bg-sidebar-primary/10 text-sidebar-primary border-sidebar-primary/20'
                            : 'bg-black/[0.03] dark:bg-white/[0.05] text-foreground border-black/10 dark:border-white/10 hover:bg-black/[0.06]'
                        )}
                      >
                        {t(`theme.${th}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="pt-3 pb-2 flex flex-col items-center gap-1 shrink-0">
          {/* + (PlusCircle) */}
          <button
            ref={cPlusBtnRef}
            onClick={() => {
              setMenuPos(p => ({ ...p, plus: calcMenuPos(cPlusBtnRef, 168, true, true) }));
              onShowNewMenuChange(!showNewMenu);
            }}
            className="p-2 text-black/70 dark:text-white/70 hover:text-foreground hover:bg-black/[0.04] rounded-lg transition-colors"
            title={t('common.new')}
          >
            <PlusCircle className="h-5 w-5" strokeWidth={1.5} />
          </button>
          {/* Search */}
          <button
            ref={cSearchBtnRef}
            onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
            className="p-2 text-[#939493] dark:text-[#818181] hover:text-foreground hover:bg-black/[0.04] rounded-lg transition-colors"
            title={t('toolbar.search')}
          >
            <Search className="h-5 w-5" />
          </button>
          {/* Agents */}
          <button
            ref={cAgentsBtnRef}
            onClick={() => {
              setMenuPos(p => ({ ...p, agents: calcMenuPos(cAgentsBtnRef, 320, true, true) }));
              setShowAgentsMenu(v => !v); setShowMessageMenu(false);
            }}
            className="p-2 text-[#939493] dark:text-[#818181] hover:text-foreground hover:bg-black/[0.04] rounded-lg transition-colors"
            title={t('toolbar.agents')}
          >
            <AtSign className="h-5 w-5" />
          </button>
          {/* Message */}
          <button
            ref={cMessageBtnRef}
            onClick={() => {
              setMenuPos(p => ({ ...p, message: calcMenuPos(cMessageBtnRef, 320, true, true) }));
              setShowMessageMenu(v => !v); setShowAgentsMenu(false);
            }}
            className="p-2 text-[#939493] dark:text-[#818181] hover:text-foreground hover:bg-black/[0.04] rounded-lg transition-colors relative"
            title={t('toolbar.message')}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 rounded-full bg-red-500 text-white text-[9px] font-medium flex items-center justify-center px-0.5">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ─── Search box (click to open command palette) ─── */}
      {!collapsed && (
        <div className="px-2 mb-2 shrink-0">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
            className="w-full h-8 pl-8 pr-2 rounded-lg text-xs font-medium bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.05] dark:border-white/[0.05] text-black/40 dark:text-white/40 outline-none text-left relative flex items-center hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
          >
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#939493] dark:text-[#818181]" />
            {t('sidebar.searchPlaceholder')}
          </button>
        </div>
      )}

      {/* ─── Agents + Message buttons ─── */}
      {!collapsed && (
        <div className="px-2 mb-2 flex gap-2 shrink-0 relative">
          <button
            ref={agentsBtnRef}
            onClick={() => {
              setMenuPos(p => ({ ...p, agents: calcMenuPos(agentsBtnRef, 320) }));
              setShowAgentsMenu(v => !v); setShowMessageMenu(false);
            }}
            className="flex items-center justify-center gap-1.5 h-8 flex-1 rounded-lg text-xs font-medium transition-colors border border-black/10 dark:border-white/10"
            style={{
              backgroundColor: 'hsl(var(--sidebar-primary))',
              color: 'hsl(var(--sidebar-primary-foreground))',
            }}
          >
            <AtSign className="h-4 w-4" />
            {t('toolbar.agents')}
          </button>
          <button
            ref={messageBtnRef}
            onClick={() => {
              setMenuPos(p => ({ ...p, message: calcMenuPos(messageBtnRef, 320) }));
              setShowMessageMenu(v => !v); setShowAgentsMenu(false);
            }}
            className="flex items-center justify-center gap-1.5 h-8 flex-1 rounded-lg text-xs font-medium text-foreground/70 bg-white dark:bg-card border border-black/10 dark:border-white/10 hover:bg-black/[0.02] transition-colors relative"
          >
            <Bell className="h-4 w-4" />
            {t('toolbar.message')}
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ─── Agents dropdown — Figma: 320×499, positioned below buttons ─── */}
      {showAgentsMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowAgentsMenu(false)} />
          <div
            ref={agentsRef}
            className="fixed z-50 bg-white dark:bg-card border border-black/10 dark:border-border rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] overflow-hidden"
            style={{ top: `${menuPos.agents?.top ?? 136}px`, left: `${menuPos.agents?.left ?? 8}px`, width: '320px', maxHeight: '499px' }}
          >
            <ScrollArea className="h-full" style={{ maxHeight: '499px' }}>
              <AgentPanelContent variant="popover" />
            </ScrollArea>
          </div>
        </>
      )}

      {/* ─── Message dropdown — Figma: 320×264, notification list ─── */}
      {showMessageMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMessageMenu(false)} />
          <div
            ref={messageRef}
            className="fixed z-50 bg-white dark:bg-card border border-black/10 dark:border-border rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] overflow-hidden"
            style={{ top: `${menuPos.message?.top ?? 136}px`, left: `${menuPos.message?.left ?? 120}px`, width: '320px', maxHeight: '400px' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-border">
              <h3 className="text-sm font-medium text-foreground">{t('notification.messages')}</h3>
              {unreadCount > 0 && (
                <button
                  onClick={async () => {
                    try {
                      await gw.markAllNotificationsRead();
                      queryClient.invalidateQueries({ queryKey: ['notifications'] });
                      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
                    } catch {}
                  }}
                  className="text-xs text-sidebar-primary hover:underline"
                >
                  {t('notification.markAllRead')}
                </button>
              )}
            </div>
            <ScrollArea style={{ maxHeight: '352px' }}>
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Bell className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-xs">{t('notification.noMessages')}</p>
                </div>
              ) : (
                <div className="py-1">
                  {notifications.map(notif => (
                    <button
                      key={notif.id}
                      onClick={async () => {
                        if (!notif.read) {
                          try {
                            await gw.markNotificationRead(notif.id);
                            queryClient.invalidateQueries({ queryKey: ['notifications'] });
                            queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
                          } catch {}
                        }
                        if (notif.link) {
                          const linkParams = new URLSearchParams(notif.link.split('?')[1] || '');
                          const targetId = linkParams.get('id');
                          const currentId = new URLSearchParams(window.location.search).get('id');
                          if (targetId && targetId === currentId) {
                            // Same document — stay on page, just open comment panel
                            const commentId = linkParams.get('comment_id');
                            if (commentId) window.dispatchEvent(new CustomEvent('focus-comment', { detail: { commentId } }));
                          } else {
                            window.open(notif.link, '_blank');
                          }
                          setShowMessageMenu(false);
                        }
                      }}
                      className={cn(
                        'w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-black/[0.04] transition-colors',
                        !notif.read && 'bg-sidebar-primary/5'
                      )}
                    >
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <MessageSquare className="h-4 w-4 text-foreground/40" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm truncate', !notif.read ? 'font-medium text-foreground' : 'text-foreground/70')}>{notif.title}</p>
                        {notif.body && <p className="text-xs text-foreground/50 truncate mt-0.5">{notif.body}</p>}
                        <p className="text-[10px] text-foreground/40 mt-1">{formatRelativeTime(typeof notif.created_at === 'string' ? new Date(notif.created_at).getTime() : notif.created_at)}</p>
                      </div>
                      {!notif.read && <div className="w-2 h-2 rounded-full bg-sidebar-primary shrink-0 mt-2" />}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </>
      )}

      {/* ─── New item menu ─── */}
      {showNewMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => onShowNewMenuChange(false)} />
          <div className="fixed z-50 bg-white dark:bg-card border border-black/10 dark:border-border rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] py-1 w-[168px]"
            style={{ top: `${menuPos.plus?.top ?? 52}px`, left: `${menuPos.plus?.left ?? 170}px` }}
          >
            {CREATE_CONTENT_ITEMS.filter(item => !isMobile || (item.type !== 'presentation' && item.type !== 'diagram')).map((item) => {
              const Icon = item.icon;
              const onClick = () => {
                onShowNewMenuChange(false);
                onCreateByType(item.type);
              };
              return (
                <button
                  key={item.type}
                  onClick={onClick}
                  disabled={creating}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors disabled:opacity-50"
                >
                  <Icon className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                  {item.label(t)}
                </button>
              );
            })}
            <div className="border-t border-black/10 dark:border-border my-1" />
            <button
              onClick={() => { onShowNewMenuChange(false); setShowAgentsMenu(true); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
            >
              <Users className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
              {t('content.agents')}
            </button>
          </div>
        </>
      )}

      {/* Notification panel */}
      <NotificationPanel
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        anchorRect={undefined}
      />

      {/* ─── Scrollable tree content area ─── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className={cn('px-2 py-1', collapsed && 'hidden')}>
          {children}
        </div>
      </ScrollArea>

      {/* ─── Bottom: Logo + Help + Collapse ─── */}
      <div className="mt-auto shrink-0 pl-6 pr-3 py-6">
        {!collapsed ? (
          <div className="flex items-center">
            {/* @suite logo — Figma: 56×24 image, 24px from left/top/bottom */}
            <img src="/logo.png" alt="@suite" className="h-6 object-contain object-left" style={{ maxWidth: '56px' }} />
            {/* Help + Collapse pushed to right, 12px from right edge */}
            <div className="ml-auto flex items-center">
              <button
                onClick={() => setShowSettings(v => !v)}
                className="p-1 text-black/30 dark:text-white/30 hover:text-foreground rounded transition-colors"
                title={t('toolbar.help')}
                ref={settingsRef as any}
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              <button
                onClick={onToggleCollapse}
                className="p-1 text-black/30 dark:text-white/30 hover:text-foreground rounded transition-colors"
                title={t('toolbar.collapseSidebar')}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              onClick={onToggleCollapse}
              className="p-1.5 text-black/30 dark:text-white/30 hover:text-foreground rounded transition-colors"
              title={t('toolbar.expandSidebar')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Settings are now in the profile dropdown */}
      </div>
    </div>
  );
}

