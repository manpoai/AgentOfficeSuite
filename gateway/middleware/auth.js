/**
 * Authentication middleware: authenticateAny, authenticateAdmin
 * Also creates default admin user on first run.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { genId, hashToken, hashPassword } from '../lib/utils.js';

export function createAuthMiddleware(db, JWT_SECRET, ADMIN_TOKEN) {
  // Create default admin user if none exists
  const adminExists = db.prepare("SELECT id FROM actors WHERE type = 'human' AND role = 'admin'").get();
  if (!adminExists) {
    const adminId = genId('act');
    const defaultPassword = process.env.ADMIN_PASSWORD || (() => {
      const generated = crypto.randomBytes(16).toString('hex');
      console.warn('[gateway] WARNING: ADMIN_PASSWORD not set, using random password:', generated);
      return generated;
    })();
    db.prepare(`INSERT INTO actors (id, type, username, display_name, password_hash, role, created_at, updated_at) VALUES (?, 'human', 'admin', 'admin', ?, 'admin', ?, ?)`)
      .run(adminId, hashPassword(defaultPassword), Date.now(), Date.now());
    console.log(`[gateway] Created default admin user (username: admin, password: ***)`);
  }

  function authenticateAny(req, res, next) {
    const auth = req.headers.authorization;
    let token;
    if (auth?.startsWith('Bearer ')) {
      token = auth.slice(7);
    } else if (req.query.token && (req.path === '/api/me/events/stream' || req.path === '/api/notifications/stream')) {
      // Only accept query param token for SSE endpoints (can't set headers in EventSource)
      token = req.query.token;
    } else {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing authorization' });
    }

    // Try JWT first (human auth)
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const actor = db.prepare('SELECT * FROM actors WHERE id = ?').get(decoded.actor_id);
      if (actor) {
        req.actor = { id: actor.id, type: actor.type, username: actor.username, display_name: actor.display_name, role: actor.role, avatar_url: actor.avatar_url };
        req.agent = { id: actor.id, name: actor.username, display_name: actor.display_name, capabilities: actor.capabilities };
        return next();
      }
    } catch (e) { /* not a JWT, try agent token */ }

    // Try agent token hash (actors table)
    const hash = hashToken(token);
    const agent = db.prepare('SELECT * FROM actors WHERE token_hash = ?').get(hash);
    if (agent) {
      // Soft-delete check
      if (agent.deleted_at) {
        return res.status(403).json({ error: 'AGENT_DELETED', message: 'This agent has been deleted' });
      }
      // Pending approval check: allow whoami + full event read/ack cycle so
      // pending agents can receive agent.approved without ack-path asymmetry.
      if (agent.pending_approval) {
        const allowedPaths = [
          '/api/me',
          '/api/me/catchup',
          '/api/me/events/stream',
          '/api/me/events/count',
          '/api/me/events/ack',
        ];
        const isAllowed = allowedPaths.some(p => req.path === p || req.path.startsWith(p + '?'));
        if (!isAllowed) {
          return res.status(403).json({ error: 'PENDING_APPROVAL', message: 'Your registration is pending approval' });
        }
      }
      db.prepare('UPDATE actors SET last_seen_at = ?, online = 1 WHERE id = ?').run(Date.now(), agent.id);
      req.actor = { id: agent.id, type: 'agent', username: agent.username, display_name: agent.display_name, role: 'agent', avatar_url: agent.avatar_url };
      req.agent = { id: agent.id, name: agent.username, display_name: agent.display_name, capabilities: agent.capabilities };
      return next();
    }

    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token' });
  }

  function authenticateAdmin(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin token' });
    }
    const token = auth.slice(7);

    // Accept ADMIN_TOKEN
    if (token === ADMIN_TOKEN) return next();

    // Accept human JWT with admin role
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const actor = db.prepare("SELECT * FROM actors WHERE id = ? AND type = 'human' AND role = 'admin'").get(decoded.actor_id);
      if (actor) {
        req.actor = { id: actor.id, type: actor.type, username: actor.username, display_name: actor.display_name, role: actor.role };
        req.agent = { id: actor.id, name: actor.username, display_name: actor.display_name };
        return next();
      }
    } catch (e) { /* not a valid JWT */ }

    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin token' });
  }

  // Backward-compat alias
  const authenticateAgent = authenticateAny;

  return { authenticateAny, authenticateAdmin, authenticateAgent };
}
