/* Dashboard renderer — safe DOM only (no innerHTML) */

var usageData = null;
var historyData = [];
var chartDays = 7;
var alertThresholds = { session: 80, weekAll: 90, weekSonnet: 90 };

// --- Helpers ---

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getBarClass(pct) {
  if (pct >= 85) return 'danger';
  if (pct >= 60) return 'warning';
  return '';
}

function formatCountdown(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  var diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Resetting...';
  if (diff > 86400000) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    var min = d.getMinutes();
    var minStr = min > 0 ? ':' + (min < 10 ? '0' : '') + min : '';
    return 'Resets ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + minStr + ampm;
  }
  var hours = Math.floor(diff / 3600000);
  var mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return 'Resets in ' + hours + 'h ' + mins + 'm';
  return 'Resets in ' + mins + 'm';
}

// --- Tab navigation ---

var navItems = document.querySelectorAll('.sidebar-nav li');
var tabPanels = document.querySelectorAll('.tab-content');

for (var i = 0; i < navItems.length; i++) {
  (function(item) {
    item.addEventListener('click', function() {
      for (var j = 0; j < navItems.length; j++) {
        navItems[j].classList.remove('active');
      }
      for (var k = 0; k < tabPanels.length; k++) {
        tabPanels[k].classList.remove('active');
      }
      item.classList.add('active');
      var tabId = 'tab-' + item.getAttribute('data-tab');
      var panel = document.getElementById(tabId);
      if (panel) panel.classList.add('active');

      // Redraw chart when history tab becomes visible
      if (item.getAttribute('data-tab') === 'history') {
        drawChart();
      }
    });
  })(navItems[i]);
}

// --- Overview ---

function buildUsageCard(label, data) {
  var card = el('div', 'usage-card');
  card.appendChild(el('div', 'card-label', label));

  var track = el('div', 'bar-track');
  var fill = el('div', 'bar-fill ' + getBarClass(data.pct));
  fill.style.width = Math.max(1, data.pct) + '%';
  track.appendChild(fill);
  card.appendChild(track);

  var meta = el('div', 'card-meta');
  meta.appendChild(el('span', null, data.pct + '% used'));
  meta.appendChild(el('span', null, formatCountdown(data.resetsAt)));
  card.appendChild(meta);

  return card;
}

function renderOverview() {
  var container = document.getElementById('overviewCards');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!usageData) {
    container.appendChild(el('div', 'usage-card', 'Waiting for data...'));
    return;
  }

  container.appendChild(buildUsageCard('Session (5h window)', usageData.session));
  container.appendChild(buildUsageCard('Weekly — All Models', usageData.weekAll));
  container.appendChild(buildUsageCard('Weekly — Sonnet', usageData.weekSonnet));

  // Extra usage card
  if (usageData.extraUsage) {
    var extraCard = el('div', 'usage-card');
    extraCard.appendChild(el('div', 'card-label', 'Extra Usage'));
    if (usageData.extraUsage.enabled) {
      var util = Number(usageData.extraUsage.utilization);
      extraCard.appendChild(el('div', 'card-meta',
        Number.isFinite(util) ? util + '% used' : 'Enabled'));
    } else {
      extraCard.appendChild(el('div', 'card-meta', 'Not enabled'));
    }
    container.appendChild(extraCard);
  }

  // Session planner
  renderPlanner();
}

function renderPlanner() {
  var plannerText = document.getElementById('plannerText');
  if (!usageData || !usageData.session) {
    plannerText.textContent = 'Waiting for data...';
    return;
  }

  var pct = usageData.session.pct;
  var resetsAt = usageData.session.resetsAt;

  if (pct === 0) {
    plannerText.textContent = 'No session usage yet. You have a full 5-hour window available.';
    return;
  }

  if (!resetsAt) {
    plannerText.textContent = 'Session at ' + pct + '% — reset time unknown.';
    return;
  }

  var resetTime = new Date(resetsAt).getTime();
  var now = Date.now();
  var remainingMs = resetTime - now;

  if (remainingMs <= 0) {
    plannerText.textContent = 'Session is resetting now.';
    return;
  }

  var sessionWindowMs = 5 * 60 * 60 * 1000; // 5 hours
  var elapsedMs = sessionWindowMs - remainingMs;
  if (elapsedMs <= 0) elapsedMs = 1;

  var ratePerHour = pct / (elapsedMs / 3600000);
  var remainingPct = 100 - pct;
  var hoursToLimit = remainingPct / ratePerHour;

  var remainingHours = Math.floor(remainingMs / 3600000);
  var remainingMins = Math.floor((remainingMs % 3600000) / 60000);

  var lines = [];
  lines.push('Session at ' + pct + '% — resets in ' + remainingHours + 'h ' + remainingMins + 'm.');
  lines.push('Current burn rate: ~' + ratePerHour.toFixed(1) + '% per hour.');

  if (hoursToLimit < (remainingMs / 3600000)) {
    var limitH = Math.floor(hoursToLimit);
    var limitM = Math.round((hoursToLimit - limitH) * 60);
    lines.push('At this rate, you will hit the limit in ~' + limitH + 'h ' + limitM + 'm.');
  } else {
    lines.push('At this rate, you will NOT hit the limit before reset.');
  }

  plannerText.textContent = lines.join(' ');
}

// --- History chart ---

function drawChart() {
  var canvas = document.getElementById('historyCanvas');
  if (!canvas) return;

  var rect = canvas.parentElement.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  var w = rect.width - 40; // account for padding
  var h = 320;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Filter data by chartDays
  var cutoff = Date.now() - chartDays * 24 * 60 * 60 * 1000;
  var points = [];
  for (var i = 0; i < historyData.length; i++) {
    if (historyData[i].ts > cutoff) {
      points.push(historyData[i]);
    }
  }

  var padL = 40, padR = 16, padT = 16, padB = 40;
  var chartW = w - padL - padR;
  var chartH = h - padT - padB;

  // Grid lines
  ctx.strokeStyle = '#2a2a3d';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#7e7e98';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';

  var gridLines = [0, 25, 50, 75, 100];
  for (var g = 0; g < gridLines.length; g++) {
    var gy = padT + chartH - (gridLines[g] / 100) * chartH;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + chartW, gy);
    ctx.stroke();
    ctx.fillText(gridLines[g] + '%', padL - 6, gy + 4);
  }

  if (points.length < 2) {
    ctx.fillStyle = '#7e7e98';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Not enough data yet', w / 2, h / 2);
    return;
  }

  // Time range
  var minTs = points[0].ts;
  var maxTs = points[points.length - 1].ts;
  var tsRange = maxTs - minTs || 1;

  function toX(ts) {
    return padL + ((ts - minTs) / tsRange) * chartW;
  }
  function toY(val) {
    return padT + chartH - (val / 100) * chartH;
  }

  // Draw lines
  var series = [
    { key: 'session', color: '#d4845a', label: 'Session' },
    { key: 'weekAll', color: '#7c7cba', label: 'Weekly (all)' },
    { key: 'weekSonnet', color: '#4ade80', label: 'Weekly (Sonnet)' },
  ];

  for (var s = 0; s < series.length; s++) {
    ctx.strokeStyle = series[s].color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var p = 0; p < points.length; p++) {
      var px = toX(points[p].ts);
      var py = toY(points[p][series[s].key]);
      if (p === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  // Legend
  var legendY = h - 12;
  var legendX = padL;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';

  for (var l = 0; l < series.length; l++) {
    ctx.fillStyle = series[l].color;
    ctx.fillRect(legendX, legendY - 8, 12, 3);
    legendX += 16;
    ctx.fillText(series[l].label, legendX, legendY);
    legendX += ctx.measureText(series[l].label).width + 20;
  }
}

// Chart controls
var chartBtns = document.querySelectorAll('.chart-btn');
for (var cb = 0; cb < chartBtns.length; cb++) {
  (function(btn) {
    btn.addEventListener('click', function() {
      for (var j = 0; j < chartBtns.length; j++) {
        chartBtns[j].classList.remove('active');
      }
      btn.classList.add('active');
      chartDays = parseInt(btn.getAttribute('data-days'), 10);
      drawChart();
    });
  })(chartBtns[cb]);
}

// --- Alerts ---

function renderAlerts() {
  var container = document.getElementById('alertRows');
  while (container.firstChild) container.removeChild(container.firstChild);

  var alerts = [
    { key: 'session', label: 'Session usage alert' },
    { key: 'weekAll', label: 'Weekly (all models) alert' },
    { key: 'weekSonnet', label: 'Weekly (Sonnet) alert' },
  ];

  for (var i = 0; i < alerts.length; i++) {
    (function(alert) {
      var row = el('div', 'alert-row');
      row.appendChild(el('div', 'alert-label', alert.label));

      var controls = el('div', 'alert-controls');

      var minusBtn = el('button', 'alert-btn', '\u2212');
      var valueEl = el('span', 'alert-value', alertThresholds[alert.key] + '%');
      var plusBtn = el('button', 'alert-btn', '+');

      minusBtn.addEventListener('click', function() {
        var val = alertThresholds[alert.key];
        if (val > 5) {
          alertThresholds[alert.key] = val - 5;
          valueEl.textContent = alertThresholds[alert.key] + '%';
          saveAlertThresholds();
        }
      });

      plusBtn.addEventListener('click', function() {
        var val = alertThresholds[alert.key];
        if (val < 100) {
          alertThresholds[alert.key] = val + 5;
          valueEl.textContent = alertThresholds[alert.key] + '%';
          saveAlertThresholds();
        }
      });

      controls.appendChild(minusBtn);
      controls.appendChild(valueEl);
      controls.appendChild(plusBtn);
      row.appendChild(controls);
      container.appendChild(row);
    })(alerts[i]);
  }
}

function saveAlertThresholds() {
  window.dashboardAPI.saveSettings({
    alertThresholds: {
      session: { value: alertThresholds.session },
      weekAll: { value: alertThresholds.weekAll },
      weekSonnet: { value: alertThresholds.weekSonnet },
    },
  });
}

// --- Settings ---

function renderSettings() {
  var container = document.getElementById('settingRows');
  while (container.firstChild) container.removeChild(container.firstChild);

  // Hotkey setting
  var hotkeyRow = el('div', 'setting-row');
  hotkeyRow.appendChild(el('div', 'setting-label', 'Toggle widget'));
  hotkeyRow.appendChild(el('div', 'setting-value', 'Ctrl+\\'));
  container.appendChild(hotkeyRow);

  // Auto-start setting
  var autoRow = el('div', 'setting-row');
  autoRow.appendChild(el('div', 'setting-label', 'Start on login'));
  autoRow.appendChild(el('div', 'setting-value', 'Configurable via tray menu'));
  container.appendChild(autoRow);

  // Check for updates
  var updateRow = el('div', 'setting-row');
  updateRow.appendChild(el('div', 'setting-label', 'Updates'));
  var updateBtn = el('button', 'update-btn', 'Check for Updates');
  updateBtn.addEventListener('click', function() {
    updateBtn.textContent = 'Checking...';
    updateBtn.disabled = true;
    window.dashboardAPI.checkForUpdates().then(function(result) {
      var banner = document.getElementById('updateBanner');
      if (result && result.updateAvailable) {
        while (banner.firstChild) banner.removeChild(banner.firstChild);
        banner.appendChild(document.createTextNode(
          'Update available: v' + result.version
        ));
        banner.classList.add('visible');
      } else {
        updateBtn.textContent = 'Up to date';
      }
    }).catch(function() {
      updateBtn.textContent = 'Check failed';
    }).finally(function() {
      setTimeout(function() {
        updateBtn.textContent = 'Check for Updates';
        updateBtn.disabled = false;
      }, 3000);
    });
  });
  updateRow.appendChild(updateBtn);
  container.appendChild(updateRow);

  // Version info
  var versionEl = document.getElementById('versionInfo');
  versionEl.textContent = 'Claude Meter — Dashboard';
}

// --- IPC handlers ---

window.dashboardAPI.onUsageUpdate(function(data) {
  usageData = data;
  renderOverview();
});

window.dashboardAPI.onHistoryUpdate(function(data) {
  historyData = data;
  // Redraw chart if history tab is visible
  var historyTab = document.getElementById('tab-history');
  if (historyTab && historyTab.classList.contains('active')) {
    drawChart();
  }
});

// --- Init ---

renderAlerts();
renderSettings();
window.dashboardAPI.requestData();

// Update countdowns every second
setInterval(function() {
  if (!usageData) return;
  renderOverview();
}, 1000);

// Redraw chart on window resize
window.addEventListener('resize', function() {
  var historyTab = document.getElementById('tab-history');
  if (historyTab && historyTab.classList.contains('active')) {
    drawChart();
  }
});
