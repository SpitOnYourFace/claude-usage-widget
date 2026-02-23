const { contextBridge, ipcRenderer } = require('electron');

let usageHandler = null;
let syncStartHandler = null;
let syncErrorHandler = null;

contextBridge.exposeInMainWorld('electronAPI', {
  requestSync: () => ipcRenderer.send('request-sync'),
  minimize: () => ipcRenderer.send('minimize-to-tray'),
  quit: () => ipcRenderer.send('quit-app'),
  onUsageUpdate: (cb) => {
    if (usageHandler) ipcRenderer.removeListener('usage-update', usageHandler);
    usageHandler = (_e, data) => cb(data);
    ipcRenderer.on('usage-update', usageHandler);
  },
  onSyncStart: (cb) => {
    if (syncStartHandler) ipcRenderer.removeListener('sync-start', syncStartHandler);
    syncStartHandler = () => cb();
    ipcRenderer.on('sync-start', syncStartHandler);
  },
  onSyncError: (cb) => {
    if (syncErrorHandler) ipcRenderer.removeListener('sync-error', syncErrorHandler);
    syncErrorHandler = (_e, msg) => cb(msg);
    ipcRenderer.on('sync-error', syncErrorHandler);
  },
});
