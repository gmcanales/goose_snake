'use strict';

// All gameplay knobs live here. The dev console reads/writes the live CONFIG
// object; the game reads CONFIG.* fresh each access so changes take effect
// immediately for things checked per-tick (speed, weights), and on next event
// for things that fire once (e.g. obstaclesPerLevel on next levelUp).

const DEFAULT_CONFIG = {

  // Tick speed (ms/tick) per level. Clamped to last entry beyond array length.
  levelSpeeds: [150, 125, 100, 85, 75],

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
  },

  // Score multiplier applied when a star is active
  scoreMultiplier: 2,

  // Obstacles
  obstaclesPerLevel: 3,
  maxObstacles:      12,
  obstacleHeadBuffer: 4,  // min Chebyshev distance from head when spawning

  // Food count — actual = min(base + floor(level/2), max)
  baseFoodCount: 1,
  maxFoodCount:  3,

  // Frogger mode (infinite scroll, multi-segment road with turns)
  frogger: {
    enemySpeedMin:    1.8,
    enemySpeedMax:    5.0,
    spawnIntervalMin: 1500,
    spawnIntervalMax: 4000,
    truckProbability: 0.55,
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
    turnIntervalMin: 120,
    turnIntervalMax: 240,
    // Difficulty ramps every N cells of forward distance reached.
    // Each step adds speedBonus to enemy speed and divides spawn interval
    // by (1 + spawnSpeedup × step).
    difficultyRampCells:    40,
    difficultySpeedBonus:   0.4,
    difficultySpawnSpeedup: 0.15,
    // Collision = lose 1 segment + invulnTicks of i-frames. Game over when
    // length drops below minLength (1 = full body must be consumed).
    invulnTicks: 6,
    minLength:   1,
  },

  // Points awarded per new cell of forward distance reached in frogger mode
  distancePointsPerCell: 1,
};

// Live mutable config — game reads from here
const CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// Deep-merge so saved configs from older versions keep getting any new default
// keys we add later (e.g. CONFIG.frogger gained minLanes/turnIntervalMin in
// the multi-segment refactor — a shallow Object.assign would have wiped them).
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

// Restore from localStorage if a saved override exists
try {
  const saved = localStorage.getItem('gooseConfig');
  if (saved) deepMerge(CONFIG, JSON.parse(saved));
} catch (e) {
  console.warn('Failed to load saved config:', e);
}

function resetConfig() {
  for (const k of Object.keys(CONFIG)) delete CONFIG[k];
  Object.assign(CONFIG, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
}

function saveConfigToStorage() {
  localStorage.setItem('gooseConfig', JSON.stringify(CONFIG));
}

function clearConfigStorage() {
  localStorage.removeItem('gooseConfig');
}
