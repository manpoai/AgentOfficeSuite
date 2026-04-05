/**
 * Shared shape definitions — re-exports from the canonical ShapeSet.
 *
 * The canonical shape catalog lives in components/shared/ShapeSet/shapes.ts
 * with full renderPath support. This module re-exports and adds backward-
 * compatible aliases for consumers that use the old ShapeId/ShapeDefinition types.
 *
 * Diagram and Presentation editors should migrate to importing directly
 * from '@/components/shared/ShapeSet/shapes' over time.
 */

export {
  SHAPES,
  SHAPE_MAP,
  getShape,
  getShapesByCategory,
  CATEGORIES,
  CATEGORY_LABELS,
  type ShapeType,
  type ShapeCategory,
  type ShapeDef,
} from '@/components/shared/ShapeSet/shapes';

// Backward-compatible aliases
export type ShapeId = import('@/components/shared/ShapeSet/shapes').ShapeType;
export type ShapeDefinition = import('@/components/shared/ShapeSet/shapes').ShapeDef;

import { SHAPES as _SHAPES } from '@/components/shared/ShapeSet/shapes';

/** Get shapes by category (alias) */
export function getShapeDimensions(id: string): { width: number; height: number } {
  const shape = _SHAPES.find((s) => s.type === id);
  return shape
    ? { width: shape.width, height: shape.height }
    : { width: 120, height: 60 };
}
