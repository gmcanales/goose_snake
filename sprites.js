'use strict';

// Inline SVG sprite registry — data-URI loadable from file:// or http://.
// The /sprites/*.svg files are the human-editable design source. After editing
// one, paste its full contents into the matching key below (or wire up a build
// step). Keys must match the texture keys used in game.js preload().

const SPRITES = {

  'goose-head': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <circle cx="18" cy="20" r="16" fill="white" stroke="#ddd" stroke-width="1"/>
  <polygon points="33,20 40,15 40,25" fill="#f5a200"/>
  <circle cx="37" cy="19" r="1.8" fill="#c47e00"/>
  <circle cx="23" cy="13" r="4" fill="#111"/>
  <circle cx="24.5" cy="11.5" r="1.6" fill="white"/>
</svg>`,

  'goose-neck': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <circle cx="20" cy="20" r="18" fill="#f4f0e4" stroke="#c8be9a" stroke-width="1.2"/>
  <ellipse cx="22" cy="16" rx="5"   ry="1.6" fill="#ffffff" opacity="0.55"/>
  <ellipse cx="18" cy="24" rx="4"   ry="1.2" fill="#d8d0b8" opacity="0.6"/>
  <ellipse cx="14" cy="19" rx="2.5" ry="0.8" fill="#bcb4a0" opacity="0.4"/>
</svg>`,

  'goose-tail': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <polygon points="2,16 13,13 14,20 4,21" fill="#3a2a18" stroke="#1a1208" stroke-width="0.6"/>
  <polygon points="3,22 14,20 13,27 5,28" fill="#3a2a18" stroke="#1a1208" stroke-width="0.6"/>
  <polygon points="5,12 14,12 12,17 7,17" fill="#5a4828" opacity="0.9"/>
  <polygon points="6,27 14,26 12,31 7,30" fill="#5a4828" opacity="0.9"/>
  <circle cx="24" cy="20" r="15" fill="#f4f0e4" stroke="#c8be9a" stroke-width="1.2"/>
  <ellipse cx="26" cy="17" rx="4" ry="1.4" fill="#ffffff" opacity="0.55"/>
  <ellipse cx="22" cy="23" rx="3" ry="1"   fill="#d8d0b8" opacity="0.6"/>
</svg>`,

  'snack-bread': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <rect x="5" y="9" width="30" height="24" rx="5" fill="#d4952b" stroke="#a06820" stroke-width="1.5"/>
  <ellipse cx="20" cy="11" rx="11" ry="5" fill="#c07820"/>
  <circle cx="14" cy="23" r="2.5" fill="#a06820" opacity="0.6"/>
  <circle cx="23" cy="26" r="1.8" fill="#a06820" opacity="0.5"/>
</svg>`,

  'snack-speed': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <polygon points="20,3 37,20 20,37 3,20" fill="#ff5533" stroke="#cc2200" stroke-width="1.5"/>
  <polyline points="24,12 17,20 23,20 16,28" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

  'snack-slow': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <circle cx="20" cy="20" r="16" fill="#5588dd" stroke="#3355aa" stroke-width="1.5"/>
  <line x1="20" y1="5"  x2="20" y2="35" stroke="#aaccff" stroke-width="1.5"/>
  <line x1="5"  y1="20" x2="35" y2="20" stroke="#aaccff" stroke-width="1.5"/>
  <line x1="9"  y1="9"  x2="31" y2="31" stroke="#aaccff" stroke-width="1.5"/>
  <line x1="31" y1="9"  x2="9"  y2="31" stroke="#aaccff" stroke-width="1.5"/>
</svg>`,

  'snack-shrink': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <polygon points="20,36 4,10 36,10" fill="#cc44bb" stroke="#992288" stroke-width="1.5"/>
  <rect x="18.5" y="14" width="3" height="12" rx="1.5" fill="white"/>
  <circle cx="20" cy="30" r="2.5" fill="white"/>
</svg>`,

  'snack-star': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <polygon points="20,3 24,15 37,15 27,23 31,36 20,28 9,36 13,23 3,15 16,15"
           fill="#ffd700" stroke="#cc9900" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`,

  // Rampage pickup — fiery 8-point burst with a glowing core. Reads as a potent
  // power-up, distinct from the gold multiplier star.
  'snack-rampage': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <polygon points="20,2 22.87,13.07 32.73,7.27 26.93,17.13 38,20 26.93,22.87 32.73,32.73 22.87,26.93 20,38 17.13,26.93 7.27,32.73 13.07,22.87 2,20 13.07,17.13 7.27,7.27 17.13,13.07"
           fill="#ff7a18" stroke="#b34700" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="20" cy="20" r="8.5" fill="#ffd23a"/>
  <circle cx="20" cy="20" r="4.5" fill="#fff3b0"/>
</svg>`,

  'enemy-car': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 36" width="40" height="36">
  <rect x="2" y="14" width="36" height="18" rx="4" fill="#d03020" stroke="#8a1810" stroke-width="1.5"/>
  <rect x="7" y="6" width="24" height="13" rx="3" fill="#b02818"/>
  <rect x="9"  y="8" width="9" height="8" rx="1.5" fill="#88ccff" opacity="0.85"/>
  <rect x="21" y="8" width="7" height="8" rx="1.5" fill="#88ccff" opacity="0.85"/>
  <circle cx="10" cy="34" r="5" fill="#222" stroke="#555" stroke-width="1"/>
  <circle cx="30" cy="34" r="5" fill="#222" stroke="#555" stroke-width="1"/>
  <circle cx="10" cy="34" r="2" fill="#555"/>
  <circle cx="30" cy="34" r="2" fill="#555"/>
  <rect x="2" y="18" width="4" height="6" rx="1" fill="#ffee88" opacity="0.9"/>
</svg>`,

  'enemy-truck': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 36" width="80" height="36">
  <rect x="26" y="10" width="52" height="22" rx="2" fill="#8a6030" stroke="#5a3810" stroke-width="1.5"/>
  <line x1="40" y1="10" x2="40" y2="32" stroke="#5a3810" stroke-width="1" opacity="0.5"/>
  <line x1="55" y1="10" x2="55" y2="32" stroke="#5a3810" stroke-width="1" opacity="0.5"/>
  <line x1="70" y1="10" x2="70" y2="32" stroke="#5a3810" stroke-width="1" opacity="0.5"/>
  <rect x="2" y="8" width="28" height="24" rx="4" fill="#c07828" stroke="#8a5018" stroke-width="1.5"/>
  <rect x="5" y="11" width="12" height="10" rx="2" fill="#88ccff" opacity="0.85"/>
  <rect x="19" y="11" width="8"  height="8"  rx="1" fill="#88ccff" opacity="0.6"/>
  <circle cx="12" cy="34" r="5" fill="#222" stroke="#555" stroke-width="1"/>
  <circle cx="36" cy="34" r="5" fill="#222" stroke="#555" stroke-width="1"/>
  <circle cx="60" cy="34" r="5" fill="#222" stroke="#555" stroke-width="1"/>
  <circle cx="12" cy="34" r="2" fill="#555"/>
  <circle cx="36" cy="34" r="2" fill="#555"/>
  <circle cx="60" cy="34" r="2" fill="#555"/>
  <rect x="2" y="16" width="4" height="8" rx="1" fill="#ffee88" opacity="0.9"/>
</svg>`,

  // Rare "super" enemy — sleek bright-yellow car wrapped in a soft glow halo
  // (layered translucent ellipses, no SVG filters so it rasterizes reliably).
  // Same left-facing / wheels-down convention as the other vehicles.
  'enemy-super': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 44" width="48" height="44">
  <ellipse cx="24" cy="26" rx="26" ry="17" fill="#ffe83a" opacity="0.10"/>
  <ellipse cx="24" cy="26" rx="19" ry="12" fill="#ffe83a" opacity="0.16"/>
  <rect x="5" y="20" width="38" height="16" rx="6" fill="#ffe24a" stroke="#b88a10" stroke-width="1.5"/>
  <rect x="12" y="12" width="21" height="10" rx="3" fill="#ffcf1f"/>
  <rect x="14" y="14" width="8" height="6.5" rx="1.5" fill="#bfefff" opacity="0.9"/>
  <rect x="24" y="14" width="6" height="6.5" rx="1.5" fill="#bfefff" opacity="0.9"/>
  <circle cx="14" cy="37" r="4.5" fill="#1a1a1a" stroke="#666" stroke-width="1"/>
  <circle cx="34" cy="37" r="4.5" fill="#1a1a1a" stroke="#666" stroke-width="1"/>
  <rect x="5" y="24" width="4.5" height="6" rx="1.2" fill="#fffce0"/>
</svg>`,

  // Yellow motion streak drawn behind a super enemy. Bright at the left edge
  // (the pivot, pinned to the car) tapering to a transparent point.
  'enemy-streak': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20" width="60" height="20">
  <defs>
    <linearGradient id="sg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"    stop-color="#fff6b0" stop-opacity="0.85"/>
      <stop offset="0.35" stop-color="#ffe23a" stop-opacity="0.45"/>
      <stop offset="1"    stop-color="#ffe23a" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="M0 4 L46 1 L60 10 L46 19 L0 16 Z" fill="url(#sg)"/>
</svg>`,

};

// ── Vehicle color variants ─────────────────────────────────
// The base enemy-car/enemy-truck art above is a side view (front to the left,
// wheels along the bottom). To break up the "every car in a lane looks the
// same" monotony, generate a palette of recolored variants by swapping the
// body hex codes. Each car has 3 shades (body / roof / stroke) derived from one
// base color; trucks recolor just the cab so the cargo box stays distinct.

function darkenHex(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

const CAR_BODY_COLORS = [
  '#d03020', '#2f6fd0', '#2faa50', '#e0b020',
  '#8040c0', '#20a0a0', '#607888', '#e07020',
];
const TRUCK_CAB_COLORS = [
  '#c07828', '#4878b8', '#5a9a4a', '#b04838', '#808a96', '#b09060',
];

const ENEMY_CAR_KEYS   = [];
const ENEMY_TRUCK_KEYS = [];

CAR_BODY_COLORS.forEach((body, i) => {
  const key = 'enemy-car-' + i;
  SPRITES[key] = SPRITES['enemy-car']
    .replaceAll('#d03020', body)                 // body
    .replaceAll('#b02818', darkenHex(body, 0.85)) // roof
    .replaceAll('#8a1810', darkenHex(body, 0.62)); // stroke
  ENEMY_CAR_KEYS.push(key);
});

TRUCK_CAB_COLORS.forEach((cab, i) => {
  const key = 'enemy-truck-' + i;
  SPRITES[key] = SPRITES['enemy-truck']
    .replaceAll('#c07828', cab)                  // cab body
    .replaceAll('#8a5018', darkenHex(cab, 0.7));  // cab stroke
  ENEMY_TRUCK_KEYS.push(key);
});

function spriteDataURI(key) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SPRITES[key]);
}
