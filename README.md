# ASuite

Human-Agent collaborative workspace suite.

## Features

- **Docs** — Rich text editor (ProseMirror)
- **Database** — Spreadsheet with multiple views (Grid/Kanban/Gallery/Form)
- **Slides** — Presentation editor (Fabric.js)
- **Flowchart** — Diagram editor (AntV X6)
- **Agent Integration** — AI agents as first-class collaborators

## Quick Start

```bash
docker compose up
```

Open http://localhost:3101 in your browser.

## Architecture

```
shell/          # Frontend (Next.js 14)
gateway/        # API server (Node.js + Express + SQLite)
adapters/       # Agent adapters
mcp-server/     # MCP tool server
```

## Tech Stack

- **Frontend:** Next.js 14, React, Tailwind CSS, ProseMirror, Fabric.js, AntV X6
- **Backend:** Node.js, Express, SQLite, Baserow (database editor)
- **Deployment:** Docker Compose

## License

MIT
