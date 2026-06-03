/**
 * ProseMirror schema + markdown parser for the gateway.
 *
 * Scope: covers the node types agents actually write —
 * paragraph, heading, bullet_list, ordered_list, list_item,
 * code_block, blockquote, table (via prosemirror-tables compat),
 * horizontal_rule, hard_break, image, text.
 *
 * Human-only types (checkbox, math, notice, diagram_embed, content_link)
 * are NOT included. Unknown tokens fall back to a plain paragraph.
 */

import { Schema } from 'prosemirror-model';
import { MarkdownParser } from 'prosemirror-markdown';
import markdownIt from 'markdown-it';

// ---------------------------------------------------------------------------
// Schema — node types only (no parseDOM/toDOM needed server-side)
// ---------------------------------------------------------------------------

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: {
      attrs: { blockId: { default: null } },
      content: 'inline*',
      group: 'block',
    },

    heading: {
      attrs: { level: { default: 1 }, blockId: { default: null } },
      content: 'inline*',
      group: 'block',
      defining: true,
    },

    blockquote: {
      attrs: { blockId: { default: null } },
      content: 'block+',
      group: 'block',
      defining: true,
    },

    horizontal_rule: {
      attrs: { blockId: { default: null } },
      group: 'block',
    },

    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      attrs: { language: { default: '' }, blockId: { default: null } },
    },

    bullet_list: {
      attrs: { blockId: { default: null } },
      content: 'list_item+',
      group: 'block',
    },

    ordered_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { order: { default: 1 }, blockId: { default: null } },
    },

    list_item: {
      content: '(paragraph | heading) block*',
      defining: true,
    },

    // Table support (matches prosemirror-tables node names used by the editor)
    table: {
      attrs: { blockId: { default: null } },
      content: 'table_row+',
      group: 'block',
      tableRole: 'table',
    },

    table_row: {
      content: '(table_cell | table_header)*',
      tableRole: 'row',
    },

    table_cell: {
      content: 'block+',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
        background: { default: null },
        colwidth: { default: null },
      },
      tableRole: 'cell',
      defining: true,
    },

    table_header: {
      content: 'block+',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
        background: { default: null },
        colwidth: { default: null },
      },
      tableRole: 'header_cell',
      defining: true,
    },

    image: {
      inline: true,
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
        width: { default: null },
        align: { default: null },
      },
      group: 'inline',
      draggable: true,
      atom: true,
    },

    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
    },

    text: { group: 'inline' },
  },

  marks: {
    strong: {},
    em: {},
    underline: {},
    strikethrough: {},
    code: {},
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
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
    },
    highlight: {
      attrs: { color: { default: '' } },
    },
  },
});

// ---------------------------------------------------------------------------
// Markdown-it instance — standard CommonMark + table
// ---------------------------------------------------------------------------

const md = markdownIt('default', { html: false, breaks: false, linkify: true });
md.enable('table');

// Table cells in markdown-it contain inline tokens directly, but ProseMirror's
// table_cell/table_header nodes require block+ content (a paragraph wrapper).
// Without this, createAndFill returns null and cells are silently dropped.
md.core.ruler.push('table_cell_paragraph_wrap', (state) => {
  const tokens = state.tokens;
  const cellTags = new Set(['th', 'td']);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (tok.type === 'inline' && i > 0 && i < tokens.length - 1) {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      if (prev.nesting === 1 && cellTags.has(prev.tag) &&
          next.nesting === -1 && cellTags.has(next.tag)) {
        const pOpen = new state.Token('paragraph_open', 'p', 1);
        pOpen.block = true;
        const pClose = new state.Token('paragraph_close', 'p', -1);
        pClose.block = true;
        tokens.splice(i + 1, 0, pClose);
        tokens.splice(i, 0, pOpen);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// MarkdownParser — maps token types to schema nodes
// ---------------------------------------------------------------------------

export const markdownParser = new MarkdownParser(schema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list' },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok) => ({ order: +(tok.attrGet('start') || 1) }),
  },
  heading: {
    block: 'heading',
    getAttrs: (tok) => ({ level: +tok.tag.slice(1) }),
  },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: {
    block: 'code_block',
    getAttrs: (tok) => ({ language: tok.info || '' }),
    noCloseToken: true,
  },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') || null,
      alt: tok.children?.[0]?.content || null,
    }),
  },
  hardbreak: { node: 'hard_break' },

  // Table tokens
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: {
    block: 'table_header',
    getAttrs(tok) {
      const attrs = {};
      if (tok.attrs) {
        for (const [key, val] of tok.attrs) {
          if (key === 'colspan') attrs.colspan = parseInt(val, 10);
          if (key === 'rowspan') attrs.rowspan = parseInt(val, 10);
        }
      }
      return attrs;
    },
  },
  td: {
    block: 'table_cell',
    getAttrs(tok) {
      const attrs = {};
      if (tok.attrs) {
        for (const [key, val] of tok.attrs) {
          if (key === 'colspan') attrs.colspan = parseInt(val, 10);
          if (key === 'rowspan') attrs.rowspan = parseInt(val, 10);
        }
      }
      return attrs;
    },
  },

  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strikethrough' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({
      href: tok.attrGet('href'),
      title: tok.attrGet('title') || null,
    }),
  },
  code_inline: { mark: 'code' },

  // Ignore tokens we don't support — prevents parse errors
  html_inline: { ignore: true, noCloseToken: true },
  html_block: { ignore: true, noCloseToken: true },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a markdown string into a ProseMirror doc node.
 * Returns null on catastrophic failure (shouldn't happen).
 */
export function parseMarkdownToDoc(markdown) {
  try {
    return markdownParser.parse(markdown);
  } catch (e) {
    // Fallback: wrap as plain paragraph
    return schema.node('doc', null, [
      schema.node('paragraph', null, markdown ? [schema.text(markdown)] : []),
    ]);
  }
}

/**
 * Parse a markdown fragment that represents a single block.
 * Returns the first top-level block node from the parsed doc.
 * If the markdown produces multiple blocks, wraps them in a blockquote
 * as a signal to the caller.
 */
export function parseMarkdownFragment(markdown) {
  const doc = parseMarkdownToDoc(markdown);
  const blocks = [];
  doc.forEach((node) => blocks.push(node));

  if (blocks.length === 0) {
    return schema.node('paragraph', null, []);
  }
  if (blocks.length === 1) {
    return blocks[0];
  }
  // Multiple blocks — return them all; caller decides how to handle
  return blocks;
}
