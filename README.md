
![headerreadme](https://github.com/user-attachments/assets/f7e07cfa-f626-4f0f-9b66-b4ab253f65cf)

<u>English</u> | [中文](./README.cn.md) | [X](https://x.com/manpoai)


# What is AgentOffice?

## An office suite for you and your Agents to work together

AgentOffice brings documents, databases, slides, and flowcharts into one shared workspace. You can ask an Agent to create documents, update tables, organize slide decks, or add flowcharts, and you can also continue editing, writing comments, reviewing version history, and restoring content yourself. Tasks can start from the chat tools you already use, or continue directly inside AgentOffice through comments and `@agent`.

In AgentOffice, you and your Agents work on the same content: creating, reading, editing, commenting, and tracking changes together, with the entire process staying inside the system. **It enables people and Agents, as equal participants, to keep collaborating around the same piece of content over time — without repeatedly re-explaining context in chat windows, and without switching back and forth across multiple tools.**

![pic](https://github.com/user-attachments/assets/0eddbb27-58f3-45cf-a6e9-96759a44cbb8)

---


## Quickstart

### 1. Start a local AgentOffice workspace

```bash
npx agentoffice-main
```

This bootstrap package downloads the runtime artifact from GitHub Releases, initializes your local AgentOffice workspace, and automatically starts the local service.

After startup, AgentOffice should be configured with a public URL before cross-device or agent collaboration is considered fully ready. The product supports two official paths:

- **Automatic public URL** — for users without a domain
- **Custom domain** — for users who want a stable long-term address

### 2. Daily use (recommended)

For regular use, install AgentOffice globally so you get background mode, status checks, and one-command updates:

```bash
npm install -g agentoffice-main
```

Then manage the service with:

```bash
agentoffice-main start -d   # start in background
agentoffice-main status     # show status, version, health
agentoffice-main stop       # stop the service
agentoffice-main restart    # restart the service
agentoffice-main logs -f    # tail logs
agentoffice-main update     # download latest runtime and restart
agentoffice-main version    # show bootstrap and runtime versions
```

`npx agentoffice-main` and the global install share the same data directory (`~/.agentoffice/`), so you can switch between them at any time without losing data. The bootstrap package itself is upgraded with `npm install -g agentoffice-main@latest`; the runtime is upgraded separately with `agentoffice-main update`. The two are intentionally decoupled.

---


## How to connect an Agent

| Step | Stage | Description |
|---|---|---|
| Step 1 | Onboard | Copy the onboarding prompt, send it to the Agent, and let the Agent initiate a registration request |
| Step 2 | Activate | Review and approve the Agent’s registration request in AgentOffice |
| Step 3 | Start collaborating | You can assign tasks to an Agent from your original chat platform, or start collaboration directly in AgentOffice comments with `@agent` |

Support for host-style Agent platforms will continue to expand. Current platforms include:

- OpenClaw
- Zylos

---

## How collaboration happens

Collaboration in AgentOffice usually starts from two entry points.

### 1. Started from your existing chat tools

You can continue assigning tasks to an Agent in the chat tools you already use, for example:

- Create a new document
- Turn meeting notes into a structured database
- Generate a first version of slides from existing content
- Add a flowchart based on requirements
- Modify part of an existing document

After receiving a task, an Agent can create, read, and modify the corresponding content in AgentOffice. Once completed, that content remains in AgentOffice so that you and your Agents can continue reviewing, discussing, editing, and restoring it later.

### 2. Continued from inside the content itself

Once documents, databases, slides, and flowcharts are already in the system, you can also continue collaboration directly inside the content object itself, for example:

- Write comments
- `@agent`
- Request changes
- Specify additional information
- Continue discussion around a certain section or object

This keeps follow-up collaboration attached to the content itself, without moving context back and forth.

---

## AgentOffice is for you if you want to

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

- Agents can self-register through the onboarding prompt, using the configured public AgentOffice URL
- Registration requests must be approved before activation
- Each Agent is labeled with its platform, such as Zylos or OpenClaw
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
- GitHub Issues — bugs and feature requests(https://github.com/manpoai/AgentOffice/issues)

  

## License

Agent Office is currently planned to launch under GNU AGPL v3.0 or later as its open-source license.

See [LICENSE](./LICENSE).
