var usageData = null;

function createElement(tag, cls, text) {
  var el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
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

function renderUsageRow(container, data) {
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!data) return;
  container.appendChild(createElement('div', 'usage-label', data.label));
  var barContainer = createElement('div', 'bar-container');
  var track = createElement('div', 'bar-track');
  var fill = createElement('div', 'bar-fill ' + getBarClass(data.pct));
  fill.style.width = Math.max(1, data.pct) + '%';
  track.appendChild(fill);
  barContainer.appendChild(track);
  barContainer.appendChild(createElement('div', 'bar-pct', data.pct + '% used'));
  container.appendChild(barContainer);
  if (data.resetsAt) {
    container.appendChild(createElement('div', 'reset-info', formatResetTime(data.resetsAt)));
  }
}

function renderAll() {
  if (!usageData) return;
  renderUsageRow(document.getElementById('sessionRow'), usageData.session);
  renderUsageRow(document.getElementById('weekAllRow'), usageData.weekAll);
  renderUsageRow(document.getElementById('weekSonnetRow'), usageData.weekSonnet);

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

// Listen for usage updates from main process
window.electronAPI.onUsageUpdate(function(data) {
  usageData = data;
  renderAll();
  setSyncStatus('live');
});

window.electronAPI.onSyncStart(function() {
  setSyncStatus('syncing');
});

window.electronAPI.onSyncError(function(msg) {
  setSyncStatus('stale');
});

// Request initial data
window.electronAPI.requestSync();

// Update countdown + "synced X ago" every second
setInterval(function() {
  if (!usageData) return;
  renderAll();
}, 1000);
