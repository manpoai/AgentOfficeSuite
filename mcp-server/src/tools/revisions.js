import { z } from 'zod';

const ContentId = z.string().describe(
  'Content ID in prefixed form: "doc:doc_xxx", "presentation:uuid", "diagram:uuid"'
);

export function registerRevisionTools(server, gw) {
  server.tool(
    'list_revisions',
    'List saved revision snapshots for a content item (doc, presentation, or diagram). Returns snapshot IDs, trigger types (auto/manual/pre_agent_edit/post_agent_edit), descriptions, and timestamps.',
    {
      content_id: ContentId,
    },
    async ({ content_id }) => {
      const result = await gw.get(`/content-items/${encodeURIComponent(content_id)}/revisions`);
      // Drop the full data payload from each revision to keep the response compact
      const revisions = (result.revisions || []).map(r => ({
        id: r.id,
        trigger_type: r.trigger_type,
        description: r.description,
        created_at: r.created_at,
        created_by: r.created_by,
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ revisions }) }] };
    }
  );

  server.tool(
    'create_revision',
    'Save a manual snapshot of the current state of a content item. Useful before making large edits so you can restore if needed.',
    {
      content_id: ContentId,
      description: z.string().optional().describe('Label for this snapshot, e.g. "before restructure"'),
    },
    async ({ content_id, description }) => {
      const body = {};
      if (description) body.description = description;
      const result = await gw.post(`/content-items/${encodeURIComponent(content_id)}/revisions/manual`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'restore_revision',
    'Restore a content item to a previous snapshot. Use list_revisions to find the revision_id. The current state is automatically snapshotted before restore so the action is reversible.',
    {
      content_id: ContentId,
      revision_id: z.string().describe('Revision ID to restore (from list_revisions)'),
    },
    async ({ content_id, revision_id }) => {
      const result = await gw.post(
        `/content-items/${encodeURIComponent(content_id)}/revisions/${encodeURIComponent(revision_id)}/restore`,
        {}
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
