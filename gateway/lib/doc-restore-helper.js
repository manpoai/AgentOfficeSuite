/**
 * Shared doc restore logic — used by both docs.js and content.js restore endpoints.
 * Single source of truth for doc restore semantics.
 */
import { createSnapshot } from './snapshot-helper.js';

/**
 * Extract plain text from ProseMirror JSON.
 */
export function extractTextFromProseMirror(pmData) {
  if (!pmData) return '';
  const extract = (node) => {
    if (node.text) return node.text;
    if (node.content) return node.content.map(extract).join('');
    return '';
  };
  return extract(pmData);
}

/**
 * Restore a doc from a snapshot revision.
 * Updates documents table + content_items + creates pre_restore snapshot.
 *
 * @param {object} db - SQLite database
 * @param {object} deps - { genId }
 * @param {object} params
 * @param {string} params.docId - document ID (e.g. "doc_xxx")
 * @param {object} params.revision - content_snapshots row
 * @param {string} params.actorName - display name of actor performing restore
 * @returns {object|null} { data, document } - restored ProseMirror data + updated document row
 */
export function restoreDocFromSnapshot(db, deps, { docId, revision, actorName }) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(docId);
  if (!doc) return null;

  // 1. Save current state as pre_restore
  const preRestoreData = doc.data_json
    ? JSON.parse(doc.data_json)
    : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.text || '' }] }] };
  createSnapshot(db, deps, {
    contentType: 'doc',
    contentId: docId,
    data: preRestoreData,
    triggerType: 'pre_restore',
    actorId: doc.updated_by || doc.created_by,
    title: doc.title,
  });

  // 2. Parse revision data
  let revData = null;
  try { revData = JSON.parse(revision.data_json); } catch { /* ignore */ }
  const restoredText = revData ? extractTextFromProseMirror(revData) : '';

  // 3. Update documents table
  const now = new Date().toISOString();
  db.prepare('UPDATE documents SET title = ?, text = ?, data_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(revision.title || doc.title, restoredText, revision.data_json, actorName, now, docId);

  // 4. Sync title to content_items
  db.prepare('UPDATE content_items SET title = ?, updated_at = ? WHERE raw_id = ? AND type = ?')
    .run(revision.title || doc.title, now, docId, 'doc');

  const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  return { data: revData, document: updated };
}
