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

function getPlannerStatus(pct, hoursToLimit, remainingHours) {
  // "At Risk" if burn rate will hit limit before reset
  // "Watch" if above 60% usage
  // "On Track" otherwise
  if (hoursToLimit !== null && hoursToLimit < remainingHours) return 'at-risk';
  if (pct >= 60) return 'watch';
  return 'on-track';
}

function getPlannerStatusLabel(status) {
  if (status === 'at-risk') return 'At Risk';
  if (status === 'watch') return 'Watch';
  return 'On Track';
}

function getStatDotColor(pct) {
  if (pct >= 85) return 'var(--red)';
  if (pct >= 60) return 'var(--yellow)';
  return 'var(--green)';
}

function renderPlanner() {
  var container = document.getElementById('plannerText');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!usageData || !usageData.session) {
    container.textContent = 'Waiting for data...';
    return;
  }

  var pct = usageData.session.pct;
  var resetsAt = usageData.session.resetsAt;

  if (pct === 0) {
    // Simple state — show badge + message
    var header0 = el('div', 'planner-header');
    var badge0 = el('div', 'planner-badge on-track');
    badge0.appendChild(el('span', 'planner-badge-dot'));
    badge0.appendChild(document.createTextNode('On Track'));
    header0.appendChild(badge0);
    container.appendChild(header0);
    container.appendChild(el('div', 'planner-recommendation', 'No session usage yet. You have a full 5-hour window available.'));
    return;
  }

  var resetTime = resetsAt ? new Date(resetsAt).getTime() : 0;
  var now = Date.now();
  var remainingMs = resetTime > 0 ? resetTime - now : 0;

  if (resetsAt && remainingMs <= 0) {
    var header1 = el('div', 'planner-header');
    var badge1 = el('div', 'planner-badge on-track');
    badge1.appendChild(el('span', 'planner-badge-dot'));
    badge1.appendChild(document.createTextNode('On Track'));
    header1.appendChild(badge1);
    container.appendChild(header1);
    container.appendChild(el('div', 'planner-recommendation', 'Session is resetting now.'));
    return;
  }

  var sessionWindowMs = 5 * 60 * 60 * 1000;
  var elapsedMs = remainingMs > 0 ? sessionWindowMs - remainingMs : 1;
  if (elapsedMs <= 0) elapsedMs = 1;

  var ratePerHour = pct / (elapsedMs / 3600000);
  var remainingPct = 100 - pct;
  var hoursToLimit = ratePerHour > 0 ? remainingPct / ratePerHour : null;
  var remainingHoursDecimal = remainingMs > 0 ? remainingMs / 3600000 : 0;

  var status = getPlannerStatus(pct, hoursToLimit, remainingHoursDecimal);

  // Header with badge
  var header = el('div', 'planner-header');
  var badge = el('div', 'planner-badge ' + status);
  badge.appendChild(el('span', 'planner-badge-dot'));
  badge.appendChild(document.createTextNode(getPlannerStatusLabel(status)));
  header.appendChild(badge);
  container.appendChild(header);

  // Stat grid
  var stats = el('div', 'planner-stats');

  // Stat 1: Session usage
  var stat1 = el('div', 'planner-stat');
  stat1.appendChild(el('div', 'planner-stat-label', 'Session'));
  var val1 = el('div', 'planner-stat-value');
  var dot1 = el('span', 'planner-stat-dot');
  dot1.style.background = getStatDotColor(pct);
  val1.appendChild(dot1);
  val1.appendChild(document.createTextNode(pct + '%'));
  stat1.appendChild(val1);
  stats.appendChild(stat1);

  // Stat 2: Burn rate
  var stat2 = el('div', 'planner-stat');
  stat2.appendChild(el('div', 'planner-stat-label', 'Burn Rate'));
  var val2 = el('div', 'planner-stat-value');
  val2.appendChild(document.createTextNode('~' + ratePerHour.toFixed(1) + '%/hr'));
  stat2.appendChild(val2);
  stats.appendChild(stat2);

  // Stat 3: Time to limit
  var stat3 = el('div', 'planner-stat');
  stat3.appendChild(el('div', 'planner-stat-label', 'Time to Limit'));
  var val3 = el('div', 'planner-stat-value');
  if (hoursToLimit !== null && hoursToLimit < remainingHoursDecimal) {
    var limitH = Math.floor(hoursToLimit);
    var limitM = Math.round((hoursToLimit - limitH) * 60);
    val3.style.color = 'var(--red)';
    val3.appendChild(document.createTextNode(limitH + 'h ' + limitM + 'm'));
  } else {
    val3.style.color = 'var(--green)';
    val3.appendChild(document.createTextNode('Safe'));
  }
  stat3.appendChild(val3);
  stats.appendChild(stat3);

  container.appendChild(stats);

  // Recommendation
  var rec = el('div', 'planner-recommendation');
  if (hoursToLimit !== null && hoursToLimit < remainingHoursDecimal) {
    var lH = Math.floor(hoursToLimit);
    var lM = Math.round((hoursToLimit - lH) * 60);
    rec.textContent = 'Slow down \u2014 limit in ' + lH + 'h ' + lM + 'm. ';
    if (remainingMs > 0) {
      var rH = Math.floor(remainingMs / 3600000);
      var rM = Math.floor((remainingMs % 3600000) / 60000);
      rec.textContent += 'Resets in ' + rH + 'h ' + rM + 'm.';
    }
  } else {
    rec.textContent = 'You can sustain this pace until reset. ~' + Math.round(remainingPct) + '% headroom remaining.';
  }
  container.appendChild(rec);
}

// --- History chart (Chart.js) ---

var usageChart = null;

var chartSeriesDefs = [
  { key: 'session', color: '#d4845a', label: 'Session' },
  { key: 'weekAll', color: '#7c7cba', label: 'Weekly (all)' },
  { key: 'weekSonnet', color: '#4ade80', label: 'Weekly (Sonnet)' },
];


function formatChartDate(ts) {
  var d = new Date(ts);
  var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (chartDays <= 7) {
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    return dayNames[d.getDay()] + ' ' + h12 + ampm;
  }
  return monthNames[d.getMonth()] + ' ' + d.getDate();
}

function formatTooltipTitle(ts) {
  var d = new Date(ts);
  var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var h = d.getHours();
  var ampm = h >= 12 ? 'pm' : 'am';
  var h12 = h % 12 || 12;
  var min = d.getMinutes();
  return monthNames[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + ':' + (min < 10 ? '0' : '') + min + ampm;
}


function drawChart() {
  var canvas = document.getElementById('historyCanvas');
  if (!canvas) return;

  // Filter data by chartDays
  var cutoff = Date.now() - chartDays * 24 * 60 * 60 * 1000;
  var points = [];
  for (var i = 0; i < historyData.length; i++) {
    if (historyData[i].ts > cutoff) {
      points.push(historyData[i]);
    }
  }

  // Build labels and datasets
  var labels = [];
  var datasets = [];
  for (var s = 0; s < chartSeriesDefs.length; s++) {
    datasets.push([]);
  }
  for (var p = 0; p < points.length; p++) {
    labels.push(points[p].ts);
    for (var s2 = 0; s2 < chartSeriesDefs.length; s2++) {
      datasets[s2].push(points[p][chartSeriesDefs[s2].key]);
    }
  }

  var chartDatasets = [];
  for (var d = 0; d < chartSeriesDefs.length; d++) {
    var def = chartSeriesDefs[d];
    chartDatasets.push({
      label: def.label,
      data: datasets[d],
      borderColor: def.color,
      backgroundColor: def.color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: def.color,
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 2,
      tension: 0.35,
      fill: false,
    });
  }

  // Destroy old chart if exists
  if (usageChart) {
    usageChart.destroy();
    usageChart = null;
  }

  if (points.length < 2) {
    var ctx2d = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 320 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '320px';
    ctx2d.scale(dpr, dpr);
    ctx2d.clearRect(0, 0, rect.width, 320);
    ctx2d.fillStyle = '#7e7e98';
    ctx2d.font = '14px sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('Not enough data yet', rect.width / 2, 160);
    return;
  }

  usageChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: chartDatasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 600,
        easing: 'easeOutCubic',
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#e2e2f0',
            font: { size: 12, weight: '500' },
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 20,
          },
        },
        tooltip: {
          backgroundColor: '#1b1b28',
          borderColor: '#2a2a3d',
          borderWidth: 1,
          titleColor: '#7e7e98',
          bodyColor: '#e2e2f0',
          titleFont: { size: 11, family: 'monospace' },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          usePointStyle: true,
          callbacks: {
            title: function(items) {
              if (items.length > 0) {
                return formatTooltipTitle(items[0].label);
              }
              return '';
            },
            label: function(item) {
              return ' ' + item.dataset.label + ': ' + item.parsed.y + '%';
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#7e7e98',
            font: { size: 10, family: 'monospace' },
            maxTicksLimit: chartDays <= 7 ? 8 : (chartDays <= 14 ? 8 : 6),
            callback: function(val, idx) {
              return formatChartDate(this.getLabelForValue(val));
            },
          },
          grid: {
            color: '#2a2a3d',
            drawTicks: true,
            tickLength: 4,
          },
          border: {
            color: '#2a2a3d',
          },
        },
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: '#7e7e98',
            font: { size: 11, family: 'monospace' },
            stepSize: 25,
            callback: function(val) {
              return val + '%';
            },
          },
          grid: {
            color: '#2a2a3d',
          },
          border: {
            display: false,
          },
        },
      },
    },
  });
}

// Pill toggle controls
function initPillToggle() {
  var pillBtns = document.querySelectorAll('.pill-btn');
  var slider = document.getElementById('pillSlider');
  if (!slider || pillBtns.length === 0) return;

  function updateSlider() {
    var activeBtn = null;
    for (var i = 0; i < pillBtns.length; i++) {
      if (pillBtns[i].classList.contains('active')) {
        activeBtn = pillBtns[i];
        break;
      }
    }
    if (activeBtn) {
      slider.style.left = activeBtn.offsetLeft + 'px';
      slider.style.width = activeBtn.offsetWidth + 'px';
    }
  }

  for (var i = 0; i < pillBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        for (var j = 0; j < pillBtns.length; j++) {
          pillBtns[j].classList.remove('active');
        }
        btn.classList.add('active');
        chartDays = parseInt(btn.getAttribute('data-days'), 10);
        updateSlider();
        drawChart();
      });
    })(pillBtns[i]);
  }

  // Initial slider position (defer to next frame so layout is ready)
  requestAnimationFrame(updateSlider);
}
initPillToggle();

// --- Alerts ---

function renderAlerts() {
  var container = document.getElementById('alertRows');
  while (container.firstChild) container.removeChild(container.firstChild);

  // Preset buttons
  var presets = [
    { label: 'Conservative 60%', session: 60, weekAll: 60, weekSonnet: 60 },
    { label: 'Standard 80%', session: 80, weekAll: 90, weekSonnet: 90 },
    { label: 'Aggressive 95%', session: 95, weekAll: 95, weekSonnet: 95 },
  ];

  var presetsRow = el('div', 'alert-presets');

  function isPresetActive(preset) {
    return alertThresholds.session === preset.session
      && alertThresholds.weekAll === preset.weekAll
      && alertThresholds.weekSonnet === preset.weekSonnet;
  }

  for (var p = 0; p < presets.length; p++) {
    (function(preset) {
      var chip = el('button', 'preset-chip', preset.label);
      if (isPresetActive(preset)) chip.classList.add('active');
      chip.addEventListener('click', function() {
        alertThresholds.session = preset.session;
        alertThresholds.weekAll = preset.weekAll;
        alertThresholds.weekSonnet = preset.weekSonnet;
        saveAlertThresholds();
        renderAlerts();
      });
      presetsRow.appendChild(chip);
    })(presets[p]);
  }

  container.appendChild(presetsRow);

  // Per-metric fine-tuning rows
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
          updatePresetHighlights();
        }
      });

      plusBtn.addEventListener('click', function() {
        var val = alertThresholds[alert.key];
        if (val < 100) {
          alertThresholds[alert.key] = val + 5;
          valueEl.textContent = alertThresholds[alert.key] + '%';
          saveAlertThresholds();
          updatePresetHighlights();
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

function updatePresetHighlights() {
  var presets = [
    { session: 60, weekAll: 60, weekSonnet: 60 },
    { session: 80, weekAll: 90, weekSonnet: 90 },
    { session: 95, weekAll: 95, weekSonnet: 95 },
  ];
  var chips = document.querySelectorAll('.preset-chip');
  for (var i = 0; i < chips.length; i++) {
    if (i < presets.length) {
      var p = presets[i];
      var match = alertThresholds.session === p.session
        && alertThresholds.weekAll === p.weekAll
        && alertThresholds.weekSonnet === p.weekSonnet;
      if (match) {
        chips[i].classList.add('active');
      } else {
        chips[i].classList.remove('active');
      }
    }
  }
}

function saveAlertThresholds() {
  window.dashboardAPI.saveSettings({
    alertThresholds: {
      session: alertThresholds.session,
      weekAll: alertThresholds.weekAll,
      weekSonnet: alertThresholds.weekSonnet,
    },
  });
}

// --- Settings ---

var currentDisplayHotkey = 'Ctrl+\\';
var isRecordingHotkey = false;
var currentAppVersion = '...';

function formatElectronAccelerator(e) {
  var parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push(navigator.platform.indexOf('Mac') >= 0 ? 'Cmd' : 'Super');

  // Map key to Electron accelerator format
  var key = e.key;
  if (key === ' ') key = 'Space';
  else if (key === 'Escape') return null; // cancel
  else if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null; // modifier only
  else if (key === '\\') key = '\\';
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';
  else if (key === 'Delete') key = 'Delete';
  else if (key === 'Backspace') key = 'Backspace';
  else if (key === 'Enter') key = 'Return';
  else if (key === 'Tab') key = 'Tab';
  else if (key.length === 1) key = key.toUpperCase();

  if (parts.length === 0) return null; // require at least one modifier
  parts.push(key);
  return parts.join('+');
}

function renderSettings() {
  var container = document.getElementById('settingRows');
  while (container.firstChild) container.removeChild(container.firstChild);

  // Hotkey setting
  var hotkeyRow = el('div', 'setting-row');
  hotkeyRow.appendChild(el('div', 'setting-label', 'Toggle widget'));

  var hotkeyContainer = el('div', 'hotkey-container');
  var hotkeyDisplay = el('div', 'hotkey-display', currentDisplayHotkey);
  var changeBtn = el('button', 'hotkey-change-btn', 'Change');
  var statusEl = el('div', 'hotkey-status');

  var keydownHandler = null;

  changeBtn.addEventListener('click', function() {
    if (isRecordingHotkey) {
      // Cancel
      isRecordingHotkey = false;
      hotkeyDisplay.classList.remove('recording');
      hotkeyDisplay.textContent = currentDisplayHotkey;
      changeBtn.textContent = 'Change';
      if (keydownHandler) {
        document.removeEventListener('keydown', keydownHandler, true);
        keydownHandler = null;
      }
      return;
    }

    isRecordingHotkey = true;
    hotkeyDisplay.classList.add('recording');
    hotkeyDisplay.textContent = 'Press shortcut...';
    changeBtn.textContent = 'Cancel';
    statusEl.textContent = '';
    statusEl.className = 'hotkey-status';

    keydownHandler = function(e) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        // Cancel recording
        isRecordingHotkey = false;
        hotkeyDisplay.classList.remove('recording');
        hotkeyDisplay.textContent = currentDisplayHotkey;
        changeBtn.textContent = 'Change';
        document.removeEventListener('keydown', keydownHandler, true);
        keydownHandler = null;
        return;
      }

      var accelerator = formatElectronAccelerator(e);
      if (!accelerator) return; // modifier-only press, wait for full combo

      isRecordingHotkey = false;
      hotkeyDisplay.classList.remove('recording');
      hotkeyDisplay.textContent = accelerator;
      changeBtn.textContent = 'Change';
      document.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;

      // Send to main process
      statusEl.textContent = 'Registering...';
      statusEl.className = 'hotkey-status';

      window.dashboardAPI.changeHotkey(accelerator).then(function(result) {
        if (result.success) {
          currentDisplayHotkey = accelerator;
          statusEl.textContent = 'Hotkey updated!';
          statusEl.className = 'hotkey-status success';
        } else {
          hotkeyDisplay.textContent = currentDisplayHotkey;
          statusEl.textContent = result.error || 'Failed to register';
          statusEl.className = 'hotkey-status error';
        }
        setTimeout(function() {
          statusEl.textContent = '';
          statusEl.className = 'hotkey-status';
        }, 3000);
      });
    };

    document.addEventListener('keydown', keydownHandler, true);
  });

  hotkeyContainer.appendChild(hotkeyDisplay);
  hotkeyContainer.appendChild(changeBtn);
  hotkeyRow.appendChild(hotkeyContainer);
  hotkeyRow.appendChild(statusEl);
  container.appendChild(hotkeyRow);

  // Auto-start setting
  var autoRow = el('div', 'setting-row');
  autoRow.appendChild(el('div', 'setting-label', 'Start on login'));
  autoRow.appendChild(el('div', 'setting-value', 'Configurable via tray menu'));
  container.appendChild(autoRow);

  // Check for updates
  var updateRow = el('div', 'setting-row');
  updateRow.appendChild(el('div', 'setting-label', 'Updates'));
  var updateMeta = el('div', 'setting-value', 'Current version: v' + currentAppVersion);
  updateRow.appendChild(updateMeta);
  var updateBtn = el('button', 'update-btn', 'Check for Updates');
  var updateCheckResult = null;
  updateBtn.addEventListener('click', function() {
    // If we already found an update, trigger download
    if (updateCheckResult && updateCheckResult.hasUpdate) {
      if (!updateCheckResult.downloadUrl) {
        updateBtn.textContent = 'No installer found';
        setTimeout(function() {
          updateBtn.textContent = 'Update to v' + updateCheckResult.latestVersion;
        }, 3000);
        return;
      }
      updateBtn.textContent = 'Downloading...';
      updateBtn.disabled = true;
      updateBtn.classList.add('downloading');
      document.getElementById('updateProgress').classList.add('visible');
      window.dashboardAPI.installUpdate().then(function(result) {
        if (result.success) {
          updateBtn.textContent = 'Installing...';
          updateBtn.classList.remove('downloading');
        } else {
          updateBtn.textContent = 'Failed — retry';
          updateBtn.classList.remove('downloading');
          document.getElementById('updateProgress').classList.remove('visible');
          setTimeout(function() {
            updateBtn.textContent = 'Update to v' + updateCheckResult.latestVersion;
            updateBtn.disabled = false;
          }, 3000);
        }
      });
      return;
    }

    // First click — check for updates
    updateBtn.textContent = 'Checking...';
    updateBtn.disabled = true;
    updateBtn.style.background = '';
    updateBtn.style.borderColor = '';
    window.dashboardAPI.checkForUpdates().then(function(result) {
      var banner = document.getElementById('updateBanner');
      if (result && result.hasUpdate) {
        updateCheckResult = result;
        while (banner.firstChild) banner.removeChild(banner.firstChild);
        var icon = document.createElement('div');
        icon.className = 'update-banner-icon';
        icon.textContent = '\u2B06';
        banner.appendChild(icon);
        var txt = document.createElement('div');
        txt.className = 'update-banner-text';
        txt.appendChild(document.createTextNode('v' + result.latestVersion + ' available'));
        var sub = document.createElement('span');
        sub.textContent = 'New version ready to install';
        txt.appendChild(sub);
        banner.appendChild(txt);
        banner.classList.add('visible');
        updateBtn.textContent = 'Update to v' + result.latestVersion;
        updateBtn.disabled = false;
      } else {
        updateBtn.textContent = 'Up to date';
        updateBtn.style.background = 'var(--green)';
        updateBtn.style.borderColor = 'var(--green)';
        updateBtn.disabled = true;
        setTimeout(function() {
          updateBtn.textContent = 'Check for Updates';
          updateBtn.style.background = '';
          updateBtn.style.borderColor = '';
          updateBtn.disabled = false;
        }, 5000);
      }
    }).catch(function() {
      updateBtn.textContent = 'Check failed';
      setTimeout(function() {
        updateBtn.textContent = 'Check for Updates';
        updateBtn.disabled = false;
      }, 3000);
    });
  });
  updateRow.appendChild(updateBtn);
  container.appendChild(updateRow);

  // Sign out
  var signOutRow = el('div', 'setting-row');
  signOutRow.appendChild(el('div', 'setting-label', 'Account'));
  signOutRow.appendChild(el('div', 'setting-value', 'Clear cached OAuth token'));
  var signOutBtn = el('button', 'update-btn', 'Sign Out');
  signOutBtn.style.background = 'var(--red)';
  signOutBtn.style.borderColor = 'var(--red)';
  signOutBtn.addEventListener('click', function() {
    signOutBtn.textContent = 'Signing out...';
    signOutBtn.disabled = true;
    window.dashboardAPI.signOut().then(function() {
      signOutBtn.textContent = 'Signed out';
      signOutBtn.style.background = 'var(--text-dim)';
      signOutBtn.style.borderColor = 'var(--text-dim)';
    });
  });
  signOutRow.appendChild(signOutBtn);
  container.appendChild(signOutRow);

  // Version info
  var versionEl = document.getElementById('versionInfo');
  if (versionEl) versionEl.textContent = 'Claude Meter v' + currentAppVersion;
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

// --- Title bar controls ---

document.getElementById('tbMinimize').addEventListener('click', function() {
  window.dashboardAPI.minimize();
});
document.getElementById('tbMaximize').addEventListener('click', function() {
  window.dashboardAPI.maximize();
});
document.getElementById('tbClose').addEventListener('click', function() {
  window.dashboardAPI.close();
});

// --- Update ---

var pendingUpdate = null;

window.dashboardAPI.onUpdateAvailable(function(data) {
  pendingUpdate = data;
  var btn = document.getElementById('updateNowBtn');
  btn.textContent = 'Update to v' + data.latestVersion;
  btn.classList.add('visible');
  var ver = document.getElementById('sidebarVersion');
  ver.textContent = 'v' + currentAppVersion + ' \u2192 v' + data.latestVersion;
  // Populate overview banner
  var banner = document.getElementById('updateBanner');
  while (banner.firstChild) banner.removeChild(banner.firstChild);
  var icon = document.createElement('div');
  icon.className = 'update-banner-icon';
  icon.textContent = '\u2B06';
  banner.appendChild(icon);
  var txt = document.createElement('div');
  txt.className = 'update-banner-text';
  txt.appendChild(document.createTextNode('v' + data.latestVersion + ' available'));
  var sub = document.createElement('span');
  sub.textContent = 'New version ready to install';
  txt.appendChild(sub);
  banner.appendChild(txt);
  banner.classList.add('visible');
});

window.dashboardAPI.onUpdateProgress(function(pct) {
  var bar = document.getElementById('updateProgress');
  var fill = document.getElementById('updateProgressFill');
  var btn = document.getElementById('updateNowBtn');
  bar.classList.add('visible');
  fill.style.width = pct + '%';
  btn.textContent = pct + '% downloaded';
  btn.style.backgroundSize = pct + '% 100%';
});

document.getElementById('updateNowBtn').addEventListener('click', function() {
  if (!pendingUpdate) return;
  var btn = document.getElementById('updateNowBtn');

  if (!pendingUpdate.downloadUrl) {
    btn.textContent = 'No installer found';
    setTimeout(function() {
      btn.textContent = 'Update to v' + pendingUpdate.latestVersion;
    }, 3000);
    return;
  }

  btn.textContent = 'Downloading...';
  btn.disabled = true;
  btn.classList.add('downloading');
  document.getElementById('updateProgress').classList.add('visible');

  window.dashboardAPI.installUpdate().then(function(result) {
    if (result.success) {
      btn.textContent = 'Installing...';
      btn.classList.remove('downloading');
      btn.style.backgroundSize = '';
      btn.style.background = 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899)';
    } else {
      btn.textContent = 'Failed — retry';
      btn.classList.remove('downloading');
      btn.style.backgroundSize = '';
      btn.style.background = '';
      document.getElementById('updateProgress').classList.remove('visible');
      setTimeout(function() {
        btn.textContent = 'Update to v' + pendingUpdate.latestVersion;
        btn.disabled = false;
      }, 3000);
    }
  });
});

// --- Init ---

// Load persisted settings before rendering
window.dashboardAPI.getSettings().then(function(settings) {
  if (settings) {
    if (settings.hotkey) currentDisplayHotkey = settings.hotkey;
    if (settings.version) {
      currentAppVersion = settings.version;
      var sidebarVer = document.getElementById('sidebarVersion');
      if (sidebarVer) sidebarVer.textContent = 'v' + currentAppVersion;
    }
    if (settings.alertThresholds) {
      if (typeof settings.alertThresholds.session === 'number') {
        alertThresholds.session = settings.alertThresholds.session;
      }
      if (typeof settings.alertThresholds.weekAll === 'number') {
        alertThresholds.weekAll = settings.alertThresholds.weekAll;
      }
      if (typeof settings.alertThresholds.weekSonnet === 'number') {
        alertThresholds.weekSonnet = settings.alertThresholds.weekSonnet;
      }
    }
  }
  renderAlerts();
  renderSettings();
}).catch(function() {
  renderAlerts();
  renderSettings();
});
window.dashboardAPI.requestData();

// Sync status indicators
window.dashboardAPI.onSyncError(function(msg) {
  // If we have cached data, keep showing it — don't clear to 0
  if (usageData) renderOverview();
});

// Update countdowns every 10 seconds (lightweight text patch, no DOM rebuild)
setInterval(function() {
  if (!usageData) return;
  updateDashboardTimers();
}, 10000);

function updateDashboardTimers() {
  // Patch countdown text in overview cards
  var metaSpans = document.querySelectorAll('#overviewCards .card-meta');
  var sources = [usageData.session, usageData.weekAll, usageData.weekSonnet];
  for (var i = 0; i < metaSpans.length && i < sources.length; i++) {
    var spans = metaSpans[i].querySelectorAll('span');
    if (spans.length >= 2 && sources[i]) {
      spans[1].textContent = formatCountdown(sources[i].resetsAt);
    }
  }
}

// Redraw chart on window resize
window.addEventListener('resize', function() {
  var historyTab = document.getElementById('tab-history');
  if (historyTab && historyTab.classList.contains('active')) {
    drawChart();
  }
});
