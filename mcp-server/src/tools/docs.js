import { z } from 'zod';

export function registerDocTools(server, gw) {
  server.tool(
    'create_doc',
    'Create a new Outline document. Returns the doc ID and URL.',
    {
      title: z.string().describe('Document title'),
      content_markdown: z.string().describe('Document content in Markdown'),
      collection_id: z.string().optional().describe('Collection ID to create in (omit for default)'),
    },
    async ({ title, content_markdown, collection_id }) => {
      const body = { title, content_markdown };
      if (collection_id) body.collection_id = collection_id;
      const result = await gw.post('/docs', body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_doc',
    'Update an existing Outline document. Can update title, content, or both.',
    {
      doc_id: z.string().describe('Document ID to update'),
      title: z.string().optional().describe('New title'),
      content_markdown: z.string().optional().describe('New content in Markdown (replaces entire doc)'),
    },
    async ({ doc_id, title, content_markdown }) => {
      const body = {};
      if (title) body.title = title;
      if (content_markdown) body.content_markdown = content_markdown;
      const result = await gw.patch(`/docs/${doc_id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'read_doc',
    'Read an Outline document. Returns title, full Markdown content, and metadata.',
    {
      doc_id: z.string().describe('Document ID to read'),
    },
    async ({ doc_id }) => {
      const result = await gw.get(`/docs/${doc_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'list_docs',
    'List or search Outline documents. Without query, returns recent docs. With query, searches by content/title.',
    {
      query: z.string().optional().describe('Search query (searches title and content)'),
      collection_id: z.string().optional().describe('Filter by collection ID'),
      limit: z.number().optional().default(25).describe('Max documents to return (default 25)'),
    },
    async ({ query, collection_id, limit }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set('query', query);
      if (collection_id) params.set('collection_id', collection_id);
      const result = await gw.get(`/docs?${params}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'comment_on_doc',
    'Add a comment to an Outline document. Can reply to an existing comment thread.',
    {
      doc_id: z.string().describe('Document ID to comment on'),
      text: z.string().describe('Comment text'),
      parent_comment_id: z.string().optional().describe('Reply to this comment (thread)'),
    },
    async ({ doc_id, text, parent_comment_id }) => {
      const result = await gw.post('/comments', { doc_id, text, parent_comment_id });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
