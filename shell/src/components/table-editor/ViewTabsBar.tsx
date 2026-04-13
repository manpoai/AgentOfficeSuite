'use client';

/**
 * ViewTabsBar — View tabs (grid/kanban/gallery/form/calendar) with DnD reordering, rename, duplicate, lock, delete.
 * Extracted from TableEditor.tsx during refactoring — no behavior changes.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Trash2, MoreHorizontal, Pencil, Lock, ArrowUp, Copy,
} from 'lucide-react';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT } from '@/lib/i18n';
import * as br from '@/lib/api/tables';
import { VIEW_TYPES, getViewIcon } from './types';

export interface ViewTabsBarProps {
  // View state
  views: br.BRView[];
  activeViewId: string | null;
  setActiveViewId: (id: string) => void;
  orderedViews: br.BRView[];
  setViewOrderIds: React.Dispatch<React.SetStateAction<string[] | null>>;
  displayCols: br.BRColumn[];

  // View editing
  editingViewTitle: string | null;
  setEditingViewTitle: (id: string | null) => void;
  viewTitleValue: string;
  setViewTitleValue: (val: string) => void;
  handleRenameView: (viewId: string) => void;
  handleDeleteView: (viewId: string) => void;

  // View menu
  viewMenu: string | null;
  setViewMenu: (id: string | null) => void;

  // View lock
  lockedViews: Set<string>;
  setLockedViews: React.Dispatch<React.SetStateAction<Set<string>>>;

  // Create view popup
  showCreateViewMenu: boolean;
  setShowCreateViewMenu: React.Dispatch<React.SetStateAction<boolean>>;
  createViewMenuPos: { top: number; left: number };
  setCreateViewMenuPos: (pos: { top: number; left: number }) => void;
  createViewBtnRef: React.RefObject<HTMLButtonElement | null>;

  // DnD
  dndSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>;
  handleViewDragEnd: (event: DragEndEvent) => void;

  // Table
  tableId: string;
  refreshMeta: () => void;
  setPage: (page: number) => void;

  // SortableViewTab component
  SortableViewTab: React.ComponentType<{ id: string; children: React.ReactNode }>;
}

export function ViewTabsBar(props: ViewTabsBarProps) {
  const { t } = useT();
  const {
    views, activeViewId, setActiveViewId, orderedViews, setViewOrderIds, displayCols,
    editingViewTitle, setEditingViewTitle, viewTitleValue, setViewTitleValue,
    handleRenameView, handleDeleteView,
    viewMenu, setViewMenu,
    lockedViews, setLockedViews,
    showCreateViewMenu, setShowCreateViewMenu, createViewMenuPos, setCreateViewMenuPos, createViewBtnRef,
    dndSensors, handleViewDragEnd,
    tableId, refreshMeta, setPage,
    SortableViewTab,
  } = props;

  return (
    <>
    <div className="flex items-center gap-0 px-2 border-b border-border bg-card/50 shrink-0 overflow-x-auto">
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleViewDragEnd}>
        <SortableContext items={orderedViews.map(v => v.view_id)} strategy={horizontalListSortingStrategy}>
      {orderedViews.map(v => (
        <SortableViewTab key={v.view_id} id={v.view_id}>
        <div className="relative flex items-center">
          {editingViewTitle === v.view_id ? (
            <input
              value={viewTitleValue}
              onChange={e => setViewTitleValue(e.target.value)}
              onBlur={() => handleRenameView(v.view_id)}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameView(v.view_id); if (e.key === 'Escape') setEditingViewTitle(null); }}
              onPointerDown={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              className="px-2 py-1 text-xs bg-transparent text-foreground outline-none border-b border-sidebar-primary"
              autoFocus
            />
          ) : (
            <button
              onClick={() => { setActiveViewId(v.view_id); setPage(1); }}
              onDoubleClick={() => { if (!v.is_default) { setEditingViewTitle(v.view_id); setViewTitleValue(v.title); } }}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap transition-colors border-b-2',
                activeViewId === v.view_id
                  ? 'border-sidebar-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {(() => { const VIcon = getViewIcon(v.type); return <VIcon className="h-3 w-3" />; })()}
              {lockedViews.has(v.view_id) && <Lock className="h-2.5 w-2.5 opacity-50" />}
              {v.title}
            </button>
          )}
          {activeViewId === v.view_id && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMenu(viewMenu === v.view_id ? null : v.view_id);
                }}
                className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded"
                data-view-menu-btn={v.view_id}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {viewMenu === v.view_id && (() => {
                // Use fixed positioning to escape overflow:auto parent
                const btn = document.querySelector(`[data-view-menu-btn="${v.view_id}"]`);
                const rect = btn?.getBoundingClientRect();
                const top = rect ? rect.bottom + 4 : 0;
                const left = rect ? rect.left : 0;
                return (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setViewMenu(null)} />
                  <div className="fixed z-40 bg-card border border-border rounded-lg shadow-xl py-1 w-44" style={{ top: `${top}px`, left: `${left}px` }}>
                    <button
                      onClick={() => {
                        setViewMenu(null);
                        // Move this view to first position
                        setViewOrderIds(prev => {
                          const ids = prev || orderedViews.map(vv => vv.view_id);
                          const idx = ids.indexOf(v.view_id);
                          if (idx > 0) {
                            const next = [...ids];
                            next.splice(idx, 1);
                            next.unshift(v.view_id);
                            return next;
                          }
                          return ids;
                        });
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1 text-xs text-foreground hover:bg-accent"
                    >
                      <ArrowUp className="h-3 w-3" /> {t('dataTable.setAsFirstTab')}
                    </button>
                    <div className="border-t border-border my-1" />
                    <button
                      onClick={() => { setViewMenu(null); setEditingViewTitle(v.view_id); setViewTitleValue(v.title); }}
                      className="w-full flex items-center gap-2 px-3 py-1 text-xs text-foreground hover:bg-accent"
                    >
                      <Pencil className="h-3 w-3" /> {t('dataTable.renameView')}
                    </button>
                    <button
                      onClick={async () => {
                        setViewMenu(null);
                        try {
                          const copyTitle = `${v.title} (copy)`;
                          const newView = await br.createView(tableId, copyTitle, VIEW_TYPES.find(vt => vt.typeNum === v.type)?.type || 'grid');
                          refreshMeta();
                          setActiveViewId(newView.view_id);
                        } catch (e) { showError(t('errors.duplicateViewFailed'), e); }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1 text-xs text-foreground hover:bg-accent"
                    >
                      <Copy className="h-3 w-3" /> {t('dataTable.duplicateView')}
                    </button>
                    <button
                      onClick={() => {
                        setViewMenu(null);
                        setLockedViews(prev => {
                          const next = new Set(prev);
                          if (next.has(v.view_id)) next.delete(v.view_id);
                          else next.add(v.view_id);
                          return next;
                        });
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1 text-xs text-foreground hover:bg-accent"
                    >
                      <Lock className="h-3 w-3" /> {lockedViews.has(v.view_id) ? t('dataTable.unlockView') : t('dataTable.lockView')}
                    </button>
                    <div className="border-t border-border my-1" />
                    <button
                      onClick={() => handleDeleteView(v.view_id)}
                      className="w-full flex items-center gap-2 px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3 w-3" /> {t('dataTable.deleteView')}
                    </button>
                  </div>
                </>
                );
              })()}
            </div>
          )}
        </div>
        </SortableViewTab>
      ))}
        </SortableContext>
      </DndContext>
      {/* Create view — popup menu */}
      <div className="relative ml-1 shrink-0">
        <button
          ref={createViewBtnRef}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setCreateViewMenuPos({ top: rect.bottom + 4, left: rect.left });
            setShowCreateViewMenu(prev => !prev);
          }}
          className="p-1 text-muted-foreground hover:text-foreground"
          title={t('dataTable.addView')}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    {/* Create view popup — rendered via portal to escape all overflow/stacking contexts */}
    {showCreateViewMenu && createPortal(
      <>
        <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setShowCreateViewMenu(false)} />
        <div
          className="bg-card border border-border rounded-lg shadow-xl py-1 w-36"
          style={{ position: 'fixed', zIndex: 9999, top: `${createViewMenuPos.top}px`, left: `${createViewMenuPos.left}px` }}
        >
          {VIEW_TYPES.map(vt => {
            const VTIcon = vt.icon;
            return (
              <button
                key={vt.type}
                onClick={async () => {
                  setShowCreateViewMenu(false);
                  try {
                    const existingCount = views.filter(v => v.type === vt.typeNum).length;
                    const defaultName = `${t(`dataTable.viewTypes.${vt.key}`)}${t('dataTable.viewSuffix')}${existingCount > 0 ? ` ${existingCount + 1}` : ''}`;
                    const newView = await br.createView(tableId, defaultName, vt.type);
                    if (vt.type === 'kanban') {
                      const selectCol = displayCols.find(c => c.type === 'SingleSelect');
                      if (selectCol) {
                        await br.updateKanbanConfig(newView.view_id, { fk_grp_col_id: selectCol.column_id });
                      }
                    }
                    refreshMeta();
                    setActiveViewId(newView.view_id);
                  } catch (e) { showError(t('errors.createViewFailed'), e); }
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
              >
                <VTIcon className="h-3 w-3" /> {t(`dataTable.viewTypes.${vt.key}`)}
              </button>
            );
          })}
        </div>
      </>,
      document.body
    )}
    </>
  );
}
