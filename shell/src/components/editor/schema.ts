/**
 * ProseMirror schema for the document editor.
 * Based on Outline's editor schema — compatible with Outline's markdown format.
 */
import { Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';
import { contentLinkNodeSpec } from './content-link-node';
import { diagramEmbedNodeSpec } from './diagram-embed-node';

const tNodes = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+',
  cellAttributes: {
    alignment: {
      default: null,
      getFromDOM(dom: HTMLElement) {
        return dom.style.textAlign || null;
      },
      setDOMAttr(value: unknown, attrs: Record<string, unknown>) {
        if (value) {
          attrs.style = ((attrs.style as string) || '') + `text-align: ${value};`;
        }
      },
    },
    background: {
      default: null,
      getFromDOM(dom: HTMLElement) {
        return dom.style.backgroundColor || null;
      },
      setDOMAttr(value: unknown, attrs: Record<string, unknown>) {
        if (value) {
          attrs.style = ((attrs.style as string) || '') + `background-color: ${value};`;
        }
      },
    },
  },
});

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM() { return ['p', 0]; },
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({
        tag: `h${level}`,
        attrs: { level },
      })),
      toDOM(node) { return [`h${node.attrs.level}`, 0]; },
    },
    blockquote: {
      content: 'block+',
      group: 'block',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM() { return ['blockquote', 0]; },
    },
    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM() { return ['hr']; },
    },
    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      attrs: { language: { default: '' } },
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' as const, getAttrs(dom) {
        const code = (dom as HTMLElement).querySelector('code');
        const cls = code?.className?.match(/language-(\w+)/);
        return { language: cls ? cls[1] : '' };
      }}],
      toDOM(node) {
        return ['pre', ['code', { class: node.attrs.language ? `language-${node.attrs.language}` : '' }, 0]];
      },
    },
    bullet_list: {
      content: 'list_item+',
      group: 'block',
      parseDOM: [{ tag: 'ul' }],
      toDOM() { return ['ul', 0]; },
    },
    ordered_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { order: { default: 1 } },
      parseDOM: [{ tag: 'ol', getAttrs(dom) {
        return { order: (dom as HTMLElement).hasAttribute('start') ? +(dom as HTMLElement).getAttribute('start')! : 1 };
      }}],
      toDOM(node) {
        return node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0];
      },
    },
    list_item: {
      content: '(paragraph | heading) block*',
      parseDOM: [{ tag: 'li' }],
      toDOM() { return ['li', 0]; },
      defining: true,
    },
    checkbox_list: {
      content: 'checkbox_item+',
      group: 'block',
      parseDOM: [{ tag: 'ul.checkbox-list' }],
      toDOM() { return ['ul', { class: 'checkbox-list' }, 0]; },
    },
    checkbox_item: {
      content: '(paragraph | heading) block*',
      attrs: { checked: { default: false } },
      defining: true,
      parseDOM: [{ tag: 'li.checkbox-item', getAttrs(dom) {
        return { checked: (dom as HTMLElement).dataset.checked === 'true' };
      }}],
      toDOM(node) {
        return ['li', { class: 'checkbox-item', 'data-checked': node.attrs.checked ? 'true' : 'false' }, 0];
      },
    },
    container_notice: {
      content: 'block+',
      group: 'block',
      defining: true,
      attrs: { style: { default: 'info' } }, // info, warning, success, tip
      parseDOM: [{ tag: 'div.notice-block', getAttrs(dom) {
        return { style: (dom as HTMLElement).dataset.style || 'info' };
      }}],
      toDOM(node) {
        return ['div', { class: `notice-block notice-${node.attrs.style}`, 'data-style': node.attrs.style }, 0];
      },
    },
    math_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      atom: true,
      parseDOM: [{ tag: 'div.math-block', preserveWhitespace: 'full' as const }],
      toDOM() { return ['div', { class: 'math-block' }, ['code', 0]]; },
    },
    image: {
      inline: true,
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
        width: { default: null },
        align: { default: null }, // 'left' | 'center' | 'right'
        uploading: { default: undefined }, // UUID string while uploading, undefined when done
      },
      group: 'inline',
      draggable: true,
      atom: true,
      parseDOM: [{ tag: 'img[src]', getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt'),
          title: el.getAttribute('title'),
          width: el.getAttribute('width') || el.style.width || null,
          align: el.getAttribute('data-align') || null,
        };
      }}],
      toDOM(node) {
        const attrs: Record<string, string> = { src: node.attrs.src };
        if (node.attrs.alt) attrs.alt = node.attrs.alt;
        if (node.attrs.title) attrs.title = node.attrs.title;
        if (node.attrs.width) attrs.width = node.attrs.width;
        if (node.attrs.align) attrs['data-align'] = node.attrs.align;
        return ['img', attrs];
      },
    },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM() { return ['br']; },
    },
    content_link: contentLinkNodeSpec,
    diagram_embed: diagramEmbedNodeSpec,
    text: { group: 'inline' },
    ...tNodes,
  },
  marks: {
    strong: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b', getAttrs: (node) => (node as HTMLElement).style.fontWeight !== 'normal' && null },
        { style: 'font-weight=bold' },
        { style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null },
      ],
      toDOM() { return ['strong', 0]; },
    },
    em: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
      toDOM() { return ['em', 0]; },
    },
    underline: {
      parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
      toDOM() { return ['u', 0]; },
    },
    strikethrough: {
      parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
      toDOM() { return ['del', 0]; },
    },
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM() { return ['code', 0]; },
    },
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs(dom) {
        const el = dom as HTMLElement;
        return { href: el.getAttribute('href'), title: el.getAttribute('title') };
      }}],
      toDOM(node) { return ['a', { href: node.attrs.href, title: node.attrs.title, rel: 'noopener noreferrer nofollow' }, 0]; },
    },
    comment: {
      excludes: '',
      attrs: {
        id: { default: '' },
        userId: { default: '' },
        resolved: { default: false },
        draft: { default: false },
      },
      inclusive: false,
      parseDOM: [{ tag: 'span.comment-marker', getAttrs(dom) {
        return {
          id: (dom as HTMLElement).id?.replace('comment-', '') || '',
          userId: (dom as HTMLElement).getAttribute('data-user-id') || '',
          resolved: !!(dom as HTMLElement).getAttribute('data-resolved'),
          draft: !!(dom as HTMLElement).getAttribute('data-draft'),
        };
      }}],
      toDOM(mark) {
        const attrs: Record<string, string> = {
          class: 'comment-marker',
          id: `comment-${mark.attrs.id}`,
        };
        if (mark.attrs.resolved) attrs['data-resolved'] = 'true';
        if (mark.attrs.draft) attrs['data-draft'] = 'true';
        if (mark.attrs.userId) attrs['data-user-id'] = mark.attrs.userId;
        return ['span', attrs, 0];
      },
    },
    highlight: {
      attrs: { color: { default: '' } },
      parseDOM: [
        { tag: 'mark', getAttrs(dom) {
          const bg = (dom as HTMLElement).style.backgroundColor || (dom as HTMLElement).dataset.color || '';
          return { color: bg };
        }},
        { tag: 'span.highlight', getAttrs(dom) {
          return { color: (dom as HTMLElement).style.backgroundColor || '' };
        }},
      ],
      toDOM(mark) {
        const attrs: Record<string, string> = {};
        if (mark.attrs.color) {
          attrs.style = `background-color: ${mark.attrs.color}`;
          attrs['data-color'] = mark.attrs.color;
        }
        return ['mark', attrs, 0];
      },
    },
  },
});
