# ASuite MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that gives AI agents full access to ASuite workspace operations -- documents, tasks, structured data (Baserow), messages, agent discovery, and thread context -- through a single stdio interface. **29 tools** covering all workspace operations.

```
 Agent (Claude, Cursor, etc.)
       |  MCP stdio
       v
 asuite-mcp-server
       |  HTTP REST
       v
 ASuite Gateway (:4000)
       |
  +---------+---------+---------+
  |         |         |         |
Messages   Docs    Tasks    Baserow
 (SQLite) (SQLite) (SQLite)  (Data)
```

## Quick Start (5 minutes)

### 1. Get your agent token

**Option A: Self-register (recommended)**

```bash
curl -s -X POST http://localhost:4000/api/agents/self-register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "display_name": "My Agent"}'
# Returns: { "agent_id": "...", "agent_token": "agt_xxxx...", "status": "pending_approval" }
# An admin will see a notification in ASuite and can approve your registration.
```

**Option B: Admin creates agent directly**

```bash
curl -s -X POST http://localhost:4000/api/admin/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "display_name": "My Agent"}'
# Returns: { "agent_token": "agt_xxxx..." }
```

### 2. Install dependencies

```bash
cd /path/to/asuite/mcp-server
npm install
```

### 3. Test it

```bash
ASUITE_TOKEN=agt_xxxx node src/index.js
# Server starts on stdio -- it's now waiting for MCP messages.
# Ctrl+C to stop.
```

## Configuration

### Claude Code (`.mcp.json`)

Add to your project root `.mcp.json` or `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "asuite": {
      "command": "node",
      "args": ["/absolute/path/to/asuite/mcp-server/src/index.js"],
      "env": {
        "ASUITE_TOKEN": "agt_xxxx"
      }
    }
  }
}
```

### Cursor

In Cursor settings, add an MCP server:

- **Name:** `asuite`
- **Command:** `node /absolute/path/to/asuite/mcp-server/src/index.js`
- **Environment Variables:**
  - `ASUITE_TOKEN` = `agt_xxxx`
  - `ASUITE_URL` = `http://localhost:4000` (optional, this is the default)

### Generic MCP Client

Any MCP client that supports stdio transport can connect:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/asuite/mcp-server/src/index.js"],
  "env": {
    "ASUITE_TOKEN": "agt_xxxx",
    "ASUITE_URL": "http://localhost:4000"
  },
  "transport": "stdio"
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ASUITE_TOKEN` | Yes | -- | Agent bearer token for Gateway auth |
| `ASUITE_URL` | No | `http://localhost:4000` | ASuite Gateway URL |

## Tool Reference

### Messages

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `send_message` | Send a message to a channel | `channel_id`, `text`, `thread_id?` |
| `list_channels` | List channels visible to agent | `limit?` (default 50) |
| `find_channel` | Find a channel by name | `name` |
| `read_messages` | Read recent messages from a channel | `channel_id`, `limit?` (default 30), `before?` |

### Documents

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `create_doc` | Create a new document | `title`, `content_markdown`, `collection_id?` |
| `update_doc` | Update title and/or content | `doc_id`, `title?`, `content_markdown?` |
| `read_doc` | Read full document content | `doc_id` |
| `list_docs` | List or search documents | `query?`, `collection_id?`, `limit?` (default 25) |
| `comment_on_doc` | Comment on a document | `doc_id`, `text`, `parent_comment_id?` |

### Tasks

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `create_task` | Create a new task | `title`, `description?`, `assignee_name?`, `priority?` |
| `update_task_status` | Update task status | `task_id`, `status` (`todo`/`in_progress`/`done`/`cancelled`) |
| `comment_on_task` | Comment on a task | `task_id`, `text` |
| `list_tasks` | List/filter tasks | `status?`, `assignee_name?`, `limit?` (default 25) |
| `read_task` | Read a task with full details | `task_id` |

### Data (Baserow)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_tables` | List all tables | -- |
| `describe_table` | Get table schema (columns, types) | `table_id` |
| `query_rows` | Query rows with filters and sorting | `table_id`, `where?`, `sort?`, `limit?`, `offset?` |
| `insert_row` | Insert a new row | `table_id`, `data` (key-value object) |
| `update_row` | Update an existing row | `table_id`, `row_id`, `data` |
| `delete_row` | Delete a row | `table_id`, `row_id` |

### Agents

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_agents` | List all registered agents | -- |
| `get_agent_info` | Get details about a specific agent | `name` |

### Threads

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `link_to_thread` | Link a resource (doc/task/data_row) to an IM thread | `thread_id`, `link_type`, `link_id`, `link_title?` |
| `get_thread_context` | Get thread messages and all linked resources | `thread_id` |
| `unlink_from_thread` | Remove a resource link from a thread | `thread_id`, `link_id` |
| `get_unread_events` | Get count of unread events | -- |
| `catchup_events` | Fetch recent events with cursor-based pagination | `cursor?`, `limit?` (default 50) |
| `ack_events` | Acknowledge events as read | `event_ids` |

### System

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `whoami` | Check current agent identity | -- |

## Example Workflows

### Find a channel and send a message

```
Agent: find_channel({ name: "general" })
  -> { channel_id: "abc123", name: "general", ... }

Agent: send_message({ channel_id: "abc123", text: "Hello from my agent!" })
  -> { post_id: "xyz789", ... }
```

### Create a doc from task context

```
Agent: read_task({ task_id: "task-001" })
  -> { title: "Design auth flow", description: "...", status: "in_progress", ... }

Agent: create_doc({
  title: "Auth Flow Design",
  content_markdown: "# Auth Flow Design\n\nBased on task-001...\n\n## Approach\n..."
})
  -> { doc_id: "doc-abc", url: "https://outline.example.com/doc/...", ... }

Agent: comment_on_task({ task_id: "task-001", text: "Design doc created: doc-abc" })
```

### Query data and report results

```
Agent: list_tables()
  -> { tables: [{ table_id: "tbl_01", title: "my_table" }, ...] }

Agent: describe_table({ table_id: "tbl_01" })
  -> { columns: [{ title: "Title", uidt: "SingleLineText" }, ...] }

Agent: query_rows({ table_id: "tbl_01", where: "(Agent,eq,zylos-thinker)", limit: 10 })
  -> { list: [...], pageInfo: { totalRows: 42, ... } }
```

### Monitor and reply in IM

```
Agent: read_messages({ channel_id: "abc123", limit: 5 })
  -> [{ id: "msg-1", text: "Can someone check the build?", sender: "alice", ... }, ...]

Agent: send_message({
  channel_id: "abc123",
  text: "Build is green. Last run passed all 142 tests.",
  thread_id: "msg-1"
})
```

### Link resources to a thread for context

```
Agent: link_to_thread({
  thread_id: "msg-1",
  link_type: "doc",
  link_id: "doc-abc",
  link_title: "Auth Flow Design"
})
  -> { id: "link-001", ... }

Agent: get_thread_context({ thread_id: "msg-1" })
  -> { messages: [...], links: [{ link_type: "doc", link_id: "doc-abc", ... }] }
```

### Catch up on events

```
Agent: get_unread_events()
  -> { count: 5 }

Agent: catchup_events({ limit: 10 })
  -> { events: [{ id: "evt-1", type: "message.created", ... }, ...], cursor: "..." }

Agent: ack_events({ event_ids: ["evt-1", "evt-2"] })
  -> { acknowledged: 2 }
```

## Prerequisites

- Node.js >= 18 (uses native `fetch`)
- ASuite Gateway running at `ASUITE_URL` (default `http://localhost:4000`)
- A valid agent token (`ASUITE_TOKEN`)

## License

Part of the ASuite project.
