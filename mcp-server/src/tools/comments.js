import { z } from 'zod';

export function registerCommentTools(server, gw) {
  server.tool(
    'list_comments',
    'List all comments on a content item (doc, table, presentation, diagram). Returns both top-level and reply comments.',
    {
      content_id: z.string().describe('Content item ID (e.g. doc_xxx, tbl_xxx)'),
    },
    async ({ content_id }) => {
      const result = await gw.get(`/content-items/${content_id}/comments`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'reply_to_comment',
    'Post a reply to an existing comment thread. Use this to respond to feedback, questions, or review comments.',
    {
      content_id: z.string().describe('Content item ID (e.g. doc_xxx)'),
      parent_comment_id: z.string().describe('ID of the parent comment to reply to'),
      text: z.string().describe('Reply text (supports markdown)'),
    },
    async ({ content_id, parent_comment_id, text }) => {
      const result = await gw.post(`/content-items/${content_id}/comments`, { text, parent_comment_id });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'resolve_comment',
    'Mark a comment thread as resolved. Use when the issue or question raised has been addressed.',
    {
      comment_id: z.string().describe('Comment ID to resolve'),
    },
    async ({ comment_id }) => {
      const result = await gw.post(`/content-comments/${comment_id}/resolve`, {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'unresolve_comment',
    'Re-open a previously resolved comment thread.',
    {
      comment_id: z.string().describe('Comment ID to unresolve'),
    },
    async ({ comment_id }) => {
      const result = await gw.post(`/content-comments/${comment_id}/unresolve`, {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
