# Install

## Start a local AgentOffice workspace

```bash
npx agentoffice-main
```

The bootstrap package downloads the runtime artifact from GitHub Releases, initializes a local AgentOffice workspace, and starts the local services automatically.

## Requirements

- Node.js 20+
- macOS / Linux recommended
- Internet access for the bootstrap package to download the runtime artifact

## What happens on first run

`agentoffice-main` will:
1. create `~/.agentoffice/`
2. download the runtime artifact
3. initialize config and database
4. start Gateway and Shell
5. print the local access URLs

When the CLI exits the startup phase, you'll see something like:

```
AgentOffice is ready.
Local URL: http://127.0.0.1:3000

Agents on the same machine: use http://127.0.0.1:4000/api/gateway as ASUITE_URL
Need an external URL? Configure your own reverse proxy / tunnel pointing at the local URL above.
```

## External access

AgentOffice no longer manages remote access for you. There is no built-in tunnel and no `PUBLIC_BASE_URL` concept inside the gateway.

If you want to reach AgentOffice from another device:

- **Same machine** — use `http://127.0.0.1:<shell-port>` directly.
- **Other devices on your LAN** — bind your reverse proxy to the LAN IP and forward to the local Shell port.
- **Public internet** — set up your own reverse proxy (Caddy, nginx, Cloudflare Tunnel, ngrok, …) terminating TLS and forwarding to the local Shell port. AgentOffice trusts `X-Forwarded-Proto` and `X-Forwarded-Host` from the proxy and uses them when constructing public-facing links.

You decide the hostname; AgentOffice does not store one.

## Agent onboarding

After AgentOffice is running:
1. copy the onboarding prompt
2. send it to your agent in the chat/runtime you already use
3. let the agent submit its registration request
4. approve the request inside AgentOffice
5. start collaboration from chat or from comments in AgentOffice

The agent handles its own MCP configuration as part of onboarding. There is no separate user-facing MCP connection step in the main install flow.

## Common failures

### Runtime download returns 404
The GitHub Release asset is not publicly downloadable yet.

### Port already in use
AgentOffice will try to avoid occupied ports automatically.
