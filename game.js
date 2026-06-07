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

let gameScene = null;

// ── Phaser Scene ───────────────────────────────────────────
class GooseScene extends Phaser.Scene {
  constructor() { super({ key: 'GooseScene' }); }

  preload() {
    const keys = [
      'goose-head', 'snack-bread', 'snack-speed', 'snack-slow',
      'snack-shrink', 'snack-star', 'enemy-car', 'enemy-truck',
    ];
    for (const k of keys) this.load.image(k, spriteDataURI(k));
    this.load.on('loaderror', file => console.error('Sprite failed:', file.key));
  }

  create() {
    gameScene = this;

    this.bgGfx = this.add.graphics().setDepth(0);   // static — snake area
    this.dynBgGfx = this.add.graphics().setDepth(1);   // dynamic — frogger road, redrawn per frame
    this.gameGfx = this.add.graphics().setDepth(2);   // game elements (snake, walls, obstacles)

    this.headImg = this.add.image(-100, -100, 'goose-head').setDepth(6).setVisible(false);

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
    this.queuedVertical = 0;
    this.invulnTicks = 0;

    // Section splash invalidation token — newer splashes override older
    // pending resume callbacks (e.g. user restarts mid-splash).
    this.splashToken = 0;

    // Timed growth round (level 5): countdown ms remaining or null when inactive.
    // Delta-based so the splash pause and dev-pause don't drain real-time clock.
    this.timeLeftInRound = null;

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
      // Camera follow — no right clamp (world is infinite)
      if (this.running) {
        const targetX = Math.max(0, this.snake.x * CELL - W / 2 + CELL / 2);
        this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, targetX, 0.12);
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

    // Frogger: only vertical input matters; head auto-advances right
    if (this.froggerMode) {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') this.queuedVertical = -1;
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.queuedVertical = 1;
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
    this.invulnTicks = 0;
    this.score = 0;
    this.level = 1;
    this.snacksEaten = 0;
    this.fx = { speedTicks: 0, slowTicks: 0, multLeft: 0 };
    this.froggerMode = false;
    this.running = true;
    this.lastTickTime = this.time.now;
    this.timeLeftInRound = null;

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
    this.drawBackground();
    this.spawnMissingFood();
    startBtn.textContent = 'Restart';

    this.showSectionSplash(1, 'GROW', 'grow');
  }

  // ── Section splash ─────────────────────────────────────
  // Pauses the game, plays the CSS keyframe animation, resumes after.
  // Uses a token so a fresh start mid-splash doesn't accidentally un-pause
  // an obsolete previous splash's resume callback.
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
      // Auto-runner: head advances right every tick; queued ↑/↓ steers
      s.dx = 1;
      s.dy = this.queuedVertical;
      this.queuedVertical = 0;
    } else {
      s.dx = this.nextDx;
      s.dy = this.nextDy;
    }

    s.x += s.dx;
    s.y += s.dy;

    if (this.froggerMode) {
      // Top/bottom walls clamp (no death); left can't be hit due to forced dx=1
      s.y = Phaser.Math.Clamp(s.y, 1, ROWS - 2);
      // Distance scoring — only new max-forward cells count
      const dist = Math.max(0, s.x - this.frogStartX);
      if (dist > this.maxDistance) {
        this.score += (dist - this.maxDistance) * (CONFIG.distancePointsPerCell ?? 1);
        this.maxDistance = dist;
        scoreEl.textContent = this.score;
        distanceEl.textContent = this.maxDistance;
      }
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

  // ── Frogger mode ───────────────────────────────────────
  startFroggerMode() {
    this.froggerMode = true;

    for (const f of this.foods) f.sprite?.destroy();
    this.foods = [];

    // Infinite right scroll
    this.cameras.main.setBounds(0, 0, CAM_BOUND_W, H);

    // Distance tracking anchored at entry point — only forward progress scores
    this.frogStartX = this.snake.x;
    this.maxDistance = 0;
    distanceEl.textContent = 0;
    distDispEl.classList.add('show');

    // Length doubles as HP in frogger mode
    lengthEl.textContent = this.snake.maxCells;
    lenDispEl.classList.add('show');
    ctrlHintEl.textContent = FROGGER_HINT;

    // Reset auto-runner input state
    this.queuedVertical = 0;
    this.invulnTicks = 0;

    this.drawBackground();

    const fcfg = CONFIG.frogger;
    this.lanes = [];
    for (let row = 1; row < ROWS - 1; row++) {
      this.lanes.push({
        row,
        speed: fcfg.enemySpeedMin + Math.random() * (fcfg.enemySpeedMax - fcfg.enemySpeedMin),
        type: Math.random() < fcfg.truckProbability ? 'truck' : 'car',
        interval: fcfg.spawnIntervalMin + Math.random() * (fcfg.spawnIntervalMax - fcfg.spawnIntervalMin),
      });
      this.lastEnemySpawn[row] = this.time.now - Math.random() * 2000;
    }

    this.showSectionSplash(2, 'DODGE', 'dodge');
  }

  // Difficulty step rises with maxDistance — feeds enemy speed & spawn rate
  difficultyStep() {
    const ramp = CONFIG.frogger.difficultyRampCells || Infinity;
    return Math.floor(this.maxDistance / ramp);
  }

  updateEnemies(delta, time) {
    const dtSec = delta / 1000;
    const step = this.difficultyStep();
    const speedup = 1 + step * (CONFIG.frogger.difficultySpawnSpeedup ?? 0);

    // Spawn — interval shrinks with difficulty
    for (const lane of this.lanes) {
      const adjusted = lane.interval / speedup;
      const since = time - (this.lastEnemySpawn[lane.row] ?? 0);
      if (since >= adjusted) {
        this.lastEnemySpawn[lane.row] = time;
        this.spawnEnemy(lane);
      }
    }

    // Move
    for (const e of this.activeEnemies) {
      e.worldX -= e.speed * CELL * dtSec;
      e.sprite.setX(e.worldX + e.pixelW / 2);
    }

    // Cull off the left edge of the camera (with a small margin)
    const killX = this.cameras.main.scrollX - CELL * 2;
    const dead = this.activeEnemies.filter(e => e.worldX + e.pixelW < killX);
    for (const e of dead) { e.sprite.setVisible(false); this.enemyPool.push(e.sprite); }
    this.activeEnemies = this.activeEnemies.filter(e => e.worldX + e.pixelW >= killX);
  }

  spawnEnemy(lane) {
    const isTruck = lane.type === 'truck';
    const pixelW = isTruck ? 2 * CELL - 2 : CELL - 2;
    const key = isTruck ? 'enemy-truck' : 'enemy-car';
    const worldY = lane.row * CELL + CELL / 2;
    // Spawn just past the right edge of the camera (camera-relative, not world-edge)
    const worldX = this.cameras.main.scrollX + W + 10;
    const speed = lane.speed + this.difficultyStep() * (CONFIG.frogger.difficultySpeedBonus ?? 0);

    let sprite = this.enemyPool.pop();
    if (!sprite) sprite = this.add.image(0, worldY, key).setDepth(4);
    else sprite.setTexture(key).setVisible(true).setY(worldY);
    sprite.setDisplaySize(pixelW, CELL - 4).setX(worldX + pixelW / 2);

    this.activeEnemies.push({ worldX, worldY, pixelW, speed, lane: lane.row, sprite });
  }

  checkEnemyCollision() {
    const hx = this.snake.x * CELL + CELL / 2;
    const hy = this.snake.y * CELL + CELL / 2;
    for (const e of this.activeEnemies) {
      if (Math.abs(hy - e.worldY) < CELL * 0.55 &&
        hx > e.worldX + 3 && hx < e.worldX + e.pixelW - 3) return true;
    }
    return false;
  }

  // ── End states ─────────────────────────────────────────
  endGame() {
    this.running = false;
    this.timeLeftInRound = null;
    timerDispEl.classList.remove('show');
    msgEl.className = 'msg-over';
    msgEl.textContent = `HONK! Game over — Score: ${this.score} 𓅬`;
    startBtn.textContent = 'Play Again';
    this.draw(1);
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

  // Frogger road — renders only the visible window each frame.
  drawDynamicRoad() {
    const g = this.dynBgGfx;
    g.clear();

    const camX = this.cameras.main.scrollX;
    const startCol = Math.max(FROG_START, Math.floor(camX / CELL) - 1);
    const endCol = Math.ceil((camX + W) / CELL) + 1;
    if (endCol <= startCol) return;

    const x = startCol * CELL;
    const w = (endCol - startCol) * CELL;

    // Lanes + wall rows
    for (let row = 0; row < ROWS; row++) {
      const isWall = (row === 0 || row === ROWS - 1);
      g.fillStyle(isWall ? 0x1a1208
        : (Math.floor(row / 3) % 2 === 0 ? 0x333333 : 0x2a2a2a));
      g.fillRect(x, row * CELL, w, CELL);
    }

    // Dashed lane centre lines — every other column
    g.fillStyle(0xffdd00, 0.25);
    const dashStart = startCol - (startCol % 2);
    for (let row = 1; row < ROWS - 1; row++) {
      for (let col = dashStart; col < endCol; col += 2) {
        if (col < FROG_START) continue;
        g.fillRect(col * CELL + 4, row * CELL + CELL / 2 - 1, CELL - 8, 2);
      }
    }

    // Wall blocks on top/bottom rows (visible portion only)
    g.fillStyle(0x221810);
    for (let col = Math.max(FROG_START, startCol); col < endCol; col++) {
      g.fillRect(col * CELL + 1, 1, CELL - 2, CELL - 2);
      g.fillRect(col * CELL + 1, (ROWS - 1) * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  // ── Dynamic draw ───────────────────────────────────────
  draw(t) {
    const g = this.gameGfx;
    g.clear();

    if (this.froggerMode) this.drawFroggerWalls(g);
    else this.drawObstacles(g);

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
  drawSnake(g, t) {
    const s = this.snake;
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

    // Damage flash strobes during invuln frames so the player can see HP drain
    const flashing = this.invulnTicks > 0 && Math.floor(this.time.now / 70) % 2 === 0;
    let bodyColor = 0xf0ece0;
    if (flashing) bodyColor = 0xff5544;
    else if (this.godMode) bodyColor = 0xffaaff;
    else if (this.fx.speedTicks > 0) bodyColor = 0xffccaa;
    else if (this.fx.slowTicks > 0) bodyColor = 0xaaccff;
    else if (this.fx.multLeft > 0) bodyColor = 0xffeeaa;

    g.lineStyle(CELL * 0.88, bodyColor, 1);
    for (let i = 0; i < pos.length - 1; i++) {
      if (Math.abs(pos[i].x - pos[i + 1].x) < CELL * 1.5 &&
        Math.abs(pos[i].y - pos[i + 1].y) < CELL * 1.5) {
        g.lineBetween(pos[i].x, pos[i].y, pos[i + 1].x, pos[i + 1].y);
      }
    }

    g.fillStyle(bodyColor);
    for (const p of pos) g.fillCircle(p.x, p.y, CELL * 0.44);

    this.headImg
      .setPosition(pos[0].x, pos[0].y)
      .setRotation(Math.atan2(s.dy, s.dx))
      .setDisplaySize(CELL - 1, CELL - 1)
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
