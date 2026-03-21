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
}

export interface NCTableMeta {
  table_id: string;
  title: string;
  columns: NCColumn[];
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
  opts?: { options?: NCSelectOption[]; meta?: Record<string, unknown> }
): Promise<{ column_id: string; title: string; type: string }> {
  return ncFetch(`/tables/${tableId}/columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, uidt, ...opts }),
  });
}

export async function updateColumn(tableId: string, columnId: string, updates: { title?: string; uidt?: string }): Promise<void> {
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
