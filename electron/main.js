const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GatewayManager } = require('./gateway-manager');
const { setupTray } = require('./tray');
const { setupUpdater } = require('./updater');

const DATA_DIR = path.join(app.getPath('home'), '.aose');
const DATA_SUBDIR = path.join(DATA_DIR, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const DB_PATH = path.join(DATA_SUBDIR, 'gateway.db');
const UPLOADS_DIR = path.join(DATA_SUBDIR, 'uploads');
const LOGS_DIR = path.join(DATA_DIR, 'logs');

const gateway = new GatewayManager();
let mainWindow = null;

function ensureDataDir() {
  for (const dir of [DATA_DIR, DATA_SUBDIR, UPLOADS_DIR, LOGS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }
  const config = {
    jwt_secret: crypto.randomBytes(32).toString('hex'),
    admin_token: crypto.randomBytes(32).toString('hex'),
    gateway_port: 4000,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

function createWindow(port) {
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

app.on('ready', async () => {
  ensureDataDir();
  const config = loadOrCreateConfig();

  gateway.start({
    port: config.gateway_port,
    dbPath: DB_PATH,
    uploadsDir: UPLOADS_DIR,
    jwtSecret: config.jwt_secret,
    adminToken: config.admin_token,
  });

  try {
    await gateway.waitReady();
    console.log('[app] Gateway ready');
  } catch (err) {
    console.error('[app] Gateway failed to start:', err.message);
    app.quit();
    return;
  }

  createWindow(config.gateway_port);
  setupTray(mainWindow, app);
  setupUpdater();
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    const config = loadOrCreateConfig();
    createWindow(config.gateway_port);
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
    await gateway.stop();
    app.quit();
  }
});
