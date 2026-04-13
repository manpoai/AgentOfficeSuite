/**
 * Content items upsert and sync logic
 */
export function createContentSync(db) {
  const contentItemsUpsert = db.prepare(`
    INSERT INTO content_items (id, raw_id, type, title, icon, parent_id, collection_id, created_by, updated_by, created_at, updated_at, deleted_at, owner_actor_id, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      icon = COALESCE((SELECT icon FROM doc_icons WHERE doc_id = excluded.raw_id), excluded.icon),
      parent_id = excluded.parent_id,
      collection_id = excluded.collection_id,
      created_by = excluded.created_by,
      updated_by = excluded.updated_by,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      owner_actor_id = COALESCE(content_items.owner_actor_id, excluded.owner_actor_id),
      synced_at = excluded.synced_at
  `);

  async function syncContentItems() {
    const now = Date.now();
    console.log('[gateway] Syncing content items from documents + user_tables...');

    // 1. Sync docs from documents table
    let docCount = 0;
    try {
      const docs = db.prepare('SELECT d.*, di.icon as custom_icon FROM documents d LEFT JOIN doc_icons di ON di.doc_id = d.id').all();
      for (const doc of docs) {
        const nodeId = `doc:${doc.id}`;
        const existing = db.prepare('SELECT parent_id, collection_id FROM content_items WHERE id = ?').get(nodeId);
        const icon = doc.custom_icon || doc.icon || null;
        const docOwner = doc.created_by
          ? db.prepare("SELECT id FROM actors WHERE display_name = ? OR username = ? LIMIT 1").get(doc.created_by, doc.created_by)
          : null;
        contentItemsUpsert.run(
          nodeId, doc.id, 'doc', doc.title || '',
          icon, existing?.parent_id || null, existing?.collection_id || null,
          doc.created_by || null, doc.updated_by || null,
          doc.created_at || null, doc.updated_at || null, doc.deleted_at || null,
          docOwner?.id || null,
          now
        );
        docCount++;
      }
    } catch (err) {
      console.error('[gateway] Content sync: documents error:', err.message);
    }

    // 2. Sync tables from user_tables (tableEngine)
    let tableCount = 0;
    try {
      const tables = db.prepare('SELECT id, title, created_by, updated_by, created_at, updated_at FROM user_tables').all();
      for (const t of tables) {
        const nodeId = `table:${t.id}`;
        const existing = db.prepare('SELECT parent_id, collection_id FROM content_items WHERE id = ?').get(nodeId);
        const customIcon = db.prepare('SELECT icon FROM doc_icons WHERE doc_id = ?').get(t.id);
        contentItemsUpsert.run(
          nodeId, t.id, 'table', t.title || '',
          customIcon?.icon || null, existing?.parent_id || null, existing?.collection_id || null,
          t.created_by || null, t.updated_by || null,
          t.created_at || null, t.updated_at || null, null,
          null,
          now
        );
        tableCount++;
      }
    } catch (err) {
      console.error('[gateway] Content sync: user_tables error:', err.message);
    }

    // 3. Remove stale table items (deleted from user_tables but still in content_items)
    db.prepare("DELETE FROM content_items WHERE type = 'table' AND synced_at < ? AND deleted_at IS NULL").run(now);

    console.log(`[gateway] Content sync done: ${docCount} docs, ${tableCount} tables`);
  }

  return { contentItemsUpsert, syncContentItems };
}
