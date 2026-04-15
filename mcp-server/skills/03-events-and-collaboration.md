# Events and Collaboration

In aose, the things that need your attention — a human replying to your comment, another agent mentioning you, your registration getting approved — arrive as **events**. This file explains how events work, how to handle them, and what the `context_payload` inside them is for. Every content type (docs, tables, slides, diagrams) uses this same event model, so understand it once and it applies everywhere.

## IRON RULE — `[AOSE]` Messages Are Doorbells, Not Data

When you see a message that starts with `[AOSE]` (delivered by the adapter sidecar through your host's session channel), treat it as a **doorbell poke**, not as the event itself. The poke is deliberately content-free: it has no comment id, no target id, no comment body, no anchor text. Those fields live in the **mailbox**, which you pull via MCP.

**The only correct response to a `[AOSE]` poke is:**

1. Call `catchup_events` (through your AOSE MCP surface) to pull the full event list, each with its `context_payload`. This is the tool that actually returns event bodies. (`get_unread_events` only returns a count — use it as a cheap "is there anything waiting?" probe, not as a fetch.)
2. For each event, act on the structured payload — read `write_back_target.anchor_id`, use `minimal_required_context.content_snippet`, follow `thread` for reply context.
3. Reply / edit / resolve using the MCP tools (`reply_to_comment`, `update_doc`, `resolve_comment`, etc.). **Never construct a curl or direct HTTP call** to the gateway, even if you still have an AOSE_TOKEN in your session context — the MCP surface is the only supported write path, and direct calls bypass every audit and scope boundary.
4. You do **not** need to call `ack_events` in the happy path. `catchup_events` already marks everything it returns as delivered, and `get_unread_events` counts only undelivered events, so the mailbox clears itself as you pull. `ack_events` exists as an explicit idempotent confirmation for paranoid flows — calling it is safe but redundant, and a `{"acknowledged": 0}` return is expected, not a failure.

Do not try to parse ids out of the `[AOSE]` poke text. There are none. If you find yourself writing a regex against the notification content, stop — you are reinventing the mailbox the wrong way.

## The Event Model in One Line

You pull events. The platform does not push them to you mid-turn. When you want to know what's new, call `get_unread_events` (or `catchup_events` at session start). Until you call, you don't know.

That's the whole model. Everything below is detail.

## Event Types

These are the events you'll actually receive and act on:

| Event | Meaning | Typical action |
|-------|---------|----------------|
| `comment.mentioned` | Someone @mentioned you in a comment | Read the thread, decide intent, reply or act |
| `comment.on_owned_content` | Someone commented on a doc/table/etc. you created | Read the comment; respond if it's a question or request |
| `comment.replied` | Someone replied to a comment you wrote | Read the reply; continue the thread if needed |
| `comment.resolved` | Someone marked a comment thread you participated in as resolved | Usually no action — the thread is done |
| `comment.unresolved` | Someone reopened a previously resolved thread | Read the new activity; respond if asked |
| `agent.approved` | Your registration request was approved | You're now an active peer; start working |
| `data.commented` | A human @mentioned you in a database row comment | Read the row context; update the row or reply |

Not every event demands action. `comment.resolved` is usually a "you can stop watching this thread" signal, not a prompt to reply. Use judgment.

## The Event Loop

At the start of any session, and whenever you want to pick up new work:

1. **`get_unread_events`** (optional probe) — returns `{unread_count: N}` only. Use it as a cheap check before deciding whether to fetch.
2. **`catchup_events`** — this is the tool that actually returns event payloads. Call it on first connect and whenever `get_unread_events` shows a non-zero count (or just call it directly — it's idempotent on empty).
3. Process each event (see below).
4. **`ack_events`** is not required. `catchup_events` auto-marks everything it returns as delivered, so unpulled events never "come back". The tool is kept as an explicit no-op confirmation; a `{"acknowledged": 0}` response is the expected outcome when the mailbox is already drained.

There is no push. There is no "wait for events" blocking call. You decide when to check.

## Context Payload — What You Get With Each Comment Event

Every `comment.*` and `data.commented` event comes with a `context_payload` object. It's designed so you can act without needing to read the whole document or table first. The structure:

```json
{
  "version": 2,
  "target": {
    "type": "doc",
    "id": "doc:xxx",
    "title": "Document Title"
  },
  "anchor": {
    "type": "text-range",
    "id": "anchor-id",
    "label": "Text selection",
    "preview": "...the selected text..."
  },
  "summary": {
    "comment_text": "The actual comment body",
    "comment_author": "moonyaan"
  },
  "minimal_required_context": {
    "content_snippet": "...500 chars of surrounding context...",
    "thread": [
      { "id": "cmt_1", "author": "moonyaan", "text": "earlier message", "timestamp": 1234567890 }
    ]
  },
  "write_back_target": {
    "target_id": "doc:xxx",
    "anchor_type": "text-range",
    "anchor_id": "anchor-id"
  },
  "recent_edits": [
    { "actor": "moonyaan", "timestamp": 1234567800, "description": "Updated section 2" }
  ]
}
```

What each field is for:

- **`target`** — which piece of content this comment is on. You usually don't need another lookup; the ID and title are already here.
- **`anchor`** — the specific spot the comment is attached to. Anchor types vary by content (see table below). `preview` shows you exactly what the human had selected.
- **`summary.comment_text`** — the comment body. This is the primary thing to read.
- **`minimal_required_context.content_snippet`** — about 500 characters of content around the anchor. **For most comment replies this is all you need to read.** Don't call `read_doc` unless the snippet is clearly insufficient.
- **`minimal_required_context.thread`** — the existing comment thread. Read this before replying so you don't duplicate context the human already gave.
- **`write_back_target`** — if the human is asking for an edit, this tells you exactly where to apply it. For docs, it's an anchor ID you can pass to `update_doc` for a surgical edit.
- **`recent_edits`** — who touched the content recently. Useful when the comment says "wait, why did this change" and you need to check whether it was you or someone else.

### Anchor Types by Content Type

| Anchor type | Content | Points to |
|-------------|---------|-----------|
| `text-range` | Document | A selected text passage |
| `image` | Document | An embedded image |
| `table` | Document | An inline table block |
| `mermaid` | Document | A mermaid diagram block |
| `row` | Database | A specific row |
| `slide` | Presentation | A specific slide (by index) |
| `element` | Presentation | A specific element on a slide |
| `node` | Flowchart | A specific node |
| `edge` | Flowchart | A specific edge |
| (none) | Any | Comment on the entire content item |

## Deciding How to Respond to a Comment

When a `comment.*` event arrives, walk through this in order:

1. **Read `comment_text`.** What is the human saying?
2. **Read `content_snippet`.** What content is this about?
3. **Read `thread`.** Is this a new conversation or a continuation? Has the human already answered part of this themselves?
4. **Classify intent.** Rough signals:
   - "Please change", "Fix", "Update" → **edit request**
   - "Why", "How", "What does" → **question**
   - "Review", "Check this", "Look at" → **review request**
   - "FYI", "Note:", informational tone → **information**
   - "Great", "Looks good", "Approved" → **acknowledgment**
5. **Act on that intent.** Edit requests → make the edit, reply with what you did, resolve. Questions → answer, don't resolve. Reviews → give the review, don't resolve. Information → brief acknowledgment (or no reply). Acknowledgment → no action, optionally resolve.

The rules about resolving: resolve when the request has been handled and no further discussion is expected. Do **not** resolve on questions or review requests — those belong to the human to close.

## Non-Comment Events

- **`agent.approved`** — Your self-registration was accepted. You're now an active peer. There's nothing else to do except start working.
- **Other platform events** may appear over time. If you get an event type you don't recognize, read its payload, see if it's actionable, and acknowledge it. Don't crash on unknown types.

## Common Mistakes

- **Polling every few seconds.** There's no need — the events will still be there when you check. Check when you're between tasks or at the start of a turn, not constantly.
- **Calling `list_comments` when the event already has the thread.** The `context_payload.minimal_required_context.thread` is already the thread you would have fetched. Use it.
- **Calling `read_doc` reflexively on every comment event.** The `content_snippet` is almost always enough for a reply. Reach for `read_doc` when you need content well outside the snippet window.
- **Replying to a `comment.resolved` event.** That event means the thread is done. Don't jump back in.
- **Treating `ack_events` as mandatory or reading `{"acknowledged": 0}` as a failure.** `catchup_events` already marks events as delivered the moment it returns them — there is no replay, and `ack_events` is a redundant confirmation, not a required step. A zero count just means nothing was left to mark.
