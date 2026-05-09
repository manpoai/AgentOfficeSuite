/**
 * Agent direct messages: human ↔ agent chat
 */
import { insertNotification } from '../lib/notifications.js';

export default function agentMessagesRoutes(app, { db, authenticateAny, authenticateAgent, genId, pushEvent, pushHumanEvent, deliverWebhook, sseClients }) {

  // ─── Send a message (human → agent or agent → human) ─────
  app.post('/api/agents/:agent_id/messages', authenticateAny, (req, res) => {
    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'MISSING_CONTENT', message: 'content is required' });
    }

    const param = req.params.agent_id;
    const agent = db.prepare(
      "SELECT id, username, display_name FROM actors WHERE type = 'agent' AND (username = ? OR id = ?)"
    ).get(param, param);
    if (!agent) {
      return res.status(404).json({ error: 'AGENT_NOT_FOUND' });
    }
    const agentId = agent.id;

    const sender = req.actor;
    const senderType = sender.type; // 'human' or 'agent'

    // Agent can only send messages to itself (its own chat thread)
    if (senderType === 'agent' && sender.id !== agentId) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Agents can only post to their own message thread' });
    }

    const id = genId('msg');
    const now = Date.now();

    db.prepare(
      'INSERT INTO agent_messages (id, agent_id, sender_type, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, agentId, senderType, sender.id, content.trim(), now);

    const message = { id, agent_id: agentId, sender_type: senderType, sender_id: sender.id, content: content.trim(), created_at: now };

    if (senderType === 'human') {
      // Human → Agent: create event for the agent
      const eventId = genId('evt');
      const event = {
        event_id: eventId,
        event: 'message.received',
        occurred_at: now,
        payload: {
          message_id: id,
          content: content.trim(),
          sender: { id: sender.id, name: sender.display_name || sender.username },
        },
      };
      db.prepare(
        'INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(eventId, agentId, 'message.received', 'direct_message', now, JSON.stringify(event), now);

      pushEvent(agentId, event);

      // Also attempt webhook delivery
      const agentFull = db.prepare('SELECT * FROM actors WHERE id = ?').get(agentId);
      if (agentFull?.webhook_url) {
        deliverWebhook(agentFull, event).catch(() => {});
      }
    } else {
      // Agent → Human: push to all human SSE clients
      // Find the content owner (admin for now, or whoever sent the last human message)
      const lastHumanMsg = db.prepare(
        'SELECT sender_id FROM agent_messages WHERE agent_id = ? AND sender_type = ? ORDER BY created_at DESC LIMIT 1'
      ).get(agentId, 'human');

      // Use the same {event, data} shape as handleSyncChangeSSE in server.js so
      // the frontend SSEProvider's single handler matches both the direct push
      // (this path) and the sync-applied broadcast (other-device path).
      const humanEvent = {
        event: 'message.sent',
        data: {
          agent_id: agentId,
          agent_name: agent.display_name || agent.username,
          message_id: id,
          content: content.trim(),
          created_at: now,
        },
      };

      if (lastHumanMsg) {
        pushHumanEvent(lastHumanMsg.sender_id, humanEvent);
      }
      // Also broadcast to all admin users
      const admins = db.prepare("SELECT id FROM actors WHERE type = 'human' AND role = 'admin'").all();
      for (const admin of admins) {
        if (admin.id !== lastHumanMsg?.sender_id) {
          pushHumanEvent(admin.id, humanEvent);
        }
      }
    }

    res.status(201).json(message);
  });

  // ─── List messages ──────────────────────────────
  app.get('/api/agents/:agent_id/messages', authenticateAny, (req, res) => {
    const param = req.params.agent_id;
    const agent = db.prepare(
      "SELECT id FROM actors WHERE type = 'agent' AND (username = ? OR id = ?)"
    ).get(param, param);
    const agentId = agent ? agent.id : param;
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const before = req.query.before ? parseInt(req.query.before) : null;

    let sql = 'SELECT * FROM agent_messages WHERE agent_id = ?';
    const params = [agentId];

    if (before) {
      sql += ' AND created_at < ?';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit + 1);

    const rows = db.prepare(sql).all(...params);
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit);

    // Enrich with sender info
    const actorCache = new Map();
    for (const msg of messages) {
      if (!actorCache.has(msg.sender_id)) {
        const actor = db.prepare('SELECT username, display_name, avatar_url, type FROM actors WHERE id = ?').get(msg.sender_id);
        actorCache.set(msg.sender_id, actor || { username: 'unknown', display_name: 'Unknown' });
      }
      const actor = actorCache.get(msg.sender_id);
      msg.sender_name = actor.display_name || actor.username;
      msg.sender_avatar = actor.avatar_url || null;
    }

    res.json({ messages, has_more: hasMore });
  });
}
