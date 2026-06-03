import { z } from 'zod';

export function registerContentTools(server, gw) {
  server.tool(
    'list_content_items',
    'List content items in the workspace (docs, tables, presentations, diagrams, canvases, videos). Supports filtering by type and title search.',
    {
      type: z.enum(['doc', 'table', 'presentation', 'diagram', 'canvas', 'video']).optional().describe('Filter by content type (omit for all)'),
      search: z.string().optional().describe('Search by title (case-insensitive substring match)'),
      limit: z.number().optional().describe('Max items to return (omit for all)'),
      offset: z.number().optional().default(0).describe('Skip first N items (for pagination)'),
    },
    async ({ type, search, limit, offset }) => {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (search) params.set('search', search);
      if (limit) params.set('limit', String(limit));
      if (offset) params.set('offset', String(offset));
      const qs = params.toString();
      const result = await gw.get(`/content-items${qs ? `?${qs}` : ''}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'list_children',
    'List direct children of a content item. If parent_id is omitted, lists root-level items. Returns title, type, and metadata for each child.',
    {
      parent_id: z.string().optional().describe('Parent content item ID (omit for root-level items)'),
      type: z.enum(['doc', 'table', 'presentation', 'diagram', 'canvas', 'video']).optional().describe('Filter by content type'),
    },
    async ({ parent_id, type }) => {
      // Gateway GET /content-items returns ALL items. We filter client-side.
      const result = await gw.get('/content-items');
      const items = (result.items || []).filter(item => {
        const parentMatch = parent_id ? item.parent_id === parent_id : !item.parent_id;
        const typeMatch = !type || item.type === type;
        return parentMatch && typeMatch;
      });
      items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      return { content: [{ type: 'text', text: JSON.stringify({ items }) }] };
    }
  );

  server.tool(
    'move_content_item',
    'Move a content item to a new parent (or to root level). Optionally set sort order.',
    {
      content_id: z.string().describe('ID of the content item to move'),
      parent_id: z.string().nullable().optional().describe('New parent content item ID (null or omit to move to root)'),
      sort_order: z.number().optional().describe('Position among siblings (lower = higher in list)'),
    },
    async ({ content_id, parent_id, sort_order }) => {
      const body = {};
      body.parent_id = parent_id ?? null;
      if (sort_order !== undefined) body.sort_order = sort_order;
      const result = await gw.patch(`/content-items/${content_id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
