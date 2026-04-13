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
/**
 * Default descriptionKey per trigger_type for snapshots that don't carry a
 * user-authored description. Renders at read time via the consumer's language.
 */
const DEFAULT_DESCRIPTION_KEYS = {
  pre_agent_edit:  'serverSnapshots.pre_agent_edit',
  post_agent_edit: 'serverSnapshots.post_agent_edit',
  pre_restore:     'serverSnapshots.pre_restore',
  auto:            'serverSnapshots.auto_initial',
};

export function createSnapshot(db, deps, { contentType, contentId, data, triggerType, actorId, title, description, descriptionKey, descriptionParams }) {
  const { genId } = deps;
  const id = genId('snap');
  const now = new Date().toISOString();

  // If caller provided neither a free-text description nor an explicit key,
  // fall back to the canonical key for this trigger_type so every auto-created
  // snapshot ends up with a translatable description.
  const effectiveKey = descriptionKey || (description ? null : (DEFAULT_DESCRIPTION_KEYS[triggerType] || null));

  db.prepare(`
    INSERT INTO content_snapshots (id, content_type, content_id, version, title, data_json, schema_json, trigger_type, description, row_count, actor_id, created_at, description_key, description_params)
    VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    id, contentType, contentId, title || null, JSON.stringify(data), triggerType,
    description || null, actorId || null, now,
    effectiveKey, descriptionParams ? JSON.stringify(descriptionParams) : null,
  );

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
