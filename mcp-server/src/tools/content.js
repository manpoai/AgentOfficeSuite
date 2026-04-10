import { z } from 'zod';

export function registerContentTools(server, gw) {
  server.tool(
    'list_content_items',
    'List all content items in the workspace (docs, tables, presentations, diagrams). Returns title, type, owner, and metadata.',
    {
      type: z.enum(['doc', 'table', 'presentation', 'diagram']).optional().describe('Filter by content type (omit for all)'),
    },
    async ({ type }) => {
      const params = type ? `?type=${type}` : '';
      const result = await gw.get(`/content${params}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
