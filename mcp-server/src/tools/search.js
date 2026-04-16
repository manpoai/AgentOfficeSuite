import { z } from 'zod';

export function registerSearchTools(server, gw) {
  server.tool(
    'search_content',
    'Search across all workspace content — docs (full-text), tables, presentations, and diagrams (by title). Returns matching items with a text snippet.',
    {
      query: z.string().describe('Search query string'),
      limit: z.number().int().min(1).max(50).optional().default(20).describe('Max results to return (default 20, max 50)'),
    },
    async ({ query, limit }) => {
      const params = new URLSearchParams({ q: query, limit: String(limit) });
      const result = await gw.get(`/search?${params}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
