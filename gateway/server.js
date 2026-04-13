#!/usr/bin/env node
/**
 * ASuite API Gateway
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
import { sseClients, humanClients, pushEvent, pushHumanEvent, deliverWebhook, pollComments } from './lib/sse.js';
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

// ─── Auth middleware ─────────────────────────────
const { authenticateAny, authenticateAdmin, authenticateAgent } = createAuthMiddleware(db, JWT_SECRET, ADMIN_TOKEN);

// ─── Content sync ────────────────────────────────
const { contentItemsUpsert, syncContentItems } = createContentSync(db);

// ─── Table engine (SQLite-backed, replaces Baserow) ──
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

// ─── Start ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[gateway] ASuite API Gateway listening on :${PORT}`);
  console.log(`[gateway] Admin token: ${ADMIN_TOKEN.slice(0, 8)}...`);
  console.log('[gateway] Content items managed by Gateway (no periodic sync)');
});

// ─── Cleanup ────────────────────────────────────
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
