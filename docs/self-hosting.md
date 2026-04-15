# Self-hosting

aose is designed to be self-hosted.

## Runtime layout

Default local home:

```text
~/.aose/
├── config.json
├── data/
│   ├── gateway.db
│   └── uploads/
└── runtime/
```

## Services

A local aose runtime starts two processes:

- Shell
- Gateway

The bootstrap CLI starts both and prints the final ports.

## External access

The recommended setup is single-machine: aose and your agents both run on the same host, and agents reach aose via `http://localhost:4000` with no extra configuration.

If you need an external URL — for example, to run an agent on another machine — pick any way to forward your URL to the local Shell port (Cloudflare Tunnel, ngrok, frp, tailscale-funnel, Caddy, nginx, …). aose reads `X-Forwarded-Proto` / `X-Forwarded-Host` from the incoming request and uses them when constructing share links and agent callbacks, so the workspace will display the right hostname automatically.

### Chained reverse proxies

If you stack two reverse proxies in front of aose (e.g. `Cloudflare Tunnel → Caddy → Shell`, `ALB → nginx → Shell`, `Cloudflare → Traefik → Shell`), the inner proxy will by default **overwrite** `X-Forwarded-Proto` / `X-Forwarded-Host` with its own view of the local TCP connection (usually `http` + `localhost`). aose then generates prompts, share links and agent callbacks with `http://localhost:...` instead of your real `https://...` domain — agents written with those URLs cannot reconnect, and SSE/webhook callbacks break.

Configure your inner proxy to trust the outer one:

- **Caddy** — add a global `servers { trusted_proxies static private_ranges 127.0.0.1/32 ::1/128 }` block (or the specific CIDRs of your outer proxy).
- **nginx** — `set_real_ip_from <outer-proxy-cidr>;` and `real_ip_header X-Forwarded-Proto;` (plus `proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;` on the `location` that reverse-proxies to Shell).
- **Traefik** — set `entryPoints.<name>.forwardedHeaders.trustedIPs` to the outer proxy's address range.

Single-proxy setups (`cloudflared → Shell` direct, `nginx → Shell` alone, a single Docker ingress) do **not** need any of this — the sole proxy writes `X-Forwarded-Proto` itself and Shell reads it directly.

To switch an agent over to the new URL, run on the agent's machine:

```bash
npx aose-mcp set-url https://your-domain.com/api/gateway
```

Internal services still communicate over localhost regardless of how the gateway is exposed.

## Default ports

Requested defaults:
- Shell: `3000`
- Gateway: `4000`

If either port is occupied, aose will select the next available port.

## Startup command

```bash
npx aose
```

For long-running self-hosted instances, install globally and use background mode (see the README's "Daily use" section).

## Data persistence

Your local data lives under `~/.aose/` unless overridden.

Important paths:
- config: `~/.aose/config.json`
- database: `~/.aose/data/gateway.db`
- uploads: `~/.aose/data/uploads/` (overridable via `UPLOADS_DIR`)

## Backup recommendation

At minimum, back up:
- `config.json`
- `data/gateway.db`
- `data/uploads/`

## Current scope

The first public bootstrap version targets a single local instance. It is not a multi-node or cluster deployment story.
