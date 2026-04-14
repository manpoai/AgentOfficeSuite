/**
 * Documents API client — calls through /api/gateway/* proxy to Gateway SQLite
 * Calls through /api/gateway/* proxy to Gateway SQLite
 */

const BASE = '/api/gateway';

async function docFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('aose_token') : null;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`Documents API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface Document {
  id: string;
  title: string;
  text: string;
  data_json?: any;
  icon?: string | null;
  full_width: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Revision {
  id: string;
  documentId: string;
  title: string;
  trigger_type: string | null;
  description: string | null;
  data: any; // ProseMirror JSON
  createdAt: string;
  createdBy: { id: string; name: string };
}


// ── Document CRUD ──

export async function getDocument(id: string): Promise<Document> {
  return docFetch(`/documents/${id}`);
}

export async function updateDocument(
  id: string,
  title?: string,
  text?: string,
  icon?: string | null,
  opts?: { fullWidth?: boolean },
  data_json?: Record<string, unknown>,
): Promise<Document> {
  const body: Record<string, unknown> = {};
  if (title !== undefined) body.title = title;
  if (text !== undefined) body.text = text;
  if (icon !== undefined) body.icon = icon;
  if (opts?.fullWidth !== undefined) body.full_width = opts.fullWidth;
  if (data_json !== undefined) body.data_json = data_json;
  return docFetch(`/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await docFetch(`/documents/${id}`, { method: 'DELETE' });
}

export async function searchDocuments(query: string): Promise<{ document: Document; context: string }[]> {
  const data = await docFetch<{ data: { document: Document; context: string }[] }>(
    `/documents/search?q=${encodeURIComponent(query)}`
  );
  return data.data;
}

// ── Revisions ──

export async function listRevisions(documentId: string): Promise<Revision[]> {
  const data = await docFetch<{ data: Revision[] }>(`/documents/${documentId}/revisions`);
  return data.data;
}

export async function restoreRevision(documentId: string, revisionId: string): Promise<Document> {
  return docFetch(`/documents/${documentId}/revisions/${revisionId}/restore`, {
    method: 'POST',
  });
}

// ── File Upload ──

export async function uploadFile(file: File, _documentId?: string): Promise<{ url: string; name: string; size: number }> {
  const form = new FormData();
  form.append('file', file);
  const token = typeof window !== 'undefined' ? localStorage.getItem('aose_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/uploads`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  // Return URL through gateway proxy
  const url = data.url.startsWith('/api/') ? `${BASE}${data.url.slice(4)}` : data.url;
  return { url, name: data.name, size: data.size };
}

// ── ProseMirror Helpers ──

/** Convert plain text to ProseMirror JSON suitable for comments */
export function textToProseMirror(text: string): any {
  const lines = text.split('\n');
  const content = lines.map(line => {
    if (!line) return { type: 'paragraph' };
    const parts: any[] = [];
    const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let lastIdx = 0;
    let match;
    while ((match = imgRe.exec(line)) !== null) {
      if (match.index > lastIdx) {
        parts.push({ type: 'text', text: line.slice(lastIdx, match.index) });
      }
      parts.push({ type: 'image', attrs: { src: match[2], alt: match[1] } });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < line.length) {
      parts.push({ type: 'text', text: line.slice(lastIdx) });
    }
    if (parts.length === 0) return { type: 'paragraph' };
    return { type: 'paragraph', content: parts };
  });
  return { type: 'doc', content };
}


