/**
 * X6Shape — Adapter for rendering ShapeSet shapes as X6 custom nodes.
 *
 * Used in the Diagram editor to register unified shape definitions
 * as X6 custom node types.
 *
 * The existing diagram editor uses FlowchartNode.tsx (React component)
 * for node rendering. This adapter provides the shape path data and
 * metadata that FlowchartNode uses to render the correct shape.
 */

import type { ShapeType } from '../shapes';
import { SHAPE_MAP, SHAPES } from '../shapes';

/**
 * Gets the SVG path and metadata for an X6 node shape.
 * FlowchartNode.tsx uses this data to render the shape.
 */
export function getX6ShapeData(shapeType: ShapeType) {
  const shapeDef = SHAPE_MAP.get(shapeType);
  if (!shapeDef) return null;

  return {
    type: shapeDef.type,
    label: shapeDef.label,
    width: shapeDef.width,
    height: shapeDef.height,
    iconPath: shapeDef.iconPath,
    renderPath: shapeDef.renderPath,
  };
}

/**
 * Gets all available shape types for the X6 shape picker toolbar.
 * Returns shape types grouped by category.
 */
export function getX6ShapeOptions() {
  const groups: Record<string, { type: ShapeType; label: string; iconPath: string }[]> = {};

  SHAPES.forEach((shape) => {
    if (!groups[shape.category]) groups[shape.category] = [];
    groups[shape.category].push({
      type: shape.type,
      label: shape.label,
      iconPath: shape.iconPath,
    });
  });

  return groups;
}

/**
 * Maps the ShapeSet type names to X6 node registration names.
 * The diagram editor registers nodes as 'flowchart-{shapeType}'.
 */
export function getX6NodeName(shapeType: ShapeType): string {
  return `flowchart-${shapeType}`;
}

/**
 * Extracts the ShapeType from an X6 node shape name.
 */
export function parseX6NodeName(nodeName: string): ShapeType | null {
  if (!nodeName.startsWith('flowchart-')) return null;
  const type = nodeName.replace('flowchart-', '') as ShapeType;
  return SHAPE_MAP.has(type) ? type : null;
}

/**
 * Gets default node size for a shape type.
 * Used when creating new nodes in the diagram.
 */
export function getDefaultNodeSize(shapeType: ShapeType): { width: number; height: number } {
  const shapeDef = SHAPE_MAP.get(shapeType);
  return shapeDef
    ? { width: shapeDef.width, height: shapeDef.height }
    : { width: 120, height: 60 };
}
