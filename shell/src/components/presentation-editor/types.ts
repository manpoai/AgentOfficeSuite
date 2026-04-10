// ─── Shared Types & Constants for Presentation Editor ──────────────────

export interface SlideData {
  id: string;
  elements: any[];
  background: string;
  backgroundImage?: string;
  notes: string;
  thumbnail?: string;
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

export function generateSlideId(): string {
  return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_SLIDE: SlideData = {
  id: '',
  elements: [],
  background: '#ffffff',
  notes: '',
};

export const FONT_FAMILIES = [
  { labelKey: 'toolbar.fonts.inter', label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { labelKey: 'toolbar.fonts.arial', label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { labelKey: 'toolbar.fonts.georgia', label: 'Georgia', value: 'Georgia, serif' },
  { labelKey: 'toolbar.fonts.timesNewRoman', label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { labelKey: 'toolbar.fonts.courierNew', label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { labelKey: 'toolbar.fonts.verdana', label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { labelKey: 'toolbar.fonts.trebuchetMs', label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { labelKey: 'toolbar.fonts.comicSansMs', label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
  { labelKey: 'toolbar.fonts.notoSansSC', label: '思源黑体', value: '"Noto Sans SC", "Source Han Sans SC", sans-serif' },
  { labelKey: 'toolbar.fonts.notoSerifSC', label: '思源宋体', value: '"Noto Serif SC", "Source Han Serif SC", serif' },
  { labelKey: 'toolbar.fonts.microsoftYaHei', label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { labelKey: 'toolbar.fonts.pingFangSC', label: '苹果苹方', value: '"PingFang SC", sans-serif' },
];

export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96];

export const STROKE_DASH_STYLES: { labelKey: string; label: string; value: number[] | undefined }[] = [
  { labelKey: 'toolbar.common.solidLine', label: 'Solid', value: undefined },
  { labelKey: 'toolbar.common.dashedLine', label: 'Dashed', value: [8, 4] },
  { labelKey: 'toolbar.common.dottedLine', label: 'Dotted', value: [2, 4] },
];

// ─── Helpers ────────────────────────────────────────

export { formatRelativeTime } from '@/lib/utils/time';

export function fitCanvasToContainer(canvas: any, container: HTMLElement | null, userZoom?: number) {
  if (!canvas || !container) return;
  const rect = container.getBoundingClientRect();
  const { width, height } = rect;
  if (width < 50 || height < 50) return;
  const padding = 40;
  const fitScale = Math.min((width - padding) / SLIDE_WIDTH, (height - padding) / SLIDE_HEIGHT);
  if (fitScale <= 0 || !isFinite(fitScale)) return;

  const zoom = userZoom ?? fitScale;
  const canvasW = Math.round(SLIDE_WIDTH * zoom);
  const canvasH = Math.round(SLIDE_HEIGHT * zoom);

  canvas.setDimensions({ width: canvasW, height: canvasH });
  canvas.setZoom(zoom);
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
