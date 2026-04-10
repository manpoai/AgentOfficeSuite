/**
 * ASuite Gateway API client — calls through /api/gateway/* proxy
 */

const BASE = '/api/gateway';

/** Resolve a possibly-relative avatar URL to an absolute URL via the gateway proxy. */
export function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/api/gateway')) return url;
  return `/api/gateway${url}`;
}

/** Get auth headers for direct fetch calls to /api/gateway/* */
export function gwAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('asuite_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function gwFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('asuite_token') : null;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`Gateway API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface Agent {
  agent_id: string;
  name: string;
  display_name?: string;
  avatar_url?: string | null;
  platform?: string | null;
  type?: string;
  online: boolean;
  capabilities?: string[];
  registered_at?: string;
  last_seen_at?: number | null;
  pending_approval?: boolean;
}

// ── User Profile ──

/** Update own human profile (name syncs username + display_name) */
export async function updateProfile(fields: { name?: string }): Promise<any> {
  return gwFetch('/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

/** Upload a slide thumbnail PNG blob; returns the public URL */
export async function uploadSlideThumbnail(blob: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', blob, filename);
  const token = typeof window !== 'undefined' ? localStorage.getItem('asuite_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/uploads/thumbnails`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`Upload thumbnail: ${res.status}`);
  const { url } = await res.json();
  return url;
}

/** Upload own avatar (human) */
export async function uploadUserAvatar(file: File): Promise<{ avatar_url: string }> {
  const form = new FormData();
  form.append('avatar', file);
  const token = typeof window !== 'undefined' ? localStorage.getItem('asuite_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/auth/avatar`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`Upload avatar: ${res.status}`);
  return res.json();
}

// ── Agents ──

export async function listAgents(): Promise<Agent[]> {
  const data = await gwFetch<{ agents: Agent[] }>('/agents');
  return data.agents;
}

/** Admin: list all agents including pending approval */
export async function listAllAgents(): Promise<Agent[]> {
  const data = await gwFetch<{ agents: Agent[] }>('/admin/agents');
  return data.agents;
}

/** Admin: approve a pending agent */
export async function approveAgent(agentId: string): Promise<void> {
  await gwFetch(`/admin/agents/${agentId}/approve`, { method: 'POST' });
}

/** Admin: reject a pending agent */
export async function rejectAgent(agentId: string): Promise<void> {
  await gwFetch(`/admin/agents/${agentId}/reject`, { method: 'POST' });
}

/** Admin: soft-delete an agent */
export async function deleteAgent(agentId: string): Promise<void> {
  await gwFetch(`/admin/agents/${agentId}`, { method: 'DELETE' });
}

/** Admin: get onboarding prompt for a specific platform */
export async function getOnboardingPrompt(platform: string): Promise<{ platform: string; prompt: string }> {
  return gwFetch(`/admin/onboarding-prompt?platform=${encodeURIComponent(platform)}`);
}

/** Admin: get list of available platforms (data-driven) */
export async function listPlatforms(): Promise<{ platforms: string[] }> {
  return gwFetch('/admin/platforms');
}

/** Admin: reset an agent's token */
export async function resetAgentToken(agentId: string): Promise<{ token: string }> {
  return gwFetch(`/admin/agents/${agentId}/reset-token`, { method: 'POST' });
}

/** Get agent skills info including onboarding prompt */
export async function getAgentSkills(): Promise<{ onboarding_prompt?: string; [key: string]: unknown }> {
  return gwFetch('/agent-skills');
}

export async function getAgent(name: string): Promise<Agent> {
  return gwFetch(`/agents/${name}`);
}

export async function updateAgentProfile(name: string, fields: {
  display_name?: string;
  avatar_url?: string;
  platform?: string;
}): Promise<void> {
  await gwFetch(`/agents/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

export async function adminUpdateAgent(agentId: string, fields: {
  display_name?: string;
  avatar_url?: string;
  platform?: string;
}): Promise<void> {
  await gwFetch(`/admin/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

export async function adminUploadAgentAvatar(agentId: string, file: File): Promise<{ avatar_url: string }> {
  const form = new FormData();
  form.append('avatar', file);
  const token = typeof window !== 'undefined' ? localStorage.getItem('asuite_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/admin/agents/${agentId}/avatar`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`Upload avatar: ${res.status}`);
  return res.json();
}

export async function uploadAgentAvatar(name: string, file: File): Promise<{ avatar_url: string }> {
  const form = new FormData();
  form.append('avatar', file);
  const token = typeof window !== 'undefined' ? localStorage.getItem('asuite_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/agents/${name}/avatar`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`Upload avatar: ${res.status}`);
  return res.json();
}

// ── Comments ──

export interface ContextPayload {
  version: number;
  target: { type: string; id: string; title: string | null };
  anchor: { type: string; id: string; label: string; preview: string | null; meta: Record<string, unknown> } | null;
  summary: { comment_text: string; comment_author: string; text_summary: string };
}

export interface Comment {
  id: string;
  text: string;
  html?: string;
  actor: string;
  actor_id?: string | null;
  actor_avatar_url?: string | null;
  actor_platform?: string | null;
  parent_id?: string | null;
  resolved_by?: { id: string; name: string } | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at?: string;
  anchor_type?: string | null;
  anchor_id?: string | null;
  anchor_meta?: Record<string, unknown> | null;
  context_payload?: ContextPayload | null;
}

// ── Table: commented-rows (table-specific, used by table editor for row comment bubbles) ──

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
  unresolved_comment_count: number;
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
  embedded?: boolean;
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

export async function listContentPins(): Promise<string[]> {
  const data = await gwFetch<{ pinned_ids: string[] }>('/content-pins');
  return data.pinned_ids;
}

export async function pinContentItem(contentId: string): Promise<void> {
  await gwFetch(`/content-pins/${encodeURIComponent(contentId)}`, { method: 'POST' });
}

export async function unpinContentItem(contentId: string): Promise<void> {
  await gwFetch(`/content-pins/${encodeURIComponent(contentId)}`, { method: 'DELETE' });
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

export async function createTableSnapshot(tableId: string, description?: string): Promise<TableSnapshot> {
  return gwFetch(`/data/${tableId}/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
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

// ─── Diagrams ─────────────────────────────────────
export async function getDiagram(diagramId: string): Promise<{
  id: string;
  data: { cells: any[]; viewport?: { x: number; y: number; zoom: number } };
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
}> {
  return gwFetch(`/diagrams/${diagramId}`);
}

export async function saveDiagram(diagramId: string, data: { cells: any[]; viewport?: any }): Promise<{ saved: boolean; updated_at: number }> {
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
  meta?: {
    target_type?: 'doc' | 'table' | 'presentation' | 'diagram';
    target_id?: string;
    target_title?: string;
  } | null;
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
  await gwFetch(`/notifications/${id}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await gwFetch('/notifications/mark-all-read', { method: 'POST' });
}

// ─── Content Comments (Generic — presentations, diagrams, etc.) ─────────

export async function listContentComments(
  contentId: string,
  filter?: { anchor_type?: string; anchor_id?: string }
): Promise<Comment[]> {
  const params = new URLSearchParams();
  if (filter?.anchor_type) params.set('anchor_type', filter.anchor_type);
  if (filter?.anchor_id) params.set('anchor_id', filter.anchor_id);
  const qs = params.toString();
  const url = `/content-items/${encodeURIComponent(contentId)}/comments${qs ? '?' + qs : ''}`;
  const data = await gwFetch<{ comments: Comment[] }>(url);
  return data.comments;
}

export async function createContentComment(contentId: string, text: string, parentId?: string, anchorType?: string, anchorId?: string, anchorMeta?: Record<string, unknown>): Promise<Comment> {
  return gwFetch<Comment>(`/content-items/${encodeURIComponent(contentId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, parent_comment_id: parentId, anchor_type: anchorType, anchor_id: anchorId, anchor_meta: anchorMeta }),
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
  trigger_type: string | null;
  description: string | null;
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

export async function createManualRevision(contentId: string, data: any, description?: string): Promise<ContentRevision> {
  return gwFetch<ContentRevision>(`/content-items/${encodeURIComponent(contentId)}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, trigger_type: 'manual', description }),
  });
}

export async function createDocManualRevision(docId: string, description?: string): Promise<any> {
  return gwFetch(`/documents/${encodeURIComponent(docId)}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

/** Server-side manual snapshot — reads current data from DB, works for any content type */
export async function createContentManualSnapshot(contentId: string, description?: string): Promise<any> {
  return gwFetch(`/content-items/${encodeURIComponent(contentId)}/revisions/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('asuite_token') : null;
  const res = await fetch(`${BASE}/auth/password`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to change password');
  }
}
