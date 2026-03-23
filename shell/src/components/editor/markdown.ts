/**
 * Markdown parser and serializer for ProseMirror.
 * Compatible with Outline's markdown format.
 *
 * Plugins added for:
 * - ==highlight== marks
 * - :::info / :::warning / :::tip notice blocks
 * - - [ ] / - [x] checkbox lists
 * - $$ math blocks $$
 */
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import markdownIt from 'markdown-it';
import markdownItContainer from 'markdown-it-container';
import markdownItMark from 'markdown-it-mark';
import { schema } from './schema';
import type { Node as PMNode } from 'prosemirror-model';
import type Token from 'markdown-it/lib/token.mjs';
import type MarkdownItType from 'markdown-it';

// --- Custom markdown-it plugins ---

/**
 * Checkbox list plugin: converts `- [ ] text` and `- [x] text` into
 * checkbox_list / checkbox_item tokens.
 */
function checkboxPlugin(md: MarkdownItType) {
  const CHECKBOX_RE = /^\[([ xX])\]\s/;

  md.core.ruler.after('inline', 'checkbox', (state) => {
    const tokens = state.tokens;
    for (let i = tokens.length - 1; i >= 2; i--) {
      const inline = tokens[i];
      if (inline.type !== 'inline') continue;
      const paraOpen = tokens[i - 1];
      if (paraOpen.type !== 'paragraph_open') continue;
      const listItemOpen = tokens[i - 2];
      if (listItemOpen.type !== 'list_item_open') continue;

      const match = inline.content.match(CHECKBOX_RE);
      if (!match) continue;

      const checked = match[1].toLowerCase() === 'x';

      // Change list_item_open → checkbox_item_open
      listItemOpen.type = 'checkbox_item_open';
      listItemOpen.attrSet('checked', checked ? 'true' : 'false');

      // Find matching list_item_close
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== 'list_item_close') j++;
      if (j < tokens.length) {
        tokens[j].type = 'checkbox_item_close';
      }

      // Change parent bullet_list_open → checkbox_list_open
      // Walk backward to find the bullet_list_open
      for (let k = i - 3; k >= 0; k--) {
        if (tokens[k].type === 'bullet_list_open') {
          tokens[k].type = 'checkbox_list_open';
          // Find matching close
          let depth = 1;
          for (let m = k + 1; m < tokens.length; m++) {
            if (tokens[m].type === 'bullet_list_open' || tokens[m].type === 'checkbox_list_open') depth++;
            if (tokens[m].type === 'bullet_list_close' || tokens[m].type === 'checkbox_list_close') {
              depth--;
              if (depth === 0) {
                tokens[m].type = 'checkbox_list_close';
                break;
              }
            }
          }
          break;
        }
        // Stop if we hit another block boundary
        if (tokens[k].type === 'bullet_list_close' || tokens[k].type === 'ordered_list_close') break;
      }

      // Strip `[ ] ` or `[x] ` from inline content
      inline.content = inline.content.slice(match[0].length);
      if (inline.children && inline.children.length > 0 && inline.children[0].type === 'text') {
        inline.children[0].content = inline.children[0].content.slice(match[0].length);
      }
    }
  });
}

/**
 * Math block plugin: converts ```$$ ... $$``` fenced blocks into math_block tokens.
 * Outline uses `$$\n...\n$$` syntax.
 */
function mathBlockPlugin(md: MarkdownItType) {
  // Pre-process: convert all $$ math block variants to ```math fenced blocks
  // before markdown-it parses. This handles:
  //   $$\ncontent\n$$        (Outline standard)
  //   $$\ncontent$$          (no trailing newline before $$)
  //   $$content$$            (single-line)
  const origParse = md.parse.bind(md);
  md.parse = function (src: string, env: any) {
    // Match $$ blocks: opening $$ on its own line, content, closing $$ (possibly on same line as content)
    src = src.replace(/^\$\$\s*\n([\s\S]*?)\$\$\s*$/gm, '```math\n$1\n```');
    return origParse(src, env);
  };

  md.core.ruler.after('inline', 'math_block', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      // Convert ```math fence tokens to math_block (single token, noCloseToken)
      if (tokens[i].type === 'fence' && tokens[i].info.trim() === 'math') {
        tokens[i].type = 'math_block';
        tokens[i].tag = 'div';
      }
    }
  });
}

// --- Build markdown-it instance ---

const md = markdownIt('default', { html: false, breaks: false, linkify: true });
md.enable('table');

// Add plugins
md.use(markdownItMark); // ==highlight==
md.use(checkboxPlugin);
md.use(mathBlockPlugin);

// Notice blocks: :::info, :::warning, :::success, :::tip
const noticeStyles = ['info', 'warning', 'success', 'tip'];
for (const style of noticeStyles) {
  md.use(markdownItContainer, style, {
    render(tokens: Token[], idx: number) {
      if (tokens[idx].nesting === 1) {
        return `<div class="notice-block notice-${style}" data-style="${style}">\n`;
      }
      return '</div>\n';
    },
  });
}
// Also handle bare ::: (default to info)
md.use(markdownItContainer, 'notice', {
  validate(params: string) {
    return params.trim() === '';
  },
  render(tokens: Token[], idx: number) {
    if (tokens[idx].nesting === 1) {
      return '<div class="notice-block notice-info" data-style="info">\n';
    }
    return '</div>\n';
  },
});

// --- Parser ---

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
  mark: { mark: 'highlight' }, // ==highlight== via markdown-it-mark

  // Checkbox lists
  checkbox_list: { block: 'checkbox_list' },
  checkbox_item: { block: 'checkbox_item', getAttrs: (tok) => ({
    checked: tok.attrGet('checked') === 'true',
  })},

  // Notice blocks (markdown-it-container emits container_<name>_open/_close)
  // prosemirror-markdown strips _open/_close → looks up "container_<name>"
  container_info: { block: 'container_notice', getAttrs: () => ({ style: 'info' }) },
  container_warning: { block: 'container_notice', getAttrs: () => ({ style: 'warning' }) },
  container_success: { block: 'container_notice', getAttrs: () => ({ style: 'success' }) },
  container_tip: { block: 'container_notice', getAttrs: () => ({ style: 'tip' }) },
  container_notice: { block: 'container_notice', getAttrs: () => ({ style: 'info' }) },

  // Math blocks
  math_block: { block: 'math_block', noCloseToken: true },

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

// --- Serializer ---

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
      state.renderList(node, '   ', () => '- ');
    },
    ordered_list(state, node) {
      const start = node.attrs.order || 1;
      const maxW = String(start + node.childCount - 1).length;
      const indent = ' '.repeat(maxW + 2); // match marker width: "1. " = 3, "10. " = 4
      state.renderList(node, indent, (i: number) => {
        const nStr = String(start + i);
        return `${' '.repeat(maxW - nStr.length)}${nStr}. `;
      });
    },
    list_item(state, node) {
      state.renderContent(node);
    },
    checkbox_list(state, node) {
      state.renderList(node, '   ', () => '- ');
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
    container_notice(state, node) {
      state.write(`:::${node.attrs.style || 'info'}\n`);
      state.renderContent(node);
      state.write(':::');
      state.closeBlock(node);
    },
    math_block(state, node) {
      state.write('$$\n');
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write('$$');
      state.closeBlock(node);
    },
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
