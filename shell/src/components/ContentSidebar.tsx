'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sun, Moon, Globe, ChevronRight, ChevronDown, FolderOpen, Trash2, Plus, FileText, Table2, Presentation, GitBranch, Search, Bell, Link2, Settings, PanelLeftClose } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useT, LOCALE_LABELS, type Locale } from '@/lib/i18n';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NotificationPanel, NotificationBellBadge } from '@/components/shared/NotificationPanel';

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
  const { t, locale, setLocale } = useT();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

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

  // Keyboard shortcuts are now handled by KeyboardManager (global-shortcuts.ts)

  if (!visible) return null;

  return (
    <div
      className={cn(
        'hidden md:flex flex-col border-r border-border shrink-0 transition-all duration-200 ease-in-out bg-sidebar h-full overflow-hidden',
        collapsed ? 'w-14' : 'w-[232px]'
      )}
    >
      {/* Top: Logo + action buttons */}
      <div className="h-[52px] flex items-center px-3 gap-2 shrink-0">
        <span
          className={cn(
            'text-xl text-foreground font-[family-name:var(--font-allura)] whitespace-nowrap transition-opacity duration-200 flex-1 min-w-0',
            collapsed ? 'opacity-0 w-0' : 'opacity-100'
          )}
        >
          Asuite
        </span>
        {!collapsed && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => searchInputRef.current?.focus()}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title={t('toolbar.search')}
            >
              <Search className="h-4 w-4" />
            </button>
            <button
              ref={bellRef}
              onClick={() => setShowNotifications(v => !v)}
              className="relative p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title={t('toolbar.notifications')}
            >
              <Bell className="h-4 w-4" />
              <NotificationBellBadge />
            </button>
            <button
              onClick={() => onShowNewMenuChange(!showNewMenu)}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title={t('common.new')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
        {collapsed && (
          <button
            onClick={() => searchInputRef.current?.focus()}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title={t('toolbar.search')}
          >
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search input */}
      {!collapsed && (
        <div className="px-2 mb-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={`Search (${navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}+K)`}
              className="w-full h-8 pl-7 pr-2 rounded-lg text-xs bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-sidebar-primary/30"
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

      {/* View toggle (Library/Trash) + Create menu */}
      {!collapsed && (
        <div className="px-3 pb-1 flex items-center justify-between">
          <div className="relative">
            <button
              onClick={() => setShowViewMenu(v => !v)}
              className="flex items-center gap-1.5 hover:bg-black/[0.04] dark:hover:bg-accent/50 rounded px-1 py-0.5 -mx-1 transition-colors"
            >
              {sidebarView === 'library' ? (
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {sidebarView === 'library' ? 'Library' : (t('content.trash') || 'Trash')}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {showViewMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowViewMenu(false)} />
                <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg py-1 w-44">
                  <button
                    onClick={() => { setShowViewMenu(false); onSidebarViewChange('library'); }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                      sidebarView === 'library' ? 'text-foreground bg-accent' : 'text-foreground hover:bg-accent'
                    )}
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    Document Library
                  </button>
                  <button
                    onClick={() => { setShowViewMenu(false); onSidebarViewChange('trash'); }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                      sidebarView === 'trash' ? 'text-foreground bg-accent' : 'text-foreground hover:bg-accent'
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('content.trash') || 'Trash'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* New item menu (positioned fixed) */}
      {showNewMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => onShowNewMenuChange(false)} />
          <div className="fixed z-20 bg-card border border-border rounded-lg shadow-lg py-1 w-36"
            style={{ top: '52px', left: collapsed ? '56px' : '170px' }}
          >
            <button
              onClick={() => { onShowNewMenuChange(false); onCreateDoc(); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              {t('content.newDoc')}
            </button>
            <button
              onClick={() => { onShowNewMenuChange(false); onCreateTable(); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Table2 className="h-4 w-4 text-muted-foreground" />
              {t('content.newTable')}
            </button>
            <button
              onClick={() => { onShowNewMenuChange(false); onCreatePresentation(); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Presentation className="h-4 w-4 text-muted-foreground" />
              {t('content.newPresentation') || 'New Presentation'}
            </button>
            <button
              onClick={() => { onShowNewMenuChange(false); onCreateDiagram(); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              {t('content.newDiagram') || 'New Diagram'}
            </button>
          </div>
        </>
      )}

      {/* Notification panel */}
      <NotificationPanel
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        anchorRect={bellRef.current?.getBoundingClientRect()}
      />

      {/* Scrollable tree content area */}
      <ScrollArea className="flex-1 min-h-0">
        <div className={cn('px-2 py-1', collapsed && 'hidden')}>
          {children}
        </div>
      </ScrollArea>

      {/* Bottom fixed section */}
      <div className="mt-auto shrink-0 border-t border-border/50">
        {/* Connect Agents CTA */}
        {!collapsed ? (
          <div className="px-2 pt-2 pb-1">
            <button
              onClick={() => router.push('/contacts')}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-sm font-semibold transition-colors"
              style={{
                backgroundColor: 'hsl(var(--sidebar-primary))',
                color: 'hsl(var(--sidebar-primary-foreground))',
              }}
            >
              <Link2 className="h-4 w-4" />
              {t('toolbar.connectAgents')}
            </button>
          </div>
        ) : (
          <div className="px-2 pt-2 pb-1 flex justify-center">
            <button
              onClick={() => router.push('/contacts')}
              className="flex items-center justify-center h-8 w-8 rounded-lg transition-colors"
              style={{
                backgroundColor: 'hsl(var(--sidebar-primary))',
                color: 'hsl(var(--sidebar-primary-foreground))',
              }}
              title={t('toolbar.connectAgents')}
            >
              <Link2 className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Settings + Collapse */}
        <div className="px-2 pb-3 flex flex-col gap-0.5">
          {/* Settings */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings(v => !v)}
              title={collapsed ? 'Settings' : undefined}
              className="flex items-center h-8 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors w-full overflow-hidden px-0"
            >
              <span className="w-8 flex items-center justify-center shrink-0">
                <Settings className="h-4 w-4 opacity-50" />
              </span>
              <span className={cn('whitespace-nowrap transition-opacity duration-200', collapsed ? 'opacity-0' : 'opacity-100')}>
                Settings
              </span>
            </button>

            {showSettings && (
              <div
                className="fixed bg-card border border-border rounded-lg shadow-lg z-50 py-1 min-w-[200px]"
                style={{
                  bottom: settingsRef.current ? `${window.innerHeight - settingsRef.current.getBoundingClientRect().top + 4}px` : 'auto',
                  left: collapsed
                    ? `${(settingsRef.current?.getBoundingClientRect().right ?? 0) + 4}px`
                    : `${settingsRef.current?.getBoundingClientRect().left ?? 0}px`,
                }}
              >
                {/* Theme toggle */}
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  {t('settings.theme') || 'Theme'}
                </div>
                {mounted && (
                  <div className="px-2 pb-1 flex gap-1">
                    <button
                      onClick={() => setTheme('light')}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded text-xs flex-1',
                        resolvedTheme === 'light' ? 'bg-sidebar-accent text-sidebar-primary font-medium' : 'text-muted-foreground hover:bg-accent/50'
                      )}
                    >
                      <Sun className="h-3.5 w-3.5" />
                      Light
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded text-xs flex-1',
                        resolvedTheme === 'dark' ? 'bg-sidebar-accent text-sidebar-primary font-medium' : 'text-muted-foreground hover:bg-accent/50'
                      )}
                    >
                      <Moon className="h-3.5 w-3.5" />
                      Dark
                    </button>
                  </div>
                )}

                <div className="border-t border-border my-1" />

                {/* Language selector */}
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  {t('settings.language') || 'Language'}
                </div>
                <div className="px-2 pb-1">
                  {(Object.entries(LOCALE_LABELS) as [Locale, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setLocale(key); setShowSettings(false); }}
                      className={cn(
                        'flex items-center gap-2 w-full px-2 py-1 rounded text-xs',
                        locale === key ? 'bg-sidebar-accent text-sidebar-primary font-medium' : 'text-muted-foreground hover:bg-accent/50'
                      )}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="border-t border-border my-1" />

                {/* Keyboard shortcuts */}
                <div className="px-2 pb-1">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="flex items-center gap-2 w-full px-2 py-1 rounded text-xs text-muted-foreground hover:bg-accent/50"
                  >
                    <span className="text-[10px]">?</span>
                    <span>{t('shortcuts.title') || 'Keyboard Shortcuts'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Collapse toggle */}
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center h-8 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors overflow-hidden px-0"
          >
            <span className="w-8 flex items-center justify-center shrink-0">
              {collapsed
                ? <ChevronRight className="h-4 w-4" />
                : <PanelLeftClose className="h-4 w-4 opacity-50" />
              }
            </span>
            <span className={cn('whitespace-nowrap transition-opacity duration-200', collapsed ? 'opacity-0' : 'opacity-100')}>
              Collapse
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
