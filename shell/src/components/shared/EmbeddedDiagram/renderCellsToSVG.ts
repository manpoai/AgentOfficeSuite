// Shared SVG renderer for X6 diagram cells
// Used by diagram-embed-node.ts and PresentationEditor.tsx

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderCellsToSVG(cells: any[]): string {
  if (!cells || cells.length === 0) {
    return '<svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg"><text x="300" y="100" text-anchor="middle" fill="#999" font-size="14">Empty diagram</text></svg>';
  }

  // Find bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const nodes: any[] = [];
  const edges: any[] = [];

  for (const cell of cells) {
    if (cell.shape === 'edge' || cell.shape === 'flowchart-edge' || cell.shape === 'mindmap-edge' || cell.source) {
      edges.push(cell);
    } else if (cell.position) {
      nodes.push(cell);
      const x = cell.position.x;
      const y = cell.position.y;
      const w = cell.size?.width || 120;
      const h = cell.size?.height || 60;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
  }

  if (nodes.length === 0) {
    return '<svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg"><text x="300" y="100" text-anchor="middle" fill="#999" font-size="14">No nodes</text></svg>';
  }

  const padding = 40;
  const vbW = maxX - minX + padding * 2;
  const vbH = maxY - minY + padding * 2;
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;

  let svgContent = '';

  // Build node lookup for edge resolution
  const nodeMap = new Map<string, any>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Draw edges
  for (const edge of edges) {
    const src = typeof edge.source === 'string' ? edge.source : edge.source?.cell;
    const tgt = typeof edge.target === 'string' ? edge.target : edge.target?.cell;
    const srcNode = nodeMap.get(src);
    const tgtNode = nodeMap.get(tgt);
    if (srcNode && tgtNode) {
      const x1 = srcNode.position.x + (srcNode.size?.width || 120) / 2 + offsetX;
      const y1 = srcNode.position.y + (srcNode.size?.height || 60) / 2 + offsetY;
      const x2 = tgtNode.position.x + (tgtNode.size?.width || 120) / 2 + offsetX;
      const y2 = tgtNode.position.y + (tgtNode.size?.height || 60) / 2 + offsetY;
      const strokeColor = edge.attrs?.line?.stroke || '#999';
      svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeColor}" stroke-width="1.5" marker-end="url(#arrowhead)"/>`;
    }
  }

  // Draw nodes
  for (const n of nodes) {
    const x = n.position.x + offsetX;
    const y = n.position.y + offsetY;
    const w = n.size?.width || 120;
    const h = n.size?.height || 60;
    const fill = n.data?.bgColor || n.attrs?.body?.fill || '#fff';
    const stroke = n.data?.borderColor || n.attrs?.body?.stroke || '#333';
    const label = n.data?.label || n.attrs?.label?.text || n.attrs?.text?.text || '';
    const textColor = n.data?.textColor || '#333';
    const fShape = n.data?.flowchartShape || '';

    // Render shape based on flowchartShape type
    if (fShape === 'circle' || fShape === 'ellipse') {
      svgContent += `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    } else if (fShape === 'diamond') {
      svgContent += `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    } else if (fShape === 'parallelogram') {
      const sk = w * 0.15;
      svgContent += `<polygon points="${x + sk},${y} ${x + w},${y} ${x + w - sk},${y + h} ${x},${y + h}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    } else if (fShape === 'hexagon') {
      const sk = w * 0.12;
      svgContent += `<polygon points="${x + sk},${y} ${x + w - sk},${y} ${x + w},${y + h / 2} ${x + w - sk},${y + h} ${x + sk},${y + h} ${x},${y + h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    } else if (fShape === 'rounded-rect') {
      svgContent += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    } else if (fShape === 'cylinder') {
      const ry = Math.min(h * 0.15, 12);
      svgContent += `<ellipse cx="${x + w / 2}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
      svgContent += `<path d="M${x},${y + ry} L${x},${y + h - ry} A${w / 2},${ry} 0 0,0 ${x + w},${y + h - ry} L${x + w},${y + ry}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
      svgContent += `<ellipse cx="${x + w / 2}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
    } else {
      // Default: rect with small border radius
      svgContent += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    }

    if (label) {
      const fontSize = Math.min(12, w / label.length * 1.5);
      svgContent += `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" fill="${textColor}" font-size="${fontSize}" font-family="system-ui, sans-serif">${escapeXml(label)}</text>`;
    }
  }

  return `<svg viewBox="0 0 ${vbW} ${vbH}" width="${vbW}" height="${vbH}" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#999"/></marker></defs>
    ${svgContent}
  </svg>`;
}
