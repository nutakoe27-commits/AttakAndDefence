'use strict';
// Процедурная генерация карты «коридор в горах» (классический TD):
// один обязательно извилистый коридор соединяет базы; юниты ходят ТОЛЬКО по нему.
// Всё остальное — горы: там строят башни и экономику, но юнитам хода нет.
// Карта симметрична при повороте на 180°, чтобы PvP был честным.
// Тайлы: 0 = коридор (ходить можно, строить нельзя), 1 = горы (строить можно, ходить нельзя),
//        2 = вода (декор в горах, нельзя ничего), 3 = лес в коридоре (ходить можно, медленнее)
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
  let result = null;
  for (let attempt = 0; attempt < 40 && !result; attempt++) {
    result = tryGenerate(rand);
  }
  if (!result) result = fallbackMap();
  return { w: W, h: H, tiles: result.tiles, seed, bases: result.bases };
}

function tryGenerate(rand) {
  const tiles = new Uint8Array(W * H).fill(T.ROCK);
  const cxL = W / 2 - 1; // левая из двух центральных колонок (22 при W=46)

  // Карвим клетку и её зеркало (поворот 180°) — симметрия получается сама собой.
  const carveCell = (x, y) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    tiles[idx(x, y)] = T.GROUND;
    tiles[idx(W - 1 - x, H - 1 - y)] = T.GROUND;
  };
  const carveRect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) carveCell(x, y);
  };

  // Ортогональный зигзаг: горизонтальные прогоны + вертикальные колена
  // с ОСТРЫМИ углами 90° — никаких диагональных срезов.
  // Направление колена строго чередуется — путь гуляет вверх-вниз и
  // получается значительно длиннее прямой линии.
  const y0 = 4 + Math.floor(rand() * (H - 9));
  const baseA = { x: 3, y: y0 };
  carveRect(1, y0 - 2, 5, y0 + 2); // площадка базы

  let x = 5, y = y0;
  let dir = rand() < 0.5 ? 1 : -1;
  let guard = 0;
  while (x < cxL && guard++ < 40) {
    // горизонтальный прогон
    const run = 3 + Math.floor(rand() * 4);
    const x2 = Math.min(x + run, cxL);
    carveRect(x, y - 1, x2, y + 1);
    x = x2;
    if (x >= cxL) break;
    // вертикальное колено (амплитуда крупная — путь удлиняется)
    const amp = 5 + Math.floor(rand() * 7);
    let y2 = Math.max(3, Math.min(H - 4, y + dir * amp));
    if (Math.abs(y2 - y) < 4) {
      dir = -dir;
      y2 = Math.max(3, Math.min(H - 4, y + dir * amp));
    }
    carveRect(x - 1, Math.min(y, y2) - 1, x + 1, Math.max(y, y2) + 1);
    y = y2;
    dir = -dir;
  }

  // Центральный вертикальный канал соединяет половины: от (cxL, y)
  // до зеркальной точки (cxL+1, H-1-y). Тоже под прямым углом.
  carveRect(cxL - 1, y - 1, cxL, y + 1);
  const yTop = Math.min(y, H - 1 - y), yBot = Math.max(y, H - 1 - y);
  for (let yy = yTop - 1; yy <= yBot + 1; yy++) {
    carveCell(cxL, yy);
    carveCell(cxL + 1, yy);
  }

  const bases = [baseA, { x: W - 4, y: H - 1 - y0 }];

  // Лесные пятна в коридоре — зоны замедления (зеркалятся автоматически).
  const groundCells = [];
  for (let yy = 1; yy < H - 1; yy++) for (let xx = 6; xx < cxL; xx++) {
    if (tiles[idx(xx, yy)] === T.GROUND) groundCells.push([xx, yy]);
  }
  const nF = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < nF && groundCells.length; i++) {
    const [fx, fy] = groundCells[Math.floor(rand() * groundCells.length)];
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const xx = fx + dx, yy = fy + dy;
      if (xx > 0 && yy > 0 && xx < W - 1 && yy < H - 1 && tiles[idx(xx, yy)] === T.GROUND && rand() < 0.85) {
        tiles[idx(xx, yy)] = T.FOREST;
        tiles[idx(W - 1 - xx, H - 1 - yy)] = T.FOREST;
      }
    }
  }

  // Горные озёра (декор) — прямоугольные, в стиле карты, симметричными парами.
  const nL = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < nL; i++) {
    const lx = 3 + Math.floor(rand() * (W / 2 - 8));
    const ly = 2 + Math.floor(rand() * (H - 7));
    const lw = 1 + Math.floor(rand() * 3), lh = 1 + Math.floor(rand() * 2);
    for (let yy = ly; yy < ly + lh; yy++) {
      for (let xx = lx; xx < lx + lw; xx++) {
        if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) continue;
        if (tiles[idx(xx, yy)] === T.ROCK) {
          tiles[idx(xx, yy)] = T.WATER;
          if (tiles[idx(W - 1 - xx, H - 1 - yy)] === T.ROCK) tiles[idx(W - 1 - xx, H - 1 - yy)] = T.WATER;
        }
      }
    }
  }

  if (!connected(tiles, bases[0], bases[1])) return null;
  // Требования извилистости: путь минимум в 1.6 раза длиннее прямой,
  // и коридор гуляет по вертикали не меньше чем на 10 тайлов.
  // Слишком «спрямлённые» варианты отбрасываются — генератор пробует новый.
  const straight = bases[1].x - bases[0].x;
  if (pathLen(tiles, bases[0], bases[1]) < straight * 1.6) return null;
  let minY = H, maxY = -1;
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    if (walkable(tiles[idx(xx, yy)])) { minY = Math.min(minY, yy); maxY = Math.max(maxY, yy); }
  }
  if (maxY - minY < 10) return null;
  return { tiles, bases };
}

// Длина кратчайшего пути по коридору (BFS, 4 направления).
function pathLen(tiles, a, b) {
  const dist = new Int32Array(W * H).fill(-1);
  const queue = [[a.x, a.y]];
  dist[idx(a.x, a.y)] = 0;
  let qi = 0;
  while (qi < queue.length) {
    const [x, y] = queue[qi++];
    if (x === b.x && y === b.y) return dist[idx(x, y)];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = idx(nx, ny);
      if (dist[ni] < 0 && walkable(tiles[ni])) { dist[ni] = dist[idx(x, y)] + 1; queue.push([nx, ny]); }
    }
  }
  return 0;
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

// Аварийная карта: прямой коридор по центру (не должна понадобиться).
function fallbackMap() {
  const tiles = new Uint8Array(W * H).fill(T.ROCK);
  const cy = Math.floor(H / 2);
  for (let x = 2; x < W - 2; x++) for (let dy = -1; dy <= 1; dy++) tiles[idx(x, cy + dy)] = T.GROUND;
  return { tiles, bases: [{ x: 3, y: cy }, { x: W - 4, y: cy }] };
}

module.exports = { generateMap, T, W, H, idx, walkable, connected };
