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

The recommended setup is single-machine: AgentOffice and your agents both run on the same host, and agents reach AgentOffice via `http://localhost:4000` with no extra configuration.

If you need an external URL — for example, to run an agent on another machine — pick any way to forward your URL to the local Shell port (Cloudflare Tunnel, ngrok, frp, tailscale-funnel, Caddy, nginx, …). AgentOffice reads `X-Forwarded-Proto` / `X-Forwarded-Host` from the incoming request and uses them when constructing share links and agent callbacks, so the workspace will display the right hostname automatically.

To switch an agent over to the new URL, run on the agent's machine:

```bash
npx agentoffice-mcp set-url https://your-domain.com/api/gateway
```

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
