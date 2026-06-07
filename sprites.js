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

};

function spriteDataURI(key) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SPRITES[key]);
}
