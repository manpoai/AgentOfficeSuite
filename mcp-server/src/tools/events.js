import { z } from 'zod';

export function registerEventTools(server, gw) {
  server.tool(
    'get_unread_events',
    'Check how many undelivered events are waiting. Use this after reconnecting to decide whether to fetch catchup events.',
    {
      since: z.number().optional().default(0).describe('Only count events after this timestamp (default: all unread)'),
    },
    async ({ since }) => {
      const result = await gw.get(`/me/events/count?since=${since}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'catchup_events',
    'Fetch missed events since last connection. Use after get_unread_events shows pending events.',
    {
      since: z.number().optional().default(0).describe('Fetch events after this timestamp'),
      cursor: z.string().optional().describe('Pagination cursor from previous catchup response'),
      limit: z.number().optional().default(50).describe('Max events to return (default 50)'),
    },
    async ({ since, cursor, limit }) => {
      const params = new URLSearchParams({ since: String(since), limit: String(limit) });
      if (cursor) params.set('cursor', cursor);
      const result = await gw.get(`/me/catchup?${params}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'ack_events',
    'Acknowledge events up to a timestamp cursor. Marks them as delivered so they won\'t appear in future catchup calls.',
    {
      cursor: z.string().describe('Timestamp cursor — all events up to this time will be marked delivered'),
    },
    async ({ cursor }) => {
      const result = await gw.post('/me/events/ack', { cursor });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
