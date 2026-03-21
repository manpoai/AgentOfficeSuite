/**
 * ProseMirror schema for the document editor.
 * Based on Outline's editor schema — compatible with Outline's markdown format.
 */
import { Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

const tNodes = tableNodes({
  tableGroup: 'block',
  cellContent: 'inline*',
  cellAttributes: {
    alignment: { default: null },
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
      content: 'paragraph block*',
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
      content: 'paragraph block*',
      attrs: { checked: { default: false } },
      defining: true,
      parseDOM: [{ tag: 'li.checkbox-item', getAttrs(dom) {
        return { checked: (dom as HTMLElement).dataset.checked === 'true' };
      }}],
      toDOM(node) {
        return ['li', { class: 'checkbox-item', 'data-checked': node.attrs.checked ? 'true' : 'false' }, 0];
      },
    },
    image: {
      inline: false,
      attrs: { src: {}, alt: { default: null }, title: { default: null } },
      group: 'block',
      draggable: true,
      parseDOM: [{ tag: 'img[src]', getAttrs(dom) {
        const el = dom as HTMLElement;
        return { src: el.getAttribute('src'), alt: el.getAttribute('alt'), title: el.getAttribute('title') };
      }}],
      toDOM(node) { return ['img', node.attrs]; },
    },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM() { return ['br']; },
    },
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
    highlight: {
      parseDOM: [{ tag: 'mark' }],
      toDOM() { return ['mark', 0]; },
    },
  },
});
