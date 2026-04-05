import type { ShortcutDef } from '@/lib/keyboard/types';

/**
 * Diagram editor context shortcuts.
 * Handlers dispatch custom events that X6DiagramEditor listens for.
 */
function dispatch(eventName: string) {
  window.dispatchEvent(new CustomEvent(eventName));
}

export const DIAGRAM_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'diagram-delete',
    key: 'Delete',
    handler: () => dispatch('diagram:delete-selected'),
    label: 'Delete selected',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-backspace',
    key: 'Backspace',
    handler: () => dispatch('diagram:delete-selected'),
    label: 'Delete selected',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-tab',
    key: 'Tab',
    handler: (e) => { e.preventDefault(); dispatch('diagram:add-child'); },
    label: 'Add child node',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-enter',
    key: 'Enter',
    handler: () => dispatch('diagram:add-sibling'),
    label: 'Add sibling node',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-f2',
    key: 'F2',
    handler: () => dispatch('diagram:edit-label'),
    label: 'Edit label',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-copy',
    key: 'c',
    modifiers: { meta: true },
    handler: () => dispatch('diagram:copy'),
    label: 'Copy',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-paste',
    key: 'v',
    modifiers: { meta: true },
    handler: () => dispatch('diagram:paste'),
    label: 'Paste',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-select-all',
    key: 'a',
    modifiers: { meta: true },
    handler: (e) => { e.preventDefault(); dispatch('diagram:select-all'); },
    label: 'Select all',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-tool-select',
    key: 'v',
    handler: () => dispatch('diagram:tool-select'),
    label: 'Select tool',
    category: 'Diagram',
    priority: 2,
  },
  {
    id: 'diagram-tool-text',
    key: 't',
    handler: () => dispatch('diagram:tool-text'),
    label: 'Text tool',
    category: 'Diagram',
    priority: 2,
  },
  {
    id: 'diagram-tool-rect',
    key: 'r',
    handler: () => dispatch('diagram:tool-rect'),
    label: 'Rectangle tool',
    category: 'Diagram',
    priority: 2,
  },
  {
    id: 'diagram-tool-mindmap',
    key: 'm',
    handler: () => dispatch('diagram:tool-mindmap'),
    label: 'Mindmap tool',
    category: 'Diagram',
    priority: 2,
  },
  {
    id: 'diagram-collapse',
    key: '.',
    modifiers: { meta: true },
    handler: (e) => { e.preventDefault(); dispatch('diagram:toggle-collapse'); },
    label: 'Toggle collapse',
    category: 'Diagram',
    priority: 5,
  },
];
