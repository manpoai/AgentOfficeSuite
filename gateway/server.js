#!/usr/bin/env node
/**
 * ASuite API Gateway
 * Implements Agent protocol v1: registration, docs, data, events
 */

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import { BR_EMAIL, BR_PASSWORD, BR_DATABASE_ID } from './baserow.js';
import { initDatabase } from './lib/db.js';
import { genId, hashToken, hashPassword, verifyPassword } from './lib/utils.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { sseClients, pushEvent, deliverWebhook, pollComments } from './lib/sse.js';
import { createContentSync } from './lib/content-sync.js';

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

// Baserow doesn't need per-agent users
async function createBrUser(agentName, displayName) {
  console.log(`[gateway] Agent ${agentName} registered (Baserow mode — no per-agent DB user needed)`);
  return null;
}

// ─── App ─────────────────────────────────────────
const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3101',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));

// ─── Shared dependencies for route modules ──────
const shared = {
  express, db, JWT_SECRET, ADMIN_TOKEN, BR_EMAIL, BR_PASSWORD, BR_DATABASE_ID,
  authenticateAny, authenticateAdmin, authenticateAgent,
  genId, hashToken, hashPassword, verifyPassword,
  createBrUser, contentItemsUpsert, syncContentItems,
  pushEvent, deliverWebhook, sseClients, pollComments,
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
