/**
 * ProseMirrorEmbed — ProseMirror node for embedding diagrams in documents.
 *
 * Defines a block-level node that renders an EmbeddedDiagram preview.
 * The node stores the diagram content ID and renders as a static preview
 * that can be double-clicked to open the full editor.
 */

import type { NodeSpec, Node as PmNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

/**
 * ProseMirror NodeSpec for embedded-diagram.
 * Usage: add to schema nodes as `embedded_diagram: embeddedDiagramNodeSpec`
 */
export const embeddedDiagramNodeSpec: NodeSpec = {
  group: 'block',
  atom: true,
  draggable: true,
  attrs: {
    diagramId: { default: '' },
    width: { default: 600 },
    height: { default: 400 },
  },
  toDOM(node: PmNode) {
    return [
      'div',
      {
        class: 'embedded-diagram-block',
        'data-diagram-id': node.attrs.diagramId,
        'data-width': String(node.attrs.width),
        'data-height': String(node.attrs.height),
      },
    ];
  },
  parseDOM: [
    {
      tag: 'div.embedded-diagram-block',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          diagramId: el.getAttribute('data-diagram-id') || '',
          width: parseInt(el.getAttribute('data-width') || '600', 10),
          height: parseInt(el.getAttribute('data-height') || '400', 10),
        };
      },
    },
  ],
};

/**
 * NodeView for rendering embedded-diagram as a React-managed container.
 *
 * Creates a container div that the parent React component can use
 * to mount the EmbeddedDiagram component via a portal or ref.
 */
export class EmbeddedDiagramNodeView implements NodeView {
  dom: HTMLElement;
  private container: HTMLElement;

  constructor(
    private node: PmNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'embedded-diagram-wrapper my-4';
    this.dom.contentEditable = 'false';

    this.container = document.createElement('div');
    this.container.className = 'embedded-diagram-mount';
    this.container.dataset.diagramId = node.attrs.diagramId;
    this.container.dataset.width = String(node.attrs.width);
    this.container.dataset.height = String(node.attrs.height);
    this.container.style.width = `${node.attrs.width}px`;
    this.container.style.height = `${node.attrs.height}px`;
    this.container.style.border = '1px solid var(--border)';
    this.container.style.borderRadius = '8px';
    this.container.style.overflow = 'hidden';
    this.container.style.background = 'var(--muted)';
    this.container.style.display = 'flex';
    this.container.style.alignItems = 'center';
    this.container.style.justifyContent = 'center';
    this.container.style.cursor = 'pointer';
    // Build DOM safely to avoid XSS from diagramId
    const inner = document.createElement('div');
    inner.style.cssText = 'text-align:center;color:var(--muted-foreground)';
    const icon = document.createElement('div');
    icon.style.fontSize = '24px';
    icon.textContent = '◇';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:12px;margin-top:4px';
    label.textContent = `Diagram: ${node.attrs.diagramId}`;
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;margin-top:2px';
    hint.textContent = 'Double-click to open';
    inner.append(icon, label, hint);
    this.container.appendChild(inner);

    this.container.addEventListener('dblclick', () => {
      const id = this.node.attrs.diagramId;
      if (id) {
        const url = `/content?id=${encodeURIComponent(id)}`;
        // Use pushState for SPA navigation instead of full page reload
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });

    this.dom.appendChild(this.container);
  }

  update(node: PmNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.container.dataset.diagramId = node.attrs.diagramId;
    this.container.dataset.width = String(node.attrs.width);
    this.container.dataset.height = String(node.attrs.height);
    this.container.style.width = `${node.attrs.width}px`;
    this.container.style.height = `${node.attrs.height}px`;
    return true;
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}
