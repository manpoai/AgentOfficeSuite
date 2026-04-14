/**
 * Event Translator — converts Gateway SSE events to human-readable C4 messages.
 * Platform-agnostic: returns { endpoint, content } for any event type.
 * Caller (platform plugin) decides how to deliver the message.
 */

/**
 * Translate a Gateway event into a C4-injectable message.
 * @param {object} event  Raw Gateway event object
 * @param {object} ctx    Context: { agentName, gatewayUrl, agentToken }
 * @returns {{ endpoint: string, content: string } | null}
 */
export function translateEvent(event, ctx) {
  const { gatewayUrl, agentToken } = ctx;

  switch (event.event) {
    case 'comment.mentioned': {
      const d = event.data;
      const cp = d.context || {};
      const target = cp.target || {};
      const anchor = cp.anchor || {};
      const summaryObj = cp.summary || {};
      const summaryText = summaryObj.comment_text || d.text || '';

      let content = `[AOSE] ${d.actor || 'Someone'} mentioned you in a comment`;
      if (target.title) content += ` on "${target.title}"`;
      content += `:\n${summaryText}`;

      if (anchor.type && anchor.preview) {
        content += `\n\n[Anchor: ${anchor.type}]\n${anchor.preview}`;
      }
      if (cp.minimal_required_context?.content_snippet) {
        content += `\n\n[Context]\n${cp.minimal_required_context.content_snippet}`;
      }

      // reply via is auto-appended by c4-receive.js — no need to add here

      const endpoint = `${d.target_id}|comment:${d.comment_id}`;
      return { endpoint, content };
    }

    case 'comment.on_owned_content': {
      const d = event.data;
      const cp = d.context || {};
      const target = cp.target || {};

      let content = `[AOSE] ${d.actor || 'Someone'} commented on your content`;
      if (target.title) content += ` "${target.title}"`;
      content += `:\n${d.text || ''}`;

      // reply via is auto-appended by c4-receive.js

      const endpoint = `${d.target_id}|comment:${d.comment_id}`;
      return { endpoint, content };
    }

    case 'comment.replied': {
      const d = event.data;
      const cp = d.context || {};
      const target = cp.target || {};
      let content = `[AOSE] ${d.actor || 'Someone'} replied to your comment`;
      if (target.title) content += ` on "${target.title}"`;
      content += `:\n${d.text || ''}`;
      // reply via is auto-appended by c4-receive.js

      const endpoint = `${d.target_id}|comment:${d.comment_id}`;
      return { endpoint, content };
    }

    case 'comment.resolved': {
      const d = event.data;
      const cp = d.context || {};
      const target = cp.target || {};
      let content = `[AOSE] ${d.actor || 'Someone'} resolved a comment`;
      if (target.title) content += ` on "${target.title}"`;
      content += `. No action needed unless you want to reopen it.`;
      return null; // typically no action needed, suppress
    }

    case 'comment.unresolved': {
      const d = event.data;
      const cp = d.context || {};
      const target = cp.target || {};
      let content = `[AOSE] ${d.actor || 'Someone'} reopened a comment`;
      if (target.title) content += ` on "${target.title}"`;
      content += `:\n${d.text || ''}`;
      // reply via is auto-appended by c4-receive.js

      const endpoint = `${d.target_id}|comment:${d.comment_id}`;
      return { endpoint, content };
    }

    case 'agent.approved': {
      const d = event.data;
      const content = `[AOSE] Your registration has been approved. You now have full access to AOSE.\n\n${d.message || ''}`;
      return { endpoint: `agent:${d.agent_id}|approved`, content };
    }

    case 'agent.rejected': {
      const d = event.data;
      const content = `[AOSE] Your registration has been rejected.\n\n${d.message || ''}`;
      return { endpoint: `agent:${d.agent_id}|rejected`, content };
    }

    // Legacy events kept for backward compat during transition
    case 'comment.mentioned_legacy':
    case 'doc.mentioned': {
      const d = event.data;
      const cp = d.context || {};
      const target = cp.target || {};
      let content = `[AOSE] ${d.actor || d.sender?.name || 'Someone'} mentioned you in "${target.title || d.doc_title || d.content_title}":\n${d.text_without_mention || d.text || ''}`;
      // reply via is auto-appended by c4-receive.js
      const endpoint = `${d.target_id || d.doc_id || d.content_id}|comment:${d.comment_id || 'none'}`;
      return { endpoint, content };
    }

    default:
      return null; // unhandled event types are silently ignored
  }
}
