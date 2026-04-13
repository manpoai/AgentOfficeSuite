/**
 * Local config file for agentoffice-mcp.
 *
 * Single source of truth: ~/.agentoffice-mcp/config.json
 * Schema: { base_url: string, token: string }
 *
 * Loading order on startup:
 *   1. config file (if present)
 *   2. ASUITE_URL / ASUITE_TOKEN env vars (if file absent)
 *   3. error
 *
 * On first run with env vars but no file, the env values are migrated
 * to the file. After that the file is authoritative.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR = path.join(os.homedir(), '.agentoffice-mcp');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeConfig(patch) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const current = readConfig() || {};
  const next = { ...current, ...patch };
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  return next;
}

export function loadEffectiveConfig() {
  const fileCfg = readConfig();
  if (fileCfg && fileCfg.base_url && fileCfg.token) {
    return { base_url: fileCfg.base_url, token: fileCfg.token, source: 'file' };
  }

  const envUrl = process.env.ASUITE_URL;
  const envToken = process.env.ASUITE_TOKEN;
  if (envUrl && envToken) {
    try {
      writeConfig({ base_url: envUrl, token: envToken });
      return { base_url: envUrl, token: envToken, source: 'env-migrated' };
    } catch {
      return { base_url: envUrl, token: envToken, source: 'env' };
    }
  }

  const err = new Error(
    'AgentOffice MCP is not configured. Either:\n' +
    '  • Set ASUITE_URL and ASUITE_TOKEN environment variables, or\n' +
    '  • Run: npx agentoffice-mcp set-url <url> && npx agentoffice-mcp set-token <token>\n' +
    `Config file location: ${CONFIG_PATH}`
  );
  err.code = 'NOT_CONFIGURED';
  throw err;
}
