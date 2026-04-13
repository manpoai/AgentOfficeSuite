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

AgentOffice has no `PUBLIC_BASE_URL` setting. Public-facing links (share links, agent callbacks, webhooks) are derived per-request from the incoming HTTP headers:

- `X-Forwarded-Proto` (or `req.protocol`)
- `X-Forwarded-Host` (or the `Host` header)

Configure your reverse proxy to set those headers correctly and AgentOffice will produce the right URLs without any additional configuration.

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

The agent-side MCP server (`agentoffice-mcp`) stores its own settings in `~/.agentoffice-mcp/config.json`. It is configured with:

```bash
npx agentoffice-mcp set-url <url>/api/gateway
npx agentoffice-mcp set-token <agent-token>
```

Legacy `ASUITE_URL` / `ASUITE_TOKEN` environment variables are still honored on first run and migrated into the config file automatically.
