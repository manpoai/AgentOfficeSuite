'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ArrowLeftToLine, ArrowRightToLine, ChevronRight, Undo2, Redo2, Save, X, Home, Clock, AtSign, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BottomSheet } from './BottomSheet';
import { useT } from '@/lib/i18n';

/**
 * Unified menu item definition — shared by desktop popover and mobile BottomSheet.
 * Define once per editor, used everywhere.
 */
export interface ContentMenuItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
  shortcut?: string;
  /** If true, this item only appears in the desktop popover (e.g. Full width toggle) */
  desktopOnly?: boolean;
  /** Custom render for desktop (e.g. toggle switches). If provided, replaces the default button. */
  desktopRender?: React.ReactNode;
}

export interface ContentTopBarProps {
  // Navigation
  breadcrumb?: { id: string; title: string }[];
  onNavigate?: (id: string) => void;
  onBack?: () => void;

  // Sidebar toggle
  docListVisible?: boolean;
  onToggleDocList?: () => void;

  // Title
  title: string;
  titlePlaceholder?: string;
  onTitleChange?: (title: string) => void;

  // Metadata line
  metaLine?: React.ReactNode;

  // Right-side desktop-only buttons (Share, History toggle, @ toggle, etc.)
  actions?: React.ReactNode;

  // Unified menu items — drives both desktop popover AND mobile BottomSheet
  menuItems?: ContentMenuItem[];

  // Mobile: standardized right-side actions (Figma: history + @ + •••)
  onHistory?: () => void;
  onComments?: () => void;

  // Save status indicator
  statusText?: string;
  statusError?: boolean;

  // Mobile home button
  onHome?: () => void;

  // Edit mode
  mode?: 'preview' | 'edit';
  onUndo?: () => void;
  onRedo?: () => void;
  onSave?: () => void;
  onCancelEdit?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function ContentTopBar({
  breadcrumb,
  onNavigate,
  onBack,
  docListVisible,
  onToggleDocList,
  title,
  titlePlaceholder = 'Untitled',
  onTitleChange,
  metaLine,
  actions,
  menuItems,
  onHistory,
  onComments,
  statusText,
  statusError,
  mode = 'preview',
  onUndo,
  onRedo,
  onHome,
  onSave,
  onCancelEdit,
  canUndo = false,
  canRedo = false,
}: ContentTopBarProps) {
  const { t } = useT();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showDesktopMenu, setShowDesktopMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const startEdit = () => {
    if (!onTitleChange) return;
    setEditValue(title);
    setIsEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange?.(trimmed);
    }
    setIsEditing(false);
  };

  const parentCrumbs = breadcrumb && breadcrumb.length > 1 ? breadcrumb.slice(0, -1) : [];
  const isEdit = mode === 'edit';
  const mobileItems = menuItems?.filter(item => !item.desktopOnly) || [];

  // Shared edit control buttons
  const editControls = isEdit ? (
    <>
      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
        title={t('toolbar.undo')}
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
        title={t('toolbar.redo')}
      >
        <Redo2 className="h-4 w-4" />
      </button>
      <button
        onClick={onSave}
        className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
        title={t('toolbar.save')}
      >
        <Save className="h-4 w-4" />
      </button>
    </>
  ) : null;

  return (
    <>
      <div className="flex-1 min-w-0 flex items-center pl-6 pr-4 h-16">
        {/* Sidebar toggle — desktop only */}
        {onToggleDocList && !isEdit && (
          <button
            onClick={onToggleDocList}
            className="hidden md:flex p-1.5 -ml-2 mr-2 text-black/40 dark:text-white/40 hover:text-foreground rounded transition-colors"
            title={docListVisible ? t('toolbar.collapseSidebar') : t('toolbar.expandSidebar')}
          >
            {docListVisible ? <ArrowLeftToLine className="h-4 w-4" /> : <ArrowRightToLine className="h-4 w-4" />}
          </button>
        )}

        {/* Back button — mobile only, preview mode */}
        {onBack && !isEdit && (
          <button onClick={onBack} className="md:hidden p-1.5 -ml-1 text-foreground">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* Home button — mobile only, preview mode */}
        {(onHome || onBack) && !isEdit && (
          <button onClick={onHome || onBack} className="md:hidden p-1.5 text-muted-foreground hover:text-foreground">
            <Home className="h-5 w-5" />
          </button>
        )}

        {/* Cancel button — mobile only, edit mode */}
        {isEdit && onCancelEdit && (
          <button
            onClick={onCancelEdit}
            className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground"
            title={t('toolbar.cancelEditing')}
          >
            <X className="h-5 w-5" />
          </button>
        )}

        {/* Breadcrumb + title + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-[18px] md:text-sm font-medium">
            {parentCrumbs.map((crumb, i) => (
              <span key={crumb.id} className="hidden md:flex items-center gap-1 min-w-0 shrink-0">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-black/50 dark:text-white/50 shrink-0" />}
                {onNavigate ? (
                  <button onClick={() => onNavigate(crumb.id)} className="text-black/50 dark:text-white/50 hover:text-foreground truncate text-sm">
                    {crumb.title}
                  </button>
                ) : (
                  <span className="text-black/50 dark:text-white/50 truncate text-sm">{crumb.title}</span>
                )}
              </span>
            ))}

            {parentCrumbs.length > 0 && (
              <ChevronRight className="hidden md:block h-3.5 w-3.5 text-black/50 dark:text-white/50 shrink-0" />
            )}

            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                className="text-sm font-medium bg-transparent text-foreground outline-none border-b border-sidebar-primary flex-1 min-w-[100px]"
                autoFocus
              />
            ) : onTitleChange ? (
              <button
                onClick={startEdit}
                onDoubleClick={startEdit}
                className="text-foreground font-medium truncate cursor-pointer hover:text-sidebar-primary transition-colors text-sm"
              >
                {title || titlePlaceholder}
              </button>
            ) : (
              <span className="text-foreground font-medium truncate text-sm">{title || titlePlaceholder}</span>
            )}
          </div>

          {metaLine && (
            <div className="mt-0.5 hidden md:block text-xs text-black/50 dark:text-white/50">
              {metaLine}
            </div>
          )}
        </div>

        {/* Right-side actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {statusText && (
            <span className={cn('text-[10px]', statusError ? 'text-destructive' : 'text-muted-foreground')}>
              {statusText}
            </span>
          )}
          {/* Edit mode controls — desktop only */}
          {isEdit && (
            <div className="hidden md:flex items-center gap-0.5">
              {editControls}
            </div>
          )}
          {/* Cancel button — desktop only, edit mode */}
          {isEdit && onCancelEdit && (
            <button
              onClick={onCancelEdit}
              className="hidden md:flex p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
              title={t('toolbar.cancelEditing')}
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/* ── Desktop: custom action buttons + unified More menu ── */}
          {!isEdit && (
            <div className="hidden md:flex items-center gap-0">
              {actions}
              {/* Desktop More popover — driven by menuItems */}
              {menuItems && menuItems.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowDesktopMenu(v => !v)}
                    className="p-2 text-black/70 dark:text-white/70 hover:text-foreground rounded transition-colors"
                    title={t('toolbar.more')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {showDesktopMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowDesktopMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-card border border-black/10 dark:border-border rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] py-1 w-52">
                        {menuItems.map((item, i) => (
                          <div key={i}>
                            {item.separator && <div className="border-t border-black/10 dark:border-border my-0.5" />}
                            {item.desktopRender ? (
                              item.desktopRender
                            ) : (
                              <button
                                onClick={() => {
                                  setShowDesktopMenu(false);
                                  item.onClick();
                                }}
                                className={cn(
                                  'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                                  item.danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent'
                                )}
                              >
                                <item.icon className="h-4 w-4 shrink-0" />
                                <span className="flex-1 text-left">{item.label}</span>
                                {item.shortcut && <span className="text-xs text-black/30 dark:text-white/30 ml-auto">{item.shortcut}</span>}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Mobile: unified top bar actions (Figma: history + @ + •••) ── */}
          {!isEdit && (onHistory || onComments || mobileItems.length > 0) && (
            <div className="flex md:hidden items-center gap-0">
              {onHistory && (
                <button onClick={onHistory} className="p-1.5 text-foreground" title={t('content.versionHistory')}>
                  <Clock className="h-6 w-6" />
                </button>
              )}
              {onComments && (
                <button onClick={onComments} className="p-1.5" title={t('content.comments')}>
                  <AtSign className="h-6 w-6 text-sidebar-primary" />
                </button>
              )}
              {mobileItems.length > 0 && (
                <button onClick={() => setShowMobileMenu(true)} className="p-1.5 text-foreground" title={t('toolbar.more')}>
                  <MoreHorizontal className="h-6 w-6" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile: More BottomSheet — same menuItems, mobile rendering */}
      {mobileItems.length > 0 && (
        <BottomSheet open={showMobileMenu} onClose={() => setShowMobileMenu(false)} showHandle>
          <div className="px-2 pb-2">
            {mobileItems.map((item, i) => (
              <div key={i}>
                {item.separator && <div className="border-t border-border my-1 mx-2" />}
                <button
                  onClick={() => {
                    setShowMobileMenu(false);
                    item.onClick();
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-base rounded-lg transition-colors min-h-[44px]',
                    item.danger
                      ? 'text-destructive active:bg-destructive/10'
                      : 'text-popover-foreground active:bg-accent',
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                </button>
              </div>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={() => setShowMobileMenu(false)}
                className="w-full flex items-center justify-center px-4 py-3 text-base font-medium text-muted-foreground rounded-lg active:bg-accent min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
