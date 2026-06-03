import crypto from 'crypto';

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function isBlockNode(node) {
  return !!node && typeof node === 'object' && typeof node.type === 'string' && node.type !== 'text';
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function ensureTopLevelBlockIds(docJson) {
  const next = clone(docJson) || { type: 'doc', content: [] };
  const content = ensureArray(next.content);
  let changed = false;

  next.content = content.map((node) => {
    if (!isBlockNode(node)) return node;
    const attrs = { ...(node.attrs || {}) };
    if (!attrs.blockId) {
      attrs.blockId = crypto.randomUUID();
      changed = true;
    }
    return { ...node, attrs };
  });

  return { doc: next, changed };
}

export function listTopLevelBlocks(docJson, { previewLength = 160 } = {}) {
  const { doc } = ensureTopLevelBlockIds(docJson);
  const content = ensureArray(doc.content);
  return content
    .filter(isBlockNode)
    .map((node, index) => ({
      block_id: node.attrs?.blockId || null,
      type: node.type,
      index,
      text_preview: extractNodeText(node).slice(0, previewLength),
      child_count: Array.isArray(node.content) ? node.content.length : 0,
      heading_level: node.type === 'heading' ? node.attrs?.level || null : null,
    }));
}

export function replaceTopLevelBlock(docJson, blockId, replacementNode) {
  if (!blockId) throw new Error('blockId required');
  if (!isBlockNode(replacementNode)) throw new Error('replacementNode must be a ProseMirror block node');

  const { doc } = ensureTopLevelBlockIds(docJson);
  const content = ensureArray(doc.content);
  const index = content.findIndex((node) => node?.attrs?.blockId === blockId);
  if (index === -1) {
    const error = new Error(`block not found: ${blockId}`);
    error.code = 'BLOCK_NOT_FOUND';
    throw error;
  }

  const nextNode = clone(replacementNode);
  nextNode.attrs = { ...(nextNode.attrs || {}), blockId };
  const nextContent = [...content];
  nextContent[index] = nextNode;
  return {
    doc: { ...doc, content: nextContent },
    block: nextNode,
    index,
  };
}

/** Insert one or more nodes after the block with the given blockId.
 *  If afterBlockId is null, inserts at the beginning of the document. */
export function insertBlocksAfter(docJson, afterBlockId, newNodes) {
  if (!Array.isArray(newNodes) || newNodes.length === 0) throw new Error('newNodes must be a non-empty array');
  for (const n of newNodes) {
    if (!isBlockNode(n)) throw new Error('each newNode must be a ProseMirror block node');
  }

  const { doc } = ensureTopLevelBlockIds(docJson);
  const content = ensureArray(doc.content);

  // Stamp fresh blockIds onto each new node
  const stamped = newNodes.map(n => {
    const node = clone(n);
    node.attrs = { ...(node.attrs || {}), blockId: crypto.randomUUID() };
    return node;
  });

  let insertAt;
  if (afterBlockId === null || afterBlockId === undefined) {
    insertAt = 0;
  } else {
    const index = content.findIndex(node => node?.attrs?.blockId === afterBlockId);
    if (index === -1) {
      const error = new Error(`block not found: ${afterBlockId}`);
      error.code = 'BLOCK_NOT_FOUND';
      throw error;
    }
    insertAt = index + 1;
  }

  const nextContent = [...content.slice(0, insertAt), ...stamped, ...content.slice(insertAt)];
  return {
    doc: { ...doc, content: nextContent },
    inserted: stamped,
    at_index: insertAt,
  };
}

/** Append one or more nodes at the end of the document. */
export function appendBlocks(docJson, newNodes) {
  if (!Array.isArray(newNodes) || newNodes.length === 0) throw new Error('newNodes must be a non-empty array');
  const { doc } = ensureTopLevelBlockIds(docJson);
  const content = ensureArray(doc.content);

  const stamped = newNodes.map(n => {
    const node = clone(n);
    node.attrs = { ...(node.attrs || {}), blockId: crypto.randomUUID() };
    return node;
  });

  return {
    doc: { ...doc, content: [...content, ...stamped] },
    inserted: stamped,
    at_index: content.length,
  };
}

/** Delete the top-level block with the given blockId. */
export function deleteTopLevelBlock(docJson, blockId) {
  if (!blockId) throw new Error('blockId required');

  const { doc } = ensureTopLevelBlockIds(docJson);
  const content = ensureArray(doc.content);
  const index = content.findIndex(node => node?.attrs?.blockId === blockId);
  if (index === -1) {
    const error = new Error(`block not found: ${blockId}`);
    error.code = 'BLOCK_NOT_FOUND';
    throw error;
  }

  const deleted = content[index];
  const nextContent = [...content.slice(0, index), ...content.slice(index + 1)];
  return {
    doc: { ...doc, content: nextContent },
    deleted_block_id: blockId,
    index,
    deleted,
  };
}

export function extractPlainText(docJson) {
  return extractNodeText(docJson);
}

function extractNodeText(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  const children = ensureArray(node.content);
  return children.map(extractNodeText).join('');
}
