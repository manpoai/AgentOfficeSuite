/**
 * Shared time formatting utilities.
 * Single source of truth — replace all duplicate implementations.
 */

export function formatRelativeTime(dateStr: string | number | null | undefined): string {
  if (!dateStr) return '';
  const date = typeof dateStr === 'number' ? new Date(dateStr) : new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  return date.toLocaleDateString();
}

export function formatDateTime(dateStr: string | number | null | undefined): string {
  if (!dateStr) return '';
  const date = typeof dateStr === 'number' ? new Date(dateStr) : new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export function formatDate(dateStr: string | number | null | undefined): string {
  if (!dateStr) return '';
  const date = typeof dateStr === 'number' ? new Date(dateStr) : new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}
