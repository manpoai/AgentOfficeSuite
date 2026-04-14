/**
 * Content Link node for ProseMirror editor.
 *
 * Adds a `content_link` inline node that renders as a styled chip
 * linking to an internal AOSE content item (doc, table, diagram, etc.).
 *
 * Usage:
 * - Slash command `/link` opens a picker (inserted via slash-menu integration)
 * - Pasted URLs matching `/content?id=<type>:<id>` are auto-converted
 * - In markdown, represented as `[title](/content?id=type:id)`
 */
import type { Node as PMNode, NodeSpec } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { getT } from '@/lib/i18n';
import { Plugin, PluginKey } from 'prosemirror-state';
import { getContentItem } from '@/lib/api/gateway';

// ── Node Spec ──

export const contentLinkNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  attrs: {
    contentId: { default: '' },   // e.g. "doc:abc123"
    title: { default: '' },
  },
  parseDOM: [{
    tag: 'span.content-link-node',
    getAttrs(dom) {
      const el = dom as HTMLElement;
      return {
        contentId: el.getAttribute('data-content-id') || '',
        title: el.textContent || '',
      };
    },
  }],
  toDOM(node: PMNode) {
    return ['span', {
      class: 'content-link-node',
      'data-content-id': node.attrs.contentId,
      title: `Link to ${node.attrs.contentId}`,
    }, node.attrs.title || node.attrs.contentId];
  },
};

// ── NodeView ──

const TYPE_LABELS: Record<string, string> = {
  doc: 'Doc',
  table: 'Table',
  presentation: 'Slides',
  diagram: 'Diagram',
};

const TYPE_ICONS: Record<string, string> = {
  doc: '\u{1F4C4}',           // page
  table: '\u{1F5C2}',         // card index dividers
  presentation: '\u{1F4CA}',  // bar chart
  diagram: '\u{1F500}',       // shuffle (flow)
};

function getContentType(id: string): string {
  const i = id.indexOf(':');
  return i > 0 ? id.substring(0, i) : 'doc';
}

export class ContentLinkView implements NodeView {
  dom: HTMLElement;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    const type = getContentType(node.attrs.contentId);
    const icon = TYPE_ICONS[type] || TYPE_ICONS.doc;
    const label = node.attrs.title || TYPE_LABELS[type] || getT()('content.link');

    this.dom = document.createElement('span');
    this.dom.className = 'content-link-node';
    this.dom.setAttribute('data-content-id', node.attrs.contentId);
    this.dom.style.cssText = `
      display: inline-flex; align-items: center; gap: 3px;
      padding: 1px 6px; border-radius: 4px;
      background: hsl(var(--muted, 210 40% 96.1%));
      font-size: 0.875em; cursor: pointer;
      border: 1px solid transparent;
      transition: border-color 0.15s, box-shadow 0.15s;
    `;
    this.dom.innerHTML = `<span style="font-size:0.85em">${icon}</span><span>${this.escapeHtml(label)}</span>`;

    this.dom.addEventListener('mouseenter', () => {
      this.dom.style.borderColor = 'hsl(var(--border, 0 0% 90%))';
      this.dom.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
    });
    this.dom.addEventListener('mouseleave', () => {
      this.dom.style.borderColor = 'transparent';
      this.dom.style.boxShadow = 'none';
    });
    this.dom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = this.node.attrs.contentId;
      if (id) {
        const url = `/content?id=${encodeURIComponent(id)}`;
        window.open(url, '_blank');
      }
    });
  }

  private escapeHtml(s: string): string {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  stopEvent() { return true; }
  ignoreMutation() { return true; }

  update(node: PMNode) {
    if (node.type.name !== 'content_link') return false;
    this.node = node;
    // Update DOM when title changes (e.g. after async title resolution)
    const type = getContentType(node.attrs.contentId);
    const icon = TYPE_ICONS[type] || TYPE_ICONS.doc;
    const label = node.attrs.title || TYPE_LABELS[type] || getT()('content.link');
    this.dom.innerHTML = `<span style="font-size:0.85em">${icon}</span><span>${this.escapeHtml(label)}</span>`;
    return true;
  }
}

// ── Paste Link Plugin ──
// Detects pasted URLs matching /content?id=<type>:<id> and converts to content_link nodes

export const contentLinkPasteKey = new PluginKey('contentLinkPaste');

const CONTENT_LINK_RE = /(?:https?:\/\/[^/]+)?\/content\?id=((?:doc|table|presentation|diagram)(?::|%3A)([a-zA-Z0-9_-]+))/i;

export function contentLinkPastePlugin(): Plugin {
  return new Plugin({
    key: contentLinkPasteKey,
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain')?.trim();
        if (!text) return false;

        const match = text.match(CONTENT_LINK_RE);
        if (!match) return false;

        // Normalize: decode %3A to colon
        const contentId = decodeURIComponent(match[1]);
        const contentLinkType = view.state.schema.nodes.content_link;
        if (!contentLinkType) return false;

        const node = contentLinkType.create({
          contentId,
          title: contentId, // Placeholder — will be resolved below
        });
        const { from, to } = view.state.selection;
        const tr = view.state.tr.replaceWith(from, to, node);
        view.dispatch(tr);

        // Async: fetch real title and update the node
        getContentItem(contentId).then((item) => {
          if (!item?.title) return;
          // Find the content_link node we just inserted
          const { doc } = view.state;
          doc.descendants((n, pos) => {
            if (n.type.name === 'content_link' && n.attrs.contentId === contentId && n.attrs.title === contentId) {
              const updateTr = view.state.tr.setNodeMarkup(pos, undefined, {
                ...n.attrs,
                title: item.title,
              });
              view.dispatch(updateTr);
              return false; // stop after first match
            }
            return true;
          });
        }).catch(() => {
          // Ignore — placeholder title remains
        });

        return true;
      },
    },
  });
}
