import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PaletteKey } from './color-palettes';

export type Platform = 'desktop' | 'mobile' | 'all';

export type TFunc = (key: string, params?: Record<string, string | number>) => string;

export interface ActionDef<TCtx = unknown> {
  id: string;
  label: (t: TFunc, ctx?: TCtx) => string;
  icon?: LucideIcon | ((ctx?: TCtx) => LucideIcon);
  iconNode?: ReactNode;
  shortcut?: string;
  platform?: Platform;
  danger?: boolean;
  group?: string;
  execute: (ctx: TCtx) => void | Promise<void>;
}

export interface ToggleActionDef<TCtx = unknown> extends ActionDef<TCtx> {
  type: 'toggle';
  isActive: (ctx: TCtx) => boolean;
}

export interface DropdownActionDef<TCtx = unknown> extends ActionDef<TCtx> {
  type: 'dropdown';
  options: { value: string; label: string; icon?: ReactNode }[];
  getValue: (ctx: TCtx) => string;
}

export interface ColorActionDef<TCtx = unknown> extends ActionDef<TCtx> {
  type: 'color';
  paletteKey: PaletteKey;
  clearable?: boolean;
  getValue: (ctx: TCtx) => string;
}

export type AnyActionDef<TCtx = unknown> =
  | ActionDef<TCtx>
  | ToggleActionDef<TCtx>
  | DropdownActionDef<TCtx>
  | ColorActionDef<TCtx>;

export type ActionMap<TCtx = unknown> = Record<string, AnyActionDef<TCtx>>;

/** Build a lookup map from an array of actions */
export function buildActionMap<TCtx>(actions: AnyActionDef<TCtx>[]): ActionMap<TCtx> {
  return Object.fromEntries(actions.map(a => [a.id, a]));
}
