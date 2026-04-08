/**
 * Unified snapshot creation helper for content revisions.
 */

/**
 * Create a content snapshot in content_snapshots.
 * @param {object} db - SQLite database (better-sqlite3)
 * @param {object} deps - { genId } injected from caller
 * @param {object} payload
 * @param {string} payload.contentType - 'doc' | 'presentation' | 'diagram'
 * @param {string} payload.contentId - raw content ID (without type: prefix)
 * @param {object} payload.data - JS object to store as data_json
 * @param {string} payload.triggerType - 'auto' | 'pre_agent_edit' | 'post_agent_edit' | 'pre_restore'
 * @param {string|null} payload.actorId - actor ID
 * @param {string|null} payload.title - content title
 */
export function createSnapshot(db, deps, { contentType, contentId, data, triggerType, actorId, title }) {
  const { genId } = deps;
  const id = genId('snap');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, row_count, actor_id, created_at)
    VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, NULL, ?, ?)
  `).run(id, contentType, contentId, title || null, JSON.stringify(data), triggerType, actorId || null, now);

  // Retention policy: keep at most 20 snapshots per content item
  db.prepare(`
    DELETE FROM content_snapshots
    WHERE content_type = ? AND content_id = ? AND id NOT IN (
      SELECT id FROM content_snapshots WHERE content_type = ? AND content_id = ?
      ORDER BY created_at DESC LIMIT 20
    )
  `).run(contentType, contentId, contentType, contentId);

  return { id, trigger_type: triggerType, created_at: now };
}

/**
 * Determine if a request is from an agent (not a human).
 * Based on middleware/auth.js: agent token login hard-codes req.actor.type = 'agent'.
 * Note: cannot use !!req.agent — human JWT logins also populate req.agent.
 * @param {object} req - Express request
 * @returns {boolean}
 */
export function isAgentRequest(req) {
  return req.actor?.type === 'agent';
}
