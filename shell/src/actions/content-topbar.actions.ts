import { Link2, Download, Trash2, Clock, MessageSquare as MessageSquareIcon } from 'lucide-react';
import type { ActionDef, TFunc } from './types';
import type { ContentMenuItem } from '@/components/shared/ContentTopBar';

export interface ContentTopBarCtx {
  copyLink: () => void;
  download?: () => void;
  deleteItem: () => void;
  showHistory: () => void;
  showComments: () => void;
}

export const contentTopBarActions: ActionDef<ContentTopBarCtx>[] = [
  {
    id: 'copy-link',
    label: t => t('actions.copyLink'),
    icon: Link2,
    shortcut: '⌘⇧L',
    group: 'share',
    execute: ctx => ctx.copyLink(),
  },
  {
    id: 'download',
    label: t => t('actions.download'),
    icon: Download,
    group: 'share',
    execute: ctx => ctx.download?.(),
  },
  {
    id: 'delete',
    label: t => t('actions.moveToTrash'),
    icon: Trash2,
    danger: true,
    group: 'danger',
    execute: ctx => ctx.deleteItem(),
  },
  {
    id: 'history',
    label: t => t('content.versionHistory'),
    icon: Clock,
    shortcut: '⌘⇧H',
    group: 'history',
    execute: ctx => ctx.showHistory(),
  },
  {
    id: 'comments',
    label: t => t('content.comments'),
    icon: MessageSquareIcon,
    shortcut: '⌘J',
    group: 'collab',
    execute: ctx => ctx.showComments(),
  },
];

const topBarActionMap = Object.fromEntries(contentTopBarActions.map(action => [action.id, action])) as Record<string, ActionDef<ContentTopBarCtx>>;

export function buildSharedContentTopBarMenuItems(t: TFunc, ctx: ContentTopBarCtx): ContentMenuItem[] {
  const order = ['copy-link', 'download', 'delete', 'history', 'comments'] as const;
  return order.map((id) => {
    const action = topBarActionMap[id];
    return {
      icon: action.icon as NonNullable<ActionDef<ContentTopBarCtx>['icon']>,
      label: action.label(t, ctx),
      onClick: () => action.execute(ctx),
      danger: action.danger,
      shortcut: action.shortcut,
      separator: id === 'history',
    };
  });
}
