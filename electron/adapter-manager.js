const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const INBOX_DIR = path.join(os.homedir(), '.aose', 'inbox');

function writeInbox(agentName, content) {
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  const inboxPath = path.join(INBOX_DIR, `${agentName}.jsonl`);
  const line = JSON.stringify({ ts: Date.now(), content }) + '\n';
  fs.appendFileSync(inboxPath, line);
}

function translateEvent(event) {
  const poke = (eventType) =>
    `[AOSE] New unread event (${eventType}). ` +
    `Do NOT reply with text only. ` +
    `Immediately call get_unread_events NOW, then act on the ` +
    `context_payload (reply_to_comment / update_doc / etc.), ` +
    `then call ack_events. ` +
    `Any text-only response without these tool calls is incorrect — ` +
    `the user will see nothing until the tool calls actually run.`;

  switch (event.event) {
    case 'comment.mentioned':
    case 'comment.on_owned_content':
    case 'comment.replied':
    case 'comment.unresolved':
    case 'data.commented':
    case 'comment.mentioned_legacy':
    case 'doc.mentioned':
      return poke(event.event);
    case 'message.received': {
      const sender = event.payload?.sender?.name || 'someone';
      const preview = event.payload?.content?.slice(0, 100) || '';
      return `[AOSE] New chat message from ${sender}: "${preview}". ` +
        `Call get_unread_events to see the full message, then use send_message to reply, then call ack_events.`;
    }
    case 'agent.approved':
      return '[AOSE] Your registration has been approved. Call whoami, then get_unread_events to start.';
    case 'agent.rejected':
      return '[AOSE] Your registration has been rejected. Contact the workspace admin.';
    default:
      return null;
  }
}

class AdapterManager {
  constructor(gatewayPort) {
    this.gatewayPort = gatewayPort;
    this.connections = new Map();
    this.terminalWriter = null;
  }

  setTerminalWriter(fn) {
    this.terminalWriter = fn;
  }

  start(agentConfig) {
    const { agentId, agentName, agentToken, platform, agentDir } = agentConfig;
    if (this.connections.has(agentId)) return;

    const url = `http://127.0.0.1:${this.gatewayPort}/api/me/events/stream?token=${agentToken}`;
    this._connect(agentId, agentName, platform, agentDir, agentToken, url);
  }

  _connect(agentId, agentName, platform, agentDir, agentToken, url) {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
    };

    const req = http.get(options, (res) => {
      if (res.statusCode !== 200) {
        console.error(`[adapter] SSE connect failed for ${agentName}: ${res.statusCode}`);
        if (res.statusCode === 401 || res.statusCode === 403) {
          console.error(`[adapter] Auth failed for ${agentName}, stopping reconnect`);
          this.connections.delete(agentId);
          return;
        }
        this._scheduleReconnect(agentId, agentName, platform, agentDir, agentToken, url);
        return;
      }

      console.log(`[adapter] SSE connected for ${agentName}`);
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              this._handleEvent(agentId, agentName, platform, agentDir, event);
            } catch (e) {
              // ignore parse errors (heartbeat, etc.)
            }
          }
        }
      });

      res.on('end', () => {
        console.log(`[adapter] SSE disconnected for ${agentName}`);
        this._scheduleReconnect(agentId, agentName, platform, agentDir, agentToken, url);
      });

      res.on('error', (err) => {
        console.error(`[adapter] SSE error for ${agentName}:`, err.message);
        this._scheduleReconnect(agentId, agentName, platform, agentDir, agentToken, url);
      });
    });

    req.on('error', (err) => {
      console.error(`[adapter] SSE connect error for ${agentName}:`, err.message);
      this._scheduleReconnect(agentId, agentName, platform, agentDir, agentToken, url);
    });

    this.connections.set(agentId, { req, agentName, platform, agentDir, agentToken, url, reconnectTimer: null });
  }

  _scheduleReconnect(agentId, agentName, platform, agentDir, agentToken, url) {
    const entry = this.connections.get(agentId);
    if (!entry) return;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = setTimeout(() => {
      this._connect(agentId, agentName, platform, agentDir, agentToken, url);
    }, 3000);
  }

  _handleEvent(agentId, agentName, platform, agentDir, event) {
    const content = translateEvent(event);
    if (!content) return;

    if (platform === 'claude-code') {
      if (this.terminalWriter) {
        this.terminalWriter(agentName, content + '\n');
      }
      console.log(`[adapter] Event written to terminal for ${agentName}: ${event.event}`);
    } else if (platform === 'gemini-cli') {
      writeInbox(agentName, content);
      console.log(`[adapter] Event delivered to inbox for ${agentName}: ${event.event}`);
      if (agentDir) {
        const child = spawn('gemini', [
          '-p', 'You have a new AOSE event. Check your inbox by calling get_unread_events.',
          '--resume', 'latest',
          '--yolo',
        ], { cwd: agentDir, stdio: 'ignore', detached: true });
        child.unref();
        child.on('error', (err) => {
          console.error(`[adapter] gemini wake failed for ${agentName}: ${err.message}`);
        });
      }
    } else {
      writeInbox(agentName, content);
      console.log(`[adapter] Event delivered to inbox for ${agentName}: ${event.event}`);
    }
  }

  stop(agentId) {
    const entry = this.connections.get(agentId);
    if (!entry) return;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    if (entry.req) entry.req.destroy();
    this.connections.delete(agentId);
  }

  stopAll() {
    for (const [id] of this.connections) {
      this.stop(id);
    }
  }
}

module.exports = { AdapterManager };
