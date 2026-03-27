import { NextRequest, NextResponse } from 'next/server';

const OL_URL = process.env.OUTLINE_URL || 'http://localhost:3000';
const OL_KEY = process.env.OUTLINE_API_KEY || '';

// In-memory cache for documents.list (stripped of text) — avoids 1s+ Outline latency on every page load
let docListCache: { data: string; timestamp: number } | null = null;
const DOC_LIST_CACHE_TTL = 30_000; // 30s — serve cached, refresh in background
let docListRefreshing = false;

async function refreshDocListCache() {
  if (docListRefreshing) return;
  docListRefreshing = true;
  try {
    const resp = await fetch(`${OL_URL}/api/documents.list`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100, offset: 0 }),
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json.data && Array.isArray(json.data)) {
        const KEEP = new Set(['id', 'title', 'icon', 'emoji', 'createdAt', 'updatedAt', 'parentDocumentId', 'collectionId', 'deletedAt', 'archivedAt', 'publishedAt', 'createdBy', 'updatedBy', 'revision', 'fullWidth', 'insightsEnabled']);
        json.data = json.data.map((doc: Record<string, unknown>) => {
          const slim: Record<string, unknown> = {};
          for (const k of KEEP) {
            if (k in doc) slim[k] = doc[k];
          }
          if (slim.createdBy && typeof slim.createdBy === 'object') {
            const u = slim.createdBy as Record<string, unknown>;
            slim.createdBy = { id: u.id, name: u.name };
          }
          if (slim.updatedBy && typeof slim.updatedBy === 'object') {
            const u = slim.updatedBy as Record<string, unknown>;
            slim.updatedBy = { id: u.id, name: u.name };
          }
          return slim;
        });
      }
      docListCache = { data: JSON.stringify(json), timestamp: Date.now() };
    }
  } catch { /* ignore */ }
  docListRefreshing = false;
}

/**
 * Proxy all /api/outline/* requests to Outline /api/*
 * Note: Outline uses POST for most read operations (documents.list, documents.info, etc.)
 * Supports both JSON and multipart/form-data (for file uploads)
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    // Forward multipart as-is (for attachments.create etc.)
    return proxyMultipart(req, params.path);
  }
  return proxy(req, params.path, await req.text());
}

async function proxy(req: NextRequest, pathParts: string[], body?: string) {
  const endpoint = pathParts.join('/');

  // Serve cached documents.list immediately, refresh in background if stale
  // Only serve cache for offset=0 requests to avoid returning wrong page data
  if (endpoint === 'documents.list' && docListCache) {
    let requestOffset = 0;
    try {
      if (body) {
        const parsed = JSON.parse(body);
        requestOffset = parsed.offset || 0;
      }
    } catch { /* ignore */ }

    if (requestOffset === 0) {
      const age = Date.now() - docListCache.timestamp;
      if (age < DOC_LIST_CACHE_TTL) {
        return new NextResponse(docListCache.data, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Cache is stale but exists — serve it immediately, refresh in background
      const cached = docListCache.data;
      refreshDocListCache();
      return new NextResponse(cached, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const olPath = '/api/' + pathParts.join('/');
  const url = new URL(olPath, OL_URL);

  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${OL_KEY}`,
    'Content-Type': 'application/json',
  };

  const resp = await fetch(url.toString(), {
    method: req.method,
    headers,
    body: body || undefined,
  });

  const contentType = resp.headers.get('Content-Type') || 'application/json';

  // For binary responses (images, etc.), return as arrayBuffer
  if (contentType.startsWith('image/') || contentType.startsWith('application/octet-stream')) {
    const data = await resp.arrayBuffer();
    return new NextResponse(data, {
      status: resp.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': resp.headers.get('Cache-Control') || 'public, max-age=3600',
      },
    });
  }

  // Invalidate doc list cache on mutations (create, update, delete, move, archive)
  const mutatingEndpoints = ['documents.create', 'documents.update', 'documents.delete', 'documents.move', 'documents.archive', 'documents.restore', 'documents.import'];
  if (mutatingEndpoints.includes(endpoint)) {
    docListCache = null;
  }

  // Strip heavy `text` field from documents.list responses and cache the result
  // Sidebar only needs metadata (id, title, icon, parentDocumentId, etc.)
  // Full text is fetched individually via documents.info when a doc is opened
  if (endpoint === 'documents.list' && resp.status === 200) {
    const data = await resp.text();
    try {
      const json = JSON.parse(data);
      if (json.data && Array.isArray(json.data)) {
        // Keep only fields needed for the sidebar tree
        const KEEP = new Set(['id', 'title', 'icon', 'emoji', 'createdAt', 'updatedAt', 'parentDocumentId', 'collectionId', 'deletedAt', 'archivedAt', 'publishedAt', 'createdBy', 'updatedBy', 'revision', 'fullWidth', 'insightsEnabled']);
        json.data = json.data.map((doc: Record<string, unknown>) => {
          const slim: Record<string, unknown> = {};
          for (const k of KEEP) {
            if (k in doc) slim[k] = doc[k];
          }
          // Slim user objects to {id, name}
          if (slim.createdBy && typeof slim.createdBy === 'object') {
            const u = slim.createdBy as Record<string, unknown>;
            slim.createdBy = { id: u.id, name: u.name };
          }
          if (slim.updatedBy && typeof slim.updatedBy === 'object') {
            const u = slim.updatedBy as Record<string, unknown>;
            slim.updatedBy = { id: u.id, name: u.name };
          }
          return slim;
        });
      }
      const stripped = JSON.stringify(json);
      docListCache = { data: stripped, timestamp: Date.now() };
      return new NextResponse(stripped, {
        status: resp.status,
        headers: { 'Content-Type': contentType },
      });
    } catch {
      // If parsing fails, return original response
      const fallback = data;
      return new NextResponse(fallback, {
        status: resp.status,
        headers: { 'Content-Type': contentType },
      });
    }
  }

  const data = await resp.text();

  return new NextResponse(data, {
    status: resp.status,
    headers: { 'Content-Type': contentType },
  });
}

async function proxyMultipart(req: NextRequest, pathParts: string[]) {
  const olPath = '/api/' + pathParts.join('/');
  const url = new URL(olPath, OL_URL);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  // Get raw body as arrayBuffer and forward with original content-type
  const body = await req.arrayBuffer();
  const contentType = req.headers.get('content-type')!;

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OL_KEY}`,
      'Content-Type': contentType,
    },
    body,
  });

  const data = await resp.text();
  return new NextResponse(data, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
