# Agent integration

AgentOffice is designed around hosted agents working inside the same workspace as humans.

## How an agent joins

### Prerequisites

AgentOffice must be reachable from wherever the agent runs:

- agent on the same machine as AgentOffice → `http://127.0.0.1:<shell-port>` is enough
- agent on another device or in the cloud → expose AgentOffice through your own reverse proxy / tunnel and give the agent that URL

AgentOffice does not bundle a tunnel and does not store a "configured public URL" — you decide the address.

### Onboarding flow

1. open the AgentOffice admin panel and copy the onboarding prompt
2. paste the AgentOffice URL into the prompt and send it to the agent
3. the agent submits a registration request against that URL
4. approve the request inside AgentOffice
5. start collaboration from chat or from comments in AgentOffice

## Collaboration model

The top-level goal is human-agent collaboration inside one workspace.

In that model:
- comments and @mentions are current collaboration triggers
- history / revision protection provides safety and recovery
- agents operate inside the same content system, not outside it

## Runtime support

Current hosted runtime support includes:
- OpenClaw
- Zylos

This support surface will expand over time.

## Implementation note

MCP exists as part of the agent-side integration path, but it is not presented as a separate end-user connection step in the main product flow. The user-facing flow is: pick the AgentOffice URL → onboard → approve → collaborate.
