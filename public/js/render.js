// Рендерер мира: террейн (пре-рендер), сущности, эффекты, камера, миникарта.
import { OWNER_COLORS, drawUnit, drawBuilding, drawBase } from './sprites.js';

const T = { GROUND: 0, ROCK: 1, WATER: 2, FOREST: 3 };
const TILE = 48; // px на тайл в мировых координатах пре-рендера

// Простой детерминированный шум для вариаций тайлов.
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.map = null;
    this.terrain = null;
    this.particles = [];
    this.projectiles = [];
    this.floaters = [];   // всплывающий текст
    this.shake = 0;
    this.time = 0;
    this.mySlot = 0;
    this.waterPhase = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
  }

  setMap(map, mySlot) {
    this.map = map;
    this.mySlot = mySlot;
    this.particles = []; this.projectiles = []; this.floaters = [];
    this.prerenderTerrain();
    // Камера: показать свою базу.
    const base = map.bases[mySlot];
    this.fitZoom();
    this.cam.x = base.x * TILE;
    this.cam.y = base.y * TILE;
    this.clampCam();
  }

  fitZoom() {
    const vw = this.canvas.width / this.dpr, vh = this.canvas.height / this.dpr;
    const fit = Math.min(vw / (this.map.w * TILE), vh / (this.map.h * TILE));
    this.minZoom = fit * 0.95;
    this.maxZoom = 2.2;
    this.cam.zoom = Math.max(this.minZoom, Math.min(1, this.maxZoom));
  }

  prerenderTerrain() {
    const { w, h, tiles, seed } = this.map;
    const cv = document.createElement('canvas');
    cv.width = w * TILE; cv.height = h * TILE;
    const ctx = cv.getContext('2d');

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y * w + x];
        const px = x * TILE, py = y * TILE;
        const n = hash2(x, y, seed);
        if (t === T.GROUND || t === T.FOREST) {
          // трава с вариацией оттенка
          const shade = 0.9 + n * 0.2;
          ctx.fillStyle = `rgb(${(74 * shade) | 0},${(107 * shade) | 0},${(51 * shade) | 0})`;
          ctx.fillRect(px, py, TILE, TILE);
          // крапинки травы
          for (let i = 0; i < 5; i++) {
            const rx = hash2(x * 7 + i, y, seed), ry = hash2(x, y * 7 + i, seed);
            ctx.fillStyle = `rgba(${120 + i * 8},${150 + i * 6},70,${.25})`;
            ctx.fillRect(px + rx * TILE, py + ry * TILE, 2.5, 2.5);
          }
        }
        if (t === T.FOREST) {
          // деревья: 2-3 кроны
          const trees = 2 + ((n * 3) | 0);
          for (let i = 0; i < trees; i++) {
            const rx = px + 8 + hash2(x * 13 + i, y * 3, seed) * (TILE - 16);
            const ry = py + 10 + hash2(x * 5, y * 11 + i, seed) * (TILE - 18);
            const r = 7 + hash2(x + i, y + i, seed) * 5;
            ctx.fillStyle = 'rgba(0,0,0,.28)';
            ctx.beginPath(); ctx.ellipse(rx + 2, ry + r * .8, r * .9, r * .4, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#4a3520';
            ctx.fillRect(rx - 1.5, ry, 3, r * .8);
            const g = ctx.createRadialGradient(rx - r * .3, ry - r * .4, r * .2, rx, ry - r * .2, r);
            g.addColorStop(0, '#4f8a3d'); g.addColorStop(1, '#28511f');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(rx, ry - r * .2, r, 0, Math.PI * 2); ctx.fill();
          }
        }
        if (t === T.ROCK) {
          // Горные плато: светлее прежних скал — здесь строят, это «рабочая» поверхность.
          const shade = 0.92 + n * 0.16;
          ctx.fillStyle = `rgb(${(96 * shade) | 0},${(97 * shade) | 0},${(106 * shade) | 0})`;
          ctx.fillRect(px, py, TILE, TILE);
          // обрыв к коридору: светлая кромка сверху, тень снизу
          const down = y < h - 1 && (tiles[(y + 1) * w + x] === T.GROUND || tiles[(y + 1) * w + x] === T.FOREST);
          const up = y > 0 && (tiles[(y - 1) * w + x] === T.GROUND || tiles[(y - 1) * w + x] === T.FOREST);
          if (up) { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(px, py, TILE, 5); }
          if (down) { ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(px, py + TILE - 6, TILE, 6); }
          const left = x > 0 && (tiles[y * w + x - 1] === T.GROUND || tiles[y * w + x - 1] === T.FOREST);
          const right = x < w - 1 && (tiles[y * w + x + 1] === T.GROUND || tiles[y * w + x + 1] === T.FOREST);
          if (left) { ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(px, py, 4, TILE); }
          if (right) { ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(px + TILE - 4, py, 4, TILE); }
          // камни-обломки
          for (let i = 0; i < 3; i++) {
            const rx = hash2(x * 3 + i, y * 9, seed), ry = hash2(x * 9, y * 3 + i, seed);
            ctx.fillStyle = `rgba(${118 + i * 10},${122 + i * 10},${132 + i * 8},.55)`;
            ctx.beginPath();
            ctx.arc(px + rx * TILE, py + ry * TILE, 2 + hash2(x + i, y - i, seed) * 3, 0, Math.PI * 2);
            ctx.fill();
          }
          // редкие снежные шапки в глубине гор
          if (n > 0.82 && !up && !down && !left && !right) {
            ctx.fillStyle = 'rgba(235,240,248,.35)';
            ctx.beginPath();
            ctx.arc(px + TILE * 0.5, py + TILE * 0.4, TILE * 0.22, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (t === T.WATER) {
          const g = ctx.createLinearGradient(px, py, px, py + TILE);
          g.addColorStop(0, '#1d4e6e'); g.addColorStop(1, '#153a54');
          ctx.fillStyle = g;
          ctx.fillRect(px, py, TILE, TILE);
          // песчаная кромка
          const nUp = y > 0 && tiles[(y - 1) * w + x] !== T.WATER;
          if (nUp) { ctx.fillStyle = 'rgba(200,180,120,.35)'; ctx.fillRect(px, py, TILE, 4); }
        }
      }
    }
    // Виньетка границы половин: тонкая линия по центру.
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.setLineDash([10, 12]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2 * TILE, 0); ctx.lineTo(w / 2 * TILE, h * TILE); ctx.stroke();
    ctx.setLineDash([]);
    this.terrain = cv;
  }

  // Мировые координаты <-> экран
  worldToScreen(wx, wy) {
    const vw = this.canvas.width / this.dpr, vh = this.canvas.height / this.dpr;
    return [
      (wx * TILE - this.cam.x) * this.cam.zoom + vw / 2,
      (wy * TILE - this.cam.y) * this.cam.zoom + vh / 2,
    ];
  }
  screenToWorld(sx, sy) {
    const vw = this.canvas.width / this.dpr, vh = this.canvas.height / this.dpr;
    return [
      ((sx - vw / 2) / this.cam.zoom + this.cam.x) / TILE,
      ((sy - vh / 2) / this.cam.zoom + this.cam.y) / TILE,
    ];
  }

  clampCam() {
    if (!this.map) return;
    const vw = this.canvas.width / this.dpr, vh = this.canvas.height / this.dpr;
    const halfW = vw / 2 / this.cam.zoom, halfH = vh / 2 / this.cam.zoom;
    const mw = this.map.w * TILE, mh = this.map.h * TILE;
    const pad = 60;
    this.cam.x = Math.max(Math.min(halfW, mw - halfW) - 0, Math.min(mw - Math.min(halfW, mw - halfW), this.cam.x));
    this.cam.x = Math.max(halfW - pad, Math.min(mw - halfW + pad, this.cam.x));
    this.cam.y = Math.max(halfH - pad, Math.min(mh - halfH + pad, this.cam.y));
    if (mw < halfW * 2) this.cam.x = mw / 2;
    if (mh < halfH * 2) this.cam.y = mh / 2;
  }

  addEvent(ev) {
    switch (ev.t) {
      case 'proj':
        this.projectiles.push({ ...ev, born: this.time, dur: ev.k === 'shell' ? .5 : .28 });
        break;
      case 'boom':
        this.shakeAdd(4);
        this.spawnBurst(ev.x, ev.y, '#ff9a3d', 16, 3.2);
        this.spawnBurst(ev.x, ev.y, '#5c5c5c', 8, 1.8);
        break;
      case 'hit':
        this.spawnBurst(ev.x, ev.y, '#ffe08a', 3, 1.4);
        break;
      case 'die':
        this.spawnBurst(ev.x, ev.y, ev.owner === this.mySlot ? '#7db4ff' : '#ff8a7d', 10, 2.4);
        break;
      case 'bdie':
        this.shakeAdd(5);
        this.spawnBurst(ev.x, ev.y, '#c9b590', 18, 3);
        this.spawnBurst(ev.x, ev.y, '#4a4a4a', 10, 2);
        break;
      case 'heal':
        this.floaters.push({ x: ev.x, y: ev.y, text: '+', color: '#4ade80', born: this.time });
        break;
      case 'basehit':
        if (ev.owner === this.mySlot) this.shakeAdd(6);
        this.spawnBurst(ev.x, ev.y, '#ffd24a', 6, 2);
        break;
      case 'frost':
        this.particles.push({ x: ev.x, y: ev.y, kind: 'ring', color: 'rgba(140,220,255,.7)', r0: .3, r1: ev.r, born: this.time, life: .5 });
        break;
      case 'build':
        this.spawnBurst(ev.x, ev.y, '#d9cba8', 10, 2);
        break;
      case 'spawn':
        this.particles.push({ x: ev.x, y: ev.y, kind: 'ring', color: ev.owner === this.mySlot ? 'rgba(120,180,255,.8)' : 'rgba(255,120,120,.8)', r0: .2, r1: 1.6, born: this.time, life: .4 });
        break;
    }
  }

  spawnBurst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random() * 0.6) * speed;
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1,
        color, kind: 'dot', size: 2 + Math.random() * 3,
        born: this.time, life: .5 + Math.random() * .5,
      });
    }
  }

  shakeAdd(v) { this.shake = Math.min(12, this.shake + v); }

  // Главный кадр. state: интерполированное состояние из game.js
  draw(state, dt, ui) {
    this.time += dt;
    this.waterPhase += dt;
    const ctx = this.ctx;
    const vw = this.canvas.width / this.dpr, vh = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, vw, vh);
    if (!this.map || !state) return;

    // Тряска
    let shx = 0, shy = 0;
    if (this.shake > 0.1) {
      shx = (Math.random() - .5) * this.shake;
      shy = (Math.random() - .5) * this.shake;
      this.shake *= Math.pow(0.02, dt);
    }

    ctx.save();
    ctx.translate(vw / 2 + shx, vh / 2 + shy);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    // Террейн
    ctx.drawImage(this.terrain, 0, 0);
    this.drawWaterShimmer(ctx);
    this.drawTerritoryTint(ctx);
    if (state.phase === 'plan') this.drawPlanFog(ctx);

    // Подсветка размещения
    if (ui && ui.placing) this.drawPlacement(ctx, ui);

    // Постройки (сортировка по y, чтобы верхние были позади)
    const buildings = [...state.buildings].sort((a, b) => a.cy - b.cy);
    for (const b of buildings) {
      ctx.save();
      ctx.translate((b.cx + .5) * TILE, (b.cy + .5) * TILE);
      drawBuilding(ctx, b.type, OWNER_COLORS[b.owner], TILE, this.time, b.hp / 100);
      ctx.restore();
      if (b.hp < 100) this.drawHpBar(ctx, (b.cx + .5) * TILE, b.cy * TILE - 6, b.hp / 100, b.owner);
      if (ui && ui.selectedBuilding === b.id) {
        ctx.strokeStyle = 'rgba(245,197,66,.9)'; ctx.lineWidth = 2;
        ctx.strokeRect(b.cx * TILE + 2, b.cy * TILE + 2, TILE - 4, TILE - 4);
        const spec = ui.balance.buildings[b.type];
        if (spec.range) this.drawRange(ctx, (b.cx + .5) * TILE, (b.cy + .5) * TILE, spec.range);
      }
    }

    // Базы
    for (let slot = 0; slot < 2; slot++) {
      const base = this.map.bases[slot];
      const p = state.players[slot];
      ctx.save();
      ctx.translate((base.x + .5) * TILE, (base.y + .5) * TILE);
      drawBase(ctx, OWNER_COLORS[slot], TILE * 1.15, this.time, p.baseHp / p.baseHpMax);
      ctx.restore();
      this.drawHpBar(ctx, (base.x + .5) * TILE, (base.y - 1.6) * TILE, p.baseHp / p.baseHpMax, slot, 46);
    }

    // Юниты (сортировка по y)
    const units = [...state.units].sort((a, b) => a.y - b.y);
    for (const u of units) {
      ctx.save();
      ctx.translate(u.x * TILE, u.y * TILE);
      drawUnit(ctx, u.type, OWNER_COLORS[u.owner], TILE, u.dir, this.time * 9 + u.id, u.slowed);
      ctx.restore();
      if (u.hp < 100) this.drawHpBar(ctx, u.x * TILE, u.y * TILE - TILE * .45, u.hp / 100, u.owner, 20);
    }

    this.drawProjectiles(ctx);
    this.drawParticles(ctx, dt);
    this.drawFloaters(ctx);

    ctx.restore();

    this.drawMinimap(ctx, state, vw, vh);
  }

  drawWaterShimmer(ctx) {
    // лёгкая рябь: бегущие блики по воде
    const { w, h, tiles } = this.map;
    ctx.save();
    ctx.globalAlpha = .25;
    ctx.strokeStyle = '#9fd8f0';
    ctx.lineWidth = 1.4;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (tiles[y * w + x] !== T.WATER) continue;
        const ph = (this.waterPhase * .6 + hash2(x, y, 7)) % 1;
        const px = x * TILE, py = y * TILE + ph * TILE;
        if (ph < .8) {
          ctx.beginPath();
          ctx.moveTo(px + 8, py);
          ctx.quadraticCurveTo(px + TILE / 2, py + 3, px + TILE - 8, py);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Во время планирования вражеская половина в «тумане»: сервер и так не шлёт
  // свежие данные, а туман объясняет игроку, почему там ничего не меняется.
  drawPlanFog(ctx) {
    const { w, h } = this.map;
    const mid = w / 2 * TILE;
    const myLeft = this.mySlot === 0;
    const x0 = myLeft ? mid : 0;
    ctx.save();
    const g = ctx.createLinearGradient(myLeft ? mid : mid, 0, myLeft ? mid + TILE * 6 : mid - TILE * 6, 0);
    g.addColorStop(0, 'rgba(10,14,22,.25)');
    g.addColorStop(1, 'rgba(10,14,22,.55)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, mid, h * TILE);
    // Лёгкие «клубы» тумана.
    ctx.globalAlpha = .08;
    ctx.fillStyle = '#cdd8e8';
    for (let i = 0; i < 14; i++) {
      const fx = x0 + ((i * 137.5 + this.time * 9) % mid);
      const fy = ((i * 89.3) % (h * TILE));
      const r = TILE * (1.6 + (i % 4) * 0.7);
      ctx.beginPath(); ctx.arc(fx, fy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Знаки вопроса у вражеской базы.
    const eb = this.map.bases[1 - this.mySlot];
    ctx.font = `bold ${TILE * 0.9}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,215,235,.35)';
    const bob = Math.sin(this.time * 2) * 4;
    ctx.fillText('?', (eb.x + .5) * TILE, (eb.y - 1.8) * TILE + bob);
    ctx.restore();
  }

  drawTerritoryTint(ctx) {
    const { w, h } = this.map;
    const mid = w / 2 * TILE;
    const myLeft = this.mySlot === 0;
    ctx.fillStyle = 'rgba(77,163,255,.045)';
    ctx.fillRect(myLeft ? 0 : mid, 0, mid, h * TILE);
    ctx.fillStyle = 'rgba(255,93,93,.045)';
    ctx.fillRect(myLeft ? mid : 0, 0, mid, h * TILE);
  }

  drawPlacement(ctx, ui) {
    const { cx, cy, valid, type } = ui.placing;
    // Подсветка гор своей половины — где вообще можно строить.
    const { w, h, tiles } = this.map;
    const half = w / 2;
    const myLeft2 = this.mySlot === 0;
    ctx.fillStyle = 'rgba(120,220,140,.08)';
    for (let y = 1; y < h - 1; y++) {
      for (let x = myLeft2 ? 1 : half; x < (myLeft2 ? half : w - 1); x++) {
        if (tiles[y * w + x] === T.ROCK) ctx.fillRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6);
      }
    }
    if (cx === null) return;
    ctx.fillStyle = valid ? 'rgba(80,220,120,.3)' : 'rgba(230,70,70,.35)';
    ctx.fillRect(cx * TILE, cy * TILE, TILE, TILE);
    ctx.strokeStyle = valid ? 'rgba(80,220,120,.9)' : 'rgba(230,70,70,.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx * TILE + 1, cy * TILE + 1, TILE - 2, TILE - 2);
    const spec = ui.balance.buildings[type];
    if (spec.range) this.drawRange(ctx, (cx + .5) * TILE, (cy + .5) * TILE, spec.range);
    // Призрак постройки
    ctx.save();
    ctx.globalAlpha = .6;
    ctx.translate((cx + .5) * TILE, (cy + .5) * TILE);
    drawBuilding(ctx, type, OWNER_COLORS[this.mySlot], TILE, this.time, 1);
    ctx.restore();
    // Подсветка своей половины
    const mid = this.map.w / 2 * TILE;
    const myLeft = this.mySlot === 0;
    ctx.strokeStyle = 'rgba(245,197,66,.5)';
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(myLeft ? 1 : mid, 1, mid - 1, this.map.h * TILE - 2);
    ctx.setLineDash([]);
  }

  drawRange(ctx, x, y, range) {
    ctx.strokeStyle = 'rgba(245,197,66,.55)';
    ctx.fillStyle = 'rgba(245,197,66,.07)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, range * TILE, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

  drawHpBar(ctx, x, y, frac, owner, width = 26) {
    const w = width, h = 4;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    const c = frac > .5 ? (owner === this.mySlot ? '#5ad06a' : '#d05a5a') : frac > .25 ? '#e0b040' : '#e05540';
    ctx.fillStyle = c;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), h);
  }

  drawProjectiles(ctx) {
    const now = this.time;
    this.projectiles = this.projectiles.filter(p => now - p.born < p.dur);
    for (const p of this.projectiles) {
      const t = (now - p.born) / p.dur;
      const x = (p.x1 + (p.x2 - p.x1) * t) * TILE;
      let y = (p.y1 + (p.y2 - p.y1) * t) * TILE;
      if (p.k === 'shell') {
        y -= Math.sin(t * Math.PI) * 30; // дуга
        ctx.fillStyle = '#2b2b2b';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,160,60,.8)';
        ctx.beginPath(); ctx.arc(x - (p.x2 - p.x1) * 3, y + 2, 2, 0, Math.PI * 2); ctx.fill();
      } else {
        const ang = Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(ang);
        if (p.k === 'bolt') {
          ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(6, 0); ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(6, 0, 2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(5, 0); ctx.stroke();
          ctx.fillStyle = '#c8c8c8';
          ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(1, -2); ctx.lineTo(1, 2); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  drawParticles(ctx, dt) {
    const now = this.time;
    this.particles = this.particles.filter(p => now - p.born < p.life);
    for (const p of this.particles) {
      const t = (now - p.born) / p.life;
      if (p.kind === 'ring') {
        const r = (p.r0 + (p.r1 - p.r0) * t) * TILE;
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x * TILE, p.y * TILE, r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 4 * dt;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x * TILE, p.y * TILE, p.size * (1 - t * .5), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  drawFloaters(ctx) {
    const now = this.time;
    this.floaters = this.floaters.filter(f => now - f.born < 1);
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      const t = now - f.born;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x * TILE, (f.y - t * .8) * TILE);
      ctx.globalAlpha = 1;
    }
  }

  drawMinimap(ctx, state, vw, vh) {
    const mw = 176, mh = mw * (this.map.h / this.map.w);
    const mx = 12, my = vh - mh - 12;
    this.minimapRect = { x: mx, y: my, w: mw, h: mh };
    ctx.save();
    ctx.globalAlpha = .92;
    ctx.fillStyle = '#0a0e14';
    ctx.strokeStyle = '#2c3a4d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(mx - 3, my - 3, mw + 6, mh + 6, 8); else ctx.rect(mx - 3, my - 3, mw + 6, mh + 6);
    ctx.fill(); ctx.stroke();
    ctx.drawImage(this.terrain, mx, my, mw, mh);
    const sx = mw / this.map.w, sy = mh / this.map.h;
    // постройки
    for (const b of state.buildings) {
      ctx.fillStyle = OWNER_COLORS[b.owner].main;
      ctx.fillRect(mx + b.cx * sx - 1, my + b.cy * sy - 1, 3, 3);
    }
    // юниты
    for (const u of state.units) {
      ctx.fillStyle = u.owner === this.mySlot ? '#9fd0ff' : '#ffb09f';
      ctx.fillRect(mx + u.x * sx - 1, my + u.y * sy - 1, 2, 2);
    }
    // базы
    for (let s = 0; s < 2; s++) {
      const b = this.map.bases[s];
      ctx.fillStyle = OWNER_COLORS[s].main;
      ctx.beginPath(); ctx.arc(mx + b.x * sx, my + b.y * sy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    }
    // рамка видимой области
    const halfW = vw / 2 / this.cam.zoom / TILE, halfH = vh / 2 / this.cam.zoom / TILE;
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      mx + (this.cam.x / TILE - halfW) * sx, my + (this.cam.y / TILE - halfH) * sy,
      halfW * 2 * sx, halfH * 2 * sy
    );
    ctx.restore();
  }

  minimapToWorld(sx, sy) {
    const r = this.minimapRect;
    if (!r || sx < r.x || sy < r.y || sx > r.x + r.w || sy > r.y + r.h) return null;
    return [((sx - r.x) / r.w) * this.map.w, ((sy - r.y) / r.h) * this.map.h];
  }
}

export { TILE, T };
