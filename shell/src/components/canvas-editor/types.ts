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
  visible?: boolean;
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
  elements: CanvasElement[];
  frame_x?: number;
  frame_y?: number;
}

export interface CanvasData {
  pages: CanvasPage[];
  elements?: CanvasElement[];
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
