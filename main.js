const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');

// --- Constants ---
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CREDS_FILE = path.join(CLAUDE_DIR, '.credentials.json');
const DATA_FILE = path.join(CLAUDE_DIR, 'usage-widget-data.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const BOUNDS_FILE = path.join(CLAUDE_DIR, 'usage-widget-bounds.json');
const HISTORY_FILE = path.join(CLAUDE_DIR, 'usage-widget-history.json');
const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const USAGE_API = 'https://api.anthropic.com/api/oauth/usage';
const BETA_HEADER = 'oauth-2025-04-20';
const HOTKEY = 'Ctrl+\\';

let win = null;
let tray = null;
let syncing = false;
let syncStartedAt = 0;
let activeRequest = null;
let cachedUsage = null;
let fileWatcher = null;
let fileChangeTimer = null;
let lastAutoSync = 0;
let usageHistory = [];
let lastAlertTimes = { session: 0, weekAll: 0, weekSonnet: 0 };
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const ALERT_THRESHOLDS = { session: 80, weekAll: 90, weekSonnet: 90 };

const SYNC_TIMEOUT_MS = 30000; // force-reset syncing flag after 30s

// --- Paths (asar-safe) ---

function getAssetPath(filename) {
  // In production (asar), __dirname is inside the asar archive
  // Assets are unpacked, so use app.getAppPath() for packaged builds
  const assetDir = path.join(__dirname, 'assets');
  if (fs.existsSync(assetDir)) return path.join(assetDir, filename);
  return path.join(app.getAppPath(), 'assets', filename);
}

// --- Window bounds persistence ---

function loadBounds() {
  try {
    if (fs.existsSync(BOUNDS_FILE)) {
      const bounds = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf-8'));
      // Validate bounds are on a visible screen
      const displays = screen.getAllDisplays();
      const visible = displays.some((d) => {
        const { x, y, width, height } = d.bounds;
        return bounds.x >= x - 100 && bounds.x < x + width
          && bounds.y >= y - 100 && bounds.y < y + height;
      });
      return visible ? bounds : null;
    }
  } catch { /* ignore */ }
  return null;
}

function saveBounds() {
  if (!win) return;
  try {
    fs.writeFileSync(BOUNDS_FILE, JSON.stringify(win.getBounds()));
  } catch { /* ignore */ }
}

// --- Load/save cached data ---

function loadCachedUsage() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      return data.usage || null;
    }
  } catch { /* ignore */ }
  return null;
}

function saveCachedUsage(usage) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ lastSync: Date.now(), usage }, null, 2));
  } catch { /* ignore */ }
}

// --- Usage history ---

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
      if (data.version === 1 && Array.isArray(data.points)) {
        return data.points;
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      version: 1,
      points: usageHistory,
    }, null, 2));
  } catch { /* ignore */ }
}

function appendHistory(usage) {
  const point = {
    ts: Date.now(),
    session: usage.session.pct,
    weekAll: usage.weekAll.pct,
    weekSonnet: usage.weekSonnet.pct,
  };

  // Deduplicate: skip if values unchanged from last point
  const last = usageHistory[usageHistory.length - 1];
  if (last
    && last.session === point.session
    && last.weekAll === point.weekAll
    && last.weekSonnet === point.weekSonnet) {
    return;
  }

  usageHistory.push(point);

  // Prune points older than 30 days
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  usageHistory = usageHistory.filter((p) => p.ts > cutoff);

  saveHistory();
}

// --- Desktop notifications ---

function checkAndNotify(usage) {
  const { Notification } = require('electron');
  if (!Notification.isSupported()) return;

  const checks = [
    { key: 'session', pct: usage.session.pct, label: 'Session', resetsAt: usage.session.resetsAt },
    { key: 'weekAll', pct: usage.weekAll.pct, label: 'Weekly (all)', resetsAt: usage.weekAll.resetsAt },
    { key: 'weekSonnet', pct: usage.weekSonnet.pct, label: 'Weekly (Sonnet)', resetsAt: usage.weekSonnet.resetsAt },
  ];

  const now = Date.now();
  for (const check of checks) {
    if (check.pct >= ALERT_THRESHOLDS[check.key]
      && (now - lastAlertTimes[check.key]) > ALERT_COOLDOWN_MS) {
      lastAlertTimes[check.key] = now;

      let body = `Claude ${check.label} usage at ${check.pct}%`;
      if (check.resetsAt) {
        const diff = new Date(check.resetsAt).getTime() - now;
        if (diff > 0) {
          const hours = Math.floor(diff / 3600000);
          const mins = Math.floor((diff % 3600000) / 60000);
          body += hours > 0
            ? ` \u2014 resets in ${hours}h ${mins}m`
            : ` \u2014 resets in ${mins}m`;
        }
      }

      const notif = new Notification({
        title: 'Claude Meter Alert',
        body,
        icon: getAssetPath('icon.png'),
        silent: false,
      });
      notif.on('click', () => {
        if (win && !win.isVisible()) toggleWindow();
      });
      notif.show();
    }
  }
}

// --- OAuth token ---

function getAccessToken() {
  try {
    const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8'));
    const token = creds.claudeAiOauth?.accessToken;
    // Validate: non-empty string, no CRLF (header injection guard)
    if (typeof token !== 'string' || token.length === 0 || /[\r\n]/.test(token)) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

// --- Fetch usage from Anthropic API ---

function resetSyncIfStale() {
  if (syncing && syncStartedAt > 0 && (Date.now() - syncStartedAt) > SYNC_TIMEOUT_MS) {
    if (activeRequest) {
      try { activeRequest.destroy(); } catch { /* ignore */ }
      activeRequest = null;
    }
    syncing = false;
    syncStartedAt = 0;
  }
}

function fetchUsage() {
  return new Promise((resolve, reject) => {
    resetSyncIfStale();
    if (syncing) { reject(new Error('Already syncing')); return; }
    syncing = true;
    syncStartedAt = Date.now();

    const token = getAccessToken();
    if (!token) {
      syncing = false;
      syncStartedAt = 0;
      reject(new Error('No OAuth token. Log in to Claude Code first.'));
      return;
    }

    const url = new URL(USAGE_API);
    if (url.hostname !== 'api.anthropic.com') {
      syncing = false;
      syncStartedAt = 0;
      reject(new Error('Unexpected API hostname'));
      return;
    }

    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      syncing = false;
      syncStartedAt = 0;
      activeRequest = null;
      err ? reject(err) : resolve(data);
    };

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': BETA_HEADER,
        'Content-Type': 'application/json',
        'User-Agent': `claude-usage-widget/${app.getVersion()}`,
      },
    }, (res) => {
      const MAX_BODY = 1024 * 1024; // 1 MB
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) {
          req.destroy();
          finish(new Error('Response body too large'));
        }
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.type === 'error') {
            finish(new Error(data.error?.message || 'API error'));
            return;
          }
          finish(null, data);
        } catch {
          finish(new Error('Invalid response'));
        }
      });
    });

    activeRequest = req;
    req.on('error', (err) => finish(err));
    req.setTimeout(10000, () => { req.destroy(); finish(new Error('Timeout')); });
    req.end();
  });
}

function clampPct(val) {
  const n = Number(val) || 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function buildUsage(data) {
  const usage = {
    session: { pct: 0, resetsAt: null, label: 'Current session' },
    weekAll: { pct: 0, resetsAt: null, label: 'Current week (all models)' },
    weekSonnet: { pct: 0, resetsAt: null, label: 'Current week (Sonnet only)' },
    extraUsage: { enabled: false },
    syncTime: Date.now(),
  };

  if (data.five_hour) {
    usage.session = {
      pct: clampPct(data.five_hour.utilization),
      resetsAt: data.five_hour.resets_at,
      label: 'Current session',
    };
  }
  if (data.seven_day) {
    usage.weekAll = {
      pct: clampPct(data.seven_day.utilization),
      resetsAt: data.seven_day.resets_at,
      label: 'Current week (all models)',
    };
  }
  if (data.seven_day_sonnet) {
    usage.weekSonnet = {
      pct: clampPct(data.seven_day_sonnet.utilization),
      resetsAt: data.seven_day_sonnet.resets_at,
      label: 'Current week (Sonnet only)',
    };
  }
  if (data.extra_usage) {
    const util = Number(data.extra_usage.utilization);
    usage.extraUsage = {
      enabled: !!data.extra_usage.is_enabled,
      utilization: Number.isFinite(util) ? util : null,
    };
  }

  return usage;
}

async function doSync() {
  if (win && !win.isDestroyed()) win.webContents.send('sync-start');
  try {
    const data = await fetchUsage();
    cachedUsage = buildUsage(data);
    saveCachedUsage(cachedUsage);
    appendHistory(cachedUsage);
    if (win && !win.isDestroyed()) {
      win.webContents.send('history-update', usageHistory);
    }
    checkAndNotify(cachedUsage);
    if (win && !win.isDestroyed()) win.webContents.send('usage-update', cachedUsage);
    updateTrayTooltip();
  } catch (err) {
    // Truncate error — may contain untrusted content from API response
    const safeMsg = typeof err.message === 'string'
      ? err.message.slice(0, 200)
      : 'Unknown error';
    if (win && !win.isDestroyed()) win.webContents.send('sync-error', safeMsg);
  }
}

// --- Tray ---

function getTrayIcon() {
  const iconPath = getAssetPath('icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  // Fallback: generate simple gauge icon
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <rect width="16" height="16" rx="3.5" fill="#0a0a14"/>
    <path d="M 3 10 A 5 5 0 0 1 13 10" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round"/>
    <path d="M 7 10 A 1.5 1.5 0 0 1 13 10" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
    <line x1="8" y1="10" x2="5.5" y2="6" stroke="white" stroke-width="1" stroke-linecap="round"/>
    <circle cx="8" cy="10" r="1" fill="#d4845a"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

function updateTrayTooltip() {
  if (!tray) return;
  if (cachedUsage) {
    tray.setToolTip(
      `Claude Meter - Session: ${cachedUsage.session.pct}% | Week: ${cachedUsage.weekAll.pct}%`
    );
  } else {
    tray.setToolTip('Claude Meter');
  }
}

function buildTrayMenu() {
  const isAutoStart = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'Show  (Ctrl+\\)', click: () => toggleWindow() },
    { label: 'Sync Now', click: () => doSync() },
    { type: 'separator' },
    {
      label: 'Start on Login',
      type: 'checkbox',
      checked: isAutoStart,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { if (win && !win.isDestroyed()) win.destroy(); app.quit(); } },
  ]);
}

// --- Window ---

function createWindow() {
  const saved = loadBounds();
  const iconPath = getAssetPath('icon.png');

  win = new BrowserWindow({
    width: saved?.width || 480,
    height: saved?.height || 400,
    x: saved?.x,
    y: saved?.y,
    frame: false,
    resizable: true,
    minWidth: 320,
    minHeight: 280,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0c0c12',
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.loadFile('index.html');

  // Navigation guards — block external URLs and new windows
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', (e) => {
    e.preventDefault();
    saveBounds();
    win.hide();
  });

  win.on('resized', () => saveBounds());
  win.on('moved', () => saveBounds());

  win.on('blur', () => {
    if (win && win.isVisible()) {
      saveBounds();
      win.hide();
    }
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    saveBounds();
    win.hide();
  } else {
    const saved = loadBounds();
    if (!saved) {
      const display = screen.getPrimaryDisplay();
      const { width, height } = display.workAreaSize;
      const bounds = win.getBounds();
      win.setPosition(width - bounds.width - 16, height - bounds.height - 16);
    }
    win.show();
    win.focus();
    doSync();
  }
}

// --- File watching ---

function startFileWatcher() {
  try {
    if (fs.existsSync(PROJECTS_DIR)) {
      fileWatcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_, filename) => {
        if (!filename || !/\.jsonl$/i.test(filename)) return;
        const now = Date.now();
        if (now - lastAutoSync < 15000) return;
        if (fileChangeTimer) clearTimeout(fileChangeTimer);
        fileChangeTimer = setTimeout(() => {
          lastAutoSync = Date.now();
          doSync();
        }, 3000);
      });
    }
  } catch { /* ignore */ }
}

// --- App lifecycle ---

// Single instance lock - prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // If user tries to open another instance, show the window
    if (win) {
      if (!win.isVisible()) toggleWindow();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  cachedUsage = loadCachedUsage();
  usageHistory = loadHistory();

  createWindow();

  // Tray
  tray = new Tray(getTrayIcon());
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => toggleWindow());
  updateTrayTooltip();

  // Global hotkey
  globalShortcut.register(HOTKEY, () => toggleWindow());

  // IPC
  ipcMain.on('request-sync', () => doSync());
  ipcMain.on('minimize-to-tray', () => { if (win) { saveBounds(); win.hide(); } });
  ipcMain.on('quit-app', () => { win.destroy(); app.quit(); });

  ipcMain.on('toggle-compact', (_, isCompact) => {
    if (!win) return;
    const bounds = win.getBounds();
    if (isCompact) {
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 160 });
    } else {
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 400 });
    }
  });

  // Send cached data on load, then sync
  win.webContents.on('did-finish-load', () => {
    if (cachedUsage) win.webContents.send('usage-update', cachedUsage);
    if (usageHistory.length > 0) win.webContents.send('history-update', usageHistory);
    if (!syncing) doSync();
  });

  // Auto-refresh: 15s visible, 60s hidden
  setInterval(() => {
    if (win && win.isVisible()) doSync();
  }, 15000);

  setInterval(() => {
    if (win && !win.isVisible()) doSync();
  }, 60000);

  startFileWatcher();

  // --- Power monitor: handle sleep/wake ---
  powerMonitor.on('suspend', () => {
    // PC is going to sleep — kill any in-flight request
    if (activeRequest) {
      try { activeRequest.destroy(); } catch { /* ignore */ }
      activeRequest = null;
    }
    syncing = false;
    syncStartedAt = 0;
  });

  powerMonitor.on('resume', () => {
    // PC woke up — reset state and sync after a short delay (network may take a moment)
    syncing = false;
    syncStartedAt = 0;
    activeRequest = null;
    setTimeout(() => doSync(), 3000);
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (fileWatcher) fileWatcher.close();
});

app.on('window-all-closed', () => {
  // Stay in tray
});
