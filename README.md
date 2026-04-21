
![AOSE](docs/heropic.jpg)

<u>English</u> | [中文](./README.cn.md) | [日本語](./README.ja.md) | [X](https://x.com/manpoai)

# AOSE — An Office Suite Built for Agent Collaboration

AOSE brings Agents into the office suite as real collaborators — not as command-execution tools, but as coworkers who can be @mentioned, receive tasks, leave traces in documents, and continue conversations through your existing channels.

![figure1](docs/figure1.jpg)

---

## Highlights

![figure2](docs/figure2.jpg)

### Your existing Agent, with full memory and context, collaborating directly

Agents connected to AOSE are active collaborators, not passive tools waiting to be triggered. @mention an Agent in a document, and it receives the task in real time — with full context: the document, the anchored paragraph, and surrounding content snippets. It can reply in place, edit content, and leave version records, without requiring further human intervention.

Connection is via standard MCP Server (`npx aose-mcp`), with out-of-the-box support for Claude Code, Codex CLI, Gemini CLI, and other mainstream Agent platforms. For local CLI Agents or those without native adapters, a lightweight sidecar service handles the connection — maintaining persistent connections and real-time push. The Agent itself doesn't need to change at all; its existing memory, context, and capabilities are fully preserved.

Collaboration isn't limited to AOSE either. You can still communicate with your Agent through Telegram, Lark, Slack, or any other channel you already use — both channels stay in sync, and you don't need to change any habits.

![figure3](docs/figure3.jpg)

### Full-featured editors, not read-only previews of Agent output

AOSE is not a viewer for Agent-generated artifacts. Every editor is designed for both humans and Agents to use directly.

| Type | Description | Highlights |
| --- | --- | --- |
| Docs | Rich-text editor with cross-document live references (ContentLink) | 19 content blocks, 9 inline styles |
| Databases | Structured data editor with inter-table relationships (Link / Lookup) | 20 field types, 4 views |
| Slides | Presentation editor with embedded tables and flowchart references, PPTX export | Full rich-text editing |
| Flowcharts | Node-and-edge diagram editor with full visual customization | 24 node shapes, 4 edge styles |

Agents create and edit through MCP tools. Humans use the same editor in the browser. Both operate on the same object — not a copy, not a preview, not a chat message.

![figure4](docs/figure4.jpg)

### Comprehensive version history — Agent actions are traceable and reversible

Before any Agent edit — whether on a document, database, presentation, or flowchart — AOSE automatically creates a version snapshot. Every change is attributed to the Agent that made it, with a timestamp.

If an Agent makes an unexpected change, you can: browse the full version history, preview any historical state, and restore with one click. Agent actions are not a black box. They are traceable, auditable, and reversible at any time.

---

## Quickstart

### 1. Start a local AOSE workspace

```bash
npx aose-main
```

This bootstrap package downloads the runtime artifact from GitHub Releases, initializes your local workspace, and automatically starts the service.

AOSE runs as a local service on `http://localhost:3000` (Shell) and `http://localhost:4000` (Gateway). The recommended setup is to **run AOSE and your Agents on the same machine** — Agents connect via `http://localhost:4000` automatically, with zero configuration.

If you want to access AOSE from another device, or run an Agent on another machine, see [Custom external URL](#custom-external-url) below.

### 2. Daily use (recommended)

For regular use, install AOSE globally to get background mode, status checks, and one-command updates:

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

## How to connect an Agent

| Step | Stage | Description |
| --- | --- | --- |
| Step 1 | Onboard | Copy the onboarding prompt from AOSE and send it to the Agent. The Agent initiates a registration request. |
| Step 2 | Activate | Review and approve the Agent's registration request in AOSE. |
| Step 3 | Start collaborating | Assign tasks from your existing chat platform, or start collaboration directly in AOSE comments with `@agent`. |

Support for Agent platforms will continue to expand. Currently includes:

- Claude Code
- Codex CLI
- Gemini CLI
- OpenClaw
- Zylos

---

## Custom external URL

The default same-machine setup needs no configuration. This section is only for when you want a different address — for example, you're hosting AOSE on one machine and want an Agent on another machine to reach it.

### Step 1 — Expose AOSE on your chosen URL

Set up your own way to forward your URL to `http://localhost:3000`:

- a tunnel (Cloudflare Tunnel, ngrok, frp, tailscale-funnel, …), or
- a reverse proxy (Caddy, nginx, …) on a custom domain

You pick the method. AOSE does not bundle one.

### Step 2 — Point your Agent at the new URL

On the machine where the Agent runs:

```bash
npx aose-mcp set-url https://your-domain.com/api/gateway
```

That's it. The next time the Agent's MCP server starts, it will use the new URL.

To check the current setting:

```bash
npx aose-mcp show-config
```

### Remote Agent you cannot directly access

Most Agents run on a machine you can `cd` into, so Step 2 above just works. The exception is when the Agent runs on a remote host you don't have shell access to (a cloud VM, someone else's machine, a hosted Agent platform). In that case you can't run `set-url` yourself.

Send the Agent a message asking it to run the command on its side:

```
I switched my AOSE to a new URL: <NEW_URL>
Please run this command in your environment:

  npx aose-mcp set-url <NEW_URL>

Then call the whoami tool to confirm the new connection works.
```

If even that isn't possible, you'll need to update the Agent host's MCP configuration directly — each platform documents this differently (typically by editing the `mcpServers` block in the Agent's config file).

---

## Features

| Feature | Description | Highlights |
| --- | --- | --- |
| **Docs** | Rich-text document editor for continuous creation, editing, and discussion between you and your Agents | 19 content blocks (paragraph, heading, lists, code block, table, image, Mermaid, ContentLink, etc.); 9 inline styles; cross-document live references; auto version snapshot before Agent edits |
| **Databases** | Structured data editor with multiple field types, views, and inter-table relationships | 20 field types (text, number, single/multi select, date, formula, link, lookup, etc.); 4 views (Grid / Kanban / Gallery / Form); Link + Lookup relationships |
| **Slides** | Presentation editor for creating, modifying, and reviewing slide content | Text boxes, shapes, images, embedded tables, flowchart references; full rich-text editing; position/fill/border/font/rotation/z-index/opacity controls; PPTX export |
| **Flowcharts** | Node-and-edge flowchart editor for complex diagram creation and collaboration | 24 node shapes; 4 edge styles (straight / orthogonal / smooth curve / rounded); arrow/width/color/label config; node fill/border/font/size config |
| **Comments** | Unified commenting system shared across all content types | Precise anchoring to document selections, images, table rows, slide elements, flowchart nodes or edges; `@agent` real-time notifications; events include anchor context and content snippets |
| **Version History** | Version history and restore capability as a safety net for Agent workflows | Auto snapshot before Agent edits; one-click restore to any version; unified management across docs/databases/slides/flowcharts |
| **Agent Management** | Identity and lifecycle management for Agents | Self-registration via onboarding prompt; approval-based activation; platform labeling; online status and last active time; token reset |
| **Notifications** | Real-time notification system | New comments, comment replies, @mentions, new Agent registration alerts |
| **Search** | Global search across all major content types | Document title and body search; full-text search (FTS5); keyword highlighting |

---

## Roadmap

- Task Management
- Messaging

---

## Contributing

Contributions are welcome. Good ways to contribute right now include:

- Submitting bug reports
- Improving documentation
- Fixing installation and self-hosting issues
- Improving Agent integration capabilities
- Fixing editor reliability issues

For more details, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Community

- [GitHub Issues](https://github.com/manpoai/AgentOfficeSuite/issues) — bugs and feature requests

## License

AOSE is licensed under the Apache License 2.0.

See [LICENSE](./LICENSE).
