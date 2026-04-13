/**
 * Unified notification insertion helper.
 *
 * Writes the canonical title_key / title_params / body_key / body_params
 * columns AND renders legacy title/body strings using the recipient's
 * preferred language so existing clients keep working.
 */
import { tServer, DEFAULT_LANGUAGE } from './i18n-server.js';

function getRecipientLang(db, targetActorId) {
  try {
    const row = db.prepare('SELECT preferred_language FROM actors WHERE id = ?').get(targetActorId);
    return row?.preferred_language || DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Insert a notification row.
 * @param {object} db - better-sqlite3 database
 * @param {object} deps - { genId }
 * @param {object} payload
 * @param {string} payload.actorId - who triggered the notification (nullable)
 * @param {string} payload.targetActorId - recipient actor id
 * @param {string} payload.type - notification type (e.g. 'doc_created')
 * @param {string} payload.titleKey - i18n key for title
 * @param {object} [payload.titleParams] - params for title
 * @param {string} [payload.bodyKey] - i18n key for body
 * @param {object} [payload.bodyParams] - params for body
 * @param {string} [payload.link] - optional link
 * @param {object} [payload.meta] - optional meta object (stored as JSON)
 * @returns {{ id: string, created_at: number }}
 */
export function insertNotification(db, deps, payload) {
  const { genId } = deps;
  const {
    actorId, targetActorId, type,
    titleKey, titleParams, bodyKey, bodyParams,
    link, meta,
  } = payload;

  if (!targetActorId || !type || !titleKey) {
    throw new Error('insertNotification: targetActorId, type, titleKey required');
  }

  const lang = getRecipientLang(db, targetActorId);
  const titleRendered = tServer(lang, titleKey, titleParams);
  const bodyRendered = bodyKey ? tServer(lang, bodyKey, bodyParams) : null;

  const id = genId('notif');
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO notifications (
      id, actor_id, target_actor_id, type,
      title, body, link, meta, read, created_at,
      title_key, title_params, body_key, body_params
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    id, actorId || null, targetActorId, type,
    titleRendered, bodyRendered, link || null,
    meta ? JSON.stringify(meta) : null, now,
    titleKey, titleParams ? JSON.stringify(titleParams) : null,
    bodyKey || null, bodyParams ? JSON.stringify(bodyParams) : null,
  );

  return { id, created_at: now };
}
