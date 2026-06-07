'use strict';

// Dev console — toggled with backtick (`) or the [DEV] button.
// Quick actions hook into gameScene methods exposed for debugging.
// JSON editor shows the live CONFIG; "Apply" parses + replaces it.

(function () {
  const panel    = document.getElementById('dev-panel');
  const toggle   = document.getElementById('dev-toggle');
  const jsonArea = document.getElementById('dev-json');
  const statusEl = document.getElementById('dev-status');

  if (!panel) return;

  // ── Toggle visibility ──────────────────────────────────────
  function setOpen(open) {
    panel.classList.toggle('open', open);
    toggle.textContent = open ? 'CLOSE DEV' : 'DEV';
  }
  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  document.addEventListener('keydown', e => {
    if (e.key === '`' && !e.target.matches('input,textarea')) {
      setOpen(!panel.classList.contains('open'));
    }
  });

  // ── Status flash ───────────────────────────────────────────
  let statusTimer = null;
  function flash(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.className   = isError ? 'err' : 'ok';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 2200);
  }

  // ── JSON editor ────────────────────────────────────────────
  function syncJsonFromConfig() {
    jsonArea.value = JSON.stringify(CONFIG, null, 2);
  }
  syncJsonFromConfig();

  document.getElementById('dev-apply-json').addEventListener('click', () => {
    try {
      const parsed = JSON.parse(jsonArea.value);
      for (const k of Object.keys(CONFIG)) delete CONFIG[k];
      Object.assign(CONFIG, parsed);
      flash('Config applied');
    } catch (e) {
      flash('Invalid JSON: ' + e.message, true);
    }
  });

  document.getElementById('dev-reset').addEventListener('click', () => {
    resetConfig();
    syncJsonFromConfig();
    flash('Reset to defaults');
  });

  document.getElementById('dev-save').addEventListener('click', () => {
    try {
      saveConfigToStorage();
      flash('Saved to localStorage');
    } catch (e) {
      flash('Save failed: ' + e.message, true);
    }
  });

  document.getElementById('dev-clear-save').addEventListener('click', () => {
    clearConfigStorage();
    flash('Cleared saved config');
  });

  document.getElementById('dev-download').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(CONFIG, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'goose-config.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('dev-upload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      jsonArea.value = reader.result;
      flash('Loaded — click Apply');
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-upload of same file
  });

  // ── Quick actions ──────────────────────────────────────────
  function withScene(fn, label) {
    if (!gameScene) { flash('Scene not ready', true); return; }
    try { fn(gameScene); flash(label); }
    catch (e) { flash(e.message, true); console.error(e); }
  }

  document.getElementById('dev-jump-level').addEventListener('click', () => {
    const n = parseInt(document.getElementById('dev-level-input').value, 10);
    if (!Number.isFinite(n) || n < 1) { flash('Invalid level', true); return; }
    withScene(s => s.jumpToLevel(n), `Jumped to level ${n}`);
  });

  document.getElementById('dev-spawn-snack').addEventListener('click', () => {
    const type = document.getElementById('dev-snack-type').value;
    withScene(s => s.spawnSpecificSnack(type), `Spawned ${type}`);
  });

  document.getElementById('dev-add-length').addEventListener('click', () => {
    const n = parseInt(document.getElementById('dev-length-input').value, 10);
    if (!Number.isFinite(n)) return;
    withScene(s => s.addLength(n), `${n > 0 ? '+' : ''}${n} length`);
  });

  document.getElementById('dev-god').addEventListener('click', () => {
    withScene(s => {
      s.godMode = !s.godMode;
      document.getElementById('dev-god').textContent = `God Mode: ${s.godMode ? 'ON' : 'OFF'}`;
    }, '');
  });

  document.getElementById('dev-pause').addEventListener('click', () => {
    withScene(s => {
      s.running = !s.running;
      if (s.running) s.lastTickTime = s.time.now; // avoid catch-up burst
      document.getElementById('dev-pause').textContent = s.running ? 'Pause' : 'Resume';
    }, '');
  });

  document.getElementById('dev-clear-fx').addEventListener('click', () => {
    withScene(s => { s.fx = { speedTicks: 0, slowTicks: 0, multLeft: 0 }; s.renderEffectsBar(); },
      'FX cleared');
  });

  document.getElementById('dev-clear-obstacles').addEventListener('click', () => {
    withScene(s => { s.obstacles = []; }, 'Obstacles cleared');
  });

  document.getElementById('dev-show-json').addEventListener('click', () => {
    syncJsonFromConfig();
    flash('JSON refreshed from live config');
  });
})();
