import { Clock, MessageSquare as MessageSquareIcon, Search } from 'lucide-react';
import type { ActionDef, TFunc } from './types';
import type { ContentMenuItem } from '@/components/shared/ContentTopBar';
import type { ContentItemCtx } from './content-item.actions';
import { buildActionMap } from './types';
import { contentItemActions } from './content-item.actions';

export interface ContentTopBarCommonCtx extends ContentItemCtx {
  showHistory: () => void;
  showComments: () => void;
  search?: () => void;
}

export const contentTopBarCommonActions: ActionDef<ContentTopBarCommonCtx>[] = [
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
  {
    id: 'search',
    label: t => t('common.search'),
    icon: Search,
    shortcut: '⌘F',
    group: 'content',
    execute: ctx => ctx.search?.(),
  },
];

const contentItemActionMap = buildActionMap(contentItemActions as ActionDef<ContentTopBarCommonCtx>[]);
const topBarCommonActionMap = buildActionMap(contentTopBarCommonActions);

export function buildContentTopBarCommonMenuItems(t: TFunc, ctx: ContentTopBarCommonCtx): ContentMenuItem[] {
  const order = ['copy-link', 'pin', 'download', 'share', 'delete', 'history', 'comments', 'search'] as const;
  return order.map((id) => {
    const action = (contentItemActionMap as Record<string, ActionDef<ContentTopBarCommonCtx>>)[id] || topBarCommonActionMap[id];
    return {
      icon: action.icon as NonNullable<ActionDef<ContentTopBarCommonCtx>['icon']>,
      label: action.label(t, ctx),
      onClick: () => action.execute(ctx),
      danger: action.danger,
      shortcut: action.shortcut,
      separator: id === 'history',
    };
  });
}
