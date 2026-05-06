/**
 * Event routes: catchup, SSE stream, notifications, thread context, event ack
 */
import crypto from 'crypto';
import { insertNotification } from '../lib/notifications.js';
import { recordChange } from '../lib/sync-hook.js';

export default function eventsRoutes(app, { db, authenticateAny, authenticateAgent, genId, pushEvent, deliverWebhook, sseClients, humanClients, pollNcComments }) {

  // ─── Catchup ─────────────────────────────────────
  app.get('/api/me/catchup', authenticateAgent, (req, res) => {
    const since = parseInt(req.query.since || '0');
    const limit = Math.min(parseInt(req.query.limit || '50'), 100);
    const cursor = req.query.cursor;

    let query = 'SELECT * FROM events WHERE agent_id = ? AND occurred_at > ? ORDER BY occurred_at ASC LIMIT ?';
    const params = [req.agent.id, cursor ? parseInt(cursor) : since, limit + 1];

    const rows = db.prepare(query).all(...params);
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map(r => JSON.parse(r.payload));

    // Mark as delivered
    for (const r of rows.slice(0, limit)) {
      db.prepare('UPDATE events SET delivered = 1 WHERE id = ?').run(r.id);
    }

    res.json({
      events,
      has_more: hasMore,
      cursor: events.length > 0 ? String(events[events.length - 1].occurred_at) : null,
    });
  });

  // ─── SSE Event Stream ────────────────────────────
  app.get('/api/me/events/stream', authenticateAgent, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const agentId = req.agent.id;
    if (!sseClients.has(agentId)) sseClients.set(agentId, new Set());
    sseClients.get(agentId).add(res);
    const remote = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    console.log(`[sse] connect agent=${agentId} remote=${remote} clients=${sseClients.get(agentId).size}`);

    // Replay undelivered events so reconnecting clients don't need a separate catchup round-trip.
    // Bounded to latest 100 to keep reconnect cheap; older backlog is still available via /api/me/catchup.
    const since = parseInt(req.query.since || '0');
    try {
      const backlog = db.prepare(
        'SELECT id, payload FROM events WHERE agent_id = ? AND delivered = 0 AND occurred_at > ? ORDER BY occurred_at ASC LIMIT 100'
      ).all(agentId, since);
      for (const r of backlog) {
        res.write(`data: ${r.payload}\n\n`);
        db.prepare('UPDATE events SET delivered = 1, delivered_at = ?, delivery_method = ? WHERE id = ?')
          .run(Date.now(), 'sse_replay', r.id);
      }
      if (backlog.length > 0) {
        console.log(`[sse] replayed ${backlog.length} undelivered events agent=${agentId}`);
      }
    } catch (e) {
      console.warn(`[sse] replay failed agent=${agentId}: ${e.message}`);
    }

    // Send heartbeat every 30s
    const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.get(agentId)?.delete(res);
      console.log(`[sse] disconnect agent=${agentId} remote=${remote} clients=${sseClients.get(agentId)?.size ?? 0}`);
    });
  });

  // ─── Human SSE Notification Stream ──────────────
  app.get('/api/notifications/stream', authenticateAny, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const actorId = req.actor?.id;
    if (!actorId) { res.end(); return; }

    if (!humanClients.has(actorId)) humanClients.set(actorId, new Set());
    humanClients.get(actorId).add(res);

    const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      const set = humanClients.get(actorId);
      if (set) { set.delete(res); if (set.size === 0) humanClients.delete(actorId); }
    });
  });

  // ─── Enhanced Catchup ───────────────────────────
  // Get unread event count
  app.get('/api/me/events/count', authenticateAgent, (req, res) => {
    const since = parseInt(req.query.since || '0');
    const count = db.prepare('SELECT COUNT(*) as count FROM events WHERE agent_id = ? AND delivered = 0 AND occurred_at > ?')
      .get(req.agent.id, since);
    res.json({ unread_count: count.count });
  });

  // Acknowledge events (idempotent no-op in the happy path)
  //
  // Note: `/api/me/catchup` already marks events as delivered=1 the moment it
  // returns them (see above). So by the time an agent calls ack after a
  // successful catchup, there is nothing left to mark and `newly_marked` will
  // be 0. That is the expected outcome, not a failure. We also report the
  // total number of events in scope so agents can confirm the gateway saw
  // their cursor range, and an explicit note so a zero count isn't misread.
  app.post('/api/me/events/ack', authenticateAgent, (req, res) => {
    const { cursor } = req.body;
    if (!cursor) return res.status(400).json({ error: 'MISSING_CURSOR', message: 'cursor (timestamp) required' });
    const cursorTs = parseInt(cursor);
    const result = db.prepare('UPDATE events SET delivered = 1 WHERE agent_id = ? AND occurred_at <= ? AND delivered = 0')
      .run(req.agent.id, cursorTs);
    const total = db.prepare('SELECT COUNT(*) as count FROM events WHERE agent_id = ? AND occurred_at <= ?')
      .get(req.agent.id, cursorTs);
    res.json({
      ok: true,
      acknowledged: result.changes,          // kept for backwards compat
      newly_marked: result.changes,
      events_in_range: total.count,
      note: 'catchup_events already marks events delivered as it returns them; ack_events is a redundant confirmation. newly_marked=0 with events_in_range>0 means everything in this cursor range was already delivered — this is the expected happy path, not a failure.',
    });
  });

  // ─── Thread Context ─────────────────────────────
  app.post('/api/threads/:thread_id/links', authenticateAgent, (req, res) => {
    const { link_type, link_id, link_title } = req.body;
    if (!link_type || !link_id) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'link_type and link_id required' });
    }
    if (!['doc', 'task', 'data_row'].includes(link_type)) {
      return res.status(400).json({ error: 'INVALID_LINK_TYPE', message: 'link_type must be doc, task, or data_row' });
    }
    const id = genId('tl');
    db.prepare('INSERT INTO thread_links (id, thread_id, link_type, link_id, link_title, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.params.thread_id, link_type, link_id, link_title || null, req.agent.id, Date.now());
    recordChange(db, 'thread_links', id, 'insert', { id, thread_id: req.params.thread_id, link_type, link_id, link_title }, req.actor?.id, undefined);
    res.status(201).json({ id, thread_id: req.params.thread_id, link_type, link_id });
  });

  app.get('/api/threads/:thread_id/context', authenticateAgent, async (req, res) => {
    const threadId = req.params.thread_id;
    const links = db.prepare('SELECT * FROM thread_links WHERE thread_id = ? ORDER BY created_at ASC').all(threadId);

    const linkedResources = [];
    for (const link of links) {
      const entry = { link_id: link.id, type: link.link_type, id: link.link_id, title: link.link_title };
      linkedResources.push(entry);
    }

    res.json({ thread_id: threadId, messages: [], linked_resources: linkedResources });
  });

  app.delete('/api/threads/:thread_id/links/:link_id', authenticateAgent, (req, res) => {
    const link = db.prepare('SELECT * FROM thread_links WHERE id = ? AND thread_id = ?').get(req.params.link_id, req.params.thread_id);
    if (!link) return res.status(404).json({ error: 'NOT_FOUND' });
    if (link.created_by !== req.agent.id) return res.status(403).json({ error: 'FORBIDDEN', message: 'Can only delete own links' });
    db.prepare('DELETE FROM thread_links WHERE id = ?').run(link.id);
    recordChange(db, 'thread_links', link.id, 'delete', null, req.actor?.id, undefined);
    res.json({ deleted: true });
  });

  // ─── Notifications ──────────────────────────────
  app.get('/api/notifications', authenticateAny, (req, res) => {
    const { unread, limit = '50' } = req.query;
    const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const actorId = req.actor.id;

    let sql = 'SELECT * FROM notifications WHERE target_actor_id = ?';
    const params = [actorId];
    if (unread === 'true') {
      sql += ' AND read = 0';
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(lim);

    const rows = db.prepare(sql).all(...params);
    res.json({ notifications: rows.map(r => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })) });
  });

  app.get('/api/notifications/unread-count', authenticateAny, (req, res) => {
    const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE target_actor_id = ? AND read = 0').get(req.actor.id);
    res.json({ count: row.count });
  });

  app.patch('/api/notifications/:id/read', authenticateAny, (req, res) => {
    const result = db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND target_actor_id = ?').run(req.params.id, req.actor.id);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true });
  });

  app.post('/api/notifications/mark-all-read', authenticateAny, (req, res) => {
    const result = db.prepare('UPDATE notifications SET read = 1 WHERE target_actor_id = ? AND read = 0').run(req.actor.id);
    res.json({ ok: true, updated: result.changes });
  });

  app.post('/api/notifications', authenticateAny, (req, res) => {
    if (req.actor.type !== 'agent' && req.actor.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only agents or admins can create notifications' });
    }
    const {
      target_actor_id, type, link,
      title, body,
      title_key, title_params, body_key, body_params,
    } = req.body;
    if (!target_actor_id || !type) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'target_actor_id and type are required' });
    }
    if (!title && !title_key) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Either title or title_key is required' });
    }
    try {
      // If caller provided keys, route through insertNotification so the
      // recipient's preferred_language drives rendering. Otherwise preserve
      // the legacy raw title/body path (keys stay NULL).
      if (title_key) {
        const { id, created_at } = insertNotification(db, { genId }, {
          actorId: req.actor.id,
          targetActorId: target_actor_id,
          type,
          titleKey: title_key,
          titleParams: title_params || undefined,
          bodyKey: body_key || undefined,
          bodyParams: body_params || undefined,
          bodyRaw: body_key ? undefined : (body || undefined),
          link,
        });
        return res.status(201).json({ id, created_at });
      }
      const id = genId('notif');
      const now = Date.now();
      db.prepare('INSERT INTO notifications (id, actor_id, target_actor_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, req.actor.id, target_actor_id, type, title, body || null, link || null, now);
      return res.status(201).json({ id, created_at: now });
    } catch (e) {
      return res.status(500).json({ error: 'INSERT_FAILED', message: e.message });
    }
  });
}
