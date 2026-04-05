import React from 'react';
import type { AnyActionDef, ActionMap, TFunc } from '@/actions/types';
import type { SurfaceConfig } from './types';
import type { ContextMenuItem } from '@/lib/hooks/use-context-menu';
import type { ContentMenuItem } from '@/components/shared/ContentTopBar';
import type { ToolbarItem } from '@/components/shared/FloatingToolbar/types';
import { PALETTES } from '@/actions/color-palettes';

function resolveIcon<TCtx>(action: AnyActionDef<TCtx>, ctx: TCtx): React.ReactNode {
  if (!action.icon) return action.iconNode ?? null;
  const Icon = typeof action.icon === 'function' ? action.icon(ctx) : action.icon;
  return React.createElement(Icon as React.FC<{ className?: string }>, { className: 'h-4 w-4' });
}

function resolveIconComponent<TCtx>(action: AnyActionDef<TCtx>, ctx: TCtx): React.ComponentType<{ className?: string }> | null {
  if (!action.icon) return null;
  return (typeof action.icon === 'function' ? action.icon(ctx) : action.icon) as React.ComponentType<{ className?: string }>;
}

function resolveLabel<TCtx>(action: AnyActionDef<TCtx>, t: TFunc, ctx: TCtx): string {
  return action.label(t, ctx);
}

/**
 * Convert a surface config + action map into ContextMenuItem[] for ContextMenuProvider.
 * Used by: PPT canvas, Diagram canvas, Table right-click.
 */
export function toContextMenuItems<TCtx>(
  surface: SurfaceConfig,
  actions: ActionMap<TCtx>,
  ctx: TCtx,
  t: TFunc,
  isMobile = false,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  let pendingSeparator = false;

  for (let i = 0; i < surface.length; i++) {
    const entry = surface[i];
    if (entry === '---') {
      pendingSeparator = true;
      continue;
    }
    const action = actions[entry];
    if (!action) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[bridge] Action not found in map: "${entry}"`);
      }
      continue;
    }
    if (action.platform === 'desktop' && isMobile) continue;
    if (action.platform === 'mobile' && !isMobile) continue;

    items.push({
      id: action.id,
      label: resolveLabel(action, t, ctx),
      icon: resolveIcon(action, ctx),
      shortcut: action.shortcut,
      danger: action.danger,
      separator: pendingSeparator,
      onClick: () => action.execute(ctx),
    });
    pendingSeparator = false;
  }

  return items;
}

/**
 * Convert a surface config + action map into ContentMenuItem[] for ContentTopBar.
 * Used by: Sidebar tree node right-click, ContentTopBar ⋯ menu.
 */
export function toContentMenuItems<TCtx>(
  surface: SurfaceConfig,
  actions: ActionMap<TCtx>,
  ctx: TCtx,
  t: TFunc,
  isMobile = false,
): ContentMenuItem[] {
  const items: ContentMenuItem[] = [];
  let pendingSeparator = false;

  for (const entry of surface) {
    if (entry === '---') {
      pendingSeparator = true;
      continue;
    }
    const action = actions[entry];
    if (!action) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[bridge] Action not found in map: "${entry}"`);
      }
      continue;
    }
    if (action.platform === 'desktop' && isMobile) continue;
    if (action.platform === 'mobile' && !isMobile) continue;

    const Icon = resolveIconComponent(action, ctx);
    if (!Icon) continue; // ContentMenuItem requires a component icon

    items.push({
      icon: Icon,
      label: resolveLabel(action, t, ctx),
      onClick: () => action.execute(ctx),
      danger: action.danger,
      shortcut: action.shortcut,
      separator: pendingSeparator,
    });
    pendingSeparator = false;
  }

  return items;
}

/**
 * Convert a surface config + action map into ToolbarItem[] for FloatingToolbar.
 * Used by: PPT floating toolbar, Diagram floating toolbar.
 */
export function toToolbarItems<TCtx>(
  surface: SurfaceConfig,
  actions: ActionMap<TCtx>,
  ctx: TCtx,
  t: TFunc,
): ToolbarItem[] {
  const items: ToolbarItem[] = [];

  for (const entry of surface) {
    if (entry === '---') continue; // toolbar uses groups, not separators
    const action = actions[entry];
    if (!action) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[bridge] Action not found in map: "${entry}"`);
      }
      continue;
    }

    const base = {
      key: action.id,
      icon: resolveIcon(action, ctx),
      label: resolveLabel(action, t, ctx),
      group: action.group ?? 'default',
    };

    if ('type' in action && action.type === 'toggle') {
      items.push({ ...base, type: 'toggle' });
    } else if ('type' in action && action.type === 'dropdown') {
      items.push({ ...base, type: 'dropdown', options: action.options });
    } else if ('type' in action && action.type === 'color') {
      items.push({
        ...base,
        type: 'color',
        colors: PALETTES[action.paletteKey] ?? [],
        colorClearable: action.clearable,
      });
    } else {
      items.push({ ...base, type: 'action' });
    }
  }

  return items;
}
