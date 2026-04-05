import type { SurfaceConfig } from './types';

export const pptSurfaces = {
  /** Canvas: empty area right-click */
  canvasEmpty: [
    'ppt-canvas-paste',
    '---',
    'ppt-canvas-background',
    'ppt-canvas-comment',
  ] as SurfaceConfig,

  /** Canvas: selected object right-click */
  canvasObject: [
    'ppt-cut',
    'ppt-copy',
    'ppt-paste',
    '---',
    'ppt-delete',
    '---',
    'ppt-bring-to-front',
    'ppt-bring-forward',
    'ppt-send-backward',
    'ppt-send-to-back',
    '---',
    'ppt-comment',
  ] as SurfaceConfig,

  /** Slide thumbnail: single selection right-click */
  slideSingle: [
    'slide-cut',
    'slide-copy',
    'slide-paste',
    '---',
    'slide-delete',
    'slide-duplicate',
    '---',
    'slide-background',
    'slide-comment',
  ] as SurfaceConfig,

  /** Slide thumbnail: multi-selection right-click */
  slideMulti: [
    'slide-cut',
    'slide-copy',
    'slide-paste',
    '---',
    'slide-delete',
    'slide-duplicate',
    '---',
    'slide-background',
  ] as SurfaceConfig,
};
