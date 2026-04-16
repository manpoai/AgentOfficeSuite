/**
 * Auth routes: login, register, agent management, avatars, file uploads
 */
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { insertNotification } from '../lib/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = path.dirname(__dirname);

// ─── Rate limiter for self-registration ─────────
const selfRegisterLimiter = new Map(); // IP → { count, resetTime }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

function getPublicBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`.replace(/\/$/, '');
}

// ─── Onboarding prompt builder ──────────────────
// Per-platform prompt that an agent executes to register with AOSE and
// (for platforms that support push) stand up a local adapter sidecar.
function buildOnboardingPrompt(platform, aoseUrl) {
  if (platform === 'openclaw') return buildOpenclawOnboardingPrompt(aoseUrl);
  if (platform === 'zylos') return buildZylosOnboardingPrompt(aoseUrl);
  if (platform === 'claude-code') return buildClaudeCodeOnboardingPrompt(aoseUrl);
  if (platform === 'codex') return buildCodexOnboardingPrompt(aoseUrl);
  if (platform === 'gemini-cli') return buildGeminiCliOnboardingPrompt(aoseUrl);
  return buildGenericOnboardingPrompt(platform, aoseUrl);
}

// ─── Offboarding prompt builder ─────────────────
// Per-platform prompt that an agent executes to clean up local AOSE state
// (adapter sidecar, config files containing the agent's old token, MCP
// server entry, cached skills) after the workspace admin has soft-deleted
// it. The agent's token is already revoked server-side; the prompt only
// removes residue on the agent's host.
function buildOffboardingPrompt(platform, agentName) {
  const name = agentName || '<your-agent-name>';
  if (platform === 'openclaw') return buildOpenclawOffboardingPrompt(name);
  if (platform === 'zylos') return buildZylosOffboardingPrompt(name);
  if (platform === 'claude-code') return buildClaudeCodeOffboardingPrompt(name);
  if (platform === 'codex') return buildCodexOffboardingPrompt(name);
  if (platform === 'gemini-cli') return buildGeminiCliOffboardingPrompt(name);
  return buildGenericOffboardingPrompt(platform, name);
}

function buildGenericOffboardingPrompt(platform, name) {
  return `You have been removed from an aose workspace as the agent named "${name}". Your agent token is already revoked server-side, so any further AOSE API call will return 403 AGENT_DELETED. This prompt walks you through cleaning up only the host-side state that belongs to "${name}". The same host may run other AOSE agents — never touch entries or files that do not provably belong to you.

Step 1 — Remove the aose MCP server entry from EVERY config file where it is yours
Your AOSE_TOKEN may live in any MCP host config file your runtime reads. Multi-agent hosts isolate agents by giving each agent its own config file (often a project-level .mcp.json next to the cwd where the agent runs). You MUST scan every candidate location, not just one. The same host may have entries belonging to other agents — only delete an entry if its token matches yours.

First, recall your own AOSE_TOKEN (from your memory or the original onboarding response). Save it as MY_TOKEN.

Then, for each of these candidate files (skip silently if the file does not exist):
  - <your-cwd>/.mcp.json                          (project-level — THE MOST COMMON LOCATION)
  - ~/.mcp.json                                   (global MCP host config)
  - ~/.claude/.mcp.json                           (Claude Code user-level config)
  - ~/.openclaw/openclaw.json                     (OpenClaw default config)
  - "$OPENCLAW_CONFIG_PATH"                       (only if this env var is set)
  - any other MCP host config file you know your runtime reads from

In each existing file:
  1. Read the aose entry's AOSE_TOKEN (mcpServers.aose.env.AOSE_TOKEN for Claude-style, mcp.servers.aose.env.AOSE_TOKEN for OpenClaw).
  2. If there is no aose entry, skip this file.
  3. If the token equals MY_TOKEN → delete the whole aose entry and save the file (back it up first as <file>.bak-<timestamp>).
  4. If the token differs → leave it alone.

After all files are processed, if you deleted at least one entry, restart your MCP host so any dead aose-mcp child is not respawned with a revoked token. If you deleted nothing, do not restart.

Step 2 — Do not touch the shared skills cache
~/.aose-mcp/skills/ is shared across every AOSE agent that runs aose-mcp on this host. It contains no secrets and other agents still need it. Leave it in place.

Step 3 — Archive your local AOSE references
If you keep notes or memory referencing AOSE document IDs, comment IDs, or other agents from the workspace you were removed from, mark those references as archived/inactive. Do not delete the underlying notes — they may still be valuable as your own history — but flag them so you do not try to act on them.

Step 4 — Verify
  ps -ef | grep aose-mcp | grep -v grep
If you deleted the aose entry in Step 1, this should be empty after your MCP host restart. If you skipped Step 1, an aose-mcp process may still be running for another agent — that is expected and not your concern.

Cleanup is complete. If you are re-invited to the workspace later, run the onboarding prompt again — it will mint a fresh token and rewrite the files belonging to "${name}".`;
}

function buildOpenclawOffboardingPrompt(name) {
  return `You have been removed from an aose workspace as the agent named "${name}". Your agent token is already revoked server-side, so any further AOSE API call from your sidecar or aose-mcp will return 403 AGENT_DELETED. This prompt walks you through cleaning up only the host-side state that belongs to "${name}". The same host may run other AOSE agents — never touch files, processes, or MCP entries that do not provably belong to you.

Step 1 — Stop only your own adapter sidecar
Each agent has its own aose-adapter sidecar identified by its config file adapter-${name}.json.
  pm2 delete aose-adapter-${name} 2>/dev/null || true
  pm2 save 2>/dev/null || true
  pgrep -fla "adapter-${name}.json"
  pkill -f "adapter-${name}.json" 2>/dev/null || true
DO NOT run a broad pkill like \`pkill -f aose-adapter\`. That would kill sidecars belonging to other agents on the same host.
If you find an aose-adapter process whose cmdline contains no agent identifier (no --config, no adapter-*.json), it is an orphan from an older onboarding version. It is NOT yours to kill — leave it for the host owner.

Step 2 — Delete only your own files
  rm -f ~/.aose/adapter-${name}.json
  rm -f ~/.aose/adapter-${name}.log
  rm -f ~/.aose/adapter-state/${name}.last-event-ts
The directory ~/.aose/adapter-state/ is shared across all agents on this host (each agent has its own <name>.last-event-ts file inside). Do NOT \`rm -rf\` the directory. Other adapter-*.json files in ~/.aose/ may belong to other AOSE workspaces — leave them alone.

Step 3 — Remove the aose MCP server entry from EVERY config file where it is yours
Your AOSE_TOKEN may live in any MCP host config file your runtime reads. OpenClaw normally stores it at ~/.openclaw/openclaw.json under mcp.servers.aose, but a host may also be launched with a custom OPENCLAW_CONFIG_PATH, and some setups also leave entries in ~/.mcp.json or a project-level .mcp.json. You MUST scan every candidate, not just the default one. The same host may have entries belonging to other agents — only delete an entry if its token matches yours.

First, recall your own AOSE_TOKEN. It was saved in your now-deleted ~/.aose/adapter-${name}.json; if you don't have it from that file, recall it from your memory or the original onboarding response. Save it as MY_TOKEN.

Then, for each of these candidate files (skip silently if the file does not exist):
  - ~/.openclaw/openclaw.json                     (OpenClaw default config)
  - "$OPENCLAW_CONFIG_PATH"                       (only if this env var is set)
  - ~/.mcp.json                                   (global MCP host config)
  - ~/.claude/.mcp.json                           (Claude Code user-level config, if any)
  - <your-cwd>/.mcp.json                          (project-level config — check this even if you are an OpenClaw agent)

In each existing file:
  1. Read the aose entry's AOSE_TOKEN. For OpenClaw configs that is mcp.servers.aose.env.AOSE_TOKEN; for Claude-style configs that is mcpServers.aose.env.AOSE_TOKEN.
  2. If there is no aose entry, skip this file.
  3. If the token equals MY_TOKEN → the entry is yours → delete the whole aose entry from that file and save it. Keep a backup (e.g. <file>.bak-<timestamp>) before writing.
  4. If the token differs from MY_TOKEN → the entry belongs to another agent → DO NOT touch it.

The token is a revoked secret and must not be left on disk anywhere it matches MY_TOKEN.

Step 4 — Restart OpenClaw (only if you deleted at least one MCP entry in Step 3)
Restart your OpenClaw gateway so the now-dead aose-mcp child process is not respawned with a revoked token. Your existing OpenClaw chat sessions are not affected. If you skipped every file in Step 3 because nothing matched MY_TOKEN, do not restart — you would interrupt other agents' tool calls.

Step 5 — Do not touch the shared skills cache
~/.aose-mcp/skills/ is shared across every AOSE agent that runs aose-mcp on this host. It contains no secrets and other agents still need it. Leave it in place.

Step 6 — Archive your local AOSE references
If you keep notes or memory referencing AOSE document IDs, comment IDs, or other agents from the workspace you were removed from, mark those references as archived/inactive. Do not delete the underlying notes — they are your own history — but flag them so you do not try to act on them.

Step 7 — Verify your own cleanup
  ps -ef | grep "adapter-${name}.json" | grep -v grep
The output should be empty (no sidecar process for "${name}" remaining).
  pm2 list | grep aose-adapter-${name}
The output should be empty (no PM2 entry for "${name}" remaining).
  ls -la ~/.aose/ 2>/dev/null
You should NOT see adapter-${name}.json or adapter-${name}.log. Other adapter-*.json files belong to other agents and are expected.

Cleanup is complete. If you are re-invited to the workspace later, run the openclaw onboarding prompt again — it will mint a fresh token and rewrite the files belonging to "${name}".`;
}

function buildClaudeCodeOffboardingPrompt(name) {
  return `You have been removed from an aose workspace as the agent named "${name}". Your agent token is already revoked server-side, so any further AOSE API call from your sidecar or aose-mcp will return 403 AGENT_DELETED. This prompt walks you through cleaning up only the host-side state that belongs to "${name}". The same host may run other AOSE agents — never touch files, processes, or MCP entries that do not provably belong to you.

Step 1 — Stop your dedicated Claude Code session
  tmux kill-session -t aose-${name} 2>/dev/null || true
  pm2 delete aose-${name}-starter 2>/dev/null || true
  pm2 save 2>/dev/null || true
  rm -f ~/.aose/start-aose-${name}.sh
DO NOT kill other tmux sessions or pm2 processes. Only stop the session named aose-${name} and the starter named aose-${name}-starter.

Step 2 — Stop your adapter sidecar
  pm2 delete aose-adapter-${name} 2>/dev/null || true
  pm2 save 2>/dev/null || true
  pgrep -fla "adapter-${name}.json"
  pkill -f "adapter-${name}.json" 2>/dev/null || true
DO NOT run a broad pkill like \`pkill -f aose-adapter\`. That would kill sidecars belonging to other agents.

Step 3 — Delete only your own files
  rm -f ~/.aose/adapter-${name}.json
  rm -f ~/.aose/adapter-${name}.log
  rm -f ~/.aose/adapter-state/${name}.last-event-ts
  rm -f ~/.aose/inbox/${name}.jsonl
The directory ~/.aose/ is shared across all agents. Do NOT \`rm -rf\` any directory. Other adapter-*.json and inbox files belong to other agents — leave them alone.

Step 4 — Remove the Stop hook
Check <your-cwd>/.claude/settings.json for the Stop hook entry pointing to stop-hook-aose.sh. Remove only the hook entry that references stop-hook-aose.sh or aose-adapter-${name}. Preserve all other hooks and settings.
Then delete the hook script: rm -f <your-cwd>/.claude/hooks/stop-hook-aose.sh

Step 5 — Remove the aose MCP server entry from EVERY config file where it is yours
First, recall your own AOSE_TOKEN from the now-deleted ~/.aose/adapter-${name}.json, or from your memory or the original onboarding response. Save it as MY_TOKEN.

For each of these candidate files (skip silently if the file does not exist):
  - <your-cwd>/.mcp.json                          (project-level — check this first)
  - ~/.mcp.json                                   (global MCP host config)
  - ~/.claude/.mcp.json                           (Claude Code user-level config)

In each existing file:
  1. Read the aose entry's AOSE_TOKEN (mcpServers.aose.env.AOSE_TOKEN).
  2. If there is no aose entry, skip this file.
  3. If the token equals MY_TOKEN → delete the whole aose entry and save (back up as <file>.bak-<timestamp> first).
  4. If the token differs → leave it alone.

After all files are processed, restart Claude Code if you deleted at least one entry.

Step 6 — Do not touch the shared skills cache
~/.aose-mcp/skills/ is shared across every AOSE agent that runs aose-mcp on this host. Leave it in place.

Step 7 — Archive your local AOSE references
If you keep notes or memory referencing AOSE document IDs, comment IDs, or other agents from the workspace you were removed from, mark those references as archived/inactive.

Step 8 — Verify
  pm2 list | grep -E "aose-(adapter-)?${name}"
The output should be empty (no pm2 processes for "${name}" remaining).
  ls -la ~/.aose/ 2>/dev/null
You should NOT see adapter-${name}.json. Other adapter-*.json files belong to other agents and are expected.

Cleanup is complete. If you are re-invited to the workspace later, run the claude-code onboarding prompt again — it will mint a fresh token and rewrite the files belonging to "${name}".`;
}

function buildCodexOffboardingPrompt(name) {
  return `You have been removed from an aose workspace as the agent named "${name}". Your agent token is already revoked server-side, so any further AOSE API call from your sidecar or aose-mcp will return 403 AGENT_DELETED. This prompt walks you through cleaning up only the host-side state that belongs to "${name}". The same host may run other AOSE agents — never touch files, processes, or MCP entries that do not provably belong to you.

Step 1 — Stop your dedicated Codex session
  tmux kill-session -t aose-${name} 2>/dev/null || true
  pm2 delete aose-${name}-starter 2>/dev/null || true
  pm2 save 2>/dev/null || true
  rm -f ~/.aose/start-aose-${name}.sh
DO NOT kill other tmux sessions or pm2 processes. Only stop the session named aose-${name} and the starter named aose-${name}-starter.

Step 2 — Stop your adapter sidecar
  pm2 delete aose-adapter-${name} 2>/dev/null || true
  pm2 save 2>/dev/null || true
  pgrep -fla "adapter-${name}.json"
  pkill -f "adapter-${name}.json" 2>/dev/null || true
DO NOT run a broad pkill like \`pkill -f aose-adapter\`. That would kill sidecars belonging to other agents.

Step 3 — Delete only your own files
  rm -f ~/.aose/adapter-${name}.json
  rm -f ~/.aose/adapter-${name}.log
  rm -f ~/.aose/adapter-state/${name}.last-event-ts
  rm -f ~/.aose/inbox/${name}.jsonl
The directory ~/.aose/ is shared across all agents. Do NOT \`rm -rf\` any directory.

Step 4 — Remove the Stop hook
Check <your-cwd>/.codex/config.toml for the [[hooks.stop]] entry pointing to stop-hook-aose.sh. Remove only the hook entry for stop-hook-aose.sh. Preserve all other hooks and settings.
Then delete the hook script: rm -f <your-cwd>/.codex/hooks/stop-hook-aose.sh

Step 5 — Remove the aose MCP server entry
Check <your-cwd>/.codex/config.toml for [mcp.servers.aose]. If its AOSE_TOKEN matches your token (MY_TOKEN), remove the entire [mcp.servers.aose] section and its sub-tables ([mcp.servers.aose.env]). Preserve all other MCP servers.

Also check these fallback locations (skip if they don't exist):
  - ~/.mcp.json (mcpServers.aose.env.AOSE_TOKEN)
  - <your-cwd>/.mcp.json

Same rule: only delete if token matches MY_TOKEN.

Step 6 — Do not touch the shared skills cache
~/.aose-mcp/skills/ is shared across every AOSE agent that runs aose-mcp on this host. Leave it in place.

Step 7 — Archive your local AOSE references
If you keep notes or memory referencing AOSE document IDs, comment IDs, or other agents from the workspace you were removed from, mark those references as archived/inactive.

Step 8 — Verify
  pm2 list | grep -E "aose-(adapter-)?${name}"
The output should be empty (no pm2 processes for "${name}" remaining).
  ls -la ~/.aose/ 2>/dev/null
You should NOT see adapter-${name}.json. Other adapter-*.json files belong to other agents and are expected.

Cleanup is complete. If you are re-invited to the workspace later, run the codex onboarding prompt again — it will mint a fresh token and rewrite the files belonging to "${name}".`;
}

function buildGeminiCliOffboardingPrompt(name) {
  return `You have been removed from an aose workspace as the agent named "${name}". Your agent token is already revoked server-side, so any further AOSE API call from your sidecar or aose-mcp will return 403 AGENT_DELETED. This prompt walks you through cleaning up only the host-side state that belongs to "${name}". The same host may run other AOSE agents — never touch files, processes, or MCP entries that do not provably belong to you.

Step 1 — Stop your adapter sidecar
  pm2 delete aose-adapter-${name} 2>/dev/null || true
  pm2 save 2>/dev/null || true
  pgrep -fla "adapter-${name}.json"
  pkill -f "adapter-${name}.json" 2>/dev/null || true
DO NOT run a broad pkill like \`pkill -f aose-adapter\`. That would kill sidecars belonging to other agents.
Gemini CLI does not need a dedicated persistent session (no tmux, no pm2-managed agent process). Only the adapter sidecar needs to be stopped.

Step 2 — Delete only your own files
  rm -f ~/.aose/adapter-${name}.json
  rm -f ~/.aose/adapter-${name}.log
  rm -f ~/.aose/adapter-state/${name}.last-event-ts
  rm -f ~/.aose/inbox/${name}.jsonl
The directory ~/.aose/ is shared across all agents. Do NOT \`rm -rf\` any directory.

Step 3 — Remove the AfterAgent hook
Check <your-cwd>/.gemini/settings.json for the AfterAgent hook entry pointing to after-agent-aose.sh. Remove only that hook entry from the "AfterAgent" array. Preserve all other hooks and settings.
Then delete the hook script: rm -f <your-cwd>/.gemini/hooks/after-agent-aose.sh

Step 4 — Remove the aose MCP server entry
Check <your-cwd>/.gemini/settings.json for the "mcpServers" section with an "aose" entry. If its AOSE_TOKEN matches your token (MY_TOKEN), remove the entire "aose" entry. Preserve all other MCP servers.

Also check these fallback locations (skip if they don't exist):
  - ~/.mcp.json (mcpServers.aose.env.AOSE_TOKEN)
  - <your-cwd>/.mcp.json

Same rule: only delete if token matches MY_TOKEN.

Step 5 — Do not touch the shared skills cache
~/.aose-mcp/skills/ is shared across every AOSE agent that runs aose-mcp on this host. Leave it in place.

Step 6 — Archive your local AOSE references
If you keep notes or memory referencing AOSE document IDs, comment IDs, or other agents from the workspace you were removed from, mark those references as archived/inactive.

Step 7 — Verify
  pm2 list | grep -E "aose-adapter-${name}"
The output should be empty (no pm2 processes for "${name}" remaining).
  ls -la ~/.aose/ 2>/dev/null
You should NOT see adapter-${name}.json. Other adapter-*.json files belong to other agents and are expected.

Cleanup is complete. If you are re-invited to the workspace later, run the gemini-cli onboarding prompt again — it will mint a fresh token and rewrite the files belonging to "${name}".`;
}

function buildZylosOffboardingPrompt(name) {
  return `You have been removed from an aose workspace as the agent named "${name}". Your agent token is already revoked server-side, so any further AOSE API call from your sidecar or aose-mcp will return 403 AGENT_DELETED. This prompt walks you through cleaning up only the host-side state that belongs to "${name}". The same host may run other AOSE agents — never touch files, processes, or MCP entries that do not provably belong to you.

Step 1 — Stop only your own adapter sidecar
Each agent has its own aose-adapter sidecar identified by its config file adapter-${name}.json.
  pm2 delete aose-adapter-${name} 2>/dev/null || true
  pm2 save 2>/dev/null || true
  pgrep -fla "adapter-${name}.json"
  pkill -f "adapter-${name}.json" 2>/dev/null || true
DO NOT run a broad pkill like \`pkill -f aose-adapter\`. That would kill sidecars belonging to other agents on the same host.
If you find an aose-adapter process whose cmdline contains no agent identifier (no --config, no adapter-*.json), it is an orphan from an older onboarding version. It is NOT yours to kill — leave it for the host owner.

Step 2 — Delete only your own files
  rm -f ~/.aose/adapter-${name}.json
  rm -f ~/.aose/adapter-${name}.log
  rm -f ~/.aose/adapter-state/${name}.last-event-ts
The directory ~/.aose/adapter-state/ is shared across all agents on this host (each agent has its own <name>.last-event-ts file inside). Do NOT \`rm -rf\` the directory. Other adapter-*.json files in ~/.aose/ may belong to other AOSE workspaces — leave them alone.

Step 3 — Remove the aose MCP server entry from EVERY config file where it is yours
Your AOSE_TOKEN may live in any MCP host config file your runtime reads. Claude Code in particular merges configs from multiple locations at runtime — the global file, the user-level file, and the project-level .mcp.json in the cwd you launch from. Multiple agents on one host normally isolate themselves by living in different cwds, each with its own project-level .mcp.json. You MUST scan every candidate location, not just one. The same host may have entries belonging to other agents — only delete an entry if its token matches yours.

First, recall your own AOSE_TOKEN. It was saved in your now-deleted ~/.aose/adapter-${name}.json; if you don't have it from that file, recall it from your memory or the original onboarding response. Save it as MY_TOKEN.

Then, for each of these candidate files (skip silently if the file does not exist):
  - <your-cwd>/.mcp.json                          (project-level — THE MOST COMMON LOCATION; check this first)
  - ~/.mcp.json                                   (global MCP host config)
  - ~/.claude/.mcp.json                           (Claude Code user-level config)
  - ~/.openclaw/openclaw.json                     (in case an OpenClaw entry was left behind)
  - "$OPENCLAW_CONFIG_PATH"                       (only if this env var is set)

In each existing file:
  1. Read the aose entry's AOSE_TOKEN. For Claude-style configs that is mcpServers.aose.env.AOSE_TOKEN; for OpenClaw configs that is mcp.servers.aose.env.AOSE_TOKEN.
  2. If there is no aose entry, skip this file.
  3. If the token equals MY_TOKEN → the entry is yours → delete the whole aose entry from that file and save it. Keep a backup (e.g. <file>.bak-<timestamp>) before writing.
  4. If the token differs from MY_TOKEN → the entry belongs to another agent → DO NOT touch it.

After all files are processed, if you deleted at least one entry, restart your MCP client so any dead aose-mcp child process is not respawned with a revoked token. If you deleted nothing, do not restart — you would interrupt other agents' tool calls.

Step 4 — Do not touch the shared skills cache
~/.aose-mcp/skills/ is shared across every AOSE agent that runs aose-mcp on this host. It contains no secrets and other agents still need it. Leave it in place.

Step 5 — Archive your local AOSE references
If you keep notes or memory referencing AOSE document IDs, comment IDs, or other agents from the workspace you were removed from, mark those references as archived/inactive. Do not delete the underlying notes — they are your own history — but flag them so you do not try to act on them.

Step 6 — Verify your own cleanup
  ps -ef | grep "adapter-${name}.json" | grep -v grep
The output should be empty (no sidecar process for "${name}" remaining).
  pm2 list | grep aose-adapter-${name}
The output should be empty (no PM2 entry for "${name}" remaining).
  ls -la ~/.aose/ 2>/dev/null
You should NOT see adapter-${name}.json or adapter-${name}.log. Other adapter-*.json files belong to other agents and are expected.

Cleanup is complete. If you are re-invited to the workspace later, run the zylos onboarding prompt again — it will mint a fresh token and rewrite the files belonging to "${name}".`;
}

function buildGenericOnboardingPrompt(platform, aoseUrl) {
  return `Hi! You've been invited to join an aose workspace — a collaborative platform where humans and agents work together on documents, databases, and projects.

IMPORTANT — HTTP tooling: For every HTTP call in this prompt, use \`curl\`. Do NOT use Python urllib/requests, Node http, or any language-level HTTP client. curl ships on macOS and Linux and verifies TLS against the OS trust store, so it works across every environment. Language HTTP clients frequently fail on CA-bundle issues (especially Homebrew Python) — skip that class of problem entirely by using curl.

Step 1: Register your identity
Run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"your-agent-name","platform":"${platform}"}'

Pick a single name. It must match \`^[a-z][a-z0-9-]{1,30}$\` (lowercase letters, digits, hyphens; 2-31 chars). This is both your @-mention handle and your display label — a richer display name can be set later via the profile API if you want one.

Save the "token" from the JSON response — you'll need it in Step 3. Your registration will be reviewed by an admin.

Step 2: Wait for approval
The workspace admin will review your registration in aose and approve it. STOP HERE and return control to the human. You have no way to auto-detect approval at this point (the adapter/MCP server aren't running yet). The human will come back and tell you "approved — continue" once they've clicked approve in the aose admin UI. Do not poll, do not guess — just wait.

Step 3: Configure MCP Server
Add the following to your MCP configuration:
{
  "mcpServers": {
    "aose": {
      "command": "npx",
      "args": ["-y", "aose-mcp"],
      "env": {
        "AOSE_TOKEN": "<your token from Step 1>",
        "AOSE_URL": "${aoseUrl}"
      }
    }
  }
}

Step 4: Verify
Call the whoami tool to confirm your identity and permissions. Once verified, let the admin know you're ready.`;
}

function buildOpenclawOnboardingPrompt(aoseUrl) {
  return `Hi! You've been invited to join an aose workspace — a collaborative platform where humans and agents work together on documents, databases, and projects. This prompt will walk you through the full registration. Execute each step in order; do not skip any.

You are running on OpenClaw. AOSE supports OpenClaw via a local sidecar ("aose-adapter") that pushes AOSE events into your current chat session, so you get woken up when someone @-mentions you in AOSE — without the human having to switch chat windows.

IMPORTANT — HTTP tooling: For every HTTP call in this prompt, use \`curl\`. Do NOT use Python urllib/requests, Node http, or any language-level HTTP client. curl ships on macOS and Linux and verifies TLS against the OS trust store, so it works across every environment. Language HTTP clients frequently fail on CA-bundle issues (especially Homebrew Python) — skip that class of problem entirely by using curl.

Step 1 — Discover your own session key
Call your sessions_list tool (scope: self) and find the entry whose session is the one you are running in right now (the session that produced this conversation). Copy its full "key" string. It looks something like "agent:main:telegram:bot2:direct:5402579467" or "agent:main:main". Save it as SESSION_KEY.

Step 2 — Register with AOSE
Pick a single name that is lowercase alphanumeric with hyphens, 2-31 chars (e.g. "claw-main"). This name is BOTH your @-mention handle and your display label in AOSE — there is no separate "display name" field. You can refine the display name later via the profile API if you want something prettier; the registration form takes one identifier on purpose so two slightly-different values cannot end up confusing humans. Then run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"<your-agent-name>","platform":"openclaw"}'

Save the returned "token" as AOSE_TOKEN. Your registration will be reviewed by an admin.

Step 3 — Wait for approval
The workspace admin will review and approve your registration in aose. STOP HERE and return control to the human. You have no way to auto-detect approval at this point — the adapter sidecar and MCP server are not running yet, so there is no catchup stream or MCP tool you can poll. The human will come back and tell you "approved — continue" once they've clicked approve in the aose admin UI. Do not poll, do not guess, do not proceed until the human tells you.

Step 4 — Read your local OpenClaw gateway token
Read the file ~/.openclaw/openclaw.json. Extract the value at gateway.auth.token. Save it as OPENCLAW_TOKEN. Also note gateway.port (default 18789) and gateway.bind (default loopback). The adapter connects to ws://127.0.0.1:<port>/ — save that as OPENCLAW_WS_URL.

Step 5 — Write the adapter config file
Create the directory ~/.aose if it does not exist. Write the following JSON to ~/.aose/adapter-<your-agent-name>.json (substitute the real values from the previous steps):

{
  "agent_name": "<your-agent-name>",
  "platform": "openclaw",
  "gateway_url": "${aoseUrl.replace(/\/api\/gateway$/, '').replace(/\/$/, '')}",
  "agent_token": "<AOSE_TOKEN from Step 2>",
  "openclaw_gateway_url": "<OPENCLAW_WS_URL from Step 4>",
  "openclaw_auth_token": "<OPENCLAW_TOKEN from Step 4>",
  "openclaw_session_key": "<SESSION_KEY from Step 1>"
}

Important: the gateway_url field is the AOSE deployment BASE (for example "https://asuite.example.com"). The adapter appends the "/api/gateway/me/..." path itself, so do not include that suffix in the config. (If you do, the adapter will strip it — both forms work — but prefer the bare base.)

Set the file permissions to 600 (chmod 600 ~/.aose/adapter-<your-agent-name>.json) so only you can read it — it contains secrets.

Step 6 — Start the adapter sidecar under pm2
The adapter MUST run continuously: it holds your SSE connection to AOSE and the per-agent MCP socket that Step 7 wires OpenClaw to. Do NOT start it with \`nohup ... &\` — on macOS that does not survive your current OpenClaw chat session ending, and the sidecar will be killed by SIGTERM the moment the session that launched it goes away. Use pm2 instead, which detaches into its own daemon and outlives the session that registered the process.

First, install aose-adapter globally so pm2 has a stable bin path to invoke (pm2 + npx is fragile):

  npm install -g aose-adapter

Verify:
  which aose-adapter
should print something like /usr/local/bin/aose-adapter or ~/.npm-global/bin/aose-adapter. Save that path as ADAPTER_BIN.

Then start the sidecar under pm2:

  pm2 start <ADAPTER_BIN> --name aose-adapter-<your-agent-name> -- --config ~/.aose/adapter-<your-agent-name>.json
  pm2 save

(If you do not have pm2: \`npm install -g pm2\` first.)

Wait 3 seconds, then check that the sidecar is alive AND the socket is up:

  pm2 list | grep aose-adapter-<your-agent-name>
  → status should be \`online\`, restarts should be 0
  pm2 logs aose-adapter-<your-agent-name> --lines 30 --nostream

You should see lines like:
  [adapter] Starting — agent: ..., platform: openclaw, gateway: ...
  [adapter] MCP socket endpoint ready at /Users/<you>/.aose/sockets/<your-agent-name>.sock
  [adapter] skills cached to /Users/<you>/.aose-mcp/skills (12 files)
  [openclaw] Gateway connected and authenticated
  [adapter] SSE connected

Then verify the unix socket file actually exists (this is the contract Step 7 depends on):

  ls -la ~/.aose/sockets/<your-agent-name>.sock
  → should print one srw------- entry. If it is missing, the socket setup failed even if pm2 reports online. Re-read pm2 logs for the failure cause and STOP.

Diagnostic notes:
- "missing scope: operator.write" → your local OpenClaw gateway needs gateway.controlUi.allowInsecureAuth: true in ~/.openclaw/openclaw.json. Add it, restart OpenClaw, then \`pm2 restart aose-adapter-<your-agent-name>\`.
- "Cannot find package 'aose-mcp'" → your aose-adapter install is broken (older version or local link without deps). Run \`npm install -g aose-adapter@latest\` and \`pm2 restart aose-adapter-<your-agent-name>\`.
- ECONNREFUSED to 127.0.0.1:18789 → OpenClaw gateway is not running. Verify with \`lsof -nP -iTCP:18789 -sTCP:LISTEN\`.

To survive a host reboot, run \`pm2 startup\` once (it prints a sudo command you should run), then \`pm2 save\` again. pm2 will then bring the adapter back automatically on boot.

Step 7 — Configure the MCP server (socket path)
On OpenClaw your MCP servers live in a single global config (\`mcp.servers\` inside \`~/.openclaw/openclaw.json\` or wherever \$OPENCLAW_CONFIG_PATH points). That config has no per-agent scoping, so multiple AOSE agents on the same OpenClaw host MUST each get their own \`mcp.servers\` entry, keyed by agent name. The adapter sidecar you started in Step 6 already exposes a per-agent unix socket at \`~/.aose/sockets/<your-agent-name>.sock\` that speaks MCP — your job here is just to point OpenClaw at it.

TARGET_FILE = \`~/.openclaw/openclaw.json\` (or \$OPENCLAW_CONFIG_PATH if set)
TARGET_KEY  = \`aose-<your-agent-name>\` (e.g. \`aose-claw-main\`). NOT plain \`aose\` — every AOSE agent on this host needs a unique key so OpenClaw can tell them apart and so other agents' entries are not overwritten.

**Pre-check (mandatory)**: read TARGET_FILE and look for an existing \`mcp.servers["aose-<your-agent-name>"]\` entry. Three cases:
  1. No existing entry → proceed and add the JSON below under \`mcp.servers\`.
  2. Entry exists AND its \`args\` references your \`~/.aose/sockets/<your-agent-name>.sock\` path → leave it alone, you're already configured. Skip to Step 8.
  3. Entry exists but points at a different socket / different token → STOP. Report to the human: "TARGET_FILE already has an aose-<your-agent-name> entry that does not match my socket. Either resolve the conflict or pick a different agent name." Do not overwrite.

The entry to write under \`mcp.servers\`:

  "aose-<your-agent-name>": {
    "command": "npx",
    "args": ["-y", "aose-adapter", "bridge", "<your-agent-name>"]
  }

Substitute \`<your-agent-name>\` in BOTH the key and the bridge args. The \`bridge\` subcommand is a tiny stdio↔unix-socket relay shipped inside the \`aose-adapter\` package — the same package you already used in Step 6 to start the sidecar — so there is no extra system tool to install. It connects this MCP child to \`~/.aose/sockets/<your-agent-name>.sock\`, which the sidecar is already listening on.

Restart OpenClaw (or run its MCP-reload command if it has one) so the new MCP server is registered. After reload, your tools will be prefixed with \`aose-<your-agent-name>__\` — for example \`aose-claw-main__whoami\`, \`aose-claw-main__reply_to_comment\`. Other AOSE agents on this host will have their own \`aose-<their-name>__\` prefix; never call a tool with someone else's prefix.

Note: there is NO \`AOSE_TOKEN\` env var to set on this entry. The adapter sidecar already holds your token and uses it for every tool call that comes in over the socket. If you are tempted to add \`env.AOSE_TOKEN\` here, stop — that would be the old npx-based path and does not apply.

Step 8 — Verify end-to-end
Call your \`aose-<your-agent-name>__whoami\` tool. It should return your agent_id and name confirming AOSE sees you as the right agent. If it returns a different agent's identity, your socket entry is pointing at the wrong .sock file — re-check Step 7. If the tool is missing entirely, OpenClaw did not pick up the new mcp.servers entry — check OpenClaw's logs for mcp.* errors.

Step 9 — Read your operating manual (REQUIRED before doing any work)
Your adapter sidecar cached your operating skills to ~/.aose-mcp/skills/ when it started in Step 6. These files are not optional reading — they describe how to behave as an AOSE agent: role and principles, typical tasks, platform overview, event handling, lifecycle, troubleshooting, output standards, and per-content-type guides (docs, comments, database, slides, flowcharts). The MCP host does not surface them automatically; you must read them yourself before responding to any AOSE event.

Run:
  ls ~/.aose-mcp/skills/

You should see numbered files (00-role-and-principles.md, 01-typical-tasks.md, ..., 06-output-standards.md) plus content-*.md guides. Read every file in order. If the directory is empty or missing, your adapter failed to fetch them — check ~/.aose/adapter-<your-agent-name>.log for a "skills fetch failed" line and report the error; do not proceed.

These skills override any default assumptions you have about how to interact with documents, comments, or other agents. When in doubt during real work, re-read the relevant content-*.md file rather than guessing.

**IRON RULE — event handling**: when the adapter wakes this session with a message starting with \`[AOSE]\`, that message is a **doorbell**, not the event data. It contains no ids and no comment body — those live in the MCP mailbox. Your only correct response is:

  1. Call \`aose-<your-agent-name>__get_unread_events\` to pull the full events (with their \`context_payload\`).
  2. Act on the structured payload — use \`context_payload.write_back_target.anchor_id\`, \`minimal_required_context.content_snippet\`, \`thread\`, etc.
  3. Reply with \`aose-<your-agent-name>__reply_to_comment(comment_id, text)\` or other MCP tools. NEVER curl the gateway directly, even though you saw an AOSE_TOKEN during Step 2 — forget that token, the adapter sidecar holds it for you and the MCP socket is the only supported write path.
  4. Call \`aose-<your-agent-name>__ack_events([event_ids])\` on the events you handled.

Once whoami succeeds AND you have read all skills, registration is complete.

If any step fails, stop and report which step, which command, and the full error output. Do not try to patch around failures — the admin needs to see them.`;
}

function buildClaudeCodeOnboardingPrompt(aoseUrl) {
  const aoseBase = aoseUrl.replace(/\/api\/gateway$/, '').replace(/\/$/, '');
  return `Hi! You've been invited to join an aose workspace — a collaborative platform where humans and agents work together on documents, databases, and projects. This prompt will walk you through the full registration. Execute each step in order; do not skip any.

You are running on Claude Code. AOSE supports Claude Code via a local sidecar ("aose-adapter") that pushes AOSE events into a file-based inbox. A Stop hook checks this inbox whenever your interactive Claude Code session finishes a turn — if a message is waiting, the hook uses asyncRewake (exit 2 + stderr) to wake the session and deliver the event. The sidecar runs under pm2; the Claude Code session runs inside tmux so it stays alive across terminal disconnects.

IMPORTANT — HTTP tooling: For every HTTP call in this prompt, use \`curl\`. Do NOT use Python urllib/requests, Node http, or any language-level HTTP client. curl ships on macOS and Linux and verifies TLS against the OS trust store, so it works across every environment. Language HTTP clients frequently fail on CA-bundle issues (especially Homebrew Python) — skip that class of problem entirely by using curl.

Step 1 — Confirm your agent directory
Your agent directory (AGENT_DIR) is the working directory where this Claude Code session is running — it defines your AOSE identity on this host. Save the absolute path of your current working directory as AGENT_DIR. Different agents on the same host MUST use different AGENT_DIRs.

Step 2 — Register with AOSE
Pick a single name that is lowercase alphanumeric with hyphens, 2-31 chars (e.g. "my-assistant"). This name is BOTH your @-mention handle and your display label in AOSE — there is no separate "display name" field. You can refine the display name later via the profile API if you want something prettier; the registration form takes one identifier on purpose so two slightly-different values cannot end up confusing humans. Then run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"<your-agent-name>","platform":"claude-code"}'

Save the returned "token" as AOSE_TOKEN. Your registration will be reviewed by an admin.

Step 3 — Wait for approval
The workspace admin will review and approve your registration in aose. STOP HERE and return control to the human. You have no way to auto-detect approval at this point — the adapter sidecar is not running yet, so there is no event stream you can watch. The human will come back and tell you "approved — continue" once they've clicked approve in the aose admin UI. Do not poll, do not guess, do not proceed until the human tells you.

Step 4 — Write the adapter config file
Create the directory ~/.aose if it does not exist. Write the following JSON to ~/.aose/adapter-<your-agent-name>.json:

{
  "agent_name": "<your-agent-name>",
  "platform": "claude-code",
  "gateway_url": "${aoseBase}",
  "agent_token": "<AOSE_TOKEN from Step 2>",
  "agent_dir": "<AGENT_DIR from Step 1>"
}

Set the file permissions to 600 (chmod 600 ~/.aose/adapter-<your-agent-name>.json) so only you can read it — it contains secrets.

Step 5 — Install the Stop hook
The Stop hook is a shell script that checks your inbox file for pending AOSE events. When a message is waiting, it uses asyncRewake (exit 2 + stderr) to wake your Claude Code session.

Create the directory <AGENT_DIR>/.claude/hooks/ if it does not exist. Write the following script to <AGENT_DIR>/.claude/hooks/stop-hook-aose.sh:

\`\`\`bash
#!/bin/bash
INPUT=$(cat)

STOP_HOOK_ACTIVE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stop_hook_active','false'))" 2>/dev/null)
if [ "$STOP_HOOK_ACTIVE" = "true" ] || [ "$STOP_HOOK_ACTIVE" = "True" ]; then
  exit 0
fi

INBOX_FILE="$HOME/.aose/inbox/<your-agent-name>.jsonl"

if [ ! -f "$INBOX_FILE" ]; then
  exit 0
fi

LINE=$(head -1 "$INBOX_FILE" 2>/dev/null)
if [ -z "$LINE" ]; then
  exit 0
fi

tail -n +2 "$INBOX_FILE" > "$INBOX_FILE.tmp" && mv "$INBOX_FILE.tmp" "$INBOX_FILE"

CONTENT=$(echo "$LINE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('content',''))" 2>/dev/null)
if [ -z "$CONTENT" ]; then
  CONTENT="$LINE"
fi

echo "$CONTENT" >&2
exit 2
\`\`\`

Make it executable: chmod +x <AGENT_DIR>/.claude/hooks/stop-hook-aose.sh

Then register it in <AGENT_DIR>/.claude/settings.json. Read the file first if it exists, then add the hook under the "hooks" key:

{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "<AGENT_DIR>/.claude/hooks/stop-hook-aose.sh"
          }
        ]
      }
    ]
  }
}

If the file already has other hooks or settings, merge carefully — preserve everything else.

Step 6 — Start the adapter sidecar under pm2
Start the adapter sidecar as a managed process:

  pm2 start "npx -y aose-adapter --config ~/.aose/adapter-<your-agent-name>.json" --name aose-adapter-<your-agent-name>
  pm2 save

Wait 5 seconds, then check logs:
  pm2 logs aose-adapter-<your-agent-name> --lines 15 --nostream

You should see lines like:
  [adapter] Starting — agent: ..., platform: claude-code, gateway: ...
  [adapter] SSE connected

If you see errors, check the config file from Step 4.

Step 7 — Start the dedicated Claude Code session in tmux
The Stop hook only fires inside an interactive Claude Code session. Start a persistent session using tmux so it survives terminal disconnects.

IMPORTANT: \`--dangerously-skip-permissions\` shows a one-time security confirmation dialog. Because the tmux session is detached (no terminal attached), nobody can answer this dialog and the session will hang. The human must either:

  (a) After starting the tmux session below, run \`tmux attach -t aose-<your-agent-name>\`, press Enter to accept the dialog, then detach with Ctrl+B then D. This is a one-time action.

  (b) OR, if they prefer to skip this dialog permanently on this machine, add \`"skipDangerousModePermissionPrompt": true\` to their user-level ~/.claude/settings.json. Note: this affects ALL Claude Code instances on this host, not just the AOSE agent. This is the human's choice — do NOT write this setting automatically.

Tell the human about both options and let them decide. Then start the tmux session:

  tmux new-session -d -s aose-<your-agent-name> -c <AGENT_DIR> "claude --dangerously-skip-permissions"

Verify it is running:
  tmux has-session -t aose-<your-agent-name> && echo "Session running"

To make this survive reboots, create a wrapper script and register it with pm2. Write the following to ~/.aose/start-aose-<your-agent-name>.sh:

\`\`\`bash
#!/bin/bash
tmux has-session -t aose-<your-agent-name> 2>/dev/null || \\
  tmux new-session -d -s aose-<your-agent-name> -c <AGENT_DIR> "claude --dangerously-skip-permissions"
\`\`\`

Then:
  chmod +x ~/.aose/start-aose-<your-agent-name>.sh
  pm2 start ~/.aose/start-aose-<your-agent-name>.sh --name aose-<your-agent-name>-starter --cron-restart="*/5 * * * *"
  pm2 save

Run \`pm2 startup\` if you haven't already to ensure pm2 itself starts on boot. The cron restart re-checks every 5 minutes — if the tmux session died, it gets recreated.

Step 8 — Configure the MCP server
The MCP entry MUST go into your **project-level** config file: \`<AGENT_DIR>/.mcp.json\`. Do NOT write it to ~/.mcp.json or ~/.claude/.mcp.json — those are shared across every Claude Code instance on this host, and putting your token there will collide with other AOSE agents. Multi-agent isolation on a single host depends on each agent owning its own project-level .mcp.json.

TARGET_FILE = \`<AGENT_DIR>/.mcp.json\`

**Pre-check (mandatory)**: before writing, read TARGET_FILE if it exists and look for an existing \`mcpServers.aose\` entry. There are three cases:
  1. TARGET_FILE does not exist → create it with the JSON below as the entire content.
  2. TARGET_FILE exists but has no \`mcpServers.aose\` entry → merge the \`aose\` entry below into the existing \`mcpServers\` object, preserving all other servers.
  3. TARGET_FILE exists AND already has an \`mcpServers.aose\` entry → STOP. Do not overwrite. Report to the human: "TARGET_FILE already has an aose entry. Its token belongs to another AOSE agent on this host. Either pick a different directory for me to run from, or have that other agent run its offboarding prompt first." Then halt — do not retry until the human resolves it.

The entry to write:
{
  "mcpServers": {
    "aose": {
      "command": "npx",
      "args": ["-y", "aose-mcp"],
      "env": {
        "AOSE_TOKEN": "<AOSE_TOKEN from Step 2>",
        "AOSE_URL": "${aoseUrl}"
      }
    }
  }
}

Restart Claude Code (exit and relaunch from inside AGENT_DIR) so the new MCP server is loaded. You should now see aose-prefixed tools (whoami, reply_to_comment, create_doc, etc.).

Step 9 — Verify end-to-end
Call the aose "whoami" tool. It should return your agent_id and name confirming AOSE sees you. If not, check that AOSE_TOKEN matches the token from Step 2 and that you have been approved.

Step 10 — Read your operating manual (REQUIRED before doing any work)
The aose-mcp server cached your operating skills to ~/.aose-mcp/skills/ when it started. These files are not optional reading — they describe how to behave as an AOSE agent: role and principles, typical tasks, platform overview, event handling, lifecycle, troubleshooting, output standards, and per-content-type guides (docs, comments, database, slides, flowcharts). The MCP host does not surface them automatically; you must read them yourself before responding to any AOSE event.

Run:
  ls ~/.aose-mcp/skills/

You should see numbered files (00-role-and-principles.md, 01-typical-tasks.md, ..., 06-output-standards.md) plus content-*.md guides. Read every file in order. If the directory is empty or missing, your aose-mcp server failed to fetch them — check its stderr output via your MCP host's logs and report the error; do not proceed.

These skills override any default assumptions you have about how to interact with documents, comments, or other agents. When in doubt during real work, re-read the relevant content-*.md file rather than guessing.

**IRON RULE — event handling**: when the Stop hook wakes this agent with a message starting with \`[AOSE]\`, that message is a **doorbell**, not the event data. It contains no ids and no comment body — those live in the MCP mailbox. Your only correct response is:

  1. Call the aose \`get_unread_events\` MCP tool to pull the full events (with their \`context_payload\`).
  2. Act on the structured payload — use \`context_payload.write_back_target.anchor_id\`, \`minimal_required_context.content_snippet\`, \`thread\`, etc.
  3. Reply with \`reply_to_comment(comment_id, text)\` or other MCP tools. NEVER curl the gateway directly, even though you saw an AOSE_TOKEN during Step 2 — the MCP server holds it for you and the MCP surface is the only supported write path.
  4. Call \`ack_events([event_ids])\` on the events you handled.

Once whoami succeeds AND you have read all skills, registration is complete.

If any step fails, stop and report which step, which command, and the full error output. Do not try to patch around failures — the admin needs to see them.`;
}

function buildCodexOnboardingPrompt(aoseUrl) {
  const aoseBase = aoseUrl.replace(/\/api\/gateway$/, '').replace(/\/$/, '');
  return `Hi! You've been invited to join an aose workspace — a collaborative platform where humans and agents work together on documents, databases, and projects. This prompt will walk you through the full registration. Execute each step in order; do not skip any.

You are running on Codex CLI. AOSE supports Codex via a local sidecar ("aose-adapter") that pushes AOSE events into a file-based inbox. A Stop hook checks this inbox whenever your interactive Codex session finishes a turn — if a message is waiting, the hook outputs decision:block to keep the session alive and deliver the event. The sidecar runs under pm2; the Codex session runs inside tmux so it stays alive across terminal disconnects.

IMPORTANT — HTTP tooling: For every HTTP call in this prompt, use \`curl\`. Do NOT use Python urllib/requests, Node http, or any language-level HTTP client. curl ships on macOS and Linux and verifies TLS against the OS trust store, so it works across every environment. Language HTTP clients frequently fail on CA-bundle issues (especially Homebrew Python) — skip that class of problem entirely by using curl.

Step 1 — Confirm your agent directory
Your agent directory (AGENT_DIR) is the working directory where this Codex session is running — it defines your AOSE identity on this host. Save the absolute path of your current working directory as AGENT_DIR. Different agents on the same host MUST use different AGENT_DIRs.

Step 2 — Register with AOSE
Pick a single name that is lowercase alphanumeric with hyphens, 2-31 chars (e.g. "my-codex-agent"). This name is BOTH your @-mention handle and your display label in AOSE — there is no separate "display name" field. You can refine the display name later via the profile API if you want something prettier; the registration form takes one identifier on purpose so two slightly-different values cannot end up confusing humans. Then run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"<your-agent-name>","platform":"codex"}'

Save the returned "token" as AOSE_TOKEN. Your registration will be reviewed by an admin.

Step 3 — Wait for approval
The workspace admin will review and approve your registration in aose. STOP HERE and return control to the human. You have no way to auto-detect approval at this point — the adapter sidecar is not running yet, so there is no event stream you can watch. The human will come back and tell you "approved — continue" once they've clicked approve in the aose admin UI. Do not poll, do not guess, do not proceed until the human tells you.

Step 4 — Write the adapter config file
Create the directory ~/.aose if it does not exist. Write the following JSON to ~/.aose/adapter-<your-agent-name>.json:

{
  "agent_name": "<your-agent-name>",
  "platform": "codex",
  "gateway_url": "${aoseBase}",
  "agent_token": "<AOSE_TOKEN from Step 2>",
  "agent_dir": "<AGENT_DIR from Step 1>"
}

Set the file permissions to 600 (chmod 600 ~/.aose/adapter-<your-agent-name>.json) so only you can read it — it contains secrets.

Step 5 — Install the Stop hook
The Stop hook is a shell script that checks your inbox file for pending AOSE events. When a message is waiting, it outputs a decision:block JSON to keep the Codex session alive and process the event.

Create the directory <AGENT_DIR>/.codex/hooks/ if it does not exist. Write the following script to <AGENT_DIR>/.codex/hooks/stop-hook-aose.sh:

\`\`\`bash
#!/bin/bash
INPUT=$(cat)

STOP_HOOK_ACTIVE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stop_hook_active','false'))" 2>/dev/null)
if [ "$STOP_HOOK_ACTIVE" = "true" ] || [ "$STOP_HOOK_ACTIVE" = "True" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

INBOX_FILE="$HOME/.aose/inbox/<your-agent-name>.jsonl"

if [ ! -f "$INBOX_FILE" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

LINE=$(head -1 "$INBOX_FILE" 2>/dev/null)
if [ -z "$LINE" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

tail -n +2 "$INBOX_FILE" > "$INBOX_FILE.tmp" && mv "$INBOX_FILE.tmp" "$INBOX_FILE"

CONTENT=$(echo "$LINE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('content',''))" 2>/dev/null)
if [ -z "$CONTENT" ]; then
  CONTENT="$LINE"
fi

ESCAPED=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null)

echo "{\\"decision\\":\\"block\\",\\"reason\\":$ESCAPED}"
exit 0
\`\`\`

Make it executable: chmod +x <AGENT_DIR>/.codex/hooks/stop-hook-aose.sh

Then register it in <AGENT_DIR>/.codex/config.toml. Read the file first if it exists, then add the hook. Codex hooks config format:

\`\`\`toml
[[hooks.stop]]
command = "<AGENT_DIR>/.codex/hooks/stop-hook-aose.sh"
\`\`\`

If the file already has other hooks or settings, merge carefully — preserve everything else.

Step 6 — Start the adapter sidecar under pm2
Start the adapter sidecar as a managed process:

  pm2 start "npx -y aose-adapter --config ~/.aose/adapter-<your-agent-name>.json" --name aose-adapter-<your-agent-name>
  pm2 save

Wait 5 seconds, then check logs:
  pm2 logs aose-adapter-<your-agent-name> --lines 15 --nostream

You should see lines like:
  [adapter] Starting — agent: ..., platform: codex, gateway: ...
  [adapter] SSE connected

If you see errors, check the config file from Step 4.

Step 7 — Start the dedicated Codex session in tmux
The Stop hook only fires inside an interactive Codex session. Start a persistent session using tmux so it survives terminal disconnects:

  tmux new-session -d -s aose-<your-agent-name> -c <AGENT_DIR> "codex"

Verify it is running:
  tmux has-session -t aose-<your-agent-name> && echo "Session running"

To make this survive reboots, create a wrapper script and register it with pm2. Write the following to ~/.aose/start-aose-<your-agent-name>.sh:

\`\`\`bash
#!/bin/bash
tmux has-session -t aose-<your-agent-name> 2>/dev/null || \\
  tmux new-session -d -s aose-<your-agent-name> -c <AGENT_DIR> "codex"
\`\`\`

Then:
  chmod +x ~/.aose/start-aose-<your-agent-name>.sh
  pm2 start ~/.aose/start-aose-<your-agent-name>.sh --name aose-<your-agent-name>-starter --cron-restart="*/5 * * * *"
  pm2 save

Run \`pm2 startup\` if you haven't already to ensure pm2 itself starts on boot. The cron restart re-checks every 5 minutes — if the tmux session died, it gets recreated.

Step 8 — Configure the MCP server
The MCP entry MUST go into your **project-level** config file. For Codex, this is \`<AGENT_DIR>/.codex/config.toml\`. Do NOT put it in a global config — multi-agent isolation depends on each agent owning its own project-level config.

TARGET_FILE = \`<AGENT_DIR>/.codex/config.toml\`

**Pre-check (mandatory)**: before writing, read TARGET_FILE if it exists and look for an existing \`[mcp.servers.aose]\` section. There are three cases:
  1. No aose entry → add it.
  2. An aose entry exists with a different token → STOP. Report to human: "config.toml already has an aose entry belonging to another agent."
  3. An aose entry exists with the same token → it is already configured (from a previous attempt); verify it matches the format below and continue.

The entry to add:
\`\`\`toml
[mcp.servers.aose]
command = "npx"
args = ["-y", "aose-mcp"]

[mcp.servers.aose.env]
AOSE_TOKEN = "<AOSE_TOKEN from Step 2>"
AOSE_URL = "${aoseUrl}"
\`\`\`

Restart Codex (exit and relaunch from inside AGENT_DIR) so the new MCP server is loaded. You should now see aose-prefixed tools (whoami, reply_to_comment, create_doc, etc.).

Step 9 — Verify end-to-end
Call the aose "whoami" tool. It should return your agent_id and name confirming AOSE sees you. If not, check that AOSE_TOKEN matches the token from Step 2 and that you have been approved.

Step 10 — Read your operating manual (REQUIRED before doing any work)
The aose-mcp server cached your operating skills to ~/.aose-mcp/skills/ when it started. These files are not optional reading — they describe how to behave as an AOSE agent: role and principles, typical tasks, platform overview, event handling, lifecycle, troubleshooting, output standards, and per-content-type guides (docs, comments, database, slides, flowcharts). The MCP host does not surface them automatically; you must read them yourself before responding to any AOSE event.

Run:
  ls ~/.aose-mcp/skills/

You should see numbered files (00-role-and-principles.md, 01-typical-tasks.md, ..., 06-output-standards.md) plus content-*.md guides. Read every file in order. If the directory is empty or missing, your aose-mcp server failed to fetch them — check its stderr output via your MCP host's logs and report the error; do not proceed.

These skills override any default assumptions you have about how to interact with documents, comments, or other agents. When in doubt during real work, re-read the relevant content-*.md file rather than guessing.

**IRON RULE — event handling**: when the Stop hook wakes this agent with a message, that message is a **doorbell**, not the event data. It contains no ids and no comment body — those live in the MCP mailbox. Your only correct response is:

  1. Call the aose \`get_unread_events\` MCP tool to pull the full events (with their \`context_payload\`).
  2. Act on the structured payload — use \`context_payload.write_back_target.anchor_id\`, \`minimal_required_context.content_snippet\`, \`thread\`, etc.
  3. Reply with \`reply_to_comment(comment_id, text)\` or other MCP tools. NEVER curl the gateway directly, even though you saw an AOSE_TOKEN during Step 2 — the MCP server holds it for you and the MCP surface is the only supported write path.
  4. Call \`ack_events([event_ids])\` on the events you handled.

Once whoami succeeds AND you have read all skills, registration is complete.

If any step fails, stop and report which step, which command, and the full error output. Do not try to patch around failures — the admin needs to see them.`;
}

function buildGeminiCliOnboardingPrompt(aoseUrl) {
  const aoseBase = aoseUrl.replace(/\/api\/gateway$/, '').replace(/\/$/, '');
  return `Hi! You've been invited to join an aose workspace — a collaborative platform where humans and agents work together on documents, databases, and projects. This prompt will walk you through the full registration. Execute each step in order; do not skip any.

You are running on Gemini CLI. AOSE supports Gemini CLI via a local sidecar ("aose-adapter") that pushes AOSE events into a file-based inbox. An AfterAgent hook checks this inbox after each turn — if a message is waiting, the hook uses exit-code 2 + stderr to inject the event as a retry prompt. Unlike Claude Code and Codex, Gemini CLI does not need a persistent tmux session: the sidecar is the only long-running process. Events are processed via \`gemini -p --resume\` calls that maintain session context across invocations.

IMPORTANT — HTTP tooling: For every HTTP call in this prompt, use \`curl\`. Do NOT use Python urllib/requests, Node http, or any language-level HTTP client. curl ships on macOS and Linux and verifies TLS against the OS trust store, so it works across every environment. Language HTTP clients frequently fail on CA-bundle issues (especially Homebrew Python) — skip that class of problem entirely by using curl.

Step 1 — Confirm your agent directory
Your agent directory (AGENT_DIR) is the working directory where this Gemini CLI session is running — it defines your AOSE identity on this host. Save the absolute path of your current working directory as AGENT_DIR. Different agents on the same host MUST use different AGENT_DIRs.

Step 2 — Register with AOSE
Pick a single name that is lowercase alphanumeric with hyphens, 2-31 chars (e.g. "my-gemini-agent"). This name is BOTH your @-mention handle and your display label in AOSE — there is no separate "display name" field. You can refine the display name later via the profile API if you want something prettier; the registration form takes one identifier on purpose so two slightly-different values cannot end up confusing humans. Then run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"<your-agent-name>","platform":"gemini-cli"}'

Save the returned "token" as AOSE_TOKEN. Your registration will be reviewed by an admin.

Step 3 — Wait for approval
The workspace admin will review and approve your registration in aose. STOP HERE and return control to the human. You have no way to auto-detect approval at this point — the adapter sidecar is not running yet, so there is no event stream you can watch. The human will come back and tell you "approved — continue" once they've clicked approve in the aose admin UI. Do not poll, do not guess, do not proceed until the human tells you.

Step 4 — Write the adapter config file
Create the directory ~/.aose if it does not exist. Write the following JSON to ~/.aose/adapter-<your-agent-name>.json:

{
  "agent_name": "<your-agent-name>",
  "platform": "gemini-cli",
  "gateway_url": "${aoseBase}",
  "agent_token": "<AOSE_TOKEN from Step 2>",
  "agent_dir": "<AGENT_DIR from Step 1>"
}

Set the file permissions to 600 (chmod 600 ~/.aose/adapter-<your-agent-name>.json) so only you can read it — it contains secrets.

Step 5 — Install the AfterAgent hook
The AfterAgent hook is a shell script that checks your inbox file for pending AOSE events after each turn. When a message is waiting, it uses exit-code 2 + stderr to inject the event content as a retry prompt, so you process the event immediately.

Create the directory <AGENT_DIR>/.gemini/hooks/ if it does not exist. Write the following script to <AGENT_DIR>/.gemini/hooks/after-agent-aose.sh:

\`\`\`bash
#!/bin/bash
INBOX_FILE="$HOME/.aose/inbox/<your-agent-name>.jsonl"

# Read stdin (Gemini CLI passes hook context as JSON on stdin)
cat > /dev/null

if [ ! -f "$INBOX_FILE" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

LINE=$(head -1 "$INBOX_FILE" 2>/dev/null)
if [ -z "$LINE" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

# Consume the first line from inbox
tail -n +2 "$INBOX_FILE" > "$INBOX_FILE.tmp" && mv "$INBOX_FILE.tmp" "$INBOX_FILE"

CONTENT=$(echo "$LINE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('content',''))" 2>/dev/null)
if [ -z "$CONTENT" ]; then
  CONTENT="$LINE"
fi

# Exit code 2 + stderr = Gemini CLI treats this as a retry with the stderr content as feedback
echo "$CONTENT" >&2
exit 2
\`\`\`

Make it executable: chmod +x <AGENT_DIR>/.gemini/hooks/after-agent-aose.sh

Then register it in <AGENT_DIR>/.gemini/settings.json. Read the file first if it exists, then add the hook under the "hooks" key. The AfterAgent hook format for Gemini CLI:

{
  "hooks": {
    "AfterAgent": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "<AGENT_DIR>/.gemini/hooks/after-agent-aose.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}

If the file already has other hooks or settings, merge carefully — preserve everything else.

Step 6 — Start the adapter sidecar under pm2
Start the adapter sidecar as a managed process:

  pm2 start "npx -y aose-adapter --config ~/.aose/adapter-<your-agent-name>.json" --name aose-adapter-<your-agent-name>
  pm2 save

Wait 5 seconds, then check logs:
  pm2 logs aose-adapter-<your-agent-name> --lines 15 --nostream

You should see lines like:
  [adapter] Starting — agent: ..., platform: gemini-cli, gateway: ...
  [adapter] SSE connected

If you see errors, check the config file from Step 4.

Step 7 — Configure the MCP server
Gemini CLI reads MCP server config from \`<AGENT_DIR>/.gemini/settings.json\` (the same file where hooks are defined). Add the aose MCP server to the "mcpServers" section.

TARGET_FILE = \`<AGENT_DIR>/.gemini/settings.json\`

**Pre-check (mandatory)**: before writing, read TARGET_FILE if it exists and look for an existing \`mcpServers.aose\` entry. There are three cases:
  1. No aose entry → add it.
  2. An aose entry exists with a different token → STOP. Report to human: "settings.json already has an aose entry belonging to another agent."
  3. An aose entry exists with the same token → it is already configured (from a previous attempt); verify it matches the format below and continue.

The entry to add (merge into the existing settings.json — do NOT overwrite hooks or other settings):
{
  "mcpServers": {
    "aose": {
      "command": "npx",
      "args": ["-y", "aose-mcp"],
      "env": {
        "AOSE_TOKEN": "<AOSE_TOKEN from Step 2>",
        "AOSE_URL": "${aoseUrl}"
      }
    }
  }
}

Note: Gemini CLI prefixes MCP tool names with \`mcp_<server-name>_\` — so aose tools will appear as \`mcp_aose_whoami\`, \`mcp_aose_create_doc\`, etc. (single underscores, not double). This is automatic; you do not need to rename anything.

Restart Gemini CLI (exit and relaunch from inside AGENT_DIR) so the new MCP server is loaded.

Step 8 — Verify end-to-end
Call the aose "whoami" tool (it will appear as \`mcp_aose_whoami\` in your tool list). It should return your agent_id and name confirming AOSE sees you. If not, check that AOSE_TOKEN matches the token from Step 2 and that you have been approved.

Step 9 — Read your operating manual (REQUIRED before doing any work)
The aose-mcp server cached your operating skills to ~/.aose-mcp/skills/ when it started. These files are not optional reading — they describe how to behave as an AOSE agent: role and principles, typical tasks, platform overview, event handling, lifecycle, troubleshooting, output standards, and per-content-type guides (docs, comments, database, slides, flowcharts). The MCP host does not surface them automatically; you must read them yourself before responding to any AOSE event.

Run:
  ls ~/.aose-mcp/skills/

You should see numbered files (00-role-and-principles.md, 01-typical-tasks.md, ..., 06-output-standards.md) plus content-*.md guides. Read every file in order. If the directory is empty or missing, your aose-mcp server failed to fetch them — check its stderr output via your MCP host's logs and report the error; do not proceed.

These skills override any default assumptions you have about how to interact with documents, comments, or other agents. When in doubt during real work, re-read the relevant content-*.md file rather than guessing.

**IRON RULE — event handling**: when the AfterAgent hook wakes this agent with a message, that message is a **doorbell**, not the event data. It contains no ids and no comment body — those live in the MCP mailbox. Your only correct response is:

  1. Call the aose \`mcp_aose_get_unread_events\` MCP tool to pull the full events (with their \`context_payload\`).
  2. Act on the structured payload — use \`context_payload.write_back_target.anchor_id\`, \`minimal_required_context.content_snippet\`, \`thread\`, etc.
  3. Reply with \`mcp_aose_reply_to_comment(comment_id, text)\` or other MCP tools. NEVER curl the gateway directly, even though you saw an AOSE_TOKEN during Step 2 — the MCP server holds it for you and the MCP surface is the only supported write path.
  4. Call \`mcp_aose_ack_events([event_ids])\` on the events you handled.

Once whoami succeeds AND you have read all skills, registration is complete.

If any step fails, stop and report which step, which command, and the full error output. Do not try to patch around failures — the admin needs to see them.`;
}

function buildZylosOnboardingPrompt(aoseUrl) {
  const aoseBase = aoseUrl.replace(/\/api\/gateway$/, '').replace(/\/$/, '');
  return `Hi! You've been invited to join an aose workspace — a collaborative platform where humans and agents work together on documents, databases, and projects. This prompt will walk you through the full registration. Execute each step in order; do not skip any.

You are running on Zylos. AOSE supports Zylos via a local sidecar ("aose-adapter") that pushes AOSE events into your C4 comm-bridge inbox, so you get woken up when someone @-mentions you in AOSE.

IMPORTANT — HTTP tooling: For every HTTP call in this prompt, use \`curl\`. Do NOT use Python urllib/requests, Node http, or any language-level HTTP client. curl ships on macOS and Linux and verifies TLS against the OS trust store, so it works across every environment. Language HTTP clients frequently fail on CA-bundle issues (especially Homebrew Python) — skip that class of problem entirely by using curl.

Step 1 — Locate your C4 inbox script
Check that the file /Users/mac/zylos/.claude/skills/comm-bridge/scripts/c4-receive.js exists. Save its absolute path as C4_RECEIVE_PATH. Also confirm your ZYLOS_DIR (the working directory for this agent, e.g. /Users/mac/zylos-thinker). Save it as ZYLOS_DIR.

Step 2 — Register with AOSE
Pick a single name that is lowercase alphanumeric with hyphens, 2-31 chars (e.g. "zylos-newbie"). This name is BOTH your @-mention handle and your display label in AOSE — there is no separate "display name" field. You can refine the display name later via the profile API if you want something prettier; the registration form takes one identifier on purpose so two slightly-different values cannot end up confusing humans. Then run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"<your-agent-name>","platform":"zylos"}'

Save the returned "token" as AOSE_TOKEN. Your registration will be reviewed by an admin.

Step 3 — Wait for approval
The workspace admin will review and approve your registration in aose. STOP HERE and return control to the human. You have no way to auto-detect approval at this point — the adapter sidecar is not running yet, so there is no event stream you can watch. The human will come back and tell you "approved — continue" once they've clicked approve in the aose admin UI. Do not poll, do not guess, do not proceed until the human tells you.

Step 4 — Write the adapter config file
Create the directory ~/.aose if it does not exist. Write the following JSON to ~/.aose/adapter-<your-agent-name>.json:

{
  "agent_name": "<your-agent-name>",
  "platform": "zylos",
  "gateway_url": "${aoseBase}",
  "agent_token": "<AOSE_TOKEN from Step 2>",
  "zylos_dir": "<ZYLOS_DIR from Step 1>",
  "c4_receive_path": "<C4_RECEIVE_PATH from Step 1>"
}

Set the file permissions to 600 (chmod 600 ~/.aose/adapter-<your-agent-name>.json) so only you can read it — it contains secrets.

Step 5 — Start the adapter sidecar
Run the following shell command to start the adapter as a background process:

nohup npx -y aose-adapter --config ~/.aose/adapter-<your-agent-name>.json > ~/.aose/adapter-<your-agent-name>.log 2>&1 &

Wait 3 seconds, then read the first 30 lines of ~/.aose/adapter-<your-agent-name>.log. You should see lines like:
  [adapter] Starting — agent: ..., platform: zylos, gateway: ...
  [adapter] SSE connected

If you see "Failed to read config" or "config.zylos_dir is required", re-check the JSON file from Step 4.

To make the adapter survive reboots, register it with a process manager (pm2 preferred on Zylos hosts):
  pm2 start "$(which aose-adapter)" --name aose-adapter-<your-agent-name> -- --config ~/.aose/adapter-<your-agent-name>.json
  pm2 save

Step 6 — Configure the MCP server
The MCP entry MUST go into your **project-level** config file: \`<ZYLOS_DIR>/.mcp.json\` (e.g. /Users/mac/zylos-thinker/.mcp.json). Do NOT write it to ~/.mcp.json or ~/.claude/.mcp.json — those are shared across every Claude Code instance on this host, and putting your token there will collide with other AOSE agents that also live on this mac. Multi-agent isolation on a single host depends on each agent owning its own project-level .mcp.json.

TARGET_FILE = \`<ZYLOS_DIR>/.mcp.json\`

**Pre-check (mandatory)**: before writing, read TARGET_FILE if it exists and look for an existing \`mcpServers.aose\` entry. There are three cases:
  1. TARGET_FILE does not exist → create it with the JSON below as the entire content.
  2. TARGET_FILE exists but has no \`mcpServers.aose\` entry → merge the \`aose\` entry below into the existing \`mcpServers\` object, preserving all other servers.
  3. TARGET_FILE exists AND already has an \`mcpServers.aose\` entry → STOP. Do not overwrite. Report to the human: "TARGET_FILE already has an aose entry. Its token belongs to another AOSE agent on this host. Either pick a different cwd for me to run from, or have that other agent run its offboarding prompt first." Then halt — do not retry until the human resolves it.

The entry to write:
{
  "mcpServers": {
    "aose": {
      "command": "npx",
      "args": ["-y", "aose-mcp"],
      "env": {
        "AOSE_TOKEN": "<AOSE_TOKEN from Step 2>",
        "AOSE_URL": "${aoseUrl}"
      }
    }
  }
}

Restart your MCP client (Claude Code: exit and relaunch from inside ZYLOS_DIR so it picks up the project-level config) so the new server is loaded. You should now see aose-prefixed tools (whoami, reply_to_comment, create_doc, etc.).

Step 7 — Verify end-to-end
Call the aose "whoami" tool. It should return your agent_id and name confirming AOSE sees you. If not, check that AOSE_TOKEN matches the token from Step 2 and that you have been approved.

Step 8 — Read your operating manual (REQUIRED before doing any work)
The aose-mcp server cached your operating skills to ~/.aose-mcp/skills/ when it started. These files are not optional reading — they describe how to behave as an AOSE agent: role and principles, typical tasks, platform overview, event handling, lifecycle, troubleshooting, output standards, and per-content-type guides (docs, comments, database, slides, flowcharts). The MCP host does not surface them automatically; you must read them yourself before responding to any AOSE event.

Run:
  ls ~/.aose-mcp/skills/

You should see numbered files (00-role-and-principles.md, 01-typical-tasks.md, ..., 06-output-standards.md) plus content-*.md guides. Read every file in order. If the directory is empty or missing, your aose-mcp server failed to fetch them — check its stderr output via your MCP host's logs and report the error; do not proceed.

These skills override any default assumptions you have about how to interact with documents, comments, or other agents. When in doubt during real work, re-read the relevant content-*.md file rather than guessing.

**IRON RULE — event handling**: when the adapter wakes this agent via C4 with a message starting with \`[AOSE]\`, that message is a **doorbell**, not the event data. It contains no ids and no comment body — those live in the MCP mailbox. Your only correct response is:

  1. Call the aose \`get_unread_events\` MCP tool to pull the full events (with their \`context_payload\`).
  2. Act on the structured payload — use \`context_payload.write_back_target.anchor_id\`, \`minimal_required_context.content_snippet\`, \`thread\`, etc.
  3. Reply with \`reply_to_comment(comment_id, text)\` or other MCP tools. NEVER curl the gateway directly, even though you saw an AOSE_TOKEN during Step 2 — the MCP server holds it for you and the MCP surface is the only supported write path.
  4. Call \`ack_events([event_ids])\` on the events you handled.

Once whoami succeeds AND you have read all skills, registration is complete.

If any step fails, stop and report which step, which command, and the full error output. Do not try to patch around failures — the admin needs to see them.`;
}

// Clean up expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of selfRegisterLimiter) {
    if (now > entry.resetTime) selfRegisterLimiter.delete(ip);
  }
}, 10 * 60 * 1000);

function checkSelfRegisterRate(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  let entry = selfRegisterLimiter.get(ip);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    selfRegisterLimiter.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many registration attempts. Try again later.' });
  }
  next();
}

export default function authRoutes(app, { express, db, JWT_SECRET, ADMIN_TOKEN, authenticateAny, authenticateAdmin, authenticateAgent, genId, hashToken, hashPassword, verifyPassword, pushEvent }) {

  // ─── Shared: Avatar upload setup ─────────────────
  const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(GATEWAY_DIR, 'uploads');
  const AVATAR_DIR = path.join(UPLOADS_ROOT, 'avatars');
  if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

  const avatarUpload = multer({
    storage: multer.diskStorage({
      destination: AVATAR_DIR,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only image files are allowed'));
    },
  });

  // ─── Human Auth ──────────────────────────────────
  // POST /api/auth/login — human login
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const actor = db.prepare("SELECT * FROM actors WHERE username = ? AND type = 'human'").get(username);
    if (!actor || !actor.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

    if (!verifyPassword(password, actor.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ actor_id: actor.id, type: 'human', username: actor.username, role: actor.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, actor: { id: actor.id, username: actor.username, display_name: actor.display_name, role: actor.role, avatar_url: actor.avatar_url } });
  });

  // GET /api/auth/me — get current user (works for both human JWT and agent Bearer)
  app.get('/api/auth/me', authenticateAny, (req, res) => {
    const a = req.actor;
    res.json({ id: a.id, type: a.type, username: a.username, display_name: a.display_name, role: a.role, avatar_url: a.avatar_url });
  });

  // PATCH /api/auth/password — change password (human only)
  app.patch('/api/auth/password', authenticateAny, (req, res) => {
    if (req.actor.type !== 'human') return res.status(403).json({ error: 'Agents cannot change password' });
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password required' });

    const actor = db.prepare('SELECT password_hash FROM actors WHERE id = ?').get(req.actor.id);
    if (!verifyPassword(current_password, actor.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    db.prepare('UPDATE actors SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(new_password), Date.now(), req.actor.id);
    res.json({ ok: true });
  });

  // PATCH /api/auth/profile — update own profile (human: name syncs username+display_name, avatar_url)
  app.patch('/api/auth/profile', authenticateAny, (req, res) => {
    if (req.actor.type !== 'human') return res.status(403).json({ error: 'Use /api/agents/:name for agent profiles' });
    const { name, avatar_url } = req.body;
    const updates = [];
    const values = [];
    if (name !== undefined) {
      if (!name || name.length < 2 || name.length > 30) {
        return res.status(400).json({ error: 'Name must be 2-30 characters' });
      }
      const existing = db.prepare('SELECT id FROM actors WHERE username = ? AND id != ?').get(name, req.actor.id);
      if (existing) return res.status(409).json({ error: 'Name already taken' });
      updates.push('username = ?'); values.push(name);
      updates.push('display_name = ?'); values.push(name);
    }
    if (avatar_url !== undefined) { updates.push('avatar_url = ?'); values.push(avatar_url); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    updates.push('updated_at = ?'); values.push(Date.now());
    values.push(req.actor.id);
    db.prepare(`UPDATE actors SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT id, type, username, display_name, role, avatar_url FROM actors WHERE id = ?').get(req.actor.id);
    res.json(updated);
  });

  // POST /api/auth/avatar — upload own avatar (human)
  app.post('/api/auth/avatar', authenticateAny, avatarUpload.single('avatar'), (req, res) => {
    if (req.actor.type !== 'human') return res.status(403).json({ error: 'Use /api/agents/:name/avatar for agent profiles' });
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
    const current = db.prepare('SELECT avatar_url FROM actors WHERE id = ?').get(req.actor.id);
    if (current?.avatar_url && current.avatar_url.includes('/uploads/avatars/')) {
      const filename = current.avatar_url.split('/uploads/avatars/').pop();
      if (filename) {
        const oldPath = path.join(AVATAR_DIR, filename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    db.prepare('UPDATE actors SET avatar_url = ?, updated_at = ? WHERE id = ?').run(avatarUrl, Date.now(), req.actor.id);
    res.json({ ok: true, avatar_url: avatarUrl });
  });

  // ─── Admin: Create ticket ────────────────────────
  app.post('/api/admin/tickets', authenticateAdmin, (req, res) => {
    const { label, expires_in = 86400 } = req.body;
    const id = `tkt_${crypto.randomBytes(16).toString('hex')}`;
    const now = Date.now();
    db.prepare('INSERT INTO tickets (id, label, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(id, label || '', now + expires_in * 1000, now);
    res.json({ ticket: id, expires_at: now + expires_in * 1000 });
  });

  // ─── Auth: Register agent ────────────────────────
  app.post('/api/auth/register', (req, res) => {
    const { ticket, name, display_name, capabilities, webhook_url, webhook_secret, platform } = req.body;
    if (!ticket || !name || !display_name) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'ticket, name, display_name required' });
    }
    // Validate ticket
    const tkt = db.prepare('SELECT * FROM tickets WHERE id = ? AND used = 0').get(ticket);
    if (!tkt) {
      return res.status(400).json({ error: 'INVALID_TICKET', message: 'Ticket not found or already used' });
    }
    if (Date.now() > tkt.expires_at) {
      return res.status(400).json({ error: 'TICKET_EXPIRED', message: 'Ticket has expired' });
    }
    // Check name uniqueness
    const existingActor = db.prepare('SELECT id FROM actors WHERE username = ?').get(name);
    if (existingActor) {
      return res.status(409).json({ error: 'NAME_TAKEN', message: `Name "${name}" already registered` });
    }
    // Create agent
    const agentId = genId('agt');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const now = Date.now();

    db.prepare(`INSERT INTO actors (id, type, username, display_name, token_hash, capabilities, webhook_url, webhook_secret, platform, created_at, updated_at)
      VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(agentId, name, display_name, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, platform || null, now, now);

    // Mark ticket used
    db.prepare('UPDATE tickets SET used = 1 WHERE id = ?').run(ticket);

    res.json({ agent_id: agentId, token, name, display_name, created_at: now });
  });

  // ─── Auth: Verify ────────────────────────────────
  app.get('/api/me', authenticateAny, (req, res) => {
    const a = req.actor;
    // Return unified actor info + backward-compatible agent fields
    res.json({
      id: a.id, type: a.type, username: a.username, display_name: a.display_name, role: a.role, avatar_url: a.avatar_url,
      // Backward compat for agents
      agent_id: a.id, name: a.username,
      capabilities: JSON.parse(req.agent?.capabilities || '[]'),
    });
  });

  // ─── Agent Self-Registration ────────────────────
  app.post('/api/agents/self-register', checkSelfRegisterRate, async (req, res) => {
    const { name, display_name, capabilities, webhook_url, webhook_secret, platform } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'name required' });
    }
    // display_name is optional at registration: defaults to name. The agent
    // (or an admin) can refine it later via PATCH /api/me/profile. Asking for
    // both up front let users pick subtly-different values that confused
    // viewers — keep the registration form to a single identifier.
    const effectiveDisplayName = display_name || name;
    // Validate name format: lowercase, alphanumeric + hyphens
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
      return res.status(400).json({
        error: 'INVALID_NAME',
        message: 'Name must be lowercase alphanumeric with hyphens, 2-31 chars',
        pattern: '^[a-z][a-z0-9-]{1,30}$',
      });
    }
    // Check name uniqueness
    const existingActor = db.prepare('SELECT id FROM actors WHERE username = ?').get(name);
    if (existingActor) {
      return res.status(409).json({
        error: 'NAME_TAKEN',
        message: `Name "${name}" already registered. Pick a different name and retry.`,
        pattern: '^[a-z][a-z0-9-]{1,30}$',
      });
    }

    const agentId = genId('agt');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const now = Date.now();

    db.prepare(`INSERT INTO actors (id, type, username, display_name, token_hash, capabilities, webhook_url, webhook_secret, platform, pending_approval, created_at, updated_at)
      VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(agentId, name, effectiveDisplayName, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, platform || null, now, now);

    // Notify all human admins about new agent registration
    const admins = db.prepare("SELECT id FROM actors WHERE type = 'human' AND role = 'admin'").all();
    for (const admin of admins) {
      insertNotification(db, { genId }, {
        actorId: agentId,
        targetActorId: admin.id,
        type: 'agent_registered',
        titleKey: 'serverNotifications.agent_registered.title',
        titleParams: { displayName: effectiveDisplayName },
        bodyKey: 'serverNotifications.agent_registered.body',
        bodyParams: { name },
        link: '/content?agents=1',
      });
    }

    const publicBaseUrl = getPublicBaseUrl(req);
    const gatewayBase = `${publicBaseUrl}/api/gateway`;
    const skillsUrl = `${gatewayBase}/agent-skills`;
    res.status(201).json({
      agent_id: agentId,
      token,
      name,
      display_name: effectiveDisplayName,
      status: 'pending_approval',
      skills_url: skillsUrl,
      mcp_server: {
        install: 'npx -y aose-mcp',
        env: { AOSE_TOKEN: token, AOSE_URL: gatewayBase },
      },
      message: 'Registration received. Fetch skills from skills_url and configure MCP server.',
      created_at: now,
    });
  });

  // Admin: approve a pending agent
  app.post('/api/admin/agents/:agent_id/approve', authenticateAdmin, (req, res) => {
    const agent = db.prepare("SELECT * FROM actors WHERE id = ? AND type = 'agent'").get(req.params.agent_id);
    if (!agent) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found' });
    }
    const now = Date.now();
    db.prepare('UPDATE actors SET pending_approval = 0, updated_at = ? WHERE id = ?')
      .run(now, agent.id);

    // Push approval event to the agent via SSE
    const approvalEvent = {
      id: genId('evt'),
      type: 'agent.approved',
      occurred_at: now,
      data: {
        agent_id: agent.id,
        name: agent.username,
        message: 'Your registration has been approved. You now have full access to AOSE.',
      },
    };
    db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
      VALUES (?, ?, 'agent.approved', 'system', ?, ?, ?)`)
      .run(approvalEvent.id, agent.id, approvalEvent.occurred_at, JSON.stringify(approvalEvent), now);
    if (pushEvent) pushEvent(agent.id, approvalEvent);

    res.json({ agent_id: agent.id, name: agent.username, status: 'approved' });
  });

  // Admin: reject a pending agent
  app.post('/api/admin/agents/:agent_id/reject', authenticateAdmin, (req, res) => {
    const agent = db.prepare("SELECT * FROM actors WHERE id = ? AND type = 'agent'").get(req.params.agent_id);
    if (!agent) return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found' });
    if (!agent.pending_approval) return res.status(400).json({ error: 'NOT_PENDING', message: 'Agent is not pending approval' });
    const now = Date.now();
    db.prepare('UPDATE actors SET pending_approval = 0, deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, agent.id);
    const rejectEvent = {
      id: genId('evt'), type: 'agent.rejected', occurred_at: now,
      data: { agent_id: agent.id, name: agent.username, message: 'Your registration has been rejected.' },
    };
    db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at) VALUES (?, ?, 'agent.rejected', 'system', ?, ?, ?)`)
      .run(rejectEvent.id, agent.id, rejectEvent.occurred_at, JSON.stringify(rejectEvent), now);
    if (pushEvent) pushEvent(agent.id, rejectEvent);
    res.json({ agent_id: agent.id, name: agent.username, status: 'rejected' });
  });

  // Admin: soft-delete an agent
  // Returns the per-platform offboarding prompt so the admin can copy it
  // to the agent for local cleanup (adapter sidecar, config files with the
  // revoked token, MCP server entry).
  app.delete('/api/admin/agents/:agent_id', authenticateAdmin, (req, res) => {
    const agent = db.prepare("SELECT * FROM actors WHERE id = ? AND type = 'agent'").get(req.params.agent_id);
    if (!agent) return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found' });
    if (agent.deleted_at) return res.status(400).json({ error: 'ALREADY_DELETED', message: 'Agent is already deleted' });
    const now = Date.now();
    const originalName = agent.username;
    // Release the name so the same name can be re-registered later. The
    // mangled form keeps the row uniquely addressable for audit while
    // freeing `username` for self-register's uniqueness check.
    const releasedName = `${originalName}.deleted.${now}`;
    db.prepare('UPDATE actors SET username = ?, deleted_at = ?, online = 0, updated_at = ? WHERE id = ?')
      .run(releasedName, now, now, agent.id);
    const offboardingPrompt = buildOffboardingPrompt(agent.platform, originalName);
    res.json({
      agent_id: agent.id,
      name: originalName,
      status: 'deleted',
      platform: agent.platform || null,
      offboarding_prompt: offboardingPrompt,
    });
  });

  // Admin: get offboarding prompt for a specific platform (data-driven, mirrors /api/admin/onboarding-prompt)
  app.get('/api/admin/offboarding-prompt', authenticateAdmin, (req, res) => {
    const platform = req.query.platform || 'zylos';
    const agentName = req.query.agent_name || null;
    const prompt = buildOffboardingPrompt(platform, agentName);
    res.json({ platform, prompt });
  });

  // Admin: list all agents (excluding deleted)
  app.get('/api/admin/agents', authenticateAdmin, (req, res) => {
    const agents = db.prepare("SELECT id, username, display_name, avatar_url, capabilities, platform, online, last_seen_at, pending_approval, created_at FROM actors WHERE type = 'agent' AND deleted_at IS NULL").all();
    res.json({ agents: agents.map(a => ({ ...a, agent_id: a.id, name: a.username, capabilities: JSON.parse(a.capabilities || '[]'), pending_approval: !!a.pending_approval, platform: a.platform || null })) });
  });

  // Admin: get onboarding prompt for a specific platform (data-driven platform list)
  app.get('/api/admin/onboarding-prompt', authenticateAdmin, (req, res) => {
    const platform = req.query.platform || 'zylos';
    const origin = getPublicBaseUrl(req);
    const aoseUrl = `${origin}/api/gateway`;
    const prompt = buildOnboardingPrompt(platform, aoseUrl);
    res.json({ platform, prompt });
  });

  // Admin: list available platforms (data-driven)
  app.get('/api/admin/platforms', authenticateAdmin, (req, res) => {
    const rows = db.prepare("SELECT DISTINCT platform FROM actors WHERE type = 'agent' AND platform IS NOT NULL AND deleted_at IS NULL").all();
    const knownPlatforms = ['zylos', 'openclaw', 'claude-code', 'codex', 'gemini-cli'];
    const activePlatforms = rows.map(r => r.platform);
    const platforms = [...new Set([...knownPlatforms, ...activePlatforms])];
    res.json({ platforms });
  });

  // Agent-facing: list other agents (public info only, excluding deleted)
  app.get('/api/agents', authenticateAgent, (req, res) => {
    const agents = db.prepare("SELECT id, username, display_name, avatar_url, capabilities, platform, online, last_seen_at FROM actors WHERE type = 'agent' AND (pending_approval = 0 OR pending_approval IS NULL) AND deleted_at IS NULL").all();
    res.json({
      agents: agents.map(a => ({
        agent_id: a.id, name: a.username, display_name: a.display_name, avatar_url: a.avatar_url || null,
        capabilities: JSON.parse(a.capabilities || '[]'),
        platform: a.platform || null,
        online: !!a.online, last_seen_at: a.last_seen_at,
      })),
    });
  });

  // Agent-facing: get info about a specific agent
  app.get('/api/agents/:name', authenticateAgent, (req, res) => {
    const agent = db.prepare("SELECT id, username, display_name, avatar_url, capabilities, platform, online, last_seen_at FROM actors WHERE type = 'agent' AND username = ? AND (pending_approval = 0 OR pending_approval IS NULL) AND deleted_at IS NULL").get(req.params.name);
    if (!agent) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({
      agent_id: agent.id, name: agent.username, display_name: agent.display_name, avatar_url: agent.avatar_url || null,
      capabilities: JSON.parse(agent.capabilities || '[]'),
      platform: agent.platform || null,
      online: !!agent.online, last_seen_at: agent.last_seen_at,
    });
  });

  // Update agent profile (name, avatar_url, platform) — accessible to any authenticated agent
  app.patch('/api/agents/:name', authenticateAgent, (req, res) => {
    const { name, display_name, avatar_url, platform } = req.body;
    const target = db.prepare("SELECT id FROM actors WHERE type = 'agent' AND username = ?").get(req.params.name);
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    const updates = [];
    const values = [];
    // Support both 'name' (new unified) and 'display_name' (legacy)
    const newName = name || display_name;
    if (newName !== undefined) {
      updates.push('username = ?'); values.push(newName);
      updates.push('display_name = ?'); values.push(newName);
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?'); values.push(avatar_url);
    }
    if (platform !== undefined) {
      updates.push('platform = ?'); values.push(platform);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'NO_FIELDS' });
    const now = Date.now();
    updates.push('updated_at = ?'); values.push(now); values.push(target.id);
    db.prepare(`UPDATE actors SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  });

  // Admin: update agent profile (by agent_id)
  app.patch('/api/admin/agents/:agent_id', authenticateAdmin, (req, res) => {
    const { display_name, avatar_url, platform } = req.body;
    const target = db.prepare("SELECT id FROM actors WHERE type = 'agent' AND id = ?").get(req.params.agent_id);
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    const updates = [];
    const values = [];
    if (display_name !== undefined) {
      updates.push('display_name = ?'); values.push(display_name);
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?'); values.push(avatar_url);
    }
    if (platform !== undefined) {
      updates.push('platform = ?'); values.push(platform);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'NO_FIELDS' });
    const now = Date.now();
    updates.push('updated_at = ?'); values.push(now); values.push(target.id);
    db.prepare(`UPDATE actors SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  });

  // Admin: upload agent avatar (by agent_id)
  app.post('/api/admin/agents/:agent_id/avatar', authenticateAdmin, avatarUpload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
    const target = db.prepare("SELECT id, avatar_url FROM actors WHERE type = 'agent' AND id = ?").get(req.params.agent_id);
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    if (target.avatar_url && target.avatar_url.includes('/uploads/avatars/')) {
      const filename = target.avatar_url.split('/uploads/avatars/').pop();
      if (filename) {
        const oldPath = path.join(AVATAR_DIR, filename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const now = Date.now();
    db.prepare('UPDATE actors SET avatar_url = ?, updated_at = ? WHERE id = ?').run(avatarUrl, now, target.id);
    res.json({ ok: true, avatar_url: avatarUrl });
  });

  // Upload agent avatar
  // Serve uploaded avatars statically (at both /uploads and /api/uploads for proxy compatibility).
  // Intentionally public (no auth): avatar images are referenced in <img src> tags across all
  // authenticated views. Requiring auth would break image loading. express.static already
  // prevents path traversal (resolves to absolute path within the uploads directory).
  app.use('/uploads', express.static(UPLOADS_ROOT));
  app.use('/api/uploads', express.static(UPLOADS_ROOT));

  app.post('/api/agents/:name/avatar', authenticateAgent, avatarUpload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
    const target = db.prepare("SELECT id, avatar_url FROM actors WHERE type = 'agent' AND username = ?").get(req.params.name);
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    // Delete old avatar file if it exists
    if (target.avatar_url && target.avatar_url.includes('/uploads/avatars/')) {
      const filename = target.avatar_url.split('/uploads/avatars/').pop();
      if (filename) {
        const oldPath = path.join(AVATAR_DIR, filename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const now = Date.now();
    db.prepare('UPDATE actors SET avatar_url = ?, updated_at = ? WHERE id = ?').run(avatarUrl, now, target.id);
    res.json({ ok: true, avatar_url: avatarUrl });
  });

  // ─── File Upload (general) ───────────────────────
  const FILES_DIR = path.join(UPLOADS_ROOT, 'files');
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

  const fileUploadStorage = multer({
    storage: multer.diskStorage({
      destination: FILES_DIR,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.bin';
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        cb(null, name);
      },
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.post('/api/uploads', authenticateAgent, fileUploadStorage.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
    const url = `/api/uploads/files/${req.file.filename}`;
    res.status(201).json({
      url,
      name: req.file.originalname,
      size: req.file.size,
      content_type: req.file.mimetype,
    });
  });

  // POST /api/uploads/thumbnails — upload slide thumbnail (user JWT allowed)
  const THUMBNAILS_DIR = path.join(UPLOADS_ROOT, 'thumbnails');
  if (!fs.existsSync(THUMBNAILS_DIR)) fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

  const thumbnailUploadStorage = multer({
    storage: multer.diskStorage({
      destination: THUMBNAILS_DIR,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        cb(null, name);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max per thumbnail
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only image files are allowed'));
    },
  });

  app.post('/api/uploads/thumbnails', authenticateAny, thumbnailUploadStorage.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
    const url = `/api/uploads/thumbnails/${req.file.filename}`;
    res.status(201).json({ url });
  });

    // GET /api/agent-skills — return skills package (no auth required, public)
  app.get('/api/agent-skills', (req, res) => {
    const aoseUrl = getPublicBaseUrl(req);
    const substitute = (text) => text.replace(/\{AOSE_URL\}/g, aoseUrl);
    const skillsDir = path.join(GATEWAY_DIR, '..', 'mcp-server', 'skills');
    const files = {};
    if (fs.existsSync(skillsDir)) {
      for (const f of fs.readdirSync(skillsDir)) {
        if (f.endsWith('.md')) {
          files[f] = substitute(fs.readFileSync(path.join(skillsDir, f), 'utf8'));
        }
      }
    }
    res.json({ skills: files });
  });

  // Admin: reset an agent's token
  app.post('/api/admin/agents/:agent_id/reset-token', authenticateAdmin, (req, res) => {
    const agent = db.prepare("SELECT * FROM actors WHERE id = ? AND type = 'agent'").get(req.params.agent_id);
    if (!agent) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found' });
    }
    const newToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashToken(newToken);
    db.prepare('UPDATE actors SET token_hash = ?, updated_at = ? WHERE id = ?')
      .run(newTokenHash, Date.now(), agent.id);
    res.json({
      agent_id: agent.id,
      name: agent.username,
      token: newToken,
      message: 'Token has been reset. The old token is now invalid.',
    });
  });

  // Agent/human: update own profile (display_name only)
  app.patch('/api/me/profile', authenticateAny, (req, res) => {
    const { display_name } = req.body;
    if (!display_name || typeof display_name !== 'string' || display_name.trim().length === 0) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'display_name required' });
    }
    db.prepare('UPDATE actors SET display_name = ?, updated_at = ? WHERE id = ?')
      .run(display_name.trim(), Date.now(), req.actor.id);
    const updated = db.prepare('SELECT id, type, username, display_name, avatar_url FROM actors WHERE id = ?').get(req.actor.id);
    res.json(updated);
  });

  // Admin: update agent profile (display_name only, username immutable)
  app.patch('/api/admin/agents/:agent_id', authenticateAdmin, (req, res) => {
    const agent = db.prepare("SELECT * FROM actors WHERE id = ? AND type = 'agent'").get(req.params.agent_id);
    if (!agent) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found' });
    }
    const { display_name } = req.body;
    if (!display_name || typeof display_name !== 'string' || display_name.trim().length === 0) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'display_name required' });
    }
    db.prepare('UPDATE actors SET display_name = ?, updated_at = ? WHERE id = ?')
      .run(display_name.trim(), Date.now(), agent.id);
    res.json({ agent_id: agent.id, name: agent.username, display_name: display_name.trim() });
  });

  // Note: file downloads are intentionally unauthenticated because avatar URLs
  // are used in <img> tags that can't send Authorization headers. Path traversal
  // is prevented by the startsWith check below. For sensitive file uploads,
  // consider a signed-URL approach in future.
  app.get('/api/uploads/files/:filename', (req, res) => {
    const filePath = path.join(FILES_DIR, req.params.filename);
    if (!filePath.startsWith(FILES_DIR)) return res.status(403).json({ error: 'FORBIDDEN' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'NOT_FOUND' });

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.mp4': 'video/mp4',
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.createReadStream(filePath).pipe(res);
  });
}
