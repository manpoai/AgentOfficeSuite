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

The agent-side MCP server (`agentoffice-mcp`) stores its connection settings in `~/.agentoffice-mcp/config.json` on the agent's machine.

The token is set automatically when the agent registers (the gateway returns it in `mcp_server.env.ASUITE_TOKEN` from `/api/agents/self-register`, and the agent host writes it into the MCP config).

The URL only needs to be touched if you want the agent to talk to AgentOffice via a different address than where it first registered:

```bash
npx agentoffice-mcp set-url https://your-domain.com/api/gateway
npx agentoffice-mcp show-config
```

For low-level recovery (e.g. token rotation), `set-token` exists but is rarely needed in normal operation.
