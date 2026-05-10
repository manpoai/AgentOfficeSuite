const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');

function findSystemNode() {
  // Gateway's native modules (better-sqlite3) are compiled against system
  // Node's ABI, NOT Electron's. We must find a system Node whose arch
  // matches the machine (process.arch from Electron = correct arch).
  const wantArch = process.arch; // arm64 or x64

  function checkArch(nodePath) {
    try {
      const arch = execSync(`"${nodePath}" -p process.arch`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      return arch === wantArch;
    } catch { return false; }
  }

  // 1. Try `which node` — works when launched from shell (dev mode).
  try {
    const found = execSync('which node', { encoding: 'utf-8' }).trim();
    if (found && fs.existsSync(found) && checkArch(found)) return found;
  } catch { /* fall through */ }

  // 2. Try common install paths. macOS GUI launches inherit a minimal PATH.
  //    Scan nvm versions directory for any matching-arch Node.
  const extraPath = [
    '/opt/homebrew/bin',
    '/opt/homebrew/opt/node/bin',
    '/usr/local/bin',
  ].filter(Boolean);

  if (process.env.HOME) {
    const nvmDir = path.join(process.env.HOME, '.nvm/versions/node');
    try {
      const versions = fs.readdirSync(nvmDir)
        .filter(v => v.startsWith('v'))
        .sort().reverse();
      for (const v of versions) {
        extraPath.push(path.join(nvmDir, v, 'bin'));
      }
    } catch { /* nvm not installed */ }
    extraPath.push(path.join(process.env.HOME, '.volta/bin'));
  }

  extraPath.push('/usr/bin', '/bin');

  for (const dir of extraPath) {
    const candidate = path.join(dir, 'node');
    try {
      if (fs.existsSync(candidate) && checkArch(candidate)) return candidate;
    } catch {}
  }

  // 3. Last resort: Electron's own binary. Native modules may ABI-mismatch
  //    but at least the arch will be correct.
  return process.execPath;
}

/**
 * Probe whether a TCP port is free on 127.0.0.1.
 * Resolves true if the bind succeeds and the listener closes cleanly.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    // Bind to 0.0.0.0 (all interfaces) — matches how gateway/express listens
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Find a free port starting from `preferred`, walking up to `preferred + range`.
 * Returns the first available port. Throws if none are free in the range.
 */
async function findFreePort(preferred = 4000, range = 100) {
  for (let port = preferred; port < preferred + range; port++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port in range ${preferred}..${preferred + range}`);
}

class GatewayManager {
  constructor() {
    this.process = null;
    this.port = 4000;
  }

  start(options = {}) {
    if (this.process) return;

    // In packaged App, electron-builder asarUnpack copies gateway/** into
    // <Resources>/app.asar.unpacked/gateway/ — that's where the actual JS files
    // live (the .asar copy is a stale stub that external node can't read).
    // __dirname in packaged builds points inside app.asar; replace asar segment
    // with asar.unpacked to get the real on-disk path.
    const electronGatewayPath = path.join(__dirname, '..', 'gateway');
    const gatewayDir = electronGatewayPath.includes('app.asar' + path.sep)
      ? electronGatewayPath.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
      : electronGatewayPath;
    this.port = options.port || 4000;

    const nodeBin = findSystemNode();
    // If we're using Electron's own binary as Node, we MUST set
    // ELECTRON_RUN_AS_NODE=1 so it skips Electron init and behaves as a Node
    // interpreter. process.execPath includes "Electron" or the productName
    // when packaged.
    const usingElectronAsNode = nodeBin === process.execPath;
    this.process = spawn(nodeBin, [path.join(gatewayDir, 'server.js')], {
      env: {
        ...process.env,
        ...(usingElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        GATEWAY_PORT: String(this.port),
        GATEWAY_DB_PATH: options.dbPath,
        UPLOADS_DIR: options.uploadsDir,
        JWT_SECRET: options.jwtSecret,
        ADMIN_TOKEN: options.adminToken,
        ADMIN_PASSWORD: options.adminPassword || 'admin',
        CORS_ORIGIN: options.corsOrigin || '*',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (data) => {
      console.log(`[gateway] ${data.toString().trim()}`);
    });

    this.process.stderr.on('data', (data) => {
      console.error(`[gateway] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      console.log(`[gateway] exited with code ${code}`);
      this.process = null;
    });
  }

  waitReady(timeout = 15000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - start > timeout) {
          return reject(new Error('Gateway startup timeout'));
        }
        const req = http.get(`http://127.0.0.1:${this.port}/api/health`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            setTimeout(check, 300);
          }
        });
        req.on('error', () => setTimeout(check, 300));
        req.setTimeout(2000, () => { req.destroy(); setTimeout(check, 300); });
      };
      check();
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.process) return resolve();

      const timeout = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(timeout);
        this.process = null;
        resolve();
      });

      this.process.kill('SIGTERM');
    });
  }
}

module.exports = { GatewayManager, findFreePort, isPortFree };
