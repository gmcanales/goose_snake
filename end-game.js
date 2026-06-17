'use strict';

// End-game modal + leaderboard.
// - Persists top 10 scores in localStorage under 'gooseHighScores'.
// - Names are uppercase alphanumeric, max 5 chars (arcade style).
// - On game over: shows score + leaderboard, plus name input if score qualifies.

(function () {
  const KEY     = 'gooseHighScores';
  const MAX     = 10;
  const NAME_LEN = 5;

  // ── Storage ────────────────────────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); }
    catch (e) { console.warn('Failed to save highscores:', e); }
  }

  function qualifies(score) {
    if (score <= 0) return false;
    const list = load();
    return list.length < MAX || score > list[list.length - 1].score;
  }

  function insert(name, score) {
    const list  = load();
    const entry = {
      name:  (name || '???').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NAME_LEN) || '???',
      score,
      date:  Date.now(),
    };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, MAX);
    save(trimmed);
    return { entry, list: trimmed, rank: trimmed.indexOf(entry) + 1 };
  }

  // ── UI ─────────────────────────────────────────────────
  const $modal   = document.getElementById('endgame-modal');
  const $title   = document.getElementById('endgame-title');
  const $score   = document.getElementById('endgame-score');
  const $input$  = document.getElementById('endgame-input-section');
  const $name    = document.getElementById('endgame-name');
  const $submit  = document.getElementById('endgame-submit');
  const $list    = document.getElementById('endgame-list');
  const $again   = document.getElementById('endgame-play-again');

  if (!$modal) return;

  let lastScore     = 0;
  let highlightRef  = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderList() {
    const list = load();
    if (list.length === 0) {
      $list.innerHTML = `<li class="endgame-empty">No scores yet — be the first goose!</li>`;
      return;
    }
    $list.innerHTML = list.map((e, i) => {
      const cls = (e === highlightRef) ? 'me' : '';
      return `<li class="${cls}">
        <span class="rank">${i + 1}.</span>
        <span class="name">${escapeHtml(e.name)}</span>
        <span class="score">${e.score}</span>
      </li>`;
    }).join('');
  }

  function submit() {
    if (lastScore <= 0) return;
    const result   = insert($name.value, lastScore);
    highlightRef   = result.entry;
    $input$.classList.remove('show');
    $title.textContent = `RANK #${result.rank}`;
    renderList();
  }

  function show(score) {
    lastScore    = score;
    highlightRef = null;
    $score.textContent = score;

    if (qualifies(score)) {
      $title.textContent = '✦ NEW HIGH SCORE ✦';
      $input$.classList.add('show');
      $name.value = '';
      // Focus after the show transition completes so the cursor isn't fighting layout
      setTimeout(() => $name.focus(), 250);
    } else {
      $title.textContent = 'GAME OVER';
      $input$.classList.remove('show');
    }

    renderList();
    $modal.classList.add('show');
  }

  function hide() { $modal.classList.remove('show'); }

  // Input filtering: uppercase alphanumeric, max 5 chars
  $name.addEventListener('input', e => {
    e.target.value = e.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, NAME_LEN);
  });
  $name.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  $submit.addEventListener('click', submit);

  $again.addEventListener('click', () => {
    hide();
    if (window.gameScene) window.gameScene.startGame();
  });

  // Expose to game.js
  window.showEndGameModal = show;
  window.hideEndGameModal = hide;
  window.clearHighScores  = () => { localStorage.removeItem(KEY); renderList(); };
})();
