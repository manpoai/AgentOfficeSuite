#!/usr/bin/env node
/**
 * AOSE API Gateway
 * Implements Agent protocol v1: registration, docs, data, events
 */

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDatabase } from './lib/db.js';
import { genId, hashToken, hashPassword, verifyPassword } from './lib/utils.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { sseClients, humanClients, pushEvent, pushHumanEvent, deliverWebhook, pollComments, setSseDb } from './lib/sse.js';
import { createContentSync } from './lib/content-sync.js';
import { createTableEngine } from './lib/table-engine/index.js';

import authRoutes from './routes/auth.js';
import docsRoutes from './routes/docs.js';
import dataRoutes from './routes/data.js';
import contentRoutes from './routes/content.js';
import eventsRoutes from './routes/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.GATEWAY_PORT || 4000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ─── Database ────────────────────────────────────
const db = initDatabase(__dirname);
setSseDb(db);

// ─── Auth middleware ─────────────────────────────
const { authenticateAny, authenticateAdmin, authenticateAgent } = createAuthMiddleware(db, JWT_SECRET, ADMIN_TOKEN);

// ─── Content sync ────────────────────────────────
const { contentItemsUpsert, syncContentItems } = createContentSync(db);

// ─── Table engine (SQLite-backed) ──
const tableEngine = createTableEngine(db);

// ─── App ─────────────────────────────────────────
const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3101',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));

// ─── Health endpoint (no auth, used by `aose status`) ──
const GATEWAY_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch { return 'unknown'; }
})();
const STARTED_AT = Date.now();
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: GATEWAY_VERSION, uptime_ms: Date.now() - STARTED_AT });
});

// ─── Shared dependencies for route modules ──────
const shared = {
  express, db, JWT_SECRET, ADMIN_TOKEN,
  authenticateAny, authenticateAdmin, authenticateAgent,
  genId, hashToken, hashPassword, verifyPassword,
  contentItemsUpsert, syncContentItems, tableEngine,
  pushEvent, pushHumanEvent, deliverWebhook, sseClients, humanClients, pollComments,
};

// ─── Mount route modules ────────────────────────
authRoutes(app, shared);
docsRoutes(app, shared);
dataRoutes(app, shared);
contentRoutes(app, shared);
eventsRoutes(app, shared);

// ─── Events TTL cleanup ─────────────────────────
const EVENT_TTL_DAYS = parseInt(process.env.GATEWAY_EVENT_TTL_DAYS || '30', 10);
function cleanupDeliveredEvents() {
  try {
    const cutoff = Date.now() - EVENT_TTL_DAYS * 86400_000;
    const result = db.prepare('DELETE FROM events WHERE delivered = 1 AND occurred_at < ?').run(cutoff);
    if (result.changes > 0) {
      console.log(`[gateway] events TTL cleanup: removed ${result.changes} delivered events older than ${EVENT_TTL_DAYS}d`);
    }
  } catch (e) {
    console.warn(`[gateway] events TTL cleanup failed: ${e.message}`);
  }
}
setTimeout(cleanupDeliveredEvents, 60_000);
setInterval(cleanupDeliveredEvents, 24 * 3600 * 1000);

// ─── Start ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[gateway] AOSE API Gateway listening on :${PORT}`);
  console.log(`[gateway] Admin token: ${ADMIN_TOKEN.slice(0, 8)}...`);
  console.log('[gateway] Content items managed by Gateway (no periodic sync)');
});

// ─── Cleanup ────────────────────────────────────
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
