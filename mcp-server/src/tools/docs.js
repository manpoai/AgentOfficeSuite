import { z } from 'zod';

export function registerDocTools(server, gw) {
  server.tool(
    'create_doc',
    'Create a new document. Returns the doc ID and URL.',
    {
      title: z.string().describe('Document title'),
      content_markdown: z.string().describe('Document content in Markdown'),
      collection_id: z.string().optional().describe('Collection ID to create in (omit for default)'),
      parent_id: z.string().optional().describe('Parent content item ID to nest under (omit for root level)'),
    },
    async ({ title, content_markdown, collection_id, parent_id }) => {
      const body = { title, content_markdown };
      if (collection_id) body.collection_id = collection_id;
      if (parent_id) body.parent_id = parent_id;
      const result = await gw.post('/docs', body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_doc',
    'Update an existing document title or replace its entire content. For editing specific sections, prefer the block-level tools (read_doc_outline → doc_replace_block) to avoid overwriting unrelated content.',
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
    'read_doc_outline',
    'List the top-level blocks of a document with their blockIds, types, and text previews. Use this before doc_replace_block to find the block you want to edit. If you already know the block_id, you can call doc_replace_block directly.',
    {
      doc_id: z.string().describe('Document ID'),
      preview_length: z.number().optional().describe('Max characters per block preview (default 160, increase for better block identification)'),
    },
    async ({ doc_id, preview_length }) => {
      const params = preview_length ? `?preview_length=${preview_length}` : '';
      const result = await gw.get(`/docs/${doc_id}/outline${params}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'read_doc_blocks',
    'Read specific blocks from a document. Filter by block_ids, or by index range (from_index/to_index) to read a section without knowing block IDs. Returns block metadata and raw node content.',
    {
      doc_id: z.string().describe('Document ID'),
      block_ids: z.array(z.string()).optional().describe('Block IDs to fetch (omit to use index range or return all)'),
      from_index: z.number().optional().describe('Start block index (0-based, inclusive). Use with to_index to read a range.'),
      to_index: z.number().optional().describe('End block index (0-based, inclusive). Omit to read from from_index to end.'),
    },
    async ({ doc_id, block_ids, from_index, to_index }) => {
      const params = new URLSearchParams();
      if (block_ids && block_ids.length > 0) params.set('block_ids', block_ids.join(','));
      if (from_index != null) params.set('from_index', String(from_index));
      if (to_index != null) params.set('to_index', String(to_index));
      const url = params.toString() ? `/docs/${doc_id}/blocks?${params}` : `/docs/${doc_id}/blocks`;
      const result = await gw.get(url);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'doc_replace_block',
    'Replace a single block in a document with new markdown content. Other blocks are untouched. Use read_doc_outline first to find the block_id.',
    {
      doc_id: z.string().describe('Document ID'),
      block_id: z.string().describe('Block ID to replace (from read_doc_outline)'),
      content_markdown: z.string().describe('New content for this block in Markdown'),
      revision_description: z.string().optional().describe('Optional description for the revision history'),
    },
    async ({ doc_id, block_id, content_markdown, revision_description }) => {
      const body = { content_markdown };
      if (revision_description) body.revision_description = revision_description;
      const result = await gw.patch(`/docs/${doc_id}/blocks/${block_id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'read_doc',
    'Read a document. Returns title, full Markdown content, and metadata.',
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
    'List or search documents. Without query, returns recent docs. With query, searches by content/title.',
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
    'doc_insert_block_after',
    'Insert new content (in Markdown) after a specific block in a document. Other blocks are untouched. Use read_doc_outline first to find the after_block_id. Omit after_block_id to insert at the beginning.',
    {
      doc_id: z.string().describe('Document ID'),
      after_block_id: z.string().optional().describe('Insert after this block ID (omit to insert at start)'),
      content_markdown: z.string().describe('New content in Markdown to insert'),
      revision_description: z.string().optional().describe('Optional description for the revision history'),
    },
    async ({ doc_id, after_block_id, content_markdown, revision_description }) => {
      const body = { content_markdown };
      if (after_block_id) body.after_block_id = after_block_id;
      if (revision_description) body.revision_description = revision_description;
      const result = await gw.post(`/docs/${doc_id}/blocks`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'doc_append_section',
    'Append new content (in Markdown) at the end of a document. Useful for adding new sections without affecting existing content.',
    {
      doc_id: z.string().describe('Document ID'),
      content_markdown: z.string().describe('New content in Markdown to append at the end'),
      revision_description: z.string().optional().describe('Optional description for the revision history'),
    },
    async ({ doc_id, content_markdown, revision_description }) => {
      const body = { content_markdown };
      if (revision_description) body.revision_description = revision_description;
      const result = await gw.post(`/docs/${doc_id}/blocks/append`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'doc_delete_block',
    'Delete a single block from a document by block ID. Other blocks are untouched. Use read_doc_outline first to find the block_id.',
    {
      doc_id: z.string().describe('Document ID'),
      block_id: z.string().describe('Block ID to delete (from read_doc_outline)'),
    },
    async ({ doc_id, block_id }) => {
      const result = await gw.del(`/docs/${doc_id}/blocks/${block_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'comment_on_doc',
    'Add a comment to a document. Can reply to an existing comment thread.',
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
