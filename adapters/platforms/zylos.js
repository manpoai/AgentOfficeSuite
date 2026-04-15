/**
 * Zylos platform plugin for AOSE Adapter.
 *
 * Delivers events to a Zylos agent by invoking the c4-receive.js CLI, which
 * writes the message into the agent's C4 comm-bridge inbox.
 *
 * Required config fields:
 *   zylos_dir       — the agent's ZYLOS_DIR (working dir)
 *   c4_receive_path — absolute path to c4-receive.js
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

export function init(config) {
  if (!config.zylos_dir) throw new Error('[zylos] config.zylos_dir is required');
  if (!config.c4_receive_path) throw new Error('[zylos] config.c4_receive_path is required');
  ensureAoseSkillsChannel();
}

// c4-validate.js requires ~/.claude/skills/<channel>/ to exist before it will
// accept a delivery on that channel. Without this dir, every c4-receive call
// with --channel aose fails on clean installs. Pre-create the placeholder so
// the AOSE doorbell path works out-of-box.
function ensureAoseSkillsChannel() {
  const dir = path.join(homedir(), '.claude', 'skills', 'aose');
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`[zylos] Created missing C4 skills channel dir: ${dir}`);
    }
    const skillFile = path.join(dir, 'SKILL.md');
    if (!existsSync(skillFile)) {
      writeFileSync(
        skillFile,
        '# aose\n\nPlaceholder channel for AOSE doorbell deliveries via c4-receive.\n',
      );
    }
  } catch (e) {
    console.error(`[zylos] Failed to ensure ~/.claude/skills/aose/: ${e.message}`);
  }
}

export function deliver(config, content) {
  return new Promise((resolve, reject) => {
    execFile('node', [
      config.c4_receive_path,
      '--channel', 'aose',
      '--content', content,
    ], {
      env: { ...process.env, ZYLOS_DIR: config.zylos_dir },
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
