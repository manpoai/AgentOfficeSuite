#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
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
const REQUESTED_BASEROW_PORT = Number(process.env.BASEROW_PORT || 8280);
const REQUESTED_POSTGRES_PORT = Number(process.env.POSTGRES_PORT || 5433);
const BASEROW_CONTAINER_NAME = process.env.AGENTOFFICE_BASEROW_CONTAINER || 'agentoffice-baserow';
const BASEROW_IMAGE = process.env.AGENTOFFICE_BASEROW_IMAGE || 'baserow/baserow:1.29.2';
const POSTGRES_CONTAINER_NAME = process.env.AGENTOFFICE_POSTGRES_CONTAINER || 'agentoffice-postgres';
const POSTGRES_IMAGE = process.env.AGENTOFFICE_POSTGRES_IMAGE || 'postgres:16-alpine';
const REMOTE_ACCESS_STATUS = {
  NOT_READY: 'not_ready',
  CONFIGURING: 'configuring',
  READY: 'ready',
  FAILED: 'failed',
};
const REMOTE_ACCESS_MODE = {
  PUBLIC_TUNNEL: 'public_tunnel',
  PUBLIC_CUSTOM_DOMAIN: 'public_custom_domain',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureRemoteAccessConfig(config) {
  if (!config.remoteAccess) config.remoteAccess = {};
  if (!config.remoteAccess.status) config.remoteAccess.status = REMOTE_ACCESS_STATUS.NOT_READY;
  if (!('mode' in config.remoteAccess)) config.remoteAccess.mode = REMOTE_ACCESS_MODE.PUBLIC_TUNNEL;
  if (!('publicBaseUrl' in config.remoteAccess)) config.remoteAccess.publicBaseUrl = null;
  return config.remoteAccess;
}

function setRemoteAccessState(config, patch) {
  const remoteAccess = ensureRemoteAccessConfig(config);
  Object.assign(remoteAccess, patch);
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadOrCreateConfig() {
  ensureDir(DATA_SUBDIR);
  ensureDir(UPLOADS_DIR);
  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    ensureRemoteAccessConfig(config);
    if (process.env.PUBLIC_BASE_URL && !config.remoteAccess.publicBaseUrl) {
      config.remoteAccess.publicBaseUrl = process.env.PUBLIC_BASE_URL;
      config.remoteAccess.mode = REMOTE_ACCESS_MODE.PUBLIC_CUSTOM_DOMAIN;
      config.remoteAccess.status = REMOTE_ACCESS_STATUS.READY;
      saveConfig(config);
    }
    return config;
  }
  const config = {
    jwt_secret: crypto.randomBytes(32).toString('hex'),
    admin_password: process.env.ADMIN_PASSWORD || '123456',
    shell_port: REQUESTED_SHELL_PORT,
    gateway_port: REQUESTED_GATEWAY_PORT,
    remoteAccess: {
      status: process.env.PUBLIC_BASE_URL ? REMOTE_ACCESS_STATUS.READY : REMOTE_ACCESS_STATUS.NOT_READY,
      mode: process.env.PUBLIC_BASE_URL ? REMOTE_ACCESS_MODE.PUBLIC_CUSTOM_DOMAIN : REMOTE_ACCESS_MODE.PUBLIC_TUNNEL,
      publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
    },
  };
  saveConfig(config);
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

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(`COMMAND_NOT_FOUND:${command}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result.stdout?.trim() || '';
}

async function ensureDockerAvailable() {
  const installMessage = [
    'Docker Desktop is required for the full AgentOffice product.',
    'Please install Docker Desktop first:',
    'https://www.docker.com/products/docker-desktop/',
    '',
    '完整版本的 AgentOffice 需要 Docker Desktop。',
    '请先安装 Docker Desktop：',
    'https://www.docker.com/products/docker-desktop/',
  ].join('\n');

  const version = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  if (version.error && version.error.code === 'ENOENT') {
    throw new Error(installMessage);
  }
  if (version.status !== 0) {
    throw new Error((version.stderr || version.stdout || 'Failed to run docker --version').trim());
  }

  const info = spawnSync('docker', ['info'], { encoding: 'utf8' });
  if (info.status === 0) return;

  if (process.platform !== 'darwin') {
    throw new Error(installMessage);
  }

  const appCheck = spawnSync('open', ['-Ra', 'Docker'], { encoding: 'utf8' });
  if (appCheck.status !== 0) {
    throw new Error(installMessage);
  }

  console.log('Docker is installed but not running. Trying to start Docker Desktop...');
  console.log('检测到 Docker 已安装但未启动，正在尝试启动 Docker Desktop...');
  spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' });

  const start = Date.now();
  let lastLogAt = 0;
  while (Date.now() - start < 60000) {
    const retry = spawnSync('docker', ['info'], { encoding: 'utf8' });
    if (retry.status === 0) return;
    if (Date.now() - lastLogAt >= 5000) {
      const seconds = Math.floor((Date.now() - start) / 1000);
      console.log(`Waiting for Docker daemon... ${seconds}s`);
      console.log(`正在等待 Docker 启动完成... ${seconds}s`);
      lastLogAt = Date.now();
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }

  throw new Error([
    'Docker Desktop did not become ready within 60 seconds.',
    'Please open Docker Desktop manually, wait until it fully starts, then run npx agentoffice-main again.',
    '',
    'Docker Desktop 未能在 60 秒内完成启动。',
    '请手动打开 Docker Desktop，等其完全启动后，再重新执行 npx agentoffice-main。',
  ].join('\n'));
}

function ensureDockerContainer(name, runArgs, { recreate = false } = {}) {
  const existing = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
  const hasContainer = (existing.stdout || '').split('\n').includes(name);
  if (hasContainer && recreate) {
    runChecked('docker', ['rm', '-f', name]);
  }
  const stillExists = hasContainer && !recreate;
  if (!stillExists) {
    runChecked('docker', ['run', '-d', '--name', name, ...runArgs]);
    return;
  }
  const running = spawnSync('docker', ['ps', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
  const isRunning = (running.stdout || '').split('\n').includes(name);
  if (!isRunning) {
    runChecked('docker', ['start', name]);
  }
}

async function ensurePostgresContainer(postgresPort, config) {
  await ensureDockerAvailable();
  const dataDir = path.join(DATA_DIR, 'postgres-data');
  ensureDir(dataDir);
  if (!config.postgres) {
    config.postgres = {};
  }
  config.postgres.port = postgresPort;
  config.postgres.user = config.postgres.user || 'agentoffice';
  config.postgres.password = config.postgres.password || crypto.randomBytes(16).toString('hex');
  config.postgres.db = config.postgres.db || 'agentoffice';
  config.postgres.url = `postgresql://${config.postgres.user}:${config.postgres.password}@127.0.0.1:${postgresPort}/${config.postgres.db}`;

  ensureDockerContainer(POSTGRES_CONTAINER_NAME, [
    '-p', `${postgresPort}:5432`,
    '-v', `${dataDir}:/var/lib/postgresql/data`,
    '-e', `POSTGRES_USER=${config.postgres.user}`,
    '-e', `POSTGRES_PASSWORD=${config.postgres.password}`,
    '-e', `POSTGRES_DB=${config.postgres.db}`,
    POSTGRES_IMAGE,
  ]);
}

async function ensureBaserowContainer(baserowPort, config) {
  await ensureDockerAvailable();
  const dataDir = path.join(DATA_DIR, 'baserow-data');
  ensureDir(dataDir);
  ensureDir(path.join(dataDir, 'redis'));
  if (!config.baserow) {
    config.baserow = {};
  }
  config.baserow.port = baserowPort;
  config.baserow.url = `http://127.0.0.1:${baserowPort}`;
  config.baserow.email = config.baserow.email || 'admin@agentoffice.local';
  config.baserow.password = config.baserow.password || crypto.randomBytes(16).toString('hex');

  ensureDockerContainer(BASEROW_CONTAINER_NAME, [
    '-p', `${baserowPort}:80`,
    '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${dataDir}:/baserow/data`,
    '-e', `BASEROW_PUBLIC_URL=http://127.0.0.1:${baserowPort}`,
    '-e', `BASEROW_CADDY_ADDRESSES=:80`,
    '-e', `POSTGRESQL_HOST=host.docker.internal`,
    '-e', `POSTGRESQL_PORT=${config.postgres.port}`,
    '-e', `POSTGRESQL_USER=${config.postgres.user}`,
    '-e', `POSTGRESQL_PASSWORD=${config.postgres.password}`,
    '-e', `POSTGRESQL_DB=${config.postgres.db}`,
    '-e', `BASEROW_DEFAULT_ADMIN_EMAIL=${config.baserow.email}`,
    '-e', `BASEROW_DEFAULT_ADMIN_PASSWORD=${config.baserow.password}`,
    BASEROW_IMAGE,
  ]);
}

async function waitForHttpOk(url, timeoutMs = 120000) {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      await res.text().catch(() => {});
      if (res.ok) return;
    } catch {}
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed - lastLog >= 10) {
      console.log(`Waiting for service... (${elapsed}s) / 等待服务启动... (${elapsed}s)`);
      lastLog = elapsed;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function baserowRequest(config, method, pathName, body) {
  const res = await fetch(`${config.baserow.url}${pathName}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function ensureBaserowDatabase(config) {
  if (!config.baserow) throw new Error('Missing baserow config');
  let auth = await baserowRequest(config, 'POST', '/api/user/token-auth/', {
    email: config.baserow.email,
    password: config.baserow.password,
  });
  if (auth.status >= 400 || !auth.data?.access_token) {
    const signup = await baserowRequest(config, 'POST', '/api/user/', {
      name: 'AgentOffice Admin',
      email: config.baserow.email,
      password: config.baserow.password,
    });
    if (signup.status >= 400 && signup.data?.error !== 'ERROR_EMAIL_ALREADY_EXISTS') {
      throw new Error(`Failed to initialize Baserow admin user: ${JSON.stringify(signup.data)}`);
    }
    auth = await baserowRequest(config, 'POST', '/api/user/token-auth/', {
      email: config.baserow.email,
      password: config.baserow.password,
    });
  }
  if (auth.status >= 400 || !auth.data?.access_token) {
    throw new Error(`Failed to authenticate to Baserow: ${JSON.stringify(auth.data)}`);
  }
  const token = auth.data.access_token;
  const authedFetch = async (method, pathName, body) => {
    const res = await fetch(`${config.baserow.url}${pathName}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `JWT ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };

  const workspaces = await authedFetch('GET', '/api/workspaces/');
  if (workspaces.status >= 400) {
    throw new Error(`Failed to list Baserow workspaces: ${JSON.stringify(workspaces.data)}`);
  }
  const workspace = Array.isArray(workspaces.data) && workspaces.data.length > 0
    ? workspaces.data[0]
    : (await authedFetch('POST', '/api/workspaces/', { name: 'AgentOffice' })).data;
  if (!workspace?.id) {
    throw new Error('Failed to ensure Baserow workspace');
  }

  const applications = await authedFetch('GET', `/api/applications/workspace/${workspace.id}/`);
  if (applications.status >= 400) {
    throw new Error(`Failed to list Baserow applications: ${JSON.stringify(applications.data)}`);
  }
  const existingDatabase = Array.isArray(applications.data)
    ? applications.data.find(app => app.type === 'database')
    : null;
  if (existingDatabase?.id) {
    config.baserow.database_id = existingDatabase.id;
    return;
  }

  const created = await authedFetch('POST', `/api/applications/workspace/${workspace.id}/`, {
    name: 'AgentOffice',
    type: 'database',
  });
  if (created.status >= 400 || !created.data?.id) {
    throw new Error(`Failed to create Baserow database: ${JSON.stringify(created.data)}`);
  }
  config.baserow.database_id = created.data.id;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function detectCloudflared() {
  const result = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
  if (result.status === 0) {
    const version = (result.stdout || result.stderr || '').trim();
    return { installed: true, version };
  }
  return { installed: false, version: null };
}

async function installCloudflared() {
  if (process.platform === 'darwin') {
    console.log('Installing cloudflared via Homebrew...');
    console.log('正在通过 Homebrew 安装 cloudflared...');
    const child = spawnSync('brew', ['install', 'cloudflared'], {
      stdio: 'inherit',
      encoding: 'utf8',
    });
    if (child.status !== 0) {
      throw new Error('Failed to install cloudflared / cloudflared 安装失败');
    }
    console.log('cloudflared installed successfully. / cloudflared 安装成功。');
  } else {
    console.log('Please install cloudflared manually:');
    console.log('请手动安装 cloudflared：');
    console.log('  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    throw new Error('cloudflared not installed / cloudflared 未安装');
  }
}

async function startCloudflaredTunnel(shellPort) {
  const child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${shellPort}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Tunnel startup timed out (30s) / 隧道启动超时'));
    }, 30000);

    let output = '';
    const onData = (chunk) => {
      const text = chunk.toString();
      process.stderr.write(`[tunnel] ${text}`);
      output += text;
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve({ child, publicUrl: match[0] });
      }
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`cloudflared exited with code ${code}`));
    });
  });
}

async function healthCheckPublicUrl(publicUrl) {
  const url = `${publicUrl}/api/gateway/auth/me`;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url);
      if (res.status !== 404) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function configureRemoteAccess(config, shellPort) {
  // Skip if already configured (from env var or previous run)
  if (config.remoteAccess.publicBaseUrl && config.remoteAccess.status === REMOTE_ACCESS_STATUS.READY) {
    console.log(`Public URL already configured: ${config.remoteAccess.publicBaseUrl}`);
    console.log(`公网地址已配置：${config.remoteAccess.publicBaseUrl}`);
    return { tunnelChild: null };
  }

  console.log('');
  console.log('Choose remote access mode / 请选择远程访问方式：');
  console.log('1. Automatic public URL / 自动公网地址');
  console.log('2. Custom domain / 使用自定义域名');
  console.log('');
  const choice = await ask('> ');

  if (choice === '1') {
    // ── Automatic public URL ──
    const cf = detectCloudflared();
    if (cf.installed) {
      console.log(`Checking cloudflared... ✓ installed (${cf.version})`);
    } else {
      console.log('cloudflared is not installed. / cloudflared 未安装。');
      const install = await ask('Install cloudflared now? / 是否立即安装？ (Y/n) ');
      if (install.toLowerCase() === 'n') {
        console.log('Skipping remote access setup. / 跳过远程访问配置。');
        setRemoteAccessState(config, { status: REMOTE_ACCESS_STATUS.NOT_READY, mode: REMOTE_ACCESS_MODE.PUBLIC_TUNNEL });
        saveConfig(config);
        return { tunnelChild: null };
      }
      try {
        await installCloudflared();
      } catch (e) {
        console.error(e.message);
        setRemoteAccessState(config, { status: REMOTE_ACCESS_STATUS.FAILED, mode: REMOTE_ACCESS_MODE.PUBLIC_TUNNEL });
        saveConfig(config);
        return { tunnelChild: null };
      }
    }

    console.log('Starting tunnel... / 正在启动隧道...');
    try {
      const { child, publicUrl } = await startCloudflaredTunnel(shellPort);
      console.log(`Public URL obtained: ${publicUrl}`);
      console.log(`已获取公网地址：${publicUrl}`);

      console.log('Running health check... / 正在检查可达性...');
      const healthy = await healthCheckPublicUrl(publicUrl);
      if (healthy) {
        console.log('Health check passed. ✓');
      } else {
        console.log('Health check failed, but tunnel URL is saved. You can retry later.');
        console.log('健康检查未通过，但隧道地址已保存。稍后可重试。');
      }

      setRemoteAccessState(config, {
        status: REMOTE_ACCESS_STATUS.READY,
        mode: REMOTE_ACCESS_MODE.PUBLIC_TUNNEL,
        publicBaseUrl: publicUrl,
      });
      saveConfig(config);
      return { tunnelChild: child };
    } catch (e) {
      console.error(`Tunnel failed: ${e.message}`);
      console.error(`隧道启动失败：${e.message}`);
      setRemoteAccessState(config, { status: REMOTE_ACCESS_STATUS.FAILED, mode: REMOTE_ACCESS_MODE.PUBLIC_TUNNEL });
      saveConfig(config);
      return { tunnelChild: null };
    }
  } else if (choice === '2') {
    // ── Custom domain ──
    console.log('Setup guide / 配置教程: https://agentofficesuite.com/customdomain');
    console.log('');
    const urlInput = await ask('Enter your public URL / 输入公网地址 (https://...): ');
    if (!urlInput || !/^https:\/\//.test(urlInput)) {
      console.log('Invalid URL. Must start with https://');
      console.log('无效地址。必须以 https:// 开头。');
      setRemoteAccessState(config, { status: REMOTE_ACCESS_STATUS.FAILED, mode: REMOTE_ACCESS_MODE.PUBLIC_CUSTOM_DOMAIN });
      saveConfig(config);
      return { tunnelChild: null };
    }
    const normalized = urlInput.replace(/\/$/, '');

    console.log('Running health check... / 正在检查可达性...');
    const healthy = await healthCheckPublicUrl(normalized);
    if (healthy) {
      console.log('Health check passed. ✓');
    } else {
      console.log('Health check failed. The URL is saved — configure your reverse proxy and retry.');
      console.log('健康检查未通过。地址已保存，请配置反向代理后重试。');
      console.log('Setup guide / 配置教程: https://agentofficesuite.com/customdomain');
    }

    setRemoteAccessState(config, {
      status: healthy ? REMOTE_ACCESS_STATUS.READY : REMOTE_ACCESS_STATUS.FAILED,
      mode: REMOTE_ACCESS_MODE.PUBLIC_CUSTOM_DOMAIN,
      publicBaseUrl: normalized,
    });
    saveConfig(config);
    return { tunnelChild: null };
  } else {
    console.log('Invalid choice. Skipping remote access setup.');
    console.log('无效选择。跳过远程访问配置。');
    setRemoteAccessState(config, { status: REMOTE_ACCESS_STATUS.NOT_READY });
    saveConfig(config);
    return { tunnelChild: null };
  }
}

async function main() {
  const config = loadOrCreateConfig();
  ensureRemoteAccessConfig(config);
  const shellPort = await findAvailablePort(REQUESTED_SHELL_PORT, 50, isShellPortFree);
  const gatewayPort = await findAvailablePort(REQUESTED_GATEWAY_PORT, 50, isGatewayPortFree);
  const baserowPort = await findAvailablePort(REQUESTED_BASEROW_PORT, 50, isGatewayPortFree);
  const postgresPort = await findAvailablePort(REQUESTED_POSTGRES_PORT, 50, isGatewayPortFree);
  config.shell_port = shellPort;
  config.gateway_port = gatewayPort;
  config.baserow_port = baserowPort;
  config.postgres_port = postgresPort;
  await ensurePostgresContainer(postgresPort, config);
  await ensureBaserowContainer(baserowPort, config);
  saveConfig(config);

  console.log('Starting AgentOffice... / 正在启动 AgentOffice...');
  await waitForPort(postgresPort);
  await waitForHttpOk(`${config.baserow?.url || `http://127.0.0.1:${baserowPort}`}/api/_health/`);
  await ensureBaserowDatabase(config);
  saveConfig(config);

  let shuttingDown = false;
  let tunnelChild = null;
  const stopChildren = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (tunnelChild) tunnelChild.kill('SIGTERM');
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
      PUBLIC_BASE_URL: config.remoteAccess?.publicBaseUrl || '',
      BASEROW_URL: config.baserow.url,
      BASEROW_EMAIL: config.baserow.email,
      BASEROW_PASSWORD: config.baserow.password,
      BASEROW_DATABASE_ID: String(config.baserow.database_id || ''),
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
    if (!shuttingDown) {
      console.error(`Gateway exited unexpectedly (code ${code})`);
      stopChildren();
      process.exit(code || 1);
    }
  });

  shell.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`Shell exited unexpectedly (code ${code})`);
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

  // ── Remote access setup (interactive) ──
  const result = await configureRemoteAccess(config, shellPort);
  tunnelChild = result.tunnelChild;

  // Monitor tunnel process
  if (tunnelChild) {
    tunnelChild.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(`Tunnel process exited unexpectedly (code ${code}). Remote access may be interrupted.`);
        console.error('隧道进程异常退出。远程访问可能中断。');
        setRemoteAccessState(config, { status: REMOTE_ACCESS_STATUS.FAILED });
        saveConfig(config);
      }
    });
  }

  // ── Final output ──
  console.log('');
  if (config.remoteAccess.status === REMOTE_ACCESS_STATUS.READY && config.remoteAccess.publicBaseUrl) {
    console.log('AgentOffice is ready. / AgentOffice 已就绪。');
    console.log(`Local URL / 本地地址: http://127.0.0.1:${shellPort}`);
    console.log(`Public URL / 公网地址: ${config.remoteAccess.publicBaseUrl}`);
  } else {
    console.log('Remote access is not ready yet. / 远程访问尚未就绪。');
    console.log('Continue setup in the browser: / 请通过本地地址进入系统继续配置：');
    console.log(`Local URL / 本地地址: http://127.0.0.1:${shellPort}`);
  }
  console.log(`Data dir: ${DATA_DIR}`);
  console.log('Default admin credentials / 默认管理员账号：');
  console.log('  username: admin');
  console.log(`  password: ${config.admin_password}`);
  console.log('');
  console.log('Press Ctrl+C to stop.');

  // Keep the event loop alive — child pipes normally do this, but
  // ensure the process never silently exits while children run.
  process.stdin.resume();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
