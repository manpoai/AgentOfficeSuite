/**
 * Markdown parser and serializer for ProseMirror.
 * Compatible with Outline's markdown format.
 */
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import markdownIt from 'markdown-it';
import { schema } from './schema';
import type { Node as PMNode } from 'prosemirror-model';

const md = markdownIt('default', { html: false, breaks: false, linkify: true });
md.enable('table');

export const markdownParser = new MarkdownParser(schema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list' },
  ordered_list: { block: 'ordered_list', getAttrs: (tok) => ({ order: +(tok.attrGet('start') || 1) }) },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', getAttrs: (tok) => ({ language: tok.info || '' }), noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  image: { node: 'image', getAttrs: (tok) => ({
    src: tok.attrGet('src'),
    title: tok.attrGet('title') || null,
    alt: tok.children?.[0]?.content || null,
  })},
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strikethrough' },
  link: { mark: 'link', getAttrs: (tok) => ({
    href: tok.attrGet('href'),
    title: tok.attrGet('title') || null,
  })},
  code_inline: { mark: 'code' },
  // Table tokens from markdown-it
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' },
});

export function parseMarkdown(markdown: string): PMNode | null {
  try {
    return markdownParser.parse(markdown);
  } catch (e: any) {
    console.error('Markdown parse error:', e.message);
    // Fallback: wrap as plain text in a paragraph
    return schema.node('doc', null, [
      schema.node('paragraph', null, markdown ? [schema.text(markdown)] : []),
    ]);
  }
}

export const markdownSerializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock('> ', null, node, () => state.renderContent(node));
    },
    code_block(state, node) {
      state.write(`\`\`\`${node.attrs.language || ''}\n`);
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write('```');
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write(`${'#'.repeat(node.attrs.level)} `);
      state.renderInline(node);
      state.closeBlock(node);
    },
    horizontal_rule(state, node) {
      state.write(node.attrs.markup || '---');
      state.closeBlock(node);
    },
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    ordered_list(state, node) {
      const start = node.attrs.order || 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = '  '.repeat(maxW + 2 > 4 ? 1 : 1);
      state.renderList(node, space, (i: number) => {
        const nStr = String(start + i);
        return `${' '.repeat(maxW - nStr.length)}${nStr}. `;
      });
    },
    list_item(state, node) {
      state.renderContent(node);
    },
    checkbox_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    checkbox_item(state, node) {
      state.write(node.attrs.checked ? '[x] ' : '[ ] ');
      state.renderContent(node);
    },
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    image(state, node) {
      state.write(`![${state.esc(node.attrs.alt || '')}](${state.esc(node.attrs.src)}${node.attrs.title ? ` "${state.esc(node.attrs.title)}"` : ''})`);
      state.closeBlock(node);
    },
    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write('\\\n');
          return;
        }
      }
    },
    text(state, node) {
      state.text(node.text || '');
    },
    table(state, node) {
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          cells.push(cell.textContent);
        });
        rows.push(cells);
      });
      if (rows.length === 0) return;
      const colCount = rows[0]?.length || 0;
      state.write('| ' + rows[0].join(' | ') + ' |\n');
      state.write('| ' + Array(colCount).fill('---').join(' | ') + ' |\n');
      for (let i = 1; i < rows.length; i++) {
        state.write('| ' + rows[i].join(' | ') + ' |\n');
      }
      state.write('\n');
    },
    table_row() { /* handled by table */ },
    table_cell() { /* handled by table */ },
    table_header() { /* handled by table */ },
  },
  {
    em: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    strong: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    underline: { open: '__', close: '__', mixable: true, expelEnclosingWhitespace: true },
    strikethrough: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    link: {
      open(_state, mark) { return '['; },
      close(_state, mark) { return `](${mark.attrs.href}${mark.attrs.title ? ` "${mark.attrs.title}"` : ''})`; },
    },
    code: { open: '`', close: '`', escape: false },
    highlight: { open: '==', close: '==' },
  }
);

export function serializeMarkdown(doc: PMNode): string {
  return markdownSerializer.serialize(doc);
}
