const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const INBOX_DIR = path.join(os.homedir(), '.aose', 'inbox');
const STATE_DIR = path.join(os.homedir(), '.aose', 'adapter-state');

let _translateEvent = null;
async function loadTranslator() {
  if (!_translateEvent) {
    const mod = await import(path.join(__dirname, '..', 'adapters', 'event-translator.js'));
    _translateEvent = mod.translateEvent;
  }
  return _translateEvent;
}

function writeInbox(agentName, content) {
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  const inboxPath = path.join(INBOX_DIR, `${agentName}.jsonl`);
  const line = JSON.stringify({ ts: Date.now(), content }) + '\n';
  fs.appendFileSync(inboxPath, line);
}

function statePath(agentId) {
  return path.join(STATE_DIR, `${agentId}.json`);
}

function loadState(agentId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(agentId), 'utf8'));
  } catch { return { lastEventId: null }; }
}

function saveState(agentId, state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(statePath(agentId), JSON.stringify(state));
  } catch (e) { console.warn(`[adapter] state write failed for ${agentId}:`, e.message); }
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

  async start(agentConfig) {
    const { agentId, agentName, agentToken, platform, agentDir } = agentConfig;
    if (this.connections.has(agentId)) return;

    // Replay any events the agent missed while the App was closed BEFORE
    // opening the live SSE stream. Without this, every restart would lose
    // every event that arrived during downtime.
    try {
      await this._catchup(agentId, agentName, platform, agentDir, agentToken);
    } catch (e) {
      console.warn(`[adapter] catchup failed for ${agentName}:`, e.message);
    }

    const url = `http://127.0.0.1:${this.gatewayPort}/api/me/events/stream?token=${agentToken}`;
    this._connect(agentId, agentName, platform, agentDir, agentToken, url);
  }

  async _catchup(agentId, agentName, platform, agentDir, agentToken) {
    const state = loadState(agentId);
    const sinceParam = state.lastEventId ? `?since=${encodeURIComponent(state.lastEventId)}` : '?since=0';
    const url = `http://127.0.0.1:${this.gatewayPort}/api/me/events/catchup${sinceParam}`;
    return new Promise((resolve, reject) => {
      const req = http.get(url, { headers: { Authorization: `Bearer ${agentToken}` } }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c.toString(); });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return resolve(); // missing endpoint or auth — silently skip
          }
          try {
            const events = JSON.parse(body).events || [];
            for (const event of events) {
              this._handleEvent(agentId, agentName, platform, agentDir, event);
            }
            console.log(`[adapter] Catchup delivered ${events.length} events for ${agentName}`);
          } catch (e) { console.warn(`[adapter] catchup parse error for ${agentName}:`, e.message); }
          resolve();
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); resolve(); });
    });
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

  async _handleEvent(agentId, agentName, platform, agentDir, event) {
    const translate = await loadTranslator();
    const result = translate(event);
    if (!result) return;
    const content = result.content;

    writeInbox(agentName, content);
    console.log(`[adapter] Event delivered to inbox for ${agentName}: ${event.event}`);

    // Persist last-seen event id so that if the App is killed mid-stream,
    // the next launch's catchup picks up from here instead of "now".
    if (event.event_id) {
      saveState(agentId, { lastEventId: event.event_id, lastEventAt: Date.now() });
    }

    if (this.terminalWriter && platform === 'claude-code') {
      this.terminalWriter(agentName, 'you have a new AOSE event');
      setTimeout(() => this.terminalWriter(agentName, '\r'), 100);
    }

    if (platform === 'gemini-cli' && agentDir) {
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
