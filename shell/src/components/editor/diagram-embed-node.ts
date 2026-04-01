/**
 * Diagram Embed node for ProseMirror editor.
 * Block node that renders a live preview of an ASuite diagram.
 */
import type { Node as PMNode, NodeSpec } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import DOMPurify from 'dompurify';
import { renderCellsToSVG, escapeXml } from '@/components/shared/EmbeddedDiagram/renderCellsToSVG';

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
