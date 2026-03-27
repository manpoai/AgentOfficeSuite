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

// ─── Shape Definitions ─────────────────────────────

export type FlowchartShape =
  | 'rect'
  | 'rounded-rect'
  | 'diamond'
  | 'circle'
  | 'ellipse'
  | 'parallelogram'
  | 'triangle'
  | 'stadium';

export const SHAPE_META: Record<FlowchartShape, { label: string; icon: string; width: number; height: number }> = {
  'rect':            { label: '矩形',       icon: '▭', width: 120, height: 60 },
  'rounded-rect':    { label: '圆角矩形',   icon: '▢', width: 120, height: 60 },
  'diamond':         { label: '菱形',       icon: '◇', width: 100, height: 80 },
  'circle':          { label: '圆形',       icon: '○', width: 70,  height: 70 },
  'ellipse':         { label: '椭圆',       icon: '⬭', width: 120, height: 70 },
  'parallelogram':   { label: '平行四边形', icon: '▱', width: 130, height: 60 },
  'triangle':        { label: '三角形',     icon: '△', width: 100, height: 80 },
  'stadium':         { label: '开始/结束',  icon: '⊂⊃', width: 130, height: 50 },
};

// ─── Connector Types ───────────────────────────────

export type ConnectorType = 'straight' | 'manhattan' | 'rounded' | 'smooth';

export const CONNECTOR_META: Record<ConnectorType, { label: string; router: string; connector: string }> = {
  'straight':   { label: '直线',     router: 'normal',    connector: 'normal' },
  'manhattan':  { label: '正交连线', router: 'manhattan',  connector: 'rounded' },
  'rounded':    { label: '折线',     router: 'orth',       connector: 'rounded' },
  'smooth':     { label: '曲线',     router: 'normal',     connector: 'smooth' },
};

// ─── Defaults ──────────────────────────────────────

export const DEFAULT_SHAPE: FlowchartShape = 'rounded-rect';
export const DEFAULT_CONNECTOR: ConnectorType = 'manhattan';
export const DEFAULT_NODE_COLOR = NODE_COLORS[0];
export const DEFAULT_EDGE_COLOR = '#94a3b8';
export const DEFAULT_EDGE_WIDTH = 2;

export const AUTOSAVE_DEBOUNCE_MS = 2000;
export const PORT_R = 5;
export const PORT_VISIBLE_R = 6;
