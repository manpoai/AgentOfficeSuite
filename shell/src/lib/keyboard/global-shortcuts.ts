import { KeyboardManager, type ShortcutRegistration } from './KeyboardManager';

function dispatch(eventName: string) {
  window.dispatchEvent(new CustomEvent(eventName));
}

const GLOBAL_SHORTCUTS: ShortcutRegistration[] = [
  {
    id: 'global-cmd-k',
    key: 'k',
    modifiers: { meta: true },
    handler: () => dispatch('open-command-palette'),
    label: 'Open search',
    category: 'Global',
    priority: 10,
  },
  {
    id: 'global-cmd-n',
    key: 'n',
    modifiers: { meta: true },
    handler: () => dispatch('create-new-item'),
    label: 'Create new item',
    category: 'Global',
    priority: 10,
  },
  {
    id: 'global-cmd-s',
    key: 's',
    modifiers: { meta: true },
    handler: () => dispatch('save-current'),
    label: 'Save',
    category: 'Global',
    priority: 10,
  },
  {
    id: 'global-cmd-z',
    key: 'z',
    modifiers: { meta: true },
    handler: () => dispatch('undo'),
    label: 'Undo',
    category: 'Global',
    priority: 5,
  },
  {
    id: 'global-cmd-shift-z',
    key: 'z',
    modifiers: { meta: true, shift: true },
    handler: () => dispatch('redo'),
    label: 'Redo',
    category: 'Global',
    priority: 6,
  },
  {
    id: 'global-cmd-backslash',
    key: '\\',
    modifiers: { meta: true },
    handler: () => dispatch('toggle-sidebar'),
    label: 'Toggle sidebar',
    category: 'Global',
    priority: 10,
  },
  {
    id: 'global-help',
    key: '?',
    handler: () => dispatch('toggle-shortcut-help'),
    label: 'Show shortcuts',
    category: 'Global',
    priority: 0,
  },
];

let registered = false;

/**
 * Register all global shortcuts. Safe to call multiple times — only registers once.
 */
export function registerGlobalShortcuts(): () => void {
  if (registered) return () => {};
  registered = true;

  const manager = KeyboardManager.getInstance();
  const unregister = manager.registerGlobal(GLOBAL_SHORTCUTS);

  return () => {
    unregister();
    registered = false;
  };
}
