// goose_snake — game logic stub
// TODO: implement snake movement, collision, food spawning, scoring

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const startBtn = document.getElementById('start-btn');

const GRID = 20;          // cells across/down
const CELL = canvas.width / GRID;

let snake, dir, food, score, loop;

function init() {
  snake = [{ x: 10, y: 10 }];
  dir = { x: 1, y: 0 };
  food = spawnFood();
  score = 0;
  scoreEl.textContent = score;
}

function spawnFood() {
  return {
    x: Math.floor(Math.random() * GRID),
    y: Math.floor(Math.random() * GRID),
  };
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Food
  ctx.fillStyle = '#f5a623';
  ctx.fillRect(food.x * CELL, food.y * CELL, CELL - 1, CELL - 1);

  // Snake
  ctx.fillStyle = '#7bc67e';
  for (const seg of snake) {
    ctx.fillRect(seg.x * CELL, seg.y * CELL, CELL - 1, CELL - 1);
  }
}

function tick() {
  // TODO: move snake, check collisions, eat food
  draw();
}

startBtn.addEventListener('click', () => {
  clearInterval(loop);
  init();
  draw();
  loop = setInterval(tick, 150);
  startBtn.textContent = 'Restart';
});

document.addEventListener('keydown', (e) => {
  const map = {
    ArrowUp:    { x: 0,  y: -1 },
    ArrowDown:  { x: 0,  y:  1 },
    ArrowLeft:  { x: -1, y:  0 },
    ArrowRight: { x: 1,  y:  0 },
  };
  if (map[e.key]) dir = map[e.key];
});

init();
draw();
