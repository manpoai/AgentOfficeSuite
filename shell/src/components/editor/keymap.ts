/**
 * Keyboard shortcuts for the editor.
 */
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands, exitCode, joinUp, joinDown, lift, selectParentNode, deleteSelection, joinBackward, selectNodeBackward, joinForward, selectNodeForward } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import type { EditorState, Transaction } from 'prosemirror-state';
import { schema } from './schema';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/**
 * Smart Enter for list items: if the current list item is empty, lift it out
 * (outdent). Otherwise split normally. Works for both list_item and checkbox_item.
 */
function smartListEnter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from } = state.selection;
  // Walk up the depth to find list_item or checkbox_item
  let nodeType = null;
  let listItem = null;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.list_item || node.type === schema.nodes.checkbox_item) {
      listItem = node;
      nodeType = node.type;
      break;
    }
  }
  if (!listItem || !nodeType) return false;

  // Check if the list item content is empty (just an empty paragraph)
  if (listItem.childCount === 1 && listItem.firstChild!.type === schema.nodes.paragraph && listItem.firstChild!.content.size === 0) {
    // Lift out one level (outdent or exit list)
    return liftListItem(nodeType)(state, dispatch);
  }

  // Otherwise, split normally (continue list with new item)
  return splitListItem(nodeType)(state, dispatch);
}

/**
 * Smart Tab for list items: works for both list_item and checkbox_item.
 */
function smartListSink(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.list_item) return sinkListItem(schema.nodes.list_item)(state, dispatch);
    if (node.type === schema.nodes.checkbox_item) return sinkListItem(schema.nodes.checkbox_item)(state, dispatch);
  }
  return false;
}

/**
 * Smart Shift-Tab for list items: works for both list_item and checkbox_item.
 */
function smartListLift(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.list_item) return liftListItem(schema.nodes.list_item)(state, dispatch);
    if (node.type === schema.nodes.checkbox_item) return liftListItem(schema.nodes.checkbox_item)(state, dispatch);
  }
  return false;
}

/**
 * Item 7: Delete empty first line in body.
 * When cursor is at the start of the first block and it's empty,
 * delete that block (if there's a next block to move to).
 */
function deleteEmptyFirstBlock(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  // Must be at the very start of the first child of doc
  if ($from.depth < 1) return false;
  const parentIndex = $from.index($from.depth - 1);
  // $from.parentOffset must be 0 (cursor at start of block)
  if ($from.parentOffset !== 0) return false;
  // Must be in the first top-level block
  const topIndex = $from.index(0);
  if (topIndex !== 0) return false;
  // The top-level block must be empty
  const topNode = state.doc.child(0);
  if (topNode.content.size > 0) return false;
  // Must have at least one more block after it
  if (state.doc.childCount < 2) return false;
  if (dispatch) {
    const tr = state.tr.delete(0, topNode.nodeSize);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * Protect inline atoms (images) from accidental deletion via Backspace.
 * Based on Outline's DeleteNearAtom extension (GitHub Issue #10681).
 *
 * Handles two cases:
 * 1. Inline case: cursor is right after a single-char text node, and the node
 *    after cursor is an inline atom → delete only the text character.
 * 2. Block case: cursor is at start of empty block, previous block contains
 *    an image → delete the empty block instead of joining.
 */
function protectAtomOnBackspace(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { selection } = state;

  // Case 1: Inline atom protection (Outline's approach)
  if (selection instanceof TextSelection) {
    const { $cursor } = selection;
    if ($cursor) {
      const nodeBefore = $cursor.nodeBefore;
      const nodeAfter = $cursor.nodeAfter;
      // If text node before cursor has only 1 char and after cursor is an inline atom
      if (nodeBefore?.isText && nodeBefore.nodeSize === 1 && nodeAfter?.isAtom && nodeAfter.isInline) {
        if (dispatch) {
          dispatch(state.tr.delete($cursor.pos - 1, $cursor.pos).scrollIntoView());
        }
        return true;
      }
    }
  }

  // Case 2: Block-level protection
  const { $from, empty } = selection;
  if (!empty) return false;
  if ($from.parentOffset !== 0) return false;

  const topIndex = $from.index(0);
  const currentBlock = $from.parent;
  const currentIsEmpty = currentBlock.content.size === 0;

  if (!currentIsEmpty) return false;
  if (topIndex === 0) return false;

  const prevBlock = state.doc.child(topIndex - 1);
  let hasImage = false;
  prevBlock.descendants((node) => {
    if (node.type === schema.nodes.image) hasImage = true;
    return !hasImage;
  });

  if (!hasImage) return false;

  if (dispatch) {
    let blockStart = 0;
    for (let i = 0; i < topIndex; i++) {
      blockStart += state.doc.child(i).nodeSize;
    }
    const blockEnd = blockStart + state.doc.child(topIndex).nodeSize;
    dispatch(state.tr.delete(blockStart, blockEnd).scrollIntoView());
  }
  return true;
}

/**
 * Protect inline atoms (images) from accidental deletion via Delete (forward).
 * Handles two cases:
 * 1. Inline case: cursor is at start of a single-char text node, and the node
 *    after that text is an inline atom → delete only the text character.
 * 2. Block case: cursor is at end of block, next block contains an image →
 *    if current block is empty, delete it; otherwise block the join.
 */
function protectAtomOnDelete(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { selection } = state;

  // Case 1: Inline atom protection (Outline's approach)
  if (selection instanceof TextSelection) {
    const { $cursor } = selection;
    if ($cursor && $cursor.textOffset === 0) {
      const nodeAfter = $cursor.nodeAfter;
      if (nodeAfter?.isText && nodeAfter.nodeSize === 1) {
        const textEndPos = $cursor.pos + nodeAfter.nodeSize;
        if (textEndPos < $cursor.end()) {
          const $afterText = state.doc.resolve(textEndPos);
          const nodeAfterText = $afterText.nodeAfter;
          if (nodeAfterText?.isAtom && nodeAfterText.isInline) {
            if (dispatch) {
              dispatch(state.tr.delete($cursor.pos, $cursor.pos + 1).scrollIntoView());
            }
            return true;
          }
        }
      }
    }
  }

  // Case 2: Block-level protection
  const { $from, empty } = selection;
  if (!empty) return false;

  const topIndex = $from.index(0);
  const atEnd = $from.parentOffset === $from.parent.content.size;

  if (atEnd && topIndex < state.doc.childCount - 1) {
    const nextBlock = state.doc.child(topIndex + 1);
    let hasImage = false;
    nextBlock.descendants((node) => {
      if (node.type === schema.nodes.image) hasImage = true;
      return !hasImage;
    });

    if (hasImage) {
      if ($from.parent.content.size === 0 && dispatch) {
        let blockStart = 0;
        for (let i = 0; i < topIndex; i++) {
          blockStart += state.doc.child(i).nodeSize;
        }
        const blockEnd = blockStart + state.doc.child(topIndex).nodeSize;
        dispatch(state.tr.delete(blockStart, blockEnd).scrollIntoView());
      }
      return true;
    }
  }

  return false;
}

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

  // Lists — smart handlers for both list_item and checkbox_item
  keys['Enter'] = smartListEnter;
  keys['Tab'] = smartListSink;
  keys['Shift-Tab'] = smartListLift;
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

  // Backspace: custom handlers before default behavior
  keys['Backspace'] = chainCommands(deleteSelection, protectAtomOnBackspace, deleteEmptyFirstBlock, joinBackward, selectNodeBackward);

  // Delete (forward): protect images from forward-delete joining
  keys['Delete'] = chainCommands(deleteSelection, protectAtomOnDelete, joinForward, selectNodeForward);

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
