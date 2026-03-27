/**
 * Keyboard shortcuts for the editor.
 */
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands, exitCode, joinUp, joinDown, lift, selectParentNode, deleteSelection, joinBackward, selectNodeBackward, joinForward, selectNodeForward, newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock } from 'prosemirror-commands';
import { TextSelection, NodeSelection } from 'prosemirror-state';
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
  const LIST_NAMES = new Set(['bullet_list', 'ordered_list', 'checkbox_list']);

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

  if (!listItem || !nodeType) {
    // Check if cursor is at a boundary inside a list (but not in any list_item)
    // This happens when cursor lands between heading and list's first item
    for (let d = $from.depth; d >= 1; d--) {
      const node = $from.node(d);
      if (LIST_NAMES.has(node.type.name)) {
        // Cursor is inside a list but not in a list_item — insert a new empty item
        if (dispatch) {
          const itemType = node.type === schema.nodes.checkbox_list
            ? schema.nodes.checkbox_item : schema.nodes.list_item;
          const newItem = itemType.create(
            node.type === schema.nodes.checkbox_list ? { checked: false } : null,
            schema.nodes.paragraph.create(),
          );
          const tr = state.tr.insert($from.pos, newItem);
          // Place cursor inside the new item's paragraph
          tr.setSelection(TextSelection.create(tr.doc, $from.pos + 2));
          dispatch(tr.scrollIntoView());
        }
        return true;
      }
    }
    return false;
  }

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
 * Smart Backspace for list items: when cursor is at the very start of a list
 * item, lift it out (outdent) instead of using joinBackward which can cause
 * destructive merges with complex nested list content.
 */
function smartListBackspace(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parentOffset !== 0) return false;

  // Find enclosing list_item or checkbox_item
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.list_item || node.type === schema.nodes.checkbox_item) {
      // Check if cursor is at the very start of the list item
      let atStart = true;
      for (let dd = d + 1; dd <= $from.depth; dd++) {
        if ($from.index(dd - 1) !== 0) { atStart = false; break; }
      }
      if (!atStart) return false;

      // Lift the list item out one level (empty → becomes paragraph, non-empty → outdents)
      return liftListItem(node.type)(state, dispatch);
    }
  }
  return false;
}

/**
 * Recursively find the end position of the deepest last paragraph in a node tree.
 * Walks: list → last list_item → last child (if it's a list, recurse; if paragraph, return end).
 */
function findDeepestLastParagraphEnd(doc: any, node: any, nodePos: number): number {
  const LIST_NAMES = new Set(['bullet_list', 'ordered_list', 'checkbox_list']);
  const ITEM_NAMES = new Set(['list_item', 'checkbox_item']);

  if (node.type.name === 'paragraph' || node.type.name === 'heading') {
    // Return the end of content inside this paragraph
    return nodePos + 1 + node.content.size;
  }

  if (LIST_NAMES.has(node.type.name)) {
    // Go to last list_item
    const lastItem = node.child(node.childCount - 1);
    let childPos = nodePos + 1; // inside list
    for (let i = 0; i < node.childCount - 1; i++) {
      childPos += node.child(i).nodeSize;
    }
    return findDeepestLastParagraphEnd(doc, lastItem, childPos);
  }

  if (ITEM_NAMES.has(node.type.name)) {
    // Last child of list_item — could be paragraph or nested list
    const lastChild = node.child(node.childCount - 1);
    let childPos = nodePos + 1; // inside list_item
    for (let i = 0; i < node.childCount - 1; i++) {
      childPos += node.child(i).nodeSize;
    }
    return findDeepestLastParagraphEnd(doc, lastChild, childPos);
  }

  // Fallback: return end of this node's content
  return nodePos + 1 + node.content.size;
}

/**
 * Prevent joinBackward from merging a paragraph back into a preceding list.
 * joinBackward would re-wrap the paragraph as a new list item, causing cycling.
 *
 * - Empty paragraph after list: delete the paragraph, cursor to end of last list item.
 * - Non-empty paragraph after list: join content into the last list item's last paragraph.
 */
function preventJoinIntoList(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parentOffset !== 0) return false;
  // Must be a direct child of doc (top-level paragraph)
  if ($from.depth !== 1) return false;
  const currentBlock = $from.parent;
  if (currentBlock.type !== schema.nodes.paragraph) return false;
  // Previous sibling must be a list
  const topIndex = $from.index(0);
  if (topIndex === 0) return false;
  const prevBlock = state.doc.child(topIndex - 1);
  const isListType = prevBlock.type === schema.nodes.ordered_list
    || prevBlock.type === schema.nodes.bullet_list
    || prevBlock.type === schema.nodes.checkbox_list;
  if (!isListType) return false;

  if (dispatch) {
    const blockStart = $from.before(1);
    const blockEnd = $from.after(1);

    if (currentBlock.content.size === 0) {
      // Empty paragraph: just delete it and move cursor to end of last list item
      const tr = state.tr.delete(blockStart, blockEnd);
      const $pos = tr.doc.resolve(Math.max(0, blockStart));
      const sel = TextSelection.findFrom($pos, -1);
      if (sel) tr.setSelection(sel);
      dispatch(tr.scrollIntoView());
    } else {
      // Non-empty paragraph: append its content to the deepest last paragraph in the list.
      // Must recursively descend through nested lists to find the actual last text paragraph.

      // Find the deepest last paragraph position by walking the tree
      let joinPos = findDeepestLastParagraphEnd(state.doc, prevBlock, blockStart - prevBlock.nodeSize);
      if (joinPos < 0) return false; // shouldn't happen

      const tr = state.tr;
      tr.insert(joinPos, currentBlock.content);
      const newBlockStart = tr.mapping.map(blockStart);
      const newBlockEnd = tr.mapping.map(blockEnd);
      tr.delete(newBlockStart, newBlockEnd);
      const cursorPos = tr.mapping.map(joinPos, -1);
      tr.setSelection(TextSelection.create(tr.doc, cursorPos));
      dispatch(tr.scrollIntoView());
    }
  }
  return true;
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
 * Delete any empty block (paragraph, heading, etc.) when Backspace is pressed at its start.
 * Works at any nesting depth (top-level, inside list items, blockquotes, etc.).
 * Only fires when the block is completely empty and there's a previous sibling or parent to fall back to.
 */
function deleteEmptyBlock(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection;
  if (!empty) return false;

  const parent = $from.parent;

  if ($from.parentOffset !== 0) return false; // cursor must be at start

  // Check if block is truly empty (no content, or only whitespace/hard_breaks)
  const isEffectivelyEmpty = parent.content.size === 0 ||
    (parent.childCount === 1 && parent.firstChild?.type.name === 'hard_break') ||
    (parent.isTextblock && parent.textContent.trim() === '' && !parent.firstChild?.type.isAtom);

  if (!isEffectivelyEmpty) return false;

  // Find the depth at which this empty block sits as a child
  for (let d = $from.depth; d >= 1; d--) {
    const indexInParent = $from.index(d - 1);
    const parentNode = $from.node(d - 1);

    // Can only delete if there's a previous sibling or this isn't the only child
    // Don't delete the only/first child of a list_item or checkbox_item (required by schema)
    const parentType = parentNode.type.name;
    if ((parentType === 'list_item' || parentType === 'checkbox_item') && indexInParent === 0) {
      // First child of list item — this is the required paragraph, can't delete it directly
      // But if the list item has other children, we can merge this into the previous list item
      // Let other handlers (smartListBackspace) deal with it
      return false;
    }

    if (indexInParent > 0) {
      // There's a previous sibling — delete this empty block
      if (dispatch) {
        const deleteFrom = $from.before(d);
        const deleteTo = $from.after(d);
        const tr = state.tr.delete(deleteFrom, deleteTo);
        // Place cursor at end of previous sibling
        const mappedPos = tr.mapping.map(deleteFrom);
        const clampedPos = Math.min(mappedPos, tr.doc.content.size);
        const $pos = tr.doc.resolve(clampedPos);
        const sel = TextSelection.findFrom($pos, -1, true);
        if (sel) tr.setSelection(sel);
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    // indexInParent === 0 — check if we can delete at a higher level
    // If parent has only this one child and parent itself can be deleted
    if (d === 1 && state.doc.childCount <= 1) return false;
  }

  return false;
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

  const { $from, empty } = selection;

  // Case 1: Cursor is in an EMPTY block and previous sibling contains an image
  // → delete the empty block AND select the image. Must come before Case 2
  // because ProseMirror's $cursor.nodeBefore can resolve across block boundaries
  // to the image, causing Case 2 to fire without deleting the empty block.
  if (empty && $from.parentOffset === 0 && $from.parent.content.size === 0) {
    // Find previous sibling at any depth
    let prevNode: any = null;
    let prevPos = -1;
    let deleteFrom = -1;
    let deleteTo = -1;

    for (let d = $from.depth; d >= 1; d--) {
      const indexInParent = $from.index(d - 1);
      if (indexInParent > 0) {
        const parent = $from.node(d - 1);
        prevNode = parent.child(indexInParent - 1);
        let p = $from.before(d - 1) + 1;
        for (let i = 0; i < indexInParent - 1; i++) {
          p += parent.child(i).nodeSize;
        }
        prevPos = p;
        deleteFrom = $from.before(d);
        deleteTo = $from.after(d);
        break;
      }
    }

    if (prevNode) {
      let hasImage = false;
      prevNode.descendants((node: any) => {
        if (node.type === schema.nodes.image) hasImage = true;
        return !hasImage;
      });

      if (hasImage && dispatch) {
        const tr = state.tr.delete(deleteFrom, deleteTo);
        const mappedPrevPos = tr.mapping.map(prevPos);
        let imagePos = -1;
        tr.doc.nodeAt(mappedPrevPos)?.descendants((node: any, pos: number) => {
          if (node.type === schema.nodes.image && imagePos === -1) {
            imagePos = mappedPrevPos + 1 + pos;
          }
          return imagePos === -1;
        });
        if (imagePos >= 0) {
          try {
            tr.setSelection(NodeSelection.create(tr.doc, imagePos));
          } catch {
            // fallback: place cursor at end of previous block
            const $pos = tr.doc.resolve(Math.max(0, tr.mapping.map(deleteFrom)));
            const sel = TextSelection.findFrom($pos, -1);
            if (sel) tr.setSelection(sel);
          }
        }
        dispatch(tr.scrollIntoView());
        return true;
      }
      if (hasImage) return true; // block the backspace even without dispatch
    }
  }

  // Case 2: Cursor is right after an inline image atom (same paragraph, non-empty)
  if (selection instanceof TextSelection) {
    const { $cursor } = selection;
    if ($cursor) {
      const nodeBefore = $cursor.nodeBefore;
      const nodeAfter = $cursor.nodeAfter;

      if (nodeBefore?.isAtom && nodeBefore.isInline && nodeBefore.type === schema.nodes.image) {
        // If the image is the ONLY content in this paragraph, and there's a previous sibling,
        // join this paragraph into the previous one (moving the image to end of prev paragraph).
        // This eliminates the "undeletable empty line" that is actually an image-only paragraph.
        const parentBlock = $cursor.parent;
        const isImageOnly = parentBlock.childCount === 1 && parentBlock.firstChild?.type === schema.nodes.image;
        if (isImageOnly) {
          // Find previous sibling at current depth
          for (let d = $cursor.depth; d >= 1; d--) {
            const idx = $cursor.index(d - 1);
            if (idx > 0) {
              if (dispatch) {
                // Use joinBackward-like behavior: delete the boundary between this block and previous
                const blockStart = $cursor.before(d);
                const tr = state.tr.join(blockStart);
                dispatch(tr.scrollIntoView());
              }
              return true;
            }
          }
        }
        // Default: select the image (protects from accidental deletion)
        if (dispatch) {
          const imagePos = $cursor.pos - nodeBefore.nodeSize;
          dispatch(state.tr.setSelection(NodeSelection.create(state.doc, imagePos)).scrollIntoView());
        }
        return true;
      }

      // Case 2b: text(1 char) before inline atom → delete text only
      if (nodeBefore?.isText && nodeBefore.nodeSize === 1 && nodeAfter?.isAtom && nodeAfter.isInline) {
        if (dispatch) {
          dispatch(state.tr.delete($cursor.pos - 1, $cursor.pos).scrollIntoView());
        }
        return true;
      }
    }
  }

  return false;
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

  // Case 2: Block-level protection — only for direct children of doc (depth === 1)
  const { $from, empty } = selection;
  if (!empty) return false;
  if ($from.depth !== 1) return false;

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
  keys['Enter'] = chainCommands(smartListEnter, newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock);
  // Tab: indent in lists, otherwise just prevent default (keep focus in editor)
  keys['Tab'] = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    if (smartListSink(state, dispatch)) return true;
    // Not in a list — still capture Tab to prevent focus leaving the editor
    return true;
  };
  keys['Shift-Tab'] = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    if (smartListLift(state, dispatch)) return true;
    return true;
  };
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
  keys['Backspace'] = chainCommands(deleteSelection, deleteEmptyBlock, protectAtomOnBackspace, deleteEmptyFirstBlock, smartListBackspace, preventJoinIntoList, joinBackward, selectNodeBackward);

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
