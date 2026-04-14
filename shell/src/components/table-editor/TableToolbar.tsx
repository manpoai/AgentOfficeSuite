'use client';

/**
 * TableToolbar — View-type-aware toolbar with field customization, filter, sort, group by, and row height panels.
 * Extracted from TableEditor.tsx during refactoring — no behavior changes.
 */

import React from 'react';
import {
  Plus, X, Eye, EyeOff, GripVertical, Lock, Info, Filter, ArrowUpDown,
  Settings, Group, AlignVerticalSpaceAround, CreditCard, Image,
} from 'lucide-react';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import * as br from '@/lib/api/tables';
import { getColIcon, getFilterOpsForType, READONLY_TYPES } from './types';
import { BottomSheet } from '@/components/shared/BottomSheet';

// Re-use the SortableFieldRow from TableEditor (must be imported or passed)
// We accept it as a render prop to avoid duplicating the hook-based component

export interface TableToolbarProps {
  // View state
  views: br.BRView[];
  activeViewId: string | null;
  displayCols: br.BRColumn[];
  sortedDisplayCols: br.BRColumn[];

  // Toolbar panel
  activeToolbarPanel: 'fields' | 'filter' | 'groupby' | 'sort' | 'rowheight' | 'kanban-group' | 'kanban-card' | 'gallery-card' | null;
  setActiveToolbarPanel: (panel: 'fields' | 'filter' | 'groupby' | 'sort' | 'rowheight' | 'kanban-group' | 'kanban-card' | 'gallery-card' | null) => void;
  toggleToolbarPanel: (panel: 'fields' | 'filter' | 'groupby' | 'sort' | 'rowheight' | 'kanban-group' | 'kanban-card' | 'gallery-card' | null) => void;

  // Field visibility
  hiddenCols: Set<string>;
  toggleColVisibility: (columnId: string, forceHide?: boolean) => void;

  // DnD
  dndSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>;
  handleFieldDragEnd: (event: DragEndEvent) => void;

  // Add field
  openAddField: () => void;
  setInsertColPosition: (pos: { afterColId: string } | null) => void;

  // Group by
  groupByCol: string | null;
  setGroupByCol: (col: string | null) => void;

  // Filters
  viewFilters: br.BRFilter[] | undefined;
  handleAddFilter: () => void;
  handleDeleteFilter: (filterId: string) => void;
  handleUpdateFilter: (filterId: string, updates: { fk_column_id?: string; comparison_op?: string; value?: string }) => void;
  newFilterCol: string;
  setNewFilterCol: (col: string) => void;
  newFilterOp: string;
  setNewFilterOp: (op: string) => void;
  newFilterVal: string;
  setNewFilterVal: (val: string) => void;

  // Sorts
  viewSorts: br.BRSort[] | undefined;
  handleAddSort: () => void;
  handleDeleteSort: (sortId: string) => void;
  handleUpdateSort: (sortId: string, updates: { fk_column_id?: string; direction?: string }) => void;
  newSortCol: string;
  setNewSortCol: (col: string) => void;
  newSortDir: 'asc' | 'desc';
  setNewSortDir: (dir: 'asc' | 'desc') => void;

  // Row height
  rowHeight: 'short' | 'medium' | 'tall' | 'extra';
  setRowHeight: (h: 'short' | 'medium' | 'tall' | 'extra') => void;

  // Actions
  handleAddRow: () => void;
  refreshMeta: () => void;

  // Mobile
  isMobile: boolean;

  // SortableFieldRow render prop
  SortableFieldRow: React.ComponentType<{
    id: string;
    children: (props: { dragHandleProps: Record<string, unknown> }) => React.ReactNode;
  }>;
}

export function TableToolbar(props: TableToolbarProps) {
  const { t } = useT();
  const {
    views, activeViewId, displayCols, sortedDisplayCols,
    activeToolbarPanel, setActiveToolbarPanel, toggleToolbarPanel,
    hiddenCols, toggleColVisibility,
    dndSensors, handleFieldDragEnd,
    openAddField, setInsertColPosition,
    groupByCol, setGroupByCol,
    viewFilters, handleAddFilter, handleDeleteFilter, handleUpdateFilter,
    newFilterCol, setNewFilterCol, newFilterOp, setNewFilterOp, newFilterVal, setNewFilterVal,
    viewSorts, handleAddSort, handleDeleteSort, handleUpdateSort,
    newSortCol, setNewSortCol, newSortDir, setNewSortDir,
    rowHeight, setRowHeight,
    handleAddRow, refreshMeta,
    isMobile,
    SortableFieldRow,
  } = props;

  const activeView = views.find(v => v.view_id === activeViewId);
  const viewType = activeView?.type || 3;
  const isForm = viewType === 1;
  const isGallery = viewType === 2;
  const isGrid = viewType === 3;
  const isKanban = viewType === 4;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-card/30 shrink-0 relative">
      {/* Add Record button — grid only */}
      {isGrid && (
        <button
          onClick={handleAddRow}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-sidebar-primary hover:bg-sidebar-primary/10 rounded transition-colors font-medium mr-1"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('dataTable.addRecord')}
        </button>
      )}

      {/* Customize Field — grid only */}
      {isGrid && (
        <div className="relative">
          <button
            onClick={() => toggleToolbarPanel('fields')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors',
              (hiddenCols.size > 0 || activeToolbarPanel === 'fields')
                ? 'text-sidebar-primary bg-sidebar-primary/8'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Settings className="h-3.5 w-3.5" />
            {t('dataTable.customizeField')}{hiddenCols.size > 0 ? ` (${hiddenCols.size})` : ''}
          </button>
          {activeToolbarPanel === 'fields' && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
              <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-72">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground">{t('dataTable.customizeField')}</span>
                    <Info className="h-3 w-3 text-muted-foreground/60" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { displayCols.filter(c => !c.primary_key).forEach(c => toggleColVisibility(c.column_id, false)); }}
                      className="text-[10px] text-sidebar-primary hover:opacity-80"
                    >
                      {t('dataTable.showAll')}
                    </button>
                    <button
                      onClick={() => { displayCols.filter(c => !c.primary_key).forEach(c => toggleColVisibility(c.column_id, true)); }}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      {t('dataTable.hideAll')}
                    </button>
                  </div>
                </div>
                <div className="py-1 max-h-72 overflow-y-auto">
                  <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleFieldDragEnd}>
                    <SortableContext items={sortedDisplayCols.map(c => c.column_id)} strategy={verticalListSortingStrategy}>
                      {sortedDisplayCols.map(col => {
                        const ColIcon = getColIcon(col.type);
                        const isHidden = hiddenCols.has(col.column_id);
                        return (
                          <SortableFieldRow key={col.column_id} id={col.column_id}>
                            {({ dragHandleProps }) => (
                              <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 group">
                                <span {...dragHandleProps} className="shrink-0 cursor-grab">
                                  <GripVertical className="h-3 w-3 text-muted-foreground/30" />
                                </span>
                                <ColIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                                <span className={cn('text-xs flex-1 truncate', isHidden ? 'text-muted-foreground' : 'text-foreground')}>
                                  {col.title}
                                </span>
                                {col.primary_key ? (
                                  <Lock className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                ) : (
                                  <button
                                    onClick={() => toggleColVisibility(col.column_id)}
                                    className={cn('p-0.5 rounded transition-colors shrink-0',
                                      isHidden ? 'text-muted-foreground/50 hover:text-foreground' : 'text-sidebar-primary hover:opacity-80'
                                    )}
                                  >
                                    {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                  </button>
                                )}
                              </div>
                            )}
                          </SortableFieldRow>
                        );
                      })}
                    </SortableContext>
                  </DndContext>
                </div>
                <div className="px-3 py-2 border-t border-border">
                  <button
                    onClick={() => { setActiveToolbarPanel(null); setInsertColPosition(null); openAddField(); }}
                    className="flex items-center gap-1.5 text-xs text-sidebar-primary hover:opacity-80"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t('dataTable.newField')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Kanban: Group by button */}
      {isKanban && (
        <div className="relative">
          <button
            onClick={() => toggleToolbarPanel('kanban-group')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors',
              activeToolbarPanel === 'kanban-group'
                ? 'text-sidebar-primary bg-sidebar-primary/8'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Group className="h-3.5 w-3.5" />
            {t('dataTable.groupBy')} {activeView?.fk_grp_col_id ? displayCols.find(c => c.column_id === activeView.fk_grp_col_id)?.title : ''}
          </button>
          {activeToolbarPanel === 'kanban-group' && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
              <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-64">
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">{t('dataTable.groupByFields')}</span>
                  <Info className="h-3 w-3 text-muted-foreground/60" />
                </div>
                <div className="p-3">
                  <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.selectGroupCondition')}</div>
                  <div className="space-y-0.5">
                    {displayCols.filter(c => c.type === 'SingleSelect').map(c => {
                      const ColIcon = getColIcon(c.type);
                      const isActive = activeView?.fk_grp_col_id === c.column_id;
                      return (
                        <button
                          key={c.column_id}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={async () => {
                            if (activeView) {
                              await br.updateKanbanConfig(activeView.view_id, { fk_grp_col_id: c.column_id });
                              refreshMeta();
                              setActiveToolbarPanel(null);
                            }
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors',
                            isActive ? 'text-sidebar-primary bg-sidebar-primary/10 font-medium' : 'text-foreground hover:bg-accent'
                          )}
                        >
                          <ColIcon className="h-3.5 w-3.5 shrink-0" />
                          {c.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Kanban: Customize Card */}
      {isKanban && (
        <div className="relative">
          <button
            onClick={() => toggleToolbarPanel('kanban-card')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors',
              activeToolbarPanel === 'kanban-card'
                ? 'text-sidebar-primary bg-sidebar-primary/8'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <CreditCard className="h-3.5 w-3.5" />
            {t('dataTable.customizeCard')}
          </button>
          {activeToolbarPanel === 'kanban-card' && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
              <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-72">
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">{t('dataTable.customizeCard')}</span>
                </div>
                <div className="p-3 space-y-3">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">{t('dataTable.coverField')}</div>
                    <select
                      value={activeView?.fk_cover_image_col_id || ''}
                      onChange={async e => { if (activeView) { await br.updateKanbanConfig(activeView.view_id, { fk_cover_image_col_id: e.target.value || undefined }); refreshMeta(); } }}
                      className="w-full bg-muted rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none"
                    >
                      <option value="">{t('dataTable.none')}</option>
                      {displayCols.filter(c => c.type === 'Attachment').map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">{t('dataTable.fields')}</div>
                    {displayCols.filter(c => !c.primary_key && c.title !== 'created_by').map(col => {
                      const ColIcon = getColIcon(col.type);
                      const isHidden = hiddenCols.has(col.column_id);
                      return (
                        <div key={col.column_id} className="flex items-center gap-2 py-1 hover:bg-accent/50 rounded px-1">
                          <ColIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                          <span className="text-xs flex-1 text-foreground truncate">{col.title}</span>
                          <button
                            onClick={() => toggleColVisibility(col.column_id)}
                            className={cn('p-0.5 shrink-0', isHidden ? 'text-muted-foreground/40' : 'text-sidebar-primary')}
                          >
                            {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Gallery: Customize Card */}
      {isGallery && (
        <div className="relative">
          <button
            onClick={() => toggleToolbarPanel('gallery-card')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors',
              activeToolbarPanel === 'gallery-card'
                ? 'text-sidebar-primary bg-sidebar-primary/8'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Image className="h-3.5 w-3.5" />
            {t('dataTable.customizeCard')}
          </button>
          {activeToolbarPanel === 'gallery-card' && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
              <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-72">
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">{t('dataTable.customizeCard')}</span>
                </div>
                <div className="p-3 space-y-3">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">{t('dataTable.coverField')}</div>
                    <select
                      value={activeView?.fk_cover_image_col_id || ''}
                      onChange={async e => { if (activeView) { await br.updateGalleryConfig(activeView.view_id, { fk_cover_image_col_id: e.target.value || undefined }); refreshMeta(); } }}
                      className="w-full bg-muted rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none"
                    >
                      <option value="">{t('dataTable.none')}</option>
                      {displayCols.filter(c => c.type === 'Attachment').map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">{t('dataTable.fields')}</div>
                    {displayCols.filter(c => !c.primary_key && c.title !== 'created_by').map(col => {
                      const ColIcon = getColIcon(col.type);
                      const isHidden = hiddenCols.has(col.column_id);
                      return (
                        <div key={col.column_id} className="flex items-center gap-2 py-1 hover:bg-accent/50 rounded px-1">
                          <ColIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                          <span className="text-xs flex-1 text-foreground truncate">{col.title}</span>
                          <button
                            onClick={() => toggleColVisibility(col.column_id)}
                            className={cn('p-0.5 shrink-0', isHidden ? 'text-muted-foreground/40' : 'text-sidebar-primary')}
                          >
                            {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Group By — grid only */}
      {isGrid && (
        <div className="relative">
          <button
            onClick={() => toggleToolbarPanel('groupby')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors',
              (groupByCol || activeToolbarPanel === 'groupby')
                ? 'text-sidebar-primary bg-sidebar-primary/8'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Group className="h-3.5 w-3.5" />
            {t('dataTable.groupBy')}{groupByCol ? ` (${groupByCol})` : ''}
          </button>
          {activeToolbarPanel === 'groupby' && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
              <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-64">
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">{t('dataTable.groupByFields')}</span>
                  <Info className="h-3 w-3 text-muted-foreground/60" />
                </div>
                <div className="p-3">
                  <select
                    value={groupByCol || ''}
                    onChange={e => setGroupByCol(e.target.value || null)}
                    className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground outline-none"
                  >
                    <option value="">{t('dataTable.chooseField')}</option>
                    {displayCols.filter(c => !c.primary_key && !READONLY_TYPES.has(c.type)).map(c => {
                      return (
                        <option key={c.column_id} value={c.title}>{c.title}</option>
                      );
                    })}
                  </select>
                  {groupByCol && (
                    <button
                      onClick={() => { setGroupByCol(null); }}
                      className="mt-2 flex items-center gap-1 text-xs text-destructive hover:opacity-80"
                    >
                      <X className="h-3 w-3" /> {t('dataTable.removeGrouping')}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Filter — grid, kanban, gallery */}
      {!isForm && (
        <div className="relative">
          <button
            onClick={() => toggleToolbarPanel('filter')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors',
              (viewFilters?.length || activeToolbarPanel === 'filter')
                ? 'text-sidebar-primary bg-sidebar-primary/8'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            {viewFilters?.length ? `${viewFilters.length} ${t('dataTable.filter')}` : t('dataTable.filter')}
          </button>
          {activeToolbarPanel === 'filter' && activeViewId && (() => {
            const filterContent = (
              <>
                <div className="p-3 space-y-2">
                  {viewFilters?.map(f => {
                    const col = displayCols.find(c => c.column_id === f.fk_column_id);
                    const filterOps = getFilterOpsForType(col?.type);
                    return (
                      <div key={f.filter_id} className="flex items-center gap-2">
                        <select
                          value={f.fk_column_id}
                          onChange={e => handleUpdateFilter(f.filter_id, { fk_column_id: e.target.value })}
                          className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0"
                        >
                          {displayCols.map(c => (
                            <option key={c.column_id} value={c.column_id}>{c.title}</option>
                          ))}
                        </select>
                        <select
                          value={f.comparison_op}
                          onChange={e => handleUpdateFilter(f.filter_id, { comparison_op: e.target.value })}
                          className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none w-24"
                        >
                          {filterOps.map(op => <option key={op.value} value={op.value}>{t(`dataTable.filterOps.${op.key}`)}</option>)}
                        </select>
                        {(col?.type === 'SingleSelect' || col?.type === 'MultiSelect') && col?.options?.length ? (
                          <select
                            value={f.value || ''}
                            onChange={e => handleUpdateFilter(f.filter_id, { value: e.target.value })}
                            className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0"
                          >
                            <option value="">{t('dataTable.valuePlaceholder')}</option>
                            {col.options.map(opt => <option key={opt.title} value={opt.title}>{opt.title}</option>)}
                          </select>
                        ) : (f.comparison_op === 'is' || f.comparison_op === 'isnot' || f.comparison_op === 'checked' || f.comparison_op === 'notchecked') ? (
                          <span className="flex-1" />
                        ) : (
                          <input
                            defaultValue={f.value}
                            onBlur={e => { if (e.target.value !== f.value) handleUpdateFilter(f.filter_id, { value: e.target.value }); }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0"
                          />
                        )}
                        <button onClick={() => handleDeleteFilter(f.filter_id)} className="p-1 text-muted-foreground hover:text-destructive shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2">
                    <select value={newFilterCol} onChange={e => setNewFilterCol(e.target.value)} className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0">
                      <option value="">{t('dataTable.fieldPlaceholder')}</option>
                      {displayCols.map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                    <select value={newFilterOp} onChange={e => setNewFilterOp(e.target.value)} className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none w-24">
                      {getFilterOpsForType(displayCols.find(c => c.column_id === newFilterCol)?.type).map(op => <option key={op.value} value={op.value}>{t(`dataTable.filterOps.${op.key}`)}</option>)}
                    </select>
                    {(() => {
                      const selCol = displayCols.find(c => c.column_id === newFilterCol);
                      if ((selCol?.type === 'SingleSelect' || selCol?.type === 'MultiSelect') && selCol?.options?.length) {
                        return (
                          <select value={newFilterVal} onChange={e => setNewFilterVal(e.target.value)} className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0">
                            <option value="">{t('dataTable.valuePlaceholder')}</option>
                            {selCol.options.map(opt => <option key={opt.title} value={opt.title}>{opt.title}</option>)}
                          </select>
                        );
                      }
                      if (newFilterOp === 'is' || newFilterOp === 'isnot' || newFilterOp === 'checked' || newFilterOp === 'notchecked') return <span className="flex-1" />;
                      return (
                        <input
                          value={newFilterVal}
                          onChange={e => setNewFilterVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddFilter(); }}
                          placeholder={t('dataTable.valuePlaceholder')}
                          className="bg-muted rounded px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none flex-1 min-w-0"
                        />
                      );
                    })()}
                    <button onClick={handleAddFilter} disabled={!newFilterCol} className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 shrink-0">
                      <X className="h-3.5 w-3.5 rotate-45" />
                    </button>
                  </div>
                </div>
                <div className="px-3 py-2 border-t border-border">
                  <button
                    onClick={handleAddFilter}
                    disabled={!newFilterCol}
                    className="flex items-center gap-1.5 text-xs text-sidebar-primary hover:opacity-80 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t('dataTable.addCondition')}
                  </button>
                </div>
              </>
            );

            if (isMobile) {
              return (
                <BottomSheet
                  open={true}
                  onClose={() => setActiveToolbarPanel(null)}
                  title={t('dataTable.filterRecords')}
                  initialHeight="half"
                >
                  {filterContent}
                </BottomSheet>
              );
            }

            return (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-[420px]">
                  <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                    <span className="text-xs font-semibold text-foreground">{t('dataTable.filterRecords')}</span>
                    <Info className="h-3 w-3 text-muted-foreground/60" />
                  </div>
                  {filterContent}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Sort — grid, kanban, gallery */}
      {!isForm && (
        <div className="relative">
          <button
            onClick={() => toggleToolbarPanel('sort')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors',
              (viewSorts?.length || activeToolbarPanel === 'sort')
                ? 'text-sidebar-primary bg-sidebar-primary/8'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {viewSorts?.length ? `${viewSorts.length} ${t('dataTable.sort')}` : t('dataTable.sort')}
          </button>
          {activeToolbarPanel === 'sort' && activeViewId && (() => {
            const sortContent = (
              <div className="p-3 space-y-2">
                {viewSorts?.map(s => {
                  const col = displayCols.find(c => c.column_id === s.fk_column_id);
                  return (
                    <div key={s.sort_id} className="flex items-center gap-2">
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 cursor-grab" />
                      <select
                        value={s.fk_column_id}
                        onChange={e => handleUpdateSort(s.sort_id, { fk_column_id: e.target.value })}
                        className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0"
                      >
                        {displayCols.map(c => (
                          <option key={c.column_id} value={c.column_id}>{c.title}</option>
                        ))}
                      </select>
                      <div className="flex rounded overflow-hidden border border-border shrink-0">
                        <button
                          onClick={() => handleUpdateSort(s.sort_id, { direction: 'asc' })}
                          className={cn('px-2 py-1 text-xs transition-colors',
                            s.direction === 'asc' ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                          )}
                        >
                          A→Z
                        </button>
                        <button
                          onClick={() => handleUpdateSort(s.sort_id, { direction: 'desc' })}
                          className={cn('px-2 py-1 text-xs transition-colors border-l border-border',
                            s.direction === 'desc' ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                          )}
                        >
                          Z→A
                        </button>
                      </div>
                      <button onClick={() => handleDeleteSort(s.sort_id)} className="p-1 text-muted-foreground hover:text-destructive shrink-0">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2">
                  <select value={newSortCol} onChange={e => setNewSortCol(e.target.value)} className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1">
                    <option value="">{t('dataTable.chooseField')}</option>
                    {displayCols.map(c => (
                      <option key={c.column_id} value={c.column_id}>{c.title}</option>
                    ))}
                  </select>
                  <div className="flex rounded overflow-hidden border border-border shrink-0">
                    <button
                      onClick={() => setNewSortDir('asc')}
                      className={cn('px-2 py-1.5 text-xs transition-colors',
                        newSortDir === 'asc' ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                      )}
                    >
                      A→Z
                    </button>
                    <button
                      onClick={() => setNewSortDir('desc')}
                      className={cn('px-2 py-1.5 text-xs transition-colors border-l border-border',
                        newSortDir === 'desc' ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Z→A
                    </button>
                  </div>
                  <button onClick={handleAddSort} disabled={!newSortCol} className="p-1 text-muted-foreground hover:text-sidebar-primary disabled:opacity-30 shrink-0">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );

            if (isMobile) {
              return (
                <BottomSheet
                  open={true}
                  onClose={() => setActiveToolbarPanel(null)}
                  title={t('dataTable.sortByFields')}
                  initialHeight="half"
                >
                  {sortContent}
                </BottomSheet>
              );
            }

            return (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-80">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-foreground">{t('dataTable.sortByFields')}</span>
                      <Info className="h-3 w-3 text-muted-foreground/60" />
                    </div>
                  </div>
                  {sortContent}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Row Height — grid only */}
      {isGrid && (
        <div className="relative">
          <button
            onClick={() => toggleToolbarPanel('rowheight')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors',
              (rowHeight !== 'short' || activeToolbarPanel === 'rowheight')
                ? 'text-sidebar-primary bg-sidebar-primary/8'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <AlignVerticalSpaceAround className="h-3.5 w-3.5" />
            {t('dataTable.rowHeight')}
          </button>
          {activeToolbarPanel === 'rowheight' && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
              <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-44 py-1">
                {([
                  { key: 'short' as const, labelKey: 'dataTable.rowHeightShort', icon: '▤' },
                  { key: 'medium' as const, labelKey: 'dataTable.rowHeightMedium', icon: '▥' },
                  { key: 'tall' as const, labelKey: 'dataTable.rowHeightTall', icon: '▦' },
                  { key: 'extra' as const, labelKey: 'dataTable.rowHeightExtra', icon: '▧' },
                ]).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => { setRowHeight(opt.key); setActiveToolbarPanel(null); }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-accent transition-colors',
                      rowHeight === opt.key ? 'text-sidebar-primary font-medium' : 'text-foreground'
                    )}
                  >
                    <span className="text-sm leading-none opacity-60">{opt.icon}</span>
                    {t(opt.labelKey)}
                    {rowHeight === opt.key && <span className="ml-auto text-sidebar-primary">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Spacer to push right */}
      <div className="flex-1" />
    </div>
  );
}
