import { toast } from 'sonner';

/**
 * Unified error handler: logs to console and shows user-facing toast.
 * Use in catch blocks instead of bare console.error().
 */
export function showError(message: string, error?: unknown) {
  console.error(message, error);
  toast.error(message);
}
