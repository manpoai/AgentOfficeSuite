/**
 * Markdown-style input rules for the editor.
 * Typing "## " auto-converts to heading, "- " to bullet list, etc.
 */
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  InputRule,
} from 'prosemirror-inputrules';
import { schema } from './schema';

// Heading: # ## ### etc
function headingRule(level: number) {
  return textblockTypeInputRule(
    new RegExp(`^(#{1,${level}})\\s$`),
    schema.nodes.heading,
    (match) => ({ level: match[1].length })
  );
}

// Blockquote: > at start
const blockquoteRule = wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote);

// Bullet list: - or * at start
const bulletListRule = wrappingInputRule(/^\s*([-*])\s$/, schema.nodes.bullet_list);

// Ordered list: 1. at start
const orderedListRule = wrappingInputRule(
  /^(\d+)\.\s$/,
  schema.nodes.ordered_list,
  (match) => ({ order: +match[1] }),
  (match, node) => node.childCount + node.attrs.order === +match[1]
);

// Code block: ``` at start
const codeBlockRule = textblockTypeInputRule(/^```(\w+)?\s$/, schema.nodes.code_block, (match) => ({
  language: match[1] || '',
}));

// Horizontal rule: --- at start
const hrRule = new InputRule(/^(?:---|\*\*\*|___)\s$/, (state, match, start, end) => {
  const hr = schema.nodes.horizontal_rule.create();
  const tr = state.tr.replaceWith(start - 1, end, hr);
  return tr;
});

// Checkbox list: [ ] or [x] at start
const checkboxRule = wrappingInputRule(
  /^\s*\[([ x])\]\s$/,
  schema.nodes.checkbox_list,
  undefined,
  undefined
);

export function buildInputRules() {
  return inputRules({
    rules: [
      ...smartQuotes,
      headingRule(6),
      blockquoteRule,
      bulletListRule,
      orderedListRule,
      codeBlockRule,
      hrRule,
    ],
  });
}
