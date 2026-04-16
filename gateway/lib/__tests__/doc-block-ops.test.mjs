/**
 * Tests for doc-block-ops.js (3.3E)
 * Covers: replace, insert, append, delete, blockId migration, comment anchor preservation
 * Run from gateway/ dir: node lib/__tests__/doc-block-ops.test.mjs
 */

import {
  ensureTopLevelBlockIds,
  listTopLevelBlocks,
  replaceTopLevelBlock,
  insertBlocksAfter,
  appendBlocks,
  deleteTopLevelBlock,
} from '../doc-block-ops.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg || 'expected equality'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
}
function assertThrows(fn, msgFragment) {
  try { fn(); } catch (err) {
    if (msgFragment && !err.message.includes(msgFragment) && err.code !== msgFragment) {
      throw new Error(`expected error containing "${msgFragment}", got "${err.message}"`);
    }
    return;
  }
  throw new Error('expected an error but none was thrown');
}

// ── Fixtures ──

function makeDoc(...blocks) {
  return {
    type: 'doc',
    content: blocks.map((b, i) => ({
      type: 'paragraph',
      attrs: { blockId: `block-${i + 1}` },
      content: [{ type: 'text', text: b }],
    })),
  };
}

function makeDocNoIds(...blocks) {
  return {
    type: 'doc',
    content: blocks.map(b => ({
      type: 'paragraph',
      content: [{ type: 'text', text: b }],
    })),
  };
}

function paragraphNode(text) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

// ── ensureTopLevelBlockIds ──

test('ensureTopLevelBlockIds: assigns blockIds to nodes that lack them', () => {
  const doc = makeDocNoIds('Hello', 'World');
  const { doc: result, changed } = ensureTopLevelBlockIds(doc);
  assert(changed, 'should report changed=true');
  for (const node of result.content) {
    assert(node.attrs?.blockId, 'every node should have a blockId after migration');
  }
});

test('ensureTopLevelBlockIds: preserves existing blockIds', () => {
  const doc = makeDoc('A', 'B');
  const { doc: result, changed } = ensureTopLevelBlockIds(doc);
  assert(!changed, 'should report changed=false when all ids present');
  assertEq(result.content[0].attrs.blockId, 'block-1', 'block-1 preserved');
  assertEq(result.content[1].attrs.blockId, 'block-2', 'block-2 preserved');
});

test('ensureTopLevelBlockIds: handles null/empty doc gracefully', () => {
  const { doc } = ensureTopLevelBlockIds(null);
  assert(doc.type === 'doc', 'returns a doc node');
  assertEq(doc.content, [], 'empty content');
});

test('ensureTopLevelBlockIds: assigned IDs are unique', () => {
  const doc = makeDocNoIds('A', 'B', 'C', 'D', 'E');
  const { doc: result } = ensureTopLevelBlockIds(doc);
  const ids = result.content.map(n => n.attrs?.blockId);
  const unique = new Set(ids);
  assertEq(unique.size, ids.length, 'all blockIds must be unique');
});

// ── listTopLevelBlocks ──

test('listTopLevelBlocks: returns correct block metadata', () => {
  const doc = makeDoc('Alpha', 'Beta');
  const blocks = listTopLevelBlocks(doc);
  assertEq(blocks.length, 2, 'two blocks');
  assertEq(blocks[0].block_id, 'block-1');
  assertEq(blocks[0].type, 'paragraph');
  assertEq(blocks[0].index, 0);
  assert(blocks[0].text_preview.includes('Alpha'), 'preview contains text');
});

test('listTopLevelBlocks: heading_level populated for heading nodes', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { blockId: 'h1', level: 2 }, content: [{ type: 'text', text: 'Title' }] },
    ],
  };
  const blocks = listTopLevelBlocks(doc);
  assertEq(blocks[0].heading_level, 2);
});

// ── replaceTopLevelBlock ──

test('replaceTopLevelBlock: replaces correct block, preserves others', () => {
  const doc = makeDoc('A', 'B', 'C');
  const replacement = paragraphNode('B-updated');
  const { doc: result } = replaceTopLevelBlock(doc, 'block-2', replacement);
  assertEq(result.content.length, 3, 'still 3 blocks');
  assertEq(result.content[0].attrs.blockId, 'block-1', 'block-1 unchanged');
  assertEq(result.content[2].attrs.blockId, 'block-3', 'block-3 unchanged');
  // replaced block preserves the original blockId
  assertEq(result.content[1].attrs.blockId, 'block-2', 'blockId preserved on replacement');
  assert(result.content[1].content[0].text === 'B-updated', 'new text applied');
});

test('replaceTopLevelBlock: other blocks retain their blockIds (comment anchor preservation)', () => {
  const doc = makeDoc('A', 'B', 'C');
  const { doc: result } = replaceTopLevelBlock(doc, 'block-2', paragraphNode('X'));
  // block-1 and block-3 are "human-annotated" — their IDs must survive
  assertEq(result.content[0].attrs.blockId, 'block-1', 'anchor on block-1 preserved');
  assertEq(result.content[2].attrs.blockId, 'block-3', 'anchor on block-3 preserved');
});

test('replaceTopLevelBlock: throws BLOCK_NOT_FOUND for unknown blockId', () => {
  const doc = makeDoc('A', 'B');
  assertThrows(() => replaceTopLevelBlock(doc, 'no-such-block', paragraphNode('X')), 'BLOCK_NOT_FOUND');
});

test('replaceTopLevelBlock: throws if blockId is empty', () => {
  const doc = makeDoc('A');
  assertThrows(() => replaceTopLevelBlock(doc, '', paragraphNode('X')), 'blockId required');
});

// ── insertBlocksAfter ──

test('insertBlocksAfter: inserts after specified block', () => {
  const doc = makeDoc('A', 'B');
  const { doc: result, inserted } = insertBlocksAfter(doc, 'block-1', [paragraphNode('A2')]);
  assertEq(result.content.length, 3);
  assertEq(result.content[0].attrs.blockId, 'block-1');
  assertEq(result.content[1].content[0].text, 'A2');
  assertEq(result.content[2].attrs.blockId, 'block-2');
  assert(inserted[0].attrs.blockId, 'inserted node has a blockId');
});

test('insertBlocksAfter: null afterBlockId inserts at beginning', () => {
  const doc = makeDoc('A', 'B');
  const { doc: result } = insertBlocksAfter(doc, null, [paragraphNode('Start')]);
  assertEq(result.content[0].content[0].text, 'Start');
  assertEq(result.content[1].attrs.blockId, 'block-1');
});

test('insertBlocksAfter: inserts multiple nodes in order', () => {
  const doc = makeDoc('A', 'B');
  const { doc: result } = insertBlocksAfter(doc, 'block-1', [paragraphNode('X'), paragraphNode('Y')]);
  assertEq(result.content.length, 4);
  assertEq(result.content[1].content[0].text, 'X');
  assertEq(result.content[2].content[0].text, 'Y');
});

test('insertBlocksAfter: stamps fresh unique blockIds on new nodes', () => {
  const doc = makeDoc('A');
  const { inserted } = insertBlocksAfter(doc, 'block-1', [paragraphNode('X'), paragraphNode('Y')]);
  assert(inserted[0].attrs.blockId !== inserted[1].attrs.blockId, 'inserted nodes have different blockIds');
});

test('insertBlocksAfter: throws BLOCK_NOT_FOUND for unknown afterBlockId', () => {
  const doc = makeDoc('A');
  assertThrows(() => insertBlocksAfter(doc, 'no-such', [paragraphNode('X')]), 'BLOCK_NOT_FOUND');
});

test('insertBlocksAfter: throws if newNodes is empty', () => {
  const doc = makeDoc('A');
  assertThrows(() => insertBlocksAfter(doc, 'block-1', []), 'non-empty array');
});

// ── appendBlocks ──

test('appendBlocks: appends at end of document', () => {
  const doc = makeDoc('A', 'B');
  const { doc: result, at_index } = appendBlocks(doc, [paragraphNode('C')]);
  assertEq(result.content.length, 3);
  assertEq(result.content[2].content[0].text, 'C');
  assertEq(at_index, 2);
});

test('appendBlocks: preserves existing blockIds', () => {
  const doc = makeDoc('A', 'B');
  const { doc: result } = appendBlocks(doc, [paragraphNode('C')]);
  assertEq(result.content[0].attrs.blockId, 'block-1');
  assertEq(result.content[1].attrs.blockId, 'block-2');
});

test('appendBlocks: assigns blockId to appended node', () => {
  const doc = makeDoc('A');
  const { inserted } = appendBlocks(doc, [paragraphNode('B')]);
  assert(inserted[0].attrs.blockId, 'appended node has blockId');
});

// ── deleteTopLevelBlock ──

test('deleteTopLevelBlock: removes correct block', () => {
  const doc = makeDoc('A', 'B', 'C');
  const { doc: result, deleted_block_id } = deleteTopLevelBlock(doc, 'block-2');
  assertEq(result.content.length, 2);
  assertEq(result.content[0].attrs.blockId, 'block-1');
  assertEq(result.content[1].attrs.blockId, 'block-3');
  assertEq(deleted_block_id, 'block-2');
});

test('deleteTopLevelBlock: comment anchors on other blocks survive deletion', () => {
  const doc = makeDoc('A', 'B', 'C');
  const { doc: result } = deleteTopLevelBlock(doc, 'block-2');
  // block-1 and block-3 are untouched — their anchor IDs preserved
  assertEq(result.content[0].attrs.blockId, 'block-1');
  assertEq(result.content[1].attrs.blockId, 'block-3');
});

test('deleteTopLevelBlock: throws BLOCK_NOT_FOUND for unknown blockId', () => {
  const doc = makeDoc('A', 'B');
  assertThrows(() => deleteTopLevelBlock(doc, 'ghost'), 'BLOCK_NOT_FOUND');
});

test('deleteTopLevelBlock: throws if blockId is empty', () => {
  const doc = makeDoc('A');
  assertThrows(() => deleteTopLevelBlock(doc, ''), 'blockId required');
});

// ── Migration integration: no-id doc round-trip ──

test('Migration: doc without blockIds can be listed after ensureTopLevelBlockIds', () => {
  const doc = makeDocNoIds('Intro', 'Body', 'Conclusion');
  const { doc: migrated } = ensureTopLevelBlockIds(doc);
  const blocks = listTopLevelBlocks(migrated);
  assertEq(blocks.length, 3);
  for (const b of blocks) {
    assert(b.block_id, 'every block has an id after migration');
  }
});

test('Migration: can replace a block after migrating a no-id doc', () => {
  const doc = makeDocNoIds('A', 'B');
  const { doc: migrated } = ensureTopLevelBlockIds(doc);
  const blocks = listTopLevelBlocks(migrated);
  const { doc: result } = replaceTopLevelBlock(migrated, blocks[1].block_id, paragraphNode('B-new'));
  assertEq(result.content[1].content[0].text, 'B-new');
});

console.log(`\n[doc-block-ops] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
