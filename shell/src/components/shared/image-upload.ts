export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

import { resolveGatewayUrl, API_BASE } from '@/lib/api/config';

/** Resolve a server upload URL (e.g. /api/uploads/files/x.png) to a shell-proxied URL the browser can fetch. */
export function resolveUploadUrl(p: string): string {
  return resolveGatewayUrl(p);
}

/**
 * Normalize an upload path to the canonical form `/api/gateway/uploads/files/X.jpg`
 * that works in both App and web modes without baking in a host. Use this when
 * persisting URLs into document data (so they round-trip through sync).
 *
 * App mode: gateway has middleware that strips /api/gateway → /api, so the path resolves.
 * Web mode: Caddy → Next.js → /api/gateway/* proxy → gateway.
 *
 * Avoid resolveUploadUrl() for persisted data — it bakes in `http://localhost:4000`
 * (App) or `/api/gateway` (web), which breaks the OTHER side after sync.
 */
export function canonicalizeUploadUrl(p: string): string {
  if (!p) return p;
  if (p.startsWith('blob:') || p.startsWith('data:')) return p;
  // Strip any host (http://localhost:4000, https://asuite.gridtabs.com, etc.)
  let path = p;
  try {
    const u = new URL(p);
    path = u.pathname;
  } catch {
    // not a full URL, leave as-is
  }
  // Strip /api/gateway if present, then re-add canonical /api/gateway prefix
  if (path.startsWith('/api/gateway/')) path = path.slice('/api/gateway'.length);
  if (path.startsWith('/api/')) path = path.slice('/api'.length);
  if (!path.startsWith('/uploads/')) return p; // unknown shape, don't touch
  return `/api/gateway${path}`;
}

/** Read image natural width/height without consuming the whole file. */
export function probeImageSize(file: File): Promise<{ w: number; h: number; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, objectUrl });
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')); };
    img.src = objectUrl;
  });
}

export function createImageHtml(src: string, w = 300, h = 200, elementId?: string): string {
  // For blob: URLs (during upload), use as-is. For server URLs, store canonical
  // /api/gateway/uploads/... form so the SVG renders correctly on both App and web
  // after the data round-trips through sync.
  const url = (src.startsWith('blob:') || src.startsWith('data:')) ? src : canonicalizeUploadUrl(src);
  // The SVG pattern's id must be unique across the whole document — multiple
  // image elements in one canvas/video would all collide on a hardcoded
  // "img-fill" id and the browser would render every one with the FIRST
  // pattern's image (so every later image looked like the first).
  const patternId = `img-fill-${elementId || Math.random().toString(36).slice(2, 10)}`;
  return `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${w + 2} ${h + 2}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><defs><pattern id="${patternId}" patternUnits="objectBoundingBox" width="1" height="1"><image href="${url}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/></pattern></defs><path d="M0 0h${w}v${h}H0z" fill="url(#${patternId})" stroke="none" stroke-width="0" vector-effect="non-scaling-stroke"/></svg></div>`;
}

export function extractDroppedImageFiles(e: DragEvent): File[] {
  const files: File[] = [];
  if (e.dataTransfer?.files) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i];
      if (f.type.startsWith('image/')) files.push(f);
    }
  }
  return files;
}

export function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || file.name.endsWith('.svg');
}

export async function uploadImageFile(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const token = typeof window !== 'undefined' ? localStorage.getItem('aose_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/uploads`, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const { url } = await res.json() as { url: string };
  return url;
}
