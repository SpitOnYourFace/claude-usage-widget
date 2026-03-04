var usageData = null;
var prevPcts = { session: 0, weekAll: 0, weekSonnet: 0 };
var animatingPcts = { session: 0, weekAll: 0, weekSonnet: 0 };
var historyData = [];

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

function buildSparklineSVG(key, pct) {
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
  var maxVal = Math.max.apply(null, points.concat([1]));
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
  if (key) {
    var spark = buildSparklineSVG(key, data.pct);
    if (spark) barContainer.appendChild(spark);
  }
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

// Double-click title bar to toggle compact mode
document.querySelector('.header').addEventListener('dblclick', function() {
  document.body.classList.toggle('compact');
  window.electronAPI.toggleCompact(document.body.classList.contains('compact'));
});

// Listen for usage updates from main process
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

window.electronAPI.onSyncStart(function() {
  setSyncStatus('syncing');
});

window.electronAPI.onSyncError(function(msg) {
  setSyncStatus('stale');
});

window.electronAPI.onHistoryUpdate(function(data) {
  historyData = data;
});

window.electronAPI.onUpdateAvailable(function(data) {
  var banner = document.getElementById('updateBanner');
  banner.textContent = 'v' + data.latestVersion + ' available';
  banner.style.display = '';
  banner.title = 'Click to open release page';
});

document.getElementById('dashBtn').addEventListener('click', function() {
  window.electronAPI.openDashboard();
});

// Request initial data
window.electronAPI.requestSync();

// Update countdown + "synced X ago" every second
setInterval(function() {
  if (!usageData) return;
  renderAll();
}, 1000);
