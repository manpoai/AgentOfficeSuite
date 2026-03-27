/**
 * NocoDB API client — calls through /api/gateway/data/* proxy
 */

const BASE = '/api/gateway/data';

async function ncFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`NocoDB API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface NCTable {
  id: string;
  title: string;
  type?: string;
  order?: number;
  created_at?: string;
}

export interface NCSelectOption {
  title: string;
  color?: string;
  order?: number;
}

export interface NCColumn {
  column_id: string;
  title: string;
  type: string; // uidt: SingleLineText, LongText, Number, Decimal, Checkbox, Date, DateTime, Email, URL, ID, SingleSelect, MultiSelect, Currency, Percent, Rating, PhoneNumber, JSON, etc.
  primary_key: boolean;
  required: boolean;
  options?: NCSelectOption[]; // for SingleSelect / MultiSelect
  meta?: Record<string, unknown>; // for Currency symbol, decimal places, etc.
  formula?: string; // for Formula columns
  relatedTableId?: string; // for Links/LinkToAnotherRecord
  relationType?: string; // hm, bt, mm
  fk_relation_column_id?: string; // for Lookup/Rollup
  fk_lookup_column_id?: string; // for Lookup
  fk_rollup_column_id?: string; // for Rollup
  rollup_function?: string; // for Rollup
}

export interface NCView {
  view_id: string;
  title: string;
  type: number; // 1=form, 2=gallery, 3=grid, 4=kanban
  is_default: boolean;
  order: number;
  fk_grp_col_id?: string; // kanban grouping column
  fk_cover_image_col_id?: string; // kanban/gallery cover image column
}

export interface NCFilter {
  filter_id: string;
  fk_column_id: string;
  comparison_op: string;
  comparison_sub_op?: string;
  value: string;
  logical_op?: string;
  order: number;
}

export interface NCSort {
  sort_id: string;
  fk_column_id: string;
  direction: 'asc' | 'desc';
  order: number;
}

export interface NCTableMeta {
  table_id: string;
  title: string;
  columns: NCColumn[];
  views?: NCView[];
  created_at?: string;
  updated_at?: string;
}

export interface NCPageInfo {
  totalRows: number;
  page: number;
  pageSize: number;
  isFirstPage: boolean;
  isLastPage: boolean;
}

export interface NCRowsResponse {
  list: Record<string, unknown>[];
  pageInfo: NCPageInfo;
}

// ── API calls ──

export async function createTable(title: string, columns?: { title: string; uidt: string }[]): Promise<NCTable> {
  return ncFetch<NCTable>('/tables', {
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

export async function listTables(): Promise<NCTable[]> {
  const data = await ncFetch<{ list: NCTable[] }>('/tables');
  return data.list;
}

export async function describeTable(tableId: string): Promise<NCTableMeta> {
  return ncFetch<NCTableMeta>(`/tables/${tableId}`);
}

export async function queryRows(
  tableId: string,
  opts?: { limit?: number; offset?: number; where?: string; sort?: string }
): Promise<NCRowsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  if (opts?.where) params.set('where', opts.where);
  if (opts?.sort) params.set('sort', opts.sort);
  const qs = params.toString();
  return ncFetch<NCRowsResponse>(`/${tableId}/rows${qs ? `?${qs}` : ''}`);
}

export async function insertRow(tableId: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  return ncFetch(`/${tableId}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
}

export async function updateRow(tableId: string, rowId: number | string, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  return ncFetch(`/${tableId}/rows/${rowId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

export async function deleteRow(tableId: string, rowId: number | string): Promise<void> {
  await ncFetch(`/${tableId}/rows/${rowId}`, { method: 'DELETE' });
}

// ── Column management ──

export async function addColumn(
  tableId: string,
  title: string,
  uidt: string = 'SingleLineText',
  opts?: {
    options?: NCSelectOption[];
    meta?: Record<string, unknown>;
    formula_raw?: string;
    childId?: string;
    relationType?: string;
    fk_relation_column_id?: string;
    fk_lookup_column_id?: string;
    fk_rollup_column_id?: string;
    rollup_function?: string;
  }
): Promise<{ column_id: string; title: string; type: string }> {
  return ncFetch(`/tables/${tableId}/columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, uidt, ...opts }),
  });
}

export async function updateColumn(tableId: string, columnId: string, updates: { title?: string; uidt?: string; options?: NCSelectOption[]; meta?: string }): Promise<void> {
  await ncFetch(`/tables/${tableId}/columns/${columnId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function deleteColumn(tableId: string, columnId: string): Promise<void> {
  await ncFetch(`/tables/${tableId}/columns/${columnId}`, { method: 'DELETE' });
}

// ── Table management ──

export async function renameTable(tableId: string, title: string): Promise<void> {
  await ncFetch(`/tables/${tableId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function deleteTable(tableId: string): Promise<void> {
  await ncFetch(`/tables/${tableId}`, { method: 'DELETE' });
}

// ── View management ──

export async function listViews(tableId: string): Promise<NCView[]> {
  const data = await ncFetch<{ list: NCView[] }>(`/tables/${tableId}/views`);
  return data.list;
}

export async function createView(tableId: string, title: string, type: string = 'grid'): Promise<NCView> {
  return ncFetch<NCView>(`/tables/${tableId}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, type }),
  });
}

export async function renameView(viewId: string, title: string): Promise<void> {
  await ncFetch(`/views/${viewId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function deleteView(viewId: string): Promise<void> {
  await ncFetch(`/views/${viewId}`, { method: 'DELETE' });
}

export async function updateKanbanConfig(viewId: string, config: { fk_grp_col_id?: string; fk_cover_image_col_id?: string }): Promise<void> {
  await ncFetch(`/views/${viewId}/kanban`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function updateGalleryConfig(viewId: string, config: { fk_cover_image_col_id?: string }): Promise<void> {
  await ncFetch(`/views/${viewId}/gallery`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function queryRowsByView(
  tableId: string,
  viewId: string,
  opts?: { limit?: number; offset?: number; where?: string; sort?: string }
): Promise<NCRowsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  if (opts?.where) params.set('where', opts.where);
  if (opts?.sort) params.set('sort', opts.sort);
  const qs = params.toString();
  return ncFetch<NCRowsResponse>(`/${tableId}/views/${viewId}/rows${qs ? `?${qs}` : ''}`);
}

// ── View filters ──

export async function listFilters(viewId: string): Promise<NCFilter[]> {
  const data = await ncFetch<{ list: NCFilter[] }>(`/views/${viewId}/filters`);
  return data.list;
}

export async function createFilter(viewId: string, filter: { fk_column_id: string; comparison_op: string; value?: string; logical_op?: string }): Promise<NCFilter> {
  return ncFetch<NCFilter>(`/views/${viewId}/filters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
}

export async function deleteFilter(filterId: string): Promise<void> {
  await ncFetch(`/filters/${filterId}`, { method: 'DELETE' });
}

export async function updateFilter(filterId: string, updates: { fk_column_id?: string; comparison_op?: string; value?: string; logical_op?: string }): Promise<void> {
  await ncFetch(`/filters/${filterId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

// ── View sorts ──

export async function listSorts(viewId: string): Promise<NCSort[]> {
  const data = await ncFetch<{ list: NCSort[] }>(`/views/${viewId}/sorts`);
  return data.list;
}

export async function createSort(viewId: string, sort: { fk_column_id: string; direction?: string }): Promise<NCSort> {
  return ncFetch<NCSort>(`/views/${viewId}/sorts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sort),
  });
}

export async function deleteSort(sortId: string): Promise<void> {
  await ncFetch(`/sorts/${sortId}`, { method: 'DELETE' });
}

export async function updateSort(sortId: string, updates: { fk_column_id?: string; direction?: string }): Promise<void> {
  await ncFetch(`/sorts/${sortId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

// ── View columns (field visibility/width per view) ──

export interface NCViewColumn {
  fk_column_id: string;
  show: boolean;
  order?: number;
  width?: string | null;
}

export async function listViewColumns(viewId: string): Promise<NCViewColumn[]> {
  const data = await ncFetch<{ list: NCViewColumn[] }>(`/views/${viewId}/columns`);
  return data.list;
}

export async function updateViewColumn(viewId: string, columnId: string, fields: { show?: boolean; width?: string | number; order?: number }): Promise<void> {
  await ncFetch(`/views/${viewId}/columns/${columnId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

// ── Linked records (for Links columns) ──

export async function listLinkedRecords(
  tableId: string, rowId: number | string, columnId: string,
  opts?: { limit?: number; offset?: number }
): Promise<NCRowsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return ncFetch<NCRowsResponse>(`/${tableId}/rows/${rowId}/links/${columnId}${qs ? `?${qs}` : ''}`);
}

export async function linkRecords(tableId: string, rowId: number | string, columnId: string, recordIds: number[]): Promise<void> {
  await ncFetch(`/${tableId}/rows/${rowId}/links/${columnId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recordIds.map(id => ({ Id: id }))),
  });
}

export async function unlinkRecords(tableId: string, rowId: number | string, columnId: string, recordIds: number[]): Promise<void> {
  await ncFetch(`/${tableId}/rows/${rowId}/links/${columnId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recordIds.map(id => ({ Id: id }))),
  });
}
