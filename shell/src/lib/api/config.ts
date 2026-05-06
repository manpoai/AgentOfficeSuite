/**
 * API configuration — controls how the shell connects to the gateway.
 *
 * App mode (Electron): shell fetches directly from the local gateway.
 * Web mode (Next.js SSR): shell fetches via the Next.js proxy route.
 */

export const IS_APP_MODE = process.env.NEXT_PUBLIC_API_MODE === 'app';

export const API_BASE = IS_APP_MODE
    ? `http://localhost:${process.env.NEXT_PUBLIC_GATEWAY_PORT || 4000}/api`
    : '/api/gateway';

/** Resolve a gateway-relative path to a full URL the browser can fetch. */
export function resolveGatewayUrl(p: string): string {
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('blob:') || p.startsWith('data:')) return p;
  if (p.startsWith('/api/gateway/')) return `${API_BASE}${p.slice('/api/gateway'.length)}`;
  if (p.startsWith('/api/')) return `${API_BASE}${p.slice(4)}`;
  if (p.startsWith('/uploads/')) return `${API_BASE}${p}`;
  return p;
}

/** Resolve an upload/attachment path to a fetchable URL. */
export function resolveUploadPath(p: string): string {
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('blob:') || p.startsWith('data:')) return p;
  if (p.startsWith('/api/gateway/')) return `${API_BASE}${p.slice('/api/gateway'.length)}`;
  if (p.startsWith('/api/')) return `${API_BASE}${p.slice(4)}`;
  if (p.startsWith('/uploads/')) return `${API_BASE}${p}`;
  return `${API_BASE}/uploads/files/${encodeURIComponent(p.replace(/^\/+/, ''))}`;
}
