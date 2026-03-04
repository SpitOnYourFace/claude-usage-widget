# Claude Meter v2.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade Claude Meter from a simple 3-bar widget to a two-window system with sparklines, countdown timers, animated numbers, usage history, desktop notifications, a full dashboard, and auto-update checks.

**Architecture:** The existing single-window Electron app (`main.js`, `renderer.js`, `index.html`, `preload.js`) gets enhanced with history persistence, notification logic, and a second dashboard window. Both windows share state through `main.js` via IPC. No new dependencies — vanilla JS, Canvas for charts, SVG for sparklines.

**Tech Stack:** Electron 33, vanilla JavaScript, Canvas 2D API, SVG polylines, Node.js `fs`/`https`/`os` modules.

---

## Phase 1: History Persistence

### Task 1: Add history file constants and load/save functions

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/main.js:17-35`

**Step 1: Add history constants and state**

Add after the existing constants block (line 22), before `let win = null` (line 27):

```js
const HISTORY_FILE = path.join(CLAUDE_DIR, 'usage-widget-history.json');
const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
```

Add after `let lastAutoSync = 0;` (line 35):

```js
let usageHistory = [];
```

**Step 2: Add history load/save functions**

Add after the `saveCachedUsage` function (after line 91):

```js
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
    }));
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
```

**Step 3: Wire history into doSync and app startup**

In `doSync()` (line 242), after `saveCachedUsage(cachedUsage);` (line 247), add:

```js
    appendHistory(cachedUsage);
```

In `app.whenReady()` (line 418), after `cachedUsage = loadCachedUsage();` (line 419), add:

```js
  usageHistory = loadHistory();
```

**Step 4: Verify manually**

Run: `npm start`
- Open widget (Ctrl+\), wait for sync
- Check `~/.claude/usage-widget-history.json` exists with `version: 1` and `points` array
- Wait for a second sync — verify no duplicate point if values unchanged
- Close and reopen app — verify history persists

**Step 5: Commit**

```bash
git add main.js
git commit -m "feat: add usage history persistence with 30-day rolling window"
```

---

## Phase 2: Widget Polish

### Task 2: Add live countdown timer

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/renderer.js:10-23`
- Modify: `C:/Users/USER/claude-usage-widget/renderer.js:119-126`

**Step 1: Add formatCountdown function**

Replace the existing `formatResetTime` function (lines 10-23) with:

```js
function formatResetTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  var diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Resetting...';
  // If more than 24h, show date
  if (diff > 86400000) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    var min = d.getMinutes();
    var minStr = min > 0 ? ':' + (min < 10 ? '0' : '') + min : '';
    return 'Resets ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + minStr + ampm;
  }
  // Under 24h: live countdown
  var hours = Math.floor(diff / 3600000);
  var mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return 'Resets in ' + hours + 'h ' + mins + 'm';
  return 'Resets in ' + mins + 'm';
}
```

**Step 2: Update countdown every second**

Replace the existing "synced X ago" interval (lines 119-126) with:

```js
// Update countdown + "synced X ago" every second
setInterval(function() {
  if (!usageData) return;
  // Re-render reset times (countdown updates)
  renderAll();
}, 1000);
```

**Step 3: Verify manually**

Run: `npm start`
- Check session row shows "Resets in Xh Ym" instead of static date
- Watch for ~10 seconds — countdown should tick down
- If reset is >24h away, should show date format

**Step 4: Commit**

```bash
git add renderer.js
git commit -m "feat: add live countdown timer for reset times"
```

---

### Task 3: Add animated percentage numbers

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/renderer.js:31-46`
- Modify: `C:/Users/USER/claude-usage-widget/renderer.js:1`

**Step 1: Add animation state tracking**

Replace `var usageData = null;` (line 1) with:

```js
var usageData = null;
var prevPcts = { session: 0, weekAll: 0, weekSonnet: 0 };
var animatingPcts = { session: 0, weekAll: 0, weekSonnet: 0 };
var animationFrame = null;
```

**Step 2: Add animatePct function**

Add after the `getBarClass` function (after line 29):

```js
function animateNumbers(from, to, key, duration) {
  var start = performance.now();
  function step(now) {
    var elapsed = now - start;
    var progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    var eased = 1 - Math.pow(1 - progress, 3);
    animatingPcts[key] = Math.round(from + (to - from) * eased);
    var el = document.getElementById(key + 'Pct');
    if (el) el.textContent = animatingPcts[key] + '% used';
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
```

**Step 3: Update renderUsageRow to use animation**

Replace the `renderUsageRow` function (lines 31-46) with:

```js
function renderUsageRow(container, data, key) {
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!data) return;
  container.appendChild(createElement('div', 'usage-label', data.label));
  var barContainer = createElement('div', 'bar-container');
  var track = createElement('div', 'bar-track');
  var fill = createElement('div', 'bar-fill ' + getBarClass(data.pct));
  fill.style.width = Math.max(1, data.pct) + '%';
  track.appendChild(fill);
  barContainer.appendChild(track);
  var pctEl = createElement('div', 'bar-pct', data.pct + '% used');
  if (key) pctEl.id = key + 'Pct';
  barContainer.appendChild(pctEl);
  container.appendChild(barContainer);
  if (data.resetsAt) {
    container.appendChild(createElement('div', 'reset-info', formatResetTime(data.resetsAt)));
  }
}
```

**Step 4: Update renderAll to trigger animations**

Replace the `renderAll` function (lines 48-67) with:

```js
function renderAll() {
  if (!usageData) return;
  renderUsageRow(document.getElementById('sessionRow'), usageData.session, 'session');
  renderUsageRow(document.getElementById('weekAllRow'), usageData.weekAll, 'weekAll');
  renderUsageRow(document.getElementById('weekSonnetRow'), usageData.weekSonnet, 'weekSonnet');

  var extra = document.getElementById('extraInfo');
  if (usageData.extraUsage && usageData.extraUsage.enabled) {
    var util = Number(usageData.extraUsage.utilization);
    extra.textContent = Number.isFinite(util) ? util + '% used' : 'Enabled';
  } else {
    extra.textContent = 'Not enabled';
  }

  if (usageData.syncTime) {
    var ago = Math.round((Date.now() - usageData.syncTime) / 60000);
    document.getElementById('footerHint').textContent =
      ago < 1 ? 'Synced just now' : 'Synced ' + ago + 'm ago';
  }
}
```

**Step 5: Trigger animations on usage update**

Replace the `onUsageUpdate` handler (lines 102-106) with:

```js
window.electronAPI.onUsageUpdate(function(data) {
  var oldData = usageData;
  usageData = data;
  renderAll();
  setSyncStatus('live');

  // Animate percentage changes
  if (oldData) {
    var keys = ['session', 'weekAll', 'weekSonnet'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var oldPct = oldData[k] ? oldData[k].pct : 0;
      var newPct = data[k] ? data[k].pct : 0;
      if (oldPct !== newPct) {
        animateNumbers(oldPct, newPct, k, 600);
      }
    }
  }
});
```

**Step 6: Verify manually**

Run: `npm start`
- Watch a sync cycle — percentages should count up/down smoothly over 600ms
- Bar widths should transition via existing CSS `transition: width 0.8s`

**Step 7: Commit**

```bash
git add renderer.js
git commit -m "feat: add animated percentage number transitions"
```

---

### Task 4: Add inline sparkline trends

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/preload.js`
- Modify: `C:/Users/USER/claude-usage-widget/main.js`
- Modify: `C:/Users/USER/claude-usage-widget/renderer.js`
- Modify: `C:/Users/USER/claude-usage-widget/index.html`

**Step 1: Expose history data via IPC**

In `preload.js`, add to the `contextBridge.exposeInMainWorld` object (before line 26 closing `});`):

```js
  onHistoryUpdate: (cb) => {
    let handler = null;
    if (handler) ipcRenderer.removeListener('history-update', handler);
    handler = (_e, data) => cb(data);
    ipcRenderer.on('history-update', handler);
  },
```

In `main.js`, in the `doSync()` function, after the `appendHistory(cachedUsage);` line added in Task 1, add:

```js
    if (win && !win.isDestroyed()) {
      win.webContents.send('history-update', usageHistory);
    }
```

Also in `main.js`, in the `did-finish-load` handler (line 438), after `if (cachedUsage) win.webContents.send('usage-update', cachedUsage);`, add:

```js
    if (usageHistory.length > 0) win.webContents.send('history-update', usageHistory);
```

**Step 2: Add sparkline CSS**

In `index.html`, add after `.bar-pct` styles (after line 101):

```css
  .sparkline {
    width: 60px; height: 14px;
    flex-shrink: 0;
  }
  .sparkline polyline {
    fill: none;
    stroke: var(--bar-fill);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .sparkline.warning polyline { stroke: var(--yellow); }
  .sparkline.danger polyline { stroke: var(--red); }
```

**Step 3: Add sparkline rendering in renderer.js**

Add after the `animateNumbers` function:

```js
var historyData = [];

function buildSparklineSVG(key, pct) {
  // Get last 24h of data for this key
  var cutoff = Date.now() - 86400000;
  var points = [];
  for (var i = 0; i < historyData.length; i++) {
    if (historyData[i].ts > cutoff) {
      points.push(historyData[i][key]);
    }
  }
  if (points.length < 2) return null;

  // Downsample to max 30 points
  if (points.length > 30) {
    var step = points.length / 30;
    var sampled = [];
    for (var j = 0; j < 30; j++) {
      sampled.push(points[Math.floor(j * step)]);
    }
    points = sampled;
  }

  var w = 60, h = 14;
  var maxVal = Math.max.apply(null, points.concat([1])); // avoid div by 0
  var coords = [];
  for (var k = 0; k < points.length; k++) {
    var x = (k / (points.length - 1)) * w;
    var y = h - (points[k] / Math.max(maxVal, 100)) * (h - 2) - 1;
    coords.push(x.toFixed(1) + ',' + y.toFixed(1));
  }

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('class', 'sparkline ' + getBarClass(pct));
  var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', coords.join(' '));
  svg.appendChild(polyline);
  return svg;
}
```

**Step 4: Update renderUsageRow to include sparkline**

In the `renderUsageRow` function, after `barContainer.appendChild(pctEl);` and before `container.appendChild(barContainer);`, add:

```js
  if (key) {
    var spark = buildSparklineSVG(key, data.pct);
    if (spark) barContainer.appendChild(spark);
  }
```

**Step 5: Add history update listener**

Add after the `onSyncError` handler:

```js
window.electronAPI.onHistoryUpdate(function(data) {
  historyData = data;
});
```

**Step 6: Verify manually**

Run: `npm start`
- After a few sync cycles, tiny sparkline SVGs should appear next to each bar
- Sparklines should show the last 24h trend
- Color should match bar state (normal/warning/danger)

**Step 7: Commit**

```bash
git add main.js preload.js renderer.js index.html
git commit -m "feat: add inline sparkline trends next to usage bars"
```

---

### Task 5: Add compact mode toggle

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/index.html`
- Modify: `C:/Users/USER/claude-usage-widget/renderer.js`
- Modify: `C:/Users/USER/claude-usage-widget/main.js`

**Step 1: Add compact CSS**

In `index.html`, add before the closing `</style>` tag:

```css
  /* Compact mode */
  body.compact .usage-label { display: none; }
  body.compact .reset-info { display: none; }
  body.compact .extra-section { display: none; }
  body.compact .bar-track { height: 10px; }
  body.compact .usage-row { margin-bottom: 8px; }
  body.compact .widget { padding: 12px 16px; }
  body.compact .header { margin-bottom: 12px; }
  body.compact .sparkline { display: none; }
```

**Step 2: Add double-click toggle in renderer.js**

Add after the `closeBtn` click handler:

```js
// Double-click title bar to toggle compact mode
document.querySelector('.header').addEventListener('dblclick', function() {
  document.body.classList.toggle('compact');
  window.electronAPI.toggleCompact(document.body.classList.contains('compact'));
});
```

**Step 3: Add IPC for compact mode window resize**

In `preload.js`, add to the exposed API:

```js
  toggleCompact: (isCompact) => ipcRenderer.send('toggle-compact', isCompact),
```

In `main.js`, add after the `ipcMain.on('quit-app', ...)` line:

```js
  ipcMain.on('toggle-compact', (_, isCompact) => {
    if (!win) return;
    const bounds = win.getBounds();
    if (isCompact) {
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 160 });
    } else {
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 400 });
    }
  });
```

**Step 4: Verify manually**

Run: `npm start`
- Double-click the title bar header — widget should shrink to compact (just bars + percentages)
- Double-click again — should expand back to full size
- Labels, reset times, extra usage, sparklines should hide in compact mode

**Step 5: Commit**

```bash
git add index.html renderer.js preload.js main.js
git commit -m "feat: add compact mode toggle via double-click"
```

---

## Phase 3: Desktop Notifications

### Task 6: Add threshold-based desktop notifications

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/main.js`

**Step 1: Add notification constants and state**

Add after `let usageHistory = [];` (added in Task 1):

```js
let lastAlertTimes = { session: 0, weekAll: 0, weekSonnet: 0 };
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const ALERT_THRESHOLDS = { session: 80, weekAll: 90, weekSonnet: 90 };
```

**Step 2: Add notification function**

Add after the `appendHistory` function:

```js
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
```

**Step 3: Wire into doSync**

In `doSync()`, after `appendHistory(cachedUsage);`, add:

```js
    checkAndNotify(cachedUsage);
```

**Step 4: Verify manually**

Run: `npm start`
- If session usage is above 80%, a desktop notification should appear
- Same notification should NOT repeat within 30 minutes
- Clicking the notification should show the widget

**Step 5: Commit**

```bash
git add main.js
git commit -m "feat: add desktop notifications at usage thresholds"
```

---

### Task 7: Add alert dot on tray icon

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/main.js`

**Step 1: Add tray badge state**

Add after `const ALERT_THRESHOLDS = ...`:

```js
let trayHasAlert = false;
```

**Step 2: Add tray badge function**

Add after the `checkAndNotify` function:

```js
function updateTrayBadge(usage) {
  if (!tray) return;
  const hasAlert = usage.session.pct >= ALERT_THRESHOLDS.session
    || usage.weekAll.pct >= ALERT_THRESHOLDS.weekAll
    || usage.weekSonnet.pct >= ALERT_THRESHOLDS.weekSonnet;

  if (hasAlert !== trayHasAlert) {
    trayHasAlert = hasAlert;
    if (hasAlert) {
      // Create icon with red dot overlay
      const baseIcon = getTrayIcon();
      const size = baseIcon.getSize();
      const canvas = nativeImage.createEmpty();
      // Use SVG overlay approach
      const dotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        <circle cx="12" cy="4" r="3.5" fill="#f87171"/>
      </svg>`;
      const dotImage = nativeImage.createFromDataURL(
        'data:image/svg+xml;base64,' + Buffer.from(dotSvg).toString('base64')
      );
      // Electron doesn't support compositing natively, so set the dot icon as overlay
      // On Windows, use setImage with a modified icon
      tray.setImage(baseIcon);
      // Use overlay icon on Windows (shows as badge)
      if (process.platform === 'win32' && win) {
        win.setOverlayIcon(dotImage, 'Usage alert');
      }
    } else {
      tray.setImage(getTrayIcon());
      if (process.platform === 'win32' && win) {
        win.setOverlayIcon(null, '');
      }
    }
  }
}
```

**Step 3: Wire into doSync**

In `doSync()`, after `checkAndNotify(cachedUsage);`, add:

```js
    updateTrayBadge(cachedUsage);
```

**Step 4: Clear badge when widget is shown**

In `toggleWindow()`, inside the `else` branch (when showing window), after `doSync();` add:

```js
    trayHasAlert = false;
    if (process.platform === 'win32' && win) win.setOverlayIcon(null, '');
```

**Step 5: Verify manually**

Run: `npm start`
- If any threshold is exceeded, taskbar overlay icon should appear (Windows)
- Opening the widget should clear the badge

**Step 6: Commit**

```bash
git add main.js
git commit -m "feat: add alert badge overlay on tray/taskbar icon"
```

---

## Phase 4: Dashboard Window

### Task 8: Create dashboard window infrastructure

**Files:**
- Create: `C:/Users/USER/claude-usage-widget/dashboard-preload.js`
- Create: `C:/Users/USER/claude-usage-widget/dashboard.html`
- Create: `C:/Users/USER/claude-usage-widget/dashboard.js`
- Modify: `C:/Users/USER/claude-usage-widget/main.js`
- Modify: `C:/Users/USER/claude-usage-widget/preload.js`
- Modify: `C:/Users/USER/claude-usage-widget/package.json`

**Step 1: Create dashboard-preload.js**

```js
const { contextBridge, ipcRenderer } = require('electron');

let usageHandler = null;
let historyHandler = null;
let settingsHandler = null;

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
  onSettingsUpdate: (cb) => {
    if (settingsHandler) ipcRenderer.removeListener('settings-update', settingsHandler);
    settingsHandler = (_e, data) => cb(data);
    ipcRenderer.on('settings-update', settingsHandler);
  },
});
```

**Step 2: Create dashboard.html skeleton**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self';">
<title>Claude Meter — Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0c0c12;
    --surface: #13131d;
    --surface2: #1b1b28;
    --border: #2a2a3d;
    --text: #e2e2f0;
    --text-dim: #7e7e98;
    --accent: #d4845a;
    --green: #4ade80;
    --yellow: #facc15;
    --red: #f87171;
    --bar-bg: #252538;
    --bar-fill: #7c7cba;
  }
  body {
    font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    display: flex;
  }
  .sidebar {
    width: 200px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 20px 0;
    flex-shrink: 0;
  }
  .sidebar-title {
    font-size: 16px; font-weight: 700;
    padding: 0 20px; margin-bottom: 24px;
    color: var(--accent);
  }
  .sidebar-nav { list-style: none; }
  .sidebar-nav li {
    padding: 10px 20px;
    font-size: 13px; font-weight: 500;
    cursor: pointer;
    border-left: 3px solid transparent;
    transition: all 0.2s;
  }
  .sidebar-nav li:hover { background: var(--surface2); }
  .sidebar-nav li.active {
    background: var(--surface2);
    border-left-color: var(--accent);
    color: var(--accent);
  }
  .main {
    flex: 1;
    padding: 24px 32px;
    overflow-y: auto;
  }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .section-title {
    font-size: 18px; font-weight: 700;
    margin-bottom: 20px;
  }

  /* Overview cards */
  .usage-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 12px;
  }
  .usage-card-label { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
  .usage-card-bar {
    height: 20px; background: var(--bar-bg);
    border-radius: 4px; overflow: hidden; margin-bottom: 6px;
  }
  .usage-card-fill {
    height: 100%; border-radius: 4px;
    background: var(--bar-fill);
    transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .usage-card-fill.warning { background: var(--yellow); }
  .usage-card-fill.danger { background: var(--red); }
  .usage-card-meta {
    display: flex; justify-content: space-between;
    font-size: 12px; color: var(--text-dim);
    font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
  }

  /* Session planner */
  .planner {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin-top: 16px;
  }
  .planner-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .planner-text { font-size: 12px; color: var(--text-dim); }

  /* History chart */
  .chart-container {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .chart-controls {
    display: flex; gap: 8px; margin-bottom: 12px;
  }
  .chart-btn {
    padding: 4px 12px;
    font-size: 12px; font-weight: 600;
    background: var(--surface2);
    color: var(--text-dim);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .chart-btn.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  #historyCanvas {
    width: 100%;
    height: 300px;
    display: block;
  }

  /* Alerts config */
  .alert-row {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 20px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .alert-label { font-size: 13px; font-weight: 500; }
  .alert-value {
    font-size: 13px; font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    color: var(--accent);
  }
  .alert-controls {
    display: flex; gap: 6px; align-items: center;
  }
  .alert-btn {
    width: 24px; height: 24px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .alert-btn:hover { background: var(--border); }

  /* Settings */
  .setting-row {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 20px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .setting-label { font-size: 13px; }
  .setting-value { font-size: 12px; color: var(--text-dim); font-family: monospace; }
  .setting-btn {
    padding: 6px 14px;
    font-size: 12px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
  }
  .setting-btn:hover { background: var(--border); }
  .update-banner {
    display: none;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 12px 20px;
    margin-bottom: 16px;
    font-size: 13px;
  }
  .update-banner.visible { display: flex; justify-content: space-between; align-items: center; }
  .version-info { font-size: 11px; color: var(--text-dim); margin-top: 16px; }
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-title">Claude Meter</div>
  <ul class="sidebar-nav">
    <li class="active" data-tab="overview">Overview</li>
    <li data-tab="history">History</li>
    <li data-tab="alerts">Alerts</li>
    <li data-tab="settings">Settings</li>
  </ul>
</div>

<div class="main">
  <div class="tab-content active" id="tab-overview">
    <div class="section-title">Usage Overview</div>
    <div id="overviewCards"></div>
    <div class="planner" id="sessionPlanner">
      <div class="planner-title">Session Planner</div>
      <div class="planner-text" id="plannerText">Waiting for data...</div>
    </div>
  </div>

  <div class="tab-content" id="tab-history">
    <div class="section-title">Usage History</div>
    <div class="chart-container">
      <div class="chart-controls">
        <button class="chart-btn active" data-days="7">7d</button>
        <button class="chart-btn" data-days="14">14d</button>
        <button class="chart-btn" data-days="30">30d</button>
      </div>
      <canvas id="historyCanvas"></canvas>
    </div>
  </div>

  <div class="tab-content" id="tab-alerts">
    <div class="section-title">Alert Thresholds</div>
    <div id="alertRows"></div>
  </div>

  <div class="tab-content" id="tab-settings">
    <div class="section-title">Settings</div>
    <div class="update-banner" id="updateBanner">
      <span id="updateText"></span>
    </div>
    <div id="settingRows"></div>
    <div class="version-info" id="versionInfo"></div>
  </div>
</div>

<script src="dashboard.js"></script>
</body>
</html>
```

**Step 3: Create dashboard.js**

```js
// dashboard.js — all rendering uses safe DOM methods (no innerHTML)

var usageData = null;
var historyData = [];
var chartDays = 7;

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function getBarClass(pct) {
  if (pct >= 85) return 'danger';
  if (pct >= 60) return 'warning';
  return '';
}

function formatCountdown(ts) {
  if (!ts) return '';
  var diff = new Date(ts).getTime() - Date.now();
  if (diff <= 0) return 'Resetting...';
  var hours = Math.floor(diff / 3600000);
  var mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return 'Resets in ' + hours + 'h ' + mins + 'm';
  return 'Resets in ' + mins + 'm';
}

// --- Tab navigation ---

document.querySelectorAll('.sidebar-nav li').forEach(function(li) {
  li.addEventListener('click', function() {
    document.querySelectorAll('.sidebar-nav li').forEach(function(el) { el.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
    li.classList.add('active');
    var tab = document.getElementById('tab-' + li.dataset.tab);
    if (tab) tab.classList.add('active');
    if (li.dataset.tab === 'history') drawChart();
  });
});

// --- Overview ---

function renderOverview() {
  var container = document.getElementById('overviewCards');
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!usageData) return;

  var rows = [
    { label: 'Current session', data: usageData.session },
    { label: 'Current week (all models)', data: usageData.weekAll },
    { label: 'Current week (Sonnet only)', data: usageData.weekSonnet },
  ];

  for (var i = 0; i < rows.length; i++) {
    var card = el('div', 'usage-card');
    card.appendChild(el('div', 'usage-card-label', rows[i].label));
    var bar = el('div', 'usage-card-bar');
    var fill = el('div', 'usage-card-fill ' + getBarClass(rows[i].data.pct));
    fill.style.width = Math.max(1, rows[i].data.pct) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);
    var meta = el('div', 'usage-card-meta');
    meta.appendChild(el('span', null, rows[i].data.pct + '% used'));
    meta.appendChild(el('span', null, formatCountdown(rows[i].data.resetsAt)));
    card.appendChild(meta);
    container.appendChild(card);
  }

  // Extra usage
  if (usageData.extraUsage) {
    var extraCard = el('div', 'usage-card');
    extraCard.appendChild(el('div', 'usage-card-label', 'Extra usage'));
    var extraText = usageData.extraUsage.enabled
      ? (Number.isFinite(Number(usageData.extraUsage.utilization))
        ? usageData.extraUsage.utilization + '% used' : 'Enabled')
      : 'Not enabled';
    extraCard.appendChild(el('div', 'usage-card-meta').appendChild(el('span', null, extraText)).parentNode);
    container.appendChild(extraCard);
  }

  // Session planner
  var plannerText = document.getElementById('plannerText');
  if (usageData.session.pct > 0 && usageData.session.resetsAt) {
    var resetDiff = new Date(usageData.session.resetsAt).getTime() - Date.now();
    if (resetDiff > 0 && usageData.session.pct < 100) {
      var hoursLeft = resetDiff / 3600000;
      var ratePerHour = usageData.session.pct / (5 - hoursLeft); // 5h session window
      var hitsLimit = ratePerHour > 0 ? (100 - usageData.session.pct) / ratePerHour : Infinity;
      if (Number.isFinite(hitsLimit) && hitsLimit > 0) {
        var h = Math.floor(hitsLimit);
        var m = Math.round((hitsLimit - h) * 60);
        plannerText.textContent = 'At current rate, you\'ll hit the session limit in ~' + h + 'h ' + m + 'm';
      } else {
        plannerText.textContent = 'Usage rate too low to estimate';
      }
    } else {
      plannerText.textContent = usageData.session.pct >= 100
        ? 'Session limit reached. Waiting for reset.'
        : 'No active session data';
    }
  } else {
    plannerText.textContent = 'No session data yet';
  }
}

// --- History chart ---

function drawChart() {
  var canvas = document.getElementById('historyCanvas');
  var rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width - 32;
  canvas.height = 300;
  var ctx = canvas.getContext('2d');
  var w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  var cutoff = Date.now() - chartDays * 86400000;
  var points = historyData.filter(function(p) { return p.ts > cutoff; });

  // Grid
  ctx.strokeStyle = '#2a2a3d';
  ctx.lineWidth = 1;
  for (var y = 0; y <= 100; y += 25) {
    var py = h - 20 - (y / 100) * (h - 40);
    ctx.beginPath();
    ctx.moveTo(40, py);
    ctx.lineTo(w, py);
    ctx.stroke();
    ctx.fillStyle = '#7e7e98';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(y + '%', 36, py + 4);
  }

  if (points.length < 2) {
    ctx.fillStyle = '#7e7e98';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Not enough data yet', w / 2, h / 2);
    return;
  }

  var tsMin = points[0].ts;
  var tsMax = points[points.length - 1].ts;
  var tsRange = tsMax - tsMin || 1;

  var series = [
    { key: 'session', color: '#d4845a', label: 'Session' },
    { key: 'weekAll', color: '#7c7cba', label: 'Week (all)' },
    { key: 'weekSonnet', color: '#4ade80', label: 'Week (Sonnet)' },
  ];

  for (var s = 0; s < series.length; s++) {
    ctx.strokeStyle = series[s].color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < points.length; i++) {
      var x = 40 + ((points[i].ts - tsMin) / tsRange) * (w - 40);
      var yVal = h - 20 - (points[i][series[s].key] / 100) * (h - 40);
      i === 0 ? ctx.moveTo(x, yVal) : ctx.lineTo(x, yVal);
    }
    ctx.stroke();
  }

  // Legend
  var legendX = 50;
  for (var l = 0; l < series.length; l++) {
    ctx.fillStyle = series[l].color;
    ctx.fillRect(legendX, h - 12, 12, 3);
    ctx.fillStyle = '#7e7e98';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(series[l].label, legendX + 16, h - 8);
    legendX += ctx.measureText(series[l].label).width + 30;
  }
}

document.querySelectorAll('.chart-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.chart-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    chartDays = parseInt(btn.dataset.days, 10);
    drawChart();
  });
});

// --- Alerts config ---

var alertConfig = {
  session: { label: 'Session threshold', value: 80 },
  weekAll: { label: 'Weekly (all) threshold', value: 90 },
  weekSonnet: { label: 'Weekly (Sonnet) threshold', value: 90 },
};

function renderAlerts() {
  var container = document.getElementById('alertRows');
  while (container.firstChild) container.removeChild(container.firstChild);

  var keys = Object.keys(alertConfig);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var row = el('div', 'alert-row');
    row.appendChild(el('span', 'alert-label', alertConfig[key].label));

    var controls = el('div', 'alert-controls');
    var minusBtn = el('button', 'alert-btn', '\u2212');
    var valueSpan = el('span', 'alert-value', alertConfig[key].value + '%');
    var plusBtn = el('button', 'alert-btn', '+');

    (function(k, vs) {
      minusBtn.addEventListener('click', function() {
        alertConfig[k].value = Math.max(10, alertConfig[k].value - 5);
        vs.textContent = alertConfig[k].value + '%';
        window.dashboardAPI.saveSettings({ alertThresholds: alertConfig });
      });
      plusBtn.addEventListener('click', function() {
        alertConfig[k].value = Math.min(100, alertConfig[k].value + 5);
        vs.textContent = alertConfig[k].value + '%';
        window.dashboardAPI.saveSettings({ alertThresholds: alertConfig });
      });
    })(key, valueSpan);

    controls.appendChild(minusBtn);
    controls.appendChild(valueSpan);
    controls.appendChild(plusBtn);
    row.appendChild(controls);
    container.appendChild(row);
  }
}

// --- Settings ---

function renderSettings() {
  var container = document.getElementById('settingRows');
  while (container.firstChild) container.removeChild(container.firstChild);

  // Hotkey
  var hotkeyRow = el('div', 'setting-row');
  hotkeyRow.appendChild(el('span', 'setting-label', 'Hotkey'));
  hotkeyRow.appendChild(el('span', 'setting-value', 'Ctrl + \\'));
  container.appendChild(hotkeyRow);

  // Auto-start
  var autoRow = el('div', 'setting-row');
  autoRow.appendChild(el('span', 'setting-label', 'Start on login'));
  autoRow.appendChild(el('span', 'setting-value', 'Managed via tray menu'));
  container.appendChild(autoRow);

  // Check for updates
  var updateRow = el('div', 'setting-row');
  updateRow.appendChild(el('span', 'setting-label', 'Updates'));
  var checkBtn = el('button', 'setting-btn', 'Check for updates');
  checkBtn.addEventListener('click', function() {
    checkBtn.textContent = 'Checking...';
    window.dashboardAPI.checkForUpdates().then(function(result) {
      if (result && result.hasUpdate) {
        var banner = document.getElementById('updateBanner');
        banner.classList.add('visible');
        document.getElementById('updateText').textContent =
          'Update available: v' + result.latestVersion;
      } else {
        checkBtn.textContent = 'Up to date!';
      }
    }).catch(function() {
      checkBtn.textContent = 'Check failed';
    });
  });
  updateRow.appendChild(checkBtn);
  container.appendChild(updateRow);

  // Version
  document.getElementById('versionInfo').textContent = 'Claude Meter v2.0.0';
}

// --- IPC handlers ---

window.dashboardAPI.onUsageUpdate(function(data) {
  usageData = data;
  renderOverview();
});

window.dashboardAPI.onHistoryUpdate(function(data) {
  historyData = data;
  if (document.getElementById('tab-history').classList.contains('active')) {
    drawChart();
  }
});

// --- Init ---

renderAlerts();
renderSettings();
window.dashboardAPI.requestData();

// Update countdown every second
setInterval(function() {
  if (usageData) renderOverview();
}, 1000);
```

**Step 4: Add dashboard window management to main.js**

Add after `let fileChangeTimer = null;` (line 34):

```js
let dashWin = null;
```

Add after the `toggleWindow` function:

```js
function openDashboard() {
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.focus();
    return;
  }

  const iconPath = getAssetPath('icon.png');
  dashWin = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
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
  });

  dashWin.on('closed', () => { dashWin = null; });
}
```

Add IPC handlers in the `app.whenReady()` block, after the existing IPC handlers:

```js
  ipcMain.on('dashboard-request-data', () => {
    if (dashWin && !dashWin.isDestroyed()) {
      if (cachedUsage) dashWin.webContents.send('usage-update', cachedUsage);
      if (usageHistory.length > 0) dashWin.webContents.send('history-update', usageHistory);
    }
    doSync();
  });

  ipcMain.on('dashboard-save-settings', (_, settings) => {
    if (settings.alertThresholds) {
      const t = settings.alertThresholds;
      if (t.session) ALERT_THRESHOLDS.session = t.session.value;
      if (t.weekAll) ALERT_THRESHOLDS.weekAll = t.weekAll.value;
      if (t.weekSonnet) ALERT_THRESHOLDS.weekSonnet = t.weekSonnet.value;
    }
  });

  ipcMain.handle('check-for-updates', async () => {
    return checkForUpdates();
  });
```

Also update `doSync()` to send updates to dashboard window too. After the line that sends to `win`, add:

```js
    if (dashWin && !dashWin.isDestroyed()) {
      dashWin.webContents.send('usage-update', cachedUsage);
      dashWin.webContents.send('history-update', usageHistory);
    }
```

Add "Dashboard" to the tray menu. In `buildTrayMenu()`, after the "Sync Now" item:

```js
    { label: 'Dashboard', click: () => openDashboard() },
```

**Step 5: Add dashboard link to widget**

In `preload.js`, add to the exposed API:

```js
  openDashboard: () => ipcRenderer.send('open-dashboard'),
```

In `main.js`, add IPC handler:

```js
  ipcMain.on('open-dashboard', () => openDashboard());
```

In `index.html`, add a dashboard button in the header. After the `<span class="sync-status" id="syncStatus"></span>` line, add a small dashboard icon. In the header-left div:

```html
      <button class="win-btn dashboard-btn" id="dashBtn" title="Open Dashboard" style="background: var(--accent); width: 14px; height: 14px; -webkit-app-region: no-drag; margin-left: 4px;"></button>
```

In `renderer.js`, add click handler:

```js
document.getElementById('dashBtn').addEventListener('click', function() {
  window.electronAPI.openDashboard();
});
```

**Step 6: Update package.json build files**

In `package.json`, add the new files to the `build.files` array:

```json
    "files": [
      "main.js",
      "preload.js",
      "dashboard-preload.js",
      "renderer.js",
      "dashboard.js",
      "index.html",
      "dashboard.html",
      "assets/**/*"
    ],
```

**Step 7: Verify manually**

Run: `npm start`
- Right-click tray icon — "Dashboard" menu item should appear
- Click it — dashboard window should open with overview, history, alerts, settings tabs
- Click the orange dot in the widget header — should also open dashboard
- Usage data should appear in overview cards
- History chart should draw if history data exists
- Alert threshold +/- buttons should work
- Closing dashboard window and reopening should work

**Step 8: Commit**

```bash
git add main.js preload.js dashboard-preload.js dashboard.html dashboard.js index.html renderer.js package.json
git commit -m "feat: add dashboard window with overview, history chart, alerts, and settings"
```

---

## Phase 5: Auto-Update Check

### Task 9: Add GitHub release version check

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/main.js`

**Step 1: Add checkForUpdates function**

Add after the `updateTrayBadge` function:

```js
// --- Auto-update check ---

let lastUpdateCheck = 0;
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function checkForUpdates() {
  return new Promise((resolve) => {
    const url = new URL('https://api.github.com/repos/SpitOnYourFace/claude-usage-widget/releases/latest');
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent': `claude-usage-widget/${app.getVersion()}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const latestTag = (data.tag_name || '').replace(/^v/, '');
          const current = app.getVersion();
          if (latestTag && latestTag !== current) {
            resolve({ hasUpdate: true, latestVersion: latestTag, url: data.html_url });
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
```

**Step 2: Add periodic check on app start**

In `app.whenReady()`, after the power monitor handlers, add:

```js
  // Check for updates on start, then every 24h
  setTimeout(async () => {
    const result = await checkForUpdates();
    if (result.hasUpdate && win && !win.isDestroyed()) {
      win.webContents.send('update-available', result);
    }
  }, 10000);

  setInterval(async () => {
    const result = await checkForUpdates();
    if (result.hasUpdate && win && !win.isDestroyed()) {
      win.webContents.send('update-available', result);
    }
  }, UPDATE_CHECK_INTERVAL);
```

**Step 3: Show update banner in widget footer**

In `preload.js`, add:

```js
  onUpdateAvailable: (cb) => {
    let handler = null;
    if (handler) ipcRenderer.removeListener('update-available', handler);
    handler = (_e, data) => cb(data);
    ipcRenderer.on('update-available', handler);
  },
```

In `index.html`, add an update banner inside the footer div, before the `footerHint` span:

```html
    <span class="footer-update" id="updateBanner" style="display:none; font-size:10px; color:var(--accent); cursor:pointer; -webkit-app-region:no-drag;"></span>
```

In `renderer.js`, add:

```js
window.electronAPI.onUpdateAvailable(function(data) {
  var banner = document.getElementById('updateBanner');
  banner.textContent = 'v' + data.latestVersion + ' available';
  banner.style.display = '';
  banner.title = 'Click to open release page';
});
```

**Step 4: Verify manually**

Run: `npm start`
- If a newer GitHub release exists, footer should show "vX.Y.Z available" in accent color
- If version matches, nothing shown

**Step 5: Commit**

```bash
git add main.js preload.js renderer.js index.html
git commit -m "feat: add GitHub release auto-update check"
```

---

## Phase 6: Finalize

### Task 10: Version bump and build config update

**Files:**
- Modify: `C:/Users/USER/claude-usage-widget/package.json`

**Step 1: Bump version**

Change `"version": "1.7.0"` to `"version": "2.0.0"` in `package.json`.

**Step 2: Verify full app**

Run: `npm start`
- Verify widget opens with sparklines, countdown, animated numbers
- Verify compact mode works (double-click header)
- Verify dashboard opens from tray and widget button
- Verify dashboard tabs all work (overview, history chart, alerts, settings)
- Verify notifications fire at thresholds
- Verify tray tooltip shows usage percentages
- Verify history file grows at `~/.claude/usage-widget-history.json`
- Verify auto-update check runs

**Step 3: Commit and tag**

```bash
git add package.json
git commit -m "chore: bump version to 2.0.0"
git tag v2.0.0
```

---

## Task Dependency Graph

```
Task 1 (history persistence)
    |
    +---> Task 2 (countdown timer)
    |         |
    |         +---> Task 3 (animated numbers)
    |                   |
    |                   +---> Task 4 (sparklines) -- depends on history from Task 1
    |                             |
    |                             +---> Task 5 (compact mode)
    |
    +---> Task 6 (notifications) -- depends on history from Task 1
              |
              +---> Task 7 (tray badge)
                        |
                        +---> Task 8 (dashboard) -- depends on history, notifications
                                  |
                                  +---> Task 9 (auto-update)
                                            |
                                            +---> Task 10 (finalize)
```

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| History | 1 | Usage history file with 30-day rolling window |
| Widget Polish | 2-5 | Countdown, animations, sparklines, compact mode |
| Notifications | 6-7 | Desktop alerts, tray badge |
| Dashboard | 8 | Two-window with overview, charts, alerts, settings |
| Auto-Update | 9 | GitHub release check |
| Finalize | 10 | Version bump, verification, release |
