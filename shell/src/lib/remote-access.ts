'use client';

/**
 * Returns the public origin for constructing external-facing URLs (copy link, share, etc.).
 * AgentOffice no longer manages a public base URL — whatever origin the browser is on
 * is the canonical public origin.
 */
export function getPublicOrigin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}
