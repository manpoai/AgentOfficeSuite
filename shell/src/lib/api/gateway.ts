/**
 * ASuite Gateway API client — calls through /api/gateway/* proxy
 */

const BASE = '/api/gateway';

async function gwFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`Gateway API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface Agent {
  agent_id: string;
  name: string;
  display_name?: string;
  avatar_url?: string | null;
  type?: string;
  online: boolean;
  capabilities?: string[];
  registered_at?: string;
  last_seen_at?: number | null;
}

// ── Agents ──

export async function listAgents(): Promise<Agent[]> {
  const data = await gwFetch<{ agents: Agent[] }>('/agents');
  return data.agents;
}

export async function getAgent(name: string): Promise<Agent> {
  return gwFetch(`/agents/${name}`);
}

export async function updateAgentProfile(name: string, fields: {
  display_name?: string;
  avatar_url?: string;
}): Promise<void> {
  await gwFetch(`/agents/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

export async function uploadAgentAvatar(name: string, file: File): Promise<{ avatar_url: string }> {
  const form = new FormData();
  form.append('avatar', file);
  const res = await fetch(`${BASE}/agents/${name}/avatar`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Upload avatar: ${res.status}`);
  return res.json();
}

// ── Comments ──

export interface Comment {
  id: string;
  text: string;
  html?: string;
  actor: string;
  parent_id?: string | null;
  resolved_by?: { id: string; name: string } | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export async function listDocComments(docId: string): Promise<Comment[]> {
  const data = await gwFetch<{ comments: Comment[] }>(`/docs/${docId}/comments`);
  return data.comments;
}

export async function commentOnDoc(docId: string, text: string, parentId?: string): Promise<void> {
  await gwFetch('/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_id: docId, text, parent_comment_id: parentId }),
  });
}

// ── Table Comments (SQLite-backed, for Baserow tables) ──

export interface TableComment extends Comment {
  row_id?: string | null;
}

export async function listTableComments(tableId: string, rowId?: string): Promise<Comment[]> {
  const qs = rowId ? `?row_id=${encodeURIComponent(rowId)}` : '';
  const data = await gwFetch<{ comments: Comment[] }>(`/data/tables/${tableId}/comments${qs}`);
  return data.comments;
}

export async function listAllTableComments(tableId: string): Promise<TableComment[]> {
  const data = await gwFetch<{ comments: TableComment[] }>(`/data/tables/${tableId}/comments?include_all=1`);
  return data.comments;
}

export async function commentOnTable(tableId: string, text: string, parentId?: string, rowId?: string): Promise<Comment> {
  return gwFetch<Comment>(`/data/tables/${tableId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, parent_id: parentId, row_id: rowId }),
  });
}

export async function editTableComment(commentId: string, text: string): Promise<void> {
  await gwFetch(`/data/table-comments/${commentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export async function deleteTableComment(commentId: string): Promise<void> {
  await gwFetch(`/data/table-comments/${commentId}`, { method: 'DELETE' });
}

export async function resolveTableComment(commentId: string): Promise<void> {
  await gwFetch(`/data/table-comments/${commentId}/resolve`, { method: 'POST' });
}

export async function unresolveTableComment(commentId: string): Promise<void> {
  await gwFetch(`/data/table-comments/${commentId}/unresolve`, { method: 'POST' });
}

export async function listCommentedRows(tableId: string): Promise<{ row_id: string; count: number }[]> {
  const data = await gwFetch<{ rows: { row_id: string; count: number }[] }>(`/data/tables/${tableId}/commented-rows`);
  return data.rows;
}

// ── Content Items (unified sidebar metadata) ──

export interface ContentItem {
  id: string;          // 'doc:<uuid>' or 'table:<uuid>'
  raw_id: string;      // original Outline doc ID or Baserow table ID
  type: 'doc' | 'table' | 'presentation' | 'diagram';
  title: string;
  icon: string | null;
  parent_id: string | null;
  sort_order: number;
  collection_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  pinned: number;
  synced_at: number;
}

export async function getContentItem(id: string): Promise<ContentItem> {
  const data = await gwFetch<{ item: ContentItem }>(`/content-items/${encodeURIComponent(id)}`);
  return data.item;
}

export async function listContentItems(): Promise<ContentItem[]> {
  const data = await gwFetch<{ items: ContentItem[] }>('/content-items');
  return data.items;
}

export async function listDeletedContentItems(): Promise<ContentItem[]> {
  const data = await gwFetch<{ items: ContentItem[] }>('/content-items?deleted=true');
  return data.items;
}

export async function createContentItem(opts: {
  type: 'doc' | 'table' | 'presentation' | 'diagram';
  title: string;
  parent_id?: string | null;
  collection_id?: string;
  columns?: { title: string; uidt: string }[];
}): Promise<ContentItem> {
  const data = await gwFetch<{ item: ContentItem }>('/content-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  return data.item;
}

export async function deleteContentItem(id: string, mode: 'only' | 'all' = 'only'): Promise<void> {
  await gwFetch(`/content-items/${encodeURIComponent(id)}?mode=${mode}`, {
    method: 'DELETE',
  });
}

export async function restoreContentItem(id: string): Promise<ContentItem> {
  const data = await gwFetch<{ item: ContentItem }>(`/content-items/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
  });
  return data.item;
}

export async function permanentlyDeleteContentItem(id: string): Promise<void> {
  await gwFetch(`/content-items/${encodeURIComponent(id)}/permanent`, {
    method: 'DELETE',
  });
}

export async function updateContentItem(id: string, fields: {
  icon?: string | null;
  parent_id?: string | null;
  sort_order?: number;
  title?: string;
  pinned?: boolean;
}): Promise<ContentItem> {
  return gwFetch(`/content-items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

export async function updateContentTree(items: { id: string; parent_id: string | null; sort_order: number }[]): Promise<void> {
  await gwFetch('/content-items/tree', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

export async function syncContentItems(): Promise<ContentItem[]> {
  const data = await gwFetch<{ items: ContentItem[] }>('/content-items/sync', { method: 'POST' });
  return data.items;
}

// ── Doc Icons ──

export async function getDocIcons(): Promise<Record<string, string>> {
  const data = await gwFetch<{ icons: Record<string, string> }>('/doc-icons');
  return data.icons;
}

export async function setDocIcon(docId: string, icon: string): Promise<void> {
  await gwFetch(`/doc-icons/${encodeURIComponent(docId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ icon }),
  });
}

export async function removeDocIcon(docId: string): Promise<void> {
  await gwFetch(`/doc-icons/${encodeURIComponent(docId)}`, { method: 'DELETE' });
}

// ── Preferences ──

export async function getPreference<T = unknown>(key: string): Promise<T | null> {
  try {
    const data = await gwFetch<{ key: string; value: T }>(`/preferences/${encodeURIComponent(key)}`);
    return data.value;
  } catch {
    return null; // 404 or error — return null
  }
}

export async function setPreference<T = unknown>(key: string, value: T): Promise<void> {
  await gwFetch(`/preferences/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

// ── Table Snapshots (History Versioning) ──

export interface TableSnapshot {
  id: string;
  version: number;
  table_id: string;
  trigger_type: 'auto' | 'manual' | 'pre_bulk' | 'pre_restore';
  agent: string | null;
  row_count: number;
  created_at: string;
  schema_json?: string;
  data_json?: string;
}

export async function listTableSnapshots(tableId: string): Promise<TableSnapshot[]> {
  const data = await gwFetch<{ snapshots: TableSnapshot[] }>(`/data/${tableId}/snapshots`);
  return data.snapshots;
}

export async function getTableSnapshot(tableId: string, snapshotId: string): Promise<TableSnapshot> {
  return gwFetch(`/data/${tableId}/snapshots/${snapshotId}`);
}

export async function createTableSnapshot(tableId: string): Promise<TableSnapshot> {
  return gwFetch(`/data/${tableId}/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function restoreTableSnapshot(tableId: string, snapshotId: string): Promise<{ success: boolean; restored_rows: number; pre_restore_snapshot_id: string }> {
  return gwFetch(`/data/${tableId}/snapshots/${snapshotId}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

// ─── Presentations (Fabric.js PPT) ─────────────────
export async function getPresentation(presId: string): Promise<{
  id: string;
  data: { slides: any[] };
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
}> {
  return gwFetch(`/presentations/${presId}`);
}

export async function savePresentation(presId: string, data: { slides: any[] }): Promise<{ saved: boolean; updated_at: number }> {
  return gwFetch(`/presentations/${presId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

// ─── Diagrams (ReactFlow) ─────────────────────────
export async function getDiagram(diagramId: string): Promise<{
  id: string;
  data: { nodes: any[]; edges: any[]; viewport?: { x: number; y: number; zoom: number } };
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
}> {
  return gwFetch(`/diagrams/${diagramId}`);
}

export async function saveDiagram(diagramId: string, data: { nodes: any[]; edges: any[]; viewport?: any }): Promise<{ saved: boolean; updated_at: number }> {
  return gwFetch(`/diagrams/${diagramId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

// ─── Global Search ──────────────────────────────────

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  snippet?: string;
  updated_at?: string;
}

export async function globalSearch(query: string, limit = 20): Promise<{ results: SearchResult[] }> {
  return gwFetch(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

// ─── Notifications ──────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  actor?: string;
  read: boolean;
  created_at: string;
}

export async function getNotifications(unread?: boolean, limit?: number): Promise<Notification[]> {
  const params = new URLSearchParams();
  if (unread !== undefined) params.set('unread', String(unread));
  if (limit !== undefined) params.set('limit', String(limit));
  const qs = params.toString();
  const data = await gwFetch<{ notifications: Notification[] }>(`/notifications${qs ? `?${qs}` : ''}`);
  return data.notifications;
}

export async function getUnreadCount(): Promise<number> {
  const data = await gwFetch<{ count: number }>('/notifications/unread-count');
  return data.count;
}

export async function markNotificationRead(id: string): Promise<void> {
  await gwFetch(`/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await gwFetch('/notifications/read-all', { method: 'POST' });
}

// ─── Content Comments (Generic — presentations, diagrams, etc.) ─────────

export async function listContentComments(contentId: string): Promise<Comment[]> {
  const data = await gwFetch<{ comments: Comment[] }>(`/content-items/${encodeURIComponent(contentId)}/comments`);
  return data.comments;
}

export async function createContentComment(contentId: string, text: string, parentId?: string): Promise<Comment> {
  return gwFetch<Comment>(`/content-items/${encodeURIComponent(contentId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, parent_comment_id: parentId }),
  });
}

export async function editContentComment(commentId: string, text: string): Promise<void> {
  await gwFetch(`/content-comments/${commentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export async function deleteContentComment(commentId: string): Promise<void> {
  await gwFetch(`/content-comments/${commentId}`, { method: 'DELETE' });
}

export async function resolveContentComment(commentId: string): Promise<void> {
  await gwFetch(`/content-comments/${commentId}/resolve`, { method: 'POST' });
}

export async function unresolveContentComment(commentId: string): Promise<void> {
  await gwFetch(`/content-comments/${commentId}/unresolve`, { method: 'POST' });
}

// ─── Content Revisions (Generic — presentations, diagrams, etc.) ─────────

export interface ContentRevision {
  id: string;
  content_id: string;
  data: any;
  created_at: string;
  created_by: string | null;
}

export async function listContentRevisions(contentId: string): Promise<ContentRevision[]> {
  const data = await gwFetch<{ revisions: ContentRevision[] }>(`/content-items/${encodeURIComponent(contentId)}/revisions`);
  return data.revisions;
}

export async function createContentRevision(contentId: string, data: any): Promise<ContentRevision> {
  return gwFetch<ContentRevision>(`/content-items/${encodeURIComponent(contentId)}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

export async function restoreContentRevision(contentId: string, revisionId: string): Promise<{ data: any }> {
  return gwFetch<{ data: any }>(`/content-items/${encodeURIComponent(contentId)}/revisions/${revisionId}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}
