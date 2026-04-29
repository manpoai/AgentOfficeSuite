#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const HOME_DIR = process.env.AOSE_HOME || path.join(os.homedir(), '.aose');
const RUNTIME_DIR = path.join(HOME_DIR, 'runtime');
const LOGS_DIR = path.join(HOME_DIR, 'logs');
const PID_FILE = path.join(HOME_DIR, 'service.pid');
const GATEWAY_LOG = path.join(LOGS_DIR, 'gateway.log');
const SHELL_LOG = path.join(LOGS_DIR, 'shell.log');
const GITHUB_REPO = 'manpoai/AgentOfficeSuite';
const FALLBACK_ARTIFACT_URL = `https://github.com/${GITHUB_REPO}/releases/download/v3.0.0/aose-runtime.tar.gz`;
let ARTIFACT_URL = process.env.AOSE_ARTIFACT_URL || FALLBACK_ARTIFACT_URL;

/** Fetch latest release artifact URL from GitHub API. Returns { url, version } or null. */
function fetchLatestRelease() {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      headers: { 'User-Agent': 'aose-bootstrap', Accept: 'application/vnd.github+json' },
    };
    https.get(opts, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const asset = (release.assets || []).find(a => a.name === 'aose-runtime.tar.gz');
          if (asset) {
            resolve({ url: asset.browser_download_url, version: release.tag_name });
          } else { resolve(null); }
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

const BOOTSTRAP_PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const BOOTSTRAP_VERSION = BOOTSTRAP_PKG.version || 'unknown';

function exists(p) { return fs.existsSync(p); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function assertSupportedNode() {
  const major = Number(process.versions.node.split('.')[0] || 0);
  if (!Number.isFinite(major) || major < 20 || major >= 25) {
    console.error(`Unsupported Node.js version: ${process.version}`);
    console.error('aose currently supports Node.js 20, 22, or 24 LTS.');
    process.exit(1);
  }
}

function download(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects while downloading runtime artifact.'));
          return;
        }
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(download(nextUrl, dest, redirectCount + 1));
        return;
      }
      if (status >= 400) {
        reject(new Error(`Download failed: ${status}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function ensureGatewayDeps() {
  const gatewayDir = path.join(RUNTIME_DIR, 'gateway');
  const marker = path.join(gatewayDir, 'node_modules', '.installed');
  if (exists(marker)) return;
  console.log('Installing aose gateway dependencies...');
  await run('npm', ['install', '--omit=dev'], gatewayDir);
  fs.writeFileSync(marker, new Date().toISOString());
}

async function ensureRuntime() {
  ensureDir(HOME_DIR);
  if (exists(path.join(RUNTIME_DIR, 'cli.js'))) return;
  if (!ARTIFACT_URL) {
    throw new Error('AOSE_ARTIFACT_URL is required for bootstrap package.');
  }
  const archive = path.join(HOME_DIR, 'aose-runtime.tar.gz');
  console.log('Downloading aose runtime...');
  await download(ARTIFACT_URL, archive);
  ensureDir(RUNTIME_DIR);
  await new Promise((resolve, reject) => {
    const p = spawn('tar', ['-xzf', archive, '-C', HOME_DIR], { stdio: 'inherit' });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)));
  });
  const extracted = path.join(HOME_DIR, 'aose-runtime');
  if (exists(extracted)) {
    fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
    fs.renameSync(extracted, RUNTIME_DIR);
  }
}

// ─── Service helpers ────────────────────────────────────

function readPidFile() {
  if (!exists(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function clearStalePid() {
  const pid = readPidFile();
  if (pid && !isAlive(pid)) {
    fs.unlinkSync(PID_FILE);
    return true;
  }
  return false;
}

function readRuntimeVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch { return null; }
}

async function fetchHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function tcpProbe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ─── Subcommands ────────────────────────────────────────

async function startForeground() {
  assertSupportedNode();
  await ensureRuntime();
  await ensureGatewayDeps();
  const runtimeCli = path.join(RUNTIME_DIR, 'cli.js');
  const child = spawn('node', [runtimeCli], {
    cwd: RUNTIME_DIR,
    stdio: 'inherit',
    env: { ...process.env, AOSE_HOME: HOME_DIR },
  });
  child.on('exit', (code) => process.exit(code || 0));
}

async function startBackground() {
  assertSupportedNode();
  const existing = readPidFile();
  if (existing && isAlive(existing)) {
    console.error(`aose is already running (pid ${existing}). Use \`stop\` first or \`restart\`.`);
    process.exit(1);
  }
  if (existing) clearStalePid();

  await ensureRuntime();
  await ensureGatewayDeps();
  ensureDir(LOGS_DIR);

  const out = fs.openSync(GATEWAY_LOG, 'a');
  const err = fs.openSync(GATEWAY_LOG, 'a');
  const runtimeCli = path.join(RUNTIME_DIR, 'cli.js');
  const child = spawn('node', [runtimeCli], {
    cwd: RUNTIME_DIR,
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, AOSE_HOME: HOME_DIR },
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`aose started in background (pid ${child.pid}).`);
  console.log(`Logs: ${GATEWAY_LOG}`);
  console.log(`Run \`aose status\` to check.`);
}

async function stopService() {
  const pid = readPidFile();
  if (!pid) {
    console.log('aose is not running (no pid file).');
    return;
  }
  if (!isAlive(pid)) {
    console.log(`Stale pid file (${pid} not alive). Cleaning up.`);
    fs.unlinkSync(PID_FILE);
    return;
  }
  console.log(`Stopping aose (pid ${pid})...`);
  try { process.kill(pid, 'SIGTERM'); } catch {}
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (isAlive(pid)) {
    console.warn('SIGTERM timeout, sending SIGKILL...');
    try { process.kill(pid, 'SIGKILL'); } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (exists(PID_FILE)) fs.unlinkSync(PID_FILE);
  console.log('aose stopped.');
}

async function restartService() {
  const pid = readPidFile();
  if (!pid) {
    console.error('aose is not running in background mode. `restart` only supports background mode.');
    console.error('Use `aose start -d` to start in background.');
    process.exit(1);
  }
  await stopService();
  await startBackground();
}

async function statusService() {
  const pid = readPidFile();
  const alive = isAlive(pid);
  console.log('aose Service');
  console.log(`  Status:    ${alive ? 'running' : 'stopped'}`);
  if (alive) console.log(`  PID:       ${pid}`);
  console.log(`  Bootstrap: ${BOOTSTRAP_VERSION}`);
  const rtVer = readRuntimeVersion();
  console.log(`  Runtime:   ${rtVer || '(not installed)'}`);
  console.log(`  Data dir:  ${HOME_DIR}`);

  if (alive) {
    const gwPort = Number(process.env.GATEWAY_PORT || 4000);
    const shPort = Number(process.env.PORT || 3000);
    const health = await fetchHealth(gwPort);
    const shellOk = await tcpProbe(shPort);
    console.log(`  Gateway:   http://localhost:${gwPort}  ${health ? '✓' : '✗'}${health ? ` (v${health.version})` : ''}`);
    console.log(`  Shell:     http://localhost:${shPort}  ${shellOk ? '✓' : '✗'}`);
  }
}

async function logsCommand(follow) {
  ensureDir(LOGS_DIR);
  if (!exists(GATEWAY_LOG)) {
    console.log(`No log file yet at ${GATEWAY_LOG}`);
    return;
  }
  if (follow) {
    const child = spawn('tail', ['-F', GATEWAY_LOG], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
  } else {
    const out = spawnSync('tail', ['-n', '200', GATEWAY_LOG], { encoding: 'utf8' });
    process.stdout.write(out.stdout || '');
  }
}

function versionCommand() {
  console.log(`Bootstrap: ${BOOTSTRAP_VERSION}`);
  const rtVer = readRuntimeVersion();
  console.log(`Runtime:   ${rtVer || '(not installed)'}`);
  if (rtVer && rtVer !== BOOTSTRAP_VERSION) {
    console.log(`Note: bootstrap and runtime versions differ. Run \`aose update\` to sync.`);
  }
}

async function updateCommand() {
  console.log('aose update');
  const currentVersion = readRuntimeVersion() || '(none)';
  console.log(`  Current runtime: ${currentVersion}`);

  // Dynamically resolve latest release unless user overrides via env
  if (!process.env.AOSE_ARTIFACT_URL) {
    const latest = await fetchLatestRelease();
    if (latest) {
      ARTIFACT_URL = latest.url;
      const latestVer = latest.version.replace(/^v/, '');
      if (currentVersion === latestVer) {
        console.log(`  Already on latest version (${latestVer}). Nothing to do.`);
        return;
      }
      console.log(`  Latest release:  ${latest.version}`);
    } else {
      console.log('  Could not fetch latest release from GitHub, using fallback URL.');
    }
  }

  console.log(`  Source:          ${ARTIFACT_URL}`);
  if (!process.argv.includes('--yes') && !process.argv.includes('-y')) {
    process.stdout.write('Proceed? [y/N] ');
    const answer = await new Promise((resolve) => {
      process.stdin.once('data', (d) => resolve(String(d).trim().toLowerCase()));
    });
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted.');
      return;
    }
  }

  const wasRunning = isAlive(readPidFile());
  if (wasRunning) {
    console.log('Stopping running service...');
    await stopService();
  }

  const backup = path.join(HOME_DIR, 'runtime.bak');
  if (exists(backup)) fs.rmSync(backup, { recursive: true, force: true });
  if (exists(RUNTIME_DIR)) {
    console.log('Backing up current runtime...');
    fs.renameSync(RUNTIME_DIR, backup);
  }

  try {
    console.log('Downloading and extracting new runtime...');
    await ensureRuntime();
    await ensureGatewayDeps();

    if (wasRunning) {
      console.log('Restarting service...');
      await startBackground();
      // health check window
      const gwPort = Number(process.env.GATEWAY_PORT || 4000);
      const deadline = Date.now() + 15_000;
      let healthy = false;
      while (Date.now() < deadline) {
        if (await fetchHealth(gwPort)) { healthy = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!healthy) throw new Error('Health check failed after update');
    }

    if (exists(backup)) fs.rmSync(backup, { recursive: true, force: true });
    console.log(`✓ Updated to ${readRuntimeVersion()}`);
  } catch (err) {
    console.error(`Update failed: ${err.message}`);
    console.error('Restoring previous runtime from backup...');
    if (exists(RUNTIME_DIR)) fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
    if (exists(backup)) fs.renameSync(backup, RUNTIME_DIR);
    if (wasRunning) {
      try { await startBackground(); } catch {}
    }
    console.error('RESTORED FROM BACKUP. Please report this at https://github.com/yingcaishen/aose/issues');
    process.exit(1);
  }
}

function helpCommand() {
  console.log(`aose ${BOOTSTRAP_VERSION}

Usage:
  aose                  Start in foreground (same as \`start\`)
  aose start            Start in foreground
  aose start -d         Start in background (writes ${PID_FILE})
  aose stop             Stop the background service
  aose restart          Restart the background service
  aose status           Show service status, version, health
  aose logs             Show last 200 lines of gateway log
  aose logs -f          Tail gateway log (Ctrl+C to exit)
  aose version          Show bootstrap and runtime versions
  aose update [-y]      Download latest runtime and restart
  aose help             Show this help

Data directory: ${HOME_DIR}
`);
}

// ─── Router ─────────────────────────────────────────────

async function main() {
  const sub = process.argv[2];
  switch (sub) {
    case undefined:
    case 'start':
      if (process.argv.includes('-d') || process.argv.includes('--daemon')) {
        return startBackground();
      }
      return startForeground();
    case 'stop':    return stopService();
    case 'restart': return restartService();
    case 'status':  return statusService();
    case 'logs':    return logsCommand(process.argv.includes('-f'));
    case 'version':
    case '-v':
    case '--version':
      return versionCommand();
    case 'update':  return updateCommand();
    case 'help':
    case '-h':
    case '--help':
      return helpCommand();
    default:
      console.error(`Unknown command: ${sub}`);
      helpCommand();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
