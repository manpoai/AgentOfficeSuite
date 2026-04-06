import React from 'react';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TFunc } from './types';
import type { ContentTopBarCommonCtx } from './content-topbar-common.actions';
import { contentTopBarCommonActions } from './content-topbar-common.actions';
import { contentItemActions } from './content-item.actions';

export interface FixedActionRenderItem {
  id: string;
  render: (opts: { t: TFunc; active?: boolean }) => React.ReactNode;
  execute: () => void;
}

export interface FixedTopBarActionCtx extends ContentTopBarCommonCtx {
  showHistoryActive?: boolean;
  showCommentsActive?: boolean;
  present?: () => void;
}

function buildCommonFixedAction(id: 'search' | 'share' | 'history' | 'comments', t: TFunc, ctx: FixedTopBarActionCtx): FixedActionRenderItem {
  const source = id === 'share'
    ? contentItemActions.find(action => action.id === 'share')!
    : contentTopBarCommonActions.find(action => action.id === id)!;

  return {
    id,
    execute: () => source.execute(ctx),
    render: ({ active }) => {
      const Icon = typeof source.icon === 'function' ? source.icon(ctx) : source.icon;
      if (id === 'search') {
        return (
          <button onClick={() => source.execute(ctx)} className="p-2 text-black/70 dark:text-white/70 hover:text-foreground rounded transition-colors" title={source.label(t, ctx)}>
            <Icon className="h-4 w-4" />
          </button>
        );
      }
      if (id === 'share') {
        return (
          <button onClick={() => source.execute(ctx)} className="flex items-center gap-1.5 h-8 px-3 ml-1 border border-black/20 dark:border-white/20 rounded-lg text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors">
            <Icon className="h-4 w-4" />
            {source.label(t, ctx)}
          </button>
        );
      }
      if (id === 'history') {
        return (
          <button
            onClick={() => source.execute(ctx)}
            className={cn('flex items-center justify-center w-8 h-8 ml-1 border border-black/20 dark:border-white/20 rounded-lg transition-colors', active ? 'text-sidebar-primary bg-sidebar-primary/10 border-sidebar-primary/20' : 'text-black/70 dark:text-white/70 hover:bg-black/[0.04]')}
            title={source.label(t, ctx)}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      }
      return (
        <button
          onClick={() => source.execute(ctx)}
          className={cn('flex items-center justify-center w-8 h-8 ml-1 rounded-lg transition-colors', active ? 'bg-sidebar-primary/80' : 'bg-sidebar-primary hover:bg-sidebar-primary/90')}
          title={source.label(t, ctx)}
        >
          <Icon className="h-4 w-4 text-white" />
        </button>
      );
    },
  };
}

export function buildFixedTopBarActionItems(t: TFunc, ctx: FixedTopBarActionCtx): FixedActionRenderItem[] {
  return [
    buildCommonFixedAction('search', t, ctx),
    buildCommonFixedAction('share', t, ctx),
    buildCommonFixedAction('history', t, ctx),
    buildCommonFixedAction('comments', t, ctx),
  ];
}

export function renderFixedTopBarActions(items: FixedActionRenderItem[], opts: { t: TFunc; ctx: FixedTopBarActionCtx; includePresent?: boolean }) {
  const { t, ctx, includePresent } = opts;
  return (
    <>
      {items.map(item => (
        <React.Fragment key={item.id}>
          {item.render({
            t,
            active: item.id === 'history' ? ctx.showHistoryActive : item.id === 'comments' ? ctx.showCommentsActive : false,
          })}
        </React.Fragment>
      ))}
      {includePresent && ctx.present && (
        <button onClick={ctx.present} className="flex items-center gap-1.5 h-8 px-3 ml-1 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('toolbar.present')}</span>
        </button>
      )}
    </>
  );
}
