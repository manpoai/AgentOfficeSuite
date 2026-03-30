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

export default function authRoutes(app, { express, db, JWT_SECRET, ADMIN_TOKEN, authenticateAny, authenticateAdmin, authenticateAgent, genId, hashToken, hashPassword, verifyPassword, createNcUser }) {

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
    // Check name uniqueness (both tables)
    const existing = db.prepare('SELECT id FROM agent_accounts WHERE name = ?').get(name);
    const existingActor = db.prepare('SELECT id FROM actors WHERE username = ?').get(name);
    if (existing || existingActor) {
      return res.status(409).json({ error: 'NAME_TAKEN', message: `Name "${name}" already registered` });
    }
    // Create agent
    const agentId = genId('agt');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const now = Date.now();

    db.prepare(`INSERT INTO agent_accounts (id, name, display_name, token_hash, capabilities, webhook_url, webhook_secret, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(agentId, name, display_name, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, now, now);

    // Also insert into actors table
    db.prepare(`INSERT OR IGNORE INTO actors (id, type, username, display_name, token_hash, capabilities, webhook_url, webhook_secret, created_at, updated_at) VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(agentId, name, display_name, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, now, now);

    // Mark ticket used
    db.prepare('UPDATE tickets SET used = 1 WHERE id = ?').run(ticket);

    // Create a Baserow user for this agent
    createNcUser(name, display_name).then(ncPassword => {
      if (ncPassword) {
        db.prepare('UPDATE agent_accounts SET nc_password = ? WHERE id = ?').run(ncPassword, agentId);
      }
    }).catch(e => console.warn(`[gateway] NC user creation failed: ${e.message}`));

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
  app.post('/api/agents/self-register', async (req, res) => {
    const { name, display_name, capabilities, webhook_url, webhook_secret } = req.body;
    if (!name || !display_name) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'name and display_name required' });
    }
    // Validate name format: lowercase, alphanumeric + hyphens
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
      return res.status(400).json({ error: 'INVALID_NAME', message: 'Name must be lowercase alphanumeric with hyphens, 2-31 chars' });
    }
    // Check name uniqueness (both tables)
    const existing = db.prepare('SELECT id FROM agent_accounts WHERE name = ?').get(name);
    const existingActor = db.prepare('SELECT id FROM actors WHERE username = ?').get(name);
    if (existing || existingActor) {
      return res.status(409).json({ error: 'NAME_TAKEN', message: `Name "${name}" already registered` });
    }

    const agentId = genId('agt');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const now = Date.now();

    db.prepare(`INSERT INTO agent_accounts (id, name, display_name, token_hash, capabilities, webhook_url, webhook_secret, created_at, updated_at, pending_approval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(agentId, name, display_name, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, now, now);

    // Also insert into actors table
    db.prepare(`INSERT OR IGNORE INTO actors (id, type, username, display_name, token_hash, capabilities, webhook_url, webhook_secret, created_at, updated_at) VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(agentId, name, display_name, tokenHash, JSON.stringify(capabilities || []),
        webhook_url || null, webhook_secret || null, now, now);

    // Create NC user in advance (will only activate after approval)
    createNcUser(name, display_name).then(ncPassword => {
      if (ncPassword) {
        db.prepare('UPDATE agent_accounts SET nc_password = ? WHERE id = ?').run(ncPassword, agentId);
      }
    }).catch(e => console.warn(`[gateway] NC user creation failed: ${e.message}`));

    res.status(201).json({
      agent_id: agentId,
      token,
      name,
      display_name,
      status: 'pending_approval',
      message: 'Registration received. Token is active but rate-limited until admin approval.',
      created_at: now,
    });
  });

  // Admin: approve a pending agent
  app.post('/api/admin/agents/:agent_id/approve', authenticateAdmin, (req, res) => {
    const agent = db.prepare('SELECT * FROM agent_accounts WHERE id = ?').get(req.params.agent_id);
    if (!agent) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found' });
    }
    db.prepare('UPDATE agent_accounts SET pending_approval = 0, updated_at = ? WHERE id = ?')
      .run(Date.now(), agent.id);
    res.json({ agent_id: agent.id, name: agent.name, status: 'approved' });
  });

  // Admin: list all agents
  app.get('/api/admin/agents', authenticateAdmin, (req, res) => {
    const agents = db.prepare('SELECT id, name, display_name, capabilities, online, last_seen_at, pending_approval, created_at FROM agent_accounts').all();
    res.json({ agents: agents.map(a => ({ ...a, capabilities: JSON.parse(a.capabilities || '[]'), pending_approval: !!a.pending_approval })) });
  });

  // Agent-facing: list other agents (public info only)
  app.get('/api/agents', authenticateAgent, (req, res) => {
    const agents = db.prepare('SELECT id, name, display_name, avatar_url, capabilities, online, last_seen_at FROM agent_accounts WHERE pending_approval = 0 OR pending_approval IS NULL').all();
    res.json({
      agents: agents.map(a => ({
        agent_id: a.id, name: a.name, display_name: a.display_name, avatar_url: a.avatar_url || null,
        capabilities: JSON.parse(a.capabilities || '[]'),
        online: !!a.online, last_seen_at: a.last_seen_at,
      })),
    });
  });

  // Agent-facing: get info about a specific agent
  app.get('/api/agents/:name', authenticateAgent, (req, res) => {
    const agent = db.prepare('SELECT id, name, display_name, avatar_url, capabilities, online, last_seen_at FROM agent_accounts WHERE name = ? AND (pending_approval = 0 OR pending_approval IS NULL)').get(req.params.name);
    if (!agent) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({
      agent_id: agent.id, name: agent.name, display_name: agent.display_name, avatar_url: agent.avatar_url || null,
      capabilities: JSON.parse(agent.capabilities || '[]'),
      online: !!agent.online, last_seen_at: agent.last_seen_at,
    });
  });

  // Update agent profile (display_name, avatar_url) — accessible to any authenticated agent
  app.patch('/api/agents/:name', authenticateAgent, (req, res) => {
    const { display_name, avatar_url } = req.body;
    const target = db.prepare('SELECT id FROM agent_accounts WHERE name = ?').get(req.params.name);
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    const updates = [];
    const values = [];
    if (display_name !== undefined) { updates.push('display_name = ?'); values.push(display_name); }
    if (avatar_url !== undefined) { updates.push('avatar_url = ?'); values.push(avatar_url); }
    if (updates.length === 0) return res.status(400).json({ error: 'NO_FIELDS' });
    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(target.id);
    db.prepare(`UPDATE agent_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  });

  // Upload agent avatar — stored in gateway's own uploads dir and served statically
  const AVATAR_DIR = path.join(GATEWAY_DIR, 'uploads', 'avatars');
  if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

  // Serve uploaded avatars statically (at both /uploads and /api/uploads for proxy compatibility)
  app.use('/uploads', express.static(path.join(GATEWAY_DIR, 'uploads')));
  app.use('/api/uploads', express.static(path.join(GATEWAY_DIR, 'uploads')));

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

  app.post('/api/agents/:name/avatar', authenticateAgent, avatarUpload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
    const target = db.prepare('SELECT id, avatar_url FROM agent_accounts WHERE name = ?').get(req.params.name);
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
    db.prepare('UPDATE agent_accounts SET avatar_url = ?, updated_at = ? WHERE id = ?').run(avatarUrl, Date.now(), target.id);
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
