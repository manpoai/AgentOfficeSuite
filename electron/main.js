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

const DATA_DIR = path.join(app.getPath('home'), app.isPackaged ? '.aose' : '.aose-dev');
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

// Catch-all so a single subsystem failure (e.g. node-pty spawn for one agent)
// doesn't terminate the whole App. Node 24 default behaviour is strict-throw
// on unhandled rejections.
process.on('unhandledRejection', (reason) => {
  console.error('[app] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[app] Uncaught exception:', err);
});

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
  // Pass admin token to preload via env so it's available before page JS runs
  process.env.__AOSE_ADMIN_TOKEN__ = config.admin_token;

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
    if (!agent.token) continue;
    try {
      adapterManager.start({
        agentId: agent.agentId || agent.agentName,
        agentName: agent.agentName,
        agentToken: agent.token,
        platform: agent.platform,
        agentDir: agent.agentDir,
      });
    } catch (err) {
      console.error(`[app] adapterManager.start failed for ${agent.agentName}:`, err.message);
    }

    try {
      const agentDir = path.join(DATA_DIR, 'agents', agent.agentName);
      const cwd = fs.existsSync(agentDir) ? agentDir : app.getPath('home');
      const result = terminalManager.create(agent.agentName, { cwd });
      if (!result.reconnected) {
        const cmd = getAgentStartCommand(agent.platform);
        if (cmd) {
          setTimeout(() => terminalManager.write(agent.agentName, cmd), 500);
        }
      }
    } catch (err) {
      console.error(`[app] terminalManager.create failed for ${agent.agentName}:`, err.message);
    }
  }
  if (agents.length > 0) {
    console.log(`[app] Started adapters and terminals for ${agents.length} existing agent(s)`);
  }
}

// Register the aose:// custom protocol so links shared from one App can be
// opened on another machine that has the App installed. This is best-effort:
// when running in dev (`npx electron`) the OS may already have a registered
// handler, in which case Electron falls back to the existing one.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('aose', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('aose');
}

// Single-instance lock — second-instance launches forward their args
// (including the aose:// URL) to the running App.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const aoseUrl = argv.find(a => a.startsWith('aose://'));
    if (aoseUrl) handleAoseUrl(aoseUrl);
  }
});

// macOS: open-url is the canonical event for protocol launches.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) handleAoseUrl(url);
  else pendingAoseUrl = url;
});

let pendingAoseUrl = null;

function handleAoseUrl(url) {
  // Format: aose://content/<type>/<id>
  // Translate to in-app navigation: window.location → /content?id=<type>:<id>
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'aose:') return;
    const parts = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    // host=content, parts=[type, id] OR host="" with first segment being content
    const segments = [parsed.host, ...parts].filter(Boolean);
    if (segments[0] === 'content' && segments[1] && segments[2]) {
      const type = segments[1];
      const id = decodeURIComponent(segments[2]);
      const target = `/content?id=${encodeURIComponent(`${type}:${id}`)}`;
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`window.location.href = ${JSON.stringify(target)}`);
      }
    }
  } catch (e) {
    console.warn('[app] Failed to parse aose:// URL:', e.message);
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
  provisioner = new AgentProvisioner(config.gateway_port, config.admin_token, DATA_DIR);

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

  // If the App was opened via an aose:// URL before the window existed,
  // navigate to it now.
  if (pendingAoseUrl) {
    const url = pendingAoseUrl;
    pendingAoseUrl = null;
    mainWindow.webContents.once('did-finish-load', () => handleAoseUrl(url));
  }
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
