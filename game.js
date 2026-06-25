'use strict';

// ── Fixed world constants (not config-driven) ──────────────
const CELL = 20;
const COLS = 20;      // snake-area columns
const ROWS = 20;
const W = COLS * CELL;  // 400 viewport width
const H = ROWS * CELL;  // 400 viewport height
const FROG_START = COLS;         // frogger road begins at col 20
const CAM_BOUND_W = 1e7;          // effectively infinite scroll right

// ── DOM refs ───────────────────────────────────────────────
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const lengthEl = document.getElementById('length');
const lenDispEl = document.getElementById('length-display');
const distanceEl = document.getElementById('distance');
const distDispEl = document.getElementById('distance-display');
const timerEl = document.getElementById('timer');
const timerDispEl = document.getElementById('timer-display');
const startBtn = document.getElementById('start-btn');
const msgEl = document.getElementById('game-message');
const effectsEl = document.getElementById('effects-bar');
const ctrlHintEl = document.getElementById('controls-hint');
const swipeHintEl = document.getElementById('swipe-hint');

// Touch device → drive with swipes instead of the keyboard.
const IS_TOUCH = (typeof window !== 'undefined') &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));

// Tactile confirmation on touch devices. Short pulse for a registered turn, a
// longer one when a snack is eaten — the "input landed" cue keyboard gets for
// free. No-op where the Vibration API is absent (iOS Safari, desktop).
const HAPTIC_TURN_MS = 12;
const HAPTIC_EAT_MS  = 40;
function haptic(ms) {
  if (!IS_TOUCH || !navigator.vibrate) return;
  try { navigator.vibrate(ms); } catch (e) { /* unsupported / blocked */ }
}

const SNAKE_HINT = IS_TOUCH ? 'Swipe to move' : 'Arrow keys or WASD  ·  ` for dev console';
const FROGGER_HINT = '↑↓ to dodge  ·  always advancing';

// Direction-aware control hint for frogger.
function froggerHintFor(dir) {
  if (IS_TOUCH) return 'Swipe to dodge';
  const horizontal = dir && dir.x !== 0;
  return horizontal
    ? 'Up/Down to dodge  ·  always advancing'
    : 'Left/Right to dodge  ·  always advancing';
}

// 90° rotations for picking turn direction
const TURN_CW  = (d) => ({ x: -d.y, y:  d.x });
const TURN_CCW = (d) => ({ x:  d.y, y: -d.x });
// Perpendicular vector (sideways along road)
const PERP = (d) => TURN_CW(d);

// Deterministic 2D hash → [0, 1). Used for tree placement so the same world
// cell always gets the same tree (or no tree), making the scenery stable as
// the camera revisits an area, but appearing random across the world.
function hash2D(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 0x100000000;
}

// Cell-coordinate range of the road perpendicular axis (offsets from perpCenter).
// 4 lanes × 1 width → top=-2 bot=1; 4 lanes × 2 width → top=-4 bot=3.
function laneOffsetRange(count, width = 1) {
  const total = count * width;
  const top = -Math.floor(total / 2);
  return { top, bot: top + total - 1 };
}

let gameScene = null;

// ── Phaser Scene ───────────────────────────────────────────
class GooseScene extends Phaser.Scene {
  constructor() { super({ key: 'GooseScene' }); }

  preload() {
    const keys = [
      'goose-head', 'goose-neck', 'goose-tail',
      'snack-bread', 'snack-speed', 'snack-slow',
      'snack-shrink', 'snack-star', 'snack-rampage',
      'enemy-car', 'enemy-truck',
      'enemy-super', 'enemy-streak',            // rare super enemy + its streak
      ...ENEMY_CAR_KEYS, ...ENEMY_TRUCK_KEYS,   // recolored vehicle variants
    ];
    for (const k of keys) this.load.image(k, spriteDataURI(k));
    this.load.on('loaderror', file => console.error('Sprite failed:', file.key));
  }

  create() {
    gameScene = this;
    window.gameScene = this; // for cross-script access (end-game modal)

    this.bgGfx = this.add.graphics().setDepth(0);   // static — snake area
    this.dynBgGfx = this.add.graphics().setDepth(1);   // dynamic — frogger road, redrawn per frame
    this.gameGfx = this.add.graphics().setDepth(2);   // game elements (snake, walls, obstacles)

    this.headImg = this.add.image(-100, -100, 'goose-head').setDepth(6).setVisible(false);

    // Body segments are rendered as pooled SVG sprites (neck for intermediate
    // cells, tail for the last cell). Pool grows as the goose grows, shrinks
    // by hiding (not destroying) when the goose shrinks.
    this.bodySprites = [];

    this.snake = null;
    this.foods = [];
    this.obstacles = [];
    this.score = 0;
    this.level = 1;
    this.snacksEaten = 0;
    this.running = false;
    this.froggerMode = false;
    this.godMode = false;

    this.fx = { speedTicks: 0, slowTicks: 0, multLeft: 0, godMs: 0 };

    this.activeEnemies = [];
    this.enemyPool = [];
    this.streakPool = [];   // pooled super-enemy streak sprites
    this.flyingEnemies = []; // enemies mid smash-away animation (rampage)
    this.lanes = [];
    this.lastEnemySpawn = {};

    // Frogger movement: head auto-advances right every tick; ↑/↓ queues a
    // one-cell vertical change consumed on the next tick.
    this.queuedVertical = 0;          // legacy, retained for snake-mode parity
    this.queuedDodge    = { x: 0, y: 0 }; // frogger 2D dodge
    this.invulnTicks    = 0;

    // Frogger segments (created on entering frogger mode)
    this.segments           = [];
    this.activeSegmentIdx   = 0;
    this.distInSegment      = 0;
    this.distCompletedSegs  = 0;

    // Section splash invalidation token — newer splashes override older
    // pending resume callbacks (e.g. user restarts mid-splash).
    this.splashToken = 0;

    // Timed growth round (level 5): countdown ms remaining or null when inactive.
    // Delta-based so the splash pause and dev-pause don't drain real-time clock.
    this.timeLeftInRound = null;
    // Last 10s bucket announced via the milestone flash (60s → bucket 6 ...).
    this.lastTimerFlashBucket = 0;

    this.lastTickTime = 0;
    this.prevCells = [];
    this.nextDx = 1;
    this.nextDy = 0;
    // Pre-loaded turns consumed one-per-tick. Lets a fast "→ ↓" register both
    // moves instead of the second overwriting the first, so cornering on touch
    // feels as responsive as stabbing two arrow keys.
    this.dirQueue = [];

    this.drawBackground();

    this.input.keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
    ]);
    this.input.keyboard.on('keydown', e => this.handleKey(e));

    // Swipe steering (touch + mouse-drag). Pointer coords are in game space, so
    // the threshold is resolution-independent. Re-anchoring on each threshold
    // cross lets one continuous drag chain turns (e.g. right→down for an L).
    const SWIPE_TH = 22; // ~1.1 cells in game space
    this.input.on('pointerdown', p => { this._swipeAnchor = { x: p.x, y: p.y }; });
    this.input.on('pointermove', p => {
      if (!p.isDown || !this._swipeAnchor) return;
      const dx = p.x - this._swipeAnchor.x;
      const dy = p.y - this._swipeAnchor.y;
      if (Math.abs(dx) < SWIPE_TH && Math.abs(dy) < SWIPE_TH) return;
      if (Math.abs(dx) > Math.abs(dy)) this.setDirection(Math.sign(dx), 0);
      else                             this.setDirection(0, Math.sign(dy));
      this._swipeAnchor = { x: p.x, y: p.y };
      this.dismissSwipeHint();
    });
    this.input.on('pointerup', () => { this._swipeAnchor = null; });
  }

  // ── Frame loop ─────────────────────────────────────────
  update(time, delta) {
    if (!this.snake) return;

    if (this.froggerMode) {
      // Camera follows player's world position on both axes (road can bend)
      if (this.running) {
        const targetX = this.snake.x * CELL - W / 2 + CELL / 2;
        const targetY = this.snake.y * CELL - H / 2 + CELL / 2;
        const cam = this.cameras.main;
        cam.scrollX = Phaser.Math.Linear(cam.scrollX, targetX, 0.12);
        cam.scrollY = Phaser.Math.Linear(cam.scrollY, targetY, 0.12);

        // Rampage timer (real-time) — drains only while running so it isn't
        // burned during splashes/pauses. Refresh the bar when it lapses.
        if (this.fx.godMs > 0) {
          this.fx.godMs = Math.max(0, this.fx.godMs - delta);
          if (this.fx.godMs === 0) this.renderEffectsBar();
        }

        this.updateEnemies(delta, time);
        this.maybeSpawnRampage(time);
      }
      this.updateFlyingEnemies(delta);  // animate smashed enemies even while paused-out
      this.drawDynamicRoad();
    }

    if (this.running && time - this.lastTickTime >= this.tickMs()) {
      this.lastTickTime = time;
      this.gameTick();
    }

    // Timed growth round countdown — delta-based so splash/dev pauses don't drain it
    if (this.timeLeftInRound != null && this.running) {
      this.timeLeftInRound -= delta;
      if (this.timeLeftInRound <= 0) {
        this.timeLeftInRound = null;
        timerDispEl.classList.remove('show');
        this.startFroggerMode();
      } else {
        timerEl.textContent = Math.ceil(this.timeLeftInRound / 1000);
        // Flash a "KEEP EATING — Ns" message each time we cross a 10s bucket
        const bucket = Math.ceil(this.timeLeftInRound / 10000);
        if (bucket < this.lastTimerFlashBucket && bucket > 0) {
          this.lastTimerFlashBucket = bucket;
          this.flashTimerMilestone(bucket * 10);
        }
      }
    }

    const t = Math.min(1, (time - this.lastTickTime) / this.tickMs());
    this.draw(t);
  }

  tickMs() {
    const speeds = CONFIG.levelSpeeds;
    let base = speeds[Math.min(this.level - 1, speeds.length - 1)];
    // Touch devices get a gentler snake pace (frogger/DODGE keeps full speed).
    if (IS_TOUCH && !this.froggerMode) base *= (CONFIG.mobileSnakeSpeedFactor ?? 1);
    if (this.fx.godMs > 0) return Math.round(base * (CONFIG.snacks.rampage?.tickMultiplier ?? 0.55));
    if (this.fx.speedTicks > 0) return Math.round(base * CONFIG.snacks.speed.tickMultiplier);
    if (this.fx.slowTicks > 0) return Math.round(base * CONFIG.snacks.slow.tickMultiplier);
    return Math.round(base);
  }

  // ── Input ──────────────────────────────────────────────
  // Keyboard → cardinal direction. Thin mapper onto setDirection() so keyboard,
  // swipe, and any future input all share one path.
  handleKey(e) {
    const map = {
      ArrowUp: [0, -1], KeyW: [0, -1],
      ArrowDown: [0, 1], KeyS: [0, 1],
      ArrowLeft: [-1, 0], KeyA: [-1, 0],
      ArrowRight: [1, 0], KeyD: [1, 0],
    };
    const dir = map[e.code];
    if (!dir) return;
    this.setDirection(dir[0], dir[1]);
  }

  // Apply a cardinal steering intent (dx,dy ∈ {-1,0,1}, one axis non-zero).
  // Snake: queue the next heading, ignoring 180° reversals.
  // Frogger: only the axis perpendicular to current travel dodges; the parallel
  // axis is ignored (matches how the road reorients on turns).
  setDirection(dx, dy) {
    if (!this.running || !this.snake) return;

    if (this.froggerMode) {
      const seg = this.activeSegment();
      if (!seg) return;
      const horizontal = seg.dir.x !== 0;
      let set = false;
      if (horizontal) {
        if      (dy === -1) { this.queuedDodge = { x: 0, y: -1 }; set = true; }
        else if (dy ===  1) { this.queuedDodge = { x: 0, y:  1 }; set = true; }
      } else {
        if      (dx === -1) { this.queuedDodge = { x: -1, y: 0 }; set = true; }
        else if (dx ===  1) { this.queuedDodge = { x:  1, y: 0 }; set = true; }
      }
      if (set) haptic(HAPTIC_TURN_MS);
      return;
    }

    // Validate against the last *pending* heading (end of queue), not the
    // committed one — otherwise a queued turn's follow-up would be judged
    // against a direction we've already decided to leave.
    const last = this.dirQueue.length
      ? this.dirQueue[this.dirQueue.length - 1]
      : { dx: this.nextDx, dy: this.nextDy };
    if (dx === -last.dx && dy === -last.dy) return;  // can't reverse into the neck
    if (dx === last.dx && dy === last.dy) return;    // no-op: same heading
    if (this.dirQueue.length >= 2) return;           // cap the look-ahead at 2 turns
    this.dirQueue.push({ dx, dy });
    haptic(HAPTIC_TURN_MS);
  }

  // Steer relative to the current heading: turn = -1 (left) / +1 (right).
  // Two-input scheme for one-thumb play — no absolute aiming, and reversing
  // into yourself is impossible by construction. Routes through setDirection()
  // so input buffering and reversal rules apply uniformly. Screen y is down, so
  // a clockwise (right) turn maps (x,y) → (-y, x).
  turnRelative(turn) {
    if (!this.running || !this.snake) return;
    let ref;
    if (this.froggerMode) {
      const seg = this.activeSegment();
      if (!seg) return;
      ref = { dx: seg.dir.x, dy: seg.dir.y };
    } else {
      ref = this.dirQueue.length
        ? this.dirQueue[this.dirQueue.length - 1]
        : { dx: this.nextDx, dy: this.nextDy };
    }
    const [nx, ny] = turn > 0 ? [-ref.dy, ref.dx] : [ref.dy, -ref.dx];
    this.setDirection(nx, ny);
  }

  // Hide the one-time "swipe to move" coachmark (first touch input dismisses it).
  dismissSwipeHint() {
    if (swipeHintEl) swipeHintEl.classList.remove('show');
  }

  // ── Game start ─────────────────────────────────────────
  startGame() {
    if (typeof window.hideEndGameModal === 'function') window.hideEndGameModal();
    for (const f of this.foods) f.sprite?.destroy();
    for (const e of this.activeEnemies) this.recycleEnemy(e);
    this.clearFlyingEnemies();
    this.foods = [];
    this.activeEnemies = [];
    this.obstacles = [];
    this.lastEnemySpawn = {};

    const start = CONFIG.startPos;
    this.snake = { x: start.x, y: start.y, dx: 1, dy: 0, maxCells: CONFIG.startLength, cells: [] };
    for (let i = 0; i < this.snake.maxCells; i++)
      this.snake.cells.push({ x: this.snake.x - i, y: this.snake.y });
    this.prevCells = this.snake.cells.map(c => ({ ...c }));

    this.nextDx = 1;
    this.nextDy = 0;
    this.dirQueue = [];
    this.queuedVertical = 0;
    this.queuedDodge    = { x: 0, y: 0 };
    this.invulnTicks = 0;
    this.segments          = [];
    this.activeSegmentIdx  = 0;
    this.distInSegment     = 0;
    this.distCompletedSegs = 0;
    this.score = 0;
    this.level = 1;
    this.snacksEaten = 0;
    this.fx = { speedTicks: 0, slowTicks: 0, multLeft: 0, godMs: 0 };
    this.froggerMode = false;
    this.running = true;
    this.lastTickTime = this.time.now;
    this.timeLeftInRound = null;
    this.lastTimerFlashBucket = 0;

    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.setScroll(0, 0);

    scoreEl.textContent = 0;
    levelEl.textContent = 1;
    lengthEl.textContent = this.snake.maxCells;
    distanceEl.textContent = 0;
    lenDispEl.classList.remove('show');
    distDispEl.classList.remove('show');
    timerDispEl.classList.remove('show');
    document.getElementById('level-splash')?.classList.remove('show');
    ctrlHintEl.textContent = SNAKE_HINT;
    if (IS_TOUCH && swipeHintEl) swipeHintEl.classList.add('show');
    msgEl.textContent = '';
    msgEl.className = '';
    effectsEl.innerHTML = '';

    this.headImg.setVisible(false);
    for (const sp of this.bodySprites) sp.setVisible(false);
    this.bgGfx.setVisible(true); // snake-area bg is hidden in frogger mode
    this.drawBackground();
    this.spawnMissingFood();
    startBtn.textContent = 'Restart';

    this.showSectionSplash(1, 'GROW', 'grow');
  }

  // ── Section splash ─────────────────────────────────────
  // Pauses the game, plays the CSS keyframe animation, resumes after.
  // Uses a token so a fresh start mid-splash doesn't accidentally un-pause
  // an obsolete previous splash's resume callback.
  // Briefly flash "KEEP EATING — Ns" over the canvas at each 10s milestone
  // during the growth round. Does NOT pause the game (unlike showSectionSplash).
  // Last call ≤10s uses the 'urgent' (red) styling.
  flashTimerMilestone(seconds) {
    const el = document.getElementById('timer-flash');
    if (!el) return;
    el.querySelector('.num').textContent = `${seconds}s`;
    el.classList.toggle('urgent', seconds <= 10);
    el.classList.remove('show');
    void el.offsetWidth;  // restart animation
    el.classList.add('show');
  }

  showSectionSplash(num, title, kind) {
    const el = document.getElementById('section-splash');
    const num$ = el.querySelector('.num');
    const ttl$ = el.querySelector('.title');
    num$.textContent = `SECTION ${num}`;
    ttl$.textContent = title;

    el.classList.remove('show', 'kind-grow', 'kind-dodge');
    if (kind) el.classList.add('kind-' + kind);
    void el.offsetWidth;          // force reflow → restart animation
    el.classList.add('show');

    this.pauseForSplash(1700);
  }

  // Animated "LEVEL N" transition between snake levels (2–4). Pauses gameplay
  // for a beat — like the section splashes — so a level change reads as a
  // deliberate transition, and surfaces any snacks newly unlocked at this level.
  showLevelSplash(level) {
    const el = document.getElementById('level-splash');
    if (!el) return;
    el.querySelector('.badge').textContent = 'LEVEL';
    el.querySelector('.num').textContent = level;
    el.querySelector('.sub').textContent = this.levelUnlockText(level);
    el.classList.remove('show');
    void el.offsetWidth;          // force reflow → restart animation
    el.classList.add('show');
    this.pauseForSplash(1200);
  }

  // Names of snacks that first become available at `level` (per snackMinLevel),
  // as a short "X & Y unlocked" subtitle. Empty when nothing new unlocks here.
  levelUnlockText(level) {
    const NAMES = { bread: 'Bread', speed: 'Speed', slow: 'Slow', shrink: 'Shrink', star: 'Star' };
    const minLvl = CONFIG.snackMinLevel || {};
    const unlocked = Object.keys(minLvl)
      .filter(t => minLvl[t] === level)
      .map(t => NAMES[t] || t);
    return unlocked.length ? `${unlocked.join(' & ')} unlocked` : '';
  }

  // Freeze gameplay for `ms` while a transition splash animates, then resume.
  // Token-guarded (shared splashToken) so a fresh start — or a newer splash —
  // cancels a stale resume. Re-staggers frogger spawn timestamps on resume so
  // the queued-up traffic doesn't all fire the instant the pause lifts.
  pauseForSplash(ms) {
    const token = ++this.splashToken;
    this.running = false;
    this.time.delayedCall(ms, () => {
      if (token !== this.splashToken || !this.snake) return;
      // Re-stagger frogger spawn timestamps so all 18 lanes don't fire at once
      // after the pause (real time advanced but enemies didn't move)
      if (this.froggerMode) {
        const now = this.time.now;
        for (const row of Object.keys(this.lastEnemySpawn)) {
          this.lastEnemySpawn[row] = now - Math.random() * 1500;
        }
      }
      this.running = true;
      this.lastTickTime = this.time.now;
    });
  }

  // ── Game tick ──────────────────────────────────────────
  gameTick() {
    const s = this.snake;
    this.prevCells = s.cells.map(c => ({ ...c }));

    if (this.froggerMode) {
      // Auto-runner: head advances along segment direction; queued dodge
      // moves perpendicular. Forward axis always moves 1 cell per tick.
      const seg = this.activeSegment();
      s.dx = seg.dir.x + this.queuedDodge.x;
      s.dy = seg.dir.y + this.queuedDodge.y;
      this.queuedDodge = { x: 0, y: 0 };
    } else {
      // Commit the next pre-loaded turn (if any), then apply the heading.
      if (this.dirQueue.length) {
        const d = this.dirQueue.shift();
        this.nextDx = d.dx;
        this.nextDy = d.dy;
      }
      s.dx = this.nextDx;
      s.dy = this.nextDy;
    }

    s.x += s.dx;
    s.y += s.dy;

    if (this.froggerMode) {
      const seg = this.activeSegment();
      const horizontal = seg.dir.x !== 0;
      const perpAxis   = horizontal ? 'y' : 'x';
      const lw = CONFIG.frogger.laneWidthCells ?? 1;
      const { top, bot } = laneOffsetRange(seg.lanes, lw);
      // Clamp to perpendicular road range (top/bottom walls — no death, just bump)
      const off = s[perpAxis] - seg.perpCenter;
      if (off < top) s[perpAxis] = seg.perpCenter + top;
      else if (off > bot) s[perpAxis] = seg.perpCenter + bot;

      // Forward progress in current segment
      this.distInSegment += 1;
      const total = this.distCompletedSegs + this.distInSegment;
      if (total > this.maxDistance) {
        this.score += (total - this.maxDistance) * (CONFIG.distancePointsPerCell ?? 1);
        this.maxDistance = total;
        scoreEl.textContent    = this.score;
        distanceEl.textContent = this.maxDistance;
      }

      // Time to turn?
      if (this.distInSegment >= seg.length) this.turn();
    } else {
      if (s.x < 0) s.x = COLS - 1;
      else if (s.x >= COLS) s.x = 0;
      if (s.y < 0) s.y = ROWS - 1;
      else if (s.y >= ROWS) s.y = 0;
    }

    s.cells.unshift({ x: s.x, y: s.y });

    if (!this.froggerMode && this.obstacles.some(o => o.x === s.x && o.y === s.y)) {
      if (!this.godMode) { this.endGame(); return; }
    }

    // Frogger: enemy collision drains length instead of instant death. While
    // invincible (rampage), overlapping enemies are smashed in updateEnemies,
    // so no damage is taken here.
    if (this.froggerMode && this.invulnTicks <= 0 && !this.isInvincible() && this.checkEnemyCollision()) {
      this.takeDamage();
      if (this.snake.maxCells < (CONFIG.frogger.minLength ?? 1)) { this.endGame(); return; }
    }

    const eaten = this.foods.findIndex(f => f.x === s.x && f.y === s.y);
    if (eaten >= 0) {
      const [food] = this.foods.splice(eaten, 1);
      food.sprite?.destroy();
      this.applyEffect(food.type);
      haptic(HAPTIC_EAT_MS);
      this.snacksEaten++;
      scoreEl.textContent = this.score;
      this.renderEffectsBar();
      if (this.snacksEaten >= this.level * CONFIG.snacksPerLevel) this.levelUp();
      if (!this.froggerMode) this.spawnMissingFood();
    }

    while (s.cells.length > s.maxCells) s.cells.pop();

    // Self-collision: damages in frogger (with i-frames), instant in snake mode
    for (let i = 1; i < s.cells.length; i++) {
      if (s.x === s.cells[i].x && s.y === s.cells[i].y) {
        if (this.isInvincible()) break;
        if (this.froggerMode) {
          if (this.invulnTicks <= 0) {
            this.takeDamage();
            if (this.snake.maxCells < (CONFIG.frogger.minLength ?? 1)) { this.endGame(); return; }
          }
          break;
        }
        this.endGame(); return;
      }
    }

    if (this.invulnTicks > 0) this.invulnTicks--;
    if (this.fx.speedTicks > 0) { this.fx.speedTicks--; this.renderEffectsBar(); }
    if (this.fx.slowTicks > 0) { this.fx.slowTicks--; this.renderEffectsBar(); }
  }

  // ── Damage ─────────────────────────────────────────────
  takeDamage() {
    const s = this.snake;
    s.maxCells = Math.max(0, s.maxCells - 1);
    while (s.cells.length > s.maxCells) s.cells.pop();
    this.invulnTicks = CONFIG.frogger.invulnTicks ?? 6;
    lengthEl.textContent = s.maxCells;
  }

  // ── Snack effects ──────────────────────────────────────
  applyEffect(type) {
    const s = this.snake;
    const cfg = CONFIG.snacks[type] || {};
    const mult = this.fx.multLeft > 0;
    const m = mult ? CONFIG.scoreMultiplier : 1;
    const pts = (cfg.points ?? 1) * m;

    switch (type) {
      case 'bread':
        s.maxCells += (cfg.grow ?? 1);
        this.score += pts;
        if (mult) this.fx.multLeft--;
        break;
      case 'speed':
        this.fx.speedTicks = cfg.durationTicks ?? 6;
        this.fx.slowTicks = 0;
        this.score += pts;
        if (mult) this.fx.multLeft--;
        break;
      case 'slow':
        this.fx.slowTicks = cfg.durationTicks ?? 8;
        this.fx.speedTicks = 0;
        this.score += pts;
        if (mult) this.fx.multLeft--;
        break;
      case 'shrink':
        s.maxCells = Math.max(cfg.minLength ?? 2, s.maxCells - (cfg.shrinkBy ?? 2));
        while (s.cells.length > s.maxCells) s.cells.pop();
        this.score += pts;
        if (mult) this.fx.multLeft--;
        break;
      case 'star':
        this.fx.multLeft = cfg.multiplierUses ?? 5;
        this.score += pts;
        break;
      case 'rampage':
        this.fx.godMs = cfg.durationMs ?? 5000;
        this.score += pts;
        if (mult) this.fx.multLeft--;
        break;
    }
    lengthEl.textContent = s.maxCells;
  }

  // ── Level up ───────────────────────────────────────────
  levelUp() {
    const final = CONFIG.snakeFinalLevel ?? 5;
    if (this.level >= final) return; // already at growth round — timer drives transition

    this.level++;
    levelEl.textContent = this.level;
    this.spawnLevelObstacles();

    if (this.level === final) {
      // Final level = timed growth round, not a normal level
      this.startTimedRound();
      return;
    }

    this.showLevelSplash(this.level);
  }

  spawnLevelObstacles() {
    const target = Math.min(CONFIG.obstaclesPerLevel * (this.level - 1), CONFIG.maxObstacles);
    let tries = 0;
    while (this.obstacles.length < target && tries++ < 200) {
      const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (!this.cellBlocked(p.x, p.y, true)) this.obstacles.push(p);
    }
  }

  // ── Timed growth round (level 5) ──────────────────────
  // Snacks keep spawning at finalLevelFoodCount; transitions to frogger when
  // the delta-based timeLeftInRound hits 0 (see update()).
  startTimedRound() {
    this.timeLeftInRound = CONFIG.finalLevelDurationMs ?? 60000;
    this.lastTimerFlashBucket = Math.ceil(this.timeLeftInRound / 10000);
    timerEl.textContent = Math.ceil(this.timeLeftInRound / 1000);
    timerDispEl.classList.add('show');

    // Top up food immediately to the higher target so the player starts strong
    this.spawnMissingFood();

    msgEl.className = 'msg-level';
    msgEl.textContent = `⏱ GROWTH ROUND — eat fast! 𓅬`;
    this.time.delayedCall(2200, () => {
      if (this.running && msgEl.className === 'msg-level') { msgEl.textContent = ''; msgEl.className = ''; }
    });
  }

  // ── Frogger mode (segment-based, direction-aware) ─────
  startFroggerMode() {
    this.froggerMode = true;

    for (const f of this.foods) f.sprite?.destroy();
    this.foods = [];

    // World bounds large enough for play in any direction
    this.cameras.main.setBounds(-1e7, -1e7, 2e7, 2e7);

    // Hide snake-area background — frogger world is its own thing
    this.bgGfx.setVisible(false);

    // Distance: cumulative forward progress across segments
    this.distCompletedSegs = 0;     // distance from completed segments
    this.distInSegment     = 0;     // forward cells in active segment
    this.maxDistance       = 0;
    distanceEl.textContent = 0;
    distDispEl.classList.add('show');

    // Length doubles as HP
    lengthEl.textContent = this.snake.maxCells;
    lenDispEl.classList.add('show');

    // Direction & first segment — start going right from current snake pos
    const startDir = { x: 1, y: 0 };
    this.segments        = [];
    this.activeSegmentIdx = 0;
    this.segments.push(this.makeSegment(startDir, this.snake.x, this.snake.y));
    // Pre-generate the next segment so the bend is rendered before the camera
    // catches up to it — prevents the road from popping in at the corner.
    this.appendNextSegment();

    // Per-direction input state
    this.queuedDodge = { x: 0, y: 0 };
    this.invulnTicks = 0;

    // Clear any pre-existing enemies (snake-mode might have left state)
    for (const e of this.activeEnemies) this.recycleEnemy(e);
    this.activeEnemies = [];
    this.lastEnemySpawn = {};
    this.rebuildLanesForActiveSegment();

    // Rampage state: no active effect, first pickup a few seconds in.
    this.clearFlyingEnemies();
    this.fx.godMs = 0;
    this.nextRampageSpawn = this.time.now + 7000 + Math.random() * 4000;

    ctrlHintEl.textContent = froggerHintFor(startDir);

    this.showSectionSplash(2, 'DODGE', 'dodge');
  }

  // ── Segment management ────────────────────────────────
  // Each segment is one straight piece of road. Lane count is the count at
  // segment creation (changes between segments, not within one).
  makeSegment(dir, originCellX, originCellY) {
    const fcfg = CONFIG.frogger;
    const lanes = this.currentLaneCount();
    const length = Math.floor(
      fcfg.turnIntervalMin + Math.random() * (fcfg.turnIntervalMax - fcfg.turnIntervalMin)
    );
    // perpCenter is the cell coord along the perp axis at segment start
    const perpCenter = (dir.x !== 0) ? originCellY : originCellX;
    return { dir, originCellX, originCellY, perpCenter, lanes, length };
  }

  activeSegment() { return this.segments[this.activeSegmentIdx]; }

  // Append a new segment after the last one, bending 90° from its direction.
  // Used at frogger start and after every turn — guarantees the next segment
  // is rendered ahead of the camera before the player arrives at its origin.
  appendNextSegment() {
    const last = this.segments[this.segments.length - 1];
    const endX = last.originCellX + last.dir.x * last.length;
    const endY = last.originCellY + last.dir.y * last.length;
    const nextDir = (Math.random() < 0.5 ? TURN_CW : TURN_CCW)(last.dir);
    this.segments.push(this.makeSegment(nextDir, endX, endY));
  }

  currentLaneCount() {
    const fcfg = CONFIG.frogger;
    const step = Math.floor(this.maxDistance / (fcfg.laneIncreaseDistance ?? 500));
    return Math.min((fcfg.minLanes ?? 4) + step, fcfg.maxLanes ?? 10);
  }

  // Advance to the next (pre-generated) segment, then queue another one
  // beyond it so the road always extends ahead of the camera.
  turn() {
    this.distCompletedSegs += this.distInSegment;
    this.distInSegment = 0;
    this.activeSegmentIdx++;

    // Make sure there's always one more segment in the queue past the active
    if (this.activeSegmentIdx >= this.segments.length - 1) this.appendNextSegment();

    // Reset enemies and lanes for new direction
    for (const e of this.activeEnemies) this.recycleEnemy(e);
    this.activeEnemies  = [];
    this.lastEnemySpawn = {};
    this.rebuildLanesForActiveSegment();

    // Drop any uncollected pickup — it belongs to the segment we just left.
    for (const f of this.foods) f.sprite?.destroy();
    this.foods = [];

    this.queuedDodge = { x: 0, y: 0 };
    ctrlHintEl.textContent = froggerHintFor(this.activeSegment().dir);
  }

  // Build per-lane spawn config for the active segment. Only the lane position
  // (perpPixel) and spawn cadence (interval) are per-lane now — each vehicle's
  // type, color and speed are rolled individually at spawn time for variety.
  rebuildLanesForActiveSegment() {
    const seg  = this.activeSegment();
    const fcfg = CONFIG.frogger;
    const lw   = fcfg.laneWidthCells ?? 1;
    const { top } = laneOffsetRange(seg.lanes, lw);
    this.lanes = [];
    for (let l = 0; l < seg.lanes; l++) {
      // Pixel center of lane l: perpCenter + topOffset + lane*width + halfLaneWidth
      const perpPixel = (seg.perpCenter + top + l * lw + lw / 2) * CELL;
      this.lanes.push({
        laneIdx: l,
        perpPixel,
        interval: fcfg.spawnIntervalMin + Math.random() * (fcfg.spawnIntervalMax - fcfg.spawnIntervalMin),
      });
      this.lastEnemySpawn[l] = this.time.now + 200 + Math.random() * 1200;
    }
  }

  // Difficulty step rises with maxDistance — feeds enemy speed & spawn rate
  difficultyStep() {
    const ramp = CONFIG.frogger.difficultyRampCells || Infinity;
    return Math.floor(this.maxDistance / ramp);
  }

  updateEnemies(delta, time) {
    const dtSec   = delta / 1000;
    const step    = this.difficultyStep();
    const speedup = 1 + step * (CONFIG.frogger.difficultySpawnSpeedup ?? 0);
    const seg     = this.activeSegment();
    const nextSeg = this.segments[this.activeSegmentIdx + 1];
    if (!seg || !nextSeg) return;

    // Geometry of the bend ahead — cars travel this path so they round the
    // curve instead of driving straight off the road at the corner.
    const geo = this.junctionGeom(seg, nextSeg);

    // Player's path coordinate L (arc-length from segA's tangent point). The
    // corner is geo.R past the tangent, so L grows as the player nears the bend.
    const distToCorner = (seg.length - this.distInSegment) * CELL;
    const Lplayer = geo.R - distToCorner;
    const AHEAD   = Math.max(W, H) + CELL * 2;  // spawn / cull span beyond viewport

    // Spawn — keyed by lane index, off-screen ahead along the path.
    for (const lane of this.lanes) {
      const adjusted = lane.interval / speedup;
      const since    = time - (this.lastEnemySpawn[lane.laneIdx] ?? 0);
      if (since >= adjusted) {
        this.lastEnemySpawn[lane.laneIdx] = time;
        this.spawnEnemy(lane, seg, geo, Lplayer + AHEAD);
      }
    }

    // Move toward the player (decreasing L); world pos + heading follow the path.
    for (const e of this.activeEnemies) {
      e.L -= e.speed * dtSec;
      const pt = this.pathPoint(geo, e.L, e.o);
      e.worldX = pt.x; e.worldY = pt.y;
      e.velX = -pt.tx * e.speed; e.velY = -pt.ty * e.speed;
      e.sprite.setPosition(e.worldX, e.worldY);
      this.orientEnemy(e.sprite, e.velX, e.velY);
      if (e.streak) {
        e.streak.setPosition(e.worldX, e.worldY).setRotation(Math.atan2(-e.velY, -e.velX));
      }
    }

    // Rampage: smash any enemy the player is driving through.
    if (this.isInvincible()) this.smashOverlappingEnemies();

    // Cull once well behind the player along the path.
    const cull = Lplayer - AHEAD;
    this.activeEnemies = this.activeEnemies.filter(e => {
      if (e.L < cull) { this.recycleEnemy(e); return false; }
      return true;
    });
  }

  // Spawn an enemy off-screen ahead along the road path (spawnL) in the given
  // lane. It then travels the path toward the player, rounding the bend. Sprite
  // faces its travel direction; width fills the lane perpendicular to travel.
  spawnEnemy(lane, seg, geo, spawnL) {
    const fcfg    = CONFIG.frogger;
    // Roll the rare super enemy first, else a normal truck/car. Type, color and
    // speed are per-vehicle so a lane shows a varied stream, not identical clones.
    const isSuper = Math.random() < (fcfg.superProbability ?? 0);
    const isTruck = !isSuper && Math.random() < (fcfg.truckProbability ?? 0.5);
    const lw      = fcfg.laneWidthCells ?? 1;
    const shortPx = isSuper ? lw * CELL - 6 : lw * CELL - 4;  // perp size — fills lane minus padding
    const longPx  = isSuper ? CELL - 2 : (isTruck ? 2 * CELL - 4 : CELL - 4);  // along-road length

    let key;
    if (isSuper) key = 'enemy-super';
    else {
      const variants = isTruck ? ENEMY_TRUCK_KEYS : ENEMY_CAR_KEYS;
      key = variants[Math.floor(Math.random() * variants.length)]
          ?? (isTruck ? 'enemy-truck' : 'enemy-car');
    }

    const baseSpeed = isSuper
      ? (fcfg.superSpeedMin ?? 7) + Math.random() * ((fcfg.superSpeedMax ?? 11) - (fcfg.superSpeedMin ?? 7))
      : fcfg.enemySpeedMin + Math.random() * (fcfg.enemySpeedMax - fcfg.enemySpeedMin);
    const speed = (baseSpeed + this.difficultyStep() * (fcfg.difficultySpeedBonus ?? 0)) * CELL;

    // Signed lane offset from the road centreline, along +PERP(seg.dir). The
    // same o maps to the same physical lane along the whole path (straight +
    // bend), so a car keeps its lane around the curve.
    const horiz = seg.dir.x !== 0;
    const { top, bot } = laneOffsetRange(seg.lanes, lw);
    const centerlinePerpPx = (seg.perpCenter + (top + bot + 1) / 2) * CELL;
    const delta = lane.perpPixel - centerlinePerpPx;
    const o = horiz ? delta * seg.dir.x : delta * (-seg.dir.y);

    // Spawn off-screen ahead along the path, then travel toward the player.
    const pt = this.pathPoint(geo, spawnL, o);
    const velX = -pt.tx * speed, velY = -pt.ty * speed;

    let sprite = this.enemyPool.pop();
    if (!sprite) sprite = this.add.image(0, 0, key).setDepth(4);
    else sprite.setTexture(key).setVisible(true);

    // The super sprite packs a glow halo into its texture, so render it a touch
    // larger than its hitbox — the halo padding lives outside the car body.
    const dispLong  = isSuper ? longPx * 1.5 : longPx;
    const dispShort = isSuper ? shortPx * 1.4 : shortPx;
    sprite.setDisplaySize(dispLong, dispShort).setPosition(pt.x, pt.y);
    this.orientEnemy(sprite, velX, velY);

    const e = { L: spawnL, o, speed, worldX: pt.x, worldY: pt.y, velX, velY, longPx, shortPx, sprite, streak: null };

    if (isSuper) {
      // Trailing streak: bright (left) end pinned to the car, tapering backward.
      let streak = this.streakPool.pop();
      if (!streak) streak = this.add.image(0, 0, 'enemy-streak').setDepth(3).setOrigin(0, 0.5);
      else streak.setVisible(true);
      streak.setDisplaySize(dispLong * 3, shortPx * 0.7).setPosition(pt.x, pt.y)
            .setRotation(Math.atan2(-velY, -velX));
      e.streak = streak;
    }

    this.activeEnemies.push(e);
  }

  // Side-view vehicle art faces left with wheels down. Point it along its
  // travel vector via rotation, but mirror vertically (flipY) when heading
  // rightward instead of letting the 180° rotation flip it wheels-up.
  orientEnemy(sprite, velX, velY) {
    sprite.setRotation(Math.atan2(velY, velX) - Math.PI);
    sprite.setFlipY(velX > 0);
  }

  // Hide + pool an enemy's sprite (and its streak, for super enemies).
  recycleEnemy(e) {
    e.sprite.setVisible(false).setAlpha(1);
    this.enemyPool.push(e.sprite);
    if (e.streak) {
      e.streak.setVisible(false).setAlpha(1);
      this.streakPool.push(e.streak);
      e.streak = null;
    }
  }

  // True while the player can't be hurt: dev god mode or an active rampage.
  isInvincible() {
    return this.godMode || this.fx.godMs > 0;
  }

  // ── Rampage: smash enemies aside ───────────────────────
  // Any active enemy overlapping the player (same box as checkEnemyCollision)
  // is yanked out of traffic and turned into spinning debris flung away from
  // the goose.
  smashOverlappingEnemies() {
    const hx = this.snake.x * CELL + CELL / 2;
    const hy = this.snake.y * CELL + CELL / 2;
    for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
      const e = this.activeEnemies[i];
      const horizontal = Math.abs(e.velX) > Math.abs(e.velY);
      const halfLong  = e.longPx / 2;
      const halfShort = e.shortPx / 2;
      const dx = hx - e.worldX, dy = hy - e.worldY;
      const hit = horizontal
        ? (Math.abs(dx) < halfLong - 3 && Math.abs(dy) < halfShort)
        : (Math.abs(dy) < halfLong - 3 && Math.abs(dx) < halfShort);
      if (hit) {
        this.activeEnemies.splice(i, 1);
        this.launchFlyingEnemy(e, hx, hy);
      }
    }
  }

  launchFlyingEnemy(e, hx, hy) {
    // The streak (super enemies) is dropped immediately — debris has no trail.
    if (e.streak) { e.streak.setVisible(false).setAlpha(1); this.streakPool.push(e.streak); e.streak = null; }

    let ang = Math.atan2(e.worldY - hy, e.worldX - hx);
    if (!isFinite(ang)) ang = Math.random() * Math.PI * 2;
    ang += (Math.random() - 0.5) * 0.7;                       // spread
    const speed = 240 + Math.random() * 220;
    this.flyingEnemies.push({
      sprite: e.sprite,
      x: e.worldX, y: e.worldY,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 140,                        // slight upward pop
      spin: (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 9),
      life: 650, maxLife: 650,
      rot: e.sprite.rotation,
      scaleX: e.sprite.scaleX, scaleY: e.sprite.scaleY,
    });
  }

  updateFlyingEnemies(delta) {
    if (this.flyingEnemies.length === 0) return;
    const dt = delta / 1000;
    for (let i = this.flyingEnemies.length - 1; i >= 0; i--) {
      const f = this.flyingEnemies[i];
      f.life -= delta;
      if (f.life <= 0) {
        f.sprite.setVisible(false).setAlpha(1).setFlipY(false);
        this.enemyPool.push(f.sprite);
        this.flyingEnemies.splice(i, 1);
        continue;
      }
      f.vy += 900 * dt;                       // gravity drag
      f.x  += f.vx * dt;
      f.y  += f.vy * dt;
      f.rot += f.spin * dt;
      const k = f.life / f.maxLife;           // 1 → 0: fade + shrink
      f.sprite.setPosition(f.x, f.y).setRotation(f.rot).setAlpha(k)
              .setScale(f.scaleX * k, f.scaleY * k);
    }
  }

  // Recycle any in-flight debris (mode reset / game over).
  clearFlyingEnemies() {
    for (const f of this.flyingEnemies) {
      f.sprite.setVisible(false).setAlpha(1).setFlipY(false);
      this.enemyPool.push(f.sprite);
    }
    this.flyingEnemies = [];
  }

  // ── Rampage pickup spawning (frogger) ──────────────────
  maybeSpawnRampage(time) {
    if (time < (this.nextRampageSpawn ?? Infinity)) return;
    this.spawnRampagePickup();
    const fcfg = CONFIG.frogger;
    const lo = fcfg.rampageSpawnIntervalMin ?? 12000;
    const hi = fcfg.rampageSpawnIntervalMax ?? 22000;
    this.nextRampageSpawn = time + lo + Math.random() * (hi - lo);
  }

  // Place a rampage pickup on the road ahead of the player, in a random lane,
  // within the active segment so its grid cell is well-defined.
  spawnRampagePickup() {
    const seg = this.activeSegment();
    if (!seg) return;
    const fcfg  = CONFIG.frogger;
    const lw    = fcfg.laneWidthCells ?? 1;
    const ahead = fcfg.rampageAheadCells ?? 12;
    const fwd   = this.distInSegment + ahead;
    if (fwd > seg.length - 2) return;            // no room before the bend; skip

    const { top, bot } = laneOffsetRange(seg.lanes, lw);
    const perpOff = top + Math.floor(Math.random() * (bot - top + 1));
    const baseX = seg.originCellX + seg.dir.x * fwd;
    const baseY = seg.originCellY + seg.dir.y * fwd;
    const px = (seg.dir.x !== 0) ? baseX : seg.perpCenter + perpOff;
    const py = (seg.dir.x !== 0) ? seg.perpCenter + perpOff : baseY;

    // Only one pickup on the road at a time.
    for (const f of this.foods) f.sprite?.destroy();
    this.foods = [];
    this.addFoodAt(px, py, 'rampage');
  }

  checkEnemyCollision() {
    const hx = this.snake.x * CELL + CELL / 2;
    const hy = this.snake.y * CELL + CELL / 2;
    for (const e of this.activeEnemies) {
      // Enemy is an axis-aligned rect — orientation determines which axis is "long"
      const horizontal = Math.abs(e.velX) > Math.abs(e.velY);
      const halfLong  = e.longPx / 2;
      const halfShort = e.shortPx / 2;
      const dx = hx - e.worldX;
      const dy = hy - e.worldY;
      if (horizontal) {
        if (Math.abs(dx) < halfLong - 3 && Math.abs(dy) < halfShort) return true;
      } else {
        if (Math.abs(dy) < halfLong - 3 && Math.abs(dx) < halfShort) return true;
      }
    }
    return false;
  }

  // ── End states ─────────────────────────────────────────
  endGame() {
    this.running = false;
    this.timeLeftInRound = null;
    timerDispEl.classList.remove('show');
    startBtn.textContent = 'Play Again';
    this.draw(1);

    // Hand off to the modal for score/leaderboard/name input. Clear msgEl so
    // the inline "HONK!" line doesn't double-up with the modal heading.
    if (typeof window.showEndGameModal === 'function') {
      msgEl.textContent = '';
      msgEl.className   = '';
      window.showEndGameModal(this.score);
    } else {
      msgEl.className   = 'msg-over';
      msgEl.textContent = `HONK! Game over — Score: ${this.score} 𓅬`;
    }
  }

  // ── Food spawning ──────────────────────────────────────
  get targetFoodCount() {
    // Growth round gets a higher concurrent-snack target
    if (this.timeLeftInRound != null) return CONFIG.finalLevelFoodCount ?? 4;
    return Math.min(CONFIG.baseFoodCount + Math.floor(this.level / 2), CONFIG.maxFoodCount);
  }

  spawnMissingFood() {
    let tries = 0;
    while (this.foods.length < this.targetFoodCount && tries++ < 300) {
      const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (this.cellBlocked(p.x, p.y, false)) continue;
      this.addFoodAt(p.x, p.y, this.pickSnackType());
    }
  }

  addFoodAt(x, y, type) {
    const sprite = this.add.image(
      x * CELL + CELL / 2, y * CELL + CELL / 2, 'snack-' + type
    ).setDisplaySize(CELL - 2, CELL - 2).setDepth(3);
    this.foods.push({ x, y, type, sprite });
  }

  pickSnackType() {
    const weights = CONFIG.snackWeights;
    const minLvl = CONFIG.snackMinLevel;
    const avail = Object.keys(weights).filter(t => (minLvl[t] ?? 1) <= this.level);
    if (avail.length === 0) return 'bread';
    const total = avail.reduce((s, t) => s + (weights[t] ?? 0), 0);
    let r = Math.random() * total;
    for (const t of avail) { r -= (weights[t] ?? 0); if (r <= 0) return t; }
    return avail[0];
  }

  cellBlocked(x, y, bufferHead = false) {
    if (this.snake?.cells.some(c => c.x === x && c.y === y)) return true;
    if (this.foods.some(f => f.x === x && f.y === y)) return true;
    if (this.obstacles.some(o => o.x === x && o.y === y)) return true;
    if (bufferHead && this.snake) {
      const b = CONFIG.obstacleHeadBuffer ?? 4;
      if (Math.abs(x - this.snake.x) < b && Math.abs(y - this.snake.y) < b) return true;
    }
    return false;
  }

  renderEffectsBar() {
    const parts = [];
    if (this.fx.godMs > 0) parts.push(`<span class="fx-god">💥 Rampage</span>`);
    if (this.fx.speedTicks > 0) parts.push(`<span class="fx-speed">⚡ Fast</span>`);
    if (this.fx.slowTicks > 0) parts.push(`<span class="fx-slow">❄️ Slow</span>`);
    if (this.fx.multLeft > 0) parts.push(`<span class="fx-star">⭐ ×${CONFIG.scoreMultiplier} (${this.fx.multLeft})</span>`);
    effectsEl.innerHTML = parts.join('');
  }

  // ── Dev console hooks ──────────────────────────────────
  jumpToLevel(target) {
    if (!this.snake) this.startGame();
    target = Math.max(1, Math.floor(target));
    const final = CONFIG.snakeFinalLevel ?? 5;

    // Walk levels up to either target or the final (timed) level
    while (this.level < Math.min(target, final)) this.levelUp();

    // Target past final → skip the growth round and go straight to DODGE
    if (target > final && !this.froggerMode) {
      this.timeLeftInRound = null;
      timerDispEl.classList.remove('show');
      this.startFroggerMode();
    }
  }

  spawnSpecificSnack(type) {
    if (!this.snake) return;
    // In frogger the play area is the road far from the snake-area grid, so
    // place the snack a few cells ahead of the player instead.
    if (this.froggerMode) {
      const seg = this.activeSegment();
      if (!seg) return;
      const lw = CONFIG.frogger.laneWidthCells ?? 1;
      const fwd = Math.min(this.distInSegment + 6, seg.length - 1);
      const { top, bot } = laneOffsetRange(seg.lanes, lw);
      const perpOff = top + Math.floor(Math.random() * (bot - top + 1));
      const baseX = seg.originCellX + seg.dir.x * fwd;
      const baseY = seg.originCellY + seg.dir.y * fwd;
      const px = (seg.dir.x !== 0) ? baseX : seg.perpCenter + perpOff;
      const py = (seg.dir.x !== 0) ? seg.perpCenter + perpOff : baseY;
      this.addFoodAt(px, py, type);
      return;
    }
    let tries = 0;
    while (tries++ < 300) {
      const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (!this.cellBlocked(p.x, p.y, false)) { this.addFoodAt(p.x, p.y, type); return; }
    }
  }

  addLength(n) {
    if (!this.snake) return;
    this.snake.maxCells = Math.max(2, this.snake.maxCells + n);
    while (this.snake.cells.length > this.snake.maxCells) this.snake.cells.pop();
    lengthEl.textContent = this.snake.maxCells;
  }

  // ── Background ─────────────────────────────────────────
  // Static — snake area only. The frogger road is infinite so it's drawn each
  // frame in drawDynamicRoad() based on the camera's current scroll position.
  drawBackground() {
    const g = this.bgGfx;
    g.clear();

    g.fillStyle(0x4a7c59);
    g.fillRect(0, 0, W, H);
    g.fillStyle(0x5b9bd5, 0.45);
    g.fillEllipse(300, 318, 144, 88);

    g.lineStyle(0.5, 0xffffff, 0.06);
    for (let c = 0; c <= COLS; c++) g.lineBetween(c * CELL, 0, c * CELL, H);
    for (let r = 0; r <= ROWS; r++) g.lineBetween(0, r * CELL, W, r * CELL);
  }

  // Frogger road — walks the segment list and draws each visible segment's
  // road rectangle. Walls are implicit: the canvas background colour (set to
  // wall colour) shows wherever no road is drawn.
  drawDynamicRoad() {
    const g = this.dynBgGfx;
    g.clear();

    if (!this.segments || this.segments.length === 0) return;

    const cam   = this.cameras.main;
    const viewL = cam.scrollX - CELL;
    const viewR = cam.scrollX + W + CELL;
    const viewT = cam.scrollY - CELL;
    const viewB = cam.scrollY + H + CELL;

    // Ground: dark mossy green so trees, barriers and asphalt all read well
    g.fillStyle(0x223018);
    g.fillRect(cam.scrollX, cam.scrollY, W, H);

    const lw = CONFIG.frogger.laneWidthCells ?? 1;

    // Trees first — they sit on the ground and are over-painted by road
    this.drawTrees(g, viewL, viewR, viewT, viewB, lw);

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      // Render every segment to its full planned length so the road is always
      // drawn ahead of the camera viewport — no trailing-edge pop-in.
      const lenCells = seg.length;
      const { top, bot } = laneOffsetRange(seg.lanes, lw);

      // Road rectangle in world coords
      let rx, ry, rw, rh;
      if (seg.dir.x !== 0) {
        // Horizontal segment
        const startX = seg.originCellX;
        const endX   = startX + seg.dir.x * lenCells;
        rx = Math.min(startX, endX) * CELL;
        rw = Math.abs(endX - startX) * CELL;
        ry = (seg.perpCenter + top) * CELL;
        rh = (bot - top + 1) * CELL;
      } else {
        // Vertical segment
        const startY = seg.originCellY;
        const endY   = startY + seg.dir.y * lenCells;
        ry = Math.min(startY, endY) * CELL;
        rh = Math.abs(endY - startY) * CELL;
        rx = (seg.perpCenter + top) * CELL;
        rw = (bot - top + 1) * CELL;
      }

      // Cull off-viewport segments
      if (rx + rw < viewL || rx > viewR || ry + rh < viewT || ry > viewB) continue;

      // Alternate lane band colours for visual lane separation
      const horiz = seg.dir.x !== 0;
      for (let l = 0; l < seg.lanes; l++) {
        const isOdd = (l % 2) === 0;
        g.fillStyle(isOdd ? 0x333333 : 0x2a2a2a);
        const laneTopOffsetCells = top + l * lw;       // cell offset from perpCenter to lane's first cell
        const laneStartPx = (seg.perpCenter + laneTopOffsetCells) * CELL;
        const laneThickPx = lw * CELL;
        if (horiz) g.fillRect(rx, laneStartPx, rw, laneThickPx);
        else       g.fillRect(laneStartPx, ry, laneThickPx, rh);
      }

      // Dashed centre lines — one per lane, drawn at the lane's perp midpoint
      g.fillStyle(0xffdd00, 0.25);
      if (horiz) {
        const colStart = Math.floor(rx / CELL);
        const colEnd   = Math.ceil((rx + rw) / CELL);
        for (let l = 0; l < seg.lanes; l++) {
          const ly = (seg.perpCenter + top + l * lw + lw / 2) * CELL - 1;
          for (let c = colStart - (colStart % 2); c < colEnd; c += 2) {
            const cx = c * CELL;
            if (cx < rx || cx + CELL > rx + rw) continue;
            g.fillRect(cx + 4, ly, CELL - 8, 2);
          }
        }
      } else {
        const rowStart = Math.floor(ry / CELL);
        const rowEnd   = Math.ceil((ry + rh) / CELL);
        for (let l = 0; l < seg.lanes; l++) {
          const lx = (seg.perpCenter + top + l * lw + lw / 2) * CELL - 1;
          for (let r = rowStart - (rowStart % 2); r < rowEnd; r += 2) {
            const cy = r * CELL;
            if (cy < ry || cy + CELL > ry + rh) continue;
            g.fillRect(lx, cy + 4, 2, CELL - 8);
          }
        }
      }

      // Concrete barrier walls along the perp edges of the road
      const barrierThick = 3;
      g.fillStyle(0x6a6a6a);
      if (horiz) {
        g.fillRect(rx, (seg.perpCenter + top) * CELL - barrierThick, rw, barrierThick);
        g.fillRect(rx, (seg.perpCenter + bot + 1) * CELL,             rw, barrierThick);
      } else {
        g.fillRect((seg.perpCenter + top) * CELL - barrierThick, ry, barrierThick, rh);
        g.fillRect((seg.perpCenter + bot + 1) * CELL,            ry, barrierThick, rh);
      }
    }

    // Curved corners between consecutive segments — replaces flat junction
    // rectangles with annular sectors that visually bend the road through 90°.
    for (let i = 0; i < this.segments.length - 1; i++) {
      this.drawJunctionCurve(g, this.segments[i], this.segments[i + 1], lw);
    }
  }

  // ── Tree scenery ──────────────────────────────────────
  // Deterministic placement: same world cell always gets same (or no) tree,
  // so the camera revisiting an area sees the same landscape. As the camera
  // moves, new cells reveal new (deterministic) trees — feels dynamic.
  drawTrees(g, viewL, viewR, viewT, viewB, lw) {
    const startCol = Math.floor(viewL / CELL) - 1;
    const endCol   = Math.ceil(viewR / CELL) + 1;
    const startRow = Math.floor(viewT / CELL) - 1;
    const endRow   = Math.ceil(viewB / CELL) + 1;

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const h = hash2D(c, r);
        if (h > 0.22) continue;                     // ~22% of cells get a tree
        if (this.cellOnAnyRoad(c, r, lw)) continue;  // skip cells on roads

        // Jitter within the cell so trees don't form a grid
        const jx = c * CELL + hash2D(c * 7, r * 11) * (CELL - 6) + 3;
        const jy = r * CELL + hash2D(c * 13, r * 17) * (CELL - 6) + 3;
        const size = 4 + h * 28;                    // ~4-10 px

        // Trunk
        g.fillStyle(0x4a3018);
        g.fillRect(jx - 1, jy + size * 0.4, 2, size * 0.4);

        // Pine-style canopy — green with per-tree shade variation
        const shade  = Math.floor(hash2D(c * 19, r * 23) * 40);
        const leaf   = (0x1c << 16) | ((0x50 + shade) << 8) | 0x1c;
        g.fillStyle(leaf);
        g.fillTriangle(jx, jy - size,
                       jx - size * 0.55, jy + size * 0.4,
                       jx + size * 0.55, jy + size * 0.4);
      }
    }
  }

  // True if cell (c, r) lies within any segment's road rectangle (lanes range)
  cellOnAnyRoad(c, r, lw) {
    for (const seg of this.segments) {
      const horiz = seg.dir.x !== 0;
      const { top, bot } = laneOffsetRange(seg.lanes, lw);
      const startX = seg.originCellX;
      const endX   = startX + seg.dir.x * seg.length;
      const startY = seg.originCellY;
      const endY   = startY + seg.dir.y * seg.length;

      let segMinX, segMaxX, segMinY, segMaxY;
      if (horiz) {
        segMinX = Math.min(startX, endX);
        segMaxX = Math.max(startX, endX);
        segMinY = seg.perpCenter + top;
        segMaxY = seg.perpCenter + bot;
      } else {
        segMinY = Math.min(startY, endY);
        segMaxY = Math.max(startY, endY);
        segMinX = seg.perpCenter + top;
        segMaxX = seg.perpCenter + bot;
      }
      // Pad by 1 cell so trees don't crowd the barrier
      if (c >= segMinX - 1 && c <= segMaxX + 1 && r >= segMinY - 1 && r <= segMaxY + 1) return true;
    }
    return false;
  }

  // ── Junction geometry ─────────────────────────────────
  // Shared by the curve renderer and the enemy path-follower. Models the bend
  // between two consecutive segments as a 90° arc whose centerline radius
  // equals the road width (R = Wc), so the inner road edge sits at R − Wc/2
  // and the outer edge at R + Wc/2. Returns everything both callers need.
  junctionGeom(segA, segB) {
    const lw = CONFIG.frogger.laneWidthCells ?? 1;
    const Wc = Math.max(segA.lanes, segB.lanes) * lw * CELL;
    const R = Wc, innerR = Wc / 2, outerR = Wc * 1.5;

    // Corner pixel = junction point of the two centerlines
    const cornerX = segB.originCellX * CELL;
    const cornerY = segB.originCellY * CELL;
    const dA = segA.dir, dB = segB.dir;

    // Arc center: corner + R * (dirB − dirA)
    const center = { x: cornerX + R * (dB.x - dA.x), y: cornerY + R * (dB.y - dA.y) };

    // Tangent angles (vectors from center to the two tangent points)
    const startAngle = Math.atan2(-dB.y, -dB.x);  // toward segB tangent (T_B side)
    const endAngle   = Math.atan2(dA.y, dA.x);     // toward segA tangent (T_A side)

    // Short arc — normalize angular diff to [-π, π]
    let diff = endAngle - startAngle;
    while (diff > Math.PI)  diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    const arcSign  = Math.sign(diff) || 1;                       // sweep start→end
    const turnSign = Math.sign(dA.x * dB.y - dA.y * dB.x) || 1;  // +1 CW, −1 CCW
    return {
      Wc, R, innerR, outerR, cornerX, cornerY, dA, dB, center,
      startAngle, endAngle, diff, anticw: diff < 0, arcSign, turnSign,
      arcLen: R * Math.abs(diff),
    };
  }

  // ── Curved junction (90° annular sector) ──────────────
  // Replaces the flat gray junction square with a true road-curve: the square
  // asphalt the two straight segments overdraw through the corner is first
  // cleared back to ground, then the annular sector restores asphalt only
  // along the rounded band. Adds dashed per-lane markings + gray barrier arcs.
  drawJunctionCurve(g, segA, segB, lw) {
    const cam = this.cameras.main;
    const viewL = cam.scrollX - CELL * 3;
    const viewR = cam.scrollX + W + CELL * 3;
    const viewT = cam.scrollY - CELL * 3;
    const viewB = cam.scrollY + H + CELL * 3;

    const geo = this.junctionGeom(segA, segB);
    const { Wc, R, innerR, outerR, cornerX, cornerY, center,
            startAngle, endAngle, diff, anticw, arcSign, turnSign } = geo;
    const centerX = center.x, centerY = center.y;

    // Cull off-viewport curves
    if (cornerX + outerR < viewL || cornerX - outerR > viewR ||
        cornerY + outerR < viewT || cornerY - outerR > viewB) return;

    // Cut the square overdraw: the two full-length straight rectangles paint
    // asphalt through the whole corner±Wc box. Clearing it to ground means the
    // arc below is the road's true (rounded) outline, not a square with an arc
    // on top. The sector exactly refills the road band, so only the outer/inner
    // corner triangles end up as ground — which is what makes it read as curved.
    g.fillStyle(0x223018);
    g.fillRect(cornerX - Wc, cornerY - Wc, 2 * Wc, 2 * Wc);

    // Filled annular sector — asphalt color
    g.fillStyle(0x303030);
    g.beginPath();
    g.arc(centerX, centerY, outerR, startAngle, endAngle, anticw);
    g.arc(centerX, centerY, innerR, endAngle,   startAngle, !anticw);
    g.closePath();
    g.fillPath();

    // Dashed per-lane centre arcs — one concentric arc per lane of the
    // entering segment, matching the straight segments' lane dashes.
    const n = segB.lanes;
    const { top, bot } = laneOffsetRange(n, lw);
    const centerCell = (top + bot + 1) / 2;
    g.lineStyle(2, 0xffdd00, 0.25);
    for (let l = 0; l < n; l++) {
      const oCells = (top + l * lw + lw / 2) - centerCell;  // signed offset from road centre
      const rad = R - turnSign * oCells * CELL;
      if (rad <= 2) continue;
      const dashAng   = (CELL - 8) / rad;   // dash arc-length → angle
      const periodAng = (2 * CELL) / rad;   // dash + gap
      for (let a = 0; a < Math.abs(diff); a += periodAng) {
        g.beginPath();
        g.arc(centerX, centerY, rad, startAngle + arcSign * a,
              startAngle + arcSign * (a + dashAng), anticw);
        g.strokePath();
      }
    }

    // Curved barriers on both edges
    g.lineStyle(3, 0x6a6a6a);
    g.beginPath();
    g.arc(centerX, centerY, outerR, startAngle, endAngle, anticw);
    g.strokePath();
    g.beginPath();
    g.arc(centerX, centerY, innerR, startAngle, endAngle, anticw);
    g.strokePath();
  }

  // ── Enemy path point ──────────────────────────────────
  // Maps a path coordinate L (arc-length from segA's tangent point, increasing
  // toward segB) and a signed lane offset o (px, along +PERP(segA.dir)) to a
  // world position + unit tangent (pointing toward increasing L). L ≤ 0 is the
  // active straight, [0, arcLen] the bend, ≥ arcLen the next straight. The same
  // o picks the same physical lane on both legs (verified continuous).
  pathPoint(geo, L, o) {
    const { R, dA, dB, center, cornerX, cornerY, startAngle, arcSign, turnSign, arcLen } = geo;
    if (L <= 0) {
      const px = -dA.y, py = dA.x;                 // perpVec(dA)
      return { x: cornerX + dA.x * (L - R) + px * o,
               y: cornerY + dA.y * (L - R) + py * o, tx: dA.x, ty: dA.y };
    }
    if (L >= arcLen) {
      const Lr = L - arcLen, px = -dB.y, py = dB.x;  // perpVec(dB)
      const tbx = cornerX + dB.x * R, tby = cornerY + dB.y * R;
      return { x: tbx + dB.x * Lr + px * o,
               y: tby + dB.y * Lr + py * o, tx: dB.x, ty: dB.y };
    }
    const ang = startAngle + arcSign * (L / R);
    const rad = R - turnSign * o;
    const c = Math.cos(ang), s = Math.sin(ang);
    return { x: center.x + rad * c, y: center.y + rad * s,
             tx: -s * arcSign, ty: c * arcSign };
  }

  // ── Dynamic draw ───────────────────────────────────────
  draw(t) {
    const g = this.gameGfx;
    g.clear();

    // In frogger mode the walls are implicit (drawn via drawDynamicRoad's
    // wall-colour viewport fill); only obstacles need rendering in snake mode.
    if (!this.froggerMode) this.drawObstacles(g);

    if (this.snake?.cells.length > 0) this.drawSnake(g, t);
  }

  drawFroggerWalls(g) {
    g.fillStyle(0x221810);
    for (let col = 0; col < COLS; col++) {
      g.fillRect(col * CELL + 1, 1, CELL - 2, CELL - 2);
      g.fillRect(col * CELL + 1, (ROWS - 1) * CELL + 1, CELL - 2, CELL - 2);
    }
    for (let row = 1; row < ROWS - 1; row++) {
      g.fillRect(1, row * CELL + 1, CELL - 2, CELL - 2);
    }
    g.lineStyle(1, 0x3a2818, 0.6);
    for (let col = 0; col < COLS; col++) {
      g.strokeRect(col * CELL + 1, 1, CELL - 2, CELL - 2);
      g.strokeRect(col * CELL + 1, (ROWS - 1) * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  drawObstacles(g) {
    for (const o of this.obstacles) {
      const ox = o.x * CELL, oy = o.y * CELL;
      g.fillStyle(0x2d2018);
      g.fillRect(ox + 1, oy + 1, CELL - 2, CELL - 2);
      g.lineStyle(1, 0x4a3020, 1);
      g.lineBetween(ox + 1, oy + 1, ox + CELL - 1, oy + 1);
      g.lineBetween(ox + 1, oy + 1, ox + 1, oy + CELL - 1);
      g.lineStyle(1, 0x1a0e08, 1);
      g.lineBetween(ox + 1, oy + CELL - 1, ox + CELL - 1, oy + CELL - 1);
      g.lineBetween(ox + CELL - 1, oy + 1, ox + CELL - 1, oy + CELL - 1);
      g.lineStyle(1, 0x150a04, 0.7);
      g.lineBetween(ox + 4, oy + 4, ox + 9, oy + 11);
      g.lineBetween(ox + 11, oy + 3, ox + 14, oy + 8);
    }
  }

  // ── Snake drawing ──────────────────────────────────────
  // Body is rendered as pooled SVG sprites: 'goose-neck' for intermediate
  // segments and 'goose-tail' for the last segment. Sprites are sized slightly
  // larger than CELL so consecutive segments overlap for a continuous look.
  drawSnake(g, t) {
    const s    = this.snake;
    const prev = this.prevCells;

    const pos = s.cells.map((c, i) => {
      const p = prev[i] || c;
      let px = p.x, py = p.y;
      if (Math.abs(c.x - px) > 1 || Math.abs(c.y - py) > 1) { px = c.x; py = c.y; }
      return {
        x: (px + (c.x - px) * t) * CELL + CELL / 2,
        y: (py + (c.y - py) * t) * CELL + CELL / 2,
      };
    });

    // Tint signals current effect state (damage / godmode / fx). setTint(0xffffff)
    // = no tint (passthrough multiplication).
    const flashing = this.invulnTicks > 0 && Math.floor(this.time.now / 70) % 2 === 0;
    let tint = 0xffffff;
    if (flashing)                    tint = 0xff5544;
    else if (this.fx.godMs > 0)      tint = 0xffd23a;  // rampage — gold
    else if (this.godMode)           tint = 0xffaaff;
    else if (this.fx.speedTicks > 0) tint = 0xffccaa;
    else if (this.fx.slowTicks  > 0) tint = 0xaaccff;
    else if (this.fx.multLeft   > 0) tint = 0xffeeaa;

    const bodyCount = Math.max(0, pos.length - 1);

    // Grow pool lazily
    while (this.bodySprites.length < bodyCount) {
      this.bodySprites.push(this.add.image(0, 0, 'goose-neck').setDepth(5));
    }

    // Position + texture each body segment
    for (let i = 1; i < pos.length; i++) {
      const sprite  = this.bodySprites[i - 1];
      const isTail  = (i === pos.length - 1);
      const wantKey = isTail ? 'goose-tail' : 'goose-neck';
      if (sprite.texture.key !== wantKey) sprite.setTexture(wantKey);

      sprite.setPosition(pos[i].x, pos[i].y);
      sprite.setDisplaySize(CELL + 4, CELL + 4);  // overlap neighbours
      sprite.setTint(tint);
      sprite.setVisible(true);

      // Face toward the previous (closer-to-head) segment so neck/tail orient
      // along the body. Skip rotation on wrap-around jumps to avoid spin.
      const dx = pos[i - 1].x - pos[i].x;
      const dy = pos[i - 1].y - pos[i].y;
      if (Math.hypot(dx, dy) < CELL * 1.5) {
        sprite.setRotation(Math.atan2(dy, dx));
      }
    }

    // Hide pool overflow (after a shrink)
    for (let i = bodyCount; i < this.bodySprites.length; i++) {
      this.bodySprites[i].setVisible(false);
    }

    // Head
    this.headImg
      .setPosition(pos[0].x, pos[0].y)
      .setRotation(Math.atan2(s.dy, s.dx))
      .setDisplaySize(CELL + 2, CELL + 2)
      .setTint(tint)
      .setVisible(true);
  }
}

// ── Phaser game ────────────────────────────────────────────
// Wait for config.js to settle the effective CONFIG (config.json ⊕ localStorage)
// before booting, so the scene's first reads (startPos, startLength, …) see the
// committed tuning. CONFIG_READY always resolves, even if config.json is absent.
(typeof CONFIG_READY !== 'undefined' ? CONFIG_READY : Promise.resolve()).then(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    backgroundColor: '#4a7c59',
    scene: GooseScene,
    audio: { noAudio: true },
    // FIT scales the fixed 400×400 board to the parent's responsive box (sized
    // in CSS) while preserving aspect ratio, so it fills small screens and the
    // swipe surface stays large. Pointer coords are still reported in game space.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
      parent: 'phaser-container',
      width: W,
      height: H,
    },
  });
});

// ── DOM → scene ────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  if (!gameScene) return;
  gameScene.startGame();
  // Touch play defaults into focus mode so vertical swipes steer instead of
  // scrolling the page; the Exit button (or Esc) backs out. setFocusMode is a
  // hoisted function declaration, so calling it here (defined below) is fine.
  if (IS_TOUCH) setFocusMode(true);
});

// ── On-screen direction pad ────────────────────────────────
// Touch devices reveal the pad (CSS via body.touch). Every button feeds the
// same setDirection() path the keyboard and swipe use, so steering is identical
// across inputs. pointerdown (not click) keeps it snappy and lets us swallow the
// gesture so it can't double as a page scroll / long-press selection.
const DPAD_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
if (IS_TOUCH) document.body.classList.add('touch');

// ── Control scheme ─────────────────────────────────────────
// Swipe steering is always live on the board; the scheme only chooses which
// on-screen pad (if any) is shown. The chosen scheme is persisted and reflected
// as a body class that CSS keys off:
//   swipe       → no pad (swipe only)
//   horizontal  → single-row pad (default; the original touch layout)
//   traditional → classic cross/+ pad
//   relative    → two-button turn-left/turn-right pad (heading-relative)
const CONTROL_SCHEMES = ['swipe', 'horizontal', 'traditional', 'relative'];
const CONTROLS_KEY = 'gooseControls';

function applyControlScheme(scheme) {
  if (!CONTROL_SCHEMES.includes(scheme)) scheme = 'horizontal';
  try { localStorage.setItem(CONTROLS_KEY, scheme); } catch (e) { /* private mode */ }
  for (const s of CONTROL_SCHEMES) document.body.classList.toggle(`controls-${s}`, s === scheme);
  // Reflect the active choice in the picker, if present.
  document.querySelectorAll('#controls-modal .controls-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.scheme === scheme);
    card.setAttribute('aria-pressed', card.dataset.scheme === scheme ? 'true' : 'false');
  });
}

function savedControlScheme() {
  try { return localStorage.getItem(CONTROLS_KEY); } catch (e) { return null; }
}

// Capture whether a choice was previously saved *before* applying (which
// persists the default), so the first-visit auto-show below fires correctly.
const _hadSavedScheme = savedControlScheme();
applyControlScheme(_hadSavedScheme || 'horizontal');

// ── Control-picker modal ───────────────────────────────────
// Auto-shows once on the first touch visit (no saved scheme yet) and is
// reopenable anytime via the "Controls" button.
const controlsModal = document.getElementById('controls-modal');
const controlsBtn   = document.getElementById('controls-btn');
const controlsDone  = document.getElementById('controls-done');

function openControlsModal() { controlsModal?.classList.add('show'); }
function closeControlsModal() { controlsModal?.classList.remove('show'); }

controlsBtn?.addEventListener('click', openControlsModal);
controlsDone?.addEventListener('click', closeControlsModal);
controlsModal?.addEventListener('click', (e) => {
  if (e.target === controlsModal) closeControlsModal();   // click backdrop to dismiss
});
document.querySelectorAll('#controls-modal .controls-card').forEach(card => {
  card.addEventListener('click', () => applyControlScheme(card.dataset.scheme));
});

if (IS_TOUCH && !_hadSavedScheme) openControlsModal();

document.querySelectorAll('#dpad .dpad-btn').forEach(btn => {
  const v = DPAD_VEC[btn.dataset.dir];
  if (!v) return;
  const press = (e) => {
    e.preventDefault();
    btn.classList.add('active');
    if (window.gameScene) {
      gameScene.setDirection(v[0], v[1]);
      gameScene.dismissSwipeHint();
    }
  };
  const release = () => btn.classList.remove('active');
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

// Relative pad: two buttons that turn left/right of the current heading.
document.querySelectorAll('#dpad-relative .dpad-btn').forEach(btn => {
  const turn = btn.dataset.turn === 'right' ? 1 : -1;
  const press = (e) => {
    e.preventDefault();
    btn.classList.add('active');
    if (window.gameScene) {
      gameScene.turnRelative(turn);
      gameScene.dismissSwipeHint();
    }
  };
  const release = () => btn.classList.remove('active');
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

// ── Focus mode ─────────────────────────────────────────────
// Locks page scrolling and fills the viewport with the board, so vertical
// swipes steer instead of panning the page. The iOS-safe lock pins body with a
// negative top offset (plain overflow:hidden alone doesn't stop Safari), and we
// restore the scroll position on exit.
const focusBtn      = document.getElementById('focus-btn');
const focusExit     = document.getElementById('focus-exit');
const focusControls = document.getElementById('focus-controls');
let _focusScrollY = 0;

function setFocusMode(on) {
  if (on) {
    _focusScrollY = window.scrollY || 0;
    document.documentElement.classList.add('focus-locked');
    document.body.classList.add('focus-mode');
    document.body.style.top = `-${_focusScrollY}px`;
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
  } else {
    document.documentElement.classList.remove('focus-locked');
    document.body.classList.remove('focus-mode');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, _focusScrollY);
  }
}

focusBtn?.addEventListener('click', () => setFocusMode(true));
focusExit?.addEventListener('click', () => setFocusMode(false));
// Controls picker stays reachable in focus mode (the action-row is hidden, so
// this floating button opens the same modal). openControlsModal is hoisted.
focusControls?.addEventListener('click', openControlsModal);
// Esc exits focus mode (desktop convenience).
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) setFocusMode(false);
});
