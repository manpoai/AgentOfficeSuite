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
    if (cell.shape === 'edge' || cell.shape === 'mindmap-edge' || cell.source) {
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
    const fill = n.attrs?.body?.fill || '#fff';
    const stroke = n.attrs?.body?.stroke || '#333';
    const label = n.attrs?.label?.text || n.attrs?.text?.text || '';
    const rx = n.shape?.includes('circle') || n.shape?.includes('ellipse') ? Math.min(w, h) / 2 : 6;

    svgContent += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    if (label) {
      const fontSize = Math.min(12, w / label.length * 1.5);
      svgContent += `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" fill="#333" font-size="${fontSize}" font-family="system-ui, sans-serif">${escapeXml(label)}</text>`;
    }
  }

  return `<svg viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#999"/></marker></defs>
    ${svgContent}
  </svg>`;
}
