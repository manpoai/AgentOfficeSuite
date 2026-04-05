// ─── Color Palettes ────────────────────────────────

export const NODE_COLORS = [
  { bg: '#ffffff', border: '#374151', text: '#1f2937', name: 'Default' },
  { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', name: 'Blue' },
  { bg: '#dcfce7', border: '#22c55e', text: '#166534', name: 'Green' },
  { bg: '#fef9c3', border: '#eab308', text: '#854d0e', name: 'Yellow' },
  { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', name: 'Red' },
  { bg: '#f3e8ff', border: '#a855f7', text: '#6b21a8', name: 'Purple' },
  { bg: '#ffedd5', border: '#f97316', text: '#9a3412', name: 'Orange' },
  { bg: '#e0e7ff', border: '#6366f1', text: '#3730a3', name: 'Indigo' },
];

export const MINDMAP_COLORS = [
  { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
  { bg: '#fef9c3', border: '#eab308', text: '#854d0e' },
  { bg: '#f3e8ff', border: '#a855f7', text: '#6b21a8' },
  { bg: '#ffedd5', border: '#f97316', text: '#9a3412' },
  { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
];

// ─── Shape Definitions (re-exported from shared ShapeSet) ──────
export type { ShapeType as FlowchartShape } from '@/components/shared/ShapeSet/shapes';
export { SHAPES, SHAPE_MAP, SHAPE_MAP as SHAPE_ICON_LOOKUP } from '@/components/shared/ShapeSet/shapes';
import { SHAPES, SHAPE_MAP } from '@/components/shared/ShapeSet/shapes';
import type { ShapeType } from '@/components/shared/ShapeSet/shapes';

/** Icon paths keyed by shape type — derived from shared SHAPES */
export const SHAPE_ICON_PATHS: Record<ShapeType, string> = Object.fromEntries(
  SHAPES.map((s) => [s.type, s.iconPath])
) as Record<ShapeType, string>;

/** Default dimensions keyed by shape type — derived from shared SHAPES */
export const SHAPE_META: Record<ShapeType, { width: number; height: number }> = Object.fromEntries(
  SHAPES.map((s) => [s.type, { width: s.width, height: s.height }])
) as Record<ShapeType, { width: number; height: number }>;

// ─── Connector Types ───────────────────────────────

export type ConnectorType = 'straight' | 'manhattan' | 'rounded' | 'smooth';

export const CONNECTOR_META: Record<ConnectorType, { labelKey: string; router: string; connector: string }> = {
  'straight':   { labelKey: 'diagram.connectors.straight',    router: 'normal',    connector: 'normal' },
  'manhattan':  { labelKey: 'diagram.connectors.orthogonal',  router: 'manhattan',  connector: 'rounded' },
  'rounded':    { labelKey: 'diagram.connectors.rounded',     router: 'orth',       connector: 'rounded' },
  'smooth':     { labelKey: 'diagram.connectors.smooth',      router: 'normal',     connector: 'smooth' },
};

// ─── Standalone color palettes (for independent fill / border pickers) ────
export const FILL_COLORS = [
  '#ffffff', '#dbeafe', '#dcfce7', '#fef9c3', '#fee2e2',
  '#f3e8ff', '#ffedd5', '#e0e7ff', '#f1f5f9', '#fce7f3',
  'transparent', // no fill
];

export const BORDER_COLORS = [
  '#374151', '#3b82f6', '#22c55e', '#eab308', '#ef4444',
  '#a855f7', '#f97316', '#6366f1', '#94a3b8',
  'transparent', // no border
];

export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];

export const EDGE_WIDTHS = [1, 1.5, 2, 3, 4, 6];

// ─── Defaults ──────────────────────────────────────

export const DEFAULT_SHAPE: ShapeType = 'rounded-rect';
export const DEFAULT_CONNECTOR: ConnectorType = 'manhattan';
export const DEFAULT_NODE_COLOR = NODE_COLORS[0];
export const DEFAULT_EDGE_COLOR = '#94a3b8';
export const DEFAULT_EDGE_WIDTH = 2;

export const AUTOSAVE_DEBOUNCE_MS = 2000;
export const PORT_R = 5;
export const PORT_VISIBLE_R = 6;
