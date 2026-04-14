/**
 * Zylos platform plugin for AOSE Adapter.
 * Delivers events to a Zylos agent via C4 comm-bridge (c4-receive.js).
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Initialize Zylos platform — sets up symlink so c4-send.js can route replies.
 * @param {object} config  { zylos_dir, zylos_home, agent_name }
 * @param {string} adapterDir  Directory of this adapter's files (for symlink target)
 */
export function init(config, adapterDir) {
  const zylosDir = config.zylos_dir;
  const zylosHome = config.zylos_home;

  if (!zylosDir) throw new Error('[zylos] zylos_dir is required');

  const skillsDir = path.join(zylosDir, '.claude/skills');
  ensureChannelLink(skillsDir, adapterDir);
  ensureScriptsDir(adapterDir);

  return {
    c4Receive: path.join(zylosHome, '.claude/skills/comm-bridge/scripts/c4-receive.js'),
    zylosDir,
  };
}

/**
 * Deliver a message to the Zylos agent via C4.
 */
export function deliver(config, adapterDir, endpoint, content) {
  const zylosDir = config.zylos_dir;
  const zylosHome = config.zylos_home;
  const c4Receive = path.join(zylosHome, '.claude/skills/comm-bridge/scripts/c4-receive.js');

  return new Promise((resolve, reject) => {
    execFile('node', [
      c4Receive,
      '--channel', 'aose',
      '--endpoint', endpoint,
      '--content', content,
    ], {
      env: { ...process.env, ZYLOS_DIR: zylosDir },
      timeout: 10000,
    }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[zylos] c4-receive error: ${stderr || err.message}`);
        reject(err);
      } else {
        console.log(`[zylos] Injected to C4: ${stdout.trim()}`);
        resolve(stdout);
      }
    });
  });
}

function ensureChannelLink(skillsDir, adapterDir) {
  const linkPath = path.join(skillsDir, 'aose');
  try {
    const existing = fs.readlinkSync(linkPath);
    if (existing === adapterDir) return;
    fs.unlinkSync(linkPath);
  } catch {}
  try {
    fs.symlinkSync(adapterDir, linkPath);
    console.log(`[zylos] Installed channel link: ${linkPath} → ${adapterDir}`);
  } catch (e) {
    console.error(`[zylos] Failed to create channel link: ${e.message}`);
  }
}

function ensureScriptsDir(adapterDir) {
  const scriptsDir = path.join(adapterDir, 'scripts');
  const sendSrc = path.join(adapterDir, 'send.js');
  const sendDst = path.join(scriptsDir, 'send.js');
  if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
  if (!fs.existsSync(sendDst)) fs.symlinkSync(sendSrc, sendDst);
}
