// Stub for Outline's utils/date — delegates to shared utility
import { formatRelativeTime } from '@/lib/utils/time';

export function dateToRelative(date: Date | string): string {
  const str = date instanceof Date ? date.toISOString() : date;
  return formatRelativeTime(str);
}
