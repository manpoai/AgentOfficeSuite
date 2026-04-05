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
import { showError } from '@/lib/utils/error';
import { getT } from '@/lib/i18n';
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

const md = markdownIt('default', { html: true, breaks: false, linkify: true });
md.enable('table');

// Add plugins
md.use(markdownItMark); // ==highlight==

// Convert known HTML inline tags to proper tokens:
// <mark data-color="..."> → highlight mark, <u> → underline mark, <br> → softbreak
md.core.ruler.after('text_join', 'html_inline_to_tokens', (state) => {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== 'inline' || !blockToken.children) continue;
    const newChildren: Token[] = [];
    for (const tok of blockToken.children) {
      if (tok.type === 'html_inline') {
        // <mark data-color="..."> → mark_open
        const markMatch = tok.content.match(/^<mark\s[^>]*data-color="([^"]*)"[^>]*>/i);
        if (markMatch) {
          const t = new state.Token('mark_open', 'mark', 1);
          t.attrSet('data-color', markMatch[1]);
          newChildren.push(t);
          continue;
        }
        if (tok.content.toLowerCase() === '</mark>') {
          const t = new state.Token('mark_close', 'mark', -1);
          newChildren.push(t);
          continue;
        }
        // <u> → underline open/close
        if (/^<u\s*>$/i.test(tok.content.trim())) {
          const t = new state.Token('underline_open', 'u', 1);
          newChildren.push(t);
          continue;
        }
        if (/^<\/u\s*>$/i.test(tok.content.trim())) {
          const t = new state.Token('underline_close', 'u', -1);
          newChildren.push(t);
          continue;
        }
        // <br> → softbreak (will be ignored or treated as line break)
        if (/^<br\s*\/?>$/i.test(tok.content.trim())) {
          // Keep as html_inline for table_cell_paragraph rule to split on
          newChildren.push(tok);
          continue;
        }
      }
      newChildren.push(tok);
    }
    blockToken.children = newChildren;
  }
});
md.use(checkboxPlugin);
md.use(mathBlockPlugin);

/**
 * HTML img tag plugin: converts inline <img src="..." /> HTML tags
 * into proper image tokens so they round-trip through the editor.
 * This is needed because the serializer outputs HTML img tags when
 * images have width or alignment attributes.
 */
function htmlImgPlugin(mdInstance: MarkdownItType) {
  // Helper: create an image token from an HTML <img> string
  function makeImgToken(state: any, html: string): Token | null {
    const srcMatch = html.match(/\bsrc="([^"]+)"/);
    if (!srcMatch) return null;
    const altMatch = html.match(/\balt="([^"]+)"/);
    const titleMatch = html.match(/\btitle="([^"]+)"/);
    const widthMatch = html.match(/\bwidth="([^"]+)"/);
    const alignMatch = html.match(/\bdata-align="([^"]+)"/);
    const imgToken = new state.Token('image', 'img', 0);
    imgToken.attrSet('src', srcMatch[1]);
    if (titleMatch) imgToken.attrSet('title', titleMatch[1]);
    if (widthMatch) imgToken.attrSet('width', widthMatch[1]);
    if (alignMatch) imgToken.attrSet('data-align', alignMatch[1]);
    imgToken.children = [];
    if (altMatch) {
      const textToken = new state.Token('text', '', 0);
      textToken.content = altMatch[1];
      imgToken.children.push(textToken);
    }
    return imgToken;
  }

  mdInstance.core.ruler.after('inline', 'html_img', (state) => {
    const newTokens: Token[] = [];
    for (const blockToken of state.tokens) {
      // Case 1: html_block containing <img> — convert to paragraph wrapping an image
      // markdown-it emits html_block when <img> is on its own line or indented
      if (blockToken.type === 'html_block' && /^[\s]*<img\s/i.test(blockToken.content)) {
        const imgToken = makeImgToken(state, blockToken.content);
        if (imgToken) {
          const pOpen = new state.Token('paragraph_open', 'p', 1);
          const inline = new state.Token('inline', '', 0);
          inline.content = '';
          inline.children = [imgToken];
          const pClose = new state.Token('paragraph_close', 'p', -1);
          newTokens.push(pOpen, inline, pClose);
          continue;
        }
      }

      // Case 2: inline children containing html_inline <img> tags
      if (blockToken.type === 'inline' && blockToken.children) {
        const newChildren: Token[] = [];
        for (const tok of blockToken.children) {
          if (tok.type === 'html_inline' && /^<img\s/i.test(tok.content)) {
            const imgToken = makeImgToken(state, tok.content);
            if (imgToken) {
              newChildren.push(imgToken);
              continue;
            }
          }
          newChildren.push(tok);
        }
        blockToken.children = newChildren;
      }

      newTokens.push(blockToken);
    }
    state.tokens = newTokens;
  });
}
md.use(htmlImgPlugin);
md.core.ruler.after('text_join', 'html_table_parse', htmlTableRule);

// Convert html_block containing <div class="diagram-embed-node"> into diagram_embed tokens
md.core.ruler.after('text_join', 'html_diagram_embed', (state) => {
  const tokens = state.tokens;
  const newTokens: typeof tokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'html_block' && /diagram-embed-node/.test(tok.content)) {
      const idMatch = tok.content.match(/data-diagram-id="([^"]+)"/);
      const titleMatch = tok.content.match(/data-title="([^"]+)"/);
      if (idMatch) {
        const dTok = new state.Token('diagram_embed', 'div', 0);
        dTok.attrs = [
          ['diagramId', idMatch[1]],
          ['title', titleMatch ? titleMatch[1] : 'Untitled Diagram'],
        ];
        dTok.block = true;
        newTokens.push(dTok);
        continue;
      }
    }
    newTokens.push(tok);
  }
  state.tokens = newTokens;
});

// Convert inline links with /content?id= href into content_link tokens
md.core.ruler.after('text_join', 'inline_content_link', (state) => {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== 'inline' || !blockToken.children) continue;
    const children = blockToken.children;
    const newChildren: Token[] = [];
    for (let i = 0; i < children.length; i++) {
      const tok = children[i];
      if (tok.type === 'link_open') {
        const href = tok.attrGet('href') || '';
        const contentMatch = href.match(/\/content\?id=((?:doc|table|presentation|diagram)(?::|%3A)[a-zA-Z0-9_-]+)/i);
        if (contentMatch && i + 2 < children.length && children[i + 1].type === 'text' && children[i + 2].type === 'link_close') {
          const contentId = decodeURIComponent(contentMatch[1]);
          const title = children[i + 1].content || contentId;
          const clTok = new state.Token('content_link', 'span', 0);
          clTok.attrs = [
            ['contentId', contentId],
            ['title', title],
          ];
          newChildren.push(clTok);
          i += 2; // skip text + link_close
          continue;
        }
      }
      newChildren.push(tok);
    }
    blockToken.children = newChildren;
  }
});

// Wrap table cell inline content in paragraph tokens.
// markdown-it emits: th_open → inline → th_close (no paragraph wrapper).
// With cellContent: 'block+', ProseMirror expects block nodes inside cells.
// Also splits on <br> to create multiple paragraphs within a cell.
md.core.ruler.after('text_join', 'table_cell_paragraph', (state) => {
  const tokens = state.tokens;
  const newTokens: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'inline' && i > 0 && i < tokens.length - 1) {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      const isInCell = (prev.type === 'th_open' || prev.type === 'td_open') &&
                       (next.type === 'th_close' || next.type === 'td_close');
      if (isInCell && tok.children) {
        // Split children on <br> (html_inline) to create separate paragraphs
        const segments: Token[][] = [[]];
        for (const child of tok.children) {
          if (child.type === 'html_inline' && /^<br\s*\/?>$/i.test(child.content.trim())) {
            segments.push([]);
          } else {
            segments[segments.length - 1].push(child);
          }
        }

        // Helper: trim whitespace tokens from segment edges and leading/trailing spaces
        function trimSeg(seg: Token[]) {
          while (seg.length > 0 && seg[0].type === 'text' && seg[0].content.trim() === '') seg.shift();
          while (seg.length > 0 && seg[seg.length - 1].type === 'text' && seg[seg.length - 1].content.trim() === '') seg.pop();
          // Also trim leading whitespace from first text token
          if (seg.length > 0 && seg[0].type === 'text') {
            seg[0].content = seg[0].content.replace(/^\s+/, '');
            if (seg[0].content === '') seg.shift();
          }
          // Trim trailing whitespace from last text token
          if (seg.length > 0 && seg[seg.length - 1].type === 'text') {
            seg[seg.length - 1].content = seg[seg.length - 1].content.replace(/\s+$/, '');
            if (seg[seg.length - 1].content === '') seg.pop();
          }
        }

        // Helper: emit a paragraph or heading wrapping the segment's inline tokens.
        // Auto-detects heading if segment starts with # prefix.
        function emitBlock(seg: Token[]) {
          // Check for heading prefix: # , ## , etc.
          const hMatch = seg[0]?.type === 'text' && seg[0].content.match(/^(#{1,6})\s+/);
          if (hMatch) {
            const level = hMatch[1].length;
            stripPrefix(seg, /^#{1,6}\s+/);
            const hOpen = new state.Token('heading_open', `h${level}`, 1);
            hOpen.block = true;
            hOpen.markup = hMatch[1];
            const inline = new state.Token('inline', '', 0);
            inline.children = seg;
            inline.content = seg.map(t => t.content).join('');
            const hClose = new state.Token('heading_close', `h${level}`, -1);
            hClose.block = true;
            newTokens.push(hOpen, inline, hClose);
          } else {
            const pOpen = new state.Token('paragraph_open', 'p', 1);
            pOpen.block = true;
            const inline = new state.Token('inline', '', 0);
            inline.children = seg;
            inline.content = seg.map(t => t.content).join('');
            const pClose = new state.Token('paragraph_close', 'p', -1);
            pClose.block = true;
            newTokens.push(pOpen, inline, pClose);
          }
        }

        // Helper: strip a prefix pattern from the first text token in a segment
        function stripPrefix(seg: Token[], pattern: RegExp): RegExpMatchArray | null {
          if (seg.length === 0) return null;
          const first = seg[0];
          if (first.type !== 'text') return null;
          const m = first.content.match(pattern);
          if (!m) return null;
          // Modify the first token's content to remove the prefix
          first.content = first.content.slice(m[0].length);
          if (first.content === '') seg.shift();
          return m;
        }

        // Detect block type from segment content and emit appropriate tokens
        // Accumulate consecutive list items into proper list wrappers
        let pendingListType: string | null = null; // 'bullet_list' | 'ordered_list' | 'checkbox_list'
        function flushPendingList() {
          if (pendingListType) {
            const closeTag = pendingListType === 'bullet_list' ? 'ul' :
                             pendingListType === 'ordered_list' ? 'ol' : 'ul';
            const close = new state.Token(pendingListType === 'checkbox_list' ? 'checkbox_list_close' :
                          pendingListType === 'bullet_list' ? 'bullet_list_close' : 'ordered_list_close', closeTag, -1);
            close.block = true;
            newTokens.push(close);
            pendingListType = null;
          }
        }

        let addedAny = false;
        for (const seg of segments) {
          const hasContent = seg.some(t => t.type !== 'text' || t.content.trim() !== '');
          if (!hasContent) continue;
          trimSeg(seg);
          if (seg.length === 0) continue;

          // Check for heading: # , ## , ### , etc.
          const headingMatch = seg[0]?.type === 'text' && seg[0].content.match(/^(#{1,6})\s+/);
          if (headingMatch) {
            flushPendingList();
            const level = headingMatch[1].length;
            stripPrefix(seg, /^#{1,6}\s+/);
            const hOpen = new state.Token('heading_open', `h${level}`, 1);
            hOpen.block = true;
            hOpen.markup = headingMatch[1];
            const inline = new state.Token('inline', '', 0);
            inline.children = seg;
            inline.content = seg.map(t => t.content).join('');
            const hClose = new state.Token('heading_close', `h${level}`, -1);
            hClose.block = true;
            newTokens.push(hOpen, inline, hClose);
            addedAny = true;
            continue;
          }

          // Check for checkbox list item: - [x] or - [ ] (also handle escaped \[ \] from old data)
          const checkboxMatch = seg[0]?.type === 'text' && seg[0].content.match(/^- \\?\[([ x])\\?\]\s*/);
          if (checkboxMatch) {
            if (pendingListType !== 'checkbox_list') {
              flushPendingList();
              const open = new state.Token('checkbox_list_open', 'ul', 1);
              open.block = true;
              newTokens.push(open);
              pendingListType = 'checkbox_list';
            }
            const checked = checkboxMatch[1] === 'x';
            stripPrefix(seg, /^- \\?\[[ x]\\?\]\s*/);
            // Clean up duplicate [ ] / [x] from old escaped format (\[ \] → [ ] [ ] after unescape)
            if (seg[0]?.type === 'text') {
              seg[0].content = seg[0].content.replace(/^\\?\[[ x]\\?\]\s*/, '');
              if (seg[0].content === '') seg.shift();
            }
            const itemOpen = new state.Token('checkbox_item_open', 'li', 1);
            itemOpen.block = true;
            itemOpen.attrSet('checked', checked ? 'true' : 'false');
            newTokens.push(itemOpen);
            emitBlock(seg);
            const itemClose = new state.Token('checkbox_item_close', 'li', -1);
            itemClose.block = true;
            newTokens.push(itemClose);
            addedAny = true;
            continue;
          }

          // Check for bullet list: - text
          const bulletMatch = seg[0]?.type === 'text' && seg[0].content.match(/^- /);
          if (bulletMatch) {
            if (pendingListType !== 'bullet_list') {
              flushPendingList();
              const open = new state.Token('bullet_list_open', 'ul', 1);
              open.block = true;
              newTokens.push(open);
              pendingListType = 'bullet_list';
            }
            stripPrefix(seg, /^- /);
            const itemOpen = new state.Token('list_item_open', 'li', 1);
            itemOpen.block = true;
            newTokens.push(itemOpen);
            emitBlock(seg);
            const itemClose = new state.Token('list_item_close', 'li', -1);
            itemClose.block = true;
            newTokens.push(itemClose);
            addedAny = true;
            continue;
          }

          // Check for ordered list: 1. text
          const orderedMatch = seg[0]?.type === 'text' && seg[0].content.match(/^(\d+)\.\s+/);
          if (orderedMatch) {
            if (pendingListType !== 'ordered_list') {
              flushPendingList();
              const open = new state.Token('ordered_list_open', 'ol', 1);
              open.block = true;
              open.attrSet('start', orderedMatch[1]);
              newTokens.push(open);
              pendingListType = 'ordered_list';
            }
            stripPrefix(seg, /^\d+\.\s+/);
            const itemOpen = new state.Token('list_item_open', 'li', 1);
            itemOpen.block = true;
            newTokens.push(itemOpen);
            emitBlock(seg);
            const itemClose = new state.Token('list_item_close', 'li', -1);
            itemClose.block = true;
            newTokens.push(itemClose);
            addedAny = true;
            continue;
          }

          // Check for blockquote: > text
          const quoteMatch = seg[0]?.type === 'text' && seg[0].content.match(/^>\s*/);
          if (quoteMatch) {
            flushPendingList();
            stripPrefix(seg, /^>\s*/);
            const bqOpen = new state.Token('blockquote_open', 'blockquote', 1);
            bqOpen.block = true;
            newTokens.push(bqOpen);
            emitBlock(seg);
            const bqClose = new state.Token('blockquote_close', 'blockquote', -1);
            bqClose.block = true;
            newTokens.push(bqClose);
            addedAny = true;
            continue;
          }

          // Default: paragraph (or heading if starts with #)
          flushPendingList();
          emitBlock(seg);
          addedAny = true;
        }
        flushPendingList();

        // If no content at all, still add an empty paragraph (block+ requires at least 1)
        if (!addedAny) {
          const pOpen = new state.Token('paragraph_open', 'p', 1);
          pOpen.block = true;
          const inline = new state.Token('inline', '', 0);
          inline.children = [];
          inline.content = '';
          const pClose = new state.Token('paragraph_close', 'p', -1);
          pClose.block = true;
          newTokens.push(pOpen);
          newTokens.push(inline);
          newTokens.push(pClose);
        }
        continue;
      }
    }
    newTokens.push(tok);
  }
  state.tokens = newTokens;
});

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
    width: tok.attrGet('width') || null,
    align: tok.attrGet('data-align') || null,
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
  underline: { mark: 'underline' },
  mark: { mark: 'highlight', getAttrs: (tok) => ({ color: tok.attrGet('data-color') || '' }) },

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
  th: {
    block: 'table_header',
    getAttrs(tok: any) {
      const attrs: Record<string, unknown> = {};
      if (tok.attrs) {
        for (const [key, val] of tok.attrs) {
          if (key === 'colspan') attrs.colspan = parseInt(val, 10);
          if (key === 'rowspan') attrs.rowspan = parseInt(val, 10);
          if (key === 'data-background') attrs.background = val;
          if (key === 'data-alignment') attrs.alignment = val;
          if (key === 'data-colwidth') {
            try { attrs.colwidth = JSON.parse(val); } catch {}
          }
        }
      }
      return attrs;
    },
  },
  td: {
    block: 'table_cell',
    getAttrs(tok: any) {
      const attrs: Record<string, unknown> = {};
      if (tok.attrs) {
        for (const [key, val] of tok.attrs) {
          if (key === 'colspan') attrs.colspan = parseInt(val, 10);
          if (key === 'rowspan') attrs.rowspan = parseInt(val, 10);
          if (key === 'data-background') attrs.background = val;
          if (key === 'data-alignment') attrs.alignment = val;
          if (key === 'data-colwidth') {
            try { attrs.colwidth = JSON.parse(val); } catch {}
          }
        }
      }
      return attrs;
    },
  },

  // Content link (inline node)
  content_link: { node: 'content_link', getAttrs: (tok) => ({
    contentId: tok.attrGet('contentId') || '',
    title: tok.attrGet('title') || '',
  }), noCloseToken: true },

  // Diagram embed
  diagram_embed: { node: 'diagram_embed', getAttrs: (tok) => ({
    diagramId: tok.attrGet('diagramId') || '',
    title: tok.attrGet('title') || 'Untitled Diagram',
  }), noCloseToken: true },

  // HTML inline/block tokens (e.g. <br>) — ignore to prevent parse errors
  // noCloseToken needed because these are single tokens, not open/close pairs
  html_inline: { ignore: true, noCloseToken: true },
  html_block: { ignore: true, noCloseToken: true },
});

/**
 * Core rule: convert html_block tokens containing <table> into
 * proper table/tr/th/td tokens so ProseMirror can parse them.
 * Extracts style attributes (background-color, text-align) and
 * col widths into token attrs.
 */
function htmlTableRule(state: any) {
  const tokens = state.tokens;
  const newTokens: typeof tokens = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'html_block' || !/<table[\s>]/i.test(tok.content)) {
      newTokens.push(tok);
      continue;
    }

    // Parse the HTML table
    const parser = new DOMParser();
    const doc = parser.parseFromString(tok.content, 'text/html');
    const table = doc.querySelector('table');
    if (!table) { newTokens.push(tok); continue; }

    // Extract col widths from <colgroup>
    const colWidths: (number | null)[] = [];
    table.querySelectorAll('colgroup col').forEach((col) => {
      const style = (col as HTMLElement).style.width;
      const match = style?.match(/(\d+)px/);
      colWidths.push(match ? parseInt(match[1], 10) : null);
    });

    // table_open
    const tableOpen = new state.Token('table_open', 'table', 1);
    tableOpen.block = true;
    newTokens.push(tableOpen);

    let colIdx = 0;
    table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr').forEach((tr) => {
      const rowOpen = new state.Token('tr_open', 'tr', 1);
      rowOpen.block = true;
      newTokens.push(rowOpen);

      let cellColIdx = 0;
      tr.querySelectorAll(':scope > th, :scope > td').forEach((cell) => {
        const isHeader = cell.tagName.toLowerCase() === 'th';
        const tag = isHeader ? 'th' : 'td';
        const cellOpen = new state.Token(`${tag}_open`, tag, 1);
        cellOpen.block = true;

        // Extract attributes
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
        const bg = (cell as HTMLElement).style.backgroundColor || null;
        const align = (cell as HTMLElement).style.textAlign || null;

        // Build colwidth array for this cell
        const cw: number[] = [];
        for (let c = 0; c < colspan; c++) {
          cw.push(colWidths[cellColIdx + c] || 0);
        }
        cellColIdx += colspan;

        cellOpen.attrs = [];
        if (colspan > 1) cellOpen.attrs.push(['colspan', String(colspan)]);
        if (rowspan > 1) cellOpen.attrs.push(['rowspan', String(rowspan)]);
        if (bg) cellOpen.attrs.push(['data-background', bg]);
        if (align) cellOpen.attrs.push(['data-alignment', align]);
        if (cw.some((w: number) => w > 0)) cellOpen.attrs.push(['data-colwidth', JSON.stringify(cw)]);

        newTokens.push(cellOpen);

        // Cell content as inline token wrapped in paragraph
        const content = cell.textContent?.trim() || '';
        const pOpen = new state.Token('paragraph_open', 'p', 1);
        pOpen.block = true;
        newTokens.push(pOpen);

        const inline = new state.Token('inline', '', 0);
        inline.content = content;
        inline.children = [];
        // Re-parse inline content through markdown-it
        state.md.inline.parse(content, state.md, state.env, inline.children);
        newTokens.push(inline);

        const pClose = new state.Token('paragraph_close', 'p', -1);
        pClose.block = true;
        newTokens.push(pClose);

        const cellClose = new state.Token(`${tag}_close`, tag, -1);
        cellClose.block = true;
        newTokens.push(cellClose);
      });

      const rowClose = new state.Token('tr_close', 'tr', -1);
      rowClose.block = true;
      newTokens.push(rowClose);
    });

    const tableClose = new state.Token('table_close', 'table', -1);
    tableClose.block = true;
    newTokens.push(tableClose);
  }

  state.tokens = newTokens;
}

export function parseMarkdown(markdown: string): PMNode | null {
  try {
    // Clean up stale trailing backslashes from hard_break round-trip bugs.
    // Strips trailing `\` sequences from lines where they serve no purpose:
    // - End of document
    // - Lines that are only whitespace + backslashes (empty list items with stale \)
    markdown = markdown.replace(/^(\s*(?:\d+\.\s*|[-*+]\s*|>?\s*))\\+\s*$/gm, '$1');
    markdown = markdown.replace(/\\+\s*$/, '');
    return markdownParser.parse(markdown);
  } catch (e: any) {
    showError(getT()('errors.markdownParseFailed'), e);
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
      const { src, alt, title, width, align } = node.attrs;
      if (width || align) {
        // Use HTML img to preserve width/alignment through round-trip
        const parts = [`<img src="${state.esc(src)}"`];
        if (alt) parts.push(` alt="${state.esc(alt)}"`);
        if (title) parts.push(` title="${state.esc(title)}"`);
        if (width) parts.push(` width="${state.esc(String(width))}"`);
        if (align) parts.push(` data-align="${state.esc(align)}"`);
        parts.push(' />');
        state.write(parts.join(''));
      } else {
        state.write(`![${state.esc(alt || '')}](${state.esc(src)}${title ? ` "${state.esc(title)}"` : ''})`);
      }
    },
    hard_break(state, node, parent, index) {
      // Only write hard break if there is meaningful content after it
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write('\\\n');
          return;
        }
      }
      // Trailing hard breaks (nothing after) → skip to avoid stray "\" on round-trip
    },
    text(state, node) {
      state.text(node.text || '');
    },
    table(state, node) {
      // Check if table has any attributes that GFM markdown can't represent
      function needsHtmlTable(tableNode: PMNode): boolean {
        let needs = false;
        tableNode.forEach((row) => {
          row.forEach((cell) => {
            if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) needs = true;
            if (cell.attrs.background) needs = true;
            if (cell.attrs.colwidth && cell.attrs.colwidth.some((w: number) => w > 0)) needs = true;
          });
        });
        return needs;
      }

      // Serialize inline content of a single node (paragraph, heading, list_item child, etc.)
      function serializeInline(block: PMNode): string {
        const parts: string[] = [];
        block.forEach((child) => {
          if (child.type.name === 'image') {
            const { src, alt, title, width, align } = child.attrs;
            if (width || align) {
              const p = [`<img src="${state.esc(src)}"`];
              if (alt) p.push(` alt="${state.esc(alt)}"`);
              if (title) p.push(` title="${state.esc(title)}"`);
              if (width) p.push(` width="${state.esc(String(width))}"`);
              if (align) p.push(` data-align="${state.esc(align)}"`);
              p.push(' />');
              parts.push(p.join(''));
            } else {
              parts.push(`![${state.esc(alt || '')}](${state.esc(src)}${title ? ` "${state.esc(title)}"` : ''})`);
            }
          } else if (child.isText) {
            let text = state.esc(child.text || '');
            if (child.marks) {
              for (const mark of child.marks) {
                if (mark.type.name === 'strong') text = `**${text}**`;
                else if (mark.type.name === 'em') text = `*${text}*`;
                else if (mark.type.name === 'code') text = `\`${text}\``;
                else if (mark.type.name === 'strikethrough') text = `~~${text}~~`;
                else if (mark.type.name === 'underline') text = `<u>${text}</u>`;
                else if (mark.type.name === 'link') text = `[${text}](${mark.attrs.href})`;
                else if (mark.type.name === 'highlight') {
                  if (mark.attrs.color) {
                    text = `<mark style="background-color: ${mark.attrs.color}" data-color="${mark.attrs.color}">${text}</mark>`;
                  } else {
                    text = `==${text}==`;
                  }
                }
              }
            }
            parts.push(text);
          } else if (child.type.name === 'hard_break') {
            parts.push('<br>');
          }
        });
        return parts.join('');
      }

      // Recursively serialize block content for table cells.
      // Multiple blocks separated by <br>; lists rendered inline.
      function serializeBlocks(container: PMNode): string {
        const lines: string[] = [];
        container.forEach((block) => {
          const typeName = block.type.name;
          if (typeName === 'paragraph') {
            const text = serializeInline(block);
            if (text.trim()) lines.push(text);
          } else if (typeName === 'heading') {
            const text = serializeInline(block);
            const level = block.attrs.level || 1;
            if (text.trim()) lines.push('#'.repeat(level) + ' ' + text);
          } else if (typeName === 'bullet_list' || typeName === 'ordered_list' || typeName === 'checkbox_list') {
            block.forEach((item, _offset, idx) => {
              let marker = '- ';
              if (typeName === 'ordered_list') marker = `${(block.attrs.order || 1) + idx}. `;
              if (typeName === 'checkbox_list') marker = item.attrs?.checked ? '- [x] ' : '- [ ] ';
              const itemParts: string[] = [];
              item.forEach((child) => {
                const text = serializeInline(child);
                if (!text.trim()) return;
                if (child.type.name === 'heading') {
                  const level = child.attrs.level || 1;
                  itemParts.push('#'.repeat(level) + ' ' + text);
                } else {
                  itemParts.push(text);
                }
              });
              if (itemParts.length > 0) lines.push(marker + itemParts.join(' '));
            });
          } else if (typeName === 'blockquote') {
            // Serialize blockquote children, prefix each line with >
            const innerLines: string[] = [];
            block.forEach((child) => {
              const text = serializeInline(child);
              if (text.trim()) innerLines.push(text);
            });
            if (innerLines.length > 0) lines.push('> ' + innerLines.join(' '));
          } else if (typeName === 'code_block') {
            lines.push('`' + block.textContent + '`');
          } else if (typeName === 'horizontal_rule') {
            lines.push('---');
          } else {
            // Fallback: extract text content
            const text = block.textContent;
            if (text.trim()) lines.push(text);
          }
        });
        // Escape pipe characters, join with <br>
        return lines.join(' <br> ').replace(/\|/g, '\\|');
      }

      function serializeCell(cell: PMNode): string {
        return serializeBlocks(cell);
      }

      function serializeHtmlTable(tableNode: PMNode) {
        // Collect column widths from first row
        const firstRow = tableNode.child(0);
        const colWidths: (number | null)[] = [];
        firstRow.forEach((cell) => {
          const cw = cell.attrs.colwidth;
          if (cw && Array.isArray(cw)) {
            cw.forEach((w: number) => colWidths.push(w > 0 ? w : null));
          } else {
            for (let c = 0; c < (cell.attrs.colspan || 1); c++) colWidths.push(null);
          }
        });

        let html = '<table>\n';

        // Colgroup for widths
        if (colWidths.some((w) => w !== null)) {
          html += '<colgroup>';
          for (const w of colWidths) {
            html += w ? `<col style="width: ${w}px" />` : '<col />';
          }
          html += '</colgroup>\n';
        }

        tableNode.forEach((row) => {
          html += '<tr>';
          row.forEach((cell) => {
            const isHeader = cell.type.name === 'table_header';
            const tag = isHeader ? 'th' : 'td';
            const attrs: string[] = [];
            if (cell.attrs.colspan > 1) attrs.push(`colspan="${cell.attrs.colspan}"`);
            if (cell.attrs.rowspan > 1) attrs.push(`rowspan="${cell.attrs.rowspan}"`);
            const styles: string[] = [];
            if (cell.attrs.background) styles.push(`background-color: ${cell.attrs.background}`);
            if (cell.attrs.alignment) styles.push(`text-align: ${cell.attrs.alignment}`);
            if (styles.length) attrs.push(`style="${styles.join('; ')}"`);

            const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
            const content = serializeBlocks(cell);
            html += `<${tag}${attrStr}>${content}</${tag}>`;
          });
          html += '</tr>\n';
        });

        html += '</table>\n\n';
        state.write(html);
      }

      // Use HTML table if any cell has attributes that GFM can't represent
      if (needsHtmlTable(node)) {
        serializeHtmlTable(node);
        return;
      }

      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => { cells.push(serializeCell(cell)); });
        rows.push(cells);
      });
      if (rows.length === 0) return;
      const colCount = rows[0]?.length || 0;

      // Build alignment separators from header cell attributes
      const alignSeps: string[] = [];
      node.child(0).forEach((cell) => {
        const align = cell.attrs?.alignment;
        if (align === 'left') alignSeps.push(':---');
        else if (align === 'center') alignSeps.push(':---:');
        else if (align === 'right') alignSeps.push('---:');
        else alignSeps.push('---');
      });
      while (alignSeps.length < colCount) alignSeps.push('---');

      state.write('| ' + rows[0].join(' | ') + ' |\n');
      state.write('| ' + alignSeps.join(' | ') + ' |\n');
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
    content_link(state, node) {
      const title = node.attrs.title || node.attrs.contentId;
      state.write(`[${title}](/content?id=${encodeURIComponent(node.attrs.contentId)})`);
    },
    diagram_embed(state, node) {
      const id = node.attrs.diagramId || '';
      const title = (node.attrs.title || 'Untitled Diagram').replace(/"/g, '&quot;');
      state.write(`<div class="diagram-embed-node" data-diagram-id="${id}" data-title="${title}"></div>`);
      state.closeBlock(node);
    },
  },
  {
    em: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    strong: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    underline: { open: '<u>', close: '</u>', mixable: true, expelEnclosingWhitespace: true },
    strikethrough: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    link: {
      open(_state, mark) { return '['; },
      close(_state, mark) { return `](${mark.attrs.href}${mark.attrs.title ? ` "${mark.attrs.title}"` : ''})`; },
    },
    code: { open: '`', close: '`', escape: false },
    highlight: {
      open(state: any, mark: any) {
        if (mark.attrs.color) {
          return `<mark style="background-color: ${mark.attrs.color}" data-color="${mark.attrs.color}">`;
        }
        return '==';
      },
      close(state: any, mark: any) {
        if (mark.attrs.color) {
          return '</mark>';
        }
        return '==';
      },
    },
  }
);

export function serializeMarkdown(doc: PMNode): string {
  let md = markdownSerializer.serialize(doc);
  // Remove trailing backslash-newlines that accumulate from hard_break round-trips
  md = md.replace(/\\(\n)+$/, '\n');
  return md;
}
