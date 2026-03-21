/**
 * Keyboard shortcuts for the editor.
 */
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands, exitCode, joinUp, joinDown, lift, selectParentNode } from 'prosemirror-commands';
import { undo, redo } from 'prosemirror-history';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { schema } from './schema';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export function buildKeymap() {
  const keys: Record<string, any> = {};

  // History
  keys['Mod-z'] = undo;
  keys['Mod-Shift-z'] = redo;
  if (!isMac) keys['Mod-y'] = redo;

  // Marks
  keys['Mod-b'] = toggleMark(schema.marks.strong);
  keys['Mod-i'] = toggleMark(schema.marks.em);
  keys['Mod-u'] = toggleMark(schema.marks.underline);
  keys['Mod-Shift-s'] = toggleMark(schema.marks.strikethrough);
  keys['Mod-e'] = toggleMark(schema.marks.code);
  keys['Mod-Shift-h'] = toggleMark(schema.marks.highlight);

  // Block types
  keys['Mod-Shift-0'] = setBlockType(schema.nodes.paragraph);
  keys['Mod-Shift-1'] = setBlockType(schema.nodes.heading, { level: 1 });
  keys['Mod-Shift-2'] = setBlockType(schema.nodes.heading, { level: 2 });
  keys['Mod-Shift-3'] = setBlockType(schema.nodes.heading, { level: 3 });

  // Lists
  keys['Enter'] = splitListItem(schema.nodes.list_item);
  keys['Tab'] = sinkListItem(schema.nodes.list_item);
  keys['Shift-Tab'] = liftListItem(schema.nodes.list_item);
  keys['Mod-Shift-7'] = wrapIn(schema.nodes.ordered_list);
  keys['Mod-Shift-8'] = wrapIn(schema.nodes.bullet_list);

  // Blockquote
  keys['Mod-Shift-9'] = wrapIn(schema.nodes.blockquote);

  // Code block
  keys['Mod-Shift-\\'] = setBlockType(schema.nodes.code_block);

  // Exit code block with Enter
  keys['Shift-Enter'] = chainCommands(exitCode, (state, dispatch) => {
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    }
    return true;
  });

  // Structural
  keys['Alt-ArrowUp'] = joinUp;
  keys['Alt-ArrowDown'] = joinDown;
  keys['Mod-BracketLeft'] = lift;
  keys['Escape'] = selectParentNode;

  return keymap(keys);
}

export function buildBaseKeymap() {
  return keymap(baseKeymap);
}
