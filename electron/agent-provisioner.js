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

  async provision(platform, permissions) {
    const shortId = crypto.randomBytes(4).toString('hex');
    const agentName = `${platform}-${shortId}`;
    const agentDir = path.join(AGENTS_DIR, agentName);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    fs.mkdirSync(agentDir, { recursive: true });

    let registration;
    try {
      registration = await this._registerLocal(agentName, platform, tokenHash);
    } catch (err) {
      fs.rmSync(agentDir, { recursive: true, force: true });
      throw err;
    }

    const mcpSrc = path.join(__dirname, '..', 'mcp-server').replace('app.asar', 'app.asar.unpacked');
    let mcpEntryPoint;

    if (platform === 'gemini-cli') {
      this._copyMcpServer(mcpSrc, agentDir);
      mcpEntryPoint = path.join(agentDir, 'mcp-server', 'src', 'index.js');
    } else {
      mcpEntryPoint = path.join(mcpSrc, 'src', 'index.js');
    }

    const mcpConfig = {
      mcpServers: {
        aose: {
          command: 'node',
          args: [mcpEntryPoint],
          env: {
            AOSE_URL: `http://127.0.0.1:${this.gatewayPort}/api`,
            AOSE_TOKEN: token,
          },
        },
      },
    };
    fs.writeFileSync(path.join(agentDir, '.mcp.json'), JSON.stringify(mcpConfig, null, 2));

    this._writeHookConfig(platform, agentName, agentDir, permissions);
    this._ensureHookScript(platform);
    this._writeAgentInstructions(platform, agentName, agentDir);
    this._copySkills(agentDir);

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

  _writeHookConfig(platform, agentName, agentDir, permissions) {
    if (platform === 'claude-code') {
      const claudeDir = path.join(agentDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const settings = {
        permissions: {
          allow: this._buildAllowList(permissions),
        },
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

  _buildAllowList(permissions) {
    const CATEGORY_TOOLS = {
      aose: ['mcp__aose__*'],
      files: ['Read(*)', 'Edit(*)', 'Write(*)', 'MultiEdit(*)'],
      shell: ['Bash(*)'],
      web: ['WebFetch(*)', 'WebSearch(*)'],
    };
    if (!permissions) {
      return [...CATEGORY_TOOLS.aose, ...CATEGORY_TOOLS.files, ...CATEGORY_TOOLS.shell];
    }
    const allow = [];
    for (const [catId, tools] of Object.entries(CATEGORY_TOOLS)) {
      if (permissions[catId] === 'always') {
        allow.push(...tools);
      }
    }
    return allow;
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

  _writeAgentInstructions(platform, agentName, agentDir) {
    const instructions = `# AOSE Agent — ${agentName}

You are an agent in an AOSE workspace (AgentOfficeSuite). You have MCP tools
available via the "aose" MCP server that let you interact with the workspace.

## Available MCP Tools

Use these tools to work in the workspace:

**Documents:** create_doc, read_doc, update_doc, list_docs, doc_append_section,
doc_replace_block, doc_delete_block, doc_insert_block_after

**Comments:** list_comments, comment_on_doc, reply_to_comment, resolve_comment

**Tables:** list_tables, create_table, describe_table, query_rows, insert_row,
update_row, delete_row, add_column, update_column

**Events:** get_unread_events, catchup_events, ack_events

**Search:** search_content, list_content_items

**Presentations:** create_presentation, list_slides, add_slide, read_slide,
insert_slide_element, update_slide_element

**Diagrams:** create_diagram, get_diagram, add_node, update_node, add_edge

**Messages:** send_message

**System:** whoami, get_agent_info, list_agents, update_profile

## Event Handling

When you see a message starting with \`[AOSE]\`, it is a notification doorbell.
Respond by:
1. Call \`catchup_events\` to get full event details
2. Act on the event (reply to comment, update doc, etc.)
3. Never reply with text only — always use the MCP tools

## Principles

- You are a peer in this workspace, not a subordinate service
- Act and produce results, don't ask for permission on every small step
- Keep replies short — do the thing, then say what you did briefly
- Use the workspace tools for all reads and writes
- Read the skills/ directory for detailed guides on each content type
`;

    if (platform === 'claude-code') {
      fs.writeFileSync(path.join(agentDir, 'CLAUDE.md'), instructions);
    } else if (platform === 'codex') {
      fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), instructions);
    } else if (platform === 'gemini-cli') {
      fs.writeFileSync(path.join(agentDir, 'GEMINI.md'), instructions);
    }
  }

  _copyMcpServer(mcpSrc, agentDir) {
    const dest = path.join(agentDir, 'mcp-server');
    fs.cpSync(mcpSrc, dest, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.includes('.git'),
    });
    const parentModules = path.join(mcpSrc, 'node_modules');
    if (fs.existsSync(parentModules)) {
      fs.cpSync(parentModules, path.join(dest, 'node_modules'), { recursive: true });
    }
  }

  _copySkills(agentDir) {
    const skillsSrc = path.join(__dirname, '..', 'mcp-server', 'skills').replace('app.asar', 'app.asar.unpacked');
    const skillsDest = path.join(agentDir, 'skills');
    if (!fs.existsSync(skillsSrc)) return;
    fs.mkdirSync(skillsDest, { recursive: true });
    for (const file of fs.readdirSync(skillsSrc)) {
      if (file.endsWith('.md')) {
        fs.copyFileSync(path.join(skillsSrc, file), path.join(skillsDest, file));
      }
    }
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
