/**
 * Auth routes: login, register, agent management, avatars, file uploads
 */
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = path.dirname(__dirname);

// ─── Rate limiter for self-registration ─────────
const selfRegisterLimiter = new Map(); // IP → { count, resetTime }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

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

export default function authRoutes(app, { express, db, JWT_SECRET, ADMIN_TOKEN, authenticateAny, authenticateAdmin, authenticateAgent, genId, hashToken, hashPassword, verifyPassword, createBrUser, pushEvent }) {

  // ─── Shared: Avatar upload setup ─────────────────
  const AVATAR_DIR = path.join(GATEWAY_DIR, 'uploads', 'avatars');
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
    const avatarUrl = `/api/gateway/uploads/avatars/${req.file.filename}`;
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
    const { ticket, name, display_name, capabilities, webhook_url, webhook_secret } = req.body;
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

    db.prepare(`INSERT INTO actors (id, type, username, display_name, token_hash, capabilities, webhook_url, webhook_secret, created_at, updated_at)
      VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(agentId, name, display_name, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, now, now);

    // Mark ticket used
    db.prepare('UPDATE tickets SET used = 1 WHERE id = ?').run(ticket);

    // Create a Baserow user for this agent
    createBrUser(name, display_name).then(brPassword => {
      if (brPassword) {
        db.prepare('UPDATE actors SET br_password = ? WHERE id = ?').run(brPassword, agentId);
      }
    }).catch(e => console.warn(`[gateway] BR user creation failed: ${e.message}`));

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
    const { name, display_name, capabilities, webhook_url, webhook_secret } = req.body;
    if (!name || !display_name) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'name and display_name required' });
    }
    // Validate name format: lowercase, alphanumeric + hyphens
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
      return res.status(400).json({ error: 'INVALID_NAME', message: 'Name must be lowercase alphanumeric with hyphens, 2-31 chars' });
    }
    // Check name uniqueness
    const existingActor = db.prepare('SELECT id FROM actors WHERE username = ?').get(name);
    if (existingActor) {
      return res.status(409).json({ error: 'NAME_TAKEN', message: `Name "${name}" already registered` });
    }

    const agentId = genId('agt');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const now = Date.now();

    db.prepare(`INSERT INTO actors (id, type, username, display_name, token_hash, capabilities, webhook_url, webhook_secret, pending_approval, created_at, updated_at)
      VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(agentId, name, display_name, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, now, now);

    // Create Baserow user in advance (will only activate after approval)
    createBrUser(name, display_name).then(brPassword => {
      if (brPassword) {
        db.prepare('UPDATE actors SET br_password = ? WHERE id = ?').run(brPassword, agentId);
      }
    }).catch(e => console.warn(`[gateway] BR user creation failed: ${e.message}`));

    // Notify all human admins about new agent registration
    const admins = db.prepare("SELECT id FROM actors WHERE type = 'human' AND role = 'admin'").all();
    for (const admin of admins) {
      const notifId = genId('ntf');
      db.prepare(`INSERT INTO notifications (id, actor_id, target_actor_id, type, title, body, link, created_at)
        VALUES (?, ?, ?, 'agent_registered', ?, ?, ?, ?)`)
        .run(notifId, agentId, admin.id,
          `New agent "${display_name}" requests access`,
          `Agent "${name}" has registered and is pending approval.`,
          '/agents',
          now);
    }

    const skillsUrl = `${req.protocol}://${req.get('host')}/api/agent-skills`;
    res.status(201).json({
      agent_id: agentId,
      token,
      name,
      display_name,
      status: 'pending_approval',
      skills_url: skillsUrl,
      mcp_server: {
        install: 'npx -y asuite-mcp-server',
        env: { ASUITE_TOKEN: token, ASUITE_URL: `${req.protocol}://${req.get('host')}` },
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
        message: 'Your registration has been approved. You now have full access to ASuite.',
      },
    };
    db.prepare(`INSERT INTO events (id, agent_id, event_type, source, occurred_at, payload, created_at)
      VALUES (?, ?, 'agent.approved', 'system', ?, ?, ?)`)
      .run(approvalEvent.id, agent.id, approvalEvent.occurred_at, JSON.stringify(approvalEvent), now);
    if (pushEvent) pushEvent(agent.id, approvalEvent);

    res.json({ agent_id: agent.id, name: agent.username, status: 'approved' });
  });

  // Admin: list all agents
  app.get('/api/admin/agents', authenticateAdmin, (req, res) => {
    const agents = db.prepare("SELECT id, username, display_name, capabilities, online, last_seen_at, pending_approval, created_at FROM actors WHERE type = 'agent'").all();
    res.json({ agents: agents.map(a => ({ ...a, name: a.username, capabilities: JSON.parse(a.capabilities || '[]'), pending_approval: !!a.pending_approval })) });
  });

  // Agent-facing: list other agents (public info only)
  app.get('/api/agents', authenticateAgent, (req, res) => {
    const agents = db.prepare("SELECT id, username, display_name, avatar_url, capabilities, online, last_seen_at FROM actors WHERE type = 'agent' AND (pending_approval = 0 OR pending_approval IS NULL)").all();
    res.json({
      agents: agents.map(a => ({
        agent_id: a.id, name: a.username, display_name: a.display_name, avatar_url: a.avatar_url || null,
        capabilities: JSON.parse(a.capabilities || '[]'),
        online: !!a.online, last_seen_at: a.last_seen_at,
      })),
    });
  });

  // Agent-facing: get info about a specific agent
  app.get('/api/agents/:name', authenticateAgent, (req, res) => {
    const agent = db.prepare("SELECT id, username, display_name, avatar_url, capabilities, online, last_seen_at FROM actors WHERE type = 'agent' AND username = ? AND (pending_approval = 0 OR pending_approval IS NULL)").get(req.params.name);
    if (!agent) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({
      agent_id: agent.id, name: agent.username, display_name: agent.display_name, avatar_url: agent.avatar_url || null,
      capabilities: JSON.parse(agent.capabilities || '[]'),
      online: !!agent.online, last_seen_at: agent.last_seen_at,
    });
  });

  // Update agent profile (name, avatar_url) — accessible to any authenticated agent
  app.patch('/api/agents/:name', authenticateAgent, (req, res) => {
    const { name, display_name, avatar_url } = req.body;
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
    if (updates.length === 0) return res.status(400).json({ error: 'NO_FIELDS' });
    const now = Date.now();
    updates.push('updated_at = ?'); values.push(now); values.push(target.id);
    db.prepare(`UPDATE actors SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  });

  // Upload agent avatar
  // Serve uploaded avatars statically (at both /uploads and /api/uploads for proxy compatibility).
  // Intentionally public (no auth): avatar images are referenced in <img src> tags across all
  // authenticated views. Requiring auth would break image loading. express.static already
  // prevents path traversal (resolves to absolute path within the uploads directory).
  app.use('/uploads', express.static(path.join(GATEWAY_DIR, 'uploads')));
  app.use('/api/uploads', express.static(path.join(GATEWAY_DIR, 'uploads')));

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
    const avatarUrl = `/api/gateway/uploads/avatars/${req.file.filename}`;
    const now = Date.now();
    db.prepare('UPDATE actors SET avatar_url = ?, updated_at = ? WHERE id = ?').run(avatarUrl, now, target.id);
    res.json({ ok: true, avatar_url: avatarUrl });
  });

  // ─── File Upload (general) ───────────────────────
  const UPLOADS_DIR = path.join(GATEWAY_DIR, 'uploads', 'files');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const fileUploadStorage = multer({
    storage: multer.diskStorage({
      destination: UPLOADS_DIR,
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

    // GET /api/agent-skills — return skills package (no auth required, public)
  app.get('/api/agent-skills', (req, res) => {
    const skillsDir = path.join(GATEWAY_DIR, '..', 'mcp-server', 'skills');
    const files = {};
    if (fs.existsSync(skillsDir)) {
      for (const f of fs.readdirSync(skillsDir)) {
        if (f.endsWith('.md')) {
          files[f] = fs.readFileSync(path.join(skillsDir, f), 'utf8');
        }
      }
    }
    let onboardingPrompt = '';
    try {
      const promptPath = path.join(GATEWAY_DIR, '..', 'mcp-server', 'onboarding-prompt.md');
      onboardingPrompt = fs.readFileSync(promptPath, 'utf8');
      files['onboarding-prompt.md'] = onboardingPrompt;
    } catch {}
    res.json({ skills: files, onboarding_prompt: onboardingPrompt });
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
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    if (!filePath.startsWith(UPLOADS_DIR)) return res.status(403).json({ error: 'FORBIDDEN' });
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
