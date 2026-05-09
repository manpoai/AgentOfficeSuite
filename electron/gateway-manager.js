const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');

function findSystemNode() {
  // 1. Try `which node` with the inherited PATH — works when launched from
  //    a shell (dev mode: `npx electron`).
  try {
    const found = execSync('which node', { encoding: 'utf-8' }).trim();
    if (found && fs.existsSync(found)) return found;
  } catch { /* fall through */ }

  // 2. Try common install paths. macOS GUI launches inherit a minimal PATH
  //    (/usr/bin:/bin:...) without /usr/local/bin or /opt/homebrew/bin.
  const extraPath = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/opt/node/bin',
    process.env.HOME ? `${process.env.HOME}/.nvm/versions/node/v24/bin` : null,
    process.env.HOME ? `${process.env.HOME}/.volta/bin` : null,
    '/usr/bin',
    '/bin',
  ].filter(Boolean);
  for (const dir of extraPath) {
    const candidate = path.join(dir, 'node');
    try { if (fs.existsSync(candidate)) return candidate; } catch {}
  }

  // 3. Fall back to Electron's bundled Node (process.execPath +
  //    ELECTRON_RUN_AS_NODE=1). User doesn't need Node installed separately,
  //    but does require the gateway dir to be asar-unpacked since external
  //    Node has no way to read inside .asar — see asarUnpack in
  //    electron-builder.yml for the gateway/ rule.
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
    server.listen(port, '127.0.0.1');
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
