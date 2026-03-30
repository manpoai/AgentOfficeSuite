/**
 * Diagram Embed node for ProseMirror editor.
 * Block node that renders a live preview of an ASuite diagram.
 */
import type { Node as PMNode, NodeSpec } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import DOMPurify from 'dompurify';

export const diagramEmbedNodeSpec: NodeSpec = {
  group: 'block',
  atom: true,
  attrs: {
    diagramId: { default: '' },
    title: { default: 'Untitled Diagram' },
  },
  parseDOM: [{
    tag: 'div.diagram-embed-node',
    getAttrs(dom) {
      const el = dom as HTMLElement;
      return {
        diagramId: el.getAttribute('data-diagram-id') || '',
        title: el.getAttribute('data-title') || 'Untitled Diagram',
      };
    },
  }],
  toDOM(node: PMNode) {
    return ['div', {
      class: 'diagram-embed-node',
      'data-diagram-id': node.attrs.diagramId,
      'data-title': node.attrs.title,
    }, node.attrs.title || 'Diagram'];
  },
};

// Simple SVG renderer for X6 cell data
function renderCellsToSVG(cells: any[]): string {
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

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class DiagramEmbedView implements NodeView {
  dom: HTMLElement;
  private loading = false;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('div');
    this.dom.className = 'diagram-embed-node';
    this.dom.setAttribute('data-diagram-id', node.attrs.diagramId);
    this.dom.contentEditable = 'false';
    this.dom.style.cssText = `
      position: relative; width: 100%; min-height: 200px;
      border: 1px solid hsl(var(--border, 0 0% 90%));
      border-radius: 8px; overflow: hidden; cursor: pointer;
      margin: 12px 0; background: hsl(var(--card, 0 0% 100%));
      transition: border-color 0.15s, box-shadow 0.15s;
    `;

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      padding: 8px 12px; font-size: 13px; font-weight: 500;
      color: hsl(var(--muted-foreground, 0 0% 45%));
      border-bottom: 1px solid hsl(var(--border, 0 0% 90%));
      display: flex; align-items: center; gap: 6px;
    `;
    titleBar.innerHTML = `<span style="font-size: 14px">\u{1F500}</span><span>${escapeXml(node.attrs.title || 'Diagram')}</span>`;
    this.dom.appendChild(titleBar);

    // SVG container
    const svgContainer = document.createElement('div');
    svgContainer.className = 'diagram-embed-preview';
    svgContainer.style.cssText = 'padding: 16px; min-height: 160px; display: flex; align-items: center; justify-content: center;';
    svgContainer.innerHTML = '<span style="color: hsl(var(--muted-foreground)); font-size: 13px;">Loading diagram...</span>';
    this.dom.appendChild(svgContainer);

    // Hover overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.04); opacity: 0; transition: opacity 0.15s;
      pointer-events: none; border-radius: 8px;
    `;
    overlay.innerHTML = '<span style="padding: 6px 14px; background: hsl(var(--primary, 142 71% 45%)); color: white; border-radius: 6px; font-size: 13px; font-weight: 500;">Click to edit</span>';
    this.dom.appendChild(overlay);

    this.dom.addEventListener('mouseenter', () => {
      overlay.style.opacity = '1';
      this.dom.style.borderColor = 'hsl(var(--primary, 142 71% 45%))';
      this.dom.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
    });
    this.dom.addEventListener('mouseleave', () => {
      overlay.style.opacity = '0';
      this.dom.style.borderColor = 'hsl(var(--border, 0 0% 90%))';
      this.dom.style.boxShadow = 'none';
    });
    this.dom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (node.attrs.diagramId) {
        window.location.href = `/content?id=diagram:${encodeURIComponent(node.attrs.diagramId)}`;
      }
    });

    // Fetch diagram data
    this.loadDiagram(svgContainer);
  }

  private async loadDiagram(container: HTMLElement) {
    if (this.loading || !this.node.attrs.diagramId) return;
    this.loading = true;
    try {
      const res = await fetch(`/api/gateway/diagrams/${this.node.attrs.diagramId}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const cells = data.data?.cells || data.data?.nodes || [];
      container.innerHTML = DOMPurify.sanitize(renderCellsToSVG(cells), { USE_PROFILES: { svg: true, svgFilters: true } });
      // Scale SVG to fit container
      const svg = container.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.maxHeight = '300px';
      }
    } catch {
      container.innerHTML = '<span style="color: hsl(var(--destructive, 0 72% 51%)); font-size: 13px;">Failed to load diagram</span>';
    }
    this.loading = false;
  }

  stopEvent() { return true; }
  ignoreMutation() { return true; }

  update(node: PMNode) {
    if (node.type.name !== 'diagram_embed') return false;
    return true;
  }
}
