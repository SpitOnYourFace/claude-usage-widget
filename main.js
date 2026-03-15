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
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');

// --- App version (read from package.json, reliable even with asar repack) ---
let APP_VERSION;
try {
  APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version;
} catch { /* ignore */ }

// --- Constants ---
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CREDS_FILE = path.join(CLAUDE_DIR, '.credentials.json');
const DATA_FILE = path.join(CLAUDE_DIR, 'usage-widget-data.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const BOUNDS_FILE = path.join(CLAUDE_DIR, 'usage-widget-bounds.json');
const HISTORY_FILE = path.join(CLAUDE_DIR, 'usage-widget-history.json');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'usage-widget-settings.json');
const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const USAGE_API = 'https://api.anthropic.com/api/oauth/usage';
const BETA_HEADER = 'oauth-2025-04-20';
const DEFAULT_HOTKEY = 'Ctrl+\\';
let currentHotkey = DEFAULT_HOTKEY;

let win = null;
let tray = null;
let syncing = false;
let syncStartedAt = 0;
let activeRequest = null;
let cachedUsage = null;
let fileWatcher = null;
let fileChangeTimer = null;
let dashWin = null;
let lastAutoSync = 0;
let lastSuccessfulSync = 0;
const MIN_SYNC_INTERVAL = 120000; // don't hit API more than once per 2 minutes
let usageHistory = [];
// Track last alerted pct step per key (fires at threshold, then every 10%)
let lastAlertedStep = { session: -1, weekAll: -1, weekSonnet: -1 };
let alertPopup = null;
const ALERT_THRESHOLDS = { session: 80, weekAll: 90, weekSonnet: 90 };
let trayHasAlert = false;

const SYNC_TIMEOUT_MS = 15000; // force-reset syncing flag after 15s

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
      const bw = bounds.width || 480;
      const bh = bounds.height || 450;
      const visible = displays.some((d) => {
        const { x, y, width, height } = d.bounds;
        return bounds.x + bw > x + 50 && bounds.x < x + width - 50
          && bounds.y + bh > y + 50 && bounds.y < y + height - 50;
      });
      return visible ? bounds : null;
    }
  } catch { /* ignore */ }
  return null;
}

let boundsDebounce = null;
function saveBounds() {
  if (!win) return;
  if (boundsDebounce) clearTimeout(boundsDebounce);
  boundsDebounce = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    try {
      fs.writeFileSync(BOUNDS_FILE, JSON.stringify(win.getBounds()));
    } catch { /* ignore */ }
  }, 500);
}
function saveBoundsNow() {
  if (boundsDebounce) { clearTimeout(boundsDebounce); boundsDebounce = null; }
  if (!win || win.isDestroyed()) return;
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

// --- Settings persistence ---

// Validate hotkey accelerator format before passing to globalShortcut
const SAFE_HOTKEY_RE = /^(Ctrl|Alt|Shift|Super|Cmd|Command)(\+(Ctrl|Alt|Shift|Super|Cmd|Command))*\+[A-Za-z0-9\\[\];',./`\-=F]$/;

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (data.hotkey && typeof data.hotkey === 'string'
        && data.hotkey.length <= 50 && SAFE_HOTKEY_RE.test(data.hotkey)) {
        currentHotkey = data.hotkey;
      }
      if (data.alertThresholds) {
        if (typeof data.alertThresholds.session === 'number') {
          ALERT_THRESHOLDS.session = data.alertThresholds.session;
        }
        if (typeof data.alertThresholds.weekAll === 'number') {
          ALERT_THRESHOLDS.weekAll = data.alertThresholds.weekAll;
        }
        if (typeof data.alertThresholds.weekSonnet === 'number') {
          ALERT_THRESHOLDS.weekSonnet = data.alertThresholds.weekSonnet;
        }
      }
    }
  } catch { /* ignore */ }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      hotkey: currentHotkey,
      alertThresholds: {
        session: ALERT_THRESHOLDS.session,
        weekAll: ALERT_THRESHOLDS.weekAll,
        weekSonnet: ALERT_THRESHOLDS.weekSonnet,
      },
    }, null, 2));
  } catch { /* ignore */ }
}

// --- Alert popup ---

function getAlertStep(pct, threshold) {
  // Returns which 10% step above threshold we're at (0 = at threshold, 1 = +10%, etc.)
  if (pct < threshold) return -1;
  return Math.floor((pct - threshold) / 10);
}

function showAlertPopup(label, pct, resetsAt) {
  if (alertPopup && !alertPopup.isDestroyed()) {
    alertPopup.close();
    alertPopup = null;
  }

  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const popW = 320;
  const popH = 200;
  const severity = pct >= 85 ? 'danger' : 'warning';

  alertPopup = new BrowserWindow({
    width: popW,
    height: popH,
    x: sw - popW - 20,
    y: sh - popH - 20,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0c0c12',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'popup-preload.js'),
    },
  });

  alertPopup.on('closed', () => { alertPopup = null; });

  alertPopup.once('ready-to-show', () => {
    if (alertPopup && !alertPopup.isDestroyed()) {
      alertPopup.showInactive();
    }
  });

  alertPopup.loadFile(path.join(__dirname, 'popup.html'));

  alertPopup.webContents.once('did-finish-load', () => {
    if (!alertPopup || alertPopup.isDestroyed()) return;

    let resetText = '';
    if (resetsAt) {
      const diff = new Date(resetsAt).getTime() - Date.now();
      if (diff > 0) {
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        resetText = hours > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${mins}m`;
      }
    }

    alertPopup.webContents.send('popup-data', { severity, label, pct, resetText });
  });
}

function checkAndNotify(usage) {
  const checks = [
    { key: 'session', pct: usage.session.pct, label: 'Session', resetsAt: usage.session.resetsAt },
    { key: 'weekAll', pct: usage.weekAll.pct, label: 'Weekly (all)', resetsAt: usage.weekAll.resetsAt },
    { key: 'weekSonnet', pct: usage.weekSonnet.pct, label: 'Weekly (Sonnet)', resetsAt: usage.weekSonnet.resetsAt },
  ];

  for (const check of checks) {
    const step = getAlertStep(check.pct, ALERT_THRESHOLDS[check.key]);
    if (step >= 0 && step !== lastAlertedStep[check.key]) {
      lastAlertedStep[check.key] = step;
      showAlertPopup(check.label, check.pct, check.resetsAt);
    }
    // Reset tracking when usage drops below threshold
    if (step < 0) lastAlertedStep[check.key] = -1;
  }
}

function getAlertTrayIcon() {
  // Generate gauge icon with a red alert dot overlay
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <rect width="16" height="16" rx="3.5" fill="#0a0a14"/>
    <path d="M 3 10 A 5 5 0 0 1 13 10" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round"/>
    <path d="M 7 10 A 1.5 1.5 0 0 1 13 10" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
    <line x1="8" y1="10" x2="5.5" y2="6" stroke="white" stroke-width="1" stroke-linecap="round"/>
    <circle cx="8" cy="10" r="1" fill="#d4845a"/>
    <circle cx="13" cy="3" r="3" fill="#f87171"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

function updateTrayBadge(usage) {
  if (!tray) return;
  const hasAlert = usage.session.pct >= ALERT_THRESHOLDS.session
    || usage.weekAll.pct >= ALERT_THRESHOLDS.weekAll
    || usage.weekSonnet.pct >= ALERT_THRESHOLDS.weekSonnet;

  if (hasAlert !== trayHasAlert) {
    trayHasAlert = hasAlert;
    if (process.platform === 'win32') {
      // Windows: use overlay icon on taskbar
      if (hasAlert) {
        const dotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
          <circle cx="12" cy="4" r="3.5" fill="#f87171"/>
        </svg>`;
        const dotImage = nativeImage.createFromDataURL(
          'data:image/svg+xml;base64,' + Buffer.from(dotSvg).toString('base64')
        );
        if (win) win.setOverlayIcon(dotImage, 'Usage alert');
      } else {
        if (win) win.setOverlayIcon(null, '');
      }
    } else {
      // Linux & macOS: swap the tray icon itself
      tray.setImage(hasAlert ? getAlertTrayIcon() : getTrayIcon());
    }
  }
}

// --- Auto-update check ---

let lastUpdateCheck = 0;
let lastUpdateResult = null;
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function isNewerVersion(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function checkForUpdates() {
  return new Promise((resolve) => {
    const url = new URL('https://api.github.com/repos/SpitOnYourFace/claude-usage-widget/releases/latest');
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent': `claude-usage-widget/${(APP_VERSION || app.getVersion())}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    }, (res) => {
      let body = '';
      const MAX_GH_BODY = 512 * 1024;
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_GH_BODY) { res.resume(); req.destroy(); resolve({ hasUpdate: false }); return; }
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const latestTag = (data.tag_name || '').replace(/^v/, '');
          const current = (APP_VERSION || app.getVersion());
          if (latestTag && isNewerVersion(latestTag, current)) {
            // Find platform-appropriate installer asset
            let downloadUrl = null;
            if (Array.isArray(data.assets)) {
              let asset = null;
              const isArm = process.arch === 'arm64';
              if (process.platform === 'win32') {
                asset = data.assets.find((a) =>
                  /\.exe$/i.test(a.name) && /setup/i.test(a.name)
                );
              } else if (process.platform === 'darwin') {
                asset = data.assets.find((a) =>
                  /\.dmg$/i.test(a.name) && (isArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name))
                );
              } else {
                asset = data.assets.find((a) =>
                  /\.AppImage$/i.test(a.name) && (isArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name))
                );
              }
              if (asset) downloadUrl = asset.browser_download_url;
            }
            resolve({
              hasUpdate: true,
              latestVersion: latestTag,
              url: data.html_url,
              downloadUrl,
            });
          } else {
            resolve({ hasUpdate: false });
          }
        } catch {
          resolve({ hasUpdate: false });
        }
      });
    });
    req.on('error', () => resolve({ hasUpdate: false }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ hasUpdate: false }); });
    req.end();
  });
}

function downloadAndInstallUpdate(downloadUrl) {
  return new Promise((resolve, reject) => {
    if (!downloadUrl) {
      reject(new Error('No download URL'));
      return;
    }

    const ext = path.extname(new URL(downloadUrl).pathname) || '.exe';
    const dest = path.join(os.tmpdir(), 'claude-meter-' + crypto.randomUUID() + ext);

    const sendProgress = (pct) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-progress', pct);
      }
      if (dashWin && !dashWin.isDestroyed()) {
        dashWin.webContents.send('update-progress', pct);
      }
    };

    const doDownload = (url, redirects) => {
      if (redirects > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const parsed = new URL(url);
      const req = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': `claude-usage-widget/${(APP_VERSION || app.getVersion())}`,
        },
      }, (res) => {
        // Follow redirects (GitHub uses 302)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain the response
          // Validate redirect host
          try {
            const redirectUrl = new URL(res.headers.location);
            const allowedHosts = ['github.com', 'objects.githubusercontent.com',
              'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com',
              'github-production-release-asset-2e65be.s3.amazonaws.com'];
            if (redirectUrl.protocol !== 'https:' || !allowedHosts.some((h) => redirectUrl.hostname === h || redirectUrl.hostname.endsWith('.' + h))) {
              reject(new Error('Redirect to untrusted host: ' + redirectUrl.hostname));
              return;
            }
          } catch {
            reject(new Error('Invalid redirect URL'));
            return;
          }
          doDownload(res.headers.location, redirects + 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('Download failed: HTTP ' + res.statusCode));
          return;
        }

        // Only create file stream once we have a 200
        const file = fs.createWriteStream(dest);
        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        let lastSentPct = -1;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.round((downloaded / totalBytes) * 100);
            if (pct !== lastSentPct) {
              lastSentPct = pct;
              sendProgress(pct);
            }
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          // Verify download size matches Content-Length
          if (totalBytes > 0 && downloaded !== totalBytes) {
            fs.unlink(dest, () => {});
            reject(new Error('Download size mismatch: expected ' + totalBytes + ', got ' + downloaded));
            return;
          }
          sendProgress(100);
          resolve(dest);
        });
        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
      req.setTimeout(120000, () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });
      req.end();
    };

    doDownload(downloadUrl, 0);
  });
}

// --- OAuth token (cached to avoid reading file on every sync) ---

let cachedToken = null;
let tokenLastRead = 0;
let signedOut = false;
const TOKEN_CACHE_MS = 5 * 60 * 1000; // re-read every 5 minutes

function getAccessToken(forceRefresh) {
  if (signedOut) return null;
  const now = Date.now();
  if (!forceRefresh && cachedToken && (now - tokenLastRead) < TOKEN_CACHE_MS) {
    return cachedToken;
  }
  try {
    const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8'));
    const token = creds.claudeAiOauth?.accessToken;
    // Validate: non-empty string, no CRLF (header injection guard)
    if (typeof token !== 'string' || token.length === 0 || /[\r\n]/.test(token)) {
      cachedToken = null;
      return null;
    }
    cachedToken = token;
    tokenLastRead = now;
    return token;
  } catch {
    cachedToken = null;
    return null;
  }
}

// --- Local usage estimation from JSONL files ---

function estimateLocalUsage() {
  const now = Date.now();
  const fiveHoursAgo = now - (5 * 3600 * 1000);
  const sevenDaysAgo = now - (7 * 24 * 3600 * 1000);

  let output5h = 0, output7d = 0, outputSonnet7d = 0;

  try {
    // Scan all project dirs for JSONL files
    const projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    for (const dir of projectDirs) {
      const dirPath = path.join(PROJECTS_DIR, dir.name);
      let files;
      try {
        files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
      } catch { continue; }

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          // Skip files older than 7 days
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < sevenDaysAgo) continue;

          const content = fs.readFileSync(filePath, 'utf-8');
          for (const line of content.split('\n')) {
            if (!line) continue;
            try {
              const d = JSON.parse(line);
              if (d.type !== 'assistant' || !d.timestamp) continue;
              const ts = new Date(d.timestamp).getTime();
              if (isNaN(ts)) continue;

              const usage = d.message?.usage;
              if (!usage) continue;
              const output = usage.output_tokens || 0;
              const model = d.message?.model || '';

              if (ts > fiveHoursAgo) output5h += output;
              if (ts > sevenDaysAgo) {
                output7d += output;
                if (/sonnet/i.test(model)) outputSonnet7d += output;
              }
            } catch { continue; }
          }
        } catch { continue; }
      }
    }
  } catch { /* ignore */ }

  return { output5h, output7d, outputSonnet7d, ts: now };
}

function buildLocalUsage() {
  const local = estimateLocalUsage();

  // If we have cached API data, adjust percentages based on token delta
  if (cachedUsage && cachedUsage.syncTime) {
    // Use cached API percentages as base — they're authoritative
    // Just update the syncTime so the UI shows fresh data
    return {
      session: { ...cachedUsage.session },
      weekAll: { ...cachedUsage.weekAll },
      weekSonnet: { ...cachedUsage.weekSonnet },
      extraUsage: cachedUsage.extraUsage || { enabled: false },
      syncTime: Date.now(),
      localEstimate: true,
    };
  }

  // No cached data at all — return zeros
  return {
    session: { pct: 0, resetsAt: null, label: 'Current session' },
    weekAll: { pct: 0, resetsAt: null, label: 'Current week (all models)' },
    weekSonnet: { pct: 0, resetsAt: null, label: 'Current week (Sonnet only)' },
    extraUsage: { enabled: false },
    syncTime: Date.now(),
    localEstimate: true,
  };
}

// --- Fetch usage from Anthropic API ---

let rateLimitUntil = 0; // backoff timestamp after 429

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
    if (Date.now() < rateLimitUntil) {
      reject(new Error('Rate limited — waiting'));
      return;
    }
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
        'User-Agent': `claude-usage-widget/${(APP_VERSION || app.getVersion())}`,
      },
    }, (res) => {
      // Handle rate limiting — back off using Retry-After or 5 minutes default
      if (res.statusCode === 429) {
        res.resume();
        const retryAfter = parseInt(res.headers['retry-after'], 10);
        const backoffMs = (retryAfter > 0 ? retryAfter * 1000 : 300000);
        rateLimitUntil = Date.now() + backoffMs;
        finish(new Error('Rate limited'));
        return;
      }

      // Detect expired/invalid token from HTTP status
      if (res.statusCode === 401 || res.statusCode === 403) {
        res.resume();
        finish(new Error('OAuth session expired — please re-authenticate'));
        return;
      }

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
            const msg = data.error?.message || 'API error';
            // Detect auth errors in response body too
            const errType = (data.error?.type || '').toLowerCase();
            if (errType.indexOf('auth') >= 0 || errType.indexOf('permission') >= 0) {
              finish(new Error('OAuth session expired — please re-authenticate'));
              return;
            }
            finish(new Error(msg));
            return;
          }
          // Successful response — clear any rate limit backoff
          rateLimitUntil = 0;
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

function broadcastUsage() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('usage-update', cachedUsage);
    win.webContents.send('history-update', usageHistory);
  }
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.webContents.send('usage-update', cachedUsage);
    dashWin.webContents.send('history-update', usageHistory);
  }
}

// --- Retry logic for failed syncs ---
let retryTimer = null;
let retryCount = 0;
const MAX_RETRIES = 5;

function clearRetryTimer() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  retryCount = 0;
}

function scheduleAuthRetry() {
  // Retry with increasing delay: 10s, 20s, 40s, 60s, 60s
  if (retryCount >= MAX_RETRIES) return;
  if (retryTimer) clearTimeout(retryTimer);
  const delay = Math.min(60000, 10000 * Math.pow(2, retryCount));
  retryCount++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    cachedToken = null; // force re-read — token may have been refreshed
    doSync();
  }, delay);
}

function scheduleNetworkRetry() {
  // Network errors after wake: retry 5s, 10s, 20s, 30s, 30s
  if (retryCount >= MAX_RETRIES) return;
  if (retryTimer) clearTimeout(retryTimer);
  const delay = Math.min(30000, 5000 * Math.pow(2, retryCount));
  retryCount++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    doSync();
  }, delay);
}

// Smart sync — only hits API if data is stale (>2 min old)
function syncIfStale() {
  if (Date.now() - lastSuccessfulSync < MIN_SYNC_INTERVAL) {
    // Data is fresh — just broadcast cached data
    broadcastUsage();
    return;
  }
  doSync();
}

async function doSync() {
  // Force-clear stale sync lock
  resetSyncIfStale();
  if (win && !win.isDestroyed()) win.webContents.send('sync-start');
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('sync-start');
  try {
    const data = await fetchUsage();
    const newUsage = buildUsage(data);

    // Guard: don't overwrite good cached data with all-zero response
    const allZero = newUsage.session.pct === 0
      && newUsage.weekAll.pct === 0
      && newUsage.weekSonnet.pct === 0;
    if (allZero && cachedUsage
      && (cachedUsage.session.pct > 0 || cachedUsage.weekAll.pct > 0 || cachedUsage.weekSonnet.pct > 0)) {
      // Check if reset times exist — if they do, the data is genuinely 0 (post-reset)
      const hasResetTimes = newUsage.session.resetsAt || newUsage.weekAll.resetsAt || newUsage.weekSonnet.resetsAt;
      if (!hasResetTimes) {
        // Likely bad response — keep cached data, don't save zeros
        broadcastUsage();
        updateTrayTooltip();
        return;
      }
    }

    cachedUsage = newUsage;
    lastSuccessfulSync = Date.now();
    clearRetryTimer(); // sync succeeded — stop retrying
    saveCachedUsage(cachedUsage);
    appendHistory(cachedUsage);
    checkAndNotify(cachedUsage);
    updateTrayBadge(cachedUsage);
    broadcastUsage();
    updateTrayTooltip();
  } catch (err) {
    const safeMsg = typeof err.message === 'string'
      ? err.message.slice(0, 200)
      : 'Unknown error';

    // Only clear token cache for actual auth/network errors, not flow-control
    if (safeMsg.indexOf('Already syncing') < 0 && safeMsg.indexOf('Rate limited') < 0) {
      cachedToken = null;
    }

    // Auth errors: no token, expired session, or API auth rejection
    const isAuthError = safeMsg.indexOf('OAuth') >= 0
      || safeMsg.indexOf('No OAuth') >= 0
      || safeMsg.indexOf('re-authenticate') >= 0;

    if (isAuthError) {
      if (win && !win.isDestroyed()) win.webContents.send('sync-error', safeMsg);
      if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('sync-error', safeMsg);
      // Schedule retry — Claude Code may refresh the token
      scheduleAuthRetry();
      return;
    }

    // API failed for other reason — show cached data but DON'T mark as successful
    // so the next interval will retry the API instead of serving stale data
    const localUsage = buildLocalUsage();
    if (localUsage.session.pct > 0 || cachedUsage) {
      cachedUsage = localUsage;
      broadcastUsage();
      updateTrayTooltip();
      // Schedule a retry since this wasn't a real sync
      scheduleNetworkRetry();
    } else {
      if (win && !win.isDestroyed()) win.webContents.send('sync-error', safeMsg);
      if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('sync-error', safeMsg);
    }
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

// --- Linux desktop integration ---

const LINUX_AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const LINUX_DESKTOP_FILE = path.join(LINUX_AUTOSTART_DIR, 'claude-meter.desktop');
const LINUX_APPS_DIR = path.join(os.homedir(), '.local', 'share', 'applications');
const LINUX_APPS_DESKTOP = path.join(LINUX_APPS_DIR, 'claude-meter.desktop');
const LINUX_ICON_DIR = path.join(os.homedir(), '.local', 'share', 'icons');
const LINUX_ICON_FILE = path.join(LINUX_ICON_DIR, 'claude-meter.png');

function writeLinuxDesktopFile(filePath, extraLines) {
  const exePath = process.env.APPIMAGE || process.execPath;
  const iconSrc = getAssetPath('icon.png');
  if (fs.existsSync(iconSrc)) {
    fs.mkdirSync(LINUX_ICON_DIR, { recursive: true });
    fs.copyFileSync(iconSrc, LINUX_ICON_FILE);
  }
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Claude Meter',
    'Comment=Desktop meter showing Claude usage',
    'Exec=' + exePath,
    'Icon=' + (fs.existsSync(LINUX_ICON_FILE) ? LINUX_ICON_FILE : 'claude-meter'),
    'Terminal=false',
    'Categories=Utility;',
    'StartupWMClass=claude-usage-widget',
  ];
  if (extraLines) lines.push.apply(lines, extraLines);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

function ensureLinuxShortcut() {
  if (process.platform !== 'linux') return;
  try {
    // Always write to keep Exec path current after updates
    writeLinuxDesktopFile(LINUX_APPS_DESKTOP);
  } catch { /* ignore */ }
}

function getLinuxAutoStart() {
  if (process.platform !== 'linux') return false;
  return fs.existsSync(LINUX_DESKTOP_FILE);
}

function setLinuxAutoStart(enabled) {
  if (process.platform !== 'linux') return;
  if (enabled) {
    try {
      writeLinuxDesktopFile(LINUX_DESKTOP_FILE, ['X-GNOME-Autostart-enabled=true']);
    } catch { /* ignore */ }
  } else {
    try { fs.unlinkSync(LINUX_DESKTOP_FILE); } catch { /* ignore */ }
  }
}

function getAutoStartEnabled() {
  if (process.platform === 'linux') return getLinuxAutoStart();
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStartEnabled(enabled) {
  if (process.platform === 'linux') {
    setLinuxAutoStart(enabled);
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show  (' + currentHotkey + ')', click: () => toggleWindow() },
    { label: 'Dashboard', click: () => openDashboard() },
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
    height: saved?.height || 450,
    x: saved?.x,
    y: saved?.y,
    frame: false,
    resizable: true,
    minWidth: 320,
    minHeight: 320,
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
    saveBoundsNow();
    win.hide();
  });

  win.on('resized', () => saveBounds());
  win.on('moved', () => saveBounds());

  win.on('blur', () => {
    if (win && win.isVisible()) {
      saveBoundsNow();
      win.hide();
    }
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    saveBoundsNow();
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
    // Immediately push cached data so UI is never empty
    if (cachedUsage && !win.isDestroyed()) {
      win.webContents.send('usage-update', cachedUsage);
    }
    // Sync on open — only hits API if data is stale
    syncIfStale();
    if (trayHasAlert) {
      trayHasAlert = false;
      if (process.platform === 'win32') {
        if (win) win.setOverlayIcon(null, '');
      } else if (tray) {
        tray.setImage(getTrayIcon());
      }
    }
  }
}

function openDashboard() {
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.focus();
    // Refresh data when re-focusing existing dashboard
    if (cachedUsage) dashWin.webContents.send('usage-update', cachedUsage);
    if (usageHistory.length > 0) dashWin.webContents.send('history-update', usageHistory);
    syncIfStale();
    return;
  }

  const iconPath = getAssetPath('icon.png');
  dashWin = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0c0c12',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'dashboard-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  dashWin.loadFile('dashboard.html');

  dashWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  dashWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  dashWin.webContents.on('did-finish-load', () => {
    if (cachedUsage) dashWin.webContents.send('usage-update', cachedUsage);
    if (usageHistory.length > 0) dashWin.webContents.send('history-update', usageHistory);
    if (lastUpdateResult && lastUpdateResult.hasUpdate) {
      dashWin.webContents.send('update-available', lastUpdateResult);
    }
  });

  dashWin.on('closed', () => { dashWin = null; });
}

// --- File watching ---

let linuxSubWatchers = [];

function onJsonlChange(_, filename) {
  if (!filename || !/\.jsonl$/i.test(filename)) return;
  if (fileChangeTimer) clearTimeout(fileChangeTimer);
  fileChangeTimer = setTimeout(() => {
    syncIfStale();
  }, 3000);
}

function startFileWatcher() {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return;
    const supportsRecursive = process.platform === 'win32' || process.platform === 'darwin';

    if (supportsRecursive) {
      fileWatcher = fs.watch(PROJECTS_DIR, { recursive: true }, onJsonlChange);
    } else {
      // Linux: fs.watch recursive is unsupported — watch each subdirectory individually
      fileWatcher = fs.watch(PROJECTS_DIR, (eventType, dirname) => {
        // Watch newly created project subdirectories
        if (eventType === 'rename' && dirname) {
          const sub = path.join(PROJECTS_DIR, dirname);
          try {
            if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) {
              const w = fs.watch(sub, onJsonlChange);
              linuxSubWatchers.push(w);
            }
          } catch { /* ignore */ }
        }
      });
      // Watch existing subdirectories
      try {
        const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const w = fs.watch(path.join(PROJECTS_DIR, entry.name), onJsonlChange);
            linuxSubWatchers.push(w);
          }
        }
      } catch { /* ignore */ }
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
  // Ensure data directory exists
  try { fs.mkdirSync(CLAUDE_DIR, { recursive: true }); } catch { /* ignore */ }

  loadSettings();
  cachedUsage = loadCachedUsage();
  usageHistory = loadHistory();

  ensureLinuxShortcut();
  createWindow();

  // Tray
  tray = new Tray(getTrayIcon());
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => toggleWindow());
  updateTrayTooltip();

  // Global hotkey
  globalShortcut.register(currentHotkey, () => toggleWindow());

  // IPC sender validation helper
  const isLocalSender = (event) => {
    try {
      return event.senderFrame && event.senderFrame.url.startsWith('file://');
    } catch { return false; }
  };

  // IPC
  ipcMain.on('popup-dismiss', (event) => {
    if (!isLocalSender(event)) return;
    if (alertPopup && !alertPopup.isDestroyed()) alertPopup.close();
  });

  ipcMain.on('request-sync', (event) => {
    if (!isLocalSender(event)) return;
    rateLimitUntil = 0; // manual refresh always forces through
    doSync();
  });
  ipcMain.on('minimize-to-tray', (event) => {
    if (!isLocalSender(event)) return;
    if (win) { saveBoundsNow(); win.hide(); }
  });
  ipcMain.on('quit-app', (event) => {
    if (!isLocalSender(event)) return;
    if (win && !win.isDestroyed()) win.destroy();
    app.quit();
  });

  ipcMain.on('toggle-compact', (event, isCompact) => {
    if (!isLocalSender(event)) return;
    if (!win) return;
    const bounds = win.getBounds();
    if (isCompact) {
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 160 });
    } else {
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 450 });
    }
  });

  ipcMain.on('open-dashboard', (event) => {
    if (!isLocalSender(event)) return;
    openDashboard();
  });

  // Auth status check for first-launch onboarding
  ipcMain.handle('check-auth-status', () => {
    const token = getAccessToken();
    // Check if claude CLI is in PATH
    let cliInstalled = false;
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const { execFileSync } = require('child_process');
      execFileSync(cmd, ['claude'], { stdio: 'ignore' });
      cliInstalled = true;
    } catch { /* not found */ }
    return {
      authenticated: !!token,
      claudeCodeInstalled: cliInstalled,
      credentialsExist: fs.existsSync(CREDS_FILE),
    };
  });

  // Launch claude auth login from the app
  ipcMain.handle('launch-auth-login', () => {
    try {
      // Find claude CLI path
      const { execFileSync } = require('child_process');
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const lines = execFileSync(cmd, ['claude'], { encoding: 'utf-8' })
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      // On Windows, prefer the .cmd version (directly spawnable)
      const claudePath = (process.platform === 'win32'
        ? lines.find((l) => /\.cmd$/i.test(l))
        : null) || lines[0];
      if (!claudePath) return { success: false, error: 'Claude CLI not found' };

      // spawn via shell on Windows (.cmd needs it), hidden terminal
      const child = spawn(claudePath, ['auth', 'login'], {
        stdio: 'ignore',
        detached: true,
        shell: process.platform === 'win32',
        windowsHide: true,
      });
      child.unref();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Open external URL safely (only allow https)
  ipcMain.on('open-external-url', (event, url) => {
    if (!isLocalSender(event)) return;
    if (typeof url === 'string' && url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  // Watch for credentials file to appear (first-time setup)
  let credsWatcher = null;
  function watchForCredentials() {
    if (credsWatcher) return;
    // Already authenticated — no need to watch
    if (getAccessToken()) return;
    try {
      // Ensure directory exists before watching
      fs.mkdirSync(CLAUDE_DIR, { recursive: true });
      credsWatcher = fs.watch(CLAUDE_DIR, (_, filename) => {
        if (filename === '.credentials.json') {
          const token = getAccessToken(true);
          if (token) {
            // Credentials appeared — notify renderer and sync
            signedOut = false;
            if (win && !win.isDestroyed()) {
              win.webContents.send('auth-status-changed', { authenticated: true });
            }
            doSync();
            // Stop watching
            if (credsWatcher) { credsWatcher.close(); credsWatcher = null; }
          }
        }
      });
    } catch { /* ignore watch errors */ }
  }
  watchForCredentials();

  ipcMain.on('dash-minimize', (event) => { if (isLocalSender(event) && dashWin && !dashWin.isDestroyed()) dashWin.minimize(); });
  ipcMain.on('dash-maximize', (event) => {
    if (!isLocalSender(event)) return;
    if (dashWin && !dashWin.isDestroyed()) {
      dashWin.isMaximized() ? dashWin.unmaximize() : dashWin.maximize();
    }
  });
  ipcMain.on('dash-close', (event) => { if (isLocalSender(event) && dashWin && !dashWin.isDestroyed()) dashWin.close(); });

  ipcMain.on('dashboard-request-data', (event) => {
    if (!isLocalSender(event)) return;
    if (dashWin && !dashWin.isDestroyed()) {
      if (cachedUsage) dashWin.webContents.send('usage-update', cachedUsage);
      if (usageHistory.length > 0) dashWin.webContents.send('history-update', usageHistory);
    }
    syncIfStale();
  });

  ipcMain.on('dashboard-save-settings', (event, settings) => {
    if (!isLocalSender(event)) return;
    if (!settings || typeof settings !== 'object') return;
    if (settings.alertThresholds && typeof settings.alertThresholds === 'object') {
      const t = settings.alertThresholds;
      const clampThreshold = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.min(100, Math.max(5, Math.round(n)));
      };
      const keys = ['session', 'weekAll', 'weekSonnet'];
      for (const key of keys) {
        if (t[key] != null) {
          const raw = typeof t[key] === 'object' ? t[key].value : t[key];
          const val = clampThreshold(raw);
          if (val !== null) ALERT_THRESHOLDS[key] = val;
        }
      }
    }
    saveSettings();
  });

  ipcMain.handle('change-hotkey', async (event, newHotkey) => {
    if (!isLocalSender(event)) return { success: false, error: 'Unauthorized' };
    if (typeof newHotkey !== 'string' || newHotkey.length === 0
      || newHotkey.length > 50 || !SAFE_HOTKEY_RE.test(newHotkey)) {
      return { success: false, error: 'Invalid hotkey format' };
    }
    try {
      globalShortcut.unregister(currentHotkey);
      const registered = globalShortcut.register(newHotkey, () => toggleWindow());
      if (!registered) {
        // Re-register old hotkey if new one fails
        globalShortcut.register(currentHotkey, () => toggleWindow());
        return { success: false, error: 'Hotkey already in use or invalid' };
      }
      currentHotkey = newHotkey;
      saveSettings();
      // Update tray menu to reflect new hotkey
      if (tray) tray.setContextMenu(buildTrayMenu());
      return { success: true, hotkey: currentHotkey };
    } catch (err) {
      // Try to restore old hotkey
      try { globalShortcut.register(currentHotkey, () => toggleWindow()); } catch { /* ignore */ }
      return { success: false, error: err.message || 'Failed to register hotkey' };
    }
  });

  ipcMain.handle('get-settings', async () => {
    return {
      hotkey: currentHotkey,
      version: (APP_VERSION || app.getVersion()),
      alertThresholds: {
        session: ALERT_THRESHOLDS.session,
        weekAll: ALERT_THRESHOLDS.weekAll,
        weekSonnet: ALERT_THRESHOLDS.weekSonnet,
      },
    };
  });

  ipcMain.handle('sign-out', async (event) => {
    if (!isLocalSender(event)) return { success: false, error: 'Unauthorized' };
    cachedToken = null;
    tokenLastRead = 0;
    signedOut = true;
    // Show widget with login overlay
    if (win && !win.isDestroyed()) {
      win.webContents.send('auth-status-changed', { authenticated: false });
      win.show();
    }
    // Watch for re-authentication
    watchForCredentials();
    return { success: true };
  });

  ipcMain.handle('get-autostart', async () => {
    return { enabled: getAutoStartEnabled() };
  });

  ipcMain.handle('set-autostart', async (event, enabled) => {
    if (!isLocalSender(event)) return { success: false };
    setAutoStartEnabled(enabled);
    return { success: true, enabled: getAutoStartEnabled() };
  });

  ipcMain.handle('check-for-updates', async () => {
    const result = await checkForUpdates();
    if (result.hasUpdate) {
      lastUpdateResult = result;
    }
    return result;
  });

  ipcMain.handle('download-and-install-update', async (event) => {
    if (!isLocalSender(event)) return { success: false, error: 'Unauthorized' };
    // Use the URL from the main-process update check — never trust renderer input
    const downloadUrl = lastUpdateResult?.downloadUrl;
    if (!downloadUrl) {
      return { success: false, error: 'No update URL available' };
    }
    // Validate URL — only allow GitHub releases
    try {
      const parsed = new URL(downloadUrl);
      const allowedHosts = ['github.com', 'objects.githubusercontent.com',
        'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com',
        'github-production-release-asset-2e65be.s3.amazonaws.com'];
      if (!allowedHosts.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
        return { success: false, error: 'Untrusted download host' };
      }
      if (parsed.protocol !== 'https:') {
        return { success: false, error: 'HTTPS required' };
      }
    } catch {
      return { success: false, error: 'Invalid download URL' };
    }

    try {
      const installerPath = await downloadAndInstallUpdate(downloadUrl);
      // Launch installer detached, then quit
      try {
        if (process.platform === 'darwin' && /\.dmg$/i.test(installerPath)) {
          // macOS: open the .dmg via Finder
          spawn('open', [installerPath], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        } else if (process.platform === 'linux' && /\.AppImage$/i.test(installerPath)) {
          // Linux AppImage: replace the running AppImage, then relaunch
          fs.chmodSync(installerPath, 0o755);
          const currentAppImage = process.env.APPIMAGE;
          if (currentAppImage) {
            // Can't overwrite a running binary — rename old, move new in
            const backupPath = currentAppImage + '.old';
            try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
            fs.renameSync(currentAppImage, backupPath);
            try {
              // rename is atomic but fails across devices; fall back to copy
              fs.renameSync(installerPath, currentAppImage);
            } catch {
              fs.copyFileSync(installerPath, currentAppImage);
              fs.unlinkSync(installerPath);
            }
            fs.chmodSync(currentAppImage, 0o755);
            try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
            spawn(currentAppImage, [], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          } else {
            // Not running as AppImage (dev mode) — just launch from tmp
            spawn(installerPath, [], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          }
        } else {
          // Windows .exe or Linux .deb (deb handled via dpkg/gdebi by user)
          if (process.platform === 'linux' && /\.deb$/i.test(installerPath)) {
            // For .deb, open with default handler (e.g. software center)
            spawn('xdg-open', [installerPath], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          } else {
            spawn(installerPath, [], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          }
        }
      } catch (spawnErr) {
        fs.unlink(installerPath, () => {});
        return { success: false, error: 'Failed to launch installer: ' + spawnErr.message };
      }
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.destroy();
        app.quit();
      }, 500);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Send cached data on load, then sync — but only if authenticated
  win.webContents.on('did-finish-load', () => {
    const token = getAccessToken();
    if (token) {
      if (cachedUsage) win.webContents.send('usage-update', cachedUsage);
      if (usageHistory.length > 0) win.webContents.send('history-update', usageHistory);
      if (!syncing) syncIfStale();
    }
    // Re-send cached update result so renderer never misses it
    if (lastUpdateResult && lastUpdateResult.hasUpdate) {
      win.webContents.send('update-available', lastUpdateResult);
    }
  });

  // Auto-refresh: 5min when visible, no background polling
  setInterval(() => {
    if (win && win.isVisible()) syncIfStale();
  }, 300000);

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
    // PC woke up — reset state, clear stale token, and sync
    syncing = false;
    syncStartedAt = 0;
    activeRequest = null;
    cachedToken = null; // force re-read — token may have expired during sleep
    clearRetryTimer(); // reset retry state for a fresh start
    // Wait 2s for network stack to reconnect after wake
    setTimeout(() => doSync(), 2000);
  });

  // Check for updates on start, then every 24h
  const broadcastUpdate = (result) => {
    if (!result.hasUpdate) return;
    lastUpdateResult = result;
    if (win && !win.isDestroyed()) win.webContents.send('update-available', result);
    if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('update-available', result);
  };

  setTimeout(async () => broadcastUpdate(await checkForUpdates()), 10000);
  setInterval(async () => broadcastUpdate(await checkForUpdates()), UPDATE_CHECK_INTERVAL);

});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (fileWatcher) fileWatcher.close();
  for (const w of linuxSubWatchers) { try { w.close(); } catch {} }
  linuxSubWatchers = [];
  if (fileChangeTimer) { clearTimeout(fileChangeTimer); fileChangeTimer = null; }
  clearRetryTimer();
  if (boundsDebounce) { clearTimeout(boundsDebounce); boundsDebounce = null; }
});

app.on('window-all-closed', () => {
  // Stay in tray
});
