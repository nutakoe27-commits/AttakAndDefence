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
  const cx = (W - 1) / 2, cy = (H - 1) / 2;

  // Змейка из НЕЧЁТНЫХ гармоник вокруг центра карты: sin(-u) = -sin(u),
  // поэтому y(cx+u) + y(cx-u) = 2*cy — симметрия 180° получается сама собой.
  // Две гармоники с случайными амплитудами/частотами дают разные S-образные русла.
  const A1 = 5 + rand() * 3.5;
  const k1 = (Math.PI * (1.8 + rand() * 1.6)) / W;
  const s1 = rand() < 0.5 ? -1 : 1;
  const A2 = 2 + rand() * 3;
  const k2 = k1 * (2 + rand() * 1.6);
  const s2 = rand() < 0.5 ? -1 : 1;
  const pathY = (x) => {
    const u = x - cx;
    const y = cy + s1 * A1 * Math.sin(k1 * u) + s2 * A2 * Math.sin(k2 * u);
    return Math.max(3.2, Math.min(H - 4.2, y));
  };

  const carve = (px, py, r, to = T.GROUND) => {
    for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) {
      for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const dx = x - px, dy = y - py;
        if (dx * dx + dy * dy <= r * r) tiles[idx(x, y)] = to;
      }
    }
  };

  // Расширения-«арены» в симметричных точках коридора.
  const bulges = [];
  const nB = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < nB; i++) bulges.push({ d: 4 + rand() * (W / 2 - 10), r: 1.1 + rand() * 1.0 });
  const extraR = (x) => {
    let e = 0;
    for (const b of bulges) {
      const dd = Math.min(Math.abs(x - (cx - b.d)), Math.abs(x - (cx + b.d)));
      if (dd < 3) e = Math.max(e, b.r * (1 - dd / 3));
    }
    return e;
  };

  // Прорезаем коридор шириной ~3 тайла вдоль змейки.
  for (let x = 2; x <= W - 3; x += 0.5) {
    carve(x, pathY(x), 1.45 + extraR(x));
  }

  // Базы в концах коридора (симметричны автоматически).
  const bases = [
    { x: 3, y: Math.round(pathY(3)) },
    { x: W - 4, y: Math.round(pathY(W - 4)) },
  ];
  carve(bases[0].x, bases[0].y, 2.3);
  carve(bases[1].x, bases[1].y, 2.3);

  // Лесные пятна в коридоре — зоны замедления, симметричными парами.
  const nF = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < nF; i++) {
    const d = 5 + rand() * (W / 2 - 10);
    for (const sx of [cx - d, cx + d]) {
      const py = pathY(sx);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = Math.round(sx + dx), y = Math.round(py + dy);
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && tiles[idx(x, y)] === T.GROUND && rand() < 0.75) {
          tiles[idx(x, y)] = T.FOREST;
        }
      }
    }
  }

  // Горные озёра (декор, строить на них нельзя) — тоже симметричными парами.
  const nL = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < nL; i++) {
    const lx = 3 + rand() * (W / 2 - 6), ly = 2 + rand() * (H - 4), lr = 1 + rand() * 1.6;
    for (const [px, py] of [[lx, ly], [W - 1 - lx, H - 1 - ly]]) {
      for (let y = Math.floor(py - lr); y <= Math.ceil(py + lr); y++) {
        for (let x = Math.floor(px - lr); x <= Math.ceil(px + lr); x++) {
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          const dx = x - px, dy = y - py;
          if (dx * dx + dy * dy <= lr * lr && tiles[idx(x, y)] === T.ROCK) tiles[idx(x, y)] = T.WATER;
        }
      }
    }
  }

  if (!connected(tiles, bases[0], bases[1])) return null;
  return { tiles, bases };
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
