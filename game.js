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

const SNAKE_HINT = 'Arrow keys or WASD  ·  ` for dev console';
const FROGGER_HINT = '↑↓ to dodge  ·  always advancing';

// Direction-aware control hint for frogger.
function froggerHintFor(dir) {
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
      'snack-shrink', 'snack-star', 'enemy-car', 'enemy-truck',
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

    this.fx = { speedTicks: 0, slowTicks: 0, multLeft: 0 };

    this.activeEnemies = [];
    this.enemyPool = [];
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

    this.drawBackground();

    this.input.keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
    ]);
    this.input.keyboard.on('keydown', e => this.handleKey(e));
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
        this.updateEnemies(delta, time);
      }
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
    const base = speeds[Math.min(this.level - 1, speeds.length - 1)];
    if (this.fx.speedTicks > 0) return Math.round(base * CONFIG.snacks.speed.tickMultiplier);
    if (this.fx.slowTicks > 0) return Math.round(base * CONFIG.snacks.slow.tickMultiplier);
    return base;
  }

  // ── Input ──────────────────────────────────────────────
  handleKey(e) {
    if (!this.running || !this.snake) return;

    // Frogger: dodge keys depend on travel direction.
    //   Horizontal travel (left/right) → ↑↓ to dodge perpendicular
    //   Vertical travel (up/down)      → ←→ to dodge perpendicular
    if (this.froggerMode) {
      const seg = this.activeSegment();
      if (!seg) return;
      const horizontal = seg.dir.x !== 0;
      if (horizontal) {
        if (e.code === 'ArrowUp'   || e.code === 'KeyW') this.queuedDodge = { x: 0, y: -1 };
        else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.queuedDodge = { x: 0, y:  1 };
      } else {
        if (e.code === 'ArrowLeft'  || e.code === 'KeyA') this.queuedDodge = { x: -1, y: 0 };
        else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.queuedDodge = { x:  1, y: 0 };
      }
      return;
    }

    const s = this.snake;
    const map = {
      ArrowUp: [0, -1], KeyW: [0, -1],
      ArrowDown: [0, 1], KeyS: [0, 1],
      ArrowLeft: [-1, 0], KeyA: [-1, 0],
      ArrowRight: [1, 0], KeyD: [1, 0],
    };
    const dir = map[e.code];
    if (!dir) return;
    const [dx, dy] = dir;
    if (dx !== 0 && dx === -s.dx) return;
    if (dy !== 0 && dy === -s.dy) return;
    this.nextDx = dx;
    this.nextDy = dy;
  }

  // ── Game start ─────────────────────────────────────────
  startGame() {
    if (typeof window.hideEndGameModal === 'function') window.hideEndGameModal();
    for (const f of this.foods) f.sprite?.destroy();
    for (const e of this.activeEnemies) { e.sprite.setVisible(false); this.enemyPool.push(e.sprite); }
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
    this.fx = { speedTicks: 0, slowTicks: 0, multLeft: 0 };
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
    ctrlHintEl.textContent = SNAKE_HINT;
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

    const SPLASH_MS = 1700;
    const token = ++this.splashToken;
    this.running = false;

    this.time.delayedCall(SPLASH_MS, () => {
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

    // Frogger: enemy collision drains length instead of instant death
    if (this.froggerMode && this.invulnTicks <= 0 && this.checkEnemyCollision()) {
      if (!this.godMode) {
        this.takeDamage();
        if (this.snake.maxCells < (CONFIG.frogger.minLength ?? 1)) { this.endGame(); return; }
      }
    }

    const eaten = this.foods.findIndex(f => f.x === s.x && f.y === s.y);
    if (eaten >= 0) {
      const [food] = this.foods.splice(eaten, 1);
      food.sprite?.destroy();
      this.applyEffect(food.type);
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
        if (this.godMode) break;
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

    msgEl.className = 'msg-level';
    msgEl.textContent = `Level ${this.level}! 𓅬`;
    this.time.delayedCall(1800, () => {
      if (this.running && msgEl.className === 'msg-level') { msgEl.textContent = ''; msgEl.className = ''; }
    });
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
    for (const e of this.activeEnemies) { e.sprite.setVisible(false); this.enemyPool.push(e.sprite); }
    this.activeEnemies = [];
    this.lastEnemySpawn = {};
    this.rebuildLanesForActiveSegment();

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
    for (const e of this.activeEnemies) { e.sprite.setVisible(false); this.enemyPool.push(e.sprite); }
    this.activeEnemies  = [];
    this.lastEnemySpawn = {};
    this.rebuildLanesForActiveSegment();

    this.queuedDodge = { x: 0, y: 0 };
    ctrlHintEl.textContent = froggerHintFor(this.activeSegment().dir);
  }

  // Build randomized per-lane spawn config for the active segment.
  // perpPixel is the pixel center of the lane along the perpendicular axis,
  // so cars are visually centered in their lane regardless of laneWidth parity.
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
        speed:    fcfg.enemySpeedMin + Math.random() * (fcfg.enemySpeedMax - fcfg.enemySpeedMin),
        type:     Math.random() < fcfg.truckProbability ? 'truck' : 'car',
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
    if (!seg) return;

    // Spawn — keyed by lane index (perpPixel changes with perpCenter per segment)
    for (const lane of this.lanes) {
      const adjusted = lane.interval / speedup;
      const since    = time - (this.lastEnemySpawn[lane.laneIdx] ?? 0);
      if (since >= adjusted) {
        this.lastEnemySpawn[lane.laneIdx] = time;
        this.spawnEnemy(lane, seg);
      }
    }

    // Move — velocity is opposite to segment direction
    for (const e of this.activeEnemies) {
      e.worldX += e.velX * dtSec;
      e.worldY += e.velY * dtSec;
      e.sprite.setPosition(e.worldX, e.worldY);
    }

    // Cull: behind the player along the forward axis (off-screen)
    const camX = this.cameras.main.scrollX;
    const camY = this.cameras.main.scrollY;
    const margin = CELL * 3;
    this.activeEnemies = this.activeEnemies.filter(e => {
      const ox = e.worldX < camX - margin || e.worldX > camX + W + margin;
      const oy = e.worldY < camY - margin || e.worldY > camY + H + margin;
      if (ox || oy) { e.sprite.setVisible(false); this.enemyPool.push(e.sprite); return false; }
      return true;
    });
  }

  // Spawn an enemy at the far end of the camera viewport along the segment
  // direction. Sprite is rotated to "face" its velocity vector. Width scales
  // to fill the lane perpendicular to road direction.
  spawnEnemy(lane, seg) {
    const isTruck = lane.type === 'truck';
    const lw      = CONFIG.frogger.laneWidthCells ?? 1;
    const shortPx = lw * CELL - 4;             // perp size — fills lane minus padding
    const longPx  = isTruck ? 2 * CELL - 4 : CELL - 4;  // along-road length unchanged
    const key     = isTruck ? 'enemy-truck' : 'enemy-car';

    const dir = seg.dir;
    const speed = (lane.speed + this.difficultyStep() * (CONFIG.frogger.difficultySpeedBonus ?? 0)) * CELL;

    // Spawn position: along perp axis at lane perpPixel, along forward axis
    // beyond the camera viewport (so it enters from "ahead" of the player).
    const camX = this.cameras.main.scrollX;
    const camY = this.cameras.main.scrollY;
    let worldX, worldY;
    if (dir.x !== 0) {
      // Horizontal travel: lanes are rows. Spawn at far horizontal edge.
      worldX = (dir.x > 0) ? camX + W + CELL : camX - CELL;
      worldY = lane.perpPixel;
    } else {
      // Vertical travel: lanes are columns. Spawn at far vertical edge.
      worldX = lane.perpPixel;
      worldY = (dir.y > 0) ? camY + H + CELL : camY - CELL;
    }

    // Velocity is opposite to player direction
    const velX = -dir.x * speed;
    const velY = -dir.y * speed;

    let sprite = this.enemyPool.pop();
    if (!sprite) sprite = this.add.image(0, 0, key).setDepth(4);
    else sprite.setTexture(key).setVisible(true);

    // Sprite default orientation faces LEFT (angle π in Phaser). Rotate so it
    // faces its velocity direction (the way it's moving).
    const rot = Math.atan2(velY, velX) - Math.PI;
    sprite
      .setDisplaySize(longPx, shortPx)
      .setRotation(rot)
      .setPosition(worldX, worldY);

    this.activeEnemies.push({ worldX, worldY, velX, velY, longPx, shortPx, sprite });
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

  // ── Curved junction (90° annular sector) ──────────────
  // Replaces the flat gray junction square with a true road-curve: an annular
  // sector of inner radius R - W/2 and outer R + W/2 around an arc center
  // computed from the two directions. Adds gray barrier arcs on both edges.
  drawJunctionCurve(g, segA, segB, lw) {
    const cam = this.cameras.main;
    const viewL = cam.scrollX - CELL * 3;
    const viewR = cam.scrollX + W + CELL * 3;
    const viewT = cam.scrollY - CELL * 3;
    const viewB = cam.scrollY + H + CELL * 3;

    const Wa = segA.lanes * lw * CELL;
    const Wb = segB.lanes * lw * CELL;
    const Wc = Math.max(Wa, Wb);
    // R = road width so outer arc (R + W/2) covers the outer corner of the
    // bounding W×W square (distance W*√2 ≈ 1.41W < 1.5W = outer radius).
    const R       = Wc;
    const innerR  = Wc / 2;
    const outerR  = Wc * 1.5;

    // Corner pixel = junction point of the two centerlines
    const cornerX = segB.originCellX * CELL;
    const cornerY = segB.originCellY * CELL;

    // Cull off-viewport curves
    const cullL = Math.min(cornerX - outerR, cornerX + outerR);
    const cullR = Math.max(cornerX - outerR, cornerX + outerR);
    const cullT = Math.min(cornerY - outerR, cornerY + outerR);
    const cullB = Math.max(cornerY - outerR, cornerY + outerR);
    if (cullR < viewL || cullL > viewR || cullB < viewT || cullT > viewB) return;

    // Arc center: corner + R * (dirB − dirA)
    const centerX = cornerX + R * (segB.dir.x - segA.dir.x);
    const centerY = cornerY + R * (segB.dir.y - segA.dir.y);

    // Tangent angles (vectors from center to tangent points)
    const startAngle = Math.atan2(-segB.dir.y, -segB.dir.x);
    const endAngle   = Math.atan2(segA.dir.y, segA.dir.x);

    // Pick the SHORT arc — normalize angular diff to [-π, π] and use sign
    let diff = endAngle - startAngle;
    while (diff > Math.PI)  diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const anticw = diff < 0;

    // Filled annular sector — asphalt color
    g.fillStyle(0x303030);
    g.beginPath();
    g.arc(centerX, centerY, outerR, startAngle, endAngle, anticw);
    g.arc(centerX, centerY, innerR, endAngle,   startAngle, !anticw);
    g.closePath();
    g.fillPath();

    // Curved barriers on both edges
    g.lineStyle(3, 0x6a6a6a);
    g.beginPath();
    g.arc(centerX, centerY, outerR, startAngle, endAngle, anticw);
    g.strokePath();
    g.beginPath();
    g.arc(centerX, centerY, innerR, startAngle, endAngle, anticw);
    g.strokePath();
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
new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  parent: 'phaser-container',
  backgroundColor: '#4a7c59',
  scene: GooseScene,
  audio: { noAudio: true },
});

// ── DOM → scene ────────────────────────────────────────────
startBtn.addEventListener('click', () => { if (gameScene) gameScene.startGame(); });
