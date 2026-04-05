/**
 * FabricShape — Adapter for rendering ShapeSet shapes as Fabric.js objects.
 *
 * Used in the Presentation editor to create Fabric.js custom objects
 * from the unified shape definitions.
 *
 * Creates a Fabric.js Path object from the shape's renderPath function.
 */

import type { ShapeType } from '../shapes';
import { SHAPE_MAP } from '../shapes';

interface FabricShapeOptions {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * Creates a Fabric.js Path object for a given shape type.
 * Requires the Fabric.js library to be loaded.
 *
 * @param fabric - The Fabric.js module
 * @param shapeType - The shape type from ShapeSet
 * @param options - Position and styling options
 * @returns A Fabric.js Path object, or null if shape type is unknown
 */
export function createFabricShape(
  fabric: any,
  shapeType: ShapeType,
  options: FabricShapeOptions = {}
): any | null {
  const shapeDef = SHAPE_MAP.get(shapeType);
  if (!shapeDef) return null;

  const {
    left = 100,
    top = 100,
    width = shapeDef.width,
    height = shapeDef.height,
    fill = '#ffffff',
    stroke = '#374151',
    strokeWidth = 2,
  } = options;

  const pathData = shapeDef.renderPath(width, height);

  // For basic shapes, use native Fabric.js objects for better editing
  if (shapeType === 'rect') {
    return new fabric.Rect({
      left, top, width, height,
      fill, stroke, strokeWidth,
      rx: 0, ry: 0,
    });
  }
  if (shapeType === 'rounded-rect') {
    const r = Math.min(8, width / 6, height / 6);
    return new fabric.Rect({
      left, top, width, height,
      fill, stroke, strokeWidth,
      rx: r, ry: r,
    });
  }
  if (shapeType === 'circle') {
    return new fabric.Circle({
      left, top,
      radius: Math.min(width, height) / 2,
      fill, stroke, strokeWidth,
    });
  }
  if (shapeType === 'ellipse') {
    return new fabric.Ellipse({
      left, top,
      rx: width / 2,
      ry: height / 2,
      fill, stroke, strokeWidth,
    });
  }
  if (shapeType === 'triangle') {
    return new fabric.Triangle({
      left, top, width, height,
      fill, stroke, strokeWidth,
    });
  }

  // For complex shapes, use Path
  const path = new fabric.Path(pathData, {
    left, top,
    fill, stroke, strokeWidth,
    originX: 'left',
    originY: 'top',
  });

  // Store shape type for serialization/deserialization
  (path as any).__shapeType = shapeType;

  return path;
}

/**
 * Gets the ShapeType stored in a Fabric.js object, if any.
 */
export function getFabricShapeType(obj: any): ShapeType | null {
  return (obj as any)?.__shapeType || null;
}
