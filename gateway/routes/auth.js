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
  return buildGenericOnboardingPrompt(platform, aoseUrl);
}

function buildGenericOnboardingPrompt(platform, aoseUrl) {
  return `Hi! You've been invited to join an aose workspace — a collaborative platform where humans and agents work together on documents, databases, and projects.

IMPORTANT — HTTP tooling: For every HTTP call in this prompt, use \`curl\`. Do NOT use Python urllib/requests, Node http, or any language-level HTTP client. curl ships on macOS and Linux and verifies TLS against the OS trust store, so it works across every environment. Language HTTP clients frequently fail on CA-bundle issues (especially Homebrew Python) — skip that class of problem entirely by using curl.

Step 1: Register your identity
Run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"your-agent-name","display_name":"Your Display Name","platform":"${platform}"}'

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
Pick a name that is lowercase alphanumeric with hyphens, 2-31 chars (e.g. "claw-main"). Then run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"<your-agent-name>","display_name":"<Your Display Name>","platform":"openclaw"}'

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

Step 6 — Start the adapter sidecar
Run the following shell command to start the adapter as a background process:

nohup npx -y aose-adapter --config ~/.aose/adapter-<your-agent-name>.json > ~/.aose/adapter-<your-agent-name>.log 2>&1 &

Wait 3 seconds, then read the first 30 lines of ~/.aose/adapter-<your-agent-name>.log. You should see lines like:
  [adapter] Starting — agent: ..., platform: openclaw, gateway: ...
  [adapter] SSE connected
  [openclaw] Gateway connected and authenticated

If instead you see "missing scope: operator.write", your local OpenClaw gateway is not configured to allow insecure auth. Open ~/.openclaw/openclaw.json and confirm gateway.controlUi.allowInsecureAuth is set to true; if not, add it and restart OpenClaw. Then retry this step.

If you see an EADDR or connection-refused error, your OpenClaw gateway may not be running on 127.0.0.1:18789 — verify with: lsof -nP -iTCP:18789 -sTCP:LISTEN

To make the adapter survive reboots, register it with a process manager (pm2, launchd, or systemd) pointing at the same command. The adapter must run continuously for AOSE to push events to you.

Step 7 — Configure the MCP server
Add the following to your MCP configuration (the location depends on your OpenClaw setup; typically it is the MCP servers list in your OpenClaw config):

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

Restart your MCP client (or OpenClaw) so the new MCP server is loaded. You should now see aose-prefixed tools available (whoami, reply_to_comment, create_doc, list_docs, etc.).

Step 8 — Verify end-to-end
Call the aose "whoami" tool. It should return your agent_id and name confirming AOSE sees you. If not, check that AOSE_TOKEN in the MCP config matches the token from Step 2, and that you have been approved.

Step 9 — Read your operating manual (REQUIRED before doing any work)
The aose-mcp server cached your operating skills to ~/.aose-mcp/skills/ when it started. These files are not optional reading — they describe how to behave as an AOSE agent: role and principles, typical tasks, platform overview, event handling, lifecycle, troubleshooting, output standards, and per-content-type guides (docs, comments, database, slides, flowcharts). The MCP host does not surface them automatically; you must read them yourself before responding to any AOSE event.

Run:
  ls ~/.aose-mcp/skills/

You should see numbered files (00-role-and-principles.md, 01-typical-tasks.md, ..., 06-output-standards.md) plus content-*.md guides. Read every file in order. If the directory is empty or missing, your aose-mcp server failed to fetch them — check its stderr output via your MCP host's logs and report the error; do not proceed.

These skills override any default assumptions you have about how to interact with documents, comments, or other agents. When in doubt during real work, re-read the relevant content-*.md file rather than guessing.

Once whoami succeeds AND you have read all skills, registration is complete. When someone @-mentions you on an AOSE document or task, the adapter will wake this chat session with a message describing the event, and you can reply to the AOSE comment using reply_to_comment.

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
Pick a name that is lowercase alphanumeric with hyphens, 2-31 chars (e.g. "zylos-newbie"). Then run:

  curl -sS -X POST ${aoseUrl}/agents/self-register \\
    -H "Content-Type: application/json" \\
    -d '{"name":"<your-agent-name>","display_name":"<Your Display Name>","platform":"zylos"}'

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
Add the following to your MCP configuration (typically ~/.mcp.json or the project's .mcp.json):

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

Restart your MCP client so the new server is loaded. You should now see aose-prefixed tools (whoami, reply_to_comment, create_doc, etc.).

Step 7 — Verify end-to-end
Call the aose "whoami" tool. It should return your agent_id and name confirming AOSE sees you. If not, check that AOSE_TOKEN matches the token from Step 2 and that you have been approved.

Step 8 — Read your operating manual (REQUIRED before doing any work)
The aose-mcp server cached your operating skills to ~/.aose-mcp/skills/ when it started. These files are not optional reading — they describe how to behave as an AOSE agent: role and principles, typical tasks, platform overview, event handling, lifecycle, troubleshooting, output standards, and per-content-type guides (docs, comments, database, slides, flowcharts). The MCP host does not surface them automatically; you must read them yourself before responding to any AOSE event.

Run:
  ls ~/.aose-mcp/skills/

You should see numbered files (00-role-and-principles.md, 01-typical-tasks.md, ..., 06-output-standards.md) plus content-*.md guides. Read every file in order. If the directory is empty or missing, your aose-mcp server failed to fetch them — check its stderr output via your MCP host's logs and report the error; do not proceed.

These skills override any default assumptions you have about how to interact with documents, comments, or other agents. When in doubt during real work, re-read the relevant content-*.md file rather than guessing.

Once whoami succeeds AND you have read all skills, registration is complete. When someone @-mentions you on an AOSE document or task, the adapter will wake this agent via the C4 comm-bridge, and you can reply using reply_to_comment.

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
    if (!name || !display_name) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'name and display_name required' });
    }
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
      .run(agentId, name, display_name, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, platform || null, now, now);

    // Notify all human admins about new agent registration
    const admins = db.prepare("SELECT id FROM actors WHERE type = 'human' AND role = 'admin'").all();
    for (const admin of admins) {
      insertNotification(db, { genId }, {
        actorId: agentId,
        targetActorId: admin.id,
        type: 'agent_registered',
        titleKey: 'serverNotifications.agent_registered.title',
        titleParams: { displayName: display_name },
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
      display_name,
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
  app.delete('/api/admin/agents/:agent_id', authenticateAdmin, (req, res) => {
    const agent = db.prepare("SELECT * FROM actors WHERE id = ? AND type = 'agent'").get(req.params.agent_id);
    if (!agent) return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found' });
    if (agent.deleted_at) return res.status(400).json({ error: 'ALREADY_DELETED', message: 'Agent is already deleted' });
    const now = Date.now();
    db.prepare('UPDATE actors SET deleted_at = ?, online = 0, updated_at = ? WHERE id = ?').run(now, now, agent.id);
    res.json({ agent_id: agent.id, name: agent.username, status: 'deleted' });
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
    const knownPlatforms = ['zylos', 'openclaw'];
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
