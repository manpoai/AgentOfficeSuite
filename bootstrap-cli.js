#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOME_DIR = process.env.AGENTOFFICE_HOME || path.join(os.homedir(), '.agentoffice');
const RUNTIME_DIR = path.join(HOME_DIR, 'runtime');
const ARTIFACT_URL = process.env.AGENTOFFICE_ARTIFACT_URL || 'https://github.com/manpoai/AgentOffice/releases/download/v1.0.2/agentoffice-runtime.tar.gz';

function exists(p) { return fs.existsSync(p); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

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

async function ensureRuntime() {
  ensureDir(HOME_DIR);
  if (exists(path.join(RUNTIME_DIR, 'cli.js'))) return;
  if (!ARTIFACT_URL) {
    throw new Error('AGENTOFFICE_ARTIFACT_URL is required for bootstrap package.');
  }
  const archive = path.join(HOME_DIR, 'agentoffice-runtime.tar.gz');
  console.log('Downloading AgentOffice runtime...');
  await download(ARTIFACT_URL, archive);
  ensureDir(RUNTIME_DIR);
  await new Promise((resolve, reject) => {
    const p = spawn('tar', ['-xzf', archive, '-C', HOME_DIR], { stdio: 'inherit' });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)));
  });
  const extracted = path.join(HOME_DIR, 'agentoffice-runtime');
  if (exists(extracted)) {
    fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
    fs.renameSync(extracted, RUNTIME_DIR);
  }
}

async function main() {
  await ensureRuntime();
  const runtimeCli = path.join(RUNTIME_DIR, 'cli.js');
  const child = spawn('node', [runtimeCli], {
    cwd: RUNTIME_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      AGENTOFFICE_HOME: HOME_DIR,
    },
  });
  child.on('exit', (code) => process.exit(code || 0));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
