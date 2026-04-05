import { useEffect } from 'react';
import { KeyboardManager } from './KeyboardManager';
import type { ShortcutDef } from './types';

/**
 * Set the active keyboard scope while this component is mounted.
 * Optionally register context shortcuts for the scope.
 *
 * Usage:
 *   useKeyboardScope('document');
 *   useKeyboardScope('table', TABLE_SHORTCUTS);
 */
export function useKeyboardScope(
  scope: string,
  shortcuts?: ShortcutDef[],
  deps: unknown[] = [],
): void {
  // Set scope on mount, clear on unmount
  useEffect(() => {
    const manager = KeyboardManager.getInstance();
    manager.setActiveScope(scope);
    return () => {
      // Only clear if we're still the active scope
      if (manager.getActiveScope() === scope) {
        manager.setActiveScope(null);
      }
    };
  }, [scope]);

  // Register context shortcuts if provided
  useEffect(() => {
    if (!shortcuts || shortcuts.length === 0) return;
    const manager = KeyboardManager.getInstance();
    const unregister = manager.registerContextBatch(scope, shortcuts);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, ...deps]);
}
