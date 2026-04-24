import type { CanvasElement } from './types';
import type { ProjectedProps } from './projection';
import { projectElement, applyProjection } from './projection';

// ── AggregatedProps ───────────────────────────────────────────────────────────
// Properties that may be 'mixed' when multiple elements have different values.

export interface AggregatedProps {
  backgroundColor?: string | 'mixed';
  svgFill?: string | 'mixed';
  color?: string | 'mixed';
  fontSize?: number | 'mixed';
  fontFamily?: string | 'mixed';
  fontWeight?: string | 'mixed';
  textAlign?: string | 'mixed';
  lineHeight?: number | 'mixed';
  letterSpacing?: number | 'mixed';
  textDecoration?: string | 'mixed';
  borderRadius?: number | 'mixed';
  opacity?: number | 'mixed';
}

// ── flattenToLeaves ───────────────────────────────────────────────────────────
// Recursively flatten group elements to their leaf (non-group) children.
// If an element has no type or is not a group, it's a leaf.

export function flattenToLeaves(elements: CanvasElement[]): CanvasElement[] {
  const leaves: CanvasElement[] = [];
  for (const el of elements) {
    const asAny = el as any;
    if (asAny.type === 'group' && Array.isArray(asAny.children) && asAny.children.length > 0) {
      leaves.push(...flattenToLeaves(asAny.children as CanvasElement[]));
    } else {
      leaves.push(el);
    }
  }
  return leaves.length > 0 ? leaves : elements;
}

// ── computePropertyUnion ──────────────────────────────────────────────────────
// Determine which property categories are supported by the given leaf elements.

export interface PropertyUnion {
  fill: boolean;
  font: boolean;
}

export function computePropertyUnion(leaves: CanvasElement[]): PropertyUnion {
  const hasFill = leaves.some(el => {
    const isSvg = el.html.includes('<svg');
    const p = projectElement(el.html);
    return isSvg ? (p.svgFill !== undefined) : (p.backgroundColor !== undefined);
  });

  const hasFont = leaves.some(el => {
    if (el.html.includes('<svg')) return false;
    const p = projectElement(el.html);
    return p.color !== undefined || p.fontSize !== undefined;
  });

  return { fill: hasFill, font: hasFont };
}

// ── aggregateProps ────────────────────────────────────────────────────────────
// Compute aggregated (possibly 'mixed') values across all leaf elements.

function agg<T>(values: (T | undefined)[]): T | 'mixed' | undefined {
  const defined = values.filter((v): v is T => v !== undefined);
  if (defined.length === 0) return undefined;
  const first = defined[0];
  const allSame = defined.every(v => v === first);
  return allSame ? first : 'mixed';
}

export function aggregateProps(leaves: CanvasElement[]): AggregatedProps {
  if (leaves.length === 0) return {};

  const projected = leaves.map(el => projectElement(el.html));

  return {
    backgroundColor: agg(projected.map(p => p.backgroundColor)),
    svgFill: agg(projected.map(p => p.svgFill)),
    color: agg(projected.map(p => p.color)),
    fontSize: agg(projected.map(p => p.fontSize)),
    fontFamily: agg(projected.map(p => p.fontFamily)),
    fontWeight: agg(projected.map(p => p.fontWeight)),
    textAlign: agg(projected.map(p => p.textAlign)),
    lineHeight: agg(projected.map(p => p.lineHeight)),
    letterSpacing: agg(projected.map(p => p.letterSpacing)),
    textDecoration: agg(projected.map(p => p.textDecoration)),
    borderRadius: agg(projected.map(p => p.borderRadius)),
    opacity: agg(projected.map(p => p.opacity)),
  };
}

// ── applyToLeaves ─────────────────────────────────────────────────────────────
// Apply ProjectedProps changes to a list of elements, recursing into groups.
// Returns a new array with updated elements (or the original if nothing changed).

export function applyToLeaves(
  elements: CanvasElement[],
  changes: Partial<ProjectedProps>,
): CanvasElement[] {
  return elements.map(el => {
    const asAny = el as any;
    if (asAny.type === 'group' && Array.isArray(asAny.children)) {
      const updatedChildren = applyToLeaves(asAny.children as CanvasElement[], changes);
      if (updatedChildren === asAny.children) return el;
      return { ...el, children: updatedChildren } as CanvasElement;
    }
    const newHtml = applyProjection(el.html, changes);
    if (newHtml === el.html) return el;
    return { ...el, html: newHtml };
  });
}
