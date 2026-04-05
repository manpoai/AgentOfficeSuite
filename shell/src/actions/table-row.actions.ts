import { ExternalLink, MessageSquare, Trash2 } from 'lucide-react';
import type { ActionDef } from './types';

export interface TableRowCtx {
  rowId: number;
  rowIdx: number;
  openRecord: (rowIdx: number) => void;
  openComments: (rowIdx: number) => void;
  deleteRecord: (rowId: number) => void;
}

export const tableRowActions: ActionDef<TableRowCtx>[] = [
  {
    id: 'table-open-record',
    label: t => t('actions.openRecord'),
    icon: ExternalLink,
    group: 'navigate',
    execute: ctx => ctx.openRecord(ctx.rowIdx),
  },
  {
    id: 'table-row-comments',
    label: t => t('actions.rowComments'),
    icon: MessageSquare,
    group: 'other',
    execute: ctx => ctx.openComments(ctx.rowIdx),
  },
  {
    id: 'table-delete-record',
    label: t => t('actions.deleteRecord'),
    icon: Trash2,
    danger: true,
    group: 'danger',
    execute: ctx => ctx.deleteRecord(ctx.rowId),
  },
];
