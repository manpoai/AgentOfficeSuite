const { app, BrowserWindow, shell, ipcMain, crashReporter } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const log = require('electron-log/main');
const { GatewayManager, findFreePort } = require('./gateway-manager');
const { TerminalManager } = require('./terminal-manager');
const { AdapterManager } = require('./adapter-manager');
const { AgentProvisioner } = require('./agent-provisioner');
const { setupTray } = require('./tray');
const { setupUpdater } = require('./updater');

const DATA_DIR = path.join(app.getPath('home'), '.aose');
const DATA_SUBDIR = path.join(DATA_DIR, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const DB_PATH = path.join(DATA_SUBDIR, 'gateway.db');
const UPLOADS_DIR = path.join(DATA_SUBDIR, 'uploads');
const LOGS_DIR = path.join(DATA_DIR, 'logs');

// Wire electron-log: route console.* calls into ~/.aose/logs/main.log so users
// can attach a log file to bug reports without us asking them to run from a terminal.
fs.mkdirSync(LOGS_DIR, { recursive: true });
log.transports.file.resolvePathFn = () => path.join(LOGS_DIR, 'main.log');
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB rotation
Object.assign(console, log.functions);

// Crash reporter — collect minidumps locally; without an upload URL they just
// stay on disk in app.getPath('crashDumps'), which the user can grab manually.
try {
  crashReporter.start({ submitURL: '', uploadToServer: false, compress: true, productName: 'AOSE' });
} catch (e) { console.warn('[app] crashReporter init failed:', e.message); }

const gateway = new GatewayManager();
const terminalManager = new TerminalManager();
let adapterManager = null;
let provisioner = null;
let mainWindow = null;

function ensureDataDir() {
  for (const dir of [DATA_DIR, DATA_SUBDIR, UPLOADS_DIR, LOGS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function loadOrCreateConfig() {
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }
  let dirty = false;
  if (!config.jwt_secret) { config.jwt_secret = crypto.randomBytes(32).toString('hex'); dirty = true; }
  if (!config.admin_token) { config.admin_token = crypto.randomBytes(32).toString('hex'); dirty = true; }
  if (!config.gateway_port) { config.gateway_port = 4000; dirty = true; }
  if (dirty) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  }
  return config;
}

function createWindow(port, config) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.webContents.on('dom-ready', () => {
    const adminToken = JSON.stringify(config.admin_token);
    mainWindow.webContents.executeJavaScript(
      `window.__AOSE_ADMIN_TOKEN__ = ${adminToken};`
    );
    if (process.platform === 'darwin') {
      mainWindow.webContents.executeJavaScript(
        "const s = document.createElement('style');" +
        "s.textContent = '[data-topbar-drag] { -webkit-app-region: drag; } " +
        "[data-topbar-drag] button, [data-topbar-drag] input, [data-topbar-drag] a, [data-topbar-drag] [role=button] { -webkit-app-region: no-drag; }';" +
        "document.head.appendChild(s);"
      );
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIPC() {
  ipcMain.handle('terminal:create', (_event, agentId) => {
    const agentDir = path.join(DATA_DIR, 'agents', agentId);
    const cwd = fs.existsSync(agentDir) ? agentDir : app.getPath('home');
    const result = terminalManager.create(agentId, { cwd });

    terminalManager.onData(agentId, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:data', agentId, data);
      }
    });

    terminalManager.onExit(agentId, ({ exitCode }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', agentId, exitCode);
      }
    });

    return result;
  });

  ipcMain.on('terminal:write', (_event, agentId, data) => {
    terminalManager.write(agentId, data);
  });

  ipcMain.on('terminal:resize', (_event, agentId, cols, rows) => {
    terminalManager.resize(agentId, cols, rows);
  });

  ipcMain.handle('terminal:destroy', (_event, agentId) => {
    terminalManager.destroy(agentId);
    return { ok: true };
  });

  ipcMain.handle('agent:provision', async (_event, platform, permissions) => {
    const result = await provisioner.provision(platform, permissions);
    adapterManager.start({
      agentId: result.agentId,
      agentName: result.agentName,
      agentToken: result.token,
      platform: result.platform,
      agentDir: result.agentDir,
    });
    return result;
  });

  ipcMain.handle('agent:list', () => {
    return provisioner.listAgents();
  });

  ipcMain.handle('agent:remove', (_event, agentName) => {
    adapterManager.stop(agentName);
    terminalManager.destroy(agentName);
    provisioner.removeAgent(agentName);
    return { ok: true };
  });
}

function getAgentStartCommand(platform) {
  switch (platform) {
    case 'claude-code': return 'claude\r';
    case 'gemini-cli': return 'gemini\r';
    case 'codex': return 'codex\r';
    default: return null;
  }
}

function startAdaptersForExistingAgents() {
  const agents = provisioner.listAgents();
  for (const agent of agents) {
    if (agent.token) {
      adapterManager.start({
        agentId: agent.agentName,
        agentName: agent.agentName,
        agentToken: agent.token,
        platform: agent.platform,
        agentDir: agent.agentDir,
      });

      const agentDir = path.join(DATA_DIR, 'agents', agent.agentName);
      const cwd = fs.existsSync(agentDir) ? agentDir : app.getPath('home');
      const result = terminalManager.create(agent.agentName, { cwd });
      if (!result.reconnected) {
        const cmd = getAgentStartCommand(agent.platform);
        if (cmd) {
          setTimeout(() => terminalManager.write(agent.agentName, cmd), 500);
        }
      }
    }
  }
  if (agents.length > 0) {
    console.log(`[app] Started adapters and terminals for ${agents.length} existing agent(s)`);
  }
}

app.on('ready', async () => {
  ensureDataDir();
  const config = loadOrCreateConfig();

  // Resolve actual port: try stored preference first, fall back to next free.
  // Persist whichever port we land on so subsequent launches reuse it.
  try {
    const resolvedPort = await findFreePort(config.gateway_port);
    if (resolvedPort !== config.gateway_port) {
      console.log(`[app] Port ${config.gateway_port} in use, using ${resolvedPort}`);
      config.gateway_port = resolvedPort;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    }
  } catch (err) {
    console.error('[app] Could not find a free port:', err.message);
    app.quit();
    return;
  }

  adapterManager = new AdapterManager(config.gateway_port);
  adapterManager.setTerminalWriter((agentName, data) => {
    terminalManager.write(agentName, data);
  });
  provisioner = new AgentProvisioner(config.gateway_port, config.admin_token);

  gateway.start({
    port: config.gateway_port,
    dbPath: DB_PATH,
    uploadsDir: UPLOADS_DIR,
    jwtSecret: config.jwt_secret,
    adminToken: config.admin_token,
    adminPassword: config.admin_password || 'admin',
  });

  try {
    await gateway.waitReady();
    console.log('[app] Gateway ready');
  } catch (err) {
    console.error('[app] Gateway failed to start:', err.message);
    app.quit();
    return;
  }

  setupIPC();
  startAdaptersForExistingAgents();
  createWindow(config.gateway_port, config);
  setupTray(mainWindow, app);
  setupUpdater();
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    const config = loadOrCreateConfig();
    createWindow(config.gateway_port, config);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.isQuitting = false;
app.on('before-quit', async (e) => {
  if (!app.isQuitting) {
    app.isQuitting = true;
    e.preventDefault();
    terminalManager.destroyAll();
    adapterManager.stopAll();
    await gateway.stop();
    app.quit();
  }
});
