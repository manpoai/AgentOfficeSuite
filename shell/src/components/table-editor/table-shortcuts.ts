import type { ShortcutDef } from '@/lib/keyboard/types';

/**
 * Table editor context shortcuts.
 * Handlers dispatch custom events that TableEditor listens for.
 */
function dispatch(eventName: string) {
  window.dispatchEvent(new CustomEvent(eventName));
}

export const TABLE_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'table-enter',
    key: 'Enter',
    handler: () => dispatch('table:edit-cell'),
    label: 'Edit cell',
    category: 'Table',
    priority: 5,
  },
  {
    id: 'table-escape',
    key: 'Escape',
    handler: () => dispatch('table:exit-edit'),
    label: 'Exit editing',
    category: 'Table',
    priority: 5,
  },
  {
    id: 'table-tab',
    key: 'Tab',
    handler: (e) => { e.preventDefault(); dispatch('table:next-cell'); },
    label: 'Next cell',
    category: 'Table',
    priority: 5,
  },
  {
    id: 'table-shift-tab',
    key: 'Tab',
    modifiers: { shift: true },
    handler: (e) => { e.preventDefault(); dispatch('table:prev-cell'); },
    label: 'Previous cell',
    category: 'Table',
    priority: 6,
  },
  {
    id: 'table-delete-row',
    key: 'Delete',
    modifiers: { meta: true },
    handler: () => dispatch('table:delete-row'),
    label: 'Delete row',
    category: 'Table',
    priority: 5,
  },
];
