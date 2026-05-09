const { contextBridge, ipcRenderer } = require('electron');

if (process.env.__AOSE_ADMIN_TOKEN__) {
  contextBridge.exposeInMainWorld('__AOSE_ADMIN_TOKEN__', process.env.__AOSE_ADMIN_TOKEN__);
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,

  // Terminal
  createTerminal: (agentId) => ipcRenderer.invoke('terminal:create', agentId),
  writeTerminal: (agentId, data) => ipcRenderer.send('terminal:write', agentId, data),
  resizeTerminal: (agentId, cols, rows) => ipcRenderer.send('terminal:resize', agentId, cols, rows),
  destroyTerminal: (agentId) => ipcRenderer.invoke('terminal:destroy', agentId),
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal:data', (_event, agentId, data) => callback(agentId, data));
  },
  onTerminalExit: (callback) => {
    ipcRenderer.on('terminal:exit', (_event, agentId, exitCode) => callback(agentId, exitCode));
  },
  removeTerminalListeners: () => {
    ipcRenderer.removeAllListeners('terminal:data');
    ipcRenderer.removeAllListeners('terminal:exit');
  },

  // Agent provisioning
  provisionAgent: (platform, permissions) => ipcRenderer.invoke('agent:provision', platform, permissions),
  listLocalAgents: () => ipcRenderer.invoke('agent:list'),
  removeAgent: (agentName) => ipcRenderer.invoke('agent:remove', agentName),
});
