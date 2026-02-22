const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  requestSync: () => ipcRenderer.send('request-sync'),
  minimize: () => ipcRenderer.send('minimize-to-tray'),
  quit: () => ipcRenderer.send('quit-app'),
  onUsageUpdate: (cb) => ipcRenderer.on('usage-update', (_e, data) => cb(data)),
  onSyncStart: (cb) => ipcRenderer.on('sync-start', () => cb()),
  onSyncError: (cb) => ipcRenderer.on('sync-error', (_e, msg) => cb(msg)),
});
