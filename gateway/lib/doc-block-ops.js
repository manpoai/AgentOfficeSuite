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

export function listTopLevelBlocks(docJson) {
  const { doc } = ensureTopLevelBlockIds(docJson);
  const content = ensureArray(doc.content);
  return content
    .filter(isBlockNode)
    .map((node, index) => ({
      block_id: node.attrs?.blockId || null,
      type: node.type,
      index,
      text_preview: extractNodeText(node).slice(0, 160),
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

export function extractPlainText(docJson) {
  return extractNodeText(docJson);
}

function extractNodeText(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  const children = ensureArray(node.content);
  return children.map(extractNodeText).join('');
}
