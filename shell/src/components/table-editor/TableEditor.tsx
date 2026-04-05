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
  Download, Upload, Eye, EyeOff, SlidersHorizontal, Lock, Loader2,
  Copy, CopyPlus, ArrowLeftFromLine, ArrowRightFromLine, Snowflake, Group, AlignVerticalSpaceAround,
  Settings, Info, GripVertical, ToggleLeft, ToggleRight, ArrowUpNarrowWide,
  CreditCard, Image, MessageSquare, UserCheck, RotateCcw,
} from 'lucide-react';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { DndContext, closestCenter, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import * as br from '@/lib/api/baserow';
import * as gw from '@/lib/api/gateway';
import { RowDetailPanel } from './RowDetailPanel';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { LinkRecordPicker } from './LinkRecordPicker';
import TableHistory, { SnapshotPreview } from './TableHistory';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EditFAB } from '@/components/shared/EditFAB';

// ── Column type config ──

interface ColTypeDef {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'text' | 'number' | 'datetime' | 'select' | 'relation' | 'other';
}

const COLUMN_TYPES: ColTypeDef[] = [
  // Text
  { value: 'SingleLineText', label: 'SingleLineText', icon: Type, group: 'text' },
  { value: 'LongText', label: 'LongText', icon: AlignLeft, group: 'text' },
  { value: 'Email', label: 'Email', icon: Mail, group: 'text' },
  { value: 'URL', label: 'URL', icon: Link, group: 'text' },
  { value: 'PhoneNumber', label: 'PhoneNumber', icon: Phone, group: 'text' },
  // Number
  { value: 'Number', label: 'Number', icon: Hash, group: 'number' },
  { value: 'Decimal', label: 'Decimal', icon: Hash, group: 'number' },
  { value: 'Currency', label: 'Currency', icon: DollarSign, group: 'number' },
  { value: 'Percent', label: 'Percent', icon: Percent, group: 'number' },
  { value: 'Rating', label: 'Rating', icon: Star, group: 'number' },
  { value: 'AutoNumber', label: 'AutoNumber', icon: Hash, group: 'number' },
  // Date & Time
  { value: 'Date', label: 'Date', icon: Calendar, group: 'datetime' },
  { value: 'DateTime', label: 'DateTime', icon: Calendar, group: 'datetime' },
  // Selection
  { value: 'Checkbox', label: 'Checkbox', icon: CheckSquare, group: 'select' },
  { value: 'SingleSelect', label: 'SingleSelect', icon: List, group: 'select' },
  { value: 'MultiSelect', label: 'MultiSelect', icon: Tags, group: 'select' },
  // Relation & Computed
  { value: 'Links', label: 'Links', icon: Link2, group: 'relation' },
  { value: 'Lookup', label: 'Lookup', icon: Search, group: 'relation' },
  { value: 'Rollup', label: 'Rollup', icon: Sigma, group: 'relation' },
  { value: 'Formula', label: 'Formula', icon: GitBranch, group: 'relation' },
  // Other
  { value: 'Attachment', label: 'Attachment', icon: Paperclip, group: 'other' },
  { value: 'JSON', label: 'JSON', icon: Braces, group: 'other' },
  { value: 'User', label: 'User', icon: User, group: 'other' },
  { value: 'CreatedBy', label: 'CreatedBy', icon: UserCheck, group: 'other' },
  { value: 'LastModifiedBy', label: 'LastModifiedBy', icon: UserCheck, group: 'other' },
];

// label field now stores the colType key; use tColType() to get translated label
function tColType(t: (key: string) => string, ct: ColTypeDef): string {
  return t(`dataTable.colTypes.${ct.value}`);
}

const GROUP_KEYS = ['text', 'number', 'datetime', 'select', 'relation', 'other'] as const;

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
  // NocoDB relative path — use query-param route to avoid Next.js file-extension routing issues
  return `/api/gateway/data/dl?path=${encodeURIComponent(p)}`;
}

// ── Compact cell display for kanban/gallery views ──
function CompactCellDisplay({ value, col }: { value: unknown; col: br.BRColumn }) {
  if (value == null || value === '') return null;
  const colType = col.type;

  // Attachment — show thumbnails
  if (colType === 'Attachment') {
    try {
      const arr = Array.isArray(value) ? value : JSON.parse(String(value));
      if (Array.isArray(arr) && arr.length > 0) {
        return (
          <div className="flex gap-1 py-0.5 items-center">
            {arr.slice(0, 3).map((a: any, i: number) => (
              a.mimetype?.startsWith('image/') ? (
                <img key={i} src={ncAttachmentUrl(a)} className="h-5 w-5 rounded object-cover border border-border" alt="" />
              ) : (
                <span key={i} className="text-[9px] bg-muted px-1 py-0.5 rounded truncate max-w-[60px] flex items-center gap-0.5">
                  <Paperclip className="h-2 w-2 shrink-0" />{a.title || 'file'}
                </span>
              )
            ))}
            {arr.length > 3 && <span className="text-[9px] text-muted-foreground">+{arr.length - 3}</span>}
          </div>
        );
      }
    } catch {}
    return null;
  }

  // Links — show count
  if (colType === 'Links' || colType === 'LinkToAnotherRecord') {
    const arr = Array.isArray(value) ? value : [];
    const num = arr.length || parseInt(String(value)) || 0;
    return num > 0 ? <span className="text-[10px] text-sidebar-primary">{num}</span> : null;
  }

  // SingleSelect — colored badge
  if (colType === 'SingleSelect') {
    const str = String(value);
    const opt = col.options?.find(o => o.title === str);
    const color = opt?.color || SELECT_COLORS[0];
    return <span className="inline-block px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: color, color: '#1a1a2e' }}>{str}</span>;
  }

  // MultiSelect — colored badges
  if (colType === 'MultiSelect') {
    const items = String(value).split(',').map(s => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-0.5">
        {items.map((item, i) => {
          const opt = col.options?.find(o => o.title === item);
          const color = opt?.color || SELECT_COLORS[i % SELECT_COLORS.length];
          return <span key={i} className="inline-block px-1 py-0.5 rounded text-[9px]" style={{ backgroundColor: color, color: '#1a1a2e' }}>{item}</span>;
        })}
      </div>
    );
  }

  // Checkbox
  if (colType === 'Checkbox') {
    return <span className="text-[10px]">{value ? '✓' : ''}</span>;
  }

  // Default — safe string conversion
  const str = typeof value === 'object' ? (Array.isArray(value) ? value.map(String).join(', ') : JSON.stringify(value)) : String(value);
  return <span className="text-[10px] text-foreground/80 truncate">{str}</span>;
}

// ── Filter operators ──
const FILTER_OPS = [
  { value: 'eq', key: 'eq' },
  { value: 'neq', key: 'neq' },
  { value: 'like', key: 'like' },
  { value: 'nlike', key: 'nlike' },
  { value: 'gt', key: 'gt' },
  { value: 'gte', key: 'gte' },
  { value: 'lt', key: 'lt' },
  { value: 'lte', key: 'lte' },
  { value: 'is', key: 'is' },
  { value: 'isnot', key: 'isnot' },
  { value: 'checked', key: 'checked' },
  { value: 'notchecked', key: 'notchecked' },
];

// Type-specific filter operators
const TEXT_FILTER_OPS = ['eq', 'neq', 'like', 'nlike', 'is', 'isnot'];
const NUM_FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'isnot'];
const DATE_FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'isnot'];
const BOOL_FILTER_OPS = ['checked', 'notchecked'];
const SELECT_FILTER_OPS = ['eq', 'neq', 'like', 'nlike', 'is', 'isnot'];
const LINK_USER_FILTER_OPS = ['eq', 'neq', 'like', 'nlike', 'is', 'isnot'];

function getFilterOpsForType(colType?: string): typeof FILTER_OPS {
  if (!colType) return FILTER_OPS;
  const numTypes = new Set(['Number', 'Decimal', 'Currency', 'Percent', 'Rating', 'Duration', 'AutoNumber']);
  const textTypes = new Set(['SingleLineText', 'LongText', 'Email', 'URL', 'PhoneNumber', 'JSON']);
  const dateTypes = new Set(['Date', 'DateTime', 'CreatedTime', 'LastModifiedTime']);
  const selectTypes = new Set(['SingleSelect', 'MultiSelect']);
  const linkUserTypes = new Set(['Links', 'LinkToAnotherRecord', 'User', 'CreatedBy', 'LastModifiedBy']);

  let allowed: string[];
  if (colType === 'Checkbox') allowed = BOOL_FILTER_OPS;
  else if (numTypes.has(colType)) allowed = NUM_FILTER_OPS;
  else if (dateTypes.has(colType)) allowed = DATE_FILTER_OPS;
  else if (selectTypes.has(colType)) allowed = SELECT_FILTER_OPS;
  else if (linkUserTypes.has(colType)) allowed = LINK_USER_FILTER_OPS;
  else if (textTypes.has(colType)) allowed = TEXT_FILTER_OPS;
  else return FILTER_OPS;

  return FILTER_OPS.filter(op => allowed.includes(op.value));
}

// ── View type config ──
const VIEW_TYPES = [
  { type: 'grid', typeNum: 3, key: 'grid', icon: LayoutGrid },
  { type: 'kanban', typeNum: 4, key: 'kanban', icon: Columns },
  { type: 'gallery', typeNum: 2, key: 'gallery', icon: GalleryHorizontalEnd },
  { type: 'form', typeNum: 1, key: 'form', icon: FileText },
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

function SortableAttachmentItem({ id, children }: { id: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
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
    <th ref={setRefs} style={style} className={className} data-col-id={id} {...attributes} {...listeners}>
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
  breadcrumb?: { id: string; title: string }[];
  onBack: () => void;
  onDeleted?: () => void;
  onDuplicate?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}

// Error Boundary to prevent white-screen crashes
class TableEditorErrorBoundary extends React.Component<
  { children: React.ReactNode; onBack: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; onBack: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <p className="text-destructive font-medium">Table rendering error</p>
          <p className="text-sm text-muted-foreground max-w-md text-center">{this.state.error?.message}</p>
          <div className="flex gap-2">
            <button onClick={() => this.setState({ hasError: false, error: null })} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded">Retry</button>
            <button onClick={this.props.onBack} className="px-3 py-1.5 text-sm border rounded">Back</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function TableEditor(props: TableEditorProps) {
  return (
    <TableEditorErrorBoundary onBack={props.onBack}>
      <TableEditorInner {...props} />
    </TableEditorErrorBoundary>
  );
}

function TableEditorInner({ tableId, breadcrumb, onBack, onDeleted, onDuplicate, onCopyLink, docListVisible, onToggleDocList }: TableEditorProps) {
  const { t } = useT();
  const isMobile = useIsMobile();
  const [mobileEditing, setMobileEditing] = useState(false);
  // On mobile, default to read-only preview; on desktop always editable
  const mobilePreview = isMobile && !mobileEditing;
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
  const [editFieldAnchor, setEditFieldAnchor] = useState<{ x: number; y: number } | null>(null); // anchor position for edit field popup
  const [showTypeSelector, setShowTypeSelector] = useState(false); // expand type list in Edit Field dialog
  const [numFormat, setNumFormat] = useState<{ decimals: number; thousands: boolean; prefix: string; suffix: string }>({ decimals: 0, thousands: false, prefix: '', suffix: '' });
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [decimalPrecision, setDecimalPrecision] = useState(2);
  const [durationFormat, setDurationFormat] = useState(0); // NocoDB duration format index
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
  const [newColUserNotify, setNewColUserNotify] = useState(false);
  // Title editing now handled by ContentTopBar
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showTableComments, setShowTableComments] = useState(false);
  const [selectDropdown, setSelectDropdown] = useState<{ rowId: number; col: string; options: br.BRSelectOption[]; multi: boolean } | null>(null);
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
  const [linkPicker, setLinkPicker] = useState<{ rowId: number; column: br.BRColumn } | null>(null);
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
  const attachmentTargetRef = useRef<{ rowId: number; col: string } | null>(null);
  // Attachment dropdown state (list view)
  const [attachmentDropdown, setAttachmentDropdown] = useState<{ rowId: number; col: string } | null>(null);
  // Toolbar panel state — single active panel
  const [activeToolbarPanel, setActiveToolbarPanel] = useState<'fields' | 'filter' | 'groupby' | 'sort' | 'rowheight' | 'kanban-group' | 'kanban-card' | 'gallery-card' | null>(null);
  // History panel state
  const [showHistory, setShowHistory] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<SnapshotPreview | null>(null);
  const toggleToolbarPanel = (panel: typeof activeToolbarPanel) => {
    setActiveToolbarPanel(prev => prev === panel ? null : panel);
  };
  // Field management state
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const gridScrollRef = useRef<HTMLDivElement>(null);
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

  // Default sort by Id for stable row ordering.
  // New tables use auto-increment integer Id (uidt=ID), so numeric sort works correctly.
  // Old tables with SingleLineText Id will sort lexicographically — acceptable tradeoff.
  const sortParam = sortCol ? (sortDir === 'desc' ? `-${sortCol}` : sortCol) : undefined;

  const { data: meta, isError: metaError, error: metaErrorDetail } = useQuery({
    queryKey: ['nc-table-meta', tableId],
    queryFn: () => br.describeTable(tableId),
    retry: 2,
  });

  // Set active view when meta loads or tableId changes — merged to avoid race condition
  useEffect(() => {
    if (!meta || meta.table_id !== tableId) {
      setActiveViewId(null);
      return;
    }
    if (meta.views?.length) {
      const savedViewId = localStorage.getItem(`asuite-table-last-view-${tableId}`);
      const savedView = savedViewId ? meta.views.find(v => v.view_id === savedViewId) : null;
      const defaultView = savedView || meta.views.find(v => v.is_default) || meta.views[0];
      setActiveViewId(defaultView.view_id);
    }
  }, [meta?.table_id, tableId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save active view to localStorage when it changes
  useEffect(() => {
    if (activeViewId) {
      localStorage.setItem(`asuite-table-last-view-${tableId}`, activeViewId);
    }
  }, [activeViewId, tableId]);

  const views = meta?.views || [];

  // View filters
  const { data: viewFilters } = useQuery({
    queryKey: ['nc-view-filters', activeViewId],
    queryFn: () => br.listFilters(activeViewId!),
    enabled: !!activeViewId,
  });

  // View sorts
  const { data: viewSorts } = useQuery({
    queryKey: ['nc-view-sorts', activeViewId],
    queryFn: () => br.listSorts(activeViewId!),
    enabled: !!activeViewId,
  });

  // Build NocoDB where clause from view filters: (field,op,value)~and(field2,op2,value2)
  const whereParam = useMemo(() => {
    if (!viewFilters?.length || !meta?.columns) return undefined;
    const parts = viewFilters.map(f => {
      const col = meta.columns.find(c => c.column_id === f.fk_column_id);
      if (!col) return null;
      const field = col.title;
      const op = f.comparison_op;
      // Null-check ops don't need a value
      if (op === 'is' || op === 'isnot' || op === 'empty' || op === 'notempty'
          || op === 'null' || op === 'notnull' || op === 'blank' || op === 'notblank'
          || op === 'checked' || op === 'notchecked') {
        return `(${field},${op},)`;
      }
      return `(${field},${op},${f.value ?? ''})`;
    }).filter(Boolean);
    if (parts.length === 0) return undefined;
    return parts.join('~and');
  }, [viewFilters, meta?.columns]);

  // Build sort param from view sorts (view sorts take precedence, manual sort overrides)
  const effectiveSortParam = useMemo(() => {
    if (sortParam) return sortParam; // manual sort from column header click
    if (!viewSorts?.length || !meta?.columns) return 'Id';
    const parts = viewSorts
      .sort((a, b) => a.order - b.order)
      .map(s => {
        const col = meta.columns.find(c => c.column_id === s.fk_column_id);
        if (!col) return null;
        return s.direction === 'desc' ? `-${col.title}` : col.title;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(',') : 'Id';
  }, [viewSorts, meta?.columns, sortParam]);

  // Always query from table (not view) — NocoDB view-scoped queries strip columns hidden
  // in NocoDB's native view settings, which breaks Kanban grouping and card field display.
  // Shell manages column visibility independently via Gateway view_column_settings.
  // Filters and sorts from the view are applied as query params.
  const { data: rowsData, isLoading, isFetching } = useQuery({
    queryKey: ['nc-rows', tableId, activeViewId, page, effectiveSortParam, whereParam || '__no_filter__'],
    queryFn: () => br.queryRows(tableId, { limit: pageSize, offset: (page - 1) * pageSize, sort: effectiveSortParam, where: whereParam }),
    enabled: !!meta,
    placeholderData: keepPreviousData,
  });

  // View columns (field visibility/width per view)
  const { data: viewColumns } = useQuery({
    queryKey: ['nc-view-columns', activeViewId],
    queryFn: () => br.listViewColumns(activeViewId!),
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

  // All tables (for Links creation) — from content-items cache
  const { data: allContentItems } = useQuery({
    queryKey: ['content-items'],
    queryFn: gw.listContentItems,
    enabled: showAddCol,
    staleTime: 30_000,
  });
  const allTables = useMemo(() =>
    allContentItems?.filter(i => i.type === 'table').map(i => ({ id: i.raw_id, title: i.title, created_at: i.created_at || undefined })) as br.BRTable[] | undefined,
    [allContentItems]
  );

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
    queryFn: () => br.describeTable(relatedTableId),
    enabled: !!relatedTableId && (newColType === 'Lookup' || newColType === 'Rollup'),
  });

  // Agents list (for User field picker in cells)
  const { data: agentsList } = useQuery({
    queryKey: ['agents-list'],
    queryFn: gw.listAgents,
    staleTime: 60000,
  });

  const displayCols = useMemo(() => {
    const cols = (meta?.columns || []).filter(c => c.title !== 'created_by' && c.type !== 'ID' && !(c.title === 'Id' && c.primary_key));
    // If no column has primary_key after hiding ID type, promote the first column
    if (cols.length > 0 && !cols.some(c => c.primary_key)) {
      cols[0] = { ...cols[0], primary_key: true };
    }
    return cols;
  }, [meta?.columns]);
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

  // ── Mobile: prevent body scroll when horizontally scrolling the table grid ──
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let locked = false;
    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      locked = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (!locked && dx > dy && dx > 10) {
        locked = true; // horizontal scroll detected
      }
      if (locked) {
        e.preventDefault(); // prevent body scroll during horizontal table scroll
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

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
    queryClient.setQueryData(['nc-view-columns', activeViewId], (old: br.BRViewColumn[] | undefined) => {
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
      br.updateViewColumn(activeViewId, col.column_id, { order: idx + 1 })
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
    queryClient.setQueryData(['nc-view-columns', activeViewId], (old: br.BRViewColumn[] | undefined) => {
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
      br.updateViewColumn(activeViewId, col.column_id, { order: idx + 1 })
    );
    await Promise.all(promises).catch(() => {});
    refreshViewColumns();
  }, [visibleCols, activeViewId, refreshViewColumns, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── View handlers ──
  const handleCreateView = async () => {
    if (!newViewTitle.trim()) return;
    try {
      const view = await br.createView(tableId, newViewTitle.trim(), newViewType);
      setNewViewTitle('');
      setNewViewType('grid');
      setShowCreateView(false);
      refreshMeta();
      setActiveViewId(view.view_id);
    } catch (e) { console.error('Create view failed:', e); }
  };

  const handleRenameView = async (viewId: string) => {
    if (!viewTitleValue.trim()) { setEditingViewTitle(null); return; }
    try {
      await br.renameView(viewId, viewTitleValue.trim());
      refreshMeta();
    } catch (e) { console.error('Rename view failed:', e); }
    setEditingViewTitle(null);
  };

  const handleDeleteView = async (viewId: string) => {
    try {
      await br.deleteView(viewId);
      refreshMeta();
      if (activeViewId === viewId) setActiveViewId(null);
    } catch (e) { console.error('Delete view failed:', e); }
    setViewMenu(null);
  };

  const handleAddFilter = async () => {
    if (!activeViewId || !newFilterCol) return;
    try {
      await br.createFilter(activeViewId, { fk_column_id: newFilterCol, comparison_op: newFilterOp, value: newFilterVal });
      refreshFilters();
      refresh();
      setNewFilterCol('');
      setNewFilterVal('');
    } catch (e) { console.error('Add filter failed:', e); }
  };

  const handleDeleteFilter = async (filterId: string) => {
    try {
      await br.deleteFilter(filterId);
      refreshFilters();
      refresh();
    } catch (e) { console.error('Delete filter failed:', e); }
  };

  const handleUpdateFilter = async (filterId: string, updates: { fk_column_id?: string; comparison_op?: string; value?: string }) => {
    try {
      await br.updateFilter(filterId, updates);
      refreshFilters();
      refresh();
    } catch (e) { console.error('Update filter failed:', e); }
  };

  const handleAddSort = async () => {
    if (!activeViewId || !newSortCol) return;
    try {
      await br.createSort(activeViewId, { fk_column_id: newSortCol, direction: newSortDir });
      refreshSorts();
      refresh();
      setNewSortCol('');
    } catch (e) { console.error('Add sort failed:', e); }
  };

  // Sort from column header menu — syncs with toolbar sort via API
  const handleColumnSort = async (columnId: string, direction: 'asc' | 'desc') => {
    if (!activeViewId) return;
    // Remove existing sort on this column if any
    const existingSort = viewSorts?.find(s => s.fk_column_id === columnId);
    if (existingSort) {
      try { await br.deleteSort(existingSort.sort_id); } catch (e) { console.error('Delete existing sort failed:', e); }
    }
    try {
      await br.createSort(activeViewId, { fk_column_id: columnId, direction });
      refreshSorts();
      refresh();
    } catch (e) { console.error('Create sort failed:', e); }
  };

  const handleDeleteSort = async (sortId: string) => {
    try {
      await br.deleteSort(sortId);
      refreshSorts();
      refresh();
    } catch (e) { console.error('Delete sort failed:', e); }
  };

  const handleUpdateSort = async (sortId: string, updates: { fk_column_id?: string; direction?: string }) => {
    try {
      await br.updateSort(sortId, updates);
      refreshSorts();
      refresh();
    } catch (e) { console.error('Update sort failed:', e); }
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
      if (!Array.isArray(data.list)) return old;
      return {
        ...data,
        list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: newVal } : r),
      };
    });
    try {
      await br.updateRow(tableId, rowId, { [col]: newVal });
      refresh(); // Sync with server. Row order is stable with numeric Id sort.
    } catch (e) {
      console.error('Update failed:', e);
      refresh(); // revert on error
    }
  }, [editingCell, editValue, tableId, queryClient]);

  const toggleCheckbox = async (rowId: number, col: string, current: unknown) => {
    const newVal = !current;
    // Optimistic update
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
      if (!data) return old;
      return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: newVal } : r) };
    });
    try {
      // NocoDB/PostgreSQL requires boolean values, not integers (1/0 causes type error)
      await br.updateRow(tableId, rowId, { [col]: newVal });
    } catch (e) {
      console.error('Toggle failed:', e);
      // Rollback optimistic update
      queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
        const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
        if (!data) return old;
        return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: current } : r) };
      });
    }
  };

  // Helper: ensure a select option exists in the column definition before using it
  const ensureSelectOption = async (colTitle: string, optionTitle: string) => {
    const colDef = meta?.columns?.find(c => c.title === colTitle);
    if (!colDef) return;
    const exists = colDef.options?.some(o => o.title === optionTitle);
    if (!exists) {
      // Add the new option to the column definition
      const updatedOptions = [
        ...(colDef.options || []),
        { title: optionTitle, color: SELECT_COLORS[(colDef.options?.length || 0) % SELECT_COLORS.length] },
      ];
      await br.updateColumn(tableId, colDef.column_id, { options: updatedOptions });
    }
  };

  const setSelectValue = async (rowId: number, col: string, value: string) => {
    // Optimistic update
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
      if (!data) return old;
      return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: value } : r) };
    });
    setSelectDropdown(null);
    try {
      if (value) await ensureSelectOption(col, value);
      await br.updateRow(tableId, rowId, { [col]: value });
      refreshMeta();
    } catch (e) {
      console.error('Set select failed:', e);
      refresh(); // revert optimistic update
    }
  };

  const toggleMultiSelect = async (rowId: number, col: string, current: unknown, option: string) => {
    const currentStr = current ? String(current) : '';
    const currentItems = currentStr ? currentStr.split(',').map(s => s.trim()) : [];
    const newItems = currentItems.includes(option)
      ? currentItems.filter(i => i !== option)
      : [...currentItems, option];
    const newValue = newItems.join(',');
    // Optimistic update
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
      if (!data) return old;
      return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: newValue } : r) };
    });
    try {
      if (!currentItems.includes(option)) await ensureSelectOption(col, option);
      await br.updateRow(tableId, rowId, { [col]: newValue });
      refresh();
      refreshMeta();
    } catch (e) {
      console.error('Toggle multi-select failed:', e);
      refresh(); // revert optimistic update
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
      await br.updateRow(tableId, rowId, { [col]: value });
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
      await br.updateRow(tableId, rowId, { [colTitle]: merged });
      refresh();
      // Re-open attachment dropdown to show updated list
      setAttachmentDropdown({ rowId, col: colTitle });
    } catch (e) {
      console.error('Attachment upload failed:', e);
    } finally {
      setAttachmentUploading(null);
    }
  };

  // User field picker state
  const [userPicker, setUserPicker] = useState<{ rowId: number; col: string } | null>(null);
  const [userPickerSearch, setUserPickerSearch] = useState('');
  const [userPickerNotify, setUserPickerNotify] = useState(true);

  // Focus edit input
  useEffect(() => {
    if (editingCell && editInputRef.current) editInputRef.current.focus();
  }, [editingCell]);

  // ── Row operations ──
  const handleAddRow = async () => {
    // Optimistic: insert a temp row immediately so it appears instantly
    const tempId = `temp-${Date.now()}`;
    const tempRow: Record<string, unknown> = { Id: tempId };
    for (const col of displayCols) {
      if (!col.primary_key) tempRow[col.title] = null;
    }
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: { totalRows?: number } } | undefined;
      if (!data) return { list: [tempRow], pageInfo: { totalRows: 1 } };
      return {
        ...data,
        list: [...data.list, tempRow],
        pageInfo: { ...data.pageInfo, totalRows: (data.pageInfo?.totalRows || 0) + 1 },
      };
    });
    try {
      await br.insertRow(tableId, {});
      refresh(); // Sync with server. Numeric Id sort keeps new row at the end.
    } catch (e) {
      console.error('Insert failed:', e);
      // Revert optimistic row on error
      queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
        const data = old as { list: Record<string, unknown>[]; pageInfo?: { totalRows?: number } } | undefined;
        if (!data) return old;
        return {
          ...data,
          list: data.list.filter(r => r.Id !== tempId),
          pageInfo: { ...data.pageInfo, totalRows: Math.max(0, (data.pageInfo?.totalRows || 1) - 1) },
        };
      });
    }
  };

  const handleDeleteRow = async (rowId: number) => {
    try {
      await br.deleteRow(tableId, rowId);
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
    setCurrencySymbol('$');
    setDecimalPrecision(2);
    setDurationFormat(0);
    setRatingMax(5);
    setRatingIcon('star');
    setDateFormat('YYYY-MM-DD');
    setNewColUserNotify(false);
    setShowAddCol(false);
    setShowTypeSelector(false);
    setEditFieldAnchor(null);
    // Note: do NOT clear insertColPosition here — handleInsertColumn sets it before calling openAddField
  };

  const handleAddColumn = async () => {
    const colTitle = newColTitle.trim() || t(`dataTable.colTypes.${newColType}`);
    if (!colTitle) return;
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
      if (newColType === 'Decimal') {
        opts.meta = { precision: decimalPrecision };
      }
      if (newColType === 'Currency') {
        opts.meta = { currency_code: currencySymbol };
      }
      if (newColType === 'Duration') {
        opts.meta = { duration: durationFormat };
      }
      if (newColType === 'Rating') {
        opts.meta = { max: ratingMax, iconIdx: ratingIcon };
      }
      if (newColType === 'Date' || newColType === 'DateTime') {
        opts.meta = { date_format: dateFormat };
      }
      if (newColType === 'User') {
        opts.meta = { ...(opts.meta as Record<string, unknown> || {}), notify: newColUserNotify };
      }
      const newCol = await br.addColumn(tableId, colTitle, newColType, opts);
      // Reorder if insert position was specified
      if (insertColPosition && activeViewId) {
        // Ensure all columns have order entries — initialize from current displayCols order if viewColumns is empty/sparse
        const existingVcIds = new Set((viewColumns || []).map(vc => vc.fk_column_id));
        const allCols = [...displayCols.map(c => c.column_id), newCol.column_id];
        for (let i = 0; i < allCols.length; i++) {
          if (!existingVcIds.has(allCols[i])) {
            await br.updateViewColumn(activeViewId, allCols[i], { order: (i + 1) * 10 });
          }
        }
        // Re-fetch to get current orders
        const freshVc = await br.listViewColumns(activeViewId);
        if (insertColPosition.afterColId === '__first__') {
          await br.updateViewColumn(activeViewId, newCol.column_id, { order: 0 });
          for (const vc of freshVc) {
            if (vc.fk_column_id !== newCol.column_id) {
              await br.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
            }
          }
        } else {
          const afterViewCol = freshVc.find(vc => vc.fk_column_id === insertColPosition.afterColId);
          const afterOrder = afterViewCol?.order ?? 0;
          await br.updateViewColumn(activeViewId, newCol.column_id, { order: afterOrder + 1 });
          for (const vc of freshVc) {
            if (vc.fk_column_id !== newCol.column_id && (vc.order ?? 0) > afterOrder) {
              await br.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
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
      await br.updateColumn(tableId, columnId, { title: colTitleValue.trim() });
      setEditingColTitle(null);
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Rename column failed:', e);
    }
  };

  const handleChangeColumnType = async (columnId: string, newType: string) => {
    try {
      await br.updateColumn(tableId, columnId, { uidt: newType });
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
    if (!window.confirm(t('dataTable.deleteFieldConfirm', { name: colTitle }))) return;
    try {
      await br.deleteColumn(tableId, columnId);
      setColMenu(null);
      refreshMeta();
      refresh();
    } catch (e) {
      console.error('Delete column failed:', e);
    }
  };

  // ── Table operations ──
  // handleRenameTable now inlined in ContentTopBar onTitleChange

  const handleDeleteTable = async () => {
    if (!confirm(t('dataTable.deleteTableConfirm'))) return;
    try {
      await gw.deleteContentItem(`table:${tableId}`);
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
          ? await br.queryRowsByView(tableId, activeViewId, { limit: batchSize, offset })
          : await br.queryRows(tableId, { limit: batchSize, offset });
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
          await br.insertRow(tableId, rowData);
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
  const openEditField = (col: br.BRColumn, anchorEl?: HTMLElement | null) => {
    setColMenu(null);
    setEditFieldColId(col.column_id);
    // Try to position dialog near the column header
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setEditFieldAnchor({ x: Math.min(rect.left, window.innerWidth - 400), y: rect.bottom + 8 });
    } else {
      // Find column header element by data attribute
      const headerEl = document.querySelector(`[data-col-id="${col.column_id}"]`) as HTMLElement | null;
      if (headerEl) {
        const rect = headerEl.getBoundingClientRect();
        setEditFieldAnchor({ x: Math.min(rect.left, window.innerWidth - 400), y: rect.bottom + 8 });
      } else {
        setEditFieldAnchor(null);
      }
    }
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
      if (m.currency_code) setCurrencySymbol(String(m.currency_code));
      if (m.precision !== undefined) setDecimalPrecision(m.precision as number);
      if (m.duration !== undefined) setDurationFormat(m.duration as number);
    }
    if (col.type === 'Rating' && col.meta) {
      setRatingMax((col.meta as any).max || 5);
    }
    // Date format from meta
    if ((col.type === 'Date' || col.type === 'DateTime') && col.meta) {
      setDateFormat((col.meta as any).date_format || 'YYYY-MM-DD');
    }
    // User notification from meta
    if ((col.type === 'User' || col.type === 'Collaborator') && col.meta) {
      setNewColUserNotify(!!(col.meta as any).notify);
    }
    setShowAddCol(true);
  };

  const openAddField = () => {
    resetAddColState();
    setEditFieldColId(null);
    // Don't clear insertColPosition here — it may have been set by handleInsertColumn
    setShowAddCol(true);
    // Note: newColTitle stays empty; placeholder will show the type name
  };

  // ── Save field (handles both add and edit) ──
  const handleSaveField = async () => {
    // If no title entered, use the type name as default
    const effectiveTitle = newColTitle.trim() || t(`dataTable.colTypes.${newColType}`);
    if (!effectiveTitle) return;
    if (editFieldColId) {
      // Edit existing column
      try {
        const updates: Record<string, unknown> = { title: effectiveTitle, uidt: newColType };
        // Include select options
        if (isSelectType(newColType) && newColOptionsList.length > 0) {
          updates.options = newColOptionsList.filter(s => s.trim()).map((s, i) => ({
            title: s.trim(),
            color: SELECT_COLORS[i % SELECT_COLORS.length],
          }));
        }
        // Include meta for number format, rating, date format
        if (newColType === 'Decimal') {
          updates.meta = JSON.stringify({ precision: decimalPrecision });
        }
        if (newColType === 'Currency') {
          updates.meta = JSON.stringify({ currency_code: currencySymbol });
        }
        if (newColType === 'Duration') {
          updates.meta = JSON.stringify({ duration: durationFormat });
        }
        if (newColType === 'Rating') {
          updates.meta = JSON.stringify({ max: ratingMax, iconIdx: ratingIcon });
        }
        if (newColType === 'Date' || newColType === 'DateTime') {
          updates.meta = JSON.stringify({ date_format: dateFormat });
        }
        if (newColType === 'User') {
          updates.meta = JSON.stringify({ notify: newColUserNotify });
        }
        await br.updateColumn(tableId, editFieldColId, updates);
        resetAddColState();
        setEditFieldColId(null);
        refreshMeta();
        refresh();
      } catch (e) {
        console.error('Update field failed:', e);
        alert(`Update field failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      // Add new column
      await handleAddColumn();
    }
  };

  // ── Duplicate column ──
  const handleDuplicateColumn = async (col: br.BRColumn) => {
    setColMenu(null);
    try {
      const opts: Record<string, unknown> = {};
      if ((col.type === 'SingleSelect' || col.type === 'MultiSelect') && col.options?.length) {
        opts.options = col.options.map((o, i) => ({ title: o.title, color: o.color || SELECT_COLORS[i % SELECT_COLORS.length] }));
      }
      const newCol = await br.addColumn(tableId, `${col.title} (copy)`, col.type, opts);
      // Reorder: place after the source column
      if (activeViewId) {
        // Ensure all columns have order entries
        const existingVcIds = new Set((viewColumns || []).map(vc => vc.fk_column_id));
        const allCols = [...displayCols.map(c => c.column_id), newCol.column_id];
        for (let i = 0; i < allCols.length; i++) {
          if (!existingVcIds.has(allCols[i])) {
            await br.updateViewColumn(activeViewId, allCols[i], { order: (i + 1) * 10 });
          }
        }
        const freshVc = await br.listViewColumns(activeViewId);
        const srcViewCol = freshVc.find(vc => vc.fk_column_id === col.column_id);
        const srcOrder = srcViewCol?.order ?? 0;
        await br.updateViewColumn(activeViewId, newCol.column_id, { order: srcOrder + 1 });
        for (const vc of freshVc) {
          if (vc.fk_column_id !== col.column_id && vc.fk_column_id !== newCol.column_id && (vc.order ?? 0) > srcOrder) {
            await br.updateViewColumn(activeViewId, vc.fk_column_id, { order: (vc.order ?? 0) + 1 });
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
  const handleInsertColumn = (position: 'left' | 'right', col: br.BRColumn) => {
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
        br.updateViewColumn(activeViewId, columnId, { show: !shouldHide }).catch(() => {});
      }
      return next;
    });
  }, [activeViewId]);

  // ── Persist column width ──
  const persistColWidth = useCallback((columnId: string, width: number) => {
    if (activeViewId) {
      br.updateViewColumn(activeViewId, columnId, { width }).catch(() => {});
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
    if (!confirm(t('dataTable.deleteRowsConfirm', { n: selectedRows.size }))) return;
    try {
      for (const rowId of selectedRows) {
        await br.deleteRow(tableId, rowId);
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
        await br.updateRow(tableId, rowId, { [bulkEditCol]: bulkEditVal });
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
  const handleCellKeyDown = (e: React.KeyboardEvent, rowIdx: number, col: br.BRColumn) => {
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
        const rowId = editingCell?.rowId;
        if (rowId == null) return;
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

  // Close attachment dropdown on outside click
  useEffect(() => {
    if (!attachmentDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-select-dropdown]')) {
        setAttachmentDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [attachmentDropdown]);

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

  // Guard: show error state if meta failed to load
  if (metaError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <p className="text-destructive font-medium">{t('dataTable.loadError') || 'Failed to load table'}</p>
        <p className="text-sm text-muted-foreground">{(metaErrorDetail as Error)?.message}</p>
        <div className="flex gap-2">
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ['nc-table-meta', tableId] })} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded">{t('dataTable.retry') || 'Retry'}</button>
          <button onClick={onBack} className="px-3 py-1.5 text-sm border rounded">{t('dataTable.back') || 'Back'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Header */}
      <div className="flex items-center border-b border-border bg-card shrink-0">
        <ContentTopBar
          breadcrumb={breadcrumb}
          onBack={onBack}
          docListVisible={docListVisible}
          onToggleDocList={onToggleDocList}
          title={meta?.title || t('common.loading')}
          onTitleChange={async (newTitle) => {
            try {
              await br.renameTable(tableId, newTitle);
              refreshMeta();
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            } catch (e) {
              console.error('Rename table failed:', e);
            }
          }}
          metaLine={
            <div className="text-[11px] text-muted-foreground/50 flex items-center gap-2">
              <span>{totalRows} {t('dataTable.rows')}</span>
              {meta?.updated_at && (
                <>
                  <span>·</span>
                  <span>{t('dataTable.lastEditedAt')} {new Date(meta.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </>
              )}
            </div>
          }
          actions={<>
            <button
              onClick={() => setShowTableComments(v => !v)}
              className={cn('p-1.5 rounded transition-colors', showTableComments ? 'text-[#2fcc71] bg-[#2fcc71]/10' : 'text-[#2fcc71] hover:text-[#27ae60]')}
              title={t('content.comments')}
            >
              <MessageSquare className="h-5 w-5 md:h-4 md:w-4" />
            </button>
            <div className="relative">
              <button onClick={() => setShowTableMenu(v => !v)} className="p-1.5 text-muted-foreground hover:text-foreground shrink-0" title={t('content.moreActions')}>
                <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
              </button>
              {showTableMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTableMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-44">
                    <button
                      onClick={() => { setShowTableMenu(false); setShowHistory(true); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                    >
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {t('content.versionHistory')}
                    </button>
                    <button
                      onClick={() => {
                        setShowTableMenu(false);
                        if (onCopyLink) { onCopyLink(); }
                        else {
                          const url = new URL(window.location.href);
                          url.searchParams.set('id', `table:${tableId}`);
                          navigator.clipboard.writeText(url.toString());
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                    >
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground" /> {t('content.copyLink')}
                    </button>
                    <button
                      onClick={handleExportCSV}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" /> {t('content.download')}
                    </button>
                    <div className="border-t border-border my-1" />
                    <button
                      onClick={() => { setShowTableMenu(false); handleDeleteTable(); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t('content.delete')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>}
        />
      </div>

      {/* Main content + comments sidebar flex row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Main table content */}
      <div className="flex-1 flex flex-col min-w-0">

      {/* View tabs bar — hidden during history preview */}
      {!previewSnapshot && <>
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
                          } catch (e) { console.error('Duplicate view failed:', e); }
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
                    } catch (e) { console.error('Create view failed:', e); }
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
      </>}{/* end view tabs conditional */}

      {/* Toolbar bar — NocoDB style, view-type aware — hidden during history preview and mobile preview */}
      {!previewSnapshot && !mobilePreview && (() => {
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
                          {displayCols.filter(c => !c.primary_key && c.title !== 'created_by').map(c => {
                            const ColIcon = getColIcon(c.type);
                            const isActive = activeView?.fk_grp_col_id === c.column_id;
                            return (
                              <button
                                key={c.column_id}
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

            {/* Kanban: {t('dataTable.customizeCard')} */}
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

            {/* Gallery: {t('dataTable.customizeCard')} */}
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
      })()}

      {/* History version preview — replaces content area when a snapshot is selected */}
      {previewSnapshot && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Preview banner */}
          <div className="flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 shrink-0">
            <div className="flex items-center gap-2 text-sm">
              <Clock size={14} className="text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-amber-800 dark:text-amber-200">
                {t('dataTableHistory.previewingVersion')}
              </span>
              <span className="text-amber-600 dark:text-amber-400">
                — {(() => {
                  const d = new Date(previewSnapshot.createdAt);
                  const now = new Date();
                  const diff = now.getTime() - d.getTime();
                  const mins = Math.floor(diff / 60000);
                  const hours = Math.floor(diff / 3600000);
                  const days = Math.floor(diff / 86400000);
                  if (mins < 1) return t('time.justNow');
                  if (mins < 60) return t('time.minutesAgo', { n: mins });
                  if (hours < 24) return t('time.hoursAgo', { n: hours });
                  if (days < 7) return t('time.daysAgo', { n: days });
                  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                })()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (!confirm(t('dataTableHistory.restoreConfirm'))) return;
                  try {
                    const result = await gw.restoreTableSnapshot(tableId, previewSnapshot.snapshotId);
                    console.log('[TableEditor] Restore success:', result);
                    setPreviewSnapshot(null);
                    setShowHistory(false);
                    setPage(1);
                    // Force refetch all data so restored content is visible immediately
                    queryClient.removeQueries({ queryKey: ['nc-rows', tableId] });
                    queryClient.invalidateQueries({ queryKey: ['nc-table-meta', tableId] });
                  } catch (e: unknown) {
                    console.error('[TableEditor] Restore error:', e);
                    alert(e instanceof Error ? e.message : 'Restore failed');
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                <RotateCcw size={12} />
                {t('dataTableHistory.restoreVersion')}
              </button>
              <button
                onClick={() => { setPreviewSnapshot(null); setShowHistory(false); }}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
              >
                <X size={12} />
                {t('dataTableHistory.exitPreview')}
              </button>
            </div>
          </div>
          {/* Read-only snapshot table — horizontal scroll like link picker */}
          <div className="flex-1 overflow-auto bg-amber-50/30 dark:bg-amber-950/10">
            {previewSnapshot.rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">{t('dataTable.emptyTable')}</div>
            ) : (() => {
              const HIDDEN_SNAPSHOT_UIDTS = new Set(['ID', 'CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'Links', 'LinkToAnotherRecord', 'Lookup', 'Rollup', 'Formula', 'Count']);
              const snapshotCols = previewSnapshot.schema.filter((c: { uidt: string }) => !HIDDEN_SNAPSHOT_UIDTS.has(c.uidt));
              return (
                <table className="text-xs" style={{ minWidth: '100%' }}>
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-[5]">
                    <tr>
                      <th className="w-10 min-w-[40px] px-2 py-2 text-center text-[10px] font-normal text-muted-foreground/50 border-r border-border sticky left-0 bg-muted/80 z-10">#</th>
                      {snapshotCols.map((col: { title: string; uidt: string }, i: number) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[120px]">
                          {col.title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewSnapshot.rows.map((row: Record<string, unknown>, ri: number) => (
                      <tr key={ri} className="border-b border-border/30 hover:bg-accent/20">
                        <td className="w-10 min-w-[40px] px-2 py-1.5 text-center text-[10px] text-muted-foreground/50 border-r border-border sticky left-0 bg-amber-50/30 dark:bg-amber-950/10 z-10">{ri + 1}</td>
                        {snapshotCols.map((col: { title: string; uidt: string }, ci: number) => (
                          <td key={ci} className="px-3 py-1.5 text-foreground max-w-[250px]">
                            <SnapshotCellValue value={row[col.title]} colType={col.uidt} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      )}

      {/* Content area — view type determines rendering — hidden during history preview */}
      {!previewSnapshot && ((() => {
        const activeView = views.find(v => v.view_id === activeViewId);
        const viewType = activeView?.type || 3;
        // Kanban view
        if (viewType === 4 && activeView) return (
          <KanbanView
            rows={rows}
            columns={displayCols}
            activeView={activeView}
            isLoading={isLoading}
            onUpdateRow={async (rowId, fields) => { await br.updateRow(tableId, rowId, fields); refresh(); }}
            onAddRow={handleAddRow}
            tableId={tableId}
            refreshMeta={refreshMeta}
            hiddenCols={hiddenCols}
            onExpandRow={(rowId) => { const idx = rows.findIndex(r => (r.Id as number) === rowId); if (idx >= 0) setExpandedRowIdx(idx); }}
            onRefreshRows={refresh}
          />
        );
        // Gallery view
        if (viewType === 2) return (
          <GalleryView
            rows={rows}
            columns={displayCols}
            activeView={activeView}
            isLoading={isLoading}
            onAddRow={handleAddRow}
            hiddenCols={hiddenCols}
            onExpandRow={(rowId) => { const idx = rows.findIndex(r => (r.Id as number) === rowId); if (idx >= 0) setExpandedRowIdx(idx); }}
          />
        );
        // Form view
        if (viewType === 1) return (
          <FormView
            columns={displayCols.filter(c => !c.primary_key && !READONLY_TYPES.has(c.type))}
            tableId={tableId}
            onSubmit={async (data) => { await br.insertRow(tableId, data); refresh(); }}
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
      <div ref={gridScrollRef} className="flex-1 overflow-auto" style={{ overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch' as any }}>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-8 rounded bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : (
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd} onDragOver={handleColumnDragOver} onDragStart={(e) => setColDragActiveId(String(e.active.id))} onDragCancel={() => { setColDragOver(null); setColDragActiveId(null); }}>
          <table className="text-sm border-collapse table-fixed" style={{ minWidth: `${32 + visibleCols.length * 120}px` }}>
            <thead>
              <tr className="border-b border-border bg-muted/30 sticky top-0 z-[5]">
                <th className="px-1 py-1.5 text-center text-[10px] font-normal text-muted-foreground/50 group/hdr sticky left-0 z-[6] bg-card relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-border" style={{ width: '32px', minWidth: '32px', maxWidth: '32px' }}>
                  <span className={cn(!mobilePreview && 'group-hover/hdr:hidden', selectedRows.size > 0 && !mobilePreview && 'hidden')}>#</span>
                  {!mobilePreview && (
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && selectedRows.size === rows.length}
                    onChange={toggleSelectAll}
                    className={cn('w-3 h-3 accent-sidebar-primary cursor-pointer', selectedRows.size > 0 ? 'inline' : 'hidden group-hover/hdr:inline')}
                  />
                  )}
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
                        data-col-id={col.column_id}
                        className={cn(
                          "relative px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap group",
                          'sticky z-[6] bg-card',
                          isLastFrozen
                            ? 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[2px] after:bg-border'
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
                              <button onClick={() => { setColMenu(null); handleColumnSort(col.column_id, 'asc'); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"><ArrowUp className="h-3 w-3" /> Sort A → Z</button>
                              <button onClick={() => { setColMenu(null); handleColumnSort(col.column_id, 'desc'); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"><ArrowDown className="h-3 w-3" /> Sort Z → A</button>
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
                        isFrozen ? cn('sticky z-[6] bg-card', isLastFrozen ? 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[2px] after:bg-border' : 'border-r border-border') : 'border-r border-border'
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
                              onClick={() => { setColMenu(null); handleColumnSort(col.column_id, 'asc'); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            >
                              <ArrowUp className="h-3 w-3" /> Sort A → Z
                            </button>
                            <button
                              onClick={() => { setColMenu(null); handleColumnSort(col.column_id, 'desc'); }}
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
                {!mobilePreview && (
                <th className="px-2 py-1.5 border-r border-border">
                  <button onClick={(e) => { const rect = (e.target as HTMLElement).getBoundingClientRect(); setEditFieldAnchor({ x: rect.right - 384, y: rect.bottom + 4 }); setInsertColPosition(null); openAddField(); }} className="p-0.5 text-muted-foreground hover:text-foreground" title={t('dataTable.addCol')}>
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </th>
                )}
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
                        mobilePreview ? 'hidden' : (selectedRows.has(rowId) ? 'visible' : 'invisible group-hover/row:visible')
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
                            isLastFrozen ? 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-[2px] after:bg-border' : 'border-r border-border',
                            (selectDropdown?.rowId === rowId && selectDropdown?.col === col.title) || (userPicker?.rowId === rowId && userPicker?.col === col.title) || (datePicker?.rowId === rowId && datePicker?.col === col.title) || (attachmentDropdown?.rowId === rowId && attachmentDropdown?.col === col.title) ? 'overflow-visible' : 'overflow-hidden',
                            isEditing && 'ring-2 ring-sidebar-primary ring-inset bg-card',
                            !mobilePreview && (!isReadonly || col.type === 'Links' || col.type === 'Attachment' || col.type === 'User' || col.type === 'Collaborator') && !isEditing && 'cursor-pointer',
                            mobilePreview && 'cursor-pointer',
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
                            // Mobile preview: clicking any cell opens the row detail panel
                            if (mobilePreview) {
                              setExpandedRowIdx(rowIdx);
                              return;
                            }
                            if (col.type === 'Links') {
                              setLinkPicker({ rowId, column: col });
                              return;
                            }
                            if (col.type === 'Attachment') {
                              setAttachmentDropdown({ rowId, col: col.title });
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
                          ) : col.type === 'Rating' && !isReadonly && !mobilePreview ? (
                            <RatingStars value={val as number} onChange={v => setRating(rowId, col.title, v)} max={(col.meta as any)?.max || 5} iconType={(col.meta as any)?.iconIdx || 'star'} />
                          ) : isPK ? (
                            <div className="flex items-center gap-1">
                              <span className="flex-1 truncate"><CellDisplay value={val} col={col} /></span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedRowIdx(rowIdx); }}
                                className="hidden group-hover/row:inline-flex shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
                                title={t('dataTable.expandRow')}
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
                                title={t('dataTable.rowComments')}
                              >
                                <MessageSquare className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (col.type === 'Links' || col.type === 'LinkToAnotherRecord') ? (
                            <LinkedRecordChips tableId={tableId} rowId={rowId} column={col} value={val} />
                          ) : (
                            <CellDisplay value={val} col={col} onDeleteAttachment={col.type === 'Attachment' && !isReadonly ? async (idx) => {
                              try {
                                const attachments = Array.isArray(val) ? val : JSON.parse(String(val || '[]'));
                                const updated = (attachments as any[]).filter((_: any, i: number) => i !== idx);
                                await br.updateRow(tableId, rowId, { [col.title]: updated });
                                refresh();
                              } catch (e) { console.error('Delete attachment failed:', e); }
                            } : undefined} />
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
                                    placeholder={t('dataTable.searchOrNewOption')}
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
                                      {t('dataTable.clear')}
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
                                      <Plus className="h-3 w-3" /> {t('dataTable.createOption', { name: selectInput.trim() })}
                                    </button>
                                  )}
                                  {filteredOpts.length === 0 && !showCreateOption && (
                                    <p className="px-3 py-2 text-xs text-muted-foreground">{t('dataTable.noMatchOptions')}</p>
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
                                    placeholder={t('dataTable.searchMembers')}
                                    className="w-full bg-muted rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                                    autoFocus
                                  />
                                </div>
                                <div className="overflow-y-auto flex-1 py-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); br.updateRow(tableId, rowId, { [col.title]: '' }).then(refresh); setUserPicker(null); }}
                                    className="w-full px-3 py-1 text-xs text-muted-foreground hover:bg-accent text-left"
                                  >
                                    {t('dataTable.clear')}
                                  </button>
                                  {/* Admin user */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); br.updateRow(tableId, rowId, { [col.title]: 'admin' }).then(refresh); setUserPicker(null); }}
                                    className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent', currentVal === 'admin' && 'font-medium bg-sidebar-primary/5')}
                                  >
                                    <User className="h-3 w-3 text-muted-foreground" />
                                    Admin
                                  </button>
                                  {filtered.map(agent => (
                                    <button
                                      key={agent.name}
                                      onClick={(e) => { e.stopPropagation(); br.updateRow(tableId, rowId, { [col.title]: agent.display_name || agent.name }).then(refresh); setUserPicker(null); }}
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
                                    <p className="px-3 py-2 text-xs text-muted-foreground">{t('dataTable.noMatchMembers')}</p>
                                  )}
                                </div>
                                <div className="border-t border-border px-3 py-1.5">
                                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer" onClick={e => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={userPickerNotify}
                                      onChange={e => setUserPickerNotify(e.target.checked)}
                                      className="accent-sidebar-primary w-3 h-3"
                                    />
                                    {t('dataTable.notifyOnAssign')}
                                  </label>
                                </div>
                              </div>
                            );
                          })()}
                          {/* Attachment dropdown */}
                          {attachmentDropdown?.rowId === rowId && attachmentDropdown?.col === col.title && (() => {
                            const attachments: any[] = (() => {
                              if (!val) return [];
                              if (Array.isArray(val)) return val;
                              try { return JSON.parse(String(val)); } catch { return []; }
                            })();
                            const isEmpty = attachments.length === 0;
                            return (
                              <div data-select-dropdown className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl w-64 max-h-72 flex flex-col" onClick={e => e.stopPropagation()}>
                                {isEmpty ? (
                                  <div className="flex flex-col items-center gap-2 py-6 px-4">
                                    {attachmentUploading?.rowId === rowId && attachmentUploading?.col === col.title ? (
                                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" /> {t('dataTable.uploading')}
                                      </div>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => {
                                            attachmentTargetRef.current = { rowId, col: col.title };
                                            attachmentInputRef.current?.click();
                                          }}
                                          className="w-full py-2.5 rounded-lg bg-sidebar-primary text-white text-sm font-medium hover:opacity-90"
                                        >
                                          {t('dataTable.chooseFile')}
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                          {t('dataTable.pasteHint')}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    <DndContext
                                      sensors={dndSensors}
                                      collisionDetection={closestCenter}
                                      modifiers={[restrictToParentElement, restrictToVerticalAxis]}
                                      onDragEnd={async (event: DragEndEvent) => {
                                        const { active, over } = event;
                                        if (!over || active.id === over.id) return;
                                        const oldIdx = Number(active.id);
                                        const newIdx = Number(over.id);
                                        const reordered = arrayMove([...attachments], oldIdx, newIdx);
                                        // Optimistic update
                                        queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
                                          const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
                                          if (!data) return old;
                                          return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col.title]: reordered } : r) };
                                        });
                                        try {
                                          await br.updateRow(tableId, rowId, { [col.title]: reordered });
                                        } catch (e) { console.error('Reorder failed:', e); refresh(); }
                                      }}
                                    >
                                    <SortableContext items={attachments.map((_: any, i: number) => i)} strategy={verticalListSortingStrategy}>
                                    <div className="overflow-y-auto flex-1 py-1">
                                      {attachments.map((att: any, idx: number) => {
                                        const isImage = att.mimetype?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(att.title || att.path || '');
                                        const thumbUrl = att.path ? ncAttachmentUrl(att) : '';
                                        return (
                                          <SortableAttachmentItem key={idx} id={idx}>
                                            <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent group/att">
                                              <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0 cursor-grab" />
                                              {isImage && thumbUrl ? (
                                                <img src={thumbUrl} className="h-8 w-8 rounded object-cover shrink-0" alt="" />
                                              ) : (
                                                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0">
                                                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                                                </div>
                                              )}
                                              <span className="flex-1 text-xs text-foreground truncate">{att.title || att.path?.split('/').pop() || 'file'}</span>
                                              <a
                                                href={ncAttachmentUrl(att)}
                                                download={att.title || att.path?.split('/').pop() || 'file'}
                                                onClick={e => e.stopPropagation()}
                                                className="hidden group-hover/att:block p-0.5 text-muted-foreground hover:text-sidebar-primary shrink-0"
                                                title={t('common.download')}
                                              >
                                                <Download className="h-3 w-3" />
                                              </a>
                                              <button
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  const updated = attachments.filter((_: any, i: number) => i !== idx);
                                                  await br.updateRow(tableId, rowId, { [col.title]: updated });
                                                  refresh();
                                                  if (updated.length === 0) setAttachmentDropdown(null);
                                                }}
                                                className="hidden group-hover/att:block p-0.5 text-muted-foreground hover:text-destructive shrink-0"
                                                title={t('common.delete')}
                                              >
                                                <Trash2 className="h-3 w-3" />
                                              </button>
                                            </div>
                                          </SortableAttachmentItem>
                                        );
                                      })}
                                    </div>
                                    </SortableContext>
                                    </DndContext>
                                    <div className="border-t border-border px-3 py-2">
                                      {attachmentUploading?.rowId === rowId && attachmentUploading?.col === col.title ? (
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                          <Loader2 className="h-3 w-3 animate-spin" /> {t('dataTable.uploading')}
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            attachmentTargetRef.current = { rowId, col: col.title };
                                            attachmentInputRef.current?.click();
                                          }}
                                          className="flex items-center gap-1.5 text-xs text-sidebar-primary hover:opacity-80"
                                        >
                                          <Plus className="h-3 w-3" /> {t('dataTable.addFileOrImage')}
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                          {/* Date picker dropdown */}
                          {datePicker?.rowId === rowId && datePicker?.col === col.title && (
                            <DatePickerDropdown
                              value={datePicker.value}
                              showTime={datePicker.colType === 'DateTime'}
                              onChange={async (dateStr) => {
                                // Update cell immediately without closing picker
                                setDatePicker(prev => prev ? { ...prev, value: dateStr } : null);
                                queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
                                  const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
                                  if (!data) return old;
                                  return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col.title]: dateStr || null } : r) };
                                });
                                try { await br.updateRow(tableId, rowId, { [col.title]: dateStr || null }); refresh(); }
                                catch (e) { console.error('Date update failed:', e); refresh(); }
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
              {!mobilePreview && (
              <tr className="border-b border-border">
                <td className="px-2 py-1 sticky left-0 z-[3] bg-card relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-border" style={{ width: '32px', minWidth: '32px', maxWidth: '32px' }} />
                <td className="px-2 py-1 sticky left-[32px] z-[3] bg-card">
                  <button onClick={handleAddRow} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-0.5">
                    <Plus className="h-3 w-3" /> {t('dataTable.addRecord')}
                  </button>
                </td>
                <td colSpan={displayCols.length} />
              </tr>
              )}
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
      ))}

      {/* Edit Field dialog (unified for add & edit) */}
      {showAddCol && (
        <div className="fixed inset-0 z-50" onClick={() => { resetAddColState(); setEditFieldColId(null); setEditFieldAnchor(null); setShowTypeSelector(false); setInsertColPosition(null); }}>
          <div
            className="bg-card border border-border rounded-xl shadow-2xl w-96 max-h-[70vh] flex flex-col"
            style={editFieldAnchor ? { position: 'fixed', left: Math.max(0, editFieldAnchor.x), top: Math.min(editFieldAnchor.y, window.innerHeight - 400) } : { position: 'fixed', left: '50%', top: '15vh', transform: 'translateX(-50%)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 flex-1 overflow-y-auto space-y-5">
              {/* Field title */}
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.fieldTitle')}</div>
                <input
                  ref={newColRef}
                  value={newColTitle}
                  onChange={e => setNewColTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveField(); if (e.key === 'Escape') { resetAddColState(); setEditFieldColId(null); setShowTypeSelector(false); setInsertColPosition(null); } }}
                  placeholder={editFieldColId ? t('dataTable.fieldName') : t(`dataTable.colTypes.${newColType}`)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-sidebar-primary/50 bg-transparent"
                  autoFocus
                />
              </div>

              {/* Field type selector */}
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.fieldType')}</div>
                <div className="border border-border rounded-lg overflow-hidden">
                  {/* Current type row — click to toggle type list */}
                  <button
                    onClick={() => setShowTypeSelector(!showTypeSelector)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-accent/50 transition-colors"
                  >
                    {(() => { const TypeIcon = getColIcon(newColType); return <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />; })()}
                    <span className="flex-1 text-left">{t(`dataTable.colTypes.${newColType}`)}</span>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showTypeSelector && 'rotate-180')} />
                  </button>
                  {/* Expanded type list */}
                  {showTypeSelector && (() => {
                    // Type change compatibility when editing existing columns
                    const IMMUTABLE_TYPES = new Set(['Links', 'LinkToAnotherRecord', 'Lookup', 'Rollup', 'Formula', 'AutoNumber', 'ID']);
                    const TEXT_TYPES = new Set(['SingleLineText', 'LongText', 'Email', 'URL', 'PhoneNumber']);
                    const NUM_TYPES = new Set(['Number']);
                    const isEditing = !!editFieldColId;
                    const origType = isEditing ? (meta?.columns?.find(c => c.column_id === editFieldColId)?.type || newColType) : newColType;
                    const getCompat = (from: string, to: string): 'ok' | 'lossy' | 'clear' | 'blocked' => {
                      if (from === to) return 'ok';
                      if (IMMUTABLE_TYPES.has(from) || IMMUTABLE_TYPES.has(to)) return 'blocked';
                      // Text ↔ Text: safe
                      if (TEXT_TYPES.has(from) && TEXT_TYPES.has(to)) return 'ok';
                      // Num ↔ Num: safe
                      if (NUM_TYPES.has(from) && NUM_TYPES.has(to)) return 'ok';
                      // Date ↔ DateTime: safe
                      if ((from === 'Date' || from === 'DateTime') && (to === 'Date' || to === 'DateTime')) return 'ok';
                      // SingleSelect → MultiSelect: safe
                      if (from === 'SingleSelect' && to === 'MultiSelect') return 'ok';
                      // Text → Number/Date: lossy (some values survive)
                      if (TEXT_TYPES.has(from) && (NUM_TYPES.has(to) || to === 'Date' || to === 'DateTime')) return 'lossy';
                      if (NUM_TYPES.has(from) && TEXT_TYPES.has(to)) return 'ok'; // Number → Text is safe
                      // Cross-family conversions that clear all data
                      const SELECT_TYPES = new Set(['SingleSelect', 'MultiSelect']);
                      if (SELECT_TYPES.has(from) !== SELECT_TYPES.has(to) && !(TEXT_TYPES.has(from) || TEXT_TYPES.has(to))) return 'clear';
                      if ((from === 'Checkbox' && !NUM_TYPES.has(to) && !TEXT_TYPES.has(to)) || (to === 'Checkbox' && !NUM_TYPES.has(from) && !TEXT_TYPES.has(from))) return 'clear';
                      if ((from === 'Attachment' || to === 'Attachment') && from !== to) return 'clear';
                      // Everything else: lossy
                      return 'lossy';
                    };
                    return (
                    <div className="border-t border-border max-h-48 overflow-y-auto">
                      {GROUP_KEYS.map(group => {
                        const label = t(`dataTable.colGroups.${group}`);
                        const types = COLUMN_TYPES.filter(ct => ct.group === group);
                        if (types.length === 0) return null;
                        return (
                          <div key={group}>
                            <div className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/30 sticky top-0">{label}</div>
                            <div className="grid grid-cols-2">
                            {types.map(ct => {
                              const CtIcon = ct.icon;
                              const compat = isEditing ? getCompat(origType, ct.value) : 'ok';
                              if (compat === 'blocked' && ct.value !== origType) return (
                                <div key={ct.value} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground/40 cursor-not-allowed">
                                  <CtIcon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{t(`dataTable.colTypes.${ct.value}`)}</span>
                                </div>
                              );
                              return (
                                <button
                                  key={ct.value}
                                  onClick={() => {
                                    if (compat === 'clear') {
                                      if (!window.confirm(t('dataTable.typeChangeClearConfirm', { from: t(`dataTable.colTypes.${origType}`), to: t(`dataTable.colTypes.${ct.value}`) }))) return;
                                    } else if (compat === 'lossy') {
                                      if (!window.confirm(t('dataTable.typeChangeLossyConfirm', { from: t(`dataTable.colTypes.${origType}`), to: t(`dataTable.colTypes.${ct.value}`) }))) return;
                                    }
                                    setNewColType(ct.value); setShowTypeSelector(false);
                                  }}
                                  className={cn(
                                    'flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                                    newColType === ct.value ? 'text-sidebar-primary font-medium bg-sidebar-primary/5' : 'text-foreground'
                                  )}
                                >
                                  <CtIcon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{t(`dataTable.colTypes.${ct.value}`)}</span>
                                  {compat === 'clear' && ct.value !== origType && <span className="text-[9px] text-destructive ml-auto">⚠</span>}
                                  {compat === 'lossy' && ct.value !== origType && <span className="text-[9px] text-amber-500 ml-auto">!</span>}
                                </button>
                              );
                            })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    );
                  })()}
                </div>
              </div>

              {/* Type-specific config */}
              {/* Number config — simple integer, no extra options */}
              {/* Decimal config */}
              {newColType === 'Decimal' && (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.decimals')}</div>
                    <select
                      value={decimalPrecision}
                      onChange={e => setDecimalPrecision(parseInt(e.target.value) || 2)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      {[1,2,3,4,5,6,7,8].map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60">
                    {t('dataTable.preview')}: {(1234.5).toFixed(decimalPrecision)}
                  </div>
                </div>
              )}
              {/* Currency config */}
              {newColType === 'Currency' && (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.currencySymbol') || 'Currency'}</div>
                    <select
                      value={currencySymbol}
                      onChange={e => setCurrencySymbol(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      {[
                        { symbol: '$', label: 'USD ($)' },
                        { symbol: '¥', label: 'CNY (¥)' },
                        { symbol: '€', label: 'EUR (€)' },
                        { symbol: '£', label: 'GBP (£)' },
                        { symbol: 'A$', label: 'AUD (A$)' },
                        { symbol: 'C$', label: 'CAD (C$)' },
                        { symbol: 'S$', label: 'SGD (S$)' },
                        { symbol: '₩', label: 'KRW (₩)' },
                        { symbol: '₹', label: 'INR (₹)' },
                        { symbol: '¥', label: 'JPY (¥)' },
                      ].map(c => <option key={c.label} value={c.symbol}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60">
                    {t('dataTable.preview')}: {currencySymbol}1,234.56
                  </div>
                </div>
              )}
              {/* Percent — no extra config needed */}
              {newColType === 'Percent' && (
                <div className="text-[10px] text-muted-foreground/60">
                  {t('dataTable.preview')}: 85%
                </div>
              )}
              {/* Rating config */}
              {newColType === 'Rating' && (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.ratingSettings')}</div>
                  <label className="flex items-center gap-1.5 text-xs text-foreground">
                    <span>{t('dataTable.maxValue')}</span>
                    <input
                      type="number" min={1} max={10} value={ratingMax}
                      onChange={e => setRatingMax(parseInt(e.target.value) || 5)}
                      className="w-14 border border-border rounded px-2 py-1 text-xs outline-none bg-transparent"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground">{t('dataTable.icon')}</span>
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
                  <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.dateFormat')}</div>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {(() => {
                      const isDateOnly = newColType === 'Date';
                      // Build format list based on type
                      const baseFmts = [
                        { value: 'YYYY/MM/DD', example: '2026/01/30' },
                        { value: 'YYYY-MM-DD', example: '2026-01-30' },
                        { value: 'DD/MM/YYYY', example: '30/01/2026' },
                        { value: 'MM/DD/YYYY', example: '01/30/2026' },
                        { value: 'MM-DD', example: '01-30' },
                      ];
                      const allFmts: { value: string; example: string }[] = [];
                      if (isDateOnly) {
                        // Date type: only pure date formats
                        allFmts.push(...baseFmts);
                      } else {
                        // DateTime/CreatedTime/LastModifiedTime: only date+time formats
                        for (const f of baseFmts) {
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
                  <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.formulaExpression')}</div>
                  <input
                    value={newColFormula}
                    onChange={e => setNewColFormula(e.target.value)}
                    placeholder="CONCAT({Name}, ' - ', {Country})"
                    className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none font-mono bg-transparent"
                  />
                  <div className="text-[10px] text-muted-foreground/50 mt-1">
                    {t('dataTable.formulaHint')}
                  </div>
                </div>
              )}
              {newColType === 'Links' && (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.relatedTable')}</div>
                    <select
                      value={newColRelTable}
                      onChange={e => setNewColRelTable(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      <option value="">{t('dataTable.selectTable')}</option>
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
                    {t('dataTable.allowMultiple')}
                  </label>
                  <div className="text-[10px] text-muted-foreground/60">
                    {newColRelMulti ? t('dataTable.relMultiHint') : t('dataTable.relSingleHint')}
                  </div>
                </div>
              )}
              {newColType === 'Lookup' && (() => {
                const linkCols = displayCols.filter(c => c.type === 'Links' || c.type === 'LinkToAnotherRecord');
                return (
                <div className="space-y-3">
                  {linkCols.length === 0 ? (
                    <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                      {t('dataTable.needLinkCol', { type: t('dataTable.colTypes.Lookup') })}
                    </div>
                  ) : (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.linkCol')}</div>
                    <select
                      value={newColRelCol}
                      onChange={e => setNewColRelCol(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      <option value="">{t('dataTable.selectLinkCol')}</option>
                      {linkCols.map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  )}
                  {relatedMeta && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.lookupField')}（{relatedMeta.title}）</div>
                      <select
                        value={newColLookupCol}
                        onChange={e => setNewColLookupCol(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                      >
                        <option value="">{t('dataTable.selectField')}</option>
                        {(relatedMeta.columns || [])
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
                      {t('dataTable.needLinkCol', { type: t('dataTable.colTypes.Rollup') })}
                    </div>
                  ) : (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.linkCol')}</div>
                    <select
                      value={newColRelCol}
                      onChange={e => setNewColRelCol(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                    >
                      <option value="">{t('dataTable.selectLinkCol')}</option>
                      {linkCols.map(c => (
                        <option key={c.column_id} value={c.column_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  )}
                  {relatedMeta && (
                    <>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.rollupField')}（{relatedMeta.title}）</div>
                        <select
                          value={newColRollupCol}
                          onChange={e => setNewColRollupCol(e.target.value)}
                          className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none bg-transparent"
                        >
                          <option value="">{t('dataTable.selectField')}</option>
                          {(relatedMeta.columns || []).filter(c => ['Number', 'Decimal', 'Currency', 'Percent', 'Rating'].includes(c.type)).map(c => (
                            <option key={c.column_id} value={c.column_id}>{c.title} ({c.type})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5">{t('dataTable.aggregateFn')}</div>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { value: 'sum', key: 'fnSum' },
                            { value: 'avg', key: 'fnAvg' },
                            { value: 'count', key: 'fnCount' },
                            { value: 'min', key: 'fnMin' },
                            { value: 'max', key: 'fnMax' },
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
                              {t(`dataTable.${fn.key}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                );
              })()}
              {/* Notify toggle moved to user picker popup */}
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
          <span className="text-xs text-foreground font-medium">{t('dataTable.selectedRows', { n: selectedRows.size })}</span>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 rounded"
          >
            <Trash2 className="h-3 w-3" /> {t('dataTable.batchDelete')}
          </button>
          <button
            onClick={() => setShowBulkEdit(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-sidebar-primary hover:bg-sidebar-primary/10 rounded"
          >
            <Pencil className="h-3 w-3" /> {t('dataTable.batchEdit')}
          </button>
          <button
            onClick={() => setSelectedRows(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            {t('dataTable.cancelSelection')}
          </button>
        </div>
      )}

      {/* Bulk edit dialog */}
      {showBulkEdit && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowBulkEdit(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-xl shadow-2xl p-4 w-80">
              <h3 className="text-sm font-semibold text-foreground mb-3">{t('dataTable.batchEditTitle', { n: selectedRows.size })}</h3>
              <div className="space-y-3">
                <select
                  value={bulkEditCol}
                  onChange={e => setBulkEditCol(e.target.value)}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="">{t('dataTable.selectField')}</option>
                  {editableCols.map(c => (
                    <option key={c.column_id} value={c.title}>{c.title}</option>
                  ))}
                </select>
                <input
                  value={bulkEditVal}
                  onChange={e => setBulkEditVal(e.target.value)}
                  placeholder={t('dataTable.newValue')}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => { setShowBulkEdit(false); setBulkEditCol(''); setBulkEditVal(''); }}
                    className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded border border-border"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleBulkEdit}
                    disabled={!bulkEditCol}
                    className="px-3 py-1.5 text-xs text-white bg-sidebar-primary rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {t('dataTable.confirmEdit')}
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
          <span>{totalRows} {t('dataTable.rows')}</span>
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
                <h3 className="text-sm font-semibold text-foreground">{t('dataTable.importCSVTitle')}</h3>
                <button onClick={() => { setCsvImportData(null); setCsvColMap({}); }} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2">
                <p className="text-xs text-muted-foreground mb-3">
                  {t('dataTable.importCSVRows', { n: csvImportData.rows.length })}
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
                      <option value="">{t('dataTable.skip')}</option>
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
                  {t('dataTable.mappedCols', { mapped: Object.values(csvColMap).filter(Boolean).length, total: csvImportData.headers.length })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setCsvImportData(null); setCsvColMap({}); }}
                    className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded border border-border"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleCSVImport}
                    disabled={csvImporting || Object.values(csvColMap).filter(Boolean).length === 0}
                    className="px-3 py-1.5 text-xs text-white bg-sidebar-primary rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {csvImporting ? t('dataTable.importing') : t('dataTable.importNRows', { n: csvImportData.rows.length })}
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

      {/* Mobile Edit FAB */}
      {isMobile && (
        <EditFAB
          isEditing={mobileEditing}
          onEdit={() => setMobileEditing(true)}
          onSave={() => {
            // Save any active edit before exiting edit mode
            if (editingCell) saveEdit();
            setMobileEditing(false);
          }}
          onCancel={() => {
            setEditingCell(null);
            setMobileEditing(false);
          }}
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
          const target = attachmentTargetRef.current;
          if (e.target.files && target) {
            setAttachmentUploading(target);
            handleAttachmentUpload(target.rowId, target.col, e.target.files);
            attachmentTargetRef.current = null;
          }
          e.target.value = ''; // reset so same file can be re-selected
        }}
      />

      </div>{/* end main table content */}

      </div>
      </div>{/* end left column */}

      {/* Sidebar — full height, independent column */}
      {showTableComments && !showHistory && (
        <>
          <div className="w-80 border-l border-border bg-card hidden md:flex flex-col shrink-0 overflow-hidden h-full">
            <CommentPanel
              targetType="table"
              targetId={tableId}
              onClose={() => setShowTableComments(false)}
            />
          </div>
          {isMobile && (
            <BottomSheet open={showTableComments} onClose={() => setShowTableComments(false)} title={t('content.comments')} initialHeight="full">
              <CommentPanel
                targetType="table"
                targetId={tableId}
                onClose={() => setShowTableComments(false)}
              />
            </BottomSheet>
          )}
        </>
      )}

      {showHistory && (
        <>
          <div className="w-72 border-l border-border bg-card hidden md:flex flex-col shrink-0 overflow-hidden h-full">
            <TableHistory
              tableId={tableId}
              onClose={() => { setShowHistory(false); setPreviewSnapshot(null); }}
              onRestored={() => { setPreviewSnapshot(null); refresh(); }}
              onSelectVersion={(preview) => setPreviewSnapshot(preview)}
              selectedSnapshotId={previewSnapshot?.snapshotId ?? null}
            />
          </div>
          {isMobile && (
            <BottomSheet open={showHistory} onClose={() => { setShowHistory(false); setPreviewSnapshot(null); }} title={t('dataTableHistory.title')} initialHeight="full">
              <TableHistory
                tableId={tableId}
                onClose={() => { setShowHistory(false); setPreviewSnapshot(null); }}
                onRestored={() => { setPreviewSnapshot(null); refresh(); }}
                onSelectVersion={(preview) => setPreviewSnapshot(preview)}
                selectedSnapshotId={previewSnapshot?.snapshotId ?? null}
              />
            </BottomSheet>
          )}
        </>
      )}
    </div>
  );
}

// ── Rating stars ──

function SnapshotCellValue({ value, colType }: { value: unknown; colType: string }) {
  if (value == null || value === '') return null;

  // Checkbox
  if (colType === 'Checkbox') {
    return <span>{value ? '✓' : ''}</span>;
  }

  // SingleSelect
  if (colType === 'SingleSelect') {
    const label = String(value);
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight bg-muted text-foreground">
        {label}
      </span>
    );
  }

  // MultiSelect
  if (colType === 'MultiSelect') {
    const items = String(value).split(',').map(s => s.trim()).filter(Boolean);
    return (
      <span className="flex flex-wrap gap-0.5">
        {items.map((item, i) => (
          <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight bg-muted text-foreground">
            {item}
          </span>
        ))}
      </span>
    );
  }

  // Date/DateTime/CreatedTime/LastModifiedTime
  if (colType === 'Date' || colType === 'DateTime' || colType === 'CreatedTime' || colType === 'CreateTime' || colType === 'LastModifiedTime') {
    try { return <span>{new Date(String(value)).toLocaleDateString()}</span>; } catch { return <span>{String(value)}</span>; }
  }

  // Attachment
  if (colType === 'Attachment') {
    const files = Array.isArray(value) ? value : [];
    if (files.length === 0) return null;
    return <span className="truncate">{files.map((f: any) => f.title || f.fileName || 'file').join(', ')}</span>;
  }

  // User/CreatedBy/LastModifiedBy
  if (colType === 'User' || colType === 'CreatedBy' || colType === 'LastModifiedBy' || colType === 'Collaborator') {
    if (typeof value === 'string') return <span>{value}</span>;
    if (Array.isArray(value)) return <span>{value.map((v: any) => v.display_name || v.email || String(v)).join(', ')}</span>;
    if (typeof value === 'object' && value !== null) return <span>{(value as any).display_name || (value as any).email || JSON.stringify(value)}</span>;
    return <span>{String(value)}</span>;
  }

  // Links
  if (colType === 'Links' || colType === 'LinkToAnotherRecord') {
    const arr = Array.isArray(value) ? value : [];
    if (arr.length > 0) {
      return <span>{arr.map((v: any) => (typeof v === 'object' ? (v.Title || v.title || v.Name || v.name || JSON.stringify(v)) : String(v))).join(', ')}</span>;
    }
    const num = parseInt(String(value)) || 0;
    return <span className="text-muted-foreground">{num > 0 ? `${num} linked` : ''}</span>;
  }

  // Number types
  if (colType === 'Number' || colType === 'Decimal' || colType === 'Currency' || colType === 'Percent' || colType === 'Rating' || colType === 'AutoNumber') {
    return <span>{String(value)}</span>;
  }

  // Boolean (non-checkbox)
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;

  // Array
  if (Array.isArray(value)) {
    return <span className="truncate">{value.map(v => typeof v === 'object' ? ((v as any).title || (v as any).Title || JSON.stringify(v)) : String(v)).join(', ')}</span>;
  }

  // Object
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return <span className="truncate text-muted-foreground">{obj.title || obj.Title || obj.display_name || JSON.stringify(value)}</span>;
  }

  // Default: string
  return <span className="truncate">{String(value)}</span>;
}

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

function DatePickerDropdown({ value, showTime, onChange, onClose }: {
  value: string;
  showTime: boolean;
  onChange: (dateStr: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  // Parse value without Date object to avoid timezone issues
  // value can be "YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss", or ISO with Z
  const parseValue = (v: string) => {
    if (!v) return null;
    const match = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!match) return null;
    return { year: parseInt(match[1]), month: parseInt(match[2]) - 1, day: parseInt(match[3]), hours: match[4] ? parseInt(match[4]) : 0, minutes: match[5] ? parseInt(match[5]) : 0 };
  };
  const parsed = parseValue(value);
  const now = new Date();
  const [viewYear, setViewYear] = useState(parsed?.year ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? now.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(parsed?.day ?? null);
  const [selectedMonth, setSelectedMonth] = useState(parsed?.month ?? now.getMonth());
  const [selectedYear, setSelectedYear] = useState(parsed?.year ?? now.getFullYear());
  const [timeStr, setTimeStr] = useState(
    parsed ? `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}` : '00:00'
  );

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun (standard)
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDayOfWeek).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

  const buildDateStr = (year: number, month: number, day: number) => {
    const [hh, mm] = timeStr.split(':').map(Number);
    const y = year;
    const mo = String(month + 1).padStart(2, '0');
    const da = String(day).padStart(2, '0');
    if (showTime) {
      const hours = String(hh || 0).padStart(2, '0');
      const mins = String(mm || 0).padStart(2, '0');
      return `${y}-${mo}-${da} ${hours}:${mins}`;
    }
    return `${y}-${mo}-${da}`;
  };

  const handleDayClick = (day: number) => {
    // Update internal highlight immediately
    setSelectedDay(day);
    setSelectedMonth(viewMonth);
    setSelectedYear(viewYear);
    // Save to cell
    onChange(buildDateStr(viewYear, viewMonth, day));
  };

  const handleClear = () => { onChange(''); onClose(); };

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  const isToday = (day: number) => {
    const now = new Date();
    return viewYear === now.getFullYear() && viewMonth === now.getMonth() && day === now.getDate();
  };
  const isSelected = (day: number) => {
    if (selectedDay === null) return false;
    return viewYear === selectedYear && viewMonth === selectedMonth && day === selectedDay;
  };

  const WEEKDAYS = (t('dataTable.weekdays', { returnObjects: true }) as unknown as string[]) || ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}`);

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
      {/* Month navigation — month name left, Today + arrows right */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-foreground">{t('dataTable.monthNames', { returnObjects: true })?.[viewMonth] || `${viewMonth + 1}月`} {viewYear}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => { const now = new Date(); setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); setSelectedDay(now.getDate()); setSelectedMonth(now.getMonth()); setSelectedYear(now.getFullYear()); onChange(buildDateStr(now.getFullYear(), now.getMonth(), now.getDate())); }} className="text-[10px] text-muted-foreground hover:text-foreground mr-1">{t('dataTable.today')}</button>
          <button onClick={prevMonth} className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button onClick={nextMonth} className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
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
            onChange={e => {
              const newTime = e.target.value;
              setTimeStr(newTime);
              // If a date is already selected, immediately save with new time
              if (currentParsed) {
                const [hh, mm] = newTime.split(':').map(Number);
                const y = currentParsed.year;
                const mo = String(currentParsed.month + 1).padStart(2, '0');
                const da = String(currentParsed.day).padStart(2, '0');
                onChange(`${y}-${mo}-${da} ${String(hh || 0).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}`);
              }
            }}
            className="bg-muted rounded px-2 py-1 text-xs text-foreground outline-none"
          />
        </div>
      )}
      {/* Footer */}
      <div className="px-3 pb-2 flex items-center justify-between">
        <button onClick={handleClear} className="text-[10px] text-muted-foreground hover:text-foreground">{t('dataTable.clear')}</button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-xs px-3 py-1 rounded transition-colors bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90"
        >{t('common.confirm')}</button>
      </div>
    </div>
  );
}

// ── Linked record chips for Link columns ──

function LinkedRecordChips({ tableId, rowId, column, value }: { tableId: string; rowId: number; column: br.BRColumn; value: unknown }) {
  const { t } = useT();
  const inlineRecords = Array.isArray(value) ? value as Record<string, unknown>[] : [];
  const num = inlineRecords.length || (parseInt(String(value)) || 0);

  // Only fetch if value is a count (not inline array) and count > 0
  const needsFetch = !Array.isArray(value) && num > 0;
  const { data: linkedData } = useQuery({
    queryKey: ['nc-linked-records', tableId, rowId, column.column_id],
    queryFn: () => br.listLinkedRecords(tableId, rowId, column.column_id, { limit: 10 }),
    enabled: needsFetch,
    staleTime: 60_000,
  });

  if (num === 0) {
    return (
      <span className="text-xs py-1.5 flex items-center gap-1 text-muted-foreground/40 hover:text-sidebar-primary cursor-pointer select-none">
        <Plus className="h-3 w-3" />
      </span>
    );
  }

  // Use inline data if available, otherwise use fetched data
  const records = inlineRecords.length > 0 ? inlineRecords : (linkedData?.list || []);

  if (records.length === 0) {
    // Still loading — show count as fallback
    return <span className="text-xs py-1.5 block text-sidebar-primary cursor-pointer">{t('dataTable.nLinkedRecords', { n: num })}</span>;
  }

  // Find display column value: use first non-Id string field
  const getDisplayValue = (rec: Record<string, unknown>): string => {
    const tryKeys = ['Title', 'title', 'Name', 'name'];
    for (const k of tryKeys) {
      if (rec[k] && typeof rec[k] === 'string') return rec[k] as string;
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k !== 'Id' && k !== 'id' && typeof v === 'string' && v.trim()) return v;
    }
    return `#${rec.Id || '?'}`;
  };

  const MAX_CHIPS = 2;
  const shown = records.slice(0, MAX_CHIPS);
  const remaining = num - MAX_CHIPS;

  return (
    <div className="flex flex-wrap gap-1 py-0.5 items-center">
      {shown.map((rec, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sidebar-primary/10 text-sidebar-primary text-[11px] leading-tight max-w-[120px] truncate"
          title={getDisplayValue(rec)}
        >
          {getDisplayValue(rec)}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[10px] text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}

// ── Cell display ──

function CellDisplay({ value, col, onDeleteAttachment }: { value: unknown; col: br.BRColumn; onDeleteAttachment?: (idx: number) => void }) {
  const { t } = useT();
  const { type: colType, primary_key: isPK } = col;

  if (value == null || value === '') {
    // Show placeholder for Attachment and User types even when empty
    if (colType === 'Attachment') {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><Upload className="h-3 w-3" /> {t('dataTable.clickToUpload')}</span>;
    }
    if (colType === 'User' || colType === 'Collaborator') {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><User className="h-3 w-3" /> {t('dataTable.selectMember')}</span>;
    }
    return <span className="text-xs py-1.5 block select-none">&nbsp;</span>;
  }

  // Safely convert to string — avoid [object Object]
  const str = (typeof value === 'object' && value !== null)
    ? (Array.isArray(value) ? JSON.stringify(value) : JSON.stringify(value))
    : String(value);

  // Checkbox
  if (colType === 'Checkbox') {
    const checked = !!value;
    return (
      <div className="flex items-center justify-center py-1">
        <div className={cn(
          'w-4 h-4 rounded border flex items-center justify-center cursor-pointer',
          checked ? 'bg-sidebar-primary border-sidebar-primary' : 'border-border bg-transparent'
        )}>
          {checked && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
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
    // Parse date string directly without Date object to avoid timezone issues
    const dateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!dateMatch) return <span className="text-xs py-1.5 block text-foreground/70">{str}</span>;
    const meta = col.meta as Record<string, unknown> | undefined;
    const fmt = (meta?.date_format as string) || 'YYYY-MM-DD';
    const y = dateMatch[1];
    const m = dateMatch[2];
    const day = dateMatch[3];
    const hh = dateMatch[4] || '00';
    const mm = dateMatch[5] || '00';
    const formatted = fmt
      .replace('YYYY', y)
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
    let decimals: number, thousands: boolean, prefix: string, suffix: string;
    if (colType === 'Number' && meta?.prefix !== undefined) {
      // Legacy merged Number with numFormat meta
      decimals = (meta?.decimals as number) ?? 0;
      thousands = !!meta?.thousands;
      prefix = (meta?.prefix as string) || '';
      suffix = (meta?.suffix as string) || '';
    } else if (colType === 'Currency') {
      decimals = 2;
      thousands = true;
      prefix = (meta?.currency_code as string) || '$';
      suffix = '';
    } else if (colType === 'Percent') {
      decimals = 1;
      thousands = false;
      prefix = '';
      suffix = '%';
    } else if (colType === 'Decimal') {
      decimals = (meta?.precision as number) ?? 2;
      thousands = false;
      prefix = '';
      suffix = '';
    } else {
      decimals = 0;
      thousands = false;
      prefix = '';
      suffix = '';
    }
    const formatted = thousands
      ? num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : num.toFixed(decimals);
    return <span className="text-xs tabular-nums py-1.5 block text-right">{prefix}{formatted}{suffix}</span>;
  }

  // Duration
  if (colType === 'Duration') {
    const seconds = parseFloat(str);
    if (isNaN(seconds)) return <span className="text-xs tabular-nums py-1.5 block text-right">{str}</span>;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return <span className="text-xs tabular-nums py-1.5 block text-right">{h}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
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
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><Upload className="h-3 w-3" /> {t('dataTable.clickToUpload')}</span>;
    }
    try {
      const attachments = Array.isArray(value) ? value : JSON.parse(str);
      if (Array.isArray(attachments) && attachments.length > 0) {
        const isImage = (a: any) => a.mimetype?.startsWith('image/');
        return (
          <div className="flex gap-1 py-1 items-center">
            {attachments.slice(0, 3).map((a: any, i: number) => (
              <span key={i} className="relative group/att inline-flex">
                {isImage(a) ? (
                  <img src={ncAttachmentUrl(a)} className="h-6 w-6 rounded object-cover border border-border" alt={a.title} title={a.title || a.path} />
                ) : (
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded truncate max-w-[80px] flex items-center gap-0.5" title={a.title || a.path}>
                    <Paperclip className="h-2.5 w-2.5 shrink-0" />
                    {a.title || t('dataTable.attachmentName', { n: i + 1 })}
                  </span>
                )}
                {onDeleteAttachment && (
                  <button
                    className="absolute -top-1.5 -right-1.5 hidden group-hover/att:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
                    onClick={(e) => { e.stopPropagation(); onDeleteAttachment(i); }}
                    title={t('common.delete')}
                  >
                    <X className="h-2 w-2" />
                  </button>
                )}
              </span>
            ))}
            {attachments.length > 3 && <span className="text-[10px] text-muted-foreground">+{attachments.length - 3}</span>}
          </div>
        );
      }
    } catch {}
    if (!str || str === '[]') {
      return (
        <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1">
          <Upload className="h-3 w-3" /> {t('dataTable.clickToUpload')}
        </span>
      );
    }
    return <span className="text-xs py-1.5 block text-muted-foreground">{str.slice(0, 30)}</span>;
  }

  // User
  if (colType === 'User' || colType === 'Collaborator') {
    if (!str) return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><User className="h-3 w-3" /> {t('dataTable.selectMember')}</span>;
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

  // Links — show count with expand icon, or "+" when empty
  if (colType === 'Links' || colType === 'LinkToAnotherRecord') {
    const linked = Array.isArray(value) ? value : [];
    const num = linked.length || parseInt(str) || 0;
    if (num === 0) {
      return (
        <span className="text-xs py-1.5 flex items-center gap-1 text-muted-foreground/40 hover:text-sidebar-primary cursor-pointer select-none">
          <Plus className="h-3 w-3" />
        </span>
      );
    }
    return <span className="text-xs py-1.5 block text-sidebar-primary cursor-pointer">{t('dataTable.nLinkedRecords', { n: num })}</span>;
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

function KanbanView({ rows, columns, activeView, isLoading, onUpdateRow, onAddRow, tableId, refreshMeta, hiddenCols, onExpandRow, onRefreshRows }: {
  rows: Record<string, unknown>[];
  columns: br.BRColumn[];
  activeView: br.BRView;
  isLoading: boolean;
  onUpdateRow: (rowId: number, fields: Record<string, unknown>) => Promise<void>;
  onAddRow: () => void;
  tableId: string;
  refreshMeta: () => void;
  hiddenCols: Set<string>;
  onExpandRow?: (rowId: number) => void;
  onRefreshRows?: () => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [grpColPicker, setGrpColPicker] = useState(false);
  // All hooks MUST be called before any conditional return (React rules of hooks)
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const kanbanSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const grpColId = activeView.fk_grp_col_id;
  const grpCol = columns.find(c => c.column_id === grpColId);
  const titleCol = columns.find(c => c.primary_key) || columns[0];
  const coverColId = activeView.fk_cover_image_col_id;
  const coverCol = coverColId ? columns.find(c => c.column_id === coverColId) : null;

  // If no grouping column set, show picker
  if (!grpCol) {
    const selectCols = columns.filter(c => c.type === 'SingleSelect');
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-card border border-border rounded-xl p-6 max-w-sm text-center space-y-3">
          <Columns className="h-8 w-8 mx-auto text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('dataTable.kanbanNeedField')}</h3>
          <p className="text-xs text-muted-foreground">{t('dataTable.kanbanNeedFieldHint')}</p>
          {selectCols.length > 0 ? (
            <div className="space-y-1">
              {selectCols.map(c => (
                <button
                  key={c.column_id}
                  onClick={async () => {
                    await br.updateKanbanConfig(activeView.view_id, { fk_grp_col_id: c.column_id });
                    refreshMeta();
                  }}
                  className="w-full px-3 py-2 text-xs bg-muted hover:bg-accent rounded-lg text-foreground"
                >
                  {c.title}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">{t('dataTable.noSingleSelectField')}</p>
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
    // Optimistic update: move card to new group immediately before server responds
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
      if (!data) return old;
      return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [grpCol.title]: newVal } : r) };
    });
    try {
      await br.updateRow(tableId, rowId, { [grpCol.title]: newVal });
    } catch {
      onRefreshRows?.(); // revert on failure
    }
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
              {isUncat && <span className="text-xs text-muted-foreground">{t('dataTable.uncategorized')}</span>}
              <span className="text-[10px] text-muted-foreground ml-auto">{groupRows.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              <SortableContext items={groupRows.map(r => r.Id as number)} strategy={verticalListSortingStrategy}>
              {groupRows.map((row, i) => {
                const rowId = row.Id as number;
                return (
                  <KanbanCard key={rowId ?? i} id={rowId} isDragging={draggedRowId === rowId}>
                    {coverCol && (() => {
                      const coverVal = row[coverCol.title];
                      if (!coverVal) return <div className="w-full h-24 bg-muted/60 rounded-t -m-3 mb-1.5" style={{ width: 'calc(100% + 24px)' }} />;
                      try {
                        const arr = Array.isArray(coverVal) ? coverVal : JSON.parse(String(coverVal));
                        const img = arr.find((a: any) => a.mimetype?.startsWith('image/'));
                        if (!img) return <div className="w-full h-24 bg-muted/60 rounded-t -m-3 mb-1.5" style={{ width: 'calc(100% + 24px)' }} />;
                        return <img src={ncAttachmentUrl(img)} className="w-full h-24 object-cover rounded-t -m-3 mb-1.5" style={{ width: 'calc(100% + 24px)' }} alt="" />;
                      } catch { return <div className="w-full h-24 bg-muted/60 rounded-t -m-3 mb-1.5" style={{ width: 'calc(100% + 24px)' }} />; }
                    })()}
                    <div className="text-xs font-medium text-foreground truncate cursor-pointer" onClick={() => onExpandRow?.(rowId)}>
                      {titleCol ? String(row[titleCol.title] ?? '') : `#${rowId}`}
                    </div>
                    {columns.filter(c => c !== titleCol && !c.primary_key && c.title !== 'created_by' && !hiddenCols.has(c.column_id)).map(c => {
                      const val = row[c.title];
                      if (val == null || val === '') return null;
                      return (
                        <div key={c.column_id} className="flex items-start gap-1">
                          <span className="text-[10px] text-muted-foreground shrink-0">{c.title}:</span>
                          <CompactCellDisplay value={val} col={c} />
                        </div>
                      );
                    })}
                  </KanbanCard>
                );
              })}
              </SortableContext>
            </div>
          </KanbanColumn>
        );
      })}
    </div>
    <DragOverlay>
      {draggedRowId != null ? (() => {
        const row = rows.find(r => (r.Id as number) === draggedRowId);
        if (!row) return null;
        return (
          <div className="bg-card border border-sidebar-primary rounded-lg p-3 shadow-xl space-y-1.5 w-60 opacity-90">
            <div className="text-xs font-medium text-foreground truncate">
              {titleCol ? String(row[titleCol.title] ?? '') : `#${draggedRowId}`}
            </div>
          </div>
        );
      })() : null}
    </DragOverlay>
    </DndContext>
  );
}

// ── Gallery View ──

function GalleryView({ rows, columns, activeView, isLoading, onAddRow, hiddenCols, onExpandRow }: {
  rows: Record<string, unknown>[];
  columns: br.BRColumn[];
  activeView?: br.BRView;
  isLoading: boolean;
  onAddRow: () => void;
  hiddenCols: Set<string>;
  onExpandRow?: (rowId: number) => void;
}) {
  const { t } = useT();
  const titleCol = columns.find(c => c.primary_key) || columns[0];
  const coverColId = activeView?.fk_cover_image_col_id;
  const coverCol = coverColId ? columns.find(c => c.column_id === coverColId) : null;
  const detailCols = columns.filter(c => c !== titleCol && !c.primary_key && c.title !== 'created_by' && !hiddenCols.has(c.column_id));

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
              className="bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => onExpandRow?.(rowId)}
            >
              {coverCol && (() => {
                const coverVal = row[coverCol.title];
                if (!coverVal) return <div className="w-full h-32 bg-muted/60" />;
                try {
                  const arr = Array.isArray(coverVal) ? coverVal : JSON.parse(String(coverVal));
                  const img = arr.find((a: any) => a.mimetype?.startsWith('image/'));
                  if (!img) return <div className="w-full h-32 bg-muted/60" />;
                  return <img src={ncAttachmentUrl(img)} className="w-full h-32 object-cover" alt="" />;
                } catch { return <div className="w-full h-32 bg-muted/60" />; }
              })()}
              <div className="p-4 space-y-2">
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
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-muted-foreground">{c.title}</div>
                      <CompactCellDisplay value={val} col={c} />
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          );
        })}
        <button
          onClick={onAddRow}
          className="border-2 border-dashed border-border rounded-lg p-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <Plus className="h-5 w-5 mr-1" /> {t('dataTable.newRecord')}
        </button>
      </div>
    </div>
  );
}

// ── Form View ──

function FormView({ columns, tableId, onSubmit }: {
  columns: br.BRColumn[];
  tableId: string;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useT();
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
    } catch (e) { console.error('Form submit failed:', e); }
    setSubmitting(false);
  };

  return (
    <div className="flex-1 overflow-auto flex justify-center py-8">
      <div className="w-full max-w-lg space-y-4 px-4">
        <h3 className="text-lg font-semibold text-foreground">{t('dataTable.newRecordTitle')}</h3>
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
                  <span className="text-xs text-foreground">{t('dataTable.yes')}</span>
                </label>
              ) : col.type === 'SingleSelect' && col.options?.length ? (
                <select
                  value={formData[col.title] || ''}
                  onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.value }))}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="">{t('dataTable.selectPlaceholder')}</option>
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
            {submitting ? t('dataTable.submitting') : t('dataTable.submit')}
          </button>
          {submitted && <span className="text-xs text-green-500">{t('dataTable.submitted')}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Calendar View ──

function CalendarView({ rows, columns, isLoading }: {
  rows: Record<string, unknown>[];
  columns: br.BRColumn[];
  isLoading: boolean;
}) {
  const { t } = useT();
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
          <h3 className="text-sm font-semibold text-foreground">{t('dataTable.needDateField')}</h3>
          <p className="text-xs text-muted-foreground">{t('dataTable.needDateFieldHint')}</p>
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

  const weekDaysRaw = t('dataTable.weekdays', { returnObjects: true });
  const weekDays = Array.isArray(weekDaysRaw) ? weekDaysRaw as string[] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  if (isLoading) {
    return <div className="flex-1 p-4"><div className="h-full rounded bg-muted/50 animate-pulse" /></div>;
  }

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
        <h3 className="text-sm font-semibold text-foreground">{t('dataTable.yearMonth', { year, month: month + 1 })}</h3>
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
