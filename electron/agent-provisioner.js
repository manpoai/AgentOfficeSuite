const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const AGENTS_DIR = path.join(os.homedir(), '.aose', 'agents');
const HOOKS_DIR = path.join(os.homedir(), '.aose', 'hooks');

class AgentProvisioner {
  constructor(gatewayPort, adminToken) {
    this.gatewayPort = gatewayPort;
    this.adminToken = adminToken;
  }

  async provision(platform) {
    const shortId = crypto.randomBytes(4).toString('hex');
    const agentName = `${platform}-${shortId}`;
    const agentDir = path.join(AGENTS_DIR, agentName);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    fs.mkdirSync(agentDir, { recursive: true });

    const registration = await this._registerLocal(agentName, platform, tokenHash);

    const mcpConfig = {
      mcpServers: {
        aose: {
          command: 'npx',
          args: ['-y', 'aose-mcp@latest'],
          env: {
            AOSE_GATEWAY: `http://127.0.0.1:${this.gatewayPort}`,
            AOSE_TOKEN: token,
          },
        },
      },
    };
    fs.writeFileSync(path.join(agentDir, '.mcp.json'), JSON.stringify(mcpConfig, null, 2));

    this._writeHookConfig(platform, agentName, agentDir);
    this._ensureHookScript(platform);

    return {
      agentId: registration.agent_id,
      agentName,
      agentDir,
      token,
      platform,
    };
  }

  _registerLocal(name, platform, tokenHash) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ name, platform, token_hash: tokenHash });
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.gatewayPort,
        path: '/api/agents/register-local',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.adminToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 201) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`register-local failed: ${res.statusCode} ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _writeHookConfig(platform, agentName, agentDir) {
    if (platform === 'claude-code') {
      const claudeDir = path.join(agentDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const settings = {
        hooks: {
          Stop: [{
            matcher: '',
            hooks: [{
              type: 'command',
              command: `AOSE_AGENT_NAME=${agentName} bash ~/.aose/hooks/stop-hook-claude-local.sh`,
            }],
          }],
        },
      };
      fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2));
    } else if (platform === 'codex') {
      const codexDir = path.join(agentDir, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      const config = `[hooks]\nstop = "AOSE_AGENT_NAME=${agentName} bash ~/.aose/hooks/stop-hook-codex-local.sh"\n`;
      fs.writeFileSync(path.join(codexDir, 'config.toml'), config);
    }
  }

  _ensureHookScript(platform) {
    fs.mkdirSync(HOOKS_DIR, { recursive: true });

    if (platform === 'claude-code' || platform === 'codex') {
      const scriptName = platform === 'claude-code' ? 'stop-hook-claude-local.sh' : 'stop-hook-codex-local.sh';
      const destPath = path.join(HOOKS_DIR, scriptName);

      if (!fs.existsSync(destPath)) {
        const srcPath = path.join(__dirname, 'lib', scriptName);
        fs.copyFileSync(srcPath, destPath);
        fs.chmodSync(destPath, 0o755);
      }
    }
  }

  listAgents() {
    if (!fs.existsSync(AGENTS_DIR)) return [];
    const dirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    return dirs.map(name => {
      const agentDir = path.join(AGENTS_DIR, name);
      const mcpPath = path.join(agentDir, '.mcp.json');
      let platform = 'unknown';
      let token = null;
      if (fs.existsSync(mcpPath)) {
        try {
          const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
          token = mcp.mcpServers?.aose?.env?.AOSE_TOKEN || null;
          if (name.startsWith('claude-code-')) platform = 'claude-code';
          else if (name.startsWith('codex-')) platform = 'codex';
          else if (name.startsWith('gemini-cli-')) platform = 'gemini-cli';
        } catch {}
      }
      return { agentName: name, agentDir, platform, token };
    });
  }

  removeAgent(agentName) {
    const agentDir = path.join(AGENTS_DIR, agentName);
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true });
    }
    const inboxFile = path.join(os.homedir(), '.aose', 'inbox', `${agentName}.jsonl`);
    if (fs.existsSync(inboxFile)) fs.unlinkSync(inboxFile);
  }
}

module.exports = { AgentProvisioner };
