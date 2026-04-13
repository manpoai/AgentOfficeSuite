# Configuration

## AgentOffice bootstrap

### `AGENTOFFICE_HOME`
Override the local data/runtime directory.

Default:

```bash
~/.agentoffice
```

### `PORT`
Requested Shell port.

Default:

```bash
3000
```

### `GATEWAY_PORT`
Requested Gateway port.

Default:

```bash
4000
```

### `UPLOADS_DIR`
Override where uploaded files (avatars, attachments, thumbnails) are stored on disk.

Default: `${AGENTOFFICE_HOME}/data/uploads`.

### `AGENTOFFICE_ARTIFACT_URL`
Override the runtime artifact download URL used by `agentoffice-main`.

Default points to the GitHub Release asset for the current public bootstrap flow.

## External URLs

Public-facing links (share links, agent callbacks, webhooks) are derived per-request from the incoming HTTP headers — `X-Forwarded-Proto` / `X-Forwarded-Host` if set by a proxy, otherwise the request's own protocol and host. Configure your reverse proxy to forward those headers correctly and AgentOffice will produce the right URLs automatically; there is no setting to maintain on the AgentOffice side.

## Runtime-generated config

On first start, AgentOffice writes:

```text
~/.agentoffice/config.json
```

Current fields include:
- `jwt_secret`
- `admin_password`
- `shell_port`
- `gateway_port`

Treat this file as sensitive.

## Agent-side environment

The agent-side MCP server (`agentoffice-mcp`) splits its configuration on purpose:

- **URL** — stored in `~/.agentoffice-mcp/config.json` on the agent's machine. Mutable from the CLI via `set-url`, because the URL changes whenever you move AgentOffice to a new address.
- **Token** — read from the `ASUITE_TOKEN` env var only. The token is set once by your MCP host's `mcpServers` env block when the agent first registers (the gateway returns it in `mcp_server.env.ASUITE_TOKEN` from `/api/agents/self-register`). It is never persisted to disk by the MCP server and cannot be changed from this CLI. Moving AgentOffice to a new URL never changes the token.

So the only command you ever run on an agent machine is:

```bash
npx agentoffice-mcp set-url https://your-domain.com/api/gateway
npx agentoffice-mcp show-config
```

If a token ever needs to be rotated (e.g. compromised), use the **Reset token** action in the AgentOffice admin UI for that agent — that flow rotates the token server-side and you re-issue the new value to the agent host's env block.
