# AI Meter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension (Manifest V3) that shows Claude, ChatGPT, and Cursor usage in a unified popup and dashboard.

**Architecture:** Content scripts run on each service's site to collect usage data, send it to a background service worker, which stores it in `chrome.storage.local`. A popup shows a quick summary; a full dashboard page shows history and charts.

**Tech Stack:** Vanilla JS (no frameworks), Chrome Extension Manifest V3, `chrome.storage.local`, `chrome.alarms`, `chrome.notifications`. All DOM rendering uses safe methods (`createElement`, `textContent`) — no `innerHTML`.

---

## Phase 1: Foundation

### Task 1: Scaffold project and manifest

**Files:**
- Create: `C:/Users/USER/ai-meter/manifest.json`
- Create: `C:/Users/USER/ai-meter/.gitignore`

**Step 1: Create project directory and git init**

```bash
mkdir -p /c/Users/USER/ai-meter
cd /c/Users/USER/ai-meter
git init
```

**Step 2: Create .gitignore**

```
node_modules/
.DS_Store
*.zip
dist/
```

**Step 3: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "AI Meter",
  "version": "0.1.0",
  "description": "See your Claude, ChatGPT, and Cursor usage in one place.",
  "permissions": [
    "storage",
    "alarms",
    "notifications"
  ],
  "host_permissions": [
    "*://claude.ai/*",
    "*://chatgpt.com/*",
    "*://www.cursor.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["*://claude.ai/*"],
      "js": ["shared/constants.js", "content/claude.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["*://chatgpt.com/*"],
      "js": ["shared/constants.js", "content/chatgpt.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["*://www.cursor.com/settings*"],
      "js": ["shared/constants.js", "content/cursor.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "assets/icon-16.png",
      "48": "assets/icon-48.png",
      "128": "assets/icon-128.png"
    }
  },
  "icons": {
    "16": "assets/icon-16.png",
    "48": "assets/icon-48.png",
    "128": "assets/icon-128.png"
  }
}
```

**Step 4: Create placeholder directories**

```bash
mkdir -p background content shared popup dashboard assets lib
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold project with manifest v3"
```

---

### Task 2: Shared constants and utilities

**Files:**
- Create: `C:/Users/USER/ai-meter/shared/constants.js`
- Create: `C:/Users/USER/ai-meter/shared/utils.js`

**Step 1: Create constants.js**

All service definitions, quotas, colors, thresholds in one place. Content scripts load this before their own script (via manifest `js` array order).

```js
// shared/constants.js
const AI_SERVICES = {
  claude: {
    id: 'claude',
    name: 'Claude',
    icon: 'C',
    color: '#d4845a',
    pollIntervalMs: 60000,
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: 'G',
    color: '#10a37f',
    pollIntervalMs: 0, // event-driven (request counting)
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    icon: 'Cu',
    color: '#00e5a0',
    pollIntervalMs: 120000,
  },
};

// Default ChatGPT quotas per plan (user-configurable)
const CHATGPT_QUOTAS = {
  free: { 'gpt-4o-mini': { limit: 0, windowHours: 3 } },
  plus: {
    'gpt-4o': { limit: 80, windowHours: 3 },
    'o4-mini': { limit: 50, windowHours: 3 },
  },
  pro: {
    'gpt-4o': { limit: 0, windowHours: 3 },
    'o3': { limit: 50, windowHours: 3 },
  },
};

const COLORS = {
  bg: '#0c0c12',
  surface: '#13131d',
  surface2: '#1b1b28',
  border: '#2a2a3d',
  text: '#e2e2f0',
  textDim: '#7e7e98',
  green: '#4ade80',
  yellow: '#facc15',
  red: '#f87171',
  barBg: '#252538',
};

const THRESHOLDS = {
  warning: 60,
  danger: 85,
};

const STORAGE_KEYS = {
  services: 'services',
  settings: 'settings',
};
```

**Step 2: Create utils.js**

```js
// shared/utils.js

function formatTimeAgo(ts) {
  if (!ts) return 'Never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

function formatResetTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = d.getHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  const min = d.getMinutes();
  const minStr = min > 0 ? ':' + (min < 10 ? '0' : '') + min : '';
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + minStr + ampm;
}

function getBarColorClass(pct) {
  if (pct >= THRESHOLDS.danger) return 'danger';
  if (pct >= THRESHOLDS.warning) return 'warning';
  return 'ok';
}

function clampPct(val) {
  const n = Number(val) || 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// Safe DOM helpers (no innerHTML — prevents XSS)
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setStyle(elem, styles) {
  for (const [k, v] of Object.entries(styles)) {
    elem.style[k] = v;
  }
}
```

**Step 3: Commit**

```bash
git add shared/
git commit -m "feat: add shared constants and utility functions"
```

---

### Task 3: Storage abstraction

**Files:**
- Create: `C:/Users/USER/ai-meter/shared/storage.js`

**Step 1: Create storage.js**

Wraps `chrome.storage.local` with typed getters/setters for our schema.

```js
// shared/storage.js

const DEFAULT_SERVICES = {
  claude: { connected: false, usage: null, history: [], lastSync: 0 },
  chatgpt: { connected: false, usage: null, history: [], lastSync: 0 },
  cursor: { connected: false, usage: null, history: [], lastSync: 0 },
};

const DEFAULT_SETTINGS = {
  alerts: {
    claude: { sessionThreshold: 80, weekThreshold: 90 },
    chatgpt: { perModelThreshold: 90 },
    cursor: { creditsThreshold: 80 },
  },
  theme: 'dark',
  tier: 'free',
  proKey: null,
};

async function getServices() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.services);
  return Object.assign({}, DEFAULT_SERVICES, data[STORAGE_KEYS.services] || {});
}

async function getServiceData(serviceId) {
  const services = await getServices();
  return services[serviceId] || DEFAULT_SERVICES[serviceId] || null;
}

async function setServiceData(serviceId, update) {
  const services = await getServices();
  services[serviceId] = Object.assign({}, services[serviceId], update);
  await chrome.storage.local.set({ [STORAGE_KEYS.services]: services });
}

async function appendHistory(serviceId, entry) {
  const services = await getServices();
  const svc = services[serviceId];
  if (!svc) return;
  svc.history.push(entry);
  // Keep max 90 days of hourly data (~2160 entries)
  const maxEntries = 2160;
  if (svc.history.length > maxEntries) {
    svc.history = svc.history.slice(-maxEntries);
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.services]: services });
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return Object.assign({}, DEFAULT_SETTINGS, data[STORAGE_KEYS.settings] || {});
}

async function setSettings(update) {
  const settings = await getSettings();
  Object.assign(settings, update);
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}
```

**Step 2: Commit**

```bash
git add shared/storage.js
git commit -m "feat: add chrome.storage abstraction layer"
```

---

### Task 4: Service worker (background)

**Files:**
- Create: `C:/Users/USER/ai-meter/background/service-worker.js`

**Step 1: Create the service worker**

Handles message passing from content scripts, manages alarms for periodic polling, checks alert thresholds.

```js
// background/service-worker.js

importScripts('../shared/constants.js', '../shared/utils.js', '../shared/storage.js');

// --- Message handling from content scripts ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'usage-update') {
    handleUsageUpdate(msg.service, msg.data).then(() => sendResponse({ ok: true }));
    return true; // async response
  }

  if (msg.type === 'get-all-usage') {
    getServices().then((services) => sendResponse(services));
    return true;
  }

  if (msg.type === 'get-settings') {
    getSettings().then((settings) => sendResponse(settings));
    return true;
  }

  if (msg.type === 'save-settings') {
    setSettings(msg.data).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'chatgpt-connected') {
    setServiceData('chatgpt', { connected: true }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'chatgpt-request') {
    handleChatGPTRequest(msg.model, msg.timestamp).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function handleUsageUpdate(serviceId, usageData) {
  await setServiceData(serviceId, {
    connected: true,
    usage: usageData,
    lastSync: Date.now(),
  });

  await appendHistory(serviceId, {
    ts: Date.now(),
    ...usageData,
  });

  await checkAlerts(serviceId, usageData);
}

// --- ChatGPT request counting ---

async function handleChatGPTRequest(model, timestamp) {
  const svc = await getServiceData('chatgpt');

  const models = (svc.usage && svc.usage.models) ? { ...svc.usage.models } : {};

  if (!models[model]) {
    const plan = 'plus';
    const quota = CHATGPT_QUOTAS[plan]?.[model] || { limit: 80, windowHours: 3 };
    models[model] = {
      used: 0,
      limit: quota.limit,
      windowHours: quota.windowHours,
      requests: [],
    };
  }

  models[model].requests.push(timestamp);

  const windowMs = (models[model].windowHours || 3) * 3600000;
  const cutoff = Date.now() - windowMs;
  models[model].requests = models[model].requests.filter((t) => t > cutoff);
  models[model].used = models[model].requests.length;

  if (models[model].requests.length > 0) {
    models[model].resetAt = new Date(models[model].requests[0] + windowMs).toISOString();
  }

  const usageData = { models };

  await setServiceData('chatgpt', {
    connected: true,
    usage: usageData,
    lastSync: Date.now(),
  });

  await appendHistory('chatgpt', { ts: Date.now(), models });
  await checkAlerts('chatgpt', usageData);
}

// --- Alerts ---

async function checkAlerts(serviceId, usageData) {
  const settings = await getSettings();
  const alerts = settings.alerts[serviceId];
  if (!alerts) return;

  let shouldAlert = false;
  let alertMsg = '';

  if (serviceId === 'claude' && usageData.session) {
    if (usageData.session.pct >= alerts.sessionThreshold) {
      shouldAlert = true;
      alertMsg = 'Claude session usage at ' + usageData.session.pct + '%';
    }
  }

  if (serviceId === 'chatgpt' && usageData.models) {
    for (const [model, data] of Object.entries(usageData.models)) {
      const pct = data.limit > 0 ? Math.round((data.used / data.limit) * 100) : 0;
      if (pct >= alerts.perModelThreshold) {
        shouldAlert = true;
        alertMsg = 'ChatGPT ' + model + ' at ' + pct + '% (' + data.used + '/' + data.limit + ')';
        break;
      }
    }
  }

  if (serviceId === 'cursor' && usageData.creditsTotal > 0) {
    const pct = Math.round((usageData.creditsUsed / usageData.creditsTotal) * 100);
    if (pct >= alerts.creditsThreshold) {
      shouldAlert = true;
      alertMsg = 'Cursor credits at ' + pct + '% ($' + usageData.creditsUsed + '/$' + usageData.creditsTotal + ')';
    }
  }

  if (shouldAlert) {
    chrome.notifications.create('alert-' + serviceId + '-' + Date.now(), {
      type: 'basic',
      iconUrl: 'assets/icon-128.png',
      title: 'AI Meter Alert',
      message: alertMsg,
    });
  }
}

// --- Badge update alarm ---

chrome.alarms.create('update-badge', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'update-badge') {
    const services = await getServices();
    let maxPct = 0;
    for (const svc of Object.values(services)) {
      if (!svc.connected || !svc.usage) continue;
      if (svc.usage.session) maxPct = Math.max(maxPct, svc.usage.session.pct || 0);
      if (svc.usage.weekAll) maxPct = Math.max(maxPct, svc.usage.weekAll.pct || 0);
    }
    if (maxPct >= THRESHOLDS.danger) {
      chrome.action.setBadgeBackgroundColor({ color: COLORS.red });
      chrome.action.setBadgeText({ text: maxPct + '%' });
    } else if (maxPct >= THRESHOLDS.warning) {
      chrome.action.setBadgeBackgroundColor({ color: COLORS.yellow });
      chrome.action.setBadgeText({ text: maxPct + '%' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }
});

// --- On install ---

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const services = await getServices();
    await chrome.storage.local.set({ [STORAGE_KEYS.services]: services });
    const settings = await getSettings();
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  }
});
```

**Step 2: Commit**

```bash
git add background/
git commit -m "feat: add service worker with messaging, alarms, and alerts"
```

---

## Phase 2: Content Scripts

### Task 5: Claude content script

**Files:**
- Create: `C:/Users/USER/ai-meter/content/claude.js`

**Step 1: Create the Claude content script**

Fetches usage from Claude's internal API endpoint using session cookies.

```js
// content/claude.js

(function() {
  'use strict';

  let polling = false;
  let pollTimer = null;

  async function getOrgId() {
    try {
      const res = await fetch('/api/organizations', { credentials: 'include' });
      if (!res.ok) return null;
      const orgs = await res.json();
      if (Array.isArray(orgs) && orgs.length > 0) return orgs[0].uuid;
      return null;
    } catch {
      return null;
    }
  }

  async function fetchClaudeUsage(orgId) {
    try {
      const res = await fetch('/api/organizations/' + orgId + '/usage', {
        credentials: 'include',
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function buildUsageData(raw) {
    const data = {
      session: { pct: 0, resetsAt: null },
      weekAll: { pct: 0, resetsAt: null },
      weekSonnet: { pct: 0, resetsAt: null },
    };

    if (raw.five_hour) {
      data.session.pct = clampPct(raw.five_hour.utilization);
      data.session.resetsAt = raw.five_hour.resets_at || null;
    }
    if (raw.seven_day) {
      data.weekAll.pct = clampPct(raw.seven_day.utilization);
      data.weekAll.resetsAt = raw.seven_day.resets_at || null;
    }
    if (raw.seven_day_sonnet) {
      data.weekSonnet.pct = clampPct(raw.seven_day_sonnet.utilization);
      data.weekSonnet.resetsAt = raw.seven_day_sonnet.resets_at || null;
    }

    return data;
  }

  async function syncClaude() {
    const orgId = await getOrgId();
    if (!orgId) return;
    const raw = await fetchClaudeUsage(orgId);
    if (!raw) return;
    chrome.runtime.sendMessage({
      type: 'usage-update',
      service: 'claude',
      data: buildUsageData(raw),
    });
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    syncClaude();
    pollTimer = setInterval(syncClaude, AI_SERVICES.claude.pollIntervalMs);
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    document.hidden ? stopPolling() : startPolling();
  });

  if (!document.hidden) startPolling();
})();
```

**Step 2: Test manually**

1. Load extension in `chrome://extensions` (Developer mode > Load unpacked)
2. Open `claude.ai`, log in
3. Check service worker console for storage updates

**Step 3: Commit**

```bash
git add content/claude.js
git commit -m "feat: add Claude content script with usage polling"
```

---

### Task 6: ChatGPT content script

**Files:**
- Create: `C:/Users/USER/ai-meter/content/chatgpt.js`

**Step 1: Create the ChatGPT content script**

Intercepts fetch requests to count conversations per model.

```js
// content/chatgpt.js

(function() {
  'use strict';

  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const [resource, options] = args;
    const url = typeof resource === 'string' ? resource : resource?.url || '';

    if (url.includes('/backend-api/conversation') && options?.method?.toUpperCase() === 'POST') {
      try {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
        const model = body?.model || 'unknown';
        chrome.runtime.sendMessage({
          type: 'chatgpt-request',
          model: model,
          timestamp: Date.now(),
        });
      } catch { /* ignore parse errors */ }
    }

    return originalFetch.apply(this, args);
  };

  chrome.runtime.sendMessage({ type: 'chatgpt-connected' });
})();
```

**Step 2: Test manually**

1. Reload extension, open `chatgpt.com`, send a message
2. Check popup — ChatGPT card should show request count

**Step 3: Commit**

```bash
git add content/chatgpt.js
git commit -m "feat: add ChatGPT request counting via fetch interception"
```

---

### Task 7: Cursor content script

**Files:**
- Create: `C:/Users/USER/ai-meter/content/cursor.js`

**Step 1: Create the Cursor content script**

Tries `/api/usage` first, falls back to DOM scraping on the settings page.

```js
// content/cursor.js

(function() {
  'use strict';

  let polling = false;
  let pollTimer = null;

  async function fetchCursorAPI() {
    try {
      const res = await fetch('/api/usage', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return parseCursorResponse(data);
    } catch {
      return null;
    }
  }

  function parseCursorResponse(data) {
    const result = { creditsUsed: 0, creditsTotal: 0, fastRequests: null };
    if (typeof data.creditsUsed === 'number') result.creditsUsed = data.creditsUsed;
    if (typeof data.credits_used === 'number') result.creditsUsed = data.credits_used;
    if (typeof data.creditsTotal === 'number') result.creditsTotal = data.creditsTotal;
    if (typeof data.credits_total === 'number') result.creditsTotal = data.credits_total;
    if (data.fast_requests_used !== undefined) {
      result.fastRequests = {
        used: Number(data.fast_requests_used) || 0,
        limit: Number(data.fast_requests_limit) || 500,
      };
    }
    return result;
  }

  function scrapeCursorDOM() {
    const text = document.body.innerText;
    const creditMatch = text.match(/\$(\d+\.?\d*)\s*\/\s*\$(\d+\.?\d*)/);
    const requestMatch = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:fast\s+)?requests?/i);
    const result = { creditsUsed: 0, creditsTotal: 0, fastRequests: null };
    if (creditMatch) {
      result.creditsUsed = parseFloat(creditMatch[1]);
      result.creditsTotal = parseFloat(creditMatch[2]);
    }
    if (requestMatch) {
      result.fastRequests = {
        used: parseInt(requestMatch[1], 10),
        limit: parseInt(requestMatch[2], 10),
      };
    }
    if (result.creditsTotal > 0 || result.fastRequests) return result;
    return null;
  }

  async function syncCursor() {
    let usageData = await fetchCursorAPI();
    if (!usageData) usageData = scrapeCursorDOM();
    if (!usageData) return;
    chrome.runtime.sendMessage({
      type: 'usage-update',
      service: 'cursor',
      data: usageData,
    });
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    setTimeout(syncCursor, 2000);
    pollTimer = setInterval(syncCursor, AI_SERVICES.cursor.pollIntervalMs);
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    document.hidden ? stopPolling() : startPolling();
  });

  if (!document.hidden) startPolling();
})();
```

**Step 2: Commit**

```bash
git add content/cursor.js
git commit -m "feat: add Cursor content script with API + DOM fallback"
```

---

## Phase 3: Popup UI

### Task 8: Popup UI

**Files:**
- Create: `C:/Users/USER/ai-meter/popup/popup.html`
- Create: `C:/Users/USER/ai-meter/popup/popup.css`
- Create: `C:/Users/USER/ai-meter/popup/popup.js`

**Step 1: Create popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:;">
<link rel="stylesheet" href="popup.css">
<title>AI Meter</title>
</head>
<body>
<div class="popup">
  <div class="header">
    <span class="title">AI Meter</span>
    <a href="#" id="openDashboard" class="dashboard-link">Dashboard</a>
  </div>
  <div id="serviceList" class="service-list"></div>
  <div class="footer">
    <span class="footer-hint" id="footerHint">Loading...</span>
  </div>
</div>
<script src="../shared/constants.js"></script>
<script src="../shared/utils.js"></script>
<script src="popup.js"></script>
</body>
</html>
```

**Step 2: Create popup.css**

Standard dark theme CSS (same palette as Claude Meter). Key classes:
- `.popup` — 360px wide, padding 16px
- `.service-card` — background `#13131d`, border `#2a2a3d`, rounded 8px
- `.bar-track` / `.bar-fill` — usage bars with `.ok` / `.warning` / `.danger` colors
- `.connect-btn` — dashed border button for disconnected services
- `.service-detail` — hidden by default, shown when `.expanded`

**Step 3: Create popup.js (safe DOM only — no innerHTML)**

All rendering uses `el()` helper from `utils.js` (which calls `document.createElement` + `textContent`). Key functions:

- `renderServices(services)` — clears `serviceList`, creates service cards using DOM methods
- `renderServiceCard(id, config, svc)` — builds card with icon, name, bar, status dot
- `renderDetailRows(id, usage)` — appends detail rows to expandable section
- `getPrimaryUsage(id, usage)` — returns { pct, label } for the main bar

Example card construction pattern:
```js
function renderServiceCard(id, config, svc) {
  const card = el('div', 'service-card');
  card.dataset.service = id;

  const header = el('div', 'service-header');
  const icon = el('div', 'service-icon');
  icon.textContent = config.icon;
  icon.style.background = config.color;
  header.appendChild(icon);
  header.appendChild(el('span', 'service-name', config.name));

  const status = el('div', 'service-status ' + getStatusClass(svc.lastSync));
  header.appendChild(status);
  card.appendChild(header);

  // Bar
  const primary = getPrimaryUsage(id, svc.usage);
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill ' + getBarColorClass(primary.pct));
  fill.style.width = Math.max(1, primary.pct) + '%';
  track.appendChild(fill);
  card.appendChild(track);

  // Meta
  const meta = el('div', 'bar-meta');
  meta.appendChild(el('span', null, primary.label));
  if (primary.resetLabel) meta.appendChild(el('span', null, primary.resetLabel));
  card.appendChild(meta);

  // Expand on click
  card.addEventListener('click', () => card.classList.toggle('expanded'));

  return card;
}
```

**Step 4: Test manually**

1. Reload extension, click icon
2. Verify popup renders with connected service cards
3. Click a card to expand and see detail rows

**Step 5: Commit**

```bash
git add popup/
git commit -m "feat: add popup UI with safe DOM rendering"
```

---

## Phase 4: Dashboard

### Task 9: Dashboard page

**Files:**
- Create: `C:/Users/USER/ai-meter/dashboard/dashboard.html`
- Create: `C:/Users/USER/ai-meter/dashboard/dashboard.css`
- Create: `C:/Users/USER/ai-meter/dashboard/dashboard.js`

**Step 1: Create dashboard.html**

Full-page dashboard with sidebar navigation (Overview, History, Alerts, Settings tabs) and a main content area. Same CSP as popup.

**Step 2: Create dashboard.css**

Layout: CSS grid with 200px sidebar + flexible main. Same dark palette. Tab sections hidden/shown via `.active` class.

**Step 3: Create dashboard.js (safe DOM only)**

All rendering via `el()` helper. Sections:
- **Overview tab:** Larger service cards (reuse pattern from popup), more detail per service
- **History tab:** Canvas-based line chart showing usage over time. Draw directly on `<canvas>` using `getContext('2d')` — no chart library needed for v1. Free tier shows 7-day, Pro shows 90-day.
- **Alerts tab:** Render threshold controls per service. Each has a label, current value display, and +/- buttons to adjust threshold.
- **Settings tab:** ChatGPT plan selector (dropdown), license key input, export CSV button.

Canvas chart drawing pattern (no library):
```js
function drawChart(canvas, historyData, days) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Background grid
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  for (let y = 0; y <= 100; y += 25) {
    const py = h - (y / 100) * h;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();
  }

  // Draw line for each service
  const cutoff = Date.now() - days * 86400000;
  for (const [id, config] of Object.entries(AI_SERVICES)) {
    const points = historyData[id]?.filter((p) => p.ts > cutoff) || [];
    if (points.length < 2) continue;
    ctx.strokeStyle = config.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = ((p.ts - cutoff) / (days * 86400000)) * w;
      const y = h - ((p.session?.pct || p.pct || 0) / 100) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
```

**Step 4: Commit**

```bash
git add dashboard/
git commit -m "feat: add dashboard with overview, history chart, alerts, settings"
```

---

## Phase 5: Polish and Ship

### Task 10: Extension icons

**Files:**
- Create: `C:/Users/USER/ai-meter/assets/icon-16.png`
- Create: `C:/Users/USER/ai-meter/assets/icon-48.png`
- Create: `C:/Users/USER/ai-meter/assets/icon-128.png`

**Step 1: Generate icons using Canvas + Playwright**

Create an HTML file that draws three overlapping arc segments (Claude orange `#d4845a`, ChatGPT green `#10a37f`, Cursor teal `#00e5a0`) on a dark rounded-rect background. Render at 512x512, resize with Pillow to 16, 48, 128.

**Step 2: Commit**

```bash
git add assets/
git commit -m "feat: add extension icons"
```

---

### Task 11: Chrome Web Store prep

**Files:**
- Create: `C:/Users/USER/ai-meter/README.md`
- Create: `C:/Users/USER/ai-meter/PRIVACY.md`

**Step 1: Write README.md**

Description, features, install link, screenshots, privacy summary, FAQ.

**Step 2: Write PRIVACY.md**

Privacy policy: data stored locally only, no servers, no tracking, no conversation content collected.

**Step 3: Create submission ZIP**

```bash
cd /c/Users/USER/ai-meter
zip -r ai-meter-v0.1.0.zip manifest.json background/ content/ shared/ popup/ dashboard/ assets/ -x "*.git*"
```

**Step 4: Commit**

```bash
git add README.md PRIVACY.md
git commit -m "docs: add README and privacy policy"
```

---

## Task Dependency Graph

```
Task 1 (scaffold) --> Task 2 (constants/utils) --> Task 3 (storage) --> Task 4 (service worker)
                                                                              |
                                          +-----------------------------------+
                                          |                |                  |
                                          v                v                  v
                                    Task 5 (Claude)  Task 6 (ChatGPT)  Task 7 (Cursor)
                                          |                |                  |
                                          +--------+-------+------------------+
                                                   |
                                                   v
                                             Task 8 (Popup)
                                                   |
                                                   v
                                             Task 9 (Dashboard)
                                                   |
                                          +--------+--------+
                                          |                  |
                                          v                  v
                                    Task 10 (Icons)    Task 11 (Store prep)
```

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Foundation | 1-4 | Scaffold, constants, storage, service worker |
| Content Scripts | 5-7 | Claude API, ChatGPT interception, Cursor scraping |
| Popup | 8 | Compact popup with service cards |
| Dashboard | 9 | Full-page dashboard with charts and settings |
| Polish | 10-11 | Icons and Chrome Web Store submission |
