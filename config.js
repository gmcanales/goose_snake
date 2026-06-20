'use strict';

// Gameplay knobs. The committed tuning lives in config.json (which is exactly
// what the dev console's "Download JSON" emits) — to ship new values, tune in
// the dev console, Download JSON, and replace config.json in the repo. No JS
// editing required.
//
// DEFAULT_CONFIG below is the baked-in *fallback*: it guarantees every key
// exists (so a partial/old config.json still runs) and lets the game work even
// without a server. Effective config = DEFAULT_CONFIG ⊕ config.json ⊕ localStorage.
//
// The dev console reads/writes the live CONFIG object; the game reads CONFIG.*
// fresh each access so changes take effect immediately for things checked
// per-tick (speed, weights), and on next event for things that fire once
// (e.g. obstaclesPerLevel on next levelUp).

const DEFAULT_CONFIG = {

  // Tick speed (ms/tick) per level. Clamped to last entry beyond array length.
  levelSpeeds: [125, 125, 100, 90, 90],

  // Snake-mode level progression. 4 normal levels + 1 timed growth round (L5),
  // after which the game transitions to frogger (DODGE) mode.
  snacksPerLevel:        5,
  snakeFinalLevel:       5,
  finalLevelDurationMs:  60000,
  finalLevelFoodCount:   4,

  // Snake starting state
  startLength: 4,
  startPos:    { x: 10, y: 10 },

  // Relative spawn weights — normalised inside pickSnackType()
  snackWeights: {
    bread:  0.50,
    speed:  0.15,
    slow:   0.15,
    shrink: 0.10,
    star:   0.10,
  },

  // Minimum level at which each snack can appear
  snackMinLevel: {
    bread: 1, speed: 2, slow: 2, shrink: 3, star: 3,
  },

  // Per-snack effects + scoring (raw, pre-multiplier)
  snacks: {
    bread:  { points: 1, grow: 1 },
    speed:  { points: 1, durationTicks: 6, tickMultiplier: 0.5 },
    slow:   { points: 1, durationTicks: 8, tickMultiplier: 1.8 },
    shrink: { points: 2, shrinkBy: 2, minLength: 2 },
    star:   { points: 1, multiplierUses: 5 },
    // Frogger-only "rampage" pickup: temporary invincibility + speed boost.
    // While active, driving into enemies smashes them aside instead of taking
    // damage. durationMs is real-time; tickMultiplier scales the move tick.
    rampage: { points: 2, durationMs: 5000, tickMultiplier: 0.55 },
  },

  // Score multiplier applied when a star is active
  scoreMultiplier: 4,

  // Obstacles
  obstaclesPerLevel: 3,
  maxObstacles:      9,
  obstacleHeadBuffer: 4,  // min Chebyshev distance from head when spawning

  // Food count — actual = min(base + floor(level/2), max)
  baseFoodCount: 1,
  maxFoodCount:  3,

  // Frogger mode (infinite scroll, multi-segment road with turns)
  frogger: {
    enemySpeedMin:    0.6,
    enemySpeedMax:    3.0,
    spawnIntervalMin: 1500,
    spawnIntervalMax: 4000,
    truckProbability: 0.55,
    // Rare "super" enemy — much faster than normal traffic, with a yellow glow
    // and motion streak as an eye-catching mix-up. Rolled before the truck
    // check, so this is its share of all spawns.
    superProbability: 0.05,
    superSpeedMin:    7.5,
    superSpeedMax:    11,
    // Lane count grows with distance. minLanes at start, +1 each
    // laneIncreaseDistance cells of forward progress, capped at maxLanes.
    minLanes: 4,
    maxLanes: 10,
    laneIncreaseDistance: 500,
    // Each lane is this many cells wide perpendicular to road direction.
    // Cars fill the full lane width. Total road width = lanes × laneWidthCells.
    // Cap maxLanes × laneWidthCells ≤ 20 (canvas) for clean rendering.
    laneWidthCells: 2,
    // Road bends 90° at random intervals; player auto-orients to new direction.
    // turnIntervalMin/Max = cells of forward progress between turns.
    turnIntervalMin: 60,
    turnIntervalMax: 240,
    // Difficulty ramps every N cells of forward distance reached.
    // Each step adds speedBonus to enemy speed and divides spawn interval
    // by (1 + spawnSpeedup × step).
    difficultyRampCells:    60,
    difficultySpeedBonus:   0.1,
    difficultySpawnSpeedup: 0.05,
    // Collision = lose 1 segment + invulnTicks of i-frames. Game over when
    // length drops below minLength (1 = full body must be consumed).
    invulnTicks: 6,
    minLength:   1,
    // Rampage pickup spawning (frogger only). One pickup is placed on the road
    // ahead every rampageSpawnInterval ms, rampageAheadCells forward of the player.
    rampageSpawnIntervalMin: 12000,
    rampageSpawnIntervalMax: 22000,
    rampageAheadCells:       12,
  },

  // Points awarded per new cell of forward distance reached in frogger mode
  distancePointsPerCell: 1,
};

// Live mutable config — game reads from here. Starts as a clone of the baked
// defaults so anything that touches CONFIG before the async load resolves still
// sees valid values; loadConfig() overlays config.json + localStorage onto it.
const CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// The "shipped" config = DEFAULT_CONFIG ⊕ config.json. This is what
// resetConfig() returns to (i.e. the committed tuning, not the raw fallbacks).
// Filled in by loadConfig(); until then it mirrors DEFAULT_CONFIG.
let SHIPPED_CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

const clone = (o) => JSON.parse(JSON.stringify(o));

// Deep-merge so partial/older configs keep getting any new default keys we add
// later (e.g. CONFIG.frogger gained minLanes/turnIntervalMin in the multi-
// segment refactor; snacks gained rampage). Arrays are replaced wholesale.
function deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv)) {
      if (target[k] == null || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      deepMerge(target[k], sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}

function readSavedOverride() {
  try {
    const saved = localStorage.getItem('gooseConfig');
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.warn('Failed to read saved config:', e);
    return null;
  }
}

// Rebuild the live CONFIG from the precedence chain:
//   DEFAULT_CONFIG  (baked fallback — guarantees every key exists)
//     ⊕ config.json (committed tuning — the dev-console export, source of truth)
//     ⊕ localStorage (your live local experiments — highest priority)
function rebuildConfig(fileConfig) {
  SHIPPED_CONFIG = deepMerge(clone(DEFAULT_CONFIG), fileConfig || {});
  const next = clone(SHIPPED_CONFIG);
  const saved = readSavedOverride();
  if (saved) deepMerge(next, saved);
  for (const k of Object.keys(CONFIG)) delete CONFIG[k];
  Object.assign(CONFIG, next);
}

// Fetch the committed tuning from config.json. Requires the game to be served
// over HTTP (nginx in prod, or any local dev server) — opening index.html via
// file:// will fail the fetch and fall back to the baked DEFAULT_CONFIG, which
// is fine: live tuning via the dev console + Save (localStorage) still works.
//
// CONFIG_READY resolves once the config is settled; game boot awaits it.
const CONFIG_READY = (async function loadConfig() {
  let fileConfig = null;
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) fileConfig = await res.json();
    else console.warn(`config.json fetch returned ${res.status}; using baked defaults`);
  } catch (e) {
    console.warn('config.json not loaded (serve over HTTP for it to apply); using baked defaults:', e.message);
  }
  rebuildConfig(fileConfig);
  window.dispatchEvent(new Event('gooseconfigloaded'));
  return CONFIG;
})();

// Apply any localStorage override synchronously too, so the very first reads
// (before the fetch resolves) already reflect saved local tweaks over defaults.
(function applySavedEarly() {
  const saved = readSavedOverride();
  if (saved) deepMerge(CONFIG, saved);
})();

function resetConfig() {
  for (const k of Object.keys(CONFIG)) delete CONFIG[k];
  Object.assign(CONFIG, clone(SHIPPED_CONFIG));
}

function saveConfigToStorage() {
  localStorage.setItem('gooseConfig', JSON.stringify(CONFIG));
}

function clearConfigStorage() {
  localStorage.removeItem('gooseConfig');
}
