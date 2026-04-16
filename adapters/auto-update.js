/**
 * Auto-update for agent-side npm packages (aose-adapter and aose-mcp).
 *
 * On startup + every CHECK_INTERVAL, queries the npm registry for the latest
 * version of each package. If a newer version exists, runs `npm install -g`
 * to update it. After updating aose-adapter (self), requests a pm2 restart
 * so the new code loads.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const PACKAGES = ['aose-mcp', 'aose-adapter'];
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── npm registry helpers ────────────────────────

/** Fetch latest version from npm registry. Returns version string or null. */
function fetchLatestVersion(packageName) {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${packageName}/latest`;
    https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'aose-adapter' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.version || null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/** Get locally installed version of a global npm package. Returns version string or null. */
async function getInstalledVersion(packageName) {
  try {
    // npm list -g --depth=0 --json gives installed global packages
    const { stdout } = await execFileAsync('npm', ['list', '-g', packageName, '--depth=0', '--json'], {
      timeout: 15000,
    });
    const data = JSON.parse(stdout);
    return data.dependencies?.[packageName]?.version || null;
  } catch {
    // Package not installed globally, try to read from npx cache or node_modules
    return null;
  }
}

/** Compare two semver strings. Returns true if remote > local. */
function isNewer(remote, local) {
  if (!remote || !local) return false;
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

// ─── Update logic ────────────────────────────────

/** Install a specific version of a package globally. */
async function installGlobal(packageName, version) {
  console.log(`[auto-update] Installing ${packageName}@${version} globally...`);
  try {
    const { stdout, stderr } = await execFileAsync('npm', ['install', '-g', `${packageName}@${version}`], {
      timeout: 120000, // 2 min timeout for npm install
    });
    if (stderr && !stderr.includes('npm warn')) {
      console.error(`[auto-update] npm stderr: ${stderr.trim()}`);
    }
    console.log(`[auto-update] ${packageName}@${version} installed successfully`);
    return true;
  } catch (e) {
    console.error(`[auto-update] Failed to install ${packageName}@${version}: ${e.message}`);
    return false;
  }
}

/** Request pm2 to restart the current adapter process. */
async function requestSelfRestart(agentName) {
  const pm2Name = `aose-adapter-${agentName}`;
  console.log(`[auto-update] Requesting pm2 restart for ${pm2Name}...`);
  try {
    await execFileAsync('pm2', ['restart', pm2Name], { timeout: 15000 });
  } catch (e) {
    // pm2 might not be managing us, or name might differ — try generic restart
    console.error(`[auto-update] pm2 restart ${pm2Name} failed: ${e.message}`);
    // Fallback: just exit, let pm2 auto-restart us
    console.log('[auto-update] Falling back to process.exit — pm2 should restart us');
    process.exit(0);
  }
}

// ─── Main check ──────────────────────────────────

/**
 * Check all packages for updates and install if newer.
 * Returns { updated: string[], checked: string[] }
 */
async function checkAndUpdate(agentName) {
  const result = { updated: [], checked: [], selfNeedsRestart: false };

  for (const pkg of PACKAGES) {
    const [latestVersion, installedVersion] = await Promise.all([
      fetchLatestVersion(pkg),
      getInstalledVersion(pkg),
    ]);

    result.checked.push(`${pkg}: installed=${installedVersion || 'unknown'}, latest=${latestVersion || 'unknown'}`);
    console.log(`[auto-update] ${pkg}: installed=${installedVersion || 'unknown'}, latest=${latestVersion || 'unknown'}`);

    if (!latestVersion) {
      console.log(`[auto-update] Could not fetch latest version for ${pkg}, skipping`);
      continue;
    }

    if (!installedVersion || isNewer(latestVersion, installedVersion)) {
      const ok = await installGlobal(pkg, latestVersion);
      if (ok) {
        result.updated.push(`${pkg}@${latestVersion}`);
        if (pkg === 'aose-adapter') {
          result.selfNeedsRestart = true;
        }
      }
    }
  }

  // Self-restart must be LAST — after all other packages are updated
  if (result.selfNeedsRestart) {
    console.log('[auto-update] aose-adapter was updated, restarting to load new code...');
    await requestSelfRestart(agentName);
  }

  return result;
}

// ─── Scheduler ───────────────────────────────────

let intervalHandle = null;

/**
 * Start the auto-update loop. Checks immediately, then every CHECK_INTERVAL.
 * @param {string} agentName — used for pm2 restart naming
 */
export function startAutoUpdate(agentName) {
  // Delay first check by 30s so the adapter has time to connect SSE first
  setTimeout(async () => {
    try {
      await checkAndUpdate(agentName);
    } catch (e) {
      console.error(`[auto-update] Check failed: ${e.message}`);
    }

    // Schedule periodic checks
    intervalHandle = setInterval(async () => {
      try {
        await checkAndUpdate(agentName);
      } catch (e) {
        console.error(`[auto-update] Periodic check failed: ${e.message}`);
      }
    }, CHECK_INTERVAL_MS);
  }, 30000);

  console.log(`[auto-update] Scheduled — first check in 30s, then every ${CHECK_INTERVAL_MS / 3600000}h`);
}

export function stopAutoUpdate() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
