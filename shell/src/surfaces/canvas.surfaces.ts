import type { SurfaceConfig } from './types';

export const canvasSurfaces = {
  /** Canvas: blank area right-click */
  blankMenu: [
    'canvas-paste',
    '---',
  ] as SurfaceConfig,

  /** Canvas: single element right-click */
  elementMenu: [
    'canvas-cut',
    'canvas-copy',
    'canvas-paste',
    'canvas-duplicate',
    '---',
    'canvas-delete',
    '---',
    'canvas-bring-to-front',
    'canvas-bring-forward',
    'canvas-send-backward',
    'canvas-send-to-back',
    '---',
    'canvas-lock',
    'canvas-ungroup',
    '---',
    'canvas-ai-edit',
    'canvas-add-comment',
  ] as SurfaceConfig,

  /** Canvas: multi-selection right-click */
  multiMenu: [
    'canvas-cut',
    'canvas-copy',
    'canvas-paste',
    '---',
    'canvas-delete',
    '---',
    'canvas-group',
    'canvas-ungroup',
    '---',
    'canvas-bring-to-front',
    'canvas-send-to-back',
  ] as SurfaceConfig,

  /** Frame thumbnail: right-click */
  frameMenu: [
    'canvas-frame-rename',
    'canvas-frame-duplicate',
    '---',
    'canvas-frame-delete',
    '---',
    'canvas-frame-export-png',
  ] as SurfaceConfig,
};
