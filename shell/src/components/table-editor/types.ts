/**
 * Shared types, constants, and utility functions for the TableEditor component family.
 * Extracted from TableEditor.tsx during refactoring — no behavior changes.
 */

import { Type } from 'lucide-react';
import { ColumnTypeDef, COLUMN_TYPES, COLUMN_TYPE_GROUPS } from '@/lib/shared/table-types';

// ── Content Link detection ──
export const CONTENT_LINK_RE = /(?:https?:\/\/[^/]+)?\/content\?id=((?:doc|table|presentation|diagram)(?::|%3A)([a-zA-Z0-9_-]+))/i;
export const CONTENT_LINK_RE_G = /(?:https?:\/\/[^/]+)?\/content\?id=((?:doc|table|presentation|diagram)(?::|%3A)([a-zA-Z0-9_-]+))/gi;

export function extractContentId(text: string): string | null {
  const m = text.trim().match(CONTENT_LINK_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── Column type config ──

/** @deprecated Use ColumnTypeDef from lib/shared/table-types */
export type ColTypeDef = ColumnTypeDef;

export { COLUMN_TYPES };

export function tColType(t: (key: string) => string, ct: ColTypeDef): string {
  return t(`dataTable.colTypes.${ct.value}`);
}

export const GROUP_KEYS = COLUMN_TYPE_GROUPS;

export function getColIcon(uidt: string) {
  return COLUMN_TYPES.find(c => c.value === uidt)?.icon || Type;
}

// ── Select option colors ──

export const SELECT_COLORS = [
  '#d4e5ff', '#d1f0e0', '#fde2cc', '#fdd8d8', '#e8d5f5',
  '#d5e8f5', '#fff3bf', '#f0d5e8', '#d5f5e8', '#e8e8d5',
];

export function getOptionColor(color?: string, idx?: number) {
  if (color) return color;
  return SELECT_COLORS[(idx || 0) % SELECT_COLORS.length];
}

// ── Read-only column types ──
export const READONLY_TYPES = new Set(['ID', 'AutoNumber', 'CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'Formula', 'Rollup', 'Lookup', 'Count', 'Links']);

/** Resolve attachment path to a proxied URL */
export function attachmentUrl(a: { signedPath?: string; path?: string; url?: string }): string {
  const p = (a as { url?: string }).url || a.signedPath || a.path || '';
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  if (p.startsWith('/api/gateway/')) return p;
  if (p.startsWith('/api/')) return `/api/gateway${p.slice(4)}`;
  if (p.startsWith('/uploads/')) return `/api/gateway${p}`;
  return `/api/gateway/uploads/files/${encodeURIComponent(p.replace(/^\/+/, ''))}`;
}

// ── Filter operators ──
export const FILTER_OPS = [
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

export function getFilterOpsForType(colType?: string): typeof FILTER_OPS {
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
import { LayoutGrid, Columns, GalleryHorizontalEnd, FileText } from 'lucide-react';

export const VIEW_TYPES = [
  { type: 'grid', typeNum: 3, key: 'grid', icon: LayoutGrid },
  { type: 'kanban', typeNum: 4, key: 'kanban', icon: Columns },
  { type: 'gallery', typeNum: 2, key: 'gallery', icon: GalleryHorizontalEnd },
  { type: 'form', typeNum: 1, key: 'form', icon: FileText },
] as const;

export function getViewIcon(typeNum: number) {
  return VIEW_TYPES.find(v => v.typeNum === typeNum)?.icon || LayoutGrid;
}

// ── Check if cell needs special editor ──
export const isSelectType = (type: string) => type === 'SingleSelect' || type === 'MultiSelect';

// ── Get input type for cell editing ──
export const getInputType = (colType: string) => {
  switch (colType) {
    case 'Number': case 'Decimal': case 'Currency': case 'Percent': case 'Rating': case 'Year': return 'text';
    case 'Date': case 'DateTime': case 'Time': return 'text';
    case 'Email': return 'email';
    case 'URL': return 'url';
    case 'PhoneNumber': return 'tel';
    default: return 'text';
  }
};

// ── TableEditor props ──
export interface TableEditorProps {
  tableId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack: () => void;
  onDeleted?: () => void;
  onDuplicate?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
  onNavigate?: (id: string) => void;
}

// ── Keyboard shortcuts ──
import type { ShortcutRegistration } from '@/lib/keyboard';

export const TABLE_SHORTCUTS: ShortcutRegistration[] = [
  {
    id: 'table-enter',
    key: 'Enter',
    handler: () => window.dispatchEvent(new CustomEvent('table:edit-cell')),
    label: 'table.editCell',
    category: 'Table',
    priority: 5,
  },
  {
    id: 'table-escape',
    key: 'Escape',
    handler: () => window.dispatchEvent(new CustomEvent('table:exit-edit')),
    label: 'table.exitEdit',
    category: 'Table',
    priority: 5,
  },
  {
    id: 'table-tab',
    key: 'Tab',
    handler: () => window.dispatchEvent(new CustomEvent('table:next-cell')),
    label: 'table.nextCell',
    category: 'Table',
    priority: 5,
  },
  {
    id: 'table-shift-tab',
    key: 'Tab',
    modifiers: { shift: true },
    handler: () => window.dispatchEvent(new CustomEvent('table:prev-cell')),
    label: 'table.prevCell',
    category: 'Table',
    priority: 6,
  },
  {
    id: 'table-copy',
    key: 'c',
    modifiers: { meta: true },
    handler: () => window.dispatchEvent(new CustomEvent('table:copy-cell')),
    label: 'common.copy',
    category: 'Table',
    priority: 5,
  },
];
