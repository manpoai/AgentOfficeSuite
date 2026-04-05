/**
 * FabricEmbed — Fabric.js adapter for embedding diagram previews in PPT.
 *
 * Creates a Fabric.js Group object that shows a static preview of a diagram.
 * The preview is rendered as a simple visual representation (placeholder +
 * label) since Fabric.js cannot render SVG viewports directly.
 *
 * Double-clicking the embed opens the diagram in the full editor.
 */

import type { DiagramData } from '../DiagramPreview';

interface FabricEmbedOptions {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/**
 * Creates a Fabric.js Group representing an embedded diagram.
 *
 * The group contains:
 * - A background rect with border
 * - Simple node rectangles from the diagram data (scaled to fit)
 * - A label showing "Diagram"
 *
 * @param fabric - The Fabric.js module
 * @param diagramId - The diagram content ID
 * @param data - The diagram data (nodes and edges)
 * @param options - Position and size options
 */
export function createFabricDiagramEmbed(
  fabric: any,
  diagramId: string,
  data: DiagramData | null,
  options: FabricEmbedOptions = {},
): any {
  const {
    left = 100,
    top = 100,
    width = 400,
    height = 300,
  } = options;

  const objects: any[] = [];

  // Background
  const bg = new fabric.Rect({
    width,
    height,
    rx: 8,
    ry: 8,
    fill: '#f8fafc',
    stroke: '#e2e8f0',
    strokeWidth: 1,
    originX: 'center',
    originY: 'center',
  });
  objects.push(bg);

  if (data && data.nodes.length > 0) {
    // Calculate bounding box of diagram nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of data.nodes) {
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      const nw = n.width ?? 120;
      const nh = n.height ?? 60;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxX = Math.max(maxX, nx + nw);
      maxY = Math.max(maxY, ny + nh);
    }

    const dw = maxX - minX || 1;
    const dh = maxY - minY || 1;
    const padding = 40;
    const scale = Math.min(
      (width - padding * 2) / dw,
      (height - padding * 2) / dh,
      1,
    );

    // Render simplified node rectangles
    for (const n of data.nodes) {
      const nx = ((n.x ?? 0) - minX) * scale - (dw * scale) / 2;
      const ny = ((n.y ?? 0) - minY) * scale - (dh * scale) / 2;
      const nw = (n.width ?? 120) * scale;
      const nh = (n.height ?? 60) * scale;

      const fill = n.data?.backgroundColor || n.attrs?.body?.fill || '#ffffff';
      const stroke = n.data?.color || n.attrs?.body?.stroke || '#374151';

      const rect = new fabric.Rect({
        left: nx,
        top: ny,
        width: nw,
        height: nh,
        rx: 3,
        ry: 3,
        fill,
        stroke,
        strokeWidth: 1,
        originX: 'center',
        originY: 'center',
      });
      objects.push(rect);
    }
  } else {
    // Empty diagram placeholder
    const icon = new fabric.Text('◇', {
      fontSize: 32,
      fill: '#94a3b8',
      originX: 'center',
      originY: 'center',
      top: -20,
    });
    objects.push(icon);

    const label = new fabric.Text('Empty Diagram', {
      fontSize: 12,
      fill: '#94a3b8',
      originX: 'center',
      originY: 'center',
      top: 15,
    });
    objects.push(label);
  }

  // "Diagram" badge at bottom
  const badge = new fabric.Text('◇ Diagram', {
    fontSize: 10,
    fill: '#64748b',
    originX: 'center',
    originY: 'center',
    top: height / 2 - 12,
  });
  objects.push(badge);

  const group = new fabric.Group(objects, {
    left,
    top,
    hasControls: true,
    hasBorders: true,
    lockRotation: true,
  });

  // Store metadata for serialization and interaction
  (group as any).__embeddedDiagram = {
    diagramId,
    hasData: !!(data && data.nodes.length > 0),
  };

  return group;
}

/**
 * Gets the embedded diagram metadata from a Fabric.js object.
 */
export function getFabricDiagramEmbed(obj: any): { diagramId: string; hasData: boolean } | null {
  return (obj as any)?.__embeddedDiagram || null;
}
