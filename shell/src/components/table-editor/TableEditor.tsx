'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
// @ts-ignore - react-dom types not installed but module exists
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Plus, Trash2, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown,
  ArrowLeft, Table2, MoreHorizontal, Type, Hash, Calendar, CheckSquare,
  Link, Mail, AlignLeft, Pencil, Star, Phone, Clock, DollarSign,
  Percent, List, Tags, Braces, Paperclip, User, Sigma, Link2, Search, GitBranch,
  LayoutGrid, Filter, ArrowUpDown, ChevronDown, Columns, GalleryHorizontalEnd,
  FileText, CalendarDays, Expand, ArrowLeftToLine, ArrowRightToLine,
  Download, Upload, Eye, EyeOff, SlidersHorizontal, Lock,
  Copy, ArrowLeftFromLine, ArrowRightFromLine, Snowflake, Group, AlignVerticalSpaceAround,
  Settings, Info, GripVertical, ToggleLeft, ToggleRight, ArrowUpNarrowWide,
  CreditCard, Image, MessageSquare,
} from 'lucide-react';
import { DndContext, closestCenter, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import * as nc from '@/lib/api/nocodb';
import * as gw from '@/lib/api/gateway';
import { RowDetailPanel } from './RowDetailPanel';
import { Comments } from '@/components/comments/Comments';
import { LinkRecordPicker } from './LinkRecordPicker';

// ── Column type config ──

interface ColTypeDef {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'text' | 'number' | 'datetime' | 'select' | 'relation' | 'other';
}

const COLUMN_TYPES: ColTypeDef[] = [
  // Text
  { value: 'SingleLineText', label: '单行文本', icon: Type, group: 'text' },
  { value: 'LongText', label: '长文本', icon: AlignLeft, group: 'text' },
  { value: 'Email', label: '邮箱', icon: Mail, group: 'text' },
  { value: 'URL', label: '网址', icon: Link, group: 'text' },
  { value: 'PhoneNumber', label: '电话号码', icon: Phone, group: 'text' },
  // Number
  { value: 'Number', label: '数字', icon: Hash, group: 'number' },
  { value: 'Rating', label: '评分', icon: Star, group: 'number' },
  { value: 'AutoNumber', label: '自增编号', icon: Hash, group: 'number' },
  // Date & Time
  { value: 'Date', label: '日期', icon: Calendar, group: 'datetime' },
  { value: 'DateTime', label: '日期时间', icon: Calendar, group: 'datetime' },
  { value: 'CreatedTime', label: '创建时间', icon: Clock, group: 'datetime' },
  { value: 'LastModifiedTime', label: '最后修改时间', icon: Clock, group: 'datetime' },
  // Selection
  { value: 'Checkbox', label: '复选框', icon: CheckSquare, group: 'select' },
  { value: 'SingleSelect', label: '单选', icon: List, group: 'select' },
  { value: 'MultiSelect', label: '多选', icon: Tags, group: 'select' },
  // Relation & Computed
  { value: 'Links', label: '关联', icon: Link2, group: 'relation' },
  { value: 'Lookup', label: '查找', icon: Search, group: 'relation' },
  { value: 'Rollup', label: '汇总', icon: Sigma, group: 'relation' },
  { value: 'Formula', label: '公式', icon: GitBranch, group: 'relation' },
  // Other
  { value: 'Attachment', label: '附件', icon: Paperclip, group: 'other' },
  { value: 'JSON', label: 'JSON', icon: Braces, group: 'other' },
  { value: 'User', label: '用户', icon: User, group: 'other' },
  // CreatedBy / LastModifiedBy not supported in NocoDB v0.202 — omitted
];

const GROUP_LABELS: Record<string, string> = {
  text: '文本', number: '数字', datetime: '日期时间', select: '选择', relation: '关联与计算', other: '其他',
};

function getColIcon(uidt: string) {
  return COLUMN_TYPES.find(c => c.value === uidt)?.icon || Type;
}

// ── Select option colors ──

const SELECT_COLORS = [
  '#d4e5ff', '#d1f0e0', '#fde2cc', '#fdd8d8', '#e8d5f5',
  '#d5e8f5', '#fff3bf', '#f0d5e8', '#d5f5e8', '#e8e8d5',
];

function getOptionColor(color?: string, idx?: number) {
  if (color) return color;
  return SELECT_COLORS[(idx || 0) % SELECT_COLORS.length];
}

// ── Read-only column types ──
const READONLY_TYPES = new Set(['ID', 'AutoNumber', 'CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'Formula', 'Rollup', 'Lookup', 'Count', 'Links']);

/** Resolve NocoDB attachment path to a proxied URL */
function ncAttachmentUrl(a: { signedPath?: string; path?: string }): string {
  const p = a.signedPath || a.path || '';
  if (!p) return '';
  // Already a full URL
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  // Already proxied
  if (p.startsWith('/api/')) return p;
  // NocoDB relative path — proxy through gateway
  return `/api/gateway/data/download${p.startsWith('/') ? '' : '/'}${p}`;
}

// ── Filter operators ──
const FILTER_OPS = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'like', label: '包含' },
  { value: 'nlike', label: '不包含' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'is', label: '为空' },
  { value: 'isnot', label: '不为空' },
];

// ── View type config ──
const VIEW_TYPES = [
  { type: 'grid', typeNum: 3, label: '表格', icon: LayoutGrid },
  { type: 'kanban', typeNum: 4, label: '看板', icon: Columns },
  { type: 'gallery', typeNum: 2, label: '画廊', icon: GalleryHorizontalEnd },
  { type: 'form', typeNum: 1, label: '表单', icon: FileText },
] as const;

function getViewIcon(typeNum: number) {
  return VIEW_TYPES.find(v => v.typeNum === typeNum)?.icon || LayoutGrid;
}

// ── Sortable wrapper components (must be top-level for hooks) ──

function SortableFieldRow({ id, children }: { id: string; children: (props: { dragHandleProps: Record<string, unknown> }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({ dragHandleProps: listeners as Record<string, unknown> })}
    </div>
  );
}

function SortableViewTab({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = {
    // Only translate, no scale — prevents compression/stretching
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

function SortableColumnHeader({ id, children, className, style: extraStyle, isOver, overSide }: { id: string; children: React.ReactNode; className?: string; style?: React.CSSProperties; isOver?: boolean; overSide?: 'left' | 'right' }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id });
  const thRef = React.useRef<HTMLTableCellElement>(null);
  const setRefs = React.useCallback((node: HTMLTableCellElement | null) => {
    setNodeRef(node);
    (thRef as React.MutableRefObject<HTMLTableCellElement | null>).current = node;
  }, [setNodeRef]);
  // Get table height for indicator line
  const tableHeight = (isOver && thRef.current) ? (thRef.current.closest('table')?.offsetHeight || 200) : 0;
  const style: React.CSSProperties = {
    ...extraStyle,
    opacity: isDragging ? 0.3 : 1,
    // Only set position:relative if not already sticky (from extraStyle.left being set)
    ...(!extraStyle?.left ? { position: 'relative' as const } : {}),
  };
  return (
    <th ref={setRefs} style={style} className={className} {...attributes} {...listeners}>
      {children}
      {/* Drop target vertical line indicator — constrained to table height */}
      {isOver && overSide === 'left' && (
        <div style={{ position: 'absolute', left: -1, top: 0, width: 2, background: '#3b82f6', zIndex: 50, height: `${tableHeight}px` }} />
      )}
      {isOver && overSide === 'right' && (
        <div style={{ position: 'absolute', right: -1, top: 0, width: 2, background: '#3b82f6', zIndex: 50, height: `${tableHeight}px` }} />
      )}
    </th>
  );
}

// ── Main component ──

interface TableEditorProps {
  tableId: string;
  onBack: () => void;
  onDeleted?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}

export function TableEditor({ tableId, onBack, onDeleted, docListVisible, onToggleDocList }: TableEditorProps) {
  const [page, setPage] = useState(1);
  const [editingCell, setEditingCell] = useState<{ rowId: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [colMenu, setColMenu] = useState<string | null>(null);
  const [editingColTitle, setEditingColTitle] = useState<string | null>(null);
  const [colTitleValue, setColTitleValue] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);
  const [editFieldColId, setEditFieldColId] = useState<string | null>(null); // column_id for edit mode
  const [showTypeSelector, setShowTypeSelector] = useState(false); // expand type list in Edit Field dialog
  const [numFormat, setNumFormat] = useState<{ decimals: number; thousands: boolean; prefix: string; suffix: string }>({ decimals: 0, thousands: false, prefix: '', suffix: '' });
  const [ratingMax, setRatingMax] = useState(5);
  const [ratingIcon, setRatingIcon] = useState('star');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [newColTitle, setNewColTitle] = useState('');
  const [newColType, setNewColType] = useState('SingleLineText');
  const [newColOptions, setNewColOptions] = useState('');
  const [newColOptionsList, setNewColOptionsList] = useState<string[]>([]);
  const [newColFormula, setNewColFormula] = useState('');
  const [newColRelTable, setNewColRelTable] = useState('');
  const [newColRelType, setNewColRelType] = useState('mm');
  const [newColRelMulti, setNewColRelMulti] = useState(true); // "支持选择多个" = mm; false = bt
  const [newColRelBidirectional, setNewColRelBidirectional] = useState(true); // add reverse column in related table
  const [newColRelCol, setNewColRelCol] = useState(''); // for lookup/rollup: relation column id
  const [newColLookupCol, setNewColLookupCol] = useState(''); // for lookup: field id in related table
  const [newColRollupCol, setNewColRollupCol] = useState(''); // for rollup: field id in related table
  const [newColRollupFn, setNewColRollupFn] = useState('sum');
  const [editingTableTitle, setEditingTableTitle] = useState(false);
  const [tableTitleValue, setTableTitleValue] = useState('');
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showTableComments, setShowTableComments] = useState(false);
  const [selectDropdown, setSelectDropdown] = useState<{ rowId: number; col: string; options: nc.NCSelectOption[]; multi: boolean } | null>(null);
  const [selectInput, setSelectInput] = useState('');
  // View state
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewMenu, setViewMenu] = useState<string | null>(null);
  const [editingViewTitle, setEditingViewTitle] = useState<string | null>(null);
  const [viewTitleValue, setViewTitleValue] = useState('');
  const [showCreateView, setShowCreateView] = useState(false);
  const [newViewTitle, setNewViewTitle] = useState('');
  const [newViewType, setNewViewType] = useState('grid');
  // Filter & Sort state
  const [newFilterCol, setNewFilterCol] = useState('');
  const [newFilterOp, setNewFilterOp] = useState('eq');
  const [newFilterVal, setNewFilterVal] = useState('');
  const [newSortCol, setNewSortCol] = useState('');
  const [newSortDir, setNewSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedRowIdx, setExpandedRowIdx] = useState<number | null>(null);
  const [expandWithComments, setExpandWithComments] = useState(false);
  // Link record picker state
  const [linkPicker, setLinkPicker] = useState<{ rowId: number; column: nc.NCColumn } | null>(null);
  // Bulk operations state
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkEditCol, setBulkEditCol] = useState('');
  const [bulkEditVal, setBulkEditVal] = useState('');
  // Date picker state
  const [datePicker, setDatePicker] = useState<{ rowId: number; col: string; colType: string; value: string } | null>(null);
  // Attachment upload state
  const [attachmentUploading, setAttachmentUploading] = useState<{ rowId: number; col: string } | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  // Toolbar panel state — single active panel
  const [activeToolbarPanel, setActiveToolbarPanel] = useState<'fields' | 'filter' | 'groupby' | 'sort' | 'rowheight' | 'kanban-group' | 'kanban-card' | 'gallery-card' | null>(null);
  const toggleToolbarPanel = (panel: typeof activeToolbarPanel) => {
    setActiveToolbarPanel(prev => prev === panel ? null : panel);
  };
  // Field management state
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  // CSV import state
  const [csvImportData, setCsvImportData] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [csvColMap, setCsvColMap] = useState<Record<number, string>>({}); // csvColIdx → tableColTitle
  const [csvImporting, setCsvImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  // Freeze columns state (persisted per table)
  const [frozenColCount, setFrozenColCountRaw] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`asuite-table-frozen-${tableId}`);
      return saved ? parseInt(saved, 10) : 1;
    }
    return 1;
  });
  const setFrozenColCount = useCallback((v: number | ((prev: number) => number)) => {
    setFrozenColCountRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      localStorage.setItem(`asuite-table-frozen-${tableId}`, String(next));
      return next;
    });
  }, [tableId]);
  // Group by state
  const [groupByCol, setGroupByCol] = useState<string | null>(null);
  // Row height state
  const [rowHeight, setRowHeight] = useState<'short' | 'medium' | 'tall' | 'extra'>('short');
  // View lock state
  const [lockedViews, setLockedViews] = useState<Set<string>>(new Set());
  // Insert column position tracking
  const [insertColPosition, setInsertColPosition] = useState<{ afterColId: string } | null>(null);
  // Create view popup
  const [showCreateViewMenu, setShowCreateViewMenu] = useState(false);
  const [createViewMenuPos, setCreateViewMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const createViewBtnRef = useRef<HTMLButtonElement>(null);
  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const colTitleRef = useRef<HTMLInputElement>(null);
  const newColRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const pageSize = 50;

  const sortParam = sortCol ? (sortDir === 'desc' ? `-${sortCol}` : sortCol) : undefined;

  const { data: meta } = useQuery({
    queryKey: ['nc-table-meta', tableId],
    queryFn: () => nc.describeTable(tableId),
  });

  // Reset activeViewId when tableId changes
  useEffect(() => {
    setActiveViewId(null);
  }, [tableId]);

  // Set active view to default when meta loads
  useEffect(() => {
    if (meta?.views?.length && !activeViewId) {
      const savedViewId = localStorage.getItem(`asuite-table-last-view-${tableId}`);
      const savedView = savedViewId ? meta.views.find(v => v.view_id === savedViewId) : null;
      const defaultView = savedView || meta.views.find(v => v.is_default) || meta.views[0];
      setActiveViewId(defaultView.view_id);
    }
  }, [meta?.views, tableId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save active view to localStorage when it changes
  useEffect(() => {
    if (activeViewId) {
      localStorage.setItem(`asuite-table-last-view-${tableId}`, activeViewId);
    }
  }, [activeViewId, tableId]);

  const views = meta?.views || [];

  const { data: rowsData, isLoading, isFetching } = useQuery({
    queryKey: ['nc-rows', tableId, activeViewId, page, sortParam],
    queryFn: () => activeViewId
      ? nc.queryRowsByView(tableId, activeViewId, { limit: pageSize, offset: (page - 1) * pageSize, sort: sortParam })
      : nc.queryRows(tableId, { limit: pageSize, offset: (page - 1) * pageSize, sort: sortParam }),
    enabled: !!meta,
    placeholderData: keepPreviousData,
  });

  // View filters
  const { data: viewFilters } = useQuery({
    queryKey: ['nc-view-filters', activeViewId],
    queryFn: () => nc.listFilters(activeViewId!),
    enabled: !!activeViewId,
  });

  // View sorts
  const { data: viewSorts } = useQuery({
    queryKey: ['nc-view-sorts', activeViewId],
    queryFn: () => nc.listSorts(activeViewId!),
    enabled: !!activeViewId,
  });

  // View columns (field visibility/width per view)
  const { data: viewColumns } = useQuery({
    queryKey: ['nc-view-columns', activeViewId],
    queryFn: () => nc.listViewColumns(activeViewId!),
    enabled: !!activeViewId,
  });

  // Sync hiddenCols and colWidths from view column settings
  useEffect(() => {
    if (!viewColumns) return;
    const hidden = new Set<string>();
    const widths: Record<string, number> = {};
    for (const vc of viewColumns) {
      if (!vc.show) hidden.add(vc.fk_column_id);
      if (vc.width) {
        const w = typeof vc.width === 'number' ? vc.width : parseInt(vc.width, 10);
        if (w > 0) widths[vc.fk_column_id] = w;
      }
    }
    setHiddenCols(hidden);
    setColWidths(widths);
  }, [viewColumns]);

  const refreshViewColumns = () => queryClient.invalidateQueries({ queryKey: ['nc-view-columns', activeViewId] });

  // Commented rows (for PK highlight)
  const { data: commentedRowsData } = useQuery({
    queryKey: ['commented-rows', tableId],
    queryFn: () => gw.listCommentedRows(tableId),
    enabled: !!tableId,
  });
  const commentedRowIds = useMemo(() => {
    const set = new Set<string>();
    if (commentedRowsData) {
      for (const r of commentedRowsData) set.add(String(r.row_id));
    }
    return set;
  }, [commentedRowsData]);

  // All tables (for Links creation)
  const { data: allTables } = useQuery({
    queryKey: ['nc-tables'],
    queryFn: nc.listTables,
    enabled: showAddCol,
  });

  // Related table meta (for Lookup/Rollup field picker)
  const relatedTableId = newColRelTable || (() => {
    // Find the related table from the selected relation column
    if (newColRelCol && meta?.columns) {
      const relCol = meta.columns.find(c => c.column_id === newColRelCol);
      return relCol?.relatedTableId || '';
    }
    return '';
  })();

  const { data: relatedMeta } = useQuery({
    queryKey: ['nc-table-meta', relatedTableId],
    queryFn: () => nc.describeTable(relatedTableId),
    enabled: !!relatedTableId && (newColType === 'Lookup' || newColType === 'Rollup'),
  });

  // Agents list (for User field picker in cells)
  const { data: agentsList } = useQuery({
    queryKey: ['agents-list'],
    queryFn: gw.listAgents,
    staleTime: 60000,
  });

  const displayCols = (meta?.columns || []).filter(c => c.title !== 'created_by');
  // Sort visible columns by view column order (if available)
  const visibleCols = displayCols.filter(c => !hiddenCols.has(c.column_id)).sort((a, b) => {
    // PK columns always come first
    if (a.primary_key && !b.primary_key) return -1;
    if (!a.primary_key && b.primary_key) return 1;
    if (!viewColumns) return 0;
    const aVc = viewColumns.find(vc => vc.fk_column_id === a.column_id);
    const bVc = viewColumns.find(vc => vc.fk_column_id === b.column_id);
    const aOrder = aVc?.order ?? 9999;
    const bOrder = bVc?.order ?? 9999;
    return aOrder - bOrder;
  });
  const editableCols = displayCols.filter(c => !c.primary_key && !READONLY_TYPES.has(c.type));
  const rows = rowsData?.list || [];
  const totalRows = rowsData?.pageInfo?.totalRows || 0;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['nc-rows', tableId] });
  const refreshMeta = () => queryClient.invalidateQueries({ queryKey: ['nc-table-meta', tableId] });
  const refreshFilters = () => queryClient.invalidateQueries({ queryKey: ['nc-view-filters', activeViewId] });
  const refreshSorts = () => queryClient.invalidateQueries({ queryKey: ['nc-view-sorts', activeViewId] });

  // ── Drag-and-drop setup ──
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Local view order state (no API persistence, just in-state)
  const [viewOrderIds, setViewOrderIds] = useState<string[] | null>(null);
  const orderedViews = useMemo(() => {
    if (!viewOrderIds) return views;
    const map = new Map(views.map(v => [v.view_id, v]));
    return viewOrderIds.map(id => map.get(id)).filter(Boolean) as typeof views;
  }, [views, viewOrderIds]);

  // Sorted displayCols for the field panel (by viewColumn order)
  const sortedDisplayCols = useMemo(() => {
    return [...displayCols].sort((a, b) => {
      // PK columns always first
      if (a.primary_key && !b.primary_key) return -1;
      if (!a.primary_key && b.primary_key) return 1;
      if (!viewColumns) return 0;
      const aVc = viewColumns.find((vc: { fk_column_id: string }) => vc.fk_column_id === a.column_id);
      const bVc = viewColumns.find((vc: { fk_column_id: string }) => vc.fk_column_id === b.column_id);
      const aOrder = aVc?.order ?? 9999;
      const bOrder = bVc?.order ?? 9999;
      return aOrder - bOrder;
    });
  }, [displayCols, viewColumns]);

  // Reset viewOrderIds when views list changes
  useEffect(() => {
    if (views.length > 0) {
      setViewOrderIds(views.map(v => v.view_id));
    }
  }, [views.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Column drag-over state for drop indicator ──
  const [colDragOver, setColDragOver] = useState<{ overId: string; side: 'left' | 'right' } | null>(null);
  const [colDragActiveId, setColDragActiveId] = useState<string | null>(null);

  // ── Drag-end handlers ──

  const handleFieldDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !activeViewId) return;
    const oldIndex = sortedDisplayCols.findIndex(c => c.column_id === active.id);
    const newIndex = sortedDisplayCols.findIndex(c => c.column_id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(sortedDisplayCols, oldIndex, newIndex);
    // Optimistically update the view columns cache so UI reflects new order instantly
    queryClient.setQueryData(['nc-view-columns', activeViewId], (old: nc.NCViewColumn[] | undefined) => {
      if (!old) return old;
      const reorderedIds = new Set(reordered.map(c => c.column_id));
      const preserved = old.filter(vc => !reorderedIds.has(vc.fk_column_id));
      const updated = reordered.map((col, idx) => {
        const existing = old.find(vc => vc.fk_column_id === col.column_id);
        return existing ? { ...existing, order: idx + 1 } : { fk_column_id: col.column_id, show: true, order: idx + 1 };
      });
      return [...preserved, ...updated];
    });
    // Persist to backend
    const promises = reordered.map((col, idx) =>
      nc.updateViewColumn(activeViewId, col.column_id, { order: idx + 1 })
    );
    await Promise.all(promises).catch(() => {});
    refreshViewColumns();
  }, [sortedDisplayCols, activeViewId, refreshViewColumns, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleViewDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setViewOrderIds(prev => {
      const ids = prev || views.map(v => v.view_id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(ids, oldIndex, newIndex);
    });
  }, [views]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleColumnDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) { setColDragOver(null); return; }
    const activeIdx = visibleCols.findIndex(c => c.column_id === active.id);
    const overIdx = visibleCols.findIndex(c => c.column_id === over.id);
    if (activeIdx < 0 || overIdx < 0) { setColDragOver(null); return; }
    setColDragOver({ overId: String(over.id), side: activeIdx < overIdx ? 'right' : 'left' });
  }, [visibleCols]);

  const handleColumnDragEnd = useCallback(async (event: DragEndEvent) => {
    setColDragOver(null);
    setColDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !activeViewId) return;
    // Filter out PK columns from reordering
    const draggableCols = visibleCols.filter(c => !c.primary_key);
    const oldIndex = draggableCols.findIndex(c => c.column_id === active.id);
    const newIndex = draggableCols.findIndex(c => c.column_id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(draggableCols, oldIndex, newIndex);
    // Optimistically update cache — preserve PK and other non-draggable column entries
    queryClient.setQueryData(['nc-view-columns', activeViewId], (old: nc.NCViewColumn[] | undefined) => {
      if (!old) return old;
      const reorderedIds = new Set(reordered.map(c => c.column_id));
      const preserved = old.filter(vc => !reorderedIds.has(vc.fk_column_id));
      const updated = reordered.map((col, idx) => {
        const existing = old.find(vc => vc.fk_column_id === col.column_id);
        return existing ? { ...existing, order: idx + 1 } : { fk_column_id: col.column_id, show: true, order: idx + 1 };
      });
      return [...preserved, ...updated];
    });
    // PK columns keep order 0, draggable columns start at 1
    const promises = reordered.map((col, idx) =>
      nc.updateViewColumn(activeViewId, col.column_id, { order: idx + 1 })
    );
    await Promise.all(promises).catch(() => {});
    refreshViewColumns();
  }, [visibleCols, activeViewId, refreshViewColumns, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── View handlers ──
  const handleCreateView = async () => {
    if (!newViewTitle.trim()) return;
    try {
      const view = await nc.createView(tableId, newViewTitle.trim(), newViewType);
      setNewViewTitle('');
      setNewViewType('grid');
      setShowCreateView(false);
      refreshMeta();
      setActiveViewId(view.view_id);
    } catch {}
  };

  const handleRenameView = async (viewId: string) => {
    if (!viewTitleValue.trim()) { setEditingViewTitle(null); return; }
    try {
      await nc.renameView(viewId, viewTitleValue.trim());
      refreshMeta();
    } catch {}
    setEditingViewTitle(null);
  };

  const handleDeleteView = async (viewId: string) => {
    try {
      await nc.deleteView(viewId);
      refreshMeta();
      if (activeViewId === viewId) setActiveViewId(null);
    } catch {}
    setViewMenu(null);
  };

  const handleAddFilter = async () => {
    if (!activeViewId || !newFilterCol) return;
    try {
      await nc.createFilter(activeViewId, { fk_column_id: newFilterCol, comparison_op: newFilterOp, value: newFilterVal });
      refreshFilters();
      refresh();
      setNewFilterCol('');
      setNewFilterVal('');
    } catch {}
  };

  const handleDeleteFilter = async (filterId: string) => {
    try {
      await nc.deleteFilter(filterId);
      refreshFilters();
      refresh();
    } catch {}
  };

  const handleAddSort = async () => {
    if (!activeViewId || !newSortCol) return;
    try {
      await nc.createSort(activeViewId, { fk_column_id: newSortCol, direction: newSortDir });
      refreshSorts();
      refresh();
      setNewSortCol('');
    } catch {}
  };

  const handleDeleteSort = async (sortId: string) => {
    try {
      await nc.deleteSort(sortId);
      refreshSorts();
      refresh();
    } catch {}
  };

  // ── Sort ──
  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  // ── Cell editing ──
  const startEdit = useCallback((rowId: number, col: string, currentValue: unknown, colType: string) => {
    if (READONLY_TYPES.has(colType) || colType === 'Checkbox') return;
    setEditingCell({ rowId, col });
    // Format date values for HTML date/datetime-local inputs
    if ((colType === 'Date' || colType === 'DateTime') && currentValue) {
      const d = new Date(String(currentValue));
      if (!isNaN(d.getTime())) {
        if (colType === 'Date') {
          setEditValue(d.toISOString().slice(0, 10)); // YYYY-MM-DD
        } else {
          setEditValue(d.toISOString().slice(0, 16)); // YYYY-MM-DDTHH:MM
        }
        return;
      }
    }
    setEditValue(currentValue == null ? '' : String(currentValue));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingCell) return;
    const { rowId, col } = editingCell;
    const newVal = editValue;
    setEditingCell(null);
    // Optimistic update: patch the cached data immediately
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      if (!old || typeof old !== 'object' || !('list' in (old as Record<string, unknown>))) return old;
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown };
      return {
        ...data,
        list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: newVal } : r),
      };
    });
    try {
      await nc.updateRow(tableId, rowId, { [col]: newVal });
      refresh(); // background refresh to sync server state
    } catch (e) {
      console.error('Update failed:', e);
      refresh(); // revert on error
    }
  }, [editingCell, editValue, tableId, queryClient]);

  const toggleCheckbox = async (rowId: number, col: string, current: unknown) => {
    try {
      const newVal = !current;
      // Optimistic update
      queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
        const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
        if (!data) return old;
        return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: newVal } : r) };
      });
      // NocoDB/PostgreSQL requires boolean values, not integers (1/0 causes type error)
      await nc.updateRow(tableId, rowId, { [col]: newVal });
      refresh();
    } catch (e) {
      console.error('Toggle failed:', e);
    }
  };

  const setSelectValue = async (rowId: number, col: string, value: string) => {
    try {
      await nc.updateRow(tableId, rowId, { [col]: value });
      refresh();
      refreshMeta(); // pick up auto-created options
    } catch (e) {
      console.error('Set select failed:', e);
    }
    setSelectDropdown(null);
  };

  const toggleMultiSelect = async (rowId: number, col: string, current: unknown, option: string) => {
    const currentStr = current ? String(current) : '';
    const currentItems = currentStr ? currentStr.split(',').map(s => s.trim()) : [];
    const newItems = currentItems.includes(option)
      ? currentItems.filter(i => i !== option)
      : [...currentItems, option];
    try {
      await nc.updateRow(tableId, rowId, { [col]: newItems.join(',') });
      refresh();
      refreshMeta(); // pick up auto-created options
    } catch (e) {
      console.error('Toggle multi-select failed:', e);
    }
  };

  const setRating = async (rowId: number, col: string, value: number) => {
    try {
      // Optimistic update
      queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
        const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
        if (!data) return old;
        return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: value } : r) };
      });
      await nc.updateRow(tableId, rowId, { [col]: value });
      refresh();
    } catch (e) {
      console.error('Set rating failed:', e);
      refresh();
    }
  };

  // Attachment upload
  const handleAttachmentUpload = async (rowId: number, colTitle: string, files: FileList) => {
    if (files.length === 0) return;
    setAttachmentUploading({ rowId, col: colTitle });
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('files', f));
      const uploadRes = await fetch('/api/gateway/data/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      const uploaded = await uploadRes.json(); // array of { path, title, mimetype, size }
      // Get existing attachments (NocoDB stores as array, not JSON string)
      const row = rows.find(r => (r.Id as number) === rowId);
      let existing: unknown[] = [];
      if (row?.[colTitle]) {
        if (Array.isArray(row[colTitle])) {
          existing = row[colTitle] as unknown[];
        } else {
          try { existing = JSON.parse(String(row[colTitle])); } catch {}
        }
      }
      const merged = [...existing, ...uploaded];
      // NocoDB expects array, not JSON string for Attachment columns
      await nc.updateRow(tableId, rowId, { [colTitle]: merged });
      refresh();
    } catch (e) {
      console.error('Attachment upload failed:', e);
    } finally {
      setAttachmentUploading(null);
    }
  };

  // User field picker state
  const [userPicker, setUserPicker] = useState<{ rowId: number; col: string } | null>(null);
  const [userPickerSearch, setUserPickerSearch] = useState('');

  // Focus edit input
  useEffect(() => {
    if (editingCell && editInputRef.current) editInputRef.current.focus();
  }, [editingCell]);

  // ── Row operations ──
  const handleAddRow = async () => {
    try {
      await nc.insertRow(tableId, {});
      refresh();
    } catch (e) {
      console.error('Insert failed:', e);
    }
  };

  const handleDeleteRow = async (rowId: number) => {
    try {
      await nc.deleteRow(tableId, rowId);
      refresh();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  // ── Column operations ──
  const resetAddColState = () => {
    setNewColTitle('');
    setNewColType('SingleLineText');
    setNewColOptions('');
    setNewColOptionsList([]);
    setNewColFormula('');
    setNewColRelTable('');
    setNewColRelType('mm');
    setNewColRelMulti(true);
    setNewColRelBidirectional(true);
    setNewColRelCol('');
    setNewColLookupCol('');
    setNewColRollupCol('');
    setNewColRollupFn('sum');
    setNumFormat({ decimals: 0, thousands: false, prefix: '', suffix: '' });
    setRatingMax(5);
    setRatingIcon('star');
    setDateFormat('YYYY-MM-DD');
    setShowAddCol(false);
    setShowTypeSelector(false);
    // Note: do NOT clear insertColPosition here — handleInsertColumn sets it before calling openAddField
  };

  const handleAddColumn = async () => {
    if (!newColTitle.trim()) return;
    try {
      const opts: Record<string, unknown> = {};
      if ((newColType === 'SingleSelect' || newColType === 'MultiSelect') && newColOptionsList.length > 0) {
        opts.options = newColOptionsList.filter(s => s.trim()).map((s, i) => ({
          title: s.trim(),
          color: SELECT_COLORS[i % SELECT_COLORS.length],
        }));
      }
      if (newColType === 'Formula' && newColFormula.trim()) {
        opts.formula_raw = newColFormula.trim();
      }
      if (newColType === 'Links' && newColRelTable) {
        opts.childId = newColRelTable;
        opts.relationType = newColRelMulti ? 'mm' : 'bt';
      }
      if (newColType === 'Lookup' && newColRelCol && newColLookupCol) {
        opts.fk_relation_column_id = newColRelCol;
        opts.fk_lookup_column_id = newColLookupCol;
      }
      if (newColType === 'Rollup' && newColRelCol && newColRollupCol) {
        opts.fk_relation_column_id = newColRelCol;
        opts.fk_rollup_column_id = newColRollupCol;
        opts.rollup_function = newColRollupFn;
      }
      if (newColType === 'Number') {
        opts.meta = numFormat;
      }
      if (newColType === 'Rating') {
        opts.meta = { max: ratingMax, iconIdx: ratingIcon };
      }
      if (newColType === 'Date' || newColType === 'DateTime') {
        opts.meta = { date_format: dateFormat };
      }
      const newCol = await nc.addColumn(tableId, newColTitle.trim(), newColType, opts);
      // Reorder if insert position was specified
      if (insertColPosition && activeViewId) {
        // Ensure all columns have order entries — initialize from current displayCols order if viewColumns is empty/sparse
        const existingVcIds = new Set((viewColumns || []).map(vc => vc.fk_column_id));
        const allCols = [...displayCols.map(c => c.column_id), newCol.column_id];
        for (let i = 0; i < allCols.length; i++) {
          if (!existingVcIds.has(allCols[i])) {
            await nc.updateViewColumn(activeViewId, allCols[i], { order: (i + 1) * 10 });
          }
        }
        // Re-fetch to get current orders
        const freshVc = await nc.listViewColumns(activeViewId);
        if (insertColPosition.afterColId === '__first__') {
          await nc.updateViewColumn(activeViewId, newCol.column_id, { order: 0 });
          for (const vc of freshVc) {
            if (vc.fk_column_id !== newCol.column_id) {
              await nc.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
            }
          }
        } else {
          const afterViewCol = freshVc.find(vc => vc.fk_column_id === insertColPosition.afterColId);
          const afterOrder = afterViewCol?.order ?? 0;
          await nc.updateViewColumn(activeViewId, newCol.column_id, { order: afterOrder + 1 });
          for (const vc of freshVc) {
            if (vc.fk_column_id !== newCol.column_id && (vc.order ?? 0) > afterOrder) {
              await nc.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
            }
          }
        }
        refreshViewColumns();
      }
      setInsertColPosition(null);
      resetAddColState();
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Add column failed:', e);
    }
  };

  const handleRenameColumn = async (columnId: string) => {
    if (!colTitleValue.trim()) return;
    try {
      await nc.updateColumn(tableId, columnId, { title: colTitleValue.trim() });
      setEditingColTitle(null);
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Rename column failed:', e);
    }
  };

  const handleChangeColumnType = async (columnId: string, newType: string) => {
    try {
      await nc.updateColumn(tableId, columnId, { uidt: newType });
      setColMenu(null);
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Change column type failed:', e);
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    const col = displayCols.find(c => c.column_id === columnId);
    const colTitle = col?.title || columnId;
    if (!window.confirm(`确定要删除字段 "${colTitle}" 吗？此操作不可撤销。`)) return;
    try {
      await nc.deleteColumn(tableId, columnId);
      setColMenu(null);
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Delete column failed:', e);
    }
  };

  // ── Table operations ──
  const handleRenameTable = async () => {
    if (!tableTitleValue.trim()) return;
    try {
      await nc.renameTable(tableId, tableTitleValue.trim());
      setEditingTableTitle(false);
      refreshMeta();
      queryClient.invalidateQueries({ queryKey: ['nc-tables'] });
    } catch (e) {
      console.error('Rename table failed:', e);
    }
  };

  const handleDeleteTable = async () => {
    if (!confirm('确定删除此数据表？所有数据将丢失。')) return;
    try {
      await nc.deleteTable(tableId);
      queryClient.invalidateQueries({ queryKey: ['nc-tables'] });
      onDeleted?.();
    } catch (e) {
      console.error('Delete table failed:', e);
    }
  };

  // ── CSV Export ──
  const handleExportCSV = async () => {
    setShowTableMenu(false);
    try {
      // Fetch all rows (paginated)
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      const batchSize = 200;
      while (true) {
        const batch = activeViewId
          ? await nc.queryRowsByView(tableId, activeViewId, { limit: batchSize, offset })
          : await nc.queryRows(tableId, { limit: batchSize, offset });
        allRows.push(...batch.list);
        if (allRows.length >= (batch.pageInfo?.totalRows || 0) || batch.list.length < batchSize) break;
        offset += batchSize;
      }
      // Build CSV
      const cols = displayCols.filter(c => !c.primary_key);
      const escapeCSV = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = cols.map(c => escapeCSV(c.title)).join(',');
      const lines = allRows.map(row =>
        cols.map(c => escapeCSV(row[c.title])).join(',')
      );
      const csv = [header, ...lines].join('\n');
      // Download
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${meta?.title || 'table'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export CSV failed:', e);
    }
  };

  // ── CSV Import ──
  const handleCSVFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return;
      // Simple CSV parser (handles quoted fields)
      const parseLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { current += ch; }
          } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { result.push(current); current = ''; }
            else { current += ch; }
          }
        }
        result.push(current);
        return result;
      };
      const headers = parseLine(lines[0]);
      const dataRows = lines.slice(1).map(parseLine);
      setCsvImportData({ headers, rows: dataRows });
      // Auto-map by matching header names to table column titles
      const autoMap: Record<number, string> = {};
      headers.forEach((h, i) => {
        const match = editableCols.find(c => c.title.toLowerCase() === h.trim().toLowerCase());
        if (match) autoMap[i] = match.title;
      });
      setCsvColMap(autoMap);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleCSVImport = async () => {
    if (!csvImportData) return;
    setCsvImporting(true);
    try {
      const { rows: dataRows } = csvImportData;
      // Insert rows in batches
      for (const csvRow of dataRows) {
        const rowData: Record<string, unknown> = {};
        Object.entries(csvColMap).forEach(([csvIdxStr, colTitle]) => {
          const csvIdx = Number(csvIdxStr);
          if (colTitle && csvRow[csvIdx] !== undefined) {
            rowData[colTitle] = csvRow[csvIdx];
          }
        });
        if (Object.keys(rowData).length > 0) {
          await nc.insertRow(tableId, rowData);
        }
      }
      setCsvImportData(null);
      setCsvColMap({});
      refresh();
    } catch (e) {
      console.error('CSV import failed:', e);
    } finally {
      setCsvImporting(false);
    }
  };

  // ── Open edit field dialog for existing column ──
  const openEditField = (col: nc.NCColumn) => {
    setColMenu(null);
    setEditFieldColId(col.column_id);
    setNewColTitle(col.title);
    setNewColType(col.type);
    setNewColOptions(col.options?.map(o => o.title).join(', ') || '');
    setNewColOptionsList(col.options?.map(o => o.title) || []);
    setNewColFormula(col.formula || '');
    setNewColRelTable(col.relatedTableId || '');
    setNewColRelType(col.relationType || 'mm');
    setNewColRelMulti(col.relationType !== 'bt');
    setNewColRelBidirectional(true);
    setNewColRelCol(col.fk_relation_column_id || '');
    setNewColLookupCol(col.fk_lookup_column_id || '');
    setNewColRollupCol(col.fk_rollup_column_id || '');
    setNewColRollupFn(col.rollup_function || 'sum');
    // Number format from meta
    if (col.meta) {
      const m = col.meta as Record<string, unknown>;
      setNumFormat({
        decimals: (m.decimals as number) ?? 0,
        thousands: !!m.thousands,
        prefix: (m.prefix as string) || '',
        suffix: (m.suffix as string) || '',
      });
      if (m.iconIdx !== undefined) setRatingIcon(String(m.iconIdx));
    }
    if (col.type === 'Rating' && col.meta) {
      setRatingMax((col.meta as any).max || 5);
    }
    // Date format from meta
    if ((col.type === 'Date' || col.type === 'DateTime') && col.meta) {
      setDateFormat((col.meta as any).date_format || 'YYYY-MM-DD');
    }
    setShowAddCol(true);
  };

  const openAddField = () => {
    resetAddColState();
    setEditFieldColId(null);
    // Don't clear insertColPosition here — it may have been set by handleInsertColumn
    setShowAddCol(true);
  };

  // ── Save field (handles both add and edit) ──
  const handleSaveField = async () => {
    if (!newColTitle.trim()) return;
    if (editFieldColId) {
      // Edit existing column
      try {
        const updates: Record<string, unknown> = { title: newColTitle.trim(), uidt: newColType };
        // Include select options
        if (isSelectType(newColType) && newColOptionsList.length > 0) {
          updates.options = newColOptionsList.filter(s => s.trim()).map((s, i) => ({
            title: s.trim(),
            color: SELECT_COLORS[i % SELECT_COLORS.length],
          }));
        }
        // Include meta for number format, rating, date format
        if (newColType === 'Number') {
          updates.meta = JSON.stringify(numFormat);
        }
        if (newColType === 'Rating') {
          updates.meta = JSON.stringify({ max: ratingMax, iconIdx: ratingIcon });
        }
        if (newColType === 'Date' || newColType === 'DateTime') {
          updates.meta = JSON.stringify({ date_format: dateFormat });
        }
        await nc.updateColumn(tableId, editFieldColId, updates);
        resetAddColState();
        setEditFieldColId(null);
        refreshMeta();
        refresh();
      } catch (e) {
        console.error('Update field failed:', e);
      }
    } else {
      // Add new column
      await handleAddColumn();
    }
  };

  // ── Duplicate column ──
  const handleDuplicateColumn = async (col: nc.NCColumn) => {
    setColMenu(null);
    try {
      const opts: Record<string, unknown> = {};
      if ((col.type === 'SingleSelect' || col.type === 'MultiSelect') && col.options?.length) {
        opts.options = col.options.map((o, i) => ({ title: o.title, color: o.color || SELECT_COLORS[i % SELECT_COLORS.length] }));
      }
      const newCol = await nc.addColumn(tableId, `${col.title} (copy)`, col.type, opts);
      // Reorder: place after the source column
      if (activeViewId) {
        // Ensure all columns have order entries
        const existingVcIds = new Set((viewColumns || []).map(vc => vc.fk_column_id));
        const allCols = [...displayCols.map(c => c.column_id), newCol.column_id];
        for (let i = 0; i < allCols.length; i++) {
          if (!existingVcIds.has(allCols[i])) {
            await nc.updateViewColumn(activeViewId, allCols[i], { order: (i + 1) * 10 });
          }
        }
        const freshVc = await nc.listViewColumns(activeViewId);
        const srcViewCol = freshVc.find(vc => vc.fk_column_id === col.column_id);
        const srcOrder = srcViewCol?.order ?? 0;
        await nc.updateViewColumn(activeViewId, newCol.column_id, { order: srcOrder + 1 });
        for (const vc of freshVc) {
          if (vc.fk_column_id !== col.column_id && vc.fk_column_id !== newCol.column_id && (vc.order ?? 0) > srcOrder) {
            await nc.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
          }
        }
        refreshViewColumns();
      }
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Duplicate column failed:', e);
    }
  };

  // ── Insert column left/right ──
  const handleInsertColumn = (position: 'left' | 'right', col: nc.NCColumn) => {
    setColMenu(null);
    // Determine which column the new one should be placed after
    if (position === 'left') {
      // Find the column before this one in visibleCols
      const idx = visibleCols.findIndex(c => c.column_id === col.column_id);
      if (idx > 0) {
        setInsertColPosition({ afterColId: visibleCols[idx - 1].column_id });
      } else {
        setInsertColPosition({ afterColId: '__first__' });
      }
    } else {
      setInsertColPosition({ afterColId: col.column_id });
    }
    openAddField();
  };

  // ── Toggle column visibility (with API persistence) ──
  const toggleColVisibility = useCallback((columnId: string, forceHide?: boolean) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      const shouldHide = forceHide !== undefined ? forceHide : !next.has(columnId);
      if (shouldHide) next.add(columnId);
      else next.delete(columnId);
      // Persist to Gateway DB
      if (activeViewId) {
        nc.updateViewColumn(activeViewId, columnId, { show: !shouldHide }).catch(() => {});
      }
      return next;
    });
  }, [activeViewId]);

  // ── Persist column width ──
  const persistColWidth = useCallback((columnId: string, width: number) => {
    if (activeViewId) {
      nc.updateViewColumn(activeViewId, columnId, { width }).catch(() => {});
    }
  }, [activeViewId]);

  // ── Column resize ──
  const handleResizeStart = useCallback((colId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingCol(colId);
    resizeStartX.current = e.clientX;
    resizeStartW.current = colWidths[colId] || 180;
    let lastWidth = resizeStartW.current;

    const onMouseMove = (ev: MouseEvent) => {
      const diff = ev.clientX - resizeStartX.current;
      lastWidth = Math.max(60, resizeStartW.current + diff);
      setColWidths(prev => ({ ...prev, [colId]: lastWidth }));
    };
    const onMouseUp = () => {
      setResizingCol(null);
      persistColWidth(colId, lastWidth);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [colWidths, persistColWidth]);

  // ── Bulk operations ──
  const toggleRowSelect = (rowId: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(rows.map(r => r.Id as number)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedRows.size} 行？`)) return;
    try {
      for (const rowId of selectedRows) {
        await nc.deleteRow(tableId, rowId);
      }
      setSelectedRows(new Set());
      refresh();
    } catch (e) {
      console.error('Bulk delete failed:', e);
    }
  };

  const handleBulkEdit = async () => {
    if (selectedRows.size === 0 || !bulkEditCol) return;
    try {
      for (const rowId of selectedRows) {
        await nc.updateRow(tableId, rowId, { [bulkEditCol]: bulkEditVal });
      }
      setShowBulkEdit(false);
      setBulkEditCol('');
      setBulkEditVal('');
      refresh();
    } catch (e) {
      console.error('Bulk edit failed:', e);
    }
  };

  // ── Keyboard navigation ──
  const handleCellKeyDown = (e: React.KeyboardEvent, rowIdx: number, col: nc.NCColumn) => {
    if (e.key === 'Escape') { setEditingCell(null); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
      const nextRowIdx = rowIdx + 1;
      if (nextRowIdx < rows.length) {
        const nextRow = rows[nextRowIdx];
        const nextRowId = nextRow.Id as number;
        setTimeout(() => startEdit(nextRowId, col.title, nextRow[col.title], col.type), 50);
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      saveEdit();
      const curColIdx = editableCols.findIndex(c => c.title === col.title);
      const nextColIdx = e.shiftKey ? curColIdx - 1 : curColIdx + 1;
      if (nextColIdx >= 0 && nextColIdx < editableCols.length) {
        const nextCol = editableCols[nextColIdx];
        const rowId = editingCell!.rowId;
        const row = rows.find(r => (r.Id as number) === rowId);
        if (row) setTimeout(() => startEdit(rowId, nextCol.title, row[nextCol.title], nextCol.type), 50);
      }
    }
  };

  useEffect(() => {
    if (showAddCol && newColRef.current) newColRef.current.focus();
  }, [showAddCol]);

  useEffect(() => {
    if (editingColTitle && colTitleRef.current) colTitleRef.current.focus();
  }, [editingColTitle]);

  // Close select dropdown on outside click (without blocking other interactions)
  useEffect(() => {
    if (!selectDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-select-dropdown]')) {
        setSelectDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectDropdown]);

  // Close user picker on outside click
  useEffect(() => {
    if (!userPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-select-dropdown]')) {
        setUserPicker(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userPicker]);

  // ── Get input type for cell editing ──
  const getInputType = (colType: string) => {
    switch (colType) {
      case 'Number': case 'Decimal': case 'Currency': case 'Percent': case 'Rating': case 'Year': return 'text';
      case 'Date': case 'DateTime': case 'Time': return 'text';
      case 'Email': return 'email';
      case 'URL': return 'url';
      case 'PhoneNumber': return 'tel';
      default: return 'text';
    }
  };

  // ── Check if cell needs special editor ──
  const isSelectType = (type: string) => type === 'SingleSelect' || type === 'MultiSelect';

  return (
    <>
      {/* Header */}
      <div className="flex items-center border-b border-border bg-white dark:bg-card shrink-0">
        <div className="flex-1 min-w-0 flex items-center px-4 py-2">
        {onToggleDocList && (
          <button
            onClick={onToggleDocList}
            className="hidden md:flex p-1.5 -ml-1 mr-1 text-muted-foreground hover:text-foreground rounded transition-colors"
            title={docListVisible ? '收起侧栏' : '展开侧栏'}
          >
            {docListVisible ? <ArrowLeftToLine className="h-4 w-4" /> : <ArrowRightToLine className="h-4 w-4" />}
          </button>
        )}
        <button onClick={onBack} className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm">
            <Table2 className="h-4 w-4 text-green-400/70 shrink-0" />
            {editingTableTitle ? (
              <input
                value={tableTitleValue}
                onChange={e => setTableTitleValue(e.target.value)}
                onBlur={handleRenameTable}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameTable(); if (e.key === 'Escape') setEditingTableTitle(false); }}
                className="text-sm font-semibold bg-transparent text-foreground outline-none border-b border-sidebar-primary flex-1"
                autoFocus
              />
            ) : (
              <span
                className="text-foreground font-medium truncate cursor-pointer hover:text-sidebar-primary"
                onDoubleClick={() => { setEditingTableTitle(true); setTableTitleValue(meta?.title || ''); }}
              >
                {meta?.title || '加载中...'}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground/50 mt-0.5 flex items-center gap-2">
            <span>{totalRows} 行</span>
            {meta?.updated_at && (
              <>
                <span>·</span>
                <span>最后编辑于 {new Date(meta.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowTableComments(v => !v)}
            className={cn('p-1.5 rounded transition-colors', showTableComments ? 'text-sidebar-primary bg-sidebar-primary/10' : 'text-muted-foreground hover:text-foreground')}
            title="评论"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <div className="relative">
            <button onClick={() => setShowTableMenu(v => !v)} className="p-1.5 text-muted-foreground hover:text-foreground shrink-0" title="更多操作">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showTableMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowTableMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-40">
                  <button
                    onClick={() => { setShowTableMenu(false); setEditingTableTitle(true); setTableTitleValue(meta?.title || ''); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                  >
                    <Pencil className="h-3.5 w-3.5" /> 重命名
                  </button>
                  <div className="border-t border-border my-1" />
                  <button
                    onClick={handleExportCSV}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                  >
                    <Download className="h-3.5 w-3.5" /> 导出 CSV
                  </button>
                  <button
                    onClick={() => { setShowTableMenu(false); csvInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                  >
                    <Upload className="h-3.5 w-3.5" /> 导入 CSV
                  </button>
                  <div className="border-t border-border my-1" />
                  <button
                    onClick={() => { setShowTableMenu(false); handleDeleteTable(); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 删除表格
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        </div>
        {/* Comment sidebar header — aligned with top bar */}
        {showTableComments && (
          <div className="w-80 shrink-0 flex items-center justify-between px-4 py-2 border-l border-border">
            <h3 className="text-sm font-semibold text-foreground">评论</h3>
            <button onClick={() => setShowTableComments(false)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="关闭">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Main content + comments sidebar flex row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Main table content */}
      <div className="flex-1 flex flex-col min-w-0">

      {/* View tabs bar */}
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
                        <ArrowUp className="h-3 w-3" /> Set as First Tab
                      </button>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => { setViewMenu(null); setEditingViewTitle(v.view_id); setViewTitleValue(v.title); }}
                        className="w-full flex items-center gap-2 px-3 py-1 text-xs text-foreground hover:bg-accent"
                      >
                        <Pencil className="h-3 w-3" /> Rename View
                      </button>
                      <button
                        onClick={async () => {
                          setViewMenu(null);
                          try {
                            const copyTitle = `${v.title} (copy)`;
                            const newView = await nc.createView(tableId, copyTitle, VIEW_TYPES.find(vt => vt.typeNum === v.type)?.type || 'grid');
                            refreshMeta();
                            setActiveViewId(newView.view_id);
                          } catch {}
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1 text-xs text-foreground hover:bg-accent"
                      >
                        <Copy className="h-3 w-3" /> Duplicate View
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
                        <Lock className="h-3 w-3" /> {lockedViews.has(v.view_id) ? 'Unlock View' : 'Lock View'}
                      </button>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => handleDeleteView(v.view_id)}
                        className="w-full flex items-center gap-2 px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" /> Delete View
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
            title="添加视图"
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
                      const defaultName = `${vt.label}视图${existingCount > 0 ? ` ${existingCount + 1}` : ''}`;
                      const newView = await nc.createView(tableId, defaultName, vt.type);
                      if (vt.type === 'kanban') {
                        const selectCol = displayCols.find(c => c.type === 'SingleSelect');
                        if (selectCol) {
                          await nc.updateKanbanConfig(newView.view_id, { fk_grp_col_id: selectCol.column_id });
                        }
                      }
                      refreshMeta();
                      setActiveViewId(newView.view_id);
                    } catch {}
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  <VTIcon className="h-3 w-3" /> {vt.label}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* Toolbar bar — NocoDB style, view-type aware */}
      {(() => {
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
                Add Record
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
                  Customize Field{hiddenCols.size > 0 ? ` (${hiddenCols.size})` : ''}
                </button>
                {activeToolbarPanel === 'fields' && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                    <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-72">
                      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">Customize Field</span>
                          <Info className="h-3 w-3 text-muted-foreground/60" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => { displayCols.filter(c => !c.primary_key).forEach(c => toggleColVisibility(c.column_id, false)); }}
                            className="text-[10px] text-sidebar-primary hover:opacity-80"
                          >
                            Show all
                          </button>
                          <button
                            onClick={() => { displayCols.filter(c => !c.primary_key).forEach(c => toggleColVisibility(c.column_id, true)); }}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Hide all
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
                          <Plus className="h-3.5 w-3.5" /> New field
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
                  Group by {activeView?.fk_grp_col_id ? displayCols.find(c => c.column_id === activeView.fk_grp_col_id)?.title : ''}
                </button>
                {activeToolbarPanel === 'kanban-group' && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                    <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-64">
                      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                        <span className="text-xs font-semibold text-foreground">Group table by fields</span>
                        <Info className="h-3 w-3 text-muted-foreground/60" />
                      </div>
                      <div className="p-3">
                        <div className="text-xs text-muted-foreground mb-1.5">Select grouping condition</div>
                        <div className="space-y-0.5">
                          {displayCols.filter(c => !c.primary_key && c.title !== 'created_by').map(c => {
                            const ColIcon = getColIcon(c.type);
                            const isActive = activeView?.fk_grp_col_id === c.column_id;
                            return (
                              <button
                                key={c.column_id}
                                onClick={async () => {
                                  if (activeView) {
                                    await nc.updateKanbanConfig(activeView.view_id, { fk_grp_col_id: c.column_id });
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
                  Customize Card
                </button>
                {activeToolbarPanel === 'kanban-card' && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                    <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-72">
                      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                        <span className="text-xs font-semibold text-foreground">Customize Card</span>
                      </div>
                      <div className="p-3 space-y-3">
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">Cover field</div>
                          <select className="w-full bg-muted rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none">
                            <option value="">None</option>
                            {displayCols.filter(c => c.type === 'Attachment').map(c => (
                              <option key={c.column_id} value={c.column_id}>{c.title}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">Fields</div>
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
                  Customize Card
                </button>
                {activeToolbarPanel === 'gallery-card' && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                    <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-72">
                      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                        <span className="text-xs font-semibold text-foreground">Customize Card</span>
                      </div>
                      <div className="p-3 space-y-3">
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">Cover field</div>
                          <select className="w-full bg-muted rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none">
                            <option value="">None</option>
                            {displayCols.filter(c => c.type === 'Attachment').map(c => (
                              <option key={c.column_id} value={c.column_id}>{c.title}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">Fields</div>
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
                  Group By{groupByCol ? ` (${groupByCol})` : ''}
                </button>
                {activeToolbarPanel === 'groupby' && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                    <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-64">
                      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                        <span className="text-xs font-semibold text-foreground">Group table by fields</span>
                        <Info className="h-3 w-3 text-muted-foreground/60" />
                      </div>
                      <div className="p-3">
                        <select
                          value={groupByCol || ''}
                          onChange={e => setGroupByCol(e.target.value || null)}
                          className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground outline-none"
                        >
                          <option value="">Choose field...</option>
                          {displayCols.filter(c => !c.primary_key && !READONLY_TYPES.has(c.type)).map(c => {
                            const ColIcon = getColIcon(c.type);
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
                            <X className="h-3 w-3" /> Remove grouping
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
                  {viewFilters?.length ? `${viewFilters.length} Filter` : 'Filter'}
                </button>
                {activeToolbarPanel === 'filter' && activeViewId && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                    <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-[420px]">
                      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
                        <span className="text-xs font-semibold text-foreground">Filter records</span>
                        <Info className="h-3 w-3 text-muted-foreground/60" />
                      </div>
                      <div className="p-3 space-y-2">
                        {viewFilters?.map(f => {
                          const col = displayCols.find(c => c.column_id === f.fk_column_id);
                          return (
                            <div key={f.filter_id} className="flex items-center gap-2">
                              <select
                                value={f.fk_column_id}
                                onChange={() => {}}
                                className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0"
                              >
                                <option value={f.fk_column_id}>{col?.title || f.fk_column_id}</option>
                              </select>
                              <select
                                value={f.comparison_op}
                                onChange={() => {}}
                                className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none w-24"
                              >
                                <option value={f.comparison_op}>{FILTER_OPS.find(o => o.value === f.comparison_op)?.label || f.comparison_op}</option>
                              </select>
                              <span className="text-xs text-foreground bg-muted rounded px-2 py-1.5 flex-1 min-w-0 truncate">{f.value}</span>
                              <button onClick={() => handleDeleteFilter(f.filter_id)} className="p-1 text-muted-foreground hover:text-destructive shrink-0">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        <div className="flex items-center gap-2">
                          <select value={newFilterCol} onChange={e => setNewFilterCol(e.target.value)} className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0">
                            <option value="">Field...</option>
                            {displayCols.filter(c => !READONLY_TYPES.has(c.type)).map(c => (
                              <option key={c.column_id} value={c.column_id}>{c.title}</option>
                            ))}
                          </select>
                          <select value={newFilterOp} onChange={e => setNewFilterOp(e.target.value)} className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none w-24">
                            {FILTER_OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                          </select>
                          <input
                            value={newFilterVal}
                            onChange={e => setNewFilterVal(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddFilter(); }}
                            placeholder="Value"
                            className="bg-muted rounded px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none flex-1 min-w-0"
                          />
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
                          <Plus className="h-3.5 w-3.5" /> Add Condition
                        </button>
                      </div>
                    </div>
                  </>
                )}
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
                  {viewSorts?.length ? `${viewSorts.length} Sort` : 'Sort'}
                </button>
                {activeToolbarPanel === 'sort' && activeViewId && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                    <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-80">
                      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">Sort by fields</span>
                          <Info className="h-3 w-3 text-muted-foreground/60" />
                        </div>
                      </div>
                      <div className="p-3 space-y-2">
                        {viewSorts?.map(s => {
                          const col = displayCols.find(c => c.column_id === s.fk_column_id);
                          return (
                            <div key={s.sort_id} className="flex items-center gap-2">
                              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 cursor-grab" />
                              <select
                                value={s.fk_column_id}
                                onChange={() => {}}
                                className="bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none flex-1 min-w-0"
                              >
                                <option value={s.fk_column_id}>{col?.title || s.fk_column_id}</option>
                              </select>
                              <div className="flex rounded overflow-hidden border border-border shrink-0">
                                <button
                                  className={cn('px-2 py-1 text-xs transition-colors',
                                    s.direction === 'asc' ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                                  )}
                                >
                                  A→Z
                                </button>
                                <button
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
                            <option value="">Choose field...</option>
                            {displayCols.filter(c => !READONLY_TYPES.has(c.type)).map(c => (
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
                    </div>
                  </>
                )}
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
                  Row Height
                </button>
                {activeToolbarPanel === 'rowheight' && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActiveToolbarPanel(null)} />
                    <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-2xl w-44 py-1">
                      {([
                        { key: 'short' as const, label: 'Short', icon: '▤' },
                        { key: 'medium' as const, label: 'Medium', icon: '▥' },
                        { key: 'tall' as const, label: 'Tall', icon: '▦' },
                        { key: 'extra' as const, label: 'Extra Tall', icon: '▧' },
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
                          {opt.label}
                          {rowHeight === opt.key && <span className="ml-auto text-sidebar-primary">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Content area — view type determines rendering */}
      {(() => {
        const activeView = views.find(v => v.view_id === activeViewId);
        const viewType = activeView?.type || 3;
        // Kanban view
        if (viewType === 4) return (
          <KanbanView
            rows={rows}
            columns={displayCols}
            activeView={activeView!}
            isLoading={isLoading}
            onUpdateRow={async (rowId, fields) => { await nc.updateRow(tableId, rowId, fields); refresh(); }}
            onAddRow={handleAddRow}
            tableId={tableId}
            refreshMeta={refreshMeta}
            hiddenCols={hiddenCols}
          />
        );
        // Gallery view
        if (viewType === 2) return (
          <GalleryView
            rows={rows}
            columns={displayCols}
            isLoading={isLoading}
            onAddRow={handleAddRow}
            hiddenCols={hiddenCols}
          />
        );
        // Form view
        if (viewType === 1) return (
          <FormView
            columns={displayCols.filter(c => !c.primary_key && !READONLY_TYPES.has(c.type))}
            tableId={tableId}
            onSubmit={async (data) => { await nc.insertRow(tableId, data); refresh(); }}
          />
        );
        // Calendar view (frontend-only, NocoDB doesn't support it)
        if (viewType === 5) return (
          <CalendarView
            rows={rows}
            columns={displayCols}
            isLoading={isLoading}
          />
        );
        // Grid view (default)
        return null;
      })() || (
      <div className="flex-1 overflow-auto" style={{ overscrollBehavior: 'none' }}>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-8 rounded bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : (
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd} onDragOver={handleColumnDragOver} onDragStart={(e) => setColDragActiveId(String(e.active.id))} onDragCancel={() => { setColDragOver(null); setColDragActiveId(null); }}>
          <table className="text-sm border-collapse table-fixed">
            <thead>
              <tr className="border-b border-border bg-muted/30 sticky top-0 z-[5]">
                <th className="px-1 py-1.5 text-center text-[10px] font-normal text-muted-foreground/50 group/hdr sticky left-0 z-[6] bg-card relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-border" style={{ width: '32px', minWidth: '32px', maxWidth: '32px' }}>
                  <span className={cn('group-hover/hdr:hidden', selectedRows.size > 0 && 'hidden')}>#</span>
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && selectedRows.size === rows.length}
                    onChange={toggleSelectAll}
                    className={cn('w-3 h-3 accent-sidebar-primary cursor-pointer', selectedRows.size > 0 ? 'inline' : 'hidden group-hover/hdr:inline')}
                  />
                </th>
                  <SortableContext items={visibleCols.filter(c => !c.primary_key).map(c => c.column_id)} strategy={horizontalListSortingStrategy}>
                {visibleCols.map((col, colIdx) => {
                  const ColIcon = getColIcon(col.type);
                  const isSorted = sortCol === col.title;
                  const width = colWidths[col.column_id];
                  const isFrozen = colIdx < frozenColCount;
                  // Calculate left offset for frozen columns
                  const frozenLeft = isFrozen ? 32 + visibleCols.slice(0, colIdx).reduce((sum, c) => sum + (colWidths[c.column_id] || 180), 0) : undefined;
                  const isLastFrozen = colIdx === frozenColCount - 1;
                  // PK columns render as plain th, not sortable
                  if (col.primary_key) {
                    return (
                      <th
                        key={col.column_id}
                        className={cn(
                          "relative px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap group",
                          'sticky z-[6] bg-card',
                          isLastFrozen
                            ? 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[2px] after:bg-gray-300 dark:after:bg-gray-600'
                            : 'border-r border-border'
                        )}
                        style={{
                          width: `${width || 180}px`, minWidth: `${width || 180}px`, maxWidth: `${width || 180}px`,
                          left: `${frozenLeft}px`
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Lock className="h-3 w-3 shrink-0 opacity-30" />
                          <ColIcon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                          <span className="flex-1 select-none truncate">{col.title}</span>
                          {isSorted && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-sidebar-primary shrink-0" /> : <ArrowDown className="h-3 w-3 text-sidebar-primary shrink-0" />)}
                          <button
                            onClick={(e) => { e.stopPropagation(); setColMenu(colMenu === col.column_id ? null : col.column_id); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-foreground transition-opacity"
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </button>
                        </div>
                        {/* Column menu for PK */}
                        {colMenu === col.column_id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setColMenu(null)} />
                            <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-48">
                              <button onClick={() => openEditField(col)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"><Pencil className="h-3 w-3" /> Edit Field</button>
                              <button onClick={() => handleDuplicateColumn(col)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"><Copy className="h-3 w-3" /> Duplicate Field</button>
                              <div className="border-t border-border my-1" />
                              <button onClick={() => handleInsertColumn('right', col)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"><ArrowRightFromLine className="h-3 w-3" /> Insert Right</button>
                              <div className="border-t border-border my-1" />
                              <button
                                onClick={() => { setColMenu(null); const idx = visibleCols.findIndex(c => c.column_id === col.column_id); setFrozenColCount(idx + 1); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                              >
                                <Snowflake className="h-3 w-3" /> Freeze up to
                              </button>
                              {frozenColCount > 1 && (
                                <button
                                  onClick={() => { setColMenu(null); setFrozenColCount(1); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                                >
                                  <Snowflake className="h-3 w-3 opacity-40" /> Unfreeze all
                                </button>
                              )}
                              <button
                                onClick={() => { setColMenu(null); setGroupByCol(groupByCol === col.title ? null : col.title); }}
                                className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent', groupByCol === col.title ? 'text-sidebar-primary font-medium' : 'text-foreground')}
                              >
                                <Group className="h-3 w-3" /> {groupByCol === col.title ? 'Remove Group By' : 'Group By'}
                              </button>
                              <div className="border-t border-border my-1" />
                              <button onClick={() => { setColMenu(null); setSortCol(col.title); setSortDir('asc'); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"><ArrowUp className="h-3 w-3" /> Sort A → Z</button>
                              <button onClick={() => { setColMenu(null); setSortCol(col.title); setSortDir('desc'); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"><ArrowDown className="h-3 w-3" /> Sort Z → A</button>
                            </div>
                          </>
                        )}
                        <div
                          className={cn('absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-sidebar-primary/50 transition-colors', resizingCol === col.column_id && 'bg-sidebar-primary')}
                          onMouseDown={e => handleResizeStart(col.column_id, e)}
                        />
                      </th>
                    );
                  }
                  return (
                    <SortableColumnHeader
                      key={col.column_id}
                      id={col.column_id}
                      isOver={colDragOver?.overId === col.column_id}
                      overSide={colDragOver?.overId === col.column_id ? colDragOver.side : undefined}
                      className={cn(
                        "relative px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap group",
                        isFrozen ? cn('sticky z-[6] bg-card', isLastFrozen ? 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[2px] after:bg-gray-300 dark:after:bg-gray-600' : 'border-r border-border') : 'border-r border-border'
                      )}
                      style={{
                        width: `${width || 180}px`, minWidth: `${width || 180}px`, maxWidth: `${width || 180}px`,
                        ...(isFrozen ? { left: `${frozenLeft}px` } : {})
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        {col.primary_key && <Lock className="h-3 w-3 shrink-0 opacity-30" />}
                        <ColIcon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                        {editingColTitle === col.column_id ? (
                          <input
                            ref={colTitleRef}
                            value={colTitleValue}
                            onChange={e => setColTitleValue(e.target.value)}
                            onBlur={() => handleRenameColumn(col.column_id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRenameColumn(col.column_id);
                              if (e.key === 'Escape') setEditingColTitle(null);
                            }}
                            className="flex-1 bg-transparent text-foreground outline-none text-xs font-medium border-b border-sidebar-primary"
                          />
                        ) : (
                          <span className="flex-1 select-none truncate">
                            {col.title}
                          </span>
                        )}
                        {isSorted && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-sidebar-primary shrink-0" /> : <ArrowDown className="h-3 w-3 text-sidebar-primary shrink-0" />)}
                        <button
                          onClick={(e) => { e.stopPropagation(); setColMenu(colMenu === col.column_id ? null : col.column_id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-foreground transition-opacity"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </button>
                      </div>
                      {/* Column menu */}
                      {colMenu === col.column_id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setColMenu(null)} />
                          <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-48">
                            <button
                              onClick={() => openEditField(col)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <Pencil className="h-3 w-3" /> Edit Field
                            </button>
                            <button
                              onClick={() => handleDuplicateColumn(col)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <Copy className="h-3 w-3" /> Duplicate Field
                            </button>
                            <button
                              onClick={() => { setColMenu(null); toggleColVisibility(col.column_id, true); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <EyeOff className="h-3 w-3" /> Hide Field
                            </button>
                            <div className="border-t border-border my-1" />
                            {!col.primary_key && (
                              <button
                                onClick={() => handleInsertColumn('left', col)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                              >
                                <ArrowLeftFromLine className="h-3 w-3" /> Insert Left
                              </button>
                            )}
                            <button
                              onClick={() => handleInsertColumn('right', col)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <ArrowRightFromLine className="h-3 w-3" /> Insert Right
                            </button>
                            <div className="border-t border-border my-1" />
                            <button
                              onClick={() => {
                                setColMenu(null);
                                const colIdx = visibleCols.findIndex(c => c.column_id === col.column_id);
                                setFrozenColCount(colIdx + 1);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <Snowflake className="h-3 w-3" /> Freeze up to
                            </button>
                            {frozenColCount > 1 && (
                              <button
                                onClick={() => { setColMenu(null); setFrozenColCount(1); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                              >
                                <Snowflake className="h-3 w-3 opacity-40" /> Unfreeze all
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setColMenu(null);
                                setGroupByCol(groupByCol === col.title ? null : col.title);
                              }}
                              className={cn(
                                'w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent',
                                groupByCol === col.title ? 'text-sidebar-primary font-medium' : 'text-foreground'
                              )}
                            >
                              <Group className="h-3 w-3" /> {groupByCol === col.title ? 'Remove Group By' : 'Group By'}
                            </button>
                            <div className="border-t border-border my-1" />
                            <button
                              onClick={() => { setColMenu(null); setSortCol(col.title); setSortDir('asc'); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <ArrowUp className="h-3 w-3" /> Sort A → Z
                            </button>
                            <button
                              onClick={() => { setColMenu(null); setSortCol(col.title); setSortDir('desc'); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <ArrowDown className="h-3 w-3" /> Sort Z → A
                            </button>
                            <div className="border-t border-border my-1" />
                            <button
                              onClick={() => handleDeleteColumn(col.column_id)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3 w-3" /> Delete Field
                            </button>
                          </div>
                        </>
                      )}
                      {/* Resize handle — onPointerDown stops drag from activating */}
                      <div
                        className={cn(
                          'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-sidebar-primary/50 transition-colors',
                          resizingCol === col.column_id && 'bg-sidebar-primary'
                        )}
                        onPointerDown={e => e.stopPropagation()}
                        onMouseDown={e => handleResizeStart(col.column_id, e)}
                      />
                    </SortableColumnHeader>
                  );
                })}
                  </SortableContext>
                <th className="px-2 py-1.5 border-r border-border">
                  <button onClick={() => { setInsertColPosition(null); openAddField(); }} className="p-0.5 text-muted-foreground hover:text-foreground" title="添加列">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Group by logic
                const renderRow = (row: Record<string, unknown>, rowIdx: number) => {
                const rowId = row.Id as number;
                return (
                  <tr key={rowId ?? rowIdx} className="border-b border-border hover:bg-accent/10 transition-colors group/row">
                    <td className="py-0 text-center text-[10px] text-muted-foreground/40 relative overflow-hidden sticky left-0 z-[3] bg-card after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-border" style={{ width: '32px', minWidth: '32px', maxWidth: '32px' }}>
                      {/* Number always present for layout; checkbox overlays on hover */}
                      <span className={cn('inline-block', (selectedRows.has(rowId)) && 'invisible')}>
                        {(page - 1) * pageSize + rowIdx + 1}
                      </span>
                      <div className={cn(
                        'absolute inset-0 flex items-center justify-center',
                        selectedRows.has(rowId) ? 'visible' : 'invisible group-hover/row:visible'
                      )}>
                        <input
                          type="checkbox"
                          checked={selectedRows.has(rowId)}
                          onChange={() => toggleRowSelect(rowId)}
                          className="w-3.5 h-3.5 accent-sidebar-primary cursor-pointer"
                        />
                      </div>
                    </td>
                    {visibleCols.map((col, colIdx) => {
                      const val = row[col.title];
                      const isEditing = editingCell?.rowId === rowId && editingCell?.col === col.title;
                      const isReadonly = READONLY_TYPES.has(col.type);
                      const isPK = col.primary_key;
                      const width = colWidths[col.column_id];
                      const isFrozen = colIdx < frozenColCount;
                      const isLastFrozen = colIdx === frozenColCount - 1;
                      const frozenLeft = isFrozen ? 32 + visibleCols.slice(0, colIdx).reduce((sum, c) => sum + (colWidths[c.column_id] || 180), 0) : undefined;

                      return (
                        <td
                          key={col.column_id}
                          className={cn(
                            'px-2 relative',
                            isLastFrozen ? 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[2px] after:bg-gray-300 dark:after:bg-gray-600' : 'border-r border-border',
                            (selectDropdown?.rowId === rowId && selectDropdown?.col === col.title) || (userPicker?.rowId === rowId && userPicker?.col === col.title) || (datePicker?.rowId === rowId && datePicker?.col === col.title) ? 'overflow-visible' : 'overflow-hidden',
                            isEditing && 'ring-2 ring-sidebar-primary ring-inset bg-card',
                            (!isReadonly || col.type === 'Links' || col.type === 'Attachment' || col.type === 'User' || col.type === 'Collaborator') && !isEditing && 'cursor-pointer',
                            isFrozen ? cn('sticky z-[3]', isPK && commentedRowIds.has(String(rowId)) ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-card') : undefined,
                            rowHeight === 'short' && 'py-0',
                            rowHeight === 'medium' && 'py-1',
                            rowHeight === 'tall' && 'py-2',
                            rowHeight === 'extra' && 'py-3',
                          )}
                          style={{
                            width: `${width || 180}px`, minWidth: `${width || 180}px`, maxWidth: `${width || 180}px`,
                            ...((isPK || isFrozen) ? { left: `${frozenLeft}px` } : {})
                          }}
                          onClick={() => {
                            if (col.type === 'Links') {
                              setLinkPicker({ rowId, column: col });
                              return;
                            }
                            if (col.type === 'Attachment') {
                              attachmentInputRef.current?.click();
                              setAttachmentUploading({ rowId, col: col.title });
                              return;
                            }
                            if (col.type === 'User' || col.type === 'Collaborator') {
                              setUserPicker({ rowId, col: col.title });
                              setUserPickerSearch('');
                              return;
                            }
                            if ((col.type === 'Date' || col.type === 'DateTime') && !isReadonly) {
                              const dateStr = val ? String(val) : '';
                              setDatePicker({ rowId, col: col.title, colType: col.type, value: dateStr });
                              return;
                            }
                            if (isEditing || isReadonly) return;
                            if (col.type === 'Checkbox') {
                              toggleCheckbox(rowId, col.title, val);
                            } else if (isSelectType(col.type)) {
                              setSelectInput('');
                              setSelectDropdown({
                                rowId, col: col.title,
                                options: col.options || [],
                                multi: col.type === 'MultiSelect',
                              });
                            } else if (col.type === 'Rating') {
                              // Rating handled by inline stars
                            } else {
                              startEdit(rowId, col.title, val, col.type);
                            }
                          }}
                        >
                          {isEditing ? (
                            col.type === 'LongText' || col.type === 'JSON' ? (
                              <textarea
                                ref={editInputRef as React.RefObject<HTMLTextAreaElement>}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => {
                                  if (e.key === 'Escape') { setEditingCell(null); return; }
                                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                }}
                                className={cn(
                                  'w-full bg-transparent text-xs text-foreground outline-none resize-none py-1.5 min-h-[60px]',
                                  col.type === 'JSON' && 'font-mono'
                                )}
                              />
                            ) : (
                              <input
                                ref={editInputRef as React.RefObject<HTMLInputElement>}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => handleCellKeyDown(e, rowIdx, col)}
                                type={getInputType(col.type)}
                                inputMode={['Number', 'Decimal', 'Currency', 'Percent', 'Rating', 'Year'].includes(col.type) ? 'decimal' : undefined}
                                step={col.type === 'Decimal' || col.type === 'Currency' ? '0.01' : col.type === 'Percent' ? '0.1' : undefined}
                                className="w-full bg-transparent text-xs text-foreground outline-none py-1.5"
                              />
                            )
                          ) : col.type === 'Rating' && !isReadonly ? (
                            <RatingStars value={val as number} onChange={v => setRating(rowId, col.title, v)} max={(col.meta as any)?.max || 5} iconType={(col.meta as any)?.iconIdx || 'star'} />
                          ) : isPK ? (
                            <div className="flex items-center gap-1">
                              <span className="flex-1 truncate"><CellDisplay value={val} col={col} /></span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedRowIdx(rowIdx); }}
                                className="hidden group-hover/row:inline-flex shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
                                title="展开行"
                              >
                                <Expand className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandWithComments(true); setExpandedRowIdx(rowIdx); }}
                                className={cn(
                                  'shrink-0 p-0.5',
                                  commentedRowIds.has(String(rowId))
                                    ? 'inline-flex text-sidebar-primary'
                                    : 'hidden group-hover/row:inline-flex text-muted-foreground hover:text-sidebar-primary'
                                )}
                                title="行评论"
                              >
                                <MessageSquare className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <CellDisplay value={val} col={col} />
                          )}
                          {/* Select dropdown */}
                          {selectDropdown?.rowId === rowId && selectDropdown?.col === col.title && (() => {
                            const filteredOpts = selectDropdown.options.filter(o =>
                              !selectInput || o.title.toLowerCase().includes(selectInput.toLowerCase())
                            );
                            const inputMatchesExisting = selectDropdown.options.some(o => o.title.toLowerCase() === selectInput.trim().toLowerCase());
                            const showCreateOption = selectInput.trim() && !inputMatchesExisting;
                            return (
                              <div data-select-dropdown className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl w-52 max-h-56 flex flex-col">
                                {/* Search/create input */}
                                <div className="px-2 py-1.5 border-b border-border">
                                  <input
                                    value={selectInput}
                                    onChange={e => setSelectInput(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && selectInput.trim()) {
                                        e.stopPropagation();
                                        if (selectDropdown.multi) {
                                          toggleMultiSelect(rowId, col.title, val, selectInput.trim());
                                        } else {
                                          setSelectValue(rowId, col.title, selectInput.trim());
                                        }
                                        setSelectInput('');
                                        refreshMeta();
                                      }
                                      if (e.key === 'Escape') setSelectDropdown(null);
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    placeholder="搜索或输入新选项..."
                                    className="w-full bg-muted rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                                    autoFocus
                                  />
                                </div>
                                <div className="overflow-y-auto flex-1 py-1">
                                  {!selectDropdown.multi && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setSelectValue(rowId, col.title, ''); }}
                                      className="w-full px-3 py-1 text-xs text-muted-foreground hover:bg-accent text-left"
                                    >
                                      清除
                                    </button>
                                  )}
                                  {filteredOpts.map((opt, i) => {
                                    const isMulti = selectDropdown.multi;
                                    const currentItems = isMulti ? (val ? String(val).split(',').map(s => s.trim()) : []) : [];
                                    const isSelected = isMulti ? currentItems.includes(opt.title) : val === opt.title;
                                    return (
                                      <button
                                        key={opt.title}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isMulti) {
                                            toggleMultiSelect(rowId, col.title, val, opt.title);
                                          } else {
                                            setSelectValue(rowId, col.title, opt.title);
                                          }
                                        }}
                                        className={cn('w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent', isSelected && 'font-medium')}
                                      >
                                        {isMulti && (
                                          <span className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px]',
                                            isSelected ? 'bg-sidebar-primary border-sidebar-primary text-white' : 'border-border'
                                          )}>
                                            {isSelected && '✓'}
                                          </span>
                                        )}
                                        <span className="px-1.5 py-0.5 rounded text-[11px]" style={{ backgroundColor: getOptionColor(opt.color, i), color: '#1a1a2e' }}>
                                          {opt.title}
                                        </span>
                                      </button>
                                    );
                                  })}
                                  {showCreateOption && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (selectDropdown.multi) {
                                          toggleMultiSelect(rowId, col.title, val, selectInput.trim());
                                        } else {
                                          setSelectValue(rowId, col.title, selectInput.trim());
                                        }
                                        setSelectInput('');
                                        refreshMeta();
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-sidebar-primary hover:bg-accent"
                                    >
                                      <Plus className="h-3 w-3" /> 创建 &quot;{selectInput.trim()}&quot;
                                    </button>
                                  )}
                                  {filteredOpts.length === 0 && !showCreateOption && (
                                    <p className="px-3 py-2 text-xs text-muted-foreground">无匹配选项</p>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                          {/* User picker dropdown */}
                          {userPicker?.rowId === rowId && userPicker?.col === col.title && (() => {
                            const agents = agentsList || [];
                            const filtered = agents.filter(a =>
                              !userPickerSearch || a.display_name?.toLowerCase().includes(userPickerSearch.toLowerCase()) || a.name.toLowerCase().includes(userPickerSearch.toLowerCase())
                            );
                            const currentVal = val ? String(val) : '';
                            return (
                              <div data-select-dropdown className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl w-52 max-h-56 flex flex-col">
                                <div className="px-2 py-1.5 border-b border-border">
                                  <input
                                    value={userPickerSearch}
                                    onChange={e => setUserPickerSearch(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Escape') setUserPicker(null); }}
                                    onClick={e => e.stopPropagation()}
                                    placeholder="搜索成员..."
                                    className="w-full bg-muted rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                                    autoFocus
                                  />
                                </div>
                                <div className="overflow-y-auto flex-1 py-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); nc.updateRow(tableId, rowId, { [col.title]: '' }).then(refresh); setUserPicker(null); }}
                                    className="w-full px-3 py-1 text-xs text-muted-foreground hover:bg-accent text-left"
                                  >
                                    清除
                                  </button>
                                  {/* Admin user */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); nc.updateRow(tableId, rowId, { [col.title]: 'admin' }).then(refresh); setUserPicker(null); }}
                                    className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent', currentVal === 'admin' && 'font-medium bg-sidebar-primary/5')}
                                  >
                                    <User className="h-3 w-3 text-muted-foreground" />
                                    Admin
                                  </button>
                                  {filtered.map(agent => (
                                    <button
                                      key={agent.name}
                                      onClick={(e) => { e.stopPropagation(); nc.updateRow(tableId, rowId, { [col.title]: agent.display_name || agent.name }).then(refresh); setUserPicker(null); }}
                                      className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent', currentVal === (agent.display_name || agent.name) && 'font-medium bg-sidebar-primary/5')}
                                    >
                                      {agent.avatar_url ? (
                                        <img src={agent.avatar_url} className="h-4 w-4 rounded-full" alt="" />
                                      ) : (
                                        <User className="h-3 w-3 text-muted-foreground" />
                                      )}
                                      <span>{agent.display_name || agent.name}</span>
                                      {agent.type && <span className="text-[10px] text-muted-foreground/50 bg-muted px-1 rounded">{agent.type}</span>}
                                      <span className="text-muted-foreground/50 ml-auto text-[10px]">{agent.name}</span>
                                    </button>
                                  ))}
                                  {filtered.length === 0 && (
                                    <p className="px-3 py-2 text-xs text-muted-foreground">无匹配成员</p>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                          {/* Date picker dropdown */}
                          {datePicker?.rowId === rowId && datePicker?.col === col.title && (
                            <DatePickerDropdown
                              value={datePicker.value}
                              showTime={datePicker.colType === 'DateTime'}
                              onSelect={async (dateStr) => {
                                setDatePicker(null);
                                if (dateStr !== datePicker.value) {
                                  queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
                                    const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
                                    if (!data) return old;
                                    return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col.title]: dateStr || null } : r) };
                                  });
                                  try { await nc.updateRow(tableId, rowId, { [col.title]: dateStr || null }); refresh(); }
                                  catch (e) { console.error('Date update failed:', e); refresh(); }
                                }
                              }}
                              onClose={() => setDatePicker(null)}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="border-r border-border" style={{ width: '32px', minWidth: '32px', maxWidth: '32px' }} />
                  </tr>
                );
                };

                if (groupByCol) {
                  // Group rows by the specified column
                  const groups = new Map<string, { rows: Record<string, unknown>[]; indices: number[] }>();
                  rows.forEach((row, idx) => {
                    const val = row[groupByCol] == null ? '' : String(row[groupByCol]);
                    const key = val || '(empty)';
                    if (!groups.has(key)) groups.set(key, { rows: [], indices: [] });
                    groups.get(key)!.rows.push(row);
                    groups.get(key)!.indices.push(idx);
                  });
                  return Array.from(groups.entries()).map(([groupKey, group]) => (
                    <GroupRows key={groupKey} groupKey={groupKey} count={group.rows.length} colSpan={visibleCols.length + 2}>
                      {group.rows.map((row, i) => renderRow(row, group.indices[i]))}
                    </GroupRows>
                  ));
                }
                return rows.map((row, rowIdx) => renderRow(row, rowIdx));
              })()}
              <tr className="border-b border-border">
                <td className="px-2 py-1 sticky left-0 z-[3] bg-card relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-border" style={{ width: '32px', minWidth: '32px', maxWidth: '32px' }} />
                <td className="px-2 py-1 sticky left-[32px] z-[3] bg-card">
                  <button onClick={handleAddRow} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-0.5">
                    <Plus className="h-3 w-3" /> 新增行
                  </button>
                </td>
                <td colSpan={displayCols.length} />
              </tr>
            </tbody>
          </table>
          {/* Drag overlay — semi-transparent column preview */}
          <DragOverlay dropAnimation={null}>
            {colDragActiveId && (() => {
              const dragCol = visibleCols.find(c => c.column_id === colDragActiveId);
              if (!dragCol) return null;
              const DragColIcon = getColIcon(dragCol.type);
              const w = colWidths[dragCol.column_id] || 180;
              return (
                <div style={{ width: w, opacity: 0.8, pointerEvents: 'none' }} className="bg-sidebar-primary/10 border border-sidebar-primary/30 rounded shadow-lg">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-foreground bg-muted/80 border-b border-border">
                    <DragColIcon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    <span className="truncate">{dragCol.title}</span>
                  </div>
                  {rows.slice(0, 4).map((row, i) => (
                    <div key={i} className="px-2 py-1 text-xs text-muted-foreground border-b border-border/50 truncate">
                      {row[dragCol.title] != null ? String(row[dragCol.title]) : ''}
                    </div>
                  ))}
                  {rows.length > 4 && <div className="px-2 py-0.5 text-[10px] text-muted-foreground/50">...</div>}
                </div>
              );
            })()}
          </DragOverlay>
          </DndContext>
        )}
      </div>
      )}

      {/* Edit Field dialog (unified for add & edit) */}
      {showAddCol && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => { resetAddColState(); setEditFieldColId(null); setShowTypeSelector(false); setInsertColPosition(null); }}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-96 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex-1 overflow-y-auto space-y-5">
              {/* Field title */}
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Field title</div>
                <input
                  ref={newColRef}
                  value={newColTitle}
                  onChange={e => setNewColTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveField(); if (e.key === 'Escape') { resetAddColState(); setEditFieldColId(null); setShowTypeSelector(false); setInsertColPosition(null); } }}
                  placeholder="Field name"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-sidebar-primary/50 bg-transparent"
                  autoFocus
                />
              </div>

              {/* Field type selector */}
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Field type</div>
                <div className="border border-border rounded-lg overflow-hidden">
                  {/* Current type row — click to toggle type list */}
                  <button
                    onClick={() => setShowTypeSelector(!showTypeSelector)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-accent/50 transition-colors"
                  >
                    {(() => { const TypeIcon = getColIcon(newColType); return <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />; })()}
                    <span className="flex-1 text-left">{COLUMN_TYPES.find(ct => ct.value === newColType)?.label || newColType}</span>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showTypeSelector && 'rotate-180')} />
                  </button>
                  {/* Expanded type list */}
                  {showTypeSelector && (
                    <div className="border-t border-border max-h-48 overflow-y-auto">
                      {Object.entries(GROUP_LABELS).map(([group, label]) => {
                        const types = COLUMN_TYPES.filter(ct => ct.group === group);
                        if (types.length === 0) return null;
                        return (
                          <div key={group}>
                            <div className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/30 sticky top-0">{label}</div>
                            {types.map(ct => {
                              const CtIcon = ct.icon;
                              return (
                                <button
                                  key={ct.value}
                                  onClick={() => { setNewColType(ct.value); setShowTypeSelector(false); }}
                                  className={cn(
                                    'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                                    newColType === ct.value ? 'text-sidebar-primary font-medium bg-sidebar-primary/5' : 'text-foreground'
                                  )}
                                >
                                  <CtIcon className="h-3.5 w-3.5 shrink-0" />
                                  {ct.label}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Type-specific config */}
              {/* Number format config */}
              {newColType === 'Number' && (() => {
                const NUM_PRESETS: { label: string; prefix: string; suffix: string; thousands: boolean }[] = [
                  { label: '默认', prefix: '', suffix: '', thousands: false },
                  { label: '数字', prefix: '', suffix: '', thousands: false },
                  { label: '千分位数字', prefix: '', suffix: '', thousands: true },
                  { label: '百分比', prefix: '', suffix: '%', thousands: false },
                  { label: '美元 (USD)', prefix: '$', suffix: '', thousands: true },
                  { label: '人民币 (CNY)', prefix: '¥', suffix: '', thousands: true },
                  { label: '欧元 (EUR)', prefix: '€', suffix: '', thousands: true },
                  { label: '英镑 (GBP)', prefix: '£', suffix: '', thousands: true },
                  { label: '日元 (JPY)', prefix: '¥', suffix: '', thousands: true },
                  { label: '澳元 (AUD)', prefix: 'A$', suffix: '', thousands: true },
                  { label: '加元 (CAD)', prefix: 'C$', suffix: '', thousands: true },
                  { label: '新加坡元 (SGD)', prefix: 'S$', suffix: '', thousands: true },
                  { label: '韩元 (KRW)', prefix: '₩', suffix: '', thousands: true },
                  { label: '卢比 (INR)', prefix: '₹', suffix: '', thousands: true },
                ];
                const activePreset = NUM_PRESETS.find(p => p.prefix === numFormat.prefix && p.suffix === numFormat.suffix && p.thousands === numFormat.thousands) || NUM_PRESETS[0];
                return (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">数字格式</div>
                    <select
                      value={NUM_PRESETS.indexOf(activePreset)}
                      onChange={e => {
                        const p = NUM_PRESETS[parseInt(e.target.value)] || NUM_PRESETS[0];
                        setNumFormat(prev => ({ ...prev, prefix: p.prefix, suffix: p.suffix, thousands: p.thousands }));
                      }}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      {NUM_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">小数位数</div>
                    <select
                      value={numFormat.decimals}
                      onChange={e => setNumFormat(prev => ({ ...prev, decimals: parseInt(e.target.value) || 0 }))}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      <option value={0}>默认 (0位)</option>
                      {[1,2,3,4].map(d => <option key={d} value={d}>{d}位</option>)}
                    </select>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60">
                    预览: {numFormat.prefix}{numFormat.thousands ? '1,234' : '1234'}{numFormat.decimals > 0 ? '.' + '0'.repeat(numFormat.decimals) : ''}{numFormat.suffix}
                  </div>
                </div>
                );
              })()}
              {/* Rating config */}
              {newColType === 'Rating' && (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground mb-1.5">评分设置</div>
                  <label className="flex items-center gap-1.5 text-xs text-foreground">
                    <span>最大值</span>
                    <input
                      type="number" min={1} max={10} value={ratingMax}
                      onChange={e => setRatingMax(parseInt(e.target.value) || 5)}
                      className="w-14 border border-border rounded px-2 py-1 text-xs outline-none bg-transparent"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground">图标</span>
                    {[
                      { key: 'star', icon: '★' }, { key: 'heart', icon: '❤' }, { key: 'thumb', icon: '👍' },
                      { key: 'fire', icon: '🔥' }, { key: 'smile', icon: '😊' }, { key: 'flower', icon: '🌸' },
                      { key: 'bolt', icon: '⚡' }, { key: 'puzzle', icon: '🧩' }, { key: 'number', icon: '🔢' },
                    ].map(({ key, icon: ico }) => (
                      <button key={key} onClick={() => setRatingIcon(key)}
                        className={cn('px-2 py-1 rounded text-sm', ratingIcon === key ? 'bg-sidebar-primary/10 ring-1 ring-sidebar-primary' : 'bg-muted')}
                      >
                        {ico}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Date format config */}
              {(newColType === 'Date' || newColType === 'DateTime' || newColType === 'CreatedTime' || newColType === 'LastModifiedTime') && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">日期格式</div>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {(() => {
                      const showTime = newColType !== 'Date';
                      // Build format list: pure date formats first, then date+time variants
                      const baseFmts = [
                        { value: 'YYYY/MM/DD', example: '2026/01/30' },
                        { value: 'YYYY-MM-DD', example: '2026-01-30' },
                        { value: 'DD/MM/YYYY', example: '30/01/2026' },
                        { value: 'MM/DD/YYYY', example: '01/30/2026' },
                        { value: 'YYYY年MM月DD日', example: '2026年01月30日' },
                        { value: 'MM-DD', example: '01-30' },
                      ];
                      const allFmts: { value: string; example: string }[] = [];
                      for (const f of baseFmts) {
                        allFmts.push(f);
                        if (showTime) {
                          allFmts.push({ value: `${f.value} HH:mm`, example: `${f.example} 14:00` });
                        }
                      }
                      return allFmts.map(fmt => (
                        <button
                          key={fmt.value}
                          onClick={() => setDateFormat(fmt.value)}
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-1.5 rounded text-xs transition-colors',
                            dateFormat === fmt.value ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'hover:bg-accent text-foreground'
                          )}
                        >
                          <span>{fmt.value}</span>
                          <span className="text-muted-foreground">{fmt.example}</span>
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              )}
              {isSelectType(newColType) && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">Options</div>
                  <div className="space-y-1.5">
                    {newColOptionsList.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: SELECT_COLORS[i % SELECT_COLORS.length] }} />
                        <input
                          value={opt}
                          onChange={e => {
                            const updated = [...newColOptionsList];
                            updated[i] = e.target.value;
                            setNewColOptionsList(updated);
                          }}
                          className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none bg-muted/30 focus:ring-1 focus:ring-sidebar-primary/50"
                          placeholder={`option ${i + 1}`}
                        />
                        <button
                          onClick={() => setNewColOptionsList(newColOptionsList.filter((_, j) => j !== i))}
                          className="p-0.5 text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setNewColOptionsList([...newColOptionsList, ''])}
                      className="flex items-center gap-1.5 text-xs text-sidebar-primary hover:opacity-80 px-1 py-1"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Option
                    </button>
                  </div>
                </div>
              )}
              {newColType === 'Formula' && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">公式表达式</div>
                  <input
                    value={newColFormula}
                    onChange={e => setNewColFormula(e.target.value)}
                    placeholder="CONCAT({Name}, ' - ', {Country})"
                    className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none font-mono bg-transparent"
                  />
                  <div className="text-[10px] text-muted-foreground/50 mt-1">
                    用 {'{字段名}'} 引用字段。支持: CONCAT, IF, ADD, SUM, AVG, LEN, NOW, DATEADD 等
                  </div>
                </div>
              )}
              {newColType === 'Links' && (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">关联目标表</div>
                    <select
                      value={newColRelTable}
                      onChange={e => setNewColRelTable(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      <option value="">选择表...</option>
                      {allTables?.filter(t => t.id !== tableId).map(t => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newColRelMulti}
                      onChange={e => setNewColRelMulti(e.target.checked)}
                      className="accent-sidebar-primary"
                    />
                    支持选择多个记录
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newColRelBidirectional}
                      onChange={e => setNewColRelBidirectional(e.target.checked)}
                      className="accent-sidebar-primary"
                    />
                    在关联表中添加反向列
                  </label>
                  <div className="text-[10px] text-muted-foreground/60">
                    {newColRelMulti ? '多对多关联：每条记录可关联多条目标表记录' : '单选关联：每条记录只能关联一条目标表记录'}
                  </div>
                </div>
              )}
              {newColType === 'Lookup' && (() => {
                const linkCols = displayCols.filter(c => c.type === 'Links' || c.type === 'LinkToAnotherRecord');
                return (
                <div className="space-y-3">
                  {linkCols.length === 0 ? (
                    <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                      需要先创建一个「关联」类型的列，才能创建查找字段。
                    </div>
                  ) : (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">关联列</div>
                    <select
                      value={newColRelCol}
                      onChange={e => setNewColRelCol(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      <option value="">选择关联列...</option>
                      {linkCols.map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  )}
                  {relatedMeta && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1.5">查找字段（{relatedMeta.title}）</div>
                      <select
                        value={newColLookupCol}
                        onChange={e => setNewColLookupCol(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                      >
                        <option value="">选择字段...</option>
                        {relatedMeta.columns
                          .filter(c => c.title !== 'created_by' && !c.title.startsWith('nc_') && c.type !== 'ForeignKey')
                          .map(c => (
                          <option key={c.column_id} value={c.column_id}>{c.title} ({c.type})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                );
              })()}
              {newColType === 'Rollup' && (() => {
                const linkCols = displayCols.filter(c => c.type === 'Links' || c.type === 'LinkToAnotherRecord');
                return (
                <div className="space-y-3">
                  {linkCols.length === 0 ? (
                    <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                      需要先创建一个「关联」类型的列，才能创建汇总字段。
                    </div>
                  ) : (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">关联列</div>
                    <select
                      value={newColRelCol}
                      onChange={e => setNewColRelCol(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      <option value="">选择关联列...</option>
                      {linkCols.map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  )}
                  {relatedMeta && (
                    <>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5">汇总字段（{relatedMeta.title}）</div>
                        <select
                          value={newColRollupCol}
                          onChange={e => setNewColRollupCol(e.target.value)}
                          className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                        >
                          <option value="">选择字段...</option>
                          {relatedMeta.columns.filter(c => ['Number', 'Decimal', 'Currency', 'Percent', 'Rating', 'Duration'].includes(c.type)).map(c => (
                            <option key={c.column_id} value={c.column_id}>{c.title} ({c.type})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5">聚合函数</div>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { value: 'sum', label: '求和' },
                            { value: 'avg', label: '平均' },
                            { value: 'count', label: '计数' },
                            { value: 'min', label: '最小' },
                            { value: 'max', label: '最大' },
                          ].map(fn => (
                            <button
                              key={fn.value}
                              onClick={() => setNewColRollupFn(fn.value)}
                              className={cn(
                                'px-2 py-1.5 rounded-lg text-xs transition-colors border',
                                newColRollupFn === fn.value
                                  ? 'border-sidebar-primary bg-sidebar-primary/10 text-sidebar-primary'
                                  : 'border-border text-muted-foreground hover:text-foreground'
                              )}
                            >
                              {fn.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                );
              })()}
            </div>

            {/* Footer: Cancel + Confirm */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <button
                onClick={() => { resetAddColState(); setEditFieldColId(null); setShowTypeSelector(false); setInsertColPosition(null); }}
                className="px-4 py-2 text-sm text-foreground border border-border rounded-lg hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveField}
                disabled={
                  !newColTitle.trim() ||
                  (newColType === 'Lookup' && (!newColRelCol || !newColLookupCol)) ||
                  (newColType === 'Rollup' && (!newColRelCol || !newColRollupCol)) ||
                  (newColType === 'Links' && !newColRelTable) ||
                  (newColType === 'Formula' && !newColFormula.trim())
                }
                className="px-4 py-2 text-sm bg-sidebar-primary text-sidebar-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedRows.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-t border-border bg-sidebar-primary/5 shrink-0">
          <span className="text-xs text-foreground font-medium">已选 {selectedRows.size} 行</span>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 rounded"
          >
            <Trash2 className="h-3 w-3" /> 批量删除
          </button>
          <button
            onClick={() => setShowBulkEdit(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-sidebar-primary hover:bg-sidebar-primary/10 rounded"
          >
            <Pencil className="h-3 w-3" /> 批量修改
          </button>
          <button
            onClick={() => setSelectedRows(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            取消选择
          </button>
        </div>
      )}

      {/* Bulk edit dialog */}
      {showBulkEdit && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowBulkEdit(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-xl shadow-2xl p-4 w-80">
              <h3 className="text-sm font-semibold text-foreground mb-3">批量修改 ({selectedRows.size} 行)</h3>
              <div className="space-y-3">
                <select
                  value={bulkEditCol}
                  onChange={e => setBulkEditCol(e.target.value)}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="">选择字段...</option>
                  {editableCols.map(c => (
                    <option key={c.column_id} value={c.title}>{c.title}</option>
                  ))}
                </select>
                <input
                  value={bulkEditVal}
                  onChange={e => setBulkEditVal(e.target.value)}
                  placeholder="新值"
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => { setShowBulkEdit(false); setBulkEditCol(''); setBulkEditVal(''); }}
                    className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded border border-border"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleBulkEdit}
                    disabled={!bulkEditCol}
                    className="px-3 py-1.5 text-xs text-white bg-sidebar-primary rounded hover:opacity-90 disabled:opacity-50"
                  >
                    确认修改
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-card shrink-0 text-xs text-muted-foreground">
          <span>{totalRows} 行</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 hover:text-foreground disabled:opacity-30">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 hover:text-foreground disabled:opacity-30">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Hidden CSV file input */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,.tsv,.txt"
        className="hidden"
        onChange={handleCSVFileSelect}
      />

      {/* CSV Import Mapping Dialog */}
      {csvImportData && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => { setCsvImportData(null); setCsvColMap({}); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">导入 CSV — 字段映射</h3>
                <button onClick={() => { setCsvImportData(null); setCsvColMap({}); }} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2">
                <p className="text-xs text-muted-foreground mb-3">
                  共 {csvImportData.rows.length} 行数据。将 CSV 列映射到表格字段：
                </p>
                {csvImportData.headers.map((header, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-foreground w-32 truncate shrink-0" title={header}>
                      {header}
                    </span>
                    <span className="text-xs text-muted-foreground">→</span>
                    <select
                      value={csvColMap[i] || ''}
                      onChange={e => setCsvColMap(prev => ({ ...prev, [i]: e.target.value }))}
                      className="flex-1 bg-muted rounded px-2 py-1.5 text-xs text-foreground outline-none"
                    >
                      <option value="">跳过</option>
                      {editableCols.map(c => (
                        <option key={c.column_id} value={c.title}>{c.title}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-muted-foreground w-24 truncate" title={csvImportData.rows[0]?.[i]}>
                      {csvImportData.rows[0]?.[i] || '—'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  已映射 {Object.values(csvColMap).filter(Boolean).length}/{csvImportData.headers.length} 列
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setCsvImportData(null); setCsvColMap({}); }}
                    className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded border border-border"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCSVImport}
                    disabled={csvImporting || Object.values(csvColMap).filter(Boolean).length === 0}
                    className="px-3 py-1.5 text-xs text-white bg-sidebar-primary rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {csvImporting ? '导入中...' : `导入 ${csvImportData.rows.length} 行`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Link Record Picker */}
      {linkPicker && (
        <LinkRecordPicker
          tableId={tableId}
          rowId={linkPicker.rowId}
          column={linkPicker.column}
          onClose={() => setLinkPicker(null)}
          onRefresh={refresh}
        />
      )}

      {/* Row Detail Panel */}
      {expandedRowIdx != null && rows[expandedRowIdx] && (
        <RowDetailPanel
          row={rows[expandedRowIdx]}
          columns={displayCols}
          tableId={tableId}
          rowIndex={(page - 1) * pageSize + expandedRowIdx}
          totalRows={totalRows}
          onClose={() => { setExpandedRowIdx(null); setExpandWithComments(false); }}
          onNavigate={(dir) => {
            if (dir === 'prev' && expandedRowIdx > 0) setExpandedRowIdx(expandedRowIdx - 1);
            if (dir === 'next' && expandedRowIdx < rows.length - 1) setExpandedRowIdx(expandedRowIdx + 1);
          }}
          onRefresh={refresh}
          onDeleteRow={(rid) => { handleDeleteRow(rid); setExpandedRowIdx(null); }}
          initialShowComments={expandWithComments}
          onCommentChange={() => queryClient.invalidateQueries({ queryKey: ['commented-rows', tableId] })}
        />
      )}
      {/* Hidden file input for attachments */}
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files && attachmentUploading) {
            handleAttachmentUpload(attachmentUploading.rowId, attachmentUploading.col, e.target.files);
          }
          e.target.value = ''; // reset so same file can be re-selected
        }}
      />

      </div>{/* end main table content */}

      {/* Comments sidebar */}
      {showTableComments && (
        <div className="w-80 border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
          <Comments
            queryKey={['table-comments-all', tableId]}
            fetchComments={() => gw.listAllTableComments(tableId)}
            postComment={(text, parentId) => gw.commentOnTable(tableId, text, parentId).then(() => {})}
            editComment={(id, text) => gw.editTableComment(id, text)}
            deleteComment={(id) => gw.deleteTableComment(id).then(() => { queryClient.invalidateQueries({ queryKey: ['commented-rows', tableId] }); })}
            resolveComment={(id) => gw.resolveTableComment(id)}
            unresolveComment={(id) => gw.unresolveTableComment(id)}
          />
        </div>
      )}
      </div>{/* end flex row */}
    </>
  );
}

// ── Rating stars ──

function RatingStars({ value, onChange, max = 5, iconType = 'star' }: { value?: number; onChange: (v: number) => void; max?: number; iconType?: string }) {
  const current = typeof value === 'number' ? value : 0;
  const iconMap: Record<string, [string, string]> = {
    star: ['★', '☆'], heart: ['❤', '♡'], thumb: ['👍', '·'], flag: ['🚩', '·'],
    fire: ['🔥', '·'], smile: ['😊', '·'], flower: ['🌸', '·'],
    bolt: ['⚡', '·'], puzzle: ['🧩', '·'], number: ['🔢', '·'],
  };
  const [filled, empty] = iconMap[iconType] || iconMap.star;
  return (
    <div className="flex items-center gap-0.5 py-1">
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); onChange(i + 1 === current ? 0 : i + 1); }}
          className="text-sm leading-none hover:scale-125 transition-transform"
        >
          {i < current ? filled : empty}
        </button>
      ))}
    </div>
  );
}

// ── Date picker dropdown ──

function DatePickerDropdown({ value, showTime, onSelect, onClose }: {
  value: string;
  showTime: boolean;
  onSelect: (dateStr: string) => void;
  onClose: () => void;
}) {
  const initDate = value ? new Date(value) : new Date();
  const validInit = isNaN(initDate.getTime()) ? new Date() : initDate;
  const [viewYear, setViewYear] = useState(validInit.getFullYear());
  const [viewMonth, setViewMonth] = useState(validInit.getMonth());
  const [timeStr, setTimeStr] = useState(
    value && !isNaN(new Date(value).getTime())
      ? `${String(new Date(value).getHours()).padStart(2, '0')}:${String(new Date(value).getMinutes()).padStart(2, '0')}`
      : '00:00'
  );

  const selectedDate = value && !isNaN(new Date(value).getTime()) ? new Date(value) : null;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDayOfWeek).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

  const handleDayClick = (day: number) => {
    const [hh, mm] = timeStr.split(':').map(Number);
    const d = new Date(viewYear, viewMonth, day, showTime ? (hh || 0) : 0, showTime ? (mm || 0) : 0);
    onSelect(d.toISOString());
  };

  const handleClear = () => onSelect('');

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  const isToday = (day: number) => {
    const now = new Date();
    return viewYear === now.getFullYear() && viewMonth === now.getMonth() && day === now.getDate();
  };
  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    return viewYear === selectedDate.getFullYear() && viewMonth === selectedDate.getMonth() && day === selectedDate.getDate();
  };

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-date-picker]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div data-date-picker className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl w-64 select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <button onClick={prevMonth} className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-xs font-medium text-foreground">{viewYear}年 {MONTHS[viewMonth]}</span>
        <button onClick={nextMonth} className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
      </div>
      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0 px-2 pt-1">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-center text-[10px] text-muted-foreground py-0.5">{w}</div>
        ))}
      </div>
      {/* Days grid */}
      <div className="px-2 pb-2">
        {weeks.map((wk, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0">
            {wk.map((day, di) => (
              <button
                key={di}
                disabled={day === null}
                onClick={() => day && handleDayClick(day)}
                className={cn(
                  'h-7 w-full text-xs rounded transition-colors',
                  day === null && 'invisible',
                  day !== null && !isSelected(day) && !isToday(day) && 'hover:bg-accent text-foreground',
                  day !== null && isToday(day) && !isSelected(day) && 'text-sidebar-primary font-medium',
                  day !== null && isSelected(day) && 'bg-sidebar-primary text-sidebar-primary-foreground font-medium',
                )}
              >
                {day}
              </button>
            ))}
          </div>
        ))}
      </div>
      {/* Time input (for DateTime) */}
      {showTime && (
        <div className="px-3 pb-2 pt-1 border-t border-border flex items-center gap-2">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <input
            type="time"
            value={timeStr}
            onChange={e => setTimeStr(e.target.value)}
            className="bg-muted rounded px-2 py-1 text-xs text-foreground outline-none"
          />
        </div>
      )}
      {/* Footer */}
      <div className="px-3 pb-2 flex items-center justify-between">
        <button onClick={handleClear} className="text-[10px] text-muted-foreground hover:text-foreground">清除</button>
        <button onClick={() => { const now = new Date(); setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); handleDayClick(now.getDate()); }} className="text-[10px] text-sidebar-primary hover:opacity-80">今天</button>
      </div>
    </div>
  );
}

// ── Cell display ──

function CellDisplay({ value, col }: { value: unknown; col: nc.NCColumn }) {
  const { type: colType, primary_key: isPK } = col;

  if (value == null || value === '') {
    // Show placeholder for Attachment and User types even when empty
    if (colType === 'Attachment') {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><Upload className="h-3 w-3" /> 点击上传</span>;
    }
    if (colType === 'User' || colType === 'Collaborator') {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><User className="h-3 w-3" /> 选择成员</span>;
    }
    return <span className="text-xs py-1.5 block select-none">&nbsp;</span>;
  }

  const str = String(value);

  // Checkbox
  if (colType === 'Checkbox') {
    return (
      <div className="flex items-center justify-center py-1">
        <input type="checkbox" checked={!!value} readOnly className="w-4 h-4 accent-sidebar-primary cursor-pointer" />
      </div>
    );
  }

  // Rating
  if (colType === 'Rating') {
    const n = typeof value === 'number' ? value : parseInt(str) || 0;
    const meta = col.meta as Record<string, unknown> | undefined;
    const max = (meta?.max as number) || 5;
    const iconType = (meta?.iconIdx as string) || 'star';
    const iconMap: Record<string, [string, string]> = {
      star: ['★', '☆'], heart: ['❤', '♡'], thumb: ['👍', '·'], flag: ['🚩', '·'],
      fire: ['🔥', '·'], smile: ['😊', '·'], flower: ['🌸', '·'],
      bolt: ['⚡', '·'], puzzle: ['🧩', '·'], number: ['🔢', '·'],
    };
    const [filled, empty] = iconMap[iconType] || iconMap.star;
    return <span className="text-sm py-1 block select-none">{filled.repeat(n)}{empty.repeat(Math.max(0, max - n))}</span>;
  }

  // SingleSelect
  if (colType === 'SingleSelect') {
    const opt = col.options?.find(o => o.title === str);
    const color = opt?.color || SELECT_COLORS[0];
    return (
      <span className="inline-block px-2 py-0.5 rounded text-[11px] my-1" style={{ backgroundColor: color, color: '#1a1a2e' }}>
        {str}
      </span>
    );
  }

  // MultiSelect
  if (colType === 'MultiSelect') {
    const items = str.split(',').map(s => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-0.5 py-1">
        {items.map((item, i) => {
          const opt = col.options?.find(o => o.title === item);
          const color = opt?.color || SELECT_COLORS[i % SELECT_COLORS.length];
          return (
            <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: color, color: '#1a1a2e' }}>
              {item}
            </span>
          );
        })}
      </div>
    );
  }

  // URL
  if (colType === 'URL') {
    return (
      <a href={str} target="_blank" rel="noopener noreferrer"
        className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px] py-1.5"
        title={str} onClick={e => e.stopPropagation()}
      >
        {str.replace(/^https?:\/\//, '').slice(0, 40)}
      </a>
    );
  }

  // Email
  if (colType === 'Email') {
    return (
      <a href={`mailto:${str}`} className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px] py-1.5" onClick={e => e.stopPropagation()}>
        {str}
      </a>
    );
  }

  // PhoneNumber
  if (colType === 'PhoneNumber') {
    return (
      <a href={`tel:${str}`} className="text-xs text-sidebar-primary hover:underline py-1.5 block" onClick={e => e.stopPropagation()}>
        {str}
      </a>
    );
  }

  // Date / DateTime / CreatedTime / LastModifiedTime
  if (colType === 'Date' || colType === 'DateTime' || colType === 'CreatedTime' || colType === 'LastModifiedTime') {
    const d = new Date(str);
    if (isNaN(d.getTime())) return <span className="text-xs py-1.5 block text-foreground/70">{str}</span>;
    const meta = col.meta as Record<string, unknown> | undefined;
    const fmt = (meta?.date_format as string) || 'YYYY-MM-DD';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const formatted = fmt
      .replace('YYYY', String(y))
      .replace('MM', m)
      .replace('DD', day)
      .replace('HH', hh)
      .replace('mm', mm);
    // If format doesn't include HH:mm, append time for DateTime/system types
    const needsTime = colType !== 'Date' && !fmt.includes('HH');
    const timePart = needsTime ? ` ${hh}:${mm}` : '';
    return <span className="text-xs py-1.5 block text-foreground/70" title={str}>{formatted}{timePart}</span>;
  }

  // Time
  if (colType === 'Time') {
    return <span className="text-xs py-1.5 block text-foreground/70">{str}</span>;
  }

  // Year
  if (colType === 'Year') {
    return <span className="text-xs tabular-nums py-1.5 block">{str}</span>;
  }

  // Number / Decimal / Currency / Percent / AutoNumber
  if (colType === 'Number' || colType === 'Decimal' || colType === 'AutoNumber' || colType === 'Currency' || colType === 'Percent') {
    const num = parseFloat(str);
    if (isNaN(num)) return <span className="text-xs tabular-nums py-1.5 block text-right">{str}</span>;
    const meta = col.meta as Record<string, unknown> | undefined;
    const decimals = (meta?.decimals as number) ?? (colType === 'Decimal' || colType === 'Currency' ? 2 : colType === 'Percent' ? 1 : 0);
    const thousands = meta?.thousands ?? (colType === 'Currency');
    const prefix = (meta?.prefix as string) || (colType === 'Currency' ? '$' : '');
    const suffix = (meta?.suffix as string) || (colType === 'Percent' ? '%' : '');
    let formatted = thousands
      ? num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : num.toFixed(decimals);
    return <span className="text-xs tabular-nums py-1.5 block text-right">{prefix}{formatted}{suffix}</span>;
  }

  // JSON
  if (colType === 'JSON') {
    let display = str;
    try { display = JSON.stringify(JSON.parse(str), null, 1); } catch {}
    return <span className="text-xs py-1.5 block font-mono truncate max-w-[200px] text-foreground/70" title={display}>{display}</span>;
  }

  // Attachment
  if (colType === 'Attachment') {
    if (Array.isArray(value) && value.length === 0) {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><Upload className="h-3 w-3" /> 点击上传</span>;
    }
    try {
      const attachments = Array.isArray(value) ? value : JSON.parse(str);
      if (Array.isArray(attachments) && attachments.length > 0) {
        const isImage = (a: any) => a.mimetype?.startsWith('image/');
        return (
          <div className="flex gap-1 py-1 items-center">
            {attachments.slice(0, 3).map((a: any, i: number) => (
              isImage(a) ? (
                <img key={i} src={ncAttachmentUrl(a)} className="h-6 w-6 rounded object-cover border border-border" alt={a.title} title={a.title || a.path} />
              ) : (
                <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded truncate max-w-[80px] flex items-center gap-0.5" title={a.title || a.path}>
                  <Paperclip className="h-2.5 w-2.5 shrink-0" />
                  {a.title || `附件${i + 1}`}
                </span>
              )
            ))}
            {attachments.length > 3 && <span className="text-[10px] text-muted-foreground">+{attachments.length - 3}</span>}
          </div>
        );
      }
    } catch {}
    if (!str || str === '[]') {
      return (
        <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1">
          <Upload className="h-3 w-3" /> 点击上传
        </span>
      );
    }
    return <span className="text-xs py-1.5 block text-muted-foreground">{str.slice(0, 30)}</span>;
  }

  // User
  if (colType === 'User' || colType === 'Collaborator') {
    if (!str) return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><User className="h-3 w-3" /> 选择成员</span>;
    return (
      <span className="text-xs py-1.5 flex items-center gap-1 text-foreground/70">
        <User className="h-3 w-3 text-muted-foreground" />
        {str}
      </span>
    );
  }

  // CreatedBy / LastModifiedBy
  if (colType === 'CreatedBy' || colType === 'LastModifiedBy') {
    return (
      <span className="text-xs py-1.5 block text-foreground/70 flex items-center gap-1">
        <User className="h-3 w-3" />
        {str}
      </span>
    );
  }

  // Links — show count or empty, not "0"
  if (colType === 'Links' || colType === 'LinkToAnotherRecord') {
    const num = parseInt(str);
    if (!num || num === 0) return <span className="text-xs py-1.5 block select-none">&nbsp;</span>;
    return <span className="text-xs py-1.5 block text-sidebar-primary">{num} 条关联</span>;
  }

  // Formula / Rollup / Lookup / Count
  if (READONLY_TYPES.has(colType)) {
    return <span className="text-xs py-1.5 block text-foreground/50 italic">{str}</span>;
  }

  // Default: text
  return (
    <span className={cn('text-xs py-1.5 block truncate max-w-[300px]', isPK ? 'text-muted-foreground' : 'text-foreground')} title={str}>
      {str}
    </span>
  );
}

// ── Group rows (collapsible) ──

function GroupRows({ groupKey, count, colSpan, children }: {
  groupKey: string;
  count: number;
  colSpan: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <tr className="border-b border-border bg-muted/40">
        <td colSpan={colSpan} className="px-3 py-1.5">
          <button
            onClick={() => setCollapsed(v => !v)}
            className="flex items-center gap-2 text-xs font-medium text-foreground hover:text-sidebar-primary"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', collapsed && '-rotate-90')} />
            <span>{groupKey}</span>
            <span className="text-muted-foreground font-normal">({count})</span>
          </button>
        </td>
      </tr>
      {!collapsed && children}
    </>
  );
}

// ── Kanban DnD helpers ──

function KanbanColumn({ id, children, isOver }: { id: string; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn('w-64 shrink-0 flex flex-col rounded-lg transition-colors', isOver ? 'bg-sidebar-primary/10 ring-2 ring-sidebar-primary/30' : 'bg-muted/20')}>
      {children}
    </div>
  );
}

function KanbanCard({ id, children, isDragging }: { id: number; children: React.ReactNode; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="bg-card border border-border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow space-y-1.5 cursor-grab active:cursor-grabbing"
    >
      {children}
    </div>
  );
}

// ── Kanban View ──

function KanbanView({ rows, columns, activeView, isLoading, onUpdateRow, onAddRow, tableId, refreshMeta, hiddenCols }: {
  rows: Record<string, unknown>[];
  columns: nc.NCColumn[];
  activeView: nc.NCView;
  isLoading: boolean;
  onUpdateRow: (rowId: number, fields: Record<string, unknown>) => Promise<void>;
  onAddRow: () => void;
  tableId: string;
  refreshMeta: () => void;
  hiddenCols: Set<string>;
}) {
  const [grpColPicker, setGrpColPicker] = useState(false);
  const grpColId = activeView.fk_grp_col_id;
  const grpCol = columns.find(c => c.column_id === grpColId);
  const titleCol = columns.find(c => c.primary_key) || columns[0];

  // If no grouping column set, show picker
  if (!grpCol) {
    const selectCols = columns.filter(c => c.type === 'SingleSelect');
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-card border border-border rounded-xl p-6 max-w-sm text-center space-y-3">
          <Columns className="h-8 w-8 mx-auto text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">选择分组字段</h3>
          <p className="text-xs text-muted-foreground">看板视图需要一个单选字段来分组卡片</p>
          {selectCols.length > 0 ? (
            <div className="space-y-1">
              {selectCols.map(c => (
                <button
                  key={c.column_id}
                  onClick={async () => {
                    await nc.updateKanbanConfig(activeView.view_id, { fk_grp_col_id: c.column_id });
                    refreshMeta();
                  }}
                  className="w-full px-3 py-2 text-xs bg-muted hover:bg-accent rounded-lg text-foreground"
                >
                  {c.title}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">没有单选字段，请先添加一个 SingleSelect 列</p>
          )}
        </div>
      </div>
    );
  }

  // Group rows by the column value
  const isSelectCol = grpCol.type === 'SingleSelect' || grpCol.type === 'MultiSelect';
  const options = isSelectCol ? (grpCol.options || []) : [];
  const groups: Record<string, Record<string, unknown>[]> = {};
  const uncategorized: Record<string, unknown>[] = [];

  if (isSelectCol) {
    // For select columns, pre-create groups from defined options
    for (const opt of options) {
      groups[opt.title] = [];
    }
  }
  for (const row of rows) {
    const val = row[grpCol.title] as string;
    if (val) {
      if (!groups[val]) groups[val] = [];
      groups[val].push(row);
    } else {
      uncategorized.push(row);
    }
  }
  // Build ordered group keys: select options first (in defined order), then dynamic values
  const groupKeys: string[] = isSelectCol
    ? [...options.map(o => o.title).filter(t => groups[t]?.length > 0), ...Object.keys(groups).filter(k => !options.some(o => o.title === k))]
    : Object.keys(groups).sort();

  if (isLoading) {
    return (
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {[1, 2, 3].map(i => (
          <div key={i} className="w-64 shrink-0 space-y-2">
            <div className="h-6 rounded bg-muted/50 animate-pulse" />
            <div className="h-24 rounded bg-muted/30 animate-pulse" />
            <div className="h-24 rounded bg-muted/30 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const getOptColor = (title: string, idx?: number) => {
    if (isSelectCol) {
      const opt = options.find(o => o.title === title);
      return opt?.color || SELECT_COLORS[(idx ?? options.indexOf(opt!)) % SELECT_COLORS.length] || SELECT_COLORS[0];
    }
    // For non-select columns, assign colors based on group index
    return SELECT_COLORS[(idx ?? 0) % SELECT_COLORS.length];
  };

  // Kanban drag-and-drop state
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const kanbanSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const allGroupKeys = [...groupKeys, ...(uncategorized.length ? ['__uncategorized__'] : [])];

  const handleKanbanDragStart = (event: DragStartEvent) => {
    setDraggedRowId(event.active.id as number);
  };

  const handleKanbanDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id as string | undefined;
    if (!overId) { setDragOverGroup(null); return; }
    // overId could be a group key (droppable) or a row id (sortable within)
    if (allGroupKeys.includes(overId)) {
      setDragOverGroup(overId);
    } else {
      // Find which group this row belongs to
      for (const gk of allGroupKeys) {
        const gRows = gk === '__uncategorized__' ? uncategorized : (groups[gk] || []);
        if (gRows.some(r => (r.Id as number) === Number(overId))) {
          setDragOverGroup(gk);
          break;
        }
      }
    }
  };

  const handleKanbanDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedRowId(null);
    setDragOverGroup(null);
    if (!over || !grpCol) return;
    const rowId = active.id as number;
    const overId = String(over.id);

    // Determine target group
    let targetGroup: string | null = null;
    if (allGroupKeys.includes(overId)) {
      targetGroup = overId;
    } else {
      for (const gk of allGroupKeys) {
        const gRows = gk === '__uncategorized__' ? uncategorized : (groups[gk] || []);
        if (gRows.some(r => (r.Id as number) === Number(overId))) {
          targetGroup = gk;
          break;
        }
      }
    }
    if (!targetGroup) return;

    // Find current group of dragged row
    const draggedRow = rows.find(r => (r.Id as number) === rowId);
    if (!draggedRow) return;
    const currentVal = draggedRow[grpCol.title] as string || '';
    const currentGroup = currentVal || '__uncategorized__';
    if (currentGroup === targetGroup) return; // same group, no change

    const newVal = targetGroup === '__uncategorized__' ? '' : targetGroup;
    await onUpdateRow(rowId, { [grpCol.title]: newVal });
  };

  return (
    <DndContext sensors={kanbanSensors} onDragStart={handleKanbanDragStart} onDragOver={handleKanbanDragOver} onDragEnd={handleKanbanDragEnd}>
    <div className="flex-1 flex gap-3 p-3 overflow-x-auto">
      {allGroupKeys.map((groupKey, gIdx) => {
        const isUncat = groupKey === '__uncategorized__';
        const groupRows = isUncat ? uncategorized : (groups[groupKey] || []);
        return (
          <KanbanColumn key={groupKey} id={groupKey} isOver={dragOverGroup === groupKey}>
            <div className="px-3 py-2 flex items-center gap-2 border-b border-border">
              {!isUncat && (
                <span
                  className="px-2 py-0.5 rounded text-[11px] font-medium"
                  style={{ backgroundColor: getOptColor(groupKey, gIdx), color: '#1a1a2e' }}
                >
                  {groupKey}
                </span>
              )}
              {isUncat && <span className="text-xs text-muted-foreground">未分类</span>}
              <span className="text-[10px] text-muted-foreground ml-auto">{groupRows.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {groupRows.map((row, i) => {
                const rowId = row.Id as number;
                return (
                  <KanbanCard key={rowId ?? i} id={rowId} isDragging={draggedRowId === rowId}>
                    <div className="text-xs font-medium text-foreground truncate">
                      {titleCol ? String(row[titleCol.title] ?? '') : `#${rowId}`}
                    </div>
                    {columns.filter(c => c !== titleCol && c !== grpCol && !c.primary_key && c.title !== 'created_by' && !hiddenCols.has(c.column_id)).slice(0, 3).map(c => {
                      const val = row[c.title];
                      if (val == null || val === '') return null;
                      return (
                        <div key={c.column_id} className="flex items-start gap-1">
                          <span className="text-[10px] text-muted-foreground shrink-0">{c.title}:</span>
                          <span className="text-[10px] text-foreground/80 truncate">{String(val)}</span>
                        </div>
                      );
                    })}
                  </KanbanCard>
                );
              })}
            </div>
          </KanbanColumn>
        );
      })}
    </div>
    </DndContext>
  );
}

// ── Gallery View ──

function GalleryView({ rows, columns, isLoading, onAddRow, hiddenCols }: {
  rows: Record<string, unknown>[];
  columns: nc.NCColumn[];
  isLoading: boolean;
  onAddRow: () => void;
  hiddenCols: Set<string>;
}) {
  const titleCol = columns.find(c => c.primary_key) || columns[0];
  const detailCols = columns.filter(c => c !== titleCol && c.title !== 'created_by' && !READONLY_TYPES.has(c.type) && !hiddenCols.has(c.column_id)).slice(0, 4);

  if (isLoading) {
    return (
      <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-40 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map((row, i) => {
          const rowId = row.Id as number;
          return (
            <div
              key={rowId ?? i}
              className="bg-card border border-border rounded-lg p-4 hover:shadow-lg transition-shadow space-y-2"
            >
              <div className="text-sm font-semibold text-foreground truncate">
                {titleCol ? String(row[titleCol.title] ?? '') : `#${rowId}`}
              </div>
              {detailCols.map(c => {
                const val = row[c.title];
                if (val == null || val === '') return null;
                const ColIcon = getColIcon(c.type);
                return (
                  <div key={c.column_id} className="flex items-start gap-1.5">
                    <ColIcon className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[10px] text-muted-foreground">{c.title}</div>
                      <div className="text-xs text-foreground/80 truncate max-w-[200px]">{String(val)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        <button
          onClick={onAddRow}
          className="border-2 border-dashed border-border rounded-lg p-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <Plus className="h-5 w-5 mr-1" /> 新增
        </button>
      </div>
    </div>
  );
}

// ── Form View ──

function FormView({ columns, tableId, onSubmit }: {
  columns: nc.NCColumn[];
  tableId: string;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(formData);
      setFormData({});
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2000);
    } catch {}
    setSubmitting(false);
  };

  return (
    <div className="flex-1 overflow-auto flex justify-center py-8">
      <div className="w-full max-w-lg space-y-4 px-4">
        <h3 className="text-lg font-semibold text-foreground">新增记录</h3>
        {columns.map(col => {
          const ColIcon = getColIcon(col.type);
          return (
            <div key={col.column_id} className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ColIcon className="h-3 w-3" />
                {col.title}
                {col.required && <span className="text-destructive">*</span>}
              </label>
              {col.type === 'LongText' ? (
                <textarea
                  value={formData[col.title] || ''}
                  onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.value }))}
                  rows={3}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none"
                  placeholder={col.title}
                />
              ) : col.type === 'Checkbox' ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData[col.title] === 'true'}
                    onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.checked ? 'true' : '' }))}
                    className="rounded border-border"
                  />
                  <span className="text-xs text-foreground">是</span>
                </label>
              ) : col.type === 'SingleSelect' && col.options?.length ? (
                <select
                  value={formData[col.title] || ''}
                  onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.value }))}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="">选择...</option>
                  {col.options.map(o => <option key={o.title} value={o.title}>{o.title}</option>)}
                </select>
              ) : (
                <input
                  value={formData[col.title] || ''}
                  onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.value }))}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  placeholder={col.title}
                  type={col.type === 'Email' ? 'email' : col.type === 'URL' ? 'url' : 'text'}
                  inputMode={['Number', 'Decimal', 'Currency', 'Percent'].includes(col.type) ? 'decimal' : undefined}
                />
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 bg-sidebar-primary text-sidebar-primary-foreground text-sm rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '提交中...' : '提交'}
          </button>
          {submitted && <span className="text-xs text-green-500">提交成功 ✓</span>}
        </div>
      </div>
    </div>
  );
}

// ── Calendar View ──

function CalendarView({ rows, columns, isLoading }: {
  rows: Record<string, unknown>[];
  columns: nc.NCColumn[];
  isLoading: boolean;
}) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Find date/datetime columns
  const dateCol = columns.find(c => c.type === 'Date' || c.type === 'DateTime');
  const titleCol = columns.find(c => c.primary_key) || columns[0];

  if (!dateCol) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-card border border-border rounded-xl p-6 max-w-sm text-center space-y-3">
          <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">需要日期字段</h3>
          <p className="text-xs text-muted-foreground">日历视图需要一个日期或日期时间字段来定位事件</p>
        </div>
      </div>
    );
  }

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Group rows by date
  const rowsByDate: Record<string, Record<string, unknown>[]> = {};
  for (const row of rows) {
    const dateVal = row[dateCol.title];
    if (!dateVal) continue;
    const dateStr = String(dateVal).slice(0, 10); // YYYY-MM-DD
    if (!rowsByDate[dateStr]) rowsByDate[dateStr] = [];
    rowsByDate[dateStr].push(row);
  }

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  if (isLoading) {
    return <div className="flex-1 p-4"><div className="h-full rounded bg-muted/50 animate-pulse" /></div>;
  }

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
        <h3 className="text-sm font-semibold text-foreground">{year}年{month + 1}月</h3>
        <button onClick={nextMonth} className="p-1 text-muted-foreground hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden flex-1">
        {weekDays.map(d => (
          <div key={d} className="bg-muted/30 px-1 py-1.5 text-center text-[10px] text-muted-foreground font-medium">{d}</div>
        ))}
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`pad-${i}`} className="bg-card/50 min-h-[80px]" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayRows = rowsByDate[dateStr] || [];
          const isToday = dateStr === todayStr;
          return (
            <div key={day} className={cn('bg-card min-h-[80px] p-1', isToday && 'ring-1 ring-sidebar-primary ring-inset')}>
              <div className={cn('text-[10px] mb-0.5', isToday ? 'text-sidebar-primary font-bold' : 'text-muted-foreground')}>
                {day}
              </div>
              <div className="space-y-0.5">
                {dayRows.slice(0, 3).map((row, ri) => (
                  <div
                    key={ri}
                    className="text-[9px] px-1 py-0.5 rounded bg-sidebar-primary/10 text-sidebar-primary truncate"
                    title={String(row[titleCol.title] ?? '')}
                  >
                    {String(row[titleCol.title] ?? '')}
                  </div>
                ))}
                {dayRows.length > 3 && (
                  <div className="text-[9px] text-muted-foreground px-1">+{dayRows.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
