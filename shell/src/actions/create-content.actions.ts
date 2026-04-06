import { ENTITY_NAMES, type CreatableType } from './entity-names';
import type { TFunc } from './types';

export interface CreateContentItemDef {
  type: CreatableType;
  label: (t: TFunc) => string;
  icon: typeof ENTITY_NAMES[CreatableType]['icon'];
}

export const CREATE_CONTENT_ITEMS: CreateContentItemDef[] = (['doc', 'table', 'presentation', 'diagram'] as const).map((type) => ({
  type,
  label: (t: TFunc) => t(ENTITY_NAMES[type].createLabelKey),
  icon: ENTITY_NAMES[type].icon,
}));
