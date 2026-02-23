# AI Meter — Universal AI Usage Dashboard

**Date:** 2026-02-23
**Status:** Approved
**Author:** USER

## Summary

AI Meter is a Chrome extension that shows usage across Claude, ChatGPT, and Cursor in a single dashboard. It targets developers and power users who pay for multiple AI subscriptions and want visibility into their usage without checking 3 different sites.

## Product

- **Name:** AI Meter
- **Platform:** Chrome extension (Manifest V3)
- **Data storage:** Local-first (`chrome.storage.local`, up to 10MB)
- **Monetization:** Freemium
  - **Free:** 1 service, 7-day history, popup view
  - **Pro ($5/mo):** All services, 90-day history, alerts, full dashboard, CSV export
- **Target audience:** Developers using 2+ AI subscriptions

## Architecture

### Extension structure

```
ai-meter/
├── manifest.json          # Manifest V3
├── background/
│   └── service-worker.js  # Orchestrates polling, storage, alerts
├── content/
│   ├── claude.js          # Content script for claude.ai
│   ├── chatgpt.js         # Content script for chatgpt.com
│   └── cursor.js          # Content script for cursor.com
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js
├── shared/
│   ├── storage.js         # chrome.storage abstraction
│   ├── constants.js       # Quotas, colors, thresholds
│   └── utils.js           # Time formatting, etc.
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── lib/
    └── chart.min.js       # Lightweight chart library
```

### Manifest V3 permissions

- `storage` — save usage data locally
- `alarms` — periodic background polling
- `notifications` — usage alerts
- Host permissions: `*://claude.ai/*`, `*://chatgpt.com/*`, `*://cursor.com/*`

No broad permissions (`<all_urls>`, `tabs`, `history`, `bookmarks`).

### Data flow per service

**Claude (claude.ai):**
- Content script calls `/api/organizations/{org_id}/usage` using the page's session cookies
- Returns JSON: session %, weekly %, Sonnet %, reset times
- Polls every 60s when tab is active
- Difficulty: Low (proven approach, multiple extensions already do this)

**ChatGPT (chatgpt.com):**
- Content script intercepts `fetch`/`XHR` requests to ChatGPT's conversation API
- Logs each outgoing request with model name + timestamp
- Compares against configurable quotas (known limits per plan)
- This is approximate — same approach all existing ChatGPT trackers use
- Difficulty: Medium (no server-side usage API for consumer plans)

**Cursor (cursor.com):**
- Content script on `cursor.com/settings` reads usage data from DOM or `/api/usage`
- Falls back to DOM scraping if API is unreliable
- Difficulty: Medium (data quality has been inconsistent)

### Storage schema

```js
{
  services: {
    claude: {
      connected: true,
      usage: {
        session: { pct: 45, resetsAt: "2026-02-23T20:00:00Z", label: "Session" },
        weekAll: { pct: 16, resetsAt: "2026-03-01T14:00:00Z", label: "Week (all)" },
        weekSonnet: { pct: 12, resetsAt: "2026-03-01T14:00:00Z", label: "Week (Sonnet)" }
      },
      history: [{ ts: 1708700000000, session: 45, weekAll: 16 }, ...],
      lastSync: 1708700000000
    },
    chatgpt: {
      connected: true,
      usage: {
        models: {
          "gpt-4o": { used: 23, limit: 80, resetAt: "2026-02-23T20:00:00Z" },
          "o3": { used: 5, limit: 50, resetAt: "2026-02-23T20:00:00Z" }
        }
      },
      history: [...],
      lastSync: 1708700000000
    },
    cursor: {
      connected: true,
      usage: {
        creditsUsed: 8.50,
        creditsTotal: 20.00,
        fastRequests: { used: 46, limit: 500 }
      },
      history: [...],
      lastSync: 1708700000000
    }
  },
  settings: {
    alerts: {
      claude: { sessionThreshold: 80, weekThreshold: 90 },
      chatgpt: { perModelThreshold: 90 },
      cursor: { creditsThreshold: 80 }
    },
    theme: "dark",
    tier: "free",
    proKey: null
  }
}
```

## UI Design

### Popup (extension icon click)

- ~350px wide compact card, dark theme (same palette as Claude Meter)
- Three service rows: icon + name + primary gauge + status dot
- Each row expandable for detailed breakdown
- Grey row with "Connect" button for inactive services
- Footer: "Last synced Xm ago" + "Open Dashboard" link

### Full Dashboard (extension page)

- Opens in a new tab: `chrome-extension://*/dashboard.html`
- Left sidebar: services list, settings, Pro upgrade
- Main area: usage overview cards at top, historical charts below
- Charts: 7-day trend lines (Pro: 90-day)
- Alerts panel: configure per-service thresholds
- Settings: manage connections, theme, export

### Design language

- Dark palette: `--bg: #0c0c12`, `--surface: #13131d`, `--border: #2a2a3d`
- Color coding: green (< 60%), yellow (60-85%), red (> 85%)
- Gauge bars matching Claude Meter's style
- Monospace font for numbers

## Monetization

- **Free tier:** Works out of the box, 1 service, 7-day history
- **Pro tier ($5/mo):** All services, 90-day history, alerts, charts, CSV export
- **Payment:** LemonSqueezy or Stripe Checkout for license key validation
- **Verification:** Simple GET request to validate license key (no backend needed beyond payment provider)
- **Storage:** Pro status in `chrome.storage.sync` (syncs across Chrome instances)

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude changes internal API | Claude data breaks | Monitor for changes, update promptly. Extension auto-updates. |
| ChatGPT counting is approximate | Users see inaccurate data | Clear disclaimer: "estimated based on local tracking" |
| Cursor dashboard is buggy | Incomplete data | Multiple fallbacks: API first, DOM scrape second |
| Chrome Web Store review rejection | Can't distribute | Keep permissions minimal, no remote code loading |
| Low conversion to Pro | No revenue | Focus on free value first, optimize conversion later |

## Success criteria

1. Extension loads and shows Claude usage correctly on first install
2. ChatGPT request counting works within ~5% accuracy
3. Popup renders in < 200ms
4. Chrome Web Store approval within first submission
5. 100 installs within first month
