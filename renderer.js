var usageData = null;
var animatingPcts = { session: 0, weekAll: 0, weekSonnet: 0 };
var lastSyncError = null; // persists error message until next successful sync

function createElement(tag, cls, text) {
  var el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

// --- Setup overlay (first-launch onboarding) ---
function showSetupOverlay() {
  var overlay = document.getElementById('setupOverlay');
  var rows = document.getElementById('usageRows');
  var footer = document.querySelector('.footer');
  overlay.classList.add('visible');
  rows.style.display = 'none';
  if (footer) footer.style.display = 'none';
}

function hideSetupOverlay() {
  var overlay = document.getElementById('setupOverlay');
  var rows = document.getElementById('usageRows');
  var footer = document.querySelector('.footer');
  overlay.classList.remove('visible');
  rows.style.display = '';
  if (footer) footer.style.display = '';
}

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

function getBarClass(pct) {
  if (pct >= 85) return 'danger';
  if (pct >= 60) return 'warning';
  return '';
}

function animateNumbers(from, to, key, duration) {
  var start = performance.now();
  function step(now) {
    var elapsed = now - start;
    var progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    var eased = 1 - Math.pow(1 - progress, 3);
    animatingPcts[key] = Math.round(from + (to - from) * eased);
    var el = document.getElementById(key + 'Pct');
    if (el) el.textContent = animatingPcts[key] + '%';
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

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
  var pctEl = createElement('div', 'bar-pct', data.pct + '%');
  if (key) pctEl.id = key + 'Pct';
  barContainer.appendChild(pctEl);
  container.appendChild(barContainer);
  if (data.resetsAt) {
    container.appendChild(createElement('div', 'reset-info', formatResetTime(data.resetsAt)));
  }
}

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

  updateTimers();
}

// Lightweight timer update — only changes text, no DOM rebuild
function updateTimers() {
  if (!usageData) return;

  // Update countdown text for each row
  var rows = [
    { id: 'sessionRow', data: usageData.session },
    { id: 'weekAllRow', data: usageData.weekAll },
    { id: 'weekSonnetRow', data: usageData.weekSonnet },
  ];
  for (var i = 0; i < rows.length; i++) {
    var resetEl = document.getElementById(rows[i].id)
      .querySelector('.reset-info');
    if (resetEl && rows[i].data.resetsAt) {
      resetEl.textContent = formatResetTime(rows[i].data.resetsAt);
    }
  }

  // Update "synced X ago" — but don't overwrite error messages
  var footer = document.getElementById('footerHint');
  if (lastSyncError) {
    footer.textContent = lastSyncError;
    footer.className = 'footer-hint error';
  } else if (usageData.syncTime) {
    var ago = Math.round((Date.now() - usageData.syncTime) / 60000);
    footer.textContent = ago < 1 ? 'Synced just now' : 'Synced ' + ago + 'm ago';
    footer.className = ago >= 5 ? 'footer-hint stale' : 'footer-hint';
  }
}

function setSyncStatus(status) {
  var dot = document.getElementById('statusDot');
  var badge = document.getElementById('syncStatus');

  if (status === 'syncing') {
    dot.className = 'dot syncing';
    badge.className = 'sync-status syncing';
    badge.textContent = '';
    badge.appendChild(createElement('span', 'mini-dot'));
    badge.appendChild(document.createTextNode(' SYNCING'));
  } else if (status === 'live') {
    dot.className = 'dot live';
    badge.className = 'sync-status live';
    badge.textContent = '';
    badge.appendChild(createElement('span', 'mini-dot'));
    badge.appendChild(document.createTextNode(' LIVE'));
  } else {
    dot.className = 'dot stale';
    badge.className = 'sync-status';
    badge.textContent = '';
  }
}

// IPC bridge
document.getElementById('minimizeBtn').addEventListener('click', function() {
  window.electronAPI.minimize();
});

document.getElementById('closeBtn').addEventListener('click', function() {
  window.electronAPI.quit();
});

// Double-click title bar to toggle compact mode
document.querySelector('.header').addEventListener('dblclick', function() {
  document.body.classList.toggle('compact');
  window.electronAPI.toggleCompact(document.body.classList.contains('compact'));
});

// Listen for usage updates from main process
window.electronAPI.onUsageUpdate(function(data) {
  var oldData = usageData;
  usageData = data;
  lastSyncError = null; // clear error on successful sync
  hideSetupOverlay();
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

window.electronAPI.onSyncStart(function() {
  setSyncStatus('syncing');
});

window.electronAPI.onSyncError(function(msg) {
  setSyncStatus('stale');
  if (msg && msg.indexOf('OAuth') >= 0) {
    showSetupOverlay();
  } else if (msg) {
    lastSyncError = 'Sync failed';
  }
});

var pendingWidgetUpdate = null;

window.electronAPI.onUpdateAvailable(function(data) {
  pendingWidgetUpdate = data;
  var btn = document.getElementById('updateBtn');
  btn.textContent = 'Update v' + data.latestVersion;
  btn.classList.add('visible');
});

window.electronAPI.onUpdateProgress(function(pct) {
  var btn = document.getElementById('updateBtn');
  btn.textContent = pct + '% downloaded';
  btn.style.backgroundSize = pct + '% 100%';
});

document.getElementById('updateBtn').addEventListener('click', function() {
  if (!pendingWidgetUpdate) return;
  var btn = document.getElementById('updateBtn');

  if (!pendingWidgetUpdate.downloadUrl) {
    btn.textContent = 'No installer found';
    setTimeout(function() {
      btn.textContent = 'Update v' + pendingWidgetUpdate.latestVersion;
    }, 3000);
    return;
  }

  btn.textContent = 'Downloading...';
  btn.disabled = true;
  btn.classList.add('downloading');

  window.electronAPI.installUpdate().then(function(result) {
    if (result.success) {
      btn.textContent = 'Installing...';
      btn.classList.remove('downloading');
      btn.style.backgroundSize = '';
      btn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
    } else {
      btn.textContent = 'Failed — retry';
      btn.classList.remove('downloading');
      btn.style.backgroundSize = '';
      btn.style.background = '';
      setTimeout(function() {
        btn.textContent = 'Update v' + pendingWidgetUpdate.latestVersion;
        btn.disabled = false;
      }, 3000);
    }
  });
});

document.getElementById('dashBtn').addEventListener('click', function() {
  window.electronAPI.openDashboard();
});

// Manual refresh button
document.getElementById('refreshBtn').addEventListener('click', function() {
  var btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  window.electronAPI.requestSync();
  setTimeout(function() {
    btn.classList.remove('spinning');
  }, 1000);
});

// --- First-launch auth check ---
window.electronAPI.checkAuthStatus().then(function(status) {
  if (!status.authenticated) {
    showSetupOverlay();
    if (!status.claudeCodeInstalled) {
      // Claude Code not installed — show install link, change button text
      document.getElementById('setupDesc').textContent =
        'Claude Code is required. Install it first, then sign in.';
      document.getElementById('setupSignInBtn').style.display = 'none';
      document.getElementById('setupInstallLink').style.display = '';
      document.getElementById('setupInstallLink').textContent = 'Download Claude Code';
    }
  } else {
    window.electronAPI.requestSync();
  }
});

// Sign In button — launches claude auth login
document.getElementById('setupSignInBtn').addEventListener('click', function() {
  var btn = document.getElementById('setupSignInBtn');
  var waiting = document.getElementById('setupWaiting');
  btn.disabled = true;
  btn.textContent = 'Opening browser...';
  window.electronAPI.launchAuthLogin().then(function(result) {
    if (result.success) {
      btn.style.display = 'none';
      waiting.style.display = '';
    } else {
      btn.textContent = 'Sign In';
      btn.disabled = false;
      document.getElementById('setupDesc').textContent =
        'Could not launch login. Run "claude auth login" in a terminal.';
    }
  });
});

// Install Claude Code link — opens download page in browser
document.getElementById('setupInstallLink').addEventListener('click', function() {
  window.electronAPI.openExternalUrl('https://docs.anthropic.com/en/docs/claude-code/getting-started');
});

// Auto-hide overlay when credentials appear
window.electronAPI.onAuthStatusChanged(function(data) {
  if (data.authenticated) {
    hideSetupOverlay();
  }
});

// Update countdown + "synced X ago" every second (lightweight, no DOM rebuild)
setInterval(function() {
  if (!usageData) return;
  updateTimers();
}, 1000);
