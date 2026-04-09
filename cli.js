#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.AGENTOFFICE_HOME || path.join(os.homedir(), '.agentoffice');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const DATA_SUBDIR = path.join(DATA_DIR, 'data');
const UPLOADS_DIR = path.join(DATA_SUBDIR, 'uploads');
const DB_PATH = path.join(DATA_SUBDIR, 'gateway.db');

const REQUESTED_SHELL_PORT = Number(process.env.PORT || 3000);
const REQUESTED_GATEWAY_PORT = Number(process.env.GATEWAY_PORT || (REQUESTED_SHELL_PORT + 1000));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadOrCreateConfig() {
  ensureDir(DATA_SUBDIR);
  ensureDir(UPLOADS_DIR);
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  const config = {
    jwt_secret: crypto.randomBytes(32).toString('hex'),
    admin_password: crypto.randomBytes(16).toString('hex'),
    shell_port: REQUESTED_SHELL_PORT,
    gateway_port: REQUESTED_GATEWAY_PORT,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function isShellPortFree(port) {
  return isPortFree(port, '127.0.0.1');
}

async function isGatewayPortFree(port) {
  const ipv4 = await isPortFree(port, '0.0.0.0');
  if (!ipv4) return false;
  const ipv6 = await isPortFree(port, '::').catch(() => true);
  return ipv6;
}

async function findAvailablePort(startPort, maxAttempts = 50, checker = isPortFree) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await checker(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}`));
          return;
        }
        setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

function prefixLogs(child, name) {
  child.stdout?.on('data', (buf) => process.stdout.write(`[${name}] ${buf}`));
  child.stderr?.on('data', (buf) => process.stderr.write(`[${name}] ${buf}`));
}

async function main() {
  const config = loadOrCreateConfig();
  const shellPort = await findAvailablePort(REQUESTED_SHELL_PORT, 50, isShellPortFree);
  const gatewayPort = await findAvailablePort(REQUESTED_GATEWAY_PORT, 50, isGatewayPortFree);
  config.shell_port = shellPort;
  config.gateway_port = gatewayPort;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log('Starting AgentOffice...');

  let shuttingDown = false;
  const stopChildren = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    gateway.kill('SIGTERM');
    shell.kill('SIGTERM');
  };

  const gateway = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, 'gateway'),
    env: {
      ...process.env,
      PORT: String(gatewayPort),
      GATEWAY_PORT: String(gatewayPort),
      GATEWAY_DB_PATH: DB_PATH,
      JWT_SECRET: config.jwt_secret,
      ADMIN_PASSWORD: config.admin_password,
      UPLOADS_DIR,
      CORS_ORIGIN: `http://127.0.0.1:${shellPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  prefixLogs(gateway, 'gateway');

  const shellServer = path.join(__dirname, 'shell', '.next', 'standalone', 'server.js');
  const shell = spawn('node', [shellServer], {
    cwd: path.join(__dirname, 'shell', '.next', 'standalone'),
    env: {
      ...process.env,
      PORT: String(shellPort),
      HOSTNAME: '127.0.0.1',
      GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  prefixLogs(shell, 'shell');

  gateway.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`Gateway exited with code ${code}`);
      stopChildren();
      process.exit(code || 1);
    }
  });

  shell.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`Shell exited with code ${code}`);
      stopChildren();
      process.exit(code || 1);
    }
  });

  const shutdown = () => {
    stopChildren();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await waitForPort(gatewayPort);
  await waitForPort(shellPort);

  console.log('');
  console.log('AgentOffice is ready.');
  console.log(`URL: http://127.0.0.1:${shellPort}`);
  console.log(`Gateway: http://127.0.0.1:${gatewayPort}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log('');
  console.log('Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
