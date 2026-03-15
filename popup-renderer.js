/* Popup renderer — receives data via IPC, safe DOM only */

document.getElementById('dismissBtn').addEventListener('click', function() {
  window.popupAPI.dismiss();
});

setTimeout(function() {
  window.popupAPI.dismiss();
}, 8000);

window.popupAPI.onPopupData(function(p) {
  document.getElementById('popup').className = 'popup ' + p.severity;
  document.getElementById('icon').textContent = p.severity === 'danger' ? '\u26A0' : '\u26A1';
  document.getElementById('title').textContent = p.label + ' at ' + p.pct + '%';
  document.getElementById('subtitle').textContent = 'Usage threshold exceeded';
  document.getElementById('barLabel').textContent = p.label;
  document.getElementById('barPct').textContent = p.pct + '%';
  document.getElementById('resetInfo').textContent = p.resetText;
  setTimeout(function() {
    document.getElementById('bf').style.width = p.pct + '%';
  }, 50);
});
