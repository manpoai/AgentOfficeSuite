/**
 * SSE infrastructure, webhook delivery, and comment polling
 */
import crypto from 'crypto';

export const sseClients = new Map(); // agent_id -> Set<res>
export const humanClients = new Map(); // actor_id -> Set<res>

let _db = null;
export function setSseDb(db) { _db = db; }

export function pushHumanEvent(actorId, event) {
  const clients = humanClients.get(actorId);
  if (!clients) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    res.write(data);
  }
}

export function pushEvent(agentId, event) {
  const clients = sseClients.get(agentId);
  const clientCount = clients ? clients.size : 0;

  if (clientCount > 0) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try {
        res.write(data);
      } catch (e) {
        console.warn(`[sse] write failed agent=${agentId} event=${event.event_id || event.id}: ${e.message}`);
      }
    }
  }

  const eventId = event.event_id || event.id;
  const eventType = event.event || event.type;
  console.log(`[push] agent=${agentId} event=${eventId} type=${eventType} clients=${clientCount} delivered=${clientCount > 0}`);

  if (_db && clientCount > 0 && eventId) {
    try {
      _db.prepare('UPDATE events SET delivered_at = ?, delivery_method = ? WHERE id = ?')
        .run(Date.now(), 'sse', eventId);
    } catch (e) {
      console.warn(`[sse] mark delivered failed event=${eventId}: ${e.message}`);
    }
  }
}

export function isAllowedWebhookUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return false;
    if (host === '0.0.0.0' || host.startsWith('10.') || host.startsWith('192.168.')) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host.endsWith('.internal') || host.endsWith('.local')) return false;
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;
    return true;
  } catch {
    return false;
  }
}

export async function deliverWebhook(agent, event) {
  if (!isAllowedWebhookUrl(agent.webhook_url)) {
    console.warn(`[gateway] Blocked webhook delivery to disallowed URL for agent ${agent.username}`);
    return;
  }
  const timestamp = String(Date.now());
  const body = JSON.stringify(event);
  const signature = 'sha256=' + crypto.createHmac('sha256', agent.webhook_secret || '')
    .update(`${timestamp}.${body}`).digest('hex');

  await fetch(agent.webhook_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-Hub-Timestamp': timestamp,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
}

// Comment polling stub (no-op -- comments are managed via SQLite)
export async function pollComments() {
  // No-op
}
