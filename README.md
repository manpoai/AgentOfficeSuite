
![headerreadme](https://github.com/user-attachments/assets/f7e07cfa-f626-4f0f-9b66-b4ab253f65cf)

<u>English</u> | [中文](./README.cn.md) | [X](https://x.com/manpoai)


# What is aose?

## An office suite for you and your Agents to work together

aose brings documents, databases, slides, and flowcharts into one shared workspace. You can ask an Agent to create documents, update tables, organize slide decks, or add flowcharts, and you can also continue editing, writing comments, reviewing version history, and restoring content yourself. Tasks can start from the chat tools you already use, or continue directly inside aose through comments and `@agent`.

In aose, you and your Agents work on the same content: creating, reading, editing, commenting, and tracking changes together, with the entire process staying inside the system. **It enables people and Agents, as equal participants, to keep collaborating around the same piece of content over time — without repeatedly re-explaining context in chat windows, and without switching back and forth across multiple tools.**

![pic](https://github.com/user-attachments/assets/0eddbb27-58f3-45cf-a6e9-96759a44cbb8)

---


## Quickstart

### 1. Start a local aose workspace

```bash
npx aose-main
```

This bootstrap package downloads the runtime artifact from GitHub Releases, initializes your local aose workspace, and automatically starts the local service.

aose runs as a local service on `http://localhost:3000` (Shell) and `http://localhost:4000` (Gateway). The recommended setup is to run your agents on the same machine — they connect to aose via `http://localhost:4000` automatically, with zero configuration.

If you want to access aose from another device, or run an agent on another machine, see [Custom external URL](#custom-external-url) below.

### 2. Daily use (recommended)

For regular use, install aose globally so you get background mode, status checks, and one-command updates:

```bash
npm install -g aose-main
```

Then manage the service with:

```bash
aose start -d   # start in background
aose status     # show status, version, health
aose stop       # stop the service
aose restart    # restart the service
aose logs -f    # tail logs
aose update     # download latest runtime and restart
aose version    # show bootstrap and runtime versions
```

`npx aose-main` and the global install share the same data directory (`~/.aose/`), so you can switch between them at any time without losing data. The bootstrap package itself is upgraded with `npm install -g aose-main@latest`; the runtime is upgraded separately with `aose update`. The two are intentionally decoupled.

---

## Custom external URL

The default same-machine setup needs no configuration. This section is only for when you want a different address — for example, you're hosting aose on one machine and want an agent on another machine to reach it.

### Step 1 — Expose aose on your chosen URL

Set up your own way to forward your URL to `http://localhost:3000`:

- a tunnel (Cloudflare Tunnel, ngrok, frp, tailscale-funnel, …), or
- a reverse proxy (Caddy, nginx, …) on a custom domain

You pick the method. aose does not bundle one.

### Step 2 — Point your agent at the new URL

On the machine where the agent runs, run:

```bash
npx aose-mcp set-url https://your-domain.com/api/gateway
```

That's it. The next time the agent's MCP server starts, it will use the new URL.

To check the current setting:

```bash
npx aose-mcp show-config
```

### Remote agent you cannot directly access

Most agents run on a machine you can `cd` into, so Step 2 above just works. The exception is when the agent runs on a remote host you don't have shell access to (a cloud VM, someone else's machine, a hosted agent platform). In that case you can't run `set-url` yourself.

Send the agent a message asking it to run the command on its side:

```
I switched my aose to a new URL: <NEW_URL>
Please run this command in your environment to update your aose MCP connection:

  npx aose-mcp set-url <NEW_URL>

Then call the `whoami` tool to confirm the new connection works.
```

If even that isn't possible, you'll need to update the agent host's MCP configuration directly — each platform documents this differently (typically by editing the `mcpServers` block in the agent's config file).

---

## How to connect an Agent

| Step | Stage | Description |
|---|---|---|
| Step 1 | Onboard | Copy the onboarding prompt from aose and send it to the Agent. The Agent initiates a registration request. |
| Step 2 | Activate | Review and approve the Agent's registration request in aose. |
| Step 3 | Start collaborating | Assign tasks to the Agent from your original chat platform, or start collaboration directly in aose comments with `@agent`. |

If you later move aose to a different URL, see [Custom external URL](#custom-external-url) above.

Support for host-style Agent platforms will continue to expand. Current platforms include:

- OpenClaw
- Zylos
- Claude Code
- Codex CLI
- Gemini CLI

---

## How collaboration happens

Collaboration in aose usually starts from two entry points.

### 1. Started from your existing chat tools

You can continue assigning tasks to an Agent in the chat tools you already use, for example:

- Create a new document
- Turn meeting notes into a structured database
- Generate a first version of slides from existing content
- Add a flowchart based on requirements
- Modify part of an existing document

After receiving a task, an Agent can create, read, and modify the corresponding content in aose. Once completed, that content remains in aose so that you and your Agents can continue reviewing, discussing, editing, and restoring it later.

### 2. Continued from inside the content itself

Once documents, databases, slides, and flowcharts are already in the system, you can also continue collaboration directly inside the content object itself, for example:

- Write comments
- `@agent`
- Request changes
- Specify additional information
- Continue discussion around a certain section or object

This keeps follow-up collaboration attached to the content itself, without moving context back and forth.

---

## aose is for you if you want to

- Let Agents directly create, read, and modify real content, instead of keeping them only inside chat windows
- Use one workspace to hold documents, databases, slides, flowcharts, and other content
- Keep collaboration attached to specific objects, instead of repeatedly copying content, re-explaining context, and pasting it back
- Keep a record, version history, and restore points for Agent edits
- Preserve permission boundaries and human intervention while bringing Agents into the workflow

---

## Features

### Docs

A rich-text document editor that supports you and your Agents in continuously creating, editing, and discussing the same document.

- 19 content blocks: paragraph, heading, bulleted list, numbered list, task list, quote block, code block (with syntax highlighting), divider, table, image, Mermaid diagram, embedded flowchart, content link (ContentLink), and more
- 9 inline styles: bold, italic, strikethrough, code, underline, highlight, link, superscript, subscript
- Supports real-time embedded references (ContentLink) to other documents and flowcharts, with linked content kept in sync
- Agents can create and edit documents through MCP tools, with a version snapshot automatically saved before editing

### Databases

A structured database editor that supports multiple field types, views, and relations between tables.

- 20 field types: text, long text, number, single select, multi select, date, datetime, checkbox, URL, email, phone number, rating, percentage, currency, auto increment, formula, link, lookup, attachment, JSON
- 4 views: Grid, Kanban, Gallery, Form
- Supports table relationships through Link fields and value references from related tables through Lookup fields

### Slides

A presentation editor for creating, modifying, and reviewing slide content.

- Supports text boxes, shapes, images, embedded tables, real-time flowchart references, and other elements
- Supports property controls such as position and size, fill color, border, font styles, text alignment, rotation, z-index, and opacity
- Text boxes inside slides support full rich-text editing
- Can export to standard PowerPoint format (PPTX)

### Flowcharts

A flowchart editor based on a node-and-edge model, supporting complex diagram creation and collaboration.

- 24 node shapes: rectangle, rounded rectangle, diamond, parallelogram, circle, ellipse, hexagon, star, triangle, database icon, document icon, and more
- 4 edge styles: straight, orthogonal polyline, smooth curve, rounded polyline
- Supports arrow style, line width, color, and label text configuration
- Supports node fill color, border color, font, text alignment, and size configuration

### Comments

A unified commenting system shared across all content types.

- Documents, databases, slides, and flowcharts all use the same comment system
- Comments can be precisely anchored to document text selections, images, table rows, slide elements, or flowchart nodes and edges
- Collaboration can be triggered via `@agent`, and the mentioned party receives real-time notifications
- Events received by an Agent include the comment text, anchor context, and surrounding content snippets, making it easier to understand context and take action directly

### Version History

Version history and restore capability provide a safety net for workflows involving Agents.

- Before an Agent edits a document or database through MCP, the system automatically creates a version snapshot
- Any content can be restored to a previous version
- Version history for documents, databases, slides, and flowcharts is managed in a unified way

### Agent Management

Identity and lifecycle management for Agents.

- Agents can self-register through the onboarding prompt, using the configured public aose URL
- Registration requests must be approved before activation
- Each Agent is labeled with its platform, such as Zylos, OpenClaw, Claude Code, Codex CLI, or Gemini CLI
- Supports displaying Agent online/offline status and last active time
- Admins can reset an Agent’s token

### Notifications

A real-time notification system.

- You receive notifications when your content gets a new comment
- You receive notifications when your comment gets a reply
- You receive notifications when you are `@mentioned`
- Admins receive notifications when a new Agent registers

### Search

Global search across all major content types.

- Supports searching document titles and body content
- Supports full-text search (FTS5)
- Search results highlight matched keywords

---

## Roadmap

- Tasks
- Project Management
- Messaging

---

## Contributing

Contributions are welcome.

Good ways to contribute right now include:

- Submitting bug reports
- Improving documentation
- Fixing installation and self-hosting issues
- Improving Agent integration capabilities
- Fixing editor reliability issues

For more details, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Community

- Discord(https://discord.gg/HStjGVg6)
- GitHub Issues — bugs and feature requests(https://github.com/yingcaishen/aose/issues)

  

## License

Agent Office is currently planned to launch under GNU AGPL v3.0 or later as its open-source license.

See [LICENSE](./LICENSE).
