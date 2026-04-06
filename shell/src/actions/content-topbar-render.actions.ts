import { Search, Clock, AtSign, ExternalLink } from 'lucide-react';
import type { TFunc } from './types';

export interface TopBarRenderAction {
  id: string;
  label: (t: TFunc) => string;
  icon: any;
  kind: 'common' | 'file';
}

export const TOPBAR_COMMON_RENDER_ACTIONS: TopBarRenderAction[] = [
  { id: 'search', label: t => t('toolbar.search'), icon: Search, kind: 'common' },
  { id: 'share', label: t => t('actions.share'), icon: ExternalLink, kind: 'common' },
  { id: 'history', label: t => t('content.versionHistory'), icon: Clock, kind: 'common' },
  { id: 'comments', label: t => t('content.comments'), icon: AtSign, kind: 'common' },
];
