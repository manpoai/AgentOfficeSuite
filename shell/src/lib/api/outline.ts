/**
 * Outline API client — calls through /api/outline/* proxy
 * Note: Outline uses POST for most read operations
 */

const BASE = '/api/outline';

async function olFetch<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`Outline API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface OLDocument {
  id: string;
  title: string;
  text: string;
  emoji?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  collectionId: string;
  parentDocumentId: string | null;
  createdBy: { id: string; name: string };
  updatedBy: { id: string; name: string };
  revision: number;
}

export interface OLCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  documents: OLDocumentNode[];
}

export interface OLDocumentNode {
  id: string;
  title: string;
  url: string;
  children: OLDocumentNode[];
}

// ── API calls ──

export async function listDocuments(collectionId?: string): Promise<OLDocument[]> {
  const body: Record<string, unknown> = {};
  if (collectionId) body.collectionId = collectionId;
  const data = await olFetch<{ data: OLDocument[] }>('documents.list', body);
  return data.data;
}

export async function getDocument(id: string): Promise<OLDocument> {
  const data = await olFetch<{ data: OLDocument }>('documents.info', { id });
  return data.data;
}

export async function listCollections(): Promise<OLCollection[]> {
  const data = await olFetch<{ data: OLCollection[] }>('collections.list', {});
  return data.data;
}

export async function searchDocuments(query: string): Promise<{ document: OLDocument; context: string }[]> {
  const data = await olFetch<{ data: { document: OLDocument; context: string }[] }>('documents.search', { query });
  return data.data;
}

export async function createDocument(title: string, text: string, collectionId: string, parentDocumentId?: string): Promise<OLDocument> {
  const body: Record<string, unknown> = { title, text, collectionId, publish: true };
  if (parentDocumentId) body.parentDocumentId = parentDocumentId;
  const data = await olFetch<{ data: OLDocument }>('documents.create', body);
  return data.data;
}

export async function moveDocument(id: string, parentDocumentId: string | null, collectionId?: string): Promise<void> {
  const body: Record<string, unknown> = { id };
  if (parentDocumentId) body.parentDocumentId = parentDocumentId;
  if (collectionId) body.collectionId = collectionId;
  await olFetch('documents.move', body);
}

export async function updateDocument(id: string, title?: string, text?: string, emoji?: string | null): Promise<OLDocument> {
  const body: Record<string, unknown> = { id };
  if (title !== undefined) body.title = title;
  if (text !== undefined) body.text = text;
  // Outline expects emoji as string or null to remove
  if (emoji !== undefined) body.emoji = emoji || null;
  const data = await olFetch<{ data: OLDocument }>('documents.update', body);
  return data.data;
}

export async function deleteDocument(id: string): Promise<void> {
  await olFetch('documents.delete', { id });
}

/** Upload an attachment (image) to Outline. Returns { url, ... } */
export async function uploadAttachment(file: File, documentId?: string): Promise<{ data: { url: string; name: string; size: number } }> {
  const form = new FormData();
  form.append('file', file);
  form.append('name', file.name || 'image.png');
  form.append('size', String(file.size));
  if (documentId) form.append('documentId', documentId);
  const res = await fetch(`${BASE}/attachments.create`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Outline attachment upload: ${res.status} ${errText}`);
  }
  return res.json();
}
