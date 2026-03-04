# Claude Meter v2.0 — Design Document

**Date:** 2026-03-03
**Status:** Approved
**Author:** USER

## Summary

Upgrade Claude Meter from a simple 3-bar usage widget to a two-window system: a compact always-on-top widget with smart features (sparklines, countdown, animations) plus a full dashboard window for history, charts, alerts, and settings.

## Architecture

### Two-window model

```
Widget (always-on-top)              Dashboard (normal window)
┌─────────────────────────┐     ┌──────────────────────────────────┐
│  [Session ▓▓▓░░ 42%] ~  │     │  Overview | History | Alerts     │
│  [Week    ▓░░░░ 16%] ~  │────>│                                  │
│  [Sonnet  ▓░░░░ 12%] ~  │     │  30-day usage chart (canvas)     │
│                         │     │  Model breakdown table           │
│  Resets in 2h 14m  ●    │     │  Session planner                 │
│  Synced just now        │     │  Alert thresholds config         │
└─────────────────────────┘     │  Settings (hotkey, theme, etc.)  │
                                └──────────────────────────────────┘
```

**Data flow:** `main.js` fetches from Anthropic API, sends to whichever window is open via IPC. Usage history persisted to local JSON file.

### New files

```
claude-usage-widget/
├── main.js              (enhanced: history, notifications, dashboard window)
├── preload.js           (enhanced: new IPC channels)
├── index.html           (enhanced: sparklines, countdown, compact mode)
├── renderer.js          (enhanced: animations, sparklines, countdown timer)
├── dashboard.html       (NEW)
├── dashboard.js         (NEW)
├── dashboard-preload.js (NEW — separate preload for dashboard)
└── assets/
    └── notification.png (NEW — notification icon)
```

## Widget Upgrades

### 1. Inline sparkline trends

Tiny 60px-wide, 14px-tall SVG sparkline next to each bar showing last 24h of usage as a trend line. No library — polyline SVG path built from data points.

### 2. Live countdown timer

Replace static "Resets Mar 3, 2pm" with live countdown: "Resets in 2h 14m". Updates every second via `setInterval`. Falls back to date format if reset is >24h away.

### 3. Notification dot

Small red dot on tray icon when any metric crosses threshold. Cleared when user opens widget.

### 4. Animated numbers

Percentage counts up/down smoothly (e.g., 42% to 47% over 600ms) using `requestAnimationFrame`. Bars already have CSS transitions.

### 5. Compact mode toggle

Double-click title bar to toggle:
- **Normal:** Current layout with labels, bars, reset times, extra usage
- **Compact:** Just 3 thin bars with percentages, ~120px tall

### 6. Dashboard link

Small icon in header that opens dashboard window. Also accessible from tray menu.

## Dashboard Window

Opens as regular (non-always-on-top) window, ~800x600, resizable. Tabbed layout:

### Overview tab

- Larger usage cards with full details
- Model breakdown section (ready for per-model API data)
- Session planner: "At current rate, you'll hit the limit in ~X hours"

### History tab

- Canvas-drawn line chart showing usage over 7/14/30 days
- Three color-coded lines (session, week-all, week-sonnet)
- Hover tooltip showing exact values
- Time range selector buttons (7d / 14d / 30d)

### Alerts tab

- Per-metric threshold sliders (session, week-all, week-sonnet)
- Toggle desktop notifications on/off
- Preview: "Alert when session > 80%"

### Settings tab

- Hotkey configuration
- Auto-start on login toggle
- "Check for updates" button
- Version info + links

## Usage History Persistence

**File:** `~/.claude/usage-widget-history.json`

```js
{
  "version": 1,
  "points": [
    { "ts": 1709420000000, "session": 42, "weekAll": 16, "weekSonnet": 12 },
    ...
  ]
}
```

- One data point per successful sync (~every 15s when visible)
- Deduplicate: only store if values changed from last point
- Rolling 30-day window, prune old entries on each write
- Typically ~2,000-5,000 points with dedup

## Desktop Notifications

- **Trigger:** Any metric crosses configurable threshold (default: session 80%, week 90%)
- **Cooldown:** No repeat within 30 minutes
- **Content:** "Claude session usage at 82% — resets in 1h 45m"
- **Click action:** Opens the widget
- **Tray badge:** Red dot overlay on tray icon when alert active

## Auto-Updater

Simple GitHub release check (no electron-updater dependency):
- On app start (and every 24h), fetch latest release from GitHub API
- Compare `tag_name` against `app.getVersion()`
- If newer: show subtle banner in widget footer with link to release page
- No auto-download/install — notification + link only

## Implementation Phases

1. **History persistence** — Add history file, write on each sync, prune old data
2. **Widget polish** — Sparklines, countdown timer, animated numbers, compact mode
3. **Desktop notifications** — Threshold alerts with cooldown, tray badge
4. **Dashboard window** — New window with overview, history chart, alerts, settings
5. **Auto-updater** — GitHub release check, update banner
6. **Testing and release** — Version bump, build, release
