const { contextBridge, ipcRenderer } = require('electron');

let usageHandler = null;
let syncStartHandler = null;
let syncErrorHandler = null;
let updateHandler = null;
let progressHandler = null;
let authStatusHandler = null;

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
  onUpdateAvailable: (cb) => {
    if (updateHandler) ipcRenderer.removeListener('update-available', updateHandler);
    updateHandler = (_e, data) => cb(data);
    ipcRenderer.on('update-available', updateHandler);
  },
  onUpdateProgress: (cb) => {
    if (progressHandler) ipcRenderer.removeListener('update-progress', progressHandler);
    progressHandler = (_e, pct) => cb(pct);
    ipcRenderer.on('update-progress', progressHandler);
  },
  installUpdate: () => ipcRenderer.invoke('download-and-install-update'),
  toggleCompact: (isCompact) => ipcRenderer.send('toggle-compact', isCompact),
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  checkAuthStatus: () => ipcRenderer.invoke('check-auth-status'),
  launchAuthLogin: () => ipcRenderer.invoke('launch-auth-login'),
  openExternalUrl: (url) => ipcRenderer.send('open-external-url', url),
  onAuthStatusChanged: (cb) => {
    if (authStatusHandler) ipcRenderer.removeListener('auth-status-changed', authStatusHandler);
    authStatusHandler = (_e, data) => cb(data);
    ipcRenderer.on('auth-status-changed', authStatusHandler);
  },
});
