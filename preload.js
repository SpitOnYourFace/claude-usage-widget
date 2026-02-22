const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  requestSync: () => ipcRenderer.send('request-sync'),
  minimize: () => ipcRenderer.send('minimize-to-tray'),
  quit: () => ipcRenderer.send('quit-app'),
  onUsageUpdate: (cb) => {
    ipcRenderer.removeAllListeners('usage-update');
    ipcRenderer.on('usage-update', (_e, data) => cb(data));
  },
  onSyncStart: (cb) => {
    ipcRenderer.removeAllListeners('sync-start');
    ipcRenderer.on('sync-start', () => cb());
  },
  onSyncError: (cb) => {
    ipcRenderer.removeAllListeners('sync-error');
    ipcRenderer.on('sync-error', (_e, msg) => cb(msg));
  },
});
