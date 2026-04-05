'use client';

/**
 * ShapePicker — Shape selection panel for inserting shapes.
 *
 * Used in both Diagram and Presentation editors to pick a shape
 * to insert. Displays shapes grouped by category with SVG previews.
 *
 * Can be used as:
 * - A dropdown panel (hover to expand)
 * - An inline panel in a toolbar
 */

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  SHAPES,
  CATEGORIES,
  CATEGORY_LABELS,
  getShapesByCategory,
  type ShapeType,
  type ShapeDef,
} from './shapes';

interface ShapePickerProps {
  /** Called when a shape is selected */
  onSelect: (shapeType: ShapeType) => void;
  /** Currently selected shape type */
  selectedShape?: ShapeType;
  /** Additional CSS class */
  className?: string;
  /** Whether to show category headers */
  showCategories?: boolean;
  /** Limit to specific categories */
  categories?: ('basic' | 'flowchart' | 'arrows' | 'callouts')[];
  /** Number of columns in the grid */
  columns?: number;
  /** Whether shape buttons are draggable */
  draggable?: boolean;
  /** Called when a shape button drag starts */
  onDragStart?: (shapeType: ShapeType, e: React.DragEvent) => void;
}

export function ShapePicker({
  onSelect,
  selectedShape,
  className,
  showCategories = true,
  categories,
  columns = 6,
  draggable,
  onDragStart,
}: ShapePickerProps) {
  const displayCategories = categories || CATEGORIES;

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg shadow-xl p-2 min-w-[240px]',
        className
      )}
    >
      {displayCategories.map((cat) => {
        const shapes = getShapesByCategory(cat);
        if (shapes.length === 0) return null;

        return (
          <div key={cat} className="mb-2 last:mb-0">
            {showCategories && (
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1">
                {CATEGORY_LABELS[cat]}
              </div>
            )}
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
            >
              {shapes.map((shape) => (
                <ShapeButton
                  key={shape.type}
                  shape={shape}
                  selected={selectedShape === shape.type}
                  onClick={() => onSelect(shape.type)}
                  draggable={draggable}
                  onDragStart={onDragStart ? (e) => onDragStart(shape.type, e) : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ShapeButton({
  shape,
  selected,
  onClick,
  draggable: isDraggable,
  onDragStart,
}: {
  shape: ShapeDef;
  selected: boolean;
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title={shape.label}
      draggable={isDraggable}
      onDragStart={onDragStart}
      className={cn(
        'w-9 h-9 flex items-center justify-center rounded transition-colors',
        selected
          ? 'bg-sidebar-primary/10 text-sidebar-primary ring-1 ring-sidebar-primary/30'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d={shape.iconPath} />
      </svg>
    </button>
  );
}

/**
 * ShapeRenderer — Renders a shape at arbitrary dimensions.
 * Used for thumbnails, previews, and canvas rendering.
 */
export function ShapeRenderer({
  shape,
  width,
  height,
  fill = 'none',
  stroke = 'currentColor',
  strokeWidth = 1.5,
  className,
}: {
  shape: ShapeDef;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  className?: string;
}) {
  const path = shape.renderPath(width, height);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
}

// Re-export shape types and utilities
export { SHAPES, SHAPE_MAP, getShape, getShapesByCategory, CATEGORIES, CATEGORY_LABELS } from './shapes';
export type { ShapeType, ShapeDef, ShapeCategory } from './shapes';
