'use client';

import { IS_APP_MODE } from '@/lib/api/config';

/**
 * Returns the public origin for constructing external-facing URLs (copy link, share, etc.).
 *
 * Web mode: whatever origin the browser is on is the public origin.
 * App mode: tries the cached cloud origin (set after sync connect — see
 *   setCachedCloudOrigin). Falls back to "" which signals "use aose:// scheme".
 */
const CLOUD_ORIGIN_KEY = 'aose_cloud_origin';

export function getPublicOrigin(): string {
  if (typeof window === 'undefined') return '';
  if (IS_APP_MODE) {
    return localStorage.getItem(CLOUD_ORIGIN_KEY) || '';
  }
  return window.location.origin;
}

/** Cache the cloud origin after a successful sync connect so subsequent
 *  Copy link calls use it instead of aose://. Pass empty string to clear. */
export function setCachedCloudOrigin(origin: string) {
  if (typeof window === 'undefined') return;
  if (origin) {
    try { localStorage.setItem(CLOUD_ORIGIN_KEY, new URL(origin).origin); } catch {}
  } else {
    localStorage.removeItem(CLOUD_ORIGIN_KEY);
  }
}
