# Self-hosting

AgentOffice is designed to be self-hosted.

## Runtime layout

Default local home:

```text
~/.agentoffice/
├── config.json
├── data/
│   ├── gateway.db
│   └── uploads/
└── runtime/
```

## Services

A local AgentOffice runtime starts two processes:

- Shell
- Gateway

The bootstrap CLI starts both and prints the final ports.

## External access

AgentOffice does not bundle a tunnel and does not store a public base URL. You decide how (and whether) to expose it externally.

Typical setups:

- **Local-only** — open `http://127.0.0.1:<shell-port>` in a browser on the same machine. Done.
- **LAN access** — bind a reverse proxy (Caddy, nginx, …) on your LAN IP and forward to the local Shell port.
- **Public internet** — terminate TLS at a reverse proxy or tunnel (Caddy, nginx, Cloudflare Tunnel, ngrok, …) and forward to the local Shell port. AgentOffice trusts `X-Forwarded-Proto` and `X-Forwarded-Host` and uses them when constructing share links, agent callbacks, and webhook URLs.

Internal services still communicate over localhost regardless of how the gateway is exposed.

## Default ports

Requested defaults:
- Shell: `3000`
- Gateway: `4000`

If either port is occupied, AgentOffice will select the next available port.

## Startup command

```bash
npx agentoffice-main
```

For long-running self-hosted instances, install globally and use background mode (see the README's "Daily use" section).

## Data persistence

Your local data lives under `~/.agentoffice/` unless overridden.

Important paths:
- config: `~/.agentoffice/config.json`
- database: `~/.agentoffice/data/gateway.db`
- uploads: `~/.agentoffice/data/uploads/` (overridable via `UPLOADS_DIR`)

## Backup recommendation

At minimum, back up:
- `config.json`
- `data/gateway.db`
- `data/uploads/`

## Current scope

The first public bootstrap version targets a single local instance. It is not a multi-node or cluster deployment story.
