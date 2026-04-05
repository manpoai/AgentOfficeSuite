'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sun, Moon, Monitor, Globe, ChevronRight, ChevronDown, FolderOpen, Trash2, Plus, PlusCircle, FileText, Table2, Presentation, GitBranch, Search, Link2, Settings, PanelLeftClose, Users, HelpCircle, MessageSquare, AtSign, Pencil, Bot, Circle, Check, X, Bell, Camera, Key, LogOut, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/auth';
import { useT, LOCALE_LABELS, type Locale } from '@/lib/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NotificationPanel, NotificationBellBadge } from '@/components/shared/NotificationPanel';
import * as gw from '@/lib/api/gateway';
import { showError } from '@/lib/utils/error';

interface ContentSidebarProps {
  /** Whether the sidebar is collapsed (56px) or expanded (232px) */
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Whether the sidebar is visible on desktop (used by detail panels) */
  visible: boolean;
  /** Content tree rendering slot - passed as children */
  children: React.ReactNode;
  /** Header area: view menu + create button */
  sidebarView: 'library' | 'trash';
  onSidebarViewChange: (view: 'library' | 'trash') => void;
  showNewMenu: boolean;
  onShowNewMenuChange: (show: boolean) => void;
  creating: boolean;
  onCreateDoc: () => void;
  onCreateTable: () => void;
  onCreatePresentation: () => void;
  onCreateDiagram: () => void;
  /** Search */
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ContentSidebar({
  collapsed,
  onToggleCollapse,
  visible,
  children,
  sidebarView,
  onSidebarViewChange,
  showNewMenu,
  onShowNewMenuChange,
  creating,
  onCreateDoc,
  onCreateTable,
  onCreatePresentation,
  onCreateDiagram,
  searchQuery,
  onSearchChange,
}: ContentSidebarProps) {
  const router = useRouter();
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
  const [editNameValue, setEditNameValue] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
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
  const [showOnboardingPrompt, setShowOnboardingPrompt] = useState(false);
  const [onboardingPromptText, setOnboardingPromptText] = useState('');
  const [resetTokenResult, setResetTokenResult] = useState<{ agentId: string; token: string } | null>(null);
  const [resetTokenConfirmId, setResetTokenConfirmId] = useState<string | null>(null);

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

  // Fetch onboarding prompt when agents panel opens
  useEffect(() => {
    if (!showAgentsMenu || onboardingPromptText) return;
    const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';
    gw.getAgentSkills()
      .then(data => {
        const raw = data.onboarding_prompt || '';
        setOnboardingPromptText(raw.replace(/\{GATEWAY_URL\}/g, gatewayUrl));
      })
      .catch(() => {});
  }, [showAgentsMenu]);

  // Agents data — use admin endpoint for pending agents
  const { data: allAgents } = useQuery({
    queryKey: ['admin-agents'],
    queryFn: gw.listAllAgents,
    refetchInterval: 10_000,
    enabled: showAgentsMenu,
  });

  // Notifications for message dropdown
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => gw.getNotifications(undefined, 50),
    refetchInterval: 30_000,
    enabled: showMessageMenu,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: gw.getUnreadCount,
    refetchInterval: 30_000,
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

  if (!visible) return null;

  return (
    <div
      className={cn(
        'hidden md:flex flex-col shrink-0 transition-all duration-200 ease-in-out bg-sidebar h-full overflow-hidden',
        collapsed ? 'w-14' : 'w-[232px]'
      )}
    >
      {/* ─── Top: Profile row ─── */}
      {!collapsed ? (
        <div className="px-3 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-2 group/header" ref={profileRef}>
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0 border border-black/10">
              {actor?.avatar_url ? (
                <img src={actor.avatar_url} alt="" className="w-full h-full object-cover" />
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
              <span className="truncate">{actor?.display_name || actor?.username || 'User'}</span>
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
                      {actor?.avatar_url ? (
                        <img src={actor.avatar_url} alt="" className="w-full h-full object-cover" />
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
                        } catch (err) { showError('Avatar upload failed', err); }
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
                            } catch (err) { showError('Name update failed', err); }
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
                      <span className="text-sm font-medium text-foreground truncate">{actor?.display_name || actor?.username || 'User'}</span>
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
                    onClick={() => { setShowProfileMenu(false); }}
                    className="flex items-center gap-3 w-full h-10 px-4 text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                  >
                    <Key className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                    Password
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setShowLangMenu(v => !v)}
                      className="flex items-center gap-3 w-full h-10 px-4 text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                    >
                      <Globe className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                      Language
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
                    onClick={() => { setShowProfileMenu(false); onSidebarViewChange(sidebarView === 'trash' ? 'library' : 'trash'); }}
                    className="flex items-center gap-3 w-full h-10 px-4 text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                  >
                    <Trash2 className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                    Trash
                  </button>
                  <button
                    onClick={() => { setShowProfileMenu(false); logout(); }}
                    className="flex items-center gap-3 w-full h-10 px-4 text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
                  >
                    <LogOut className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
                    Log out
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
                        {th.charAt(0).toUpperCase() + th.slice(1)}
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
            onClick={() => searchInputRef.current?.focus()}
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

      {/* ─── Search box ─── */}
      {!collapsed && (
        <div className="px-2 mb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#939493] dark:text-[#818181]" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('sidebar.searchPlaceholder')}
              className="w-full h-8 pl-8 pr-2 rounded-lg text-xs font-medium bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.05] dark:border-white/[0.05] text-foreground placeholder:text-black/40 dark:placeholder:text-white/40 outline-none focus:ring-1 focus:ring-sidebar-primary/30"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <span className="text-xs">×</span>
              </button>
            )}
          </div>
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
            Agents
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
            Message
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
              <div className="p-4">
                <div className="flex items-center justify-between mb-3 relative">
                  <h3 className="text-sm font-medium text-foreground">{t('actions.agentMembers')}</h3>
                  <button
                    onClick={() => setShowOnboardingPrompt(v => !v)}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-sidebar-primary hover:bg-sidebar-primary/10 rounded transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {t('actions.addAgent')}
                  </button>
                  {showOnboardingPrompt && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowOnboardingPrompt(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-card
                                      border border-black/10 dark:border-border rounded-lg
                                      shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] p-3 w-[360px]">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-foreground">
                            {t('actions.sendToAgent')}
                          </span>
                          <button
                            onClick={() => navigator.clipboard.writeText(onboardingPromptText)}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs text-sidebar-primary
                                       hover:bg-sidebar-primary/10 rounded transition-colors"
                          >
                            <Copy className="h-3 w-3" />
                            {t('actions.copyPrompt')}
                          </button>
                        </div>
                        <pre className="text-[11px] text-muted-foreground bg-black/[0.03] dark:bg-white/[0.05]
                                        rounded p-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap
                                        font-mono leading-relaxed">
                          {onboardingPromptText}
                        </pre>
                      </div>
                    </>
                  )}
                </div>

                {/* Pending Approved section */}
                {(() => {
                  const pending = allAgents?.filter(a => a.pending_approval) || [];
                  if (pending.length === 0) return null;
                  return (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-foreground/50 mb-2">Pending Approved</p>
                      {pending.map(agent => (
                        <div key={agent.agent_id || agent.name} className="flex items-center gap-3 py-2">
                          <div className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0 border border-black/10">
                            {agent.avatar_url ? (
                              <img src={agent.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Bot className="h-5 w-5 text-sidebar-primary" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-foreground truncate">{agent.display_name || agent.name}</span>
                            </div>
                            <span className="text-xs text-foreground/50">{agent.name}</span>
                          </div>
                          <button
                            onClick={async () => {
                              try { /* reject not implemented yet */ } catch {}
                            }}
                            className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0 hover:bg-red-100 transition-colors"
                          >
                            <X className="h-4 w-4 text-red-500" />
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await gw.approveAgent(agent.agent_id || agent.name);
                                queryClient.invalidateQueries({ queryKey: ['admin-agents'] });
                              } catch {}
                            }}
                            className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center shrink-0 hover:opacity-90 transition-colors"
                          >
                            <Check className="h-4 w-4 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Connected section */}
                {(() => {
                  const connected = allAgents?.filter(a => !a.pending_approval) || [];
                  if (connected.length === 0 && (!allAgents || allAgents.length === 0)) {
                    return (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <Bot className="h-10 w-10 mb-3 opacity-30" />
                        <p className="text-xs">No agents registered</p>
                      </div>
                    );
                  }
                  return (
                    <div>
                      <p className="text-xs font-medium text-foreground/50 mb-2">Connected</p>
                      {connected.map(agent => (
                        <div key={agent.agent_id || agent.name} className="flex items-center gap-3 py-2 group rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.05] px-2 -mx-2 transition-colors">
                          <div className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0 border border-black/10 relative">
                            {agent.avatar_url ? (
                              <img src={agent.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Bot className="h-5 w-5 text-sidebar-primary" />
                              </div>
                            )}
                            {/* Online dot */}
                            <div className={cn(
                              'absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-card',
                              agent.online ? 'bg-green-500' : 'bg-gray-300'
                            )} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-foreground truncate">{agent.display_name || agent.name}</span>
                            </div>
                            <span className="text-xs text-foreground/50">{agent.name}</span>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="w-8 h-8 rounded flex items-center justify-center hover:bg-black/[0.05]">
                              <Pencil className="h-3.5 w-3.5 text-foreground/40" />
                            </button>
                            <button className="w-8 h-8 rounded flex items-center justify-center hover:bg-black/[0.05]">
                              <Trash2 className="h-3.5 w-3.5 text-foreground/40" />
                            </button>
                            {resetTokenConfirmId === (agent.agent_id || agent.name) ? (
                              <div className="flex items-center gap-1 ml-1">
                                <span className="text-[10px] text-foreground/60">{t('actions.resetTokenConfirm')}</span>
                                <button
                                  onClick={async () => {
                                    try {
                                      const result = await gw.resetAgentToken(agent.agent_id || agent.name);
                                      setResetTokenResult({ agentId: agent.agent_id || agent.name, token: result.token });
                                    } catch {}
                                    setResetTokenConfirmId(null);
                                  }}
                                  className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors shrink-0"
                                >
                                  {t('common.confirm')}
                                </button>
                                <button
                                  onClick={() => setResetTokenConfirmId(null)}
                                  className="px-1.5 py-0.5 text-[10px] font-medium text-foreground/60 bg-black/[0.05] rounded hover:bg-black/[0.1] transition-colors shrink-0"
                                >
                                  {t('common.cancel')}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setResetTokenConfirmId(agent.agent_id || agent.name)}
                                className="w-8 h-8 rounded flex items-center justify-center hover:bg-black/[0.05] text-[10px] text-foreground/40"
                                title={t('actions.resetToken')}
                              >
                                <Key className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
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
              <h3 className="text-sm font-medium text-foreground">Messages</h3>
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
                  Mark all read
                </button>
              )}
            </div>
            <ScrollArea style={{ maxHeight: '352px' }}>
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Bell className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-xs">No messages</p>
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
                          router.push(notif.link);
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
                        <p className="text-[10px] text-foreground/40 mt-1">{formatNotifTime(notif.created_at)}</p>
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
            <button
              onClick={() => { onShowNewMenuChange(false); onCreateDoc(); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors disabled:opacity-50"
            >
              <FileText className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
              {t('actions.newDoc')}
            </button>
            <button
              onClick={() => { onShowNewMenuChange(false); onCreateTable(); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors disabled:opacity-50"
            >
              <Table2 className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
              {t('actions.newTable')}
            </button>
            <button
              onClick={() => { onShowNewMenuChange(false); onCreatePresentation(); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors disabled:opacity-50"
            >
              <Presentation className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
              {t('actions.newSlides')}
            </button>
            <button
              onClick={() => { onShowNewMenuChange(false); onCreateDiagram(); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors disabled:opacity-50"
            >
              <GitBranch className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
              {t('actions.newFlowchart')}
            </button>
            <div className="border-t border-black/10 dark:border-border my-1" />
            <button
              onClick={() => { onShowNewMenuChange(false); router.push('/contacts'); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors"
            >
              <Users className="h-4 w-4 text-[#939493] dark:text-[#818181]" />
              Agents
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

      {/* ─── New token display modal ─── */}
      {resetTokenResult && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
            <div className="bg-white dark:bg-card border border-black/10 dark:border-border rounded-lg p-4 w-[400px] shadow-xl">
              <h3 className="text-sm font-semibold mb-2">New Token</h3>
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                {t('actions.newTokenWarning')}
              </p>
              <div className="flex items-center gap-2 bg-black/[0.04] dark:bg-white/[0.05] rounded p-2">
                <code className="text-xs font-mono flex-1 break-all">{resetTokenResult.token}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(resetTokenResult.token)}
                  className="shrink-0 p-1 rounded hover:bg-black/[0.08] transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                onClick={() => setResetTokenResult(null)}
                className="mt-3 w-full py-1.5 text-xs font-medium bg-sidebar-primary text-white rounded-md hover:bg-sidebar-primary/90 transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </>
      )}

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

function formatNotifTime(ts: number | string): string {
  const time = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diff = Date.now() - time;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
