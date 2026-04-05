// ─── Shared Types & Constants for Presentation Editor ──────────────────

export interface SlideData {
  elements: any[];
  background: string;
  backgroundImage?: string;
  notes: string;
}

export interface PresentationData {
  slides: SlideData[];
}

export interface PresentationEditorProps {
  presentationId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
  onNavigate?: (id: string) => void;
}

// ─── Constants ──────────────────────────────────────
export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;
export const THUMB_WIDTH = 180;
export const THUMB_HEIGHT = Math.round(THUMB_WIDTH * (SLIDE_HEIGHT / SLIDE_WIDTH));

export const DEFAULT_SLIDE: SlideData = {
  elements: [],
  background: '#ffffff',
  notes: '',
};

export const FONT_FAMILIES = [
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
  { label: '\u601D\u6E90\u9ED1\u4F53', value: '"Noto Sans SC", "Source Han Sans SC", sans-serif' },
  { label: '\u601D\u6E90\u5B8B\u4F53', value: '"Noto Serif SC", "Source Han Serif SC", serif' },
  { label: '\u5FAE\u8F6F\u96C5\u9ED1', value: '"Microsoft YaHei", sans-serif' },
  { label: '\u82F9\u679C\u82F9\u65B9', value: '"PingFang SC", sans-serif' },
];

export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96];

export const STROKE_DASH_STYLES: { label: string; value: number[] | undefined }[] = [
  { label: 'Solid', value: undefined },
  { label: 'Dashed', value: [8, 4] },
  { label: 'Dotted', value: [2, 4] },
];

// ─── Helpers ────────────────────────────────────────

export function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

export function fitCanvasToContainer(canvas: any, container: HTMLElement | null) {
  if (!canvas || !container) return;
  const rect = container.getBoundingClientRect();
  const { width, height } = rect;
  if (width < 50 || height < 50) return;
  const padding = 40;
  const scale = Math.min((width - padding) / SLIDE_WIDTH, (height - padding) / SLIDE_HEIGHT);
  if (scale <= 0 || !isFinite(scale)) return;

  const canvasW = Math.round(SLIDE_WIDTH * scale);
  const canvasH = Math.round(SLIDE_HEIGHT * scale);

  canvas.setDimensions({ width: canvasW, height: canvasH });
  canvas.setZoom(scale);
  canvas.renderAll();

  const wrapper = container.querySelector('.canvas-wrapper') as HTMLElement;
  if (wrapper) {
    wrapper.style.marginLeft = `${Math.max(0, Math.round((width - canvasW) / 2))}px`;
    wrapper.style.marginTop = `${Math.max(0, Math.round((height - canvasH) / 2))}px`;
  }
}

export function getObjType(obj: any): string {
  if (obj?.__isTable) return 'table';
  if (obj?.__shapeType) return 'shape';
  const t = (obj?.type || '').toLowerCase();
  if (t === 'textbox') return 'textbox';
  if (t === 'rect') return 'rect';
  if (t === 'circle') return 'circle';
  if (t === 'ellipse') return 'ellipse';
  if (t === 'triangle') return 'triangle';
  if (t === 'image') return 'image';
  return t;
}
