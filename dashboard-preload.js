const { contextBridge, ipcRenderer } = require('electron');

let usageHandler = null;
let historyHandler = null;

contextBridge.exposeInMainWorld('dashboardAPI', {
  requestData: () => ipcRenderer.send('dashboard-request-data'),
  saveSettings: (settings) => ipcRenderer.send('dashboard-save-settings', settings),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
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
});
