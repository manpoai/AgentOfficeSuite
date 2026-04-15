import { z } from 'zod';

export function registerEventTools(server, gw) {
  server.tool(
    'get_unread_events',
    'COUNT-ONLY probe. Returns {unread_count: N}, not event bodies. Use as a cheap check before deciding whether to fetch. To actually read events, call catchup_events.',
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
    'Fetch event payloads. This is THE tool that returns event bodies — get_unread_events only returns a count. Call on first connect and whenever a [AOSE] doorbell arrives. Events are auto-marked delivered as they are returned; no separate ack step is required in the happy path.',
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
    'Idempotent no-op confirmation. NOT REQUIRED in the happy path: catchup_events already marks events as delivered when it returns them. Calling ack_events is safe but redundant — a {"newly_marked": 0} response is the expected outcome, not a failure. Only useful if you want an explicit confirmation that the gateway saw your cursor range.',
    {
      cursor: z.string().describe('Timestamp cursor — all events up to this time will be marked delivered'),
    },
    async ({ cursor }) => {
      const result = await gw.post('/me/events/ack', { cursor });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
