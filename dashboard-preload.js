const { contextBridge, ipcRenderer } = require('electron');

let usageHandler = null;
let historyHandler = null;
let updateHandler = null;
let progressHandler = null;
let syncStartHandler = null;
let syncErrorHandler = null;

contextBridge.exposeInMainWorld('dashboardAPI', {
  minimize: () => ipcRenderer.send('dash-minimize'),
  maximize: () => ipcRenderer.send('dash-maximize'),
  close: () => ipcRenderer.send('dash-close'),
  requestData: () => ipcRenderer.send('dashboard-request-data'),
  saveSettings: (settings) => ipcRenderer.send('dashboard-save-settings', settings),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: (downloadUrl) => ipcRenderer.invoke('download-and-install-update', downloadUrl),
  changeHotkey: (hotkey) => ipcRenderer.invoke('change-hotkey', hotkey),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onUsageUpdate: (cb) => {
    if (usageHandler) ipcRenderer.removeListener('usage-update', usageHandler);
    usageHandler = (_e, data) => cb(data);
    ipcRenderer.on('usage-update', usageHandler);
  },
  onHistoryUpdate: (cb) => {
    if (historyHandler) ipcRenderer.removeListener('history-update', historyHandler);
    historyHandler = (_e, data) => cb(data);
    ipcRenderer.on('history-update', historyHandler);
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
  onSyncStart: (cb) => {
    if (syncStartHandler) ipcRenderer.removeListener('sync-start', syncStartHandler);
    syncStartHandler = (_e) => cb();
    ipcRenderer.on('sync-start', syncStartHandler);
  },
  onSyncError: (cb) => {
    if (syncErrorHandler) ipcRenderer.removeListener('sync-error', syncErrorHandler);
    syncErrorHandler = (_e, msg) => cb(msg);
    ipcRenderer.on('sync-error', syncErrorHandler);
  },
});
