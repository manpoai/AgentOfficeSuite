import type { SurfaceConfig } from './types';

const UNIFIED_MENU: SurfaceConfig = [
  'open-new-tab',
  'rename',
  'change-icon',
  'copy-link',
  'pin',
  'download',
  'share',
  '---',
  'delete',
];

export const contentItemSurfaces = {
  /** Sidebar tree node right-click menu */
  contextMenu: UNIFIED_MENU,

  /** Sidebar tree node ⋯ button menu */
  topBarMore: UNIFIED_MENU,
};
