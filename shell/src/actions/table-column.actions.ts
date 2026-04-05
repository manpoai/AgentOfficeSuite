import { ArrowUp, ArrowDown, EyeOff, Trash2 } from 'lucide-react';
import type { ActionDef } from './types';

export interface TableColumnCtx {
  colKey: string;
  sortColumn: (colKey: string, dir: 'asc' | 'desc') => void;
  hideColumn: (colKey: string) => void;
  deleteColumn: (colKey: string) => void;
}

export const tableColumnActions: ActionDef<TableColumnCtx>[] = [
  {
    id: 'table-sort-asc',
    label: t => t('actions.sortAscending'),
    icon: ArrowUp,
    group: 'sort',
    execute: ctx => ctx.sortColumn(ctx.colKey, 'asc'),
  },
  {
    id: 'table-sort-desc',
    label: t => t('actions.sortDescending'),
    icon: ArrowDown,
    group: 'sort',
    execute: ctx => ctx.sortColumn(ctx.colKey, 'desc'),
  },
  {
    id: 'table-hide-column',
    label: t => t('actions.hideColumn'),
    icon: EyeOff,
    group: 'column',
    execute: ctx => ctx.hideColumn(ctx.colKey),
  },
  {
    id: 'table-delete-column',
    label: t => t('actions.deleteColumn'),
    icon: Trash2,
    danger: true,
    group: 'danger',
    execute: ctx => ctx.deleteColumn(ctx.colKey),
  },
];
