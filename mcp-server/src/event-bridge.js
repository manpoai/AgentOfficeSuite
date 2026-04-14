/**
 * Event bridge: subscribes to gateway SSE, forwards events to the MCP host
 * via notifications/message (LoggingMessage). Handles reconnect, catchup,
 * and local dedup so the host sees each event exactly once.
 *
 * State file: ~/.agentoffice-mcp/state-<agent_id>.json
 *   { last_seen_timestamp: <ms> }
 *
 * Push modes (ASUITE_PUSH):
 *   sse  (default) — SSE + catchup-on-reconnect
 *   poll           — periodic catchup on a timer
 *   off            — no active bridge (still allows manual tool catchup)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STATE_DIR = path.join(os.homedir(), '.agentoffice-mcp');
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;
const DEDUP_CAPACITY = 1000;
const PERSIST_DEBOUNCE_MS = 200;
const POLL_DEFAULT_MS = 15_000;

export class EventBridge {
  constructor({ baseUrl, token, agentId, mcpServer, mode = 'sse', pollIntervalMs = POLL_DEFAULT_MS }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.agentId = agentId;
    this.mcpServer = mcpServer;
    this.mode = mode;
    this.pollIntervalMs = pollIntervalMs;
    this.statePath = path.join(STATE_DIR, `state-${agentId}.json`);
    this.lastSeen = this.loadState();
    this.dedupSet = new Map(); // id -> inserted-at (insertion order = LRU)
    this.reconnectDelay = RECONNECT_BASE_MS;
    this.abortController = null;
    this.persistTimer = null;
    this.pollTimer = null;
    this.closed = false;
    this.pendingCount = 0; // fallback hint counter (host-ignored notifications)
  }

  loadState() {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const s = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return s.last_seen_timestamp || 0;
    } catch {
      return 0;
    }
  }

  persistState() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        fs.writeFileSync(this.statePath, JSON.stringify({ last_seen_timestamp: this.lastSeen }));
      } catch (e) {
        console.error(`[bridge] state persist failed: ${e.message}`);
      }
    }, PERSIST_DEBOUNCE_MS);
  }

  flushState() {
    clearTimeout(this.persistTimer);
    try {
      fs.writeFileSync(this.statePath, JSON.stringify({ last_seen_timestamp: this.lastSeen }));
    } catch {}
  }

  // Returns the number of pending events the host has not explicitly consumed.
  // Tool wrappers can piggyback this onto responses as a fallback hint.
  takePendingHint() {
    const n = this.pendingCount;
    this.pendingCount = 0;
    return n;
  }

  async start() {
    if (this.mode === 'off') {
      console.error('[bridge] mode=off, event bridge disabled');
      return;
    }
    if (this.mode === 'poll') {
      console.error(`[bridge] mode=poll, interval=${this.pollIntervalMs}ms`);
      await this.runCatchup();
      this.pollTimer = setInterval(() => this.runCatchup().catch(() => {}), this.pollIntervalMs);
      return;
    }
    // Default: sse
    await this.runCatchup();
    this.connectSSE();
  }

  async runCatchup() {
    try {
      const url = `${this.baseUrl}/me/catchup?since=${this.lastSeen}&limit=100`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!res.ok) {
        console.error(`[bridge] catchup failed: HTTP ${res.status}`);
        return;
      }
      const body = await res.json();
      for (const evt of body.events || []) {
        this.handleEvent(evt, 'catchup');
      }
    } catch (e) {
      console.error(`[bridge] catchup error: ${e.message}`);
    }
  }

  async connectSSE() {
    if (this.closed) return;
    const url = `${this.baseUrl}/me/events/stream`;
    this.abortController = new AbortController();
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
        signal: this.abortController.signal,
      });
      if (!res.ok || !res.body) {
        console.error(`[bridge] SSE connect failed: HTTP ${res.status}`);
        this.scheduleReconnect();
        return;
      }
      console.error(`[bridge] SSE connected agent=${this.agentId}`);
      this.reconnectDelay = RECONNECT_BASE_MS;
      await this.readSseStream(res.body);
    } catch (e) {
      if (this.closed) return;
      console.error(`[bridge] SSE error: ${e.message}`);
    }
    if (!this.closed) this.scheduleReconnect();
  }

  async readSseStream(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          this.processSseFrame(chunk);
        }
      }
    } catch (e) {
      if (!this.closed) console.error(`[bridge] SSE read error: ${e.message}`);
    }
  }

  processSseFrame(frame) {
    const lines = frame.split('\n');
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith(':')) continue; // comment/heartbeat
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    try {
      const evt = JSON.parse(payload);
      this.handleEvent(evt, 'sse');
    } catch (e) {
      console.error(`[bridge] SSE parse error: ${e.message}`);
    }
  }

  scheduleReconnect() {
    if (this.closed) return;
    const delay = this.reconnectDelay;
    console.error(`[bridge] reconnect in ${delay}ms`);
    setTimeout(async () => {
      if (this.closed) return;
      await this.runCatchup();
      this.connectSSE();
    }, delay);
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
  }

  handleEvent(evt, source) {
    const id = evt.event_id || evt.id;
    if (!id) return;

    // Dedup (insertion-order Map acts as LRU by eviction)
    if (this.dedupSet.has(id)) return;
    this.dedupSet.set(id, Date.now());
    if (this.dedupSet.size > DEDUP_CAPACITY) {
      const oldestKey = this.dedupSet.keys().next().value;
      this.dedupSet.delete(oldestKey);
    }

    // Advance last_seen cursor
    const ts = evt.timestamp || evt.occurred_at || 0;
    if (ts > this.lastSeen) {
      this.lastSeen = ts;
      this.persistState();
    }

    this.pendingCount += 1;
    this.pushToHost(evt, source).catch(() => {});
  }

  async pushToHost(evt, source) {
    try {
      await this.mcpServer.server.sendLoggingMessage({
        level: 'info',
        logger: 'aose',
        data: {
          source: 'aose',
          delivery: source,
          event: evt,
        },
      });
      console.error(`[bridge] pushed event=${evt.event_id || evt.id} type=${evt.event || evt.type} via=${source}`);
    } catch (e) {
      console.error(`[bridge] host push failed: ${e.message}`);
    }
  }

  async stop() {
    this.closed = true;
    try { this.abortController?.abort(); } catch {}
    clearInterval(this.pollTimer);
    clearTimeout(this.persistTimer);
    this.flushState();
  }
}
