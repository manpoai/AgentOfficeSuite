import type { SurfaceConfig } from './types';

export const tableSurfaces = {
  /** Cell right-click */
  cellMenu: [
    'table-open-record',
    'table-row-comments',
    '---',
    'table-delete-record',
  ] as SurfaceConfig,

  /** Column header right-click */
  headerMenu: [
    'table-sort-asc',
    'table-sort-desc',
    '---',
    'table-hide-column',
    '---',
    'table-delete-column',
  ] as SurfaceConfig,
};
