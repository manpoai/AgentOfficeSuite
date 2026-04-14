/**
 * Tables API client — calls the Gateway tableEngine via /api/gateway/data/* proxy.
 */

const BASE = '/api/gateway/data';

async function brFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('aose_token') : null;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`Tables API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface BRTable {
  id: string;
  title: string;
  type?: string;
  order?: number;
  created_at?: string;
}

export interface BRSelectOption {
  title: string;
  color?: string;
  order?: number;
}

export interface BRColumn {
  column_id: string;
  title: string;
  type: string; // uidt: SingleLineText, LongText, Number, Decimal, Checkbox, Date, DateTime, Email, URL, ID, SingleSelect, MultiSelect, Currency, Percent, Rating, PhoneNumber, JSON, etc.
  primary_key: boolean;
  required: boolean;
  options?: BRSelectOption[]; // for SingleSelect / MultiSelect
  meta?: Record<string, unknown>; // for Currency symbol, decimal places, etc.
  relatedTableId?: string; // for Links/LinkToAnotherRecord
  relationType?: string; // hm, bt, mm
}

export interface BRView {
  view_id: string;
  title: string;
  type: number; // 1=form, 2=gallery, 3=grid, 4=kanban
  is_default: boolean;
  order: number;
  fk_grp_col_id?: string; // kanban grouping column
  fk_cover_image_col_id?: string; // kanban/gallery cover image column
}

export interface BRFilter {
  filter_id: string;
  fk_column_id: string;
  comparison_op: string;
  comparison_sub_op?: string;
  value: string;
  logical_op?: string;
  order: number;
}

export interface BRSort {
  sort_id: string;
  fk_column_id: string;
  direction: 'asc' | 'desc';
  order: number;
}

export interface BRTableMeta {
  table_id: string;
  title: string;
  columns: BRColumn[];
  views?: BRView[];
  created_at?: string;
  updated_at?: string;
}

export interface BRPageInfo {
  totalRows: number;
  page: number;
  pageSize: number;
  isFirstPage: boolean;
  isLastPage: boolean;
}

export interface BRRowsResponse {
  list: Record<string, unknown>[];
  pageInfo: BRPageInfo;
}

// ── API calls ──

export async function createTable(title: string, columns?: { title: string; uidt: string }[]): Promise<BRTable> {
  return brFetch<BRTable>('/tables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      columns: columns || [
        { title: 'Name', uidt: 'SingleLineText' },
        { title: 'Notes', uidt: 'LongText' },
      ],
    }),
  });
}

export async function listTables(): Promise<BRTable[]> {
  const data = await brFetch<{ list: BRTable[] }>('/tables');
  return data.list;
}

export async function describeTable(tableId: string): Promise<BRTableMeta> {
  return brFetch<BRTableMeta>(`/tables/${tableId}`);
}

export async function queryRows(
  tableId: string,
  opts?: { limit?: number; offset?: number; where?: string; sort?: string }
): Promise<BRRowsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  if (opts?.where) params.set('where', opts.where);
  if (opts?.sort) params.set('sort', opts.sort);
  const qs = params.toString();
  return brFetch<BRRowsResponse>(`/${tableId}/rows${qs ? `?${qs}` : ''}`);
}

export async function insertRow(tableId: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  return brFetch(`/${tableId}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
}

export async function updateRow(tableId: string, rowId: number | string, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  return brFetch(`/${tableId}/rows/${rowId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

export async function deleteRow(tableId: string, rowId: number | string): Promise<void> {
  await brFetch(`/${tableId}/rows/${rowId}`, { method: 'DELETE' });
}

// ── Column management ──

export async function addColumn(
  tableId: string,
  title: string,
  uidt: string = 'SingleLineText',
  opts?: {
    options?: BRSelectOption[];
    meta?: Record<string, unknown>;
    childId?: string;
    relationType?: string;
  }
): Promise<{ column_id: string; title: string; type: string }> {
  return brFetch(`/tables/${tableId}/columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, uidt, ...opts }),
  });
}

export async function updateColumn(tableId: string, columnId: string, updates: { title?: string; uidt?: string; options?: BRSelectOption[]; meta?: string }): Promise<void> {
  await brFetch(`/tables/${tableId}/columns/${columnId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function deleteColumn(tableId: string, columnId: string): Promise<void> {
  await brFetch(`/tables/${tableId}/columns/${columnId}`, { method: 'DELETE' });
}

// ── Table management ──

export async function renameTable(tableId: string, title: string): Promise<void> {
  await brFetch(`/tables/${tableId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function deleteTable(tableId: string): Promise<void> {
  await brFetch(`/tables/${tableId}`, { method: 'DELETE' });
}

// ── View management ──

export async function listViews(tableId: string): Promise<BRView[]> {
  const data = await brFetch<{ list: BRView[] }>(`/tables/${tableId}/views`);
  return data.list;
}

export async function createView(tableId: string, title: string, type: string = 'grid'): Promise<BRView> {
  return brFetch<BRView>(`/tables/${tableId}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, type }),
  });
}

export async function renameView(viewId: string, title: string): Promise<void> {
  await brFetch(`/views/${viewId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function deleteView(viewId: string): Promise<void> {
  await brFetch(`/views/${viewId}`, { method: 'DELETE' });
}

export async function updateKanbanConfig(viewId: string, config: { fk_grp_col_id?: string; fk_cover_image_col_id?: string }): Promise<void> {
  await brFetch(`/views/${viewId}/kanban`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function updateGalleryConfig(viewId: string, config: { fk_cover_image_col_id?: string }): Promise<void> {
  await brFetch(`/views/${viewId}/gallery`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function queryRowsByView(
  tableId: string,
  viewId: string,
  opts?: { limit?: number; offset?: number; where?: string; sort?: string }
): Promise<BRRowsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  if (opts?.where) params.set('where', opts.where);
  if (opts?.sort) params.set('sort', opts.sort);
  const qs = params.toString();
  return brFetch<BRRowsResponse>(`/${tableId}/views/${viewId}/rows${qs ? `?${qs}` : ''}`);
}

// ── View filters ──

export async function listFilters(viewId: string): Promise<BRFilter[]> {
  const data = await brFetch<{ list: BRFilter[] }>(`/views/${viewId}/filters`);
  return data.list;
}

export async function createFilter(viewId: string, filter: { fk_column_id: string; comparison_op: string; value?: string; logical_op?: string }): Promise<BRFilter> {
  return brFetch<BRFilter>(`/views/${viewId}/filters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
}

export async function deleteFilter(filterId: string): Promise<void> {
  await brFetch(`/filters/${filterId}`, { method: 'DELETE' });
}

export async function updateFilter(filterId: string, updates: { fk_column_id?: string; comparison_op?: string; value?: string; logical_op?: string }): Promise<void> {
  await brFetch(`/filters/${filterId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

// ── View sorts ──

export async function listSorts(viewId: string): Promise<BRSort[]> {
  const data = await brFetch<{ list: BRSort[] }>(`/views/${viewId}/sorts`);
  return data.list;
}

export async function createSort(viewId: string, sort: { fk_column_id: string; direction?: string }): Promise<BRSort> {
  return brFetch<BRSort>(`/views/${viewId}/sorts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sort),
  });
}

export async function deleteSort(sortId: string): Promise<void> {
  await brFetch(`/sorts/${sortId}`, { method: 'DELETE' });
}

export async function updateSort(sortId: string, updates: { fk_column_id?: string; direction?: string }): Promise<void> {
  await brFetch(`/sorts/${sortId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

// ── View columns (field visibility/width per view) ──

export interface BRViewColumn {
  fk_column_id: string;
  show: boolean;
  order?: number;
  width?: string | null;
}

export async function listViewColumns(viewId: string): Promise<BRViewColumn[]> {
  const data = await brFetch<{ list: BRViewColumn[] }>(`/views/${viewId}/columns`);
  return data.list;
}

export async function updateViewColumn(viewId: string, columnId: string, fields: { show?: boolean; width?: string | number; order?: number }): Promise<void> {
  await brFetch(`/views/${viewId}/columns/${columnId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

// ── Linked records (for Links columns) ──

export async function listLinkedRecords(
  tableId: string, rowId: number | string, columnId: string,
  opts?: { limit?: number; offset?: number }
): Promise<BRRowsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return brFetch<BRRowsResponse>(`/${tableId}/rows/${rowId}/links/${columnId}${qs ? `?${qs}` : ''}`);
}

export async function linkRecords(tableId: string, rowId: number | string, columnId: string, recordIds: number[]): Promise<void> {
  await brFetch(`/${tableId}/rows/${rowId}/links/${columnId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recordIds.map(id => ({ Id: id }))),
  });
}

export async function unlinkRecords(tableId: string, rowId: number | string, columnId: string, recordIds: number[]): Promise<void> {
  await brFetch(`/${tableId}/rows/${rowId}/links/${columnId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recordIds.map(id => ({ Id: id }))),
  });
}
