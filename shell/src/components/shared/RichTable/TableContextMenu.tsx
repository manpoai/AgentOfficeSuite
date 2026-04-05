'use client';

/**
 * TableContextMenu — Right-click (desktop) / long-press (mobile) context menu
 * for RichTable cells and headers.
 *
 * Registers menu items with the global ContextMenuProvider when used inside it,
 * or renders its own inline menu when used standalone.
 */

import {
  Plus,
  Trash2,
  Copy,
  ClipboardPaste,
  ArrowUp,
  ArrowDown,
  Merge,
  SplitSquareHorizontal,
  Paintbrush,
} from 'lucide-react';
import type { RichTableActions, TableContextMenuItem, TableContextMenuContext } from './types';

/**
 * Builds context menu items based on what was right-clicked.
 */
export function buildTableContextMenuItems(
  context: TableContextMenuContext,
  actions: RichTableActions
): TableContextMenuItem[] {
  const items: TableContextMenuItem[] = [];

  if (context.type === 'cell' || context.type === 'header') {
    // Copy / Paste
    items.push({
      id: 'copy',
      label: 'Copy',
      icon: <Copy className="h-4 w-4" />,
      shortcut: '⌘C',
      action: () => document.execCommand('copy'),
    });
    items.push({
      id: 'paste',
      label: 'Paste',
      icon: <ClipboardPaste className="h-4 w-4" />,
      shortcut: '⌘V',
      action: () => document.execCommand('paste'),
      separator: true,
    });

    // Row operations
    items.push({
      id: 'insert-row-above',
      label: 'Insert row above',
      icon: <Plus className="h-4 w-4" />,
      action: () => actions.addRowBefore(context.rowIndex),
    });
    items.push({
      id: 'insert-row-below',
      label: 'Insert row below',
      icon: <Plus className="h-4 w-4" />,
      action: () => actions.addRowAfter(context.rowIndex),
      separator: true,
    });

    // Column operations
    items.push({
      id: 'insert-col-left',
      label: 'Insert column left',
      icon: <Plus className="h-4 w-4" />,
      action: () => actions.addColumnBefore(context.colIndex),
    });
    items.push({
      id: 'insert-col-right',
      label: 'Insert column right',
      icon: <Plus className="h-4 w-4" />,
      action: () => actions.addColumnAfter(context.colIndex),
      separator: true,
    });

    // Merge / Split
    items.push({
      id: 'merge-cells',
      label: 'Merge cells',
      icon: <Merge className="h-4 w-4" />,
      action: () => actions.mergeCells(),
    });
    items.push({
      id: 'split-cell',
      label: 'Split cell',
      icon: <SplitSquareHorizontal className="h-4 w-4" />,
      action: () => actions.splitCell(),
      separator: true,
    });

    // Sort (only for header cells)
    if (context.type === 'header') {
      items.push({
        id: 'sort-asc',
        label: 'Sort ascending',
        icon: <ArrowUp className="h-4 w-4" />,
        action: () => actions.sort(context.colIndex, 'asc'),
      });
      items.push({
        id: 'sort-desc',
        label: 'Sort descending',
        icon: <ArrowDown className="h-4 w-4" />,
        action: () => actions.sort(context.colIndex, 'desc'),
        separator: true,
      });
    }

    // Delete row/column
    items.push({
      id: 'delete-row',
      label: 'Delete row',
      icon: <Trash2 className="h-4 w-4" />,
      action: () => actions.deleteRow(),
      danger: true,
    });
    items.push({
      id: 'delete-col',
      label: 'Delete column',
      icon: <Trash2 className="h-4 w-4" />,
      action: () => actions.deleteColumn(),
      danger: true,
    });
  }

  return items;
}

/**
 * Hook to get context menu items builder for RichTable.
 * Use with ContextMenuProvider to register table-specific menu items.
 */
export function useTableContextMenu(actions: RichTableActions | null) {
  if (!actions) return null;

  return (context: TableContextMenuContext) =>
    buildTableContextMenuItems(context, actions);
}
