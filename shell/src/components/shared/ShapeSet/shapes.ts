/**
 * shapes.ts — Unified shape definitions for Diagram and Presentation editors.
 *
 * Defines 24 shapes with SVG paths, default dimensions, and categories.
 * These shapes are shared across:
 * - Diagram editor (X6 custom nodes)
 * - Presentation editor (Fabric.js custom objects)
 * - ShapePicker UI component
 *
 * Shape rendering paths are defined for a 24x24 viewBox (icon paths)
 * and for a normalized 0-1 coordinate space (render paths for arbitrary sizes).
 */

/** All available shape types */
export type ShapeType =
  | 'rect'
  | 'rounded-rect'
  | 'diamond'
  | 'circle'
  | 'ellipse'
  | 'parallelogram'
  | 'triangle'
  | 'stadium'
  | 'hexagon'
  | 'pentagon'
  | 'octagon'
  | 'polygon'
  | 'star'
  | 'cross'
  | 'cloud'
  | 'cylinder'
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-double'
  | 'chevron-right'
  | 'chevron-left'
  | 'trapezoid'
  | 'callout'
  | 'brace-left'
  | 'brace-right';

/** Shape category for grouping in the picker UI */
export type ShapeCategory = 'basic' | 'flowchart' | 'arrows' | 'callouts';

/** Shape definition */
export interface ShapeDef {
  type: ShapeType;
  label: string;
  labelKey?: string;
  category: ShapeCategory;
  /** Default width in pixels */
  width: number;
  /** Default height in pixels */
  height: number;
  /** SVG path data for 24x24 icon viewBox */
  iconPath: string;
  /**
   * SVG path generator for arbitrary dimensions.
   * Returns an SVG path string for the given width and height.
   */
  renderPath: (w: number, h: number) => string;
}

/** All 24 unified shape definitions */
export const SHAPES: ShapeDef[] = [
  // ── Basic ──
  {
    type: 'rect',
    label: 'Rectangle',
    labelKey: 'shapes.rectangle',
    category: 'basic',
    width: 120, height: 60,
    iconPath: 'M3 5h18v14H3z',
    renderPath: (w, h) => `M0 0h${w}v${h}H0z`,
  },
  {
    type: 'rounded-rect',
    label: 'Rounded Rectangle',
    labelKey: 'shapes.roundedRectangle',
    category: 'basic',
    width: 120, height: 60,
    iconPath: 'M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z',
    renderPath: (w, h) => {
      const r = Math.min(8, w / 6, h / 6);
      return `M${r} 0h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}H${r}a${r} ${r} 0 0 1-${r}-${r}V${r}a${r} ${r} 0 0 1 ${r}-${r}z`;
    },
  },
  {
    type: 'circle',
    label: 'Circle',
    labelKey: 'shapes.circle',
    category: 'basic',
    width: 70, height: 70,
    iconPath: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
    renderPath: (w, h) => {
      const rx = w / 2;
      const ry = h / 2;
      return `M${rx} 0A${rx} ${ry} 0 1 0 ${rx} ${h}A${rx} ${ry} 0 1 0 ${rx} 0z`;
    },
  },
  {
    type: 'ellipse',
    label: 'Ellipse',
    labelKey: 'shapes.ellipse',
    category: 'basic',
    width: 120, height: 70,
    iconPath: 'M12 6c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6z',
    renderPath: (w, h) => {
      const rx = w / 2;
      const ry = h / 2;
      return `M${rx} 0A${rx} ${ry} 0 1 0 ${rx} ${h}A${rx} ${ry} 0 1 0 ${rx} 0z`;
    },
  },
  {
    type: 'triangle',
    label: 'Triangle',
    labelKey: 'shapes.triangle',
    category: 'basic',
    width: 100, height: 80,
    iconPath: 'M12 4 22 20H2z',
    renderPath: (w, h) => `M${w / 2} 0L${w} ${h}H0z`,
  },
  {
    type: 'diamond',
    label: 'Diamond',
    labelKey: 'shapes.diamond',
    category: 'basic',
    width: 100, height: 80,
    iconPath: 'M12 3 22 12 12 21 2 12z',
    renderPath: (w, h) => `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}z`,
  },

  // ── Flowchart ──
  {
    type: 'parallelogram',
    label: 'Parallelogram',
    labelKey: 'shapes.parallelogram',
    category: 'flowchart',
    width: 130, height: 60,
    iconPath: 'M6 5h15l-3 14H3z',
    renderPath: (w, h) => {
      const offset = w * 0.15;
      return `M${offset} 0H${w}L${w - offset} ${h}H0z`;
    },
  },
  {
    type: 'trapezoid',
    label: 'Trapezoid',
    labelKey: 'shapes.trapezoid',
    category: 'flowchart',
    width: 130, height: 60,
    iconPath: 'M6 5h12l3 14H3z',
    renderPath: (w, h) => {
      const offset = w * 0.15;
      return `M${offset} 0H${w - offset}L${w} ${h}H0z`;
    },
  },
  {
    type: 'stadium',
    label: 'Stadium',
    labelKey: 'shapes.stadium',
    category: 'flowchart',
    width: 130, height: 50,
    iconPath: 'M7 6h10a6 6 0 0 1 0 12H7a6 6 0 0 1 0-12z',
    renderPath: (w, h) => {
      const r = h / 2;
      return `M${r} 0h${w - 2 * r}a${r} ${r} 0 0 1 0 ${h}H${r}a${r} ${r} 0 0 1 0-${h}z`;
    },
  },
  {
    type: 'hexagon',
    label: 'Hexagon',
    labelKey: 'shapes.hexagon',
    category: 'flowchart',
    width: 110, height: 80,
    iconPath: 'M7 3h10l5 9-5 9H7l-5-9z',
    renderPath: (w, h) => {
      const offset = w * 0.2;
      return `M${offset} 0H${w - offset}L${w} ${h / 2}L${w - offset} ${h}H${offset}L0 ${h / 2}z`;
    },
  },
  {
    type: 'pentagon',
    label: 'Pentagon',
    labelKey: 'shapes.pentagon',
    category: 'flowchart',
    width: 100, height: 80,
    iconPath: 'M12 3l9 7-3.5 10h-11L3 10z',
    renderPath: (w, h) => {
      // Regular pentagon vertices
      const cx = w / 2, cy = h * 0.45;
      const r = Math.min(w, h) * 0.48;
      const pts = [0, 1, 2, 3, 4].map((i) => {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        return `${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle) + h * 0.05}`;
      });
      return `M${pts.join('L')}z`;
    },
  },
  {
    type: 'octagon',
    label: 'Octagon',
    labelKey: 'shapes.octagon',
    category: 'flowchart',
    width: 90, height: 90,
    iconPath: 'M8 3h8l5 5v8l-5 5H8l-5-5V8z',
    renderPath: (w, h) => {
      const inset = Math.min(w, h) * 0.3;
      return `M${inset} 0H${w - inset}L${w} ${inset}V${h - inset}L${w - inset} ${h}H${inset}L0 ${h - inset}V${inset}z`;
    },
  },
  {
    type: 'star',
    label: 'Star',
    labelKey: 'shapes.star',
    category: 'flowchart',
    width: 90, height: 90,
    iconPath: 'M12 3l2.8 5.6 6.2.9-4.5 4.4 1.1 6.1L12 17.3 6.4 20l1.1-6.1L3 9.5l6.2-.9z',
    renderPath: (w, h) => {
      const cx = w / 2, cy = h / 2;
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.4;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI * i) / 5 - Math.PI / 2;
        pts.push(`${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)}`);
      }
      return `M${pts.join('L')}z`;
    },
  },
  {
    type: 'cross',
    label: 'Cross',
    labelKey: 'shapes.cross',
    category: 'flowchart',
    width: 80, height: 80,
    iconPath: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
    renderPath: (w, h) => {
      const t = Math.min(w, h) / 3; // arm thickness
      return `M${t} 0h${t}v${t}h${t}v${t}h-${t}v${t}h-${t}v-${t}H0v-${t}h${t}z`;
    },
  },
  {
    type: 'cloud',
    label: 'Cloud',
    labelKey: 'shapes.cloud',
    category: 'flowchart',
    width: 130, height: 80,
    iconPath: 'M6 19a4 4 0 0 1-.5-7.97A7 7 0 0 1 12 5a7 7 0 0 1 6.5 6.03A4 4 0 0 1 18 19z',
    renderPath: (w, h) =>
      `M${w * 0.15} ${h}a${w * 0.15} ${h * 0.2} 0 0 1-${w * 0.02}-${h * 0.35}A${w * 0.3} ${h * 0.35} 0 0 1 ${w * 0.5} ${h * 0.1}a${w * 0.3} ${h * 0.35} 0 0 1 ${w * 0.37} ${h * 0.3}A${w * 0.15} ${h * 0.2} 0 0 1 ${w * 0.85} ${h}z`,
  },
  {
    type: 'cylinder',
    label: 'Cylinder',
    labelKey: 'shapes.cylinder',
    category: 'flowchart',
    width: 80, height: 100,
    iconPath: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3v10c0 1.7-3.6 3-8 3s-8-1.3-8-3z',
    renderPath: (w, h) => {
      const ry = h * 0.12;
      return `M0 ${ry}A${w / 2} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${w / 2} ${ry} 0 0 1 0 ${h - ry}z`;
    },
  },

  // ── Arrows ──
  {
    type: 'arrow-right',
    label: 'Arrow Right',
    labelKey: 'shapes.arrowRight',
    category: 'arrows',
    width: 130, height: 60,
    iconPath: 'M4 9h11V5l6 7-6 7v-4H4z',
    renderPath: (w, h) => {
      const notch = w * 0.3;
      const bar = h * 0.25;
      return `M0 ${bar}H${w - notch}V0L${w} ${h / 2}L${w - notch} ${h}V${h - bar}H0z`;
    },
  },
  {
    type: 'arrow-left',
    label: 'Arrow Left',
    labelKey: 'shapes.arrowLeft',
    category: 'arrows',
    width: 130, height: 60,
    iconPath: 'M20 9H9V5L3 12l6 7v-4h11z',
    renderPath: (w, h) => {
      const notch = w * 0.3;
      const bar = h * 0.25;
      return `M${w} ${bar}H${notch}V0L0 ${h / 2}L${notch} ${h}V${h - bar}H${w}z`;
    },
  },
  {
    type: 'arrow-double',
    label: 'Double Arrow',
    labelKey: 'shapes.doubleArrow',
    category: 'arrows',
    width: 130, height: 60,
    iconPath: 'M7 5l-5 7 5 7v-4h10v4l5-7-5-7v4H7z',
    renderPath: (w, h) => {
      const notch = w * 0.2;
      const bar = h * 0.25;
      return `M${notch} 0L0 ${h / 2}L${notch} ${h}V${h - bar}H${w - notch}V${h}L${w} ${h / 2}L${w - notch} 0V${bar}H${notch}z`;
    },
  },
  {
    type: 'chevron-right',
    label: 'Chevron Right',
    labelKey: 'shapes.chevronRight',
    category: 'arrows',
    width: 120, height: 60,
    iconPath: 'M5 4h10l6 8-6 8H5l6-8z',
    renderPath: (w, h) => {
      const notch = w * 0.25;
      return `M0 0H${w - notch}L${w} ${h / 2}L${w - notch} ${h}H0L${notch} ${h / 2}z`;
    },
  },
  {
    type: 'chevron-left',
    label: 'Chevron Left',
    labelKey: 'shapes.chevronLeft',
    category: 'arrows',
    width: 120, height: 60,
    iconPath: 'M19 4H9L3 12l6 8h10l-6-8z',
    renderPath: (w, h) => {
      const notch = w * 0.25;
      return `M${notch} 0H${w}L${w - notch} ${h / 2}L${w} ${h}H${notch}L0 ${h / 2}z`;
    },
  },

  // ── Callouts ──
  {
    type: 'callout',
    label: 'Callout',
    labelKey: 'shapes.callout',
    category: 'callouts',
    width: 130, height: 80,
    iconPath: 'M4 4h16v12H13l-3 4v-4H4z',
    renderPath: (w, h) => {
      const bodyH = h * 0.75;
      const tailW = w * 0.15;
      const tailX = w * 0.3;
      return `M0 0H${w}V${bodyH}H${tailX + tailW}L${tailX} ${h}V${bodyH}H0z`;
    },
  },
  {
    type: 'brace-left',
    label: 'Left Brace',
    labelKey: 'shapes.leftBrace',
    category: 'callouts',
    width: 40, height: 100,
    iconPath: 'M12 3c-3 0-3 3-3 4.5S4 9 4 12s2 3.5 5 4.5 3 4.5 3 4.5',
    renderPath: (w, h) => {
      const mid = h / 2;
      return `M${w} 0C${w * 0.5} 0 ${w * 0.5} ${mid * 0.3} ${w * 0.5} ${mid * 0.5}S0 ${mid * 0.7} 0 ${mid}S${w * 0.5} ${mid * 1.3} ${w * 0.5} ${mid * 1.5}S${w * 0.5} ${h} ${w} ${h}`;
    },
  },
  {
    type: 'brace-right',
    label: 'Right Brace',
    labelKey: 'shapes.rightBrace',
    category: 'callouts',
    width: 40, height: 100,
    iconPath: 'M12 3c3 0 3 3 3 4.5s5 1.5 5 4.5-2 3.5-5 4.5-3 4.5-3 4.5',
    renderPath: (w, h) => {
      const mid = h / 2;
      return `M0 0C${w * 0.5} 0 ${w * 0.5} ${mid * 0.3} ${w * 0.5} ${mid * 0.5}S${w} ${mid * 0.7} ${w} ${mid}S${w * 0.5} ${mid * 1.3} ${w * 0.5} ${mid * 1.5}S${w * 0.5} ${h} 0 ${h}`;
    },
  },
];

/** Generate a regular polygon SVG path with N sides inscribed in a w×h ellipse. */
export function regularPolygonPath(w: number, h: number, sides: number): string {
  const n = Math.max(3, Math.min(60, Math.round(sides)));
  const cx = w / 2, cy = h / 2;
  const rx = w / 2, ry = h / 2;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    pts.push(`${cx + rx * Math.cos(angle)} ${cy + ry * Math.sin(angle)}`);
  }
  return `M${pts.join('L')}z`;
}

/** Generate a regular star SVG path with N points inscribed in a w×h ellipse. */
export function regularStarPath(w: number, h: number, points: number, innerRatio = 0.4): string {
  const n = Math.max(3, Math.min(60, Math.round(points)));
  const cx = w / 2, cy = h / 2;
  const outerRx = w / 2, outerRy = h / 2;
  const innerRx = outerRx * innerRatio, innerRy = outerRy * innerRatio;
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const isOuter = i % 2 === 0;
    const rx = isOuter ? outerRx : innerRx;
    const ry = isOuter ? outerRy : innerRy;
    const angle = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${cx + rx * Math.cos(angle)} ${cy + ry * Math.sin(angle)}`);
  }
  return `M${pts.join('L')}z`;
}

/** Polygon shape (default 5 sides; use regularPolygonPath for custom sides). */
const POLYGON_SHAPE: ShapeDef = {
  type: 'polygon',
  label: 'Polygon',
  labelKey: 'shapes.polygon',
  category: 'basic',
  width: 100, height: 100,
  iconPath: 'M12 2L21.5 9 18 21H6L2.5 9z',
  renderPath: (w, h) => regularPolygonPath(w, h, 5),
};

/** Lookup map by shape type */
export const SHAPE_MAP = new Map<ShapeType, ShapeDef>(
  [...SHAPES, POLYGON_SHAPE].map((s) => [s.type, s])
);

/** Get shape definition by type */
export function getShape(type: ShapeType): ShapeDef | undefined {
  return SHAPE_MAP.get(type);
}

/** Get all shapes in a category */
export function getShapesByCategory(category: ShapeCategory): ShapeDef[] {
  return SHAPES.filter((s) => s.category === category);
}

/** Category labels for UI */
export const CATEGORY_LABELS: Record<ShapeCategory, { label: string; labelKey: string }> = {
  basic: { label: 'Basic', labelKey: 'shapes.categories.basic' },
  flowchart: { label: 'Flowchart', labelKey: 'shapes.categories.flowchart' },
  arrows: { label: 'Arrows', labelKey: 'shapes.categories.arrows' },
  callouts: { label: 'Callouts', labelKey: 'shapes.categories.callouts' },
};

/** All categories in display order */
export const CATEGORIES: ShapeCategory[] = ['basic', 'flowchart', 'arrows', 'callouts'];
