import type { SurfaceConfig } from './types';

export const diagramSurfaces = {
  /** Selected node right-click */
  nodeMenu: [
    'diagram-copy',
    'diagram-paste',
    '---',
    'diagram-delete',
    '---',
    'diagram-to-front',
    'diagram-bring-forward',
    'diagram-send-backward',
    'diagram-to-back',
    '---',
    'diagram-comment',
  ] as SurfaceConfig,

  /** Empty canvas right-click */
  canvasMenu: [
    'diagram-canvas-paste',
    '---',
    'diagram-canvas-comment',
  ] as SurfaceConfig,
};
