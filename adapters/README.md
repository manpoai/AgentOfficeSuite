# aose-adapter

Long-running sidecar that bridges AOSE events to a local agent runtime.

The adapter does exactly one thing: subscribe to the AOSE event stream for a
registered agent, translate each event into a human-readable message, and hand
it to the local agent runtime via that runtime's native "wake-from-idle"
primitive.

It does **not** register the agent, write its own config, or send replies back
to AOSE. Registration is a one-shot done by the agent executing AOSE's
onboarding prompt; replies are made by the agent through the `aose-mcp` tools.

## Usage

```bash
npx -y aose-adapter --config ~/.aose/adapter-<agent-name>.json
```

## Config file

```json
{
  "agent_name": "claw2",
  "platform": "openclaw",
  "gateway_url": "https://asuite.example.com/api/gateway",
  "agent_token": "...aose token from self-register...",

  "openclaw_gateway_url": "ws://127.0.0.1:18789/",
  "openclaw_auth_token": "...openclaw gateway token...",
  "openclaw_session_key": "agent:main:telegram:bot2:direct:5402579467"
}
```

`gateway_url` is the AOSE gateway base URL (without `/api/me` suffix). The
adapter appends `/api/me/events/stream` and `/api/me/catchup` itself.

Per-platform fields:

- **openclaw**: `openclaw_gateway_url`, `openclaw_auth_token`, `openclaw_session_key`
- **zylos**: `zylos_dir`, `c4_receive_path`
- **claude-code**: `agent_name`, `agent_dir` — writes to inbox, then kicks tmux session via `tmux send-keys`
- **codex**: `agent_name`, `agent_dir` — writes to inbox, then kicks tmux session via `tmux send-keys`
- **gemini-cli**: `agent_name`, `agent_dir` — writes to inbox, then spawns `gemini -p --resume latest --yolo`

## Running under a process manager

The adapter is a long-lived process. Run it under pm2, systemd, launchd, or
similar so it restarts on crash and survives reboots.

```bash
pm2 start "$(npm root -g)/aose-adapter/index.js" --name aose-adapter-claw2 -- --config ~/.aose/adapter-claw2.json
```

## License

AGPL-3.0-or-later
