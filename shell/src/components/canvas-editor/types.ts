export interface CanvasElement {
  id: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  html: string;
  locked?: boolean;
  z_index?: number;
  rotation?: number;
  // CSS transform-origin offset relative to element top-left (0..1 fractions
  // along the element's width and height). Defaults to 0.5/0.5 (center center)
  // when undefined. Used after vector-edit reassemble so the rotation pivot
  // can remain at the OLD element center even when the element box has been
  // tightened to the new path AABB.
  rotationOriginX?: number;
  rotationOriginY?: number;
  visible?: boolean;
  type?: 'group' | string;
  children?: CanvasElement[];
}

export interface CanvasPage {
  page_id: string;
  title?: string;
  width: number;
  height: number;
  head_html?: string;
  background_color?: string;
  background_image?: string;
  border_radius?: number;
  border_color?: string;
  border_width?: number;
  border_style?: 'solid' | 'dashed' | 'dotted';
  box_shadow?: string;
  elements: CanvasElement[];
  frame_x?: number;
  frame_y?: number;
}

export interface CanvasData {
  pages: CanvasPage[];
  elements?: CanvasElement[];
  background_color?: string;
}

export interface DesignToken {
  name: string;
  value: string;
  usageCount: number;
}

export const DEFAULT_PAGE_WIDTH = 1920;
export const DEFAULT_PAGE_HEIGHT = 1080;

export function createEmptyPage(pageNum: number): CanvasPage {
  return {
    page_id: crypto.randomUUID(),
    title: `Page ${pageNum}`,
    width: DEFAULT_PAGE_WIDTH,
    height: DEFAULT_PAGE_HEIGHT,
    head_html: '',
    elements: [],
  };
}
