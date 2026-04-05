import type { ShortcutDef } from '@/lib/keyboard/types';

/**
 * Presentation editor context shortcuts.
 * Handlers dispatch custom events that PresentationEditor listens for.
 */
function dispatch(eventName: string) {
  window.dispatchEvent(new CustomEvent(eventName));
}

export const PPT_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'ppt-delete',
    key: 'Delete',
    handler: () => dispatch('ppt:delete-selected'),
    label: 'Delete selected',
    category: 'Presentation',
    priority: 5,
  },
  {
    id: 'ppt-backspace',
    key: 'Backspace',
    handler: () => dispatch('ppt:delete-selected'),
    label: 'Delete selected',
    category: 'Presentation',
    priority: 5,
  },
  {
    id: 'ppt-duplicate',
    key: 'd',
    modifiers: { meta: true },
    handler: (e) => { e.preventDefault(); dispatch('ppt:duplicate'); },
    label: 'Duplicate',
    category: 'Presentation',
    priority: 8,
  },
  {
    id: 'ppt-group',
    key: 'g',
    modifiers: { meta: true },
    handler: (e) => { e.preventDefault(); dispatch('ppt:group'); },
    label: 'Group',
    category: 'Presentation',
    priority: 8,
  },
  {
    id: 'ppt-ungroup',
    key: 'g',
    modifiers: { meta: true, shift: true },
    handler: (e) => { e.preventDefault(); dispatch('ppt:ungroup'); },
    label: 'Ungroup',
    category: 'Presentation',
    priority: 9,
  },
  {
    id: 'ppt-nudge-left',
    key: 'ArrowLeft',
    handler: () => dispatch('ppt:nudge-left'),
    label: 'Nudge left',
    category: 'Presentation',
    priority: 3,
  },
  {
    id: 'ppt-nudge-right',
    key: 'ArrowRight',
    handler: () => dispatch('ppt:nudge-right'),
    label: 'Nudge right',
    category: 'Presentation',
    priority: 3,
  },
  {
    id: 'ppt-nudge-up',
    key: 'ArrowUp',
    handler: () => dispatch('ppt:nudge-up'),
    label: 'Nudge up',
    category: 'Presentation',
    priority: 3,
  },
  {
    id: 'ppt-nudge-down',
    key: 'ArrowDown',
    handler: () => dispatch('ppt:nudge-down'),
    label: 'Nudge down',
    category: 'Presentation',
    priority: 3,
  },
];
