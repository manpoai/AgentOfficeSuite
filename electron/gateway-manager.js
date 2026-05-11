const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');

function getRequiredModuleVersion(gatewayDir) {
  try {
    const nodePath = path.join(
      gatewayDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    );
    const buf = fs.readFileSync(nodePath);
    const str = buf.toString('utf-8', 0, Math.min(buf.length, 4096));
    const match = str.match(/node_modules.api_version=(\d+)/);
    if (match) return match[1];
  } catch {}
  return null;
}

function findSystemNode(gatewayDir) {
  const wantArch = process.arch;

  function checkNode(nodePath) {
    try {
      const out = execSync(`"${nodePath}" -p "process.arch+','+process.versions.modules"`, {
        encoding: 'utf-8', timeout: 3000,
      }).trim();
      const [arch, modules] = out.split(',');
      return { arch, modules, path: nodePath };
    } catch { return null; }
  }

  const requiredABI = getRequiredModuleVersion(gatewayDir);
  const candidates = [];

  // 1. Try `which node` — works from shell (dev mode).
  try {
    const found = execSync('which node', { encoding: 'utf-8' }).trim();
    if (found && fs.existsSync(found)) {
      const info = checkNode(found);
      if (info) candidates.push(info);
    }
  } catch {}

  // 2. Common install paths + all nvm versions.
  const dirs = [
    '/opt/homebrew/bin',
    '/opt/homebrew/opt/node/bin',
    '/usr/local/bin',
  ];
  if (process.env.HOME) {
    const nvmDir = path.join(process.env.HOME, '.nvm/versions/node');
    try {
      const versions = fs.readdirSync(nvmDir)
        .filter(v => v.startsWith('v'))
        .sort().reverse();
      for (const v of versions) {
        dirs.push(path.join(nvmDir, v, 'bin'));
      }
    } catch {}
    dirs.push(path.join(process.env.HOME, '.volta/bin'));
  }
  dirs.push('/usr/bin', '/bin');

  for (const dir of dirs) {
    const candidate = path.join(dir, 'node');
    try {
      if (!fs.existsSync(candidate)) continue;
      if (candidates.some(c => c.path === candidate)) continue;
      const info = checkNode(candidate);
      if (info) candidates.push(info);
    } catch {}
  }

  // Pick best: matching arch + matching ABI > matching arch > any
  const archMatch = candidates.filter(c => c.arch === wantArch);
  if (requiredABI) {
    const perfect = archMatch.find(c => c.modules === requiredABI);
    if (perfect) {
      console.log(`[gateway] Using Node ${perfect.path} (arch=${perfect.arch}, ABI=${perfect.modules})`);
      return perfect.path;
    }
  }
  if (archMatch.length > 0) {
    const best = archMatch[0];
    console.log(`[gateway] Using Node ${best.path} (arch=${best.arch}, ABI=${best.modules}, wanted ABI=${requiredABI})`);
    return best.path;
  }

  // 3. Last resort: Electron's own binary.
  console.log(`[gateway] No matching system Node found, using Electron binary`);
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
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Find a free port starting from `preferred`, walking up to `preferred + range`.
 * Returns the first available port. Throws if none are free in the range.
 */
async function findFreePort(preferred = 4000, range = 100) {
  for (let port = preferred; port < preferred + range; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port in range ${preferred}..${preferred + range}`);
}

function rebuildNativeModules(nodeBin, gatewayDir) {
  const sqlitePath = path.join(
    gatewayDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
  );
  const exists = fs.existsSync(sqlitePath);
  const requiredABI = exists ? getRequiredModuleVersion(gatewayDir) : null;
  try {
    const nodeABI = execSync(`"${nodeBin}" -p "process.versions.modules"`, {
      encoding: 'utf-8', timeout: 3000,
    }).trim();
    if (exists && requiredABI === nodeABI) return;
    const reason = exists
      ? `ABI mismatch: native module=${requiredABI}, node=${nodeABI}`
      : 'native module binary missing';
    console.log(`[gateway] ${reason}. Rebuilding better-sqlite3...`);
    const npmPath = path.join(path.dirname(nodeBin), 'npm');
    const npmBin = fs.existsSync(npmPath) ? npmPath : 'npm';
    execSync(`"${npmBin}" rebuild better-sqlite3`, {
      encoding: 'utf-8',
      timeout: 120000,
      cwd: gatewayDir,
      env: { ...process.env, PATH: `${path.dirname(nodeBin)}:${process.env.PATH}` },
    });
    console.log(`[gateway] better-sqlite3 rebuilt successfully for ABI ${nodeABI}`);
  } catch (e) {
    console.error(`[gateway] Failed to rebuild better-sqlite3: ${e.message}`);
  }
}

class GatewayManager {
  constructor() {
    this.process = null;
    this.port = 4000;
  }

  start(options = {}) {
    if (this.process) return;

    const electronGatewayPath = path.join(__dirname, '..', 'gateway');
    const gatewayDir = electronGatewayPath.includes('app.asar' + path.sep)
      ? electronGatewayPath.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
      : electronGatewayPath;
    this.port = options.port || 4000;

    const nodeBin = findSystemNode(gatewayDir);
    rebuildNativeModules(nodeBin, gatewayDir);
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
