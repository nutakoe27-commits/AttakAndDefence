'use strict';
// Процедурная генерация карты.
// Карта симметрична относительно центра (поворот на 180°), чтобы PvP был честным.
// Тайлы: 0 = земля (можно ходить и строить), 1 = скала (нельзя ничего),
//        2 = вода (нельзя ничего, чисто визуальный барьер), 3 = лес (ходить можно, строить нельзя, юниты медленнее)
const T = { GROUND: 0, ROCK: 1, WATER: 2, FOREST: 3 };

// Детерминированный PRNG (mulberry32) — карта воспроизводится по сиду.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 46, H = 30;

function idx(x, y) { return y * W + x; }

function generateMap(seed) {
  const rand = rng(seed);
  let tiles;
  // Генерируем, пока не получим карту со связными базами (обычно с первой попытки).
  for (let attempt = 0; attempt < 40; attempt++) {
    tiles = tryGenerate(rand);
    if (tiles) break;
  }
  if (!tiles) tiles = fallbackMap();

  const bases = basePositions();
  return { w: W, h: H, tiles, seed, bases };
}

function basePositions() {
  // База 0 слева, база 1 справа, по вертикальному центру.
  return [
    { x: 3, y: Math.floor(H / 2) },
    { x: W - 4, y: Math.floor(H / 2) },
  ];
}

function tryGenerate(rand) {
  const tiles = new Uint8Array(W * H);

  // 1. Шумовая основа: скалы и вода пятнами (клеточный автомат).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = rand();
      if (r < 0.38) tiles[idx(x, y)] = T.ROCK;
      else if (r < 0.46) tiles[idx(x, y)] = T.WATER;
      else if (r < 0.58) tiles[idx(x, y)] = T.FOREST;
      else tiles[idx(x, y)] = T.GROUND;
    }
  }
  // Сглаживание автоматом: 3 итерации.
  for (let it = 0; it < 3; it++) {
    const next = new Uint8Array(tiles);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let rock = 0, water = 0, forest = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) { rock++; continue; }
          const t = tiles[idx(nx, ny)];
          if (t === T.ROCK) rock++;
          else if (t === T.WATER) water++;
          else if (t === T.FOREST) forest++;
        }
        const i = idx(x, y);
        if (rock >= 5) next[i] = T.ROCK;
        else if (water >= 5) next[i] = T.WATER;
        else if (forest >= 5) next[i] = T.FOREST;
        else if (rock <= 2 && water <= 1) next[i] = tiles[i] === T.FOREST ? T.FOREST : T.GROUND;
      }
    }
    tiles.set(next);
  }

  // 2. Прорезаем 3 главных коридора (верх/центр/низ) волнистыми линиями.
  const lanes = [
    { y0: 5 + Math.floor(rand() * 3), amp: 2 + rand() * 3, freq: 0.18 + rand() * 0.12 },
    { y0: Math.floor(H / 2), amp: 1.5 + rand() * 2.5, freq: 0.14 + rand() * 0.1 },
    { y0: H - 8 + Math.floor(rand() * 3), amp: 2 + rand() * 3, freq: 0.18 + rand() * 0.12 },
  ];
  const phase = rand() * Math.PI * 2;
  for (const lane of lanes) {
    for (let x = 1; x < W - 1; x++) {
      const cy = Math.round(lane.y0 + Math.sin(x * lane.freq + phase) * lane.amp);
      for (let dy = -1; dy <= 1; dy++) {
        const y = cy + dy;
        if (y > 0 && y < H - 1) tiles[idx(x, y)] = T.GROUND;
      }
    }
  }
  // 3. Вертикальные перемычки — соединяют соседние коридоры (не сквозные просеки).
  const links = 3 + Math.floor(rand() * 3);
  for (let l = 0; l < links; l++) {
    const x = 6 + Math.floor(rand() * (W - 12));
    const li = Math.floor(rand() * (lanes.length - 1));
    const yA = Math.round(lanes[li].y0 + Math.sin(x * lanes[li].freq + phase) * lanes[li].amp);
    const yB = Math.round(lanes[li + 1].y0 + Math.sin(x * lanes[li + 1].freq + phase) * lanes[li + 1].amp);
    const y0 = Math.max(1, Math.min(yA, yB)), y1 = Math.min(H - 2, Math.max(yA, yB));
    for (let y = y0; y <= y1; y++) {
      tiles[idx(x, y)] = T.GROUND;
      if (x + 1 < W - 1) tiles[idx(x + 1, y)] = T.GROUND;
    }
  }

  // 4. Открытые «карманы» под застройку.
  const pockets = 5 + Math.floor(rand() * 3);
  for (let p = 0; p < pockets; p++) {
    const cx = 4 + Math.floor(rand() * (W - 8));
    const cy = 3 + Math.floor(rand() * (H - 6));
    const r = 2 + Math.floor(rand() * 2);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && dx * dx + dy * dy <= r * r) {
        tiles[idx(x, y)] = T.GROUND;
      }
    }
  }

  // 5. Симметрия 180° — правая половина = повёрнутая левая.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < Math.floor(W / 2); x++) {
      tiles[idx(W - 1 - x, H - 1 - y)] = tiles[idx(x, y)];
    }
  }

  // 6. Расчищаем площадки вокруг баз.
  const bases = basePositions();
  for (const b of bases) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = b.x + dx, y = b.y + dy;
      if (x >= 0 && y >= 0 && x < W && y < H) tiles[idx(x, y)] = T.GROUND;
    }
  }

  // 7. Рамка из скал по краю.
  for (let x = 0; x < W; x++) { tiles[idx(x, 0)] = T.ROCK; tiles[idx(x, H - 1)] = T.ROCK; }
  for (let y = 0; y < H; y++) { tiles[idx(0, y)] = T.ROCK; tiles[idx(W - 1, y)] = T.ROCK; }

  // 8. Проверка связности баз (BFS по проходимым тайлам).
  if (!connected(tiles, bases[0], bases[1])) return null;
  return tiles;
}

function walkable(t) { return t === T.GROUND || t === T.FOREST; }

function connected(tiles, a, b) {
  const seen = new Uint8Array(W * H);
  const queue = [idx(a.x, a.y)];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop();
    if (i === idx(b.x, b.y)) return true;
    const x = i % W, y = (i / W) | 0;
    const nbs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of nbs) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = idx(nx, ny);
      if (!seen[ni] && walkable(tiles[ni])) { seen[ni] = 1; queue.push(ni); }
    }
  }
  return false;
}

function fallbackMap() {
  // Аварийная простая карта: сплошная земля с рамкой.
  const tiles = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) { tiles[idx(x, 0)] = T.ROCK; tiles[idx(x, H - 1)] = T.ROCK; }
  for (let y = 0; y < H; y++) { tiles[idx(0, y)] = T.ROCK; tiles[idx(W - 1, y)] = T.ROCK; }
  return tiles;
}

module.exports = { generateMap, T, W, H, idx, walkable, connected };
