/**
 * Shared TypeScript types and constants for table/database operations.
 *
 * Extracted from TableEditor to be reusable across components
 * (table views, content links, search results, etc.).
 */

// ── Column types (matching Baserow field type values) ──

export type ColumnType =
  | 'SingleLineText'
  | 'LongText'
  | 'Email'
  | 'URL'
  | 'PhoneNumber'
  | 'Number'
  | 'Decimal'
  | 'Currency'
  | 'Percent'
  | 'Rating'
  | 'AutoNumber'
  | 'Date'
  | 'DateTime'
  | 'Checkbox'
  | 'SingleSelect'
  | 'MultiSelect'
  | 'Links'
  | 'Lookup'
  | 'Rollup'
  | 'Formula'
  | 'Attachment'
  | 'JSON'
  | 'User'
  | 'CreatedBy'
  | 'LastModifiedBy';

// ── Column type grouping ──

export type ColumnTypeGroup = 'text' | 'number' | 'datetime' | 'select' | 'relation' | 'other';

export interface ColumnTypeDef {
  value: ColumnType;
  label: string;
  group: ColumnTypeGroup;
}

export const COLUMN_TYPE_GROUPS: ColumnTypeGroup[] = ['text', 'number', 'datetime', 'select', 'relation', 'other'];

export const COLUMN_TYPES: ColumnTypeDef[] = [
  // Text
  { value: 'SingleLineText', label: 'SingleLineText', group: 'text' },
  { value: 'LongText',       label: 'LongText',       group: 'text' },
  { value: 'Email',          label: 'Email',           group: 'text' },
  { value: 'URL',            label: 'URL',             group: 'text' },
  { value: 'PhoneNumber',    label: 'PhoneNumber',     group: 'text' },
  // Number
  { value: 'Number',         label: 'Number',          group: 'number' },
  { value: 'Decimal',        label: 'Decimal',         group: 'number' },
  { value: 'Currency',       label: 'Currency',        group: 'number' },
  { value: 'Percent',        label: 'Percent',         group: 'number' },
  { value: 'Rating',         label: 'Rating',          group: 'number' },
  { value: 'AutoNumber',     label: 'AutoNumber',      group: 'number' },
  // Date & Time
  { value: 'Date',           label: 'Date',            group: 'datetime' },
  { value: 'DateTime',       label: 'DateTime',        group: 'datetime' },
  // Selection
  { value: 'Checkbox',       label: 'Checkbox',        group: 'select' },
  { value: 'SingleSelect',   label: 'SingleSelect',    group: 'select' },
  { value: 'MultiSelect',    label: 'MultiSelect',     group: 'select' },
  // Relation & Computed
  { value: 'Links',          label: 'Links',           group: 'relation' },
  { value: 'Lookup',         label: 'Lookup',          group: 'relation' },
  { value: 'Rollup',         label: 'Rollup',          group: 'relation' },
  { value: 'Formula',        label: 'Formula',         group: 'relation' },
  // Other
  { value: 'Attachment',     label: 'Attachment',      group: 'other' },
  { value: 'JSON',           label: 'JSON',            group: 'other' },
  { value: 'User',           label: 'User',            group: 'other' },
  { value: 'CreatedBy',      label: 'CreatedBy',       group: 'other' },
  { value: 'LastModifiedBy', label: 'LastModifiedBy',  group: 'other' },
];

// ── Column definition ──

export interface SelectOption {
  label: string;
  color: string;
}

export interface ColumnDef {
  id: string;
  title: string;
  type: ColumnType;
  width?: number;
  options?: SelectOption[];  // for SingleSelect / MultiSelect
}

// ── Table metadata ──

export interface TableMeta {
  id: string;
  title: string;
  columns: ColumnDef[];
  row_count: number;
  created_at: string;
  updated_at: string;
}

// ── Color palettes for select options ──

export const OPTION_COLORS = [
  '#d4e5ff',  // light blue
  '#d1f0e0',  // light green
  '#fde2cc',  // light orange
  '#fdd8d8',  // light red
  '#e8d5f5',  // light purple
  '#d5e8f5',  // sky blue
  '#fff3bf',  // light yellow
  '#f0d5e8',  // light pink
  '#d5f5e8',  // mint
  '#e8e8d5',  // light olive
];

/** Get an option color by index (cycles through palette) */
export function getOptionColor(color?: string, idx?: number): string {
  if (color) return color;
  return OPTION_COLORS[(idx || 0) % OPTION_COLORS.length];
}

// ── Read-only column types (not user-editable) ──

export const READONLY_COLUMN_TYPES = new Set<string>([
  'ID', 'AutoNumber', 'CreatedTime', 'LastModifiedTime',
  'CreatedBy', 'LastModifiedBy', 'Formula', 'Rollup',
  'Lookup', 'Count', 'Links',
]);

/** Check if a column type is read-only */
export function isReadonlyColumnType(type: string): boolean {
  return READONLY_COLUMN_TYPES.has(type);
}

// ── Helpers ──

/** Get column type definition by value */
export function getColumnTypeDef(type: ColumnType): ColumnTypeDef | undefined {
  return COLUMN_TYPES.find(ct => ct.value === type);
}

/** Get all column types in a group */
export function getColumnTypesByGroup(group: ColumnTypeGroup): ColumnTypeDef[] {
  return COLUMN_TYPES.filter(ct => ct.group === group);
}
