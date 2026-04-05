import { useEffect, useRef } from 'react';
import { KeyboardManager, type ShortcutRegistration } from './KeyboardManager';

/**
 * Register keyboard shortcuts for a context.
 * Shortcuts are unregistered when the component unmounts or deps change.
 *
 * A ref is used to keep shortcut handlers up-to-date without re-registering
 * on every render. Re-registration only happens when `context` or `deps` change.
 */
export function useKeyboardShortcuts(
  context: string,
  shortcuts: ShortcutRegistration[],
  deps: unknown[] = [],
): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const current = shortcutsRef.current;
    if (current.length === 0) return;
    const manager = KeyboardManager.getInstance();
    // Wrap handlers so they always call the latest ref version
    const wrapped: ShortcutRegistration[] = current.map((s) => ({
      ...s,
      handler: (e: KeyboardEvent) => {
        const latest = shortcutsRef.current.find((r) => r.id === s.id);
        (latest?.handler ?? s.handler)(e);
      },
    }));
    const unregister = manager.registerContext(context, wrapped);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, ...deps]);
}

/**
 * Set the active keyboard context while this component is mounted.
 * Clears the context on unmount.
 */
export function useKeyboardContext(context: string): void {
  useEffect(() => {
    const manager = KeyboardManager.getInstance();
    manager.setActiveScope(context);
    return () => {
      manager.setActiveScope(null);
    };
  }, [context]);
}
