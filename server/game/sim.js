'use strict';
// Авторитарная симуляция матча. Вся логика — только на сервере,
// клиент лишь рендерит снапшоты и шлёт команды.
const { generateMap, T, walkable } = require('./mapgen');

const UNIT_CAP = 70;          // максимум юнитов на игрока
const FOREST_SPEED = 0.55;    // множитель скорости в лесу
const SIEGE_COST = 26;        // «стоимость» прохода сквозь вражескую постройку для поиска пути
const FOREST_COST = 2;

let nextEntityId = 1;

class Match {
  constructor(id, balance, players, seed) {
    this.id = id;
    this.balance = JSON.parse(JSON.stringify(balance)); // баланс фиксируется на старте матча
    this.map = generateMap(seed ?? ((Math.random() * 0xffffffff) >>> 0));
    this.tick = 0;
    this.time = 0;
    this.dt = 1 / this.balance.match.tickRate;
    this.over = false;
    this.winner = null;
    this.endReason = null;
    this.events = [];
    this.createdAt = Date.now();

    // players: [{name, isBot}]
    this.players = players.map((p, i) => ({
      slot: i,
      name: p.name,
      isBot: !!p.isBot,
      gold: this.balance.economy.startGold,
      baseHp: this.balance.economy.baseHp,
      baseHpMax: this.balance.economy.baseHp,
      income: this.balance.economy.baseIncome,
      goldEarned: 0,
      goldSpent: 0,
      unitsSpawned: 0,
      unitsLost: 0,
      unitsKilled: 0,
    }));

    this.units = [];      // {id, owner, type, x, y, hp, hpMax, slowUntil, cd, dir}
    this.buildings = [];  // {id, owner, type, cx, cy, hp, hpMax, cd}
    this.buildGrid = new Int32Array(this.map.w * this.map.h).fill(-1); // индекс постройки в клетке
    this.incomeAcc = 0;
    this.flowDirty = true;
    this.flows = [null, null]; // поле направлений к базе врага для каждого игрока
  }

  gi(x, y) { return y * this.map.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.map.w && y < this.map.h; }

  // ---------- Команды игроков ----------
  spawnUnits(slot, type) {
    if (this.over) return { ok: false, error: 'Матч завершён' };
    const spec = this.balance.units[type];
    if (!spec) return { ok: false, error: 'Неизвестный юнит' };
    const p = this.players[slot];
    if (p.gold < spec.cost) return { ok: false, error: 'Недостаточно золота' };
    const alive = this.units.filter(u => u.owner === slot).length;
    if (alive + spec.pack > UNIT_CAP) return { ok: false, error: 'Достигнут лимит армии' };
    p.gold -= spec.cost;
    p.goldSpent += spec.cost;
    const base = this.map.bases[slot];
    for (let i = 0; i < spec.pack; i++) {
      const ang = (i / spec.pack) * Math.PI * 2;
      this.units.push({
        id: nextEntityId++,
        owner: slot, type,
        x: base.x + 0.5 + Math.cos(ang) * 0.9,
        y: base.y + 0.5 + Math.sin(ang) * 0.9,
        hp: spec.hp, hpMax: spec.hp,
        slowUntil: 0, cd: 0, dir: slot === 0 ? 0 : Math.PI,
      });
      p.unitsSpawned++;
    }
    this.events.push({ t: 'spawn', x: base.x + 0.5, y: base.y + 0.5, owner: slot });
    return { ok: true };
  }

  build(slot, type, cx, cy) {
    if (this.over) return { ok: false, error: 'Матч завершён' };
    const spec = this.balance.buildings[type];
    if (!spec) return { ok: false, error: 'Неизвестная постройка' };
    const p = this.players[slot];
    if (p.gold < spec.cost) return { ok: false, error: 'Недостаточно золота' };
    const err = this.placementError(slot, type, cx, cy);
    if (err) return { ok: false, error: err };
    p.gold -= spec.cost;
    p.goldSpent += spec.cost;
    const b = {
      id: nextEntityId++, owner: slot, type, cx, cy,
      hp: spec.hp, hpMax: spec.hp, cd: 0,
    };
    this.buildings.push(b);
    this.buildGrid[this.gi(cx, cy)] = b.id;
    this.flowDirty = true;
    this.events.push({ t: 'build', x: cx + 0.5, y: cy + 0.5, owner: slot });
    return { ok: true };
  }

  sell(slot, buildingId) {
    const i = this.buildings.findIndex(b => b.id === buildingId && b.owner === slot);
    if (i < 0) return { ok: false, error: 'Постройка не найдена' };
    const b = this.buildings[i];
    const spec = this.balance.buildings[b.type];
    const refund = Math.floor(spec.cost * this.balance.economy.refundRatio * (b.hp / b.hpMax));
    this.players[slot].gold += refund;
    this.removeBuilding(b);
    return { ok: true, refund };
  }

  placementError(slot, type, cx, cy) {
    if (!this.inBounds(cx, cy)) return 'Вне карты';
    if (this.map.tiles[this.gi(cx, cy)] !== T.GROUND) return 'Строить можно только на земле';
    if (this.buildGrid[this.gi(cx, cy)] >= 0) return 'Клетка занята';
    const half = this.map.w / 2;
    if (slot === 0 && cx >= half) return 'Строить можно только на своей половине';
    if (slot === 1 && cx < half) return 'Строить можно только на своей половине';
    const base = this.map.bases[slot];
    if (cx === base.x && cy === base.y) return 'Здесь стоит база';
    const spec = this.balance.buildings[type];
    if (spec.maxCount) {
      const count = this.buildings.filter(b => b.owner === slot && b.type === type).length;
      if (count >= spec.maxCount) return `Максимум ${spec.maxCount} шт.`;
    }
    return null;
  }

  removeBuilding(b) {
    this.buildGrid[this.gi(b.cx, b.cy)] = -1;
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
    this.flowDirty = true;
  }

  // ---------- Поиск пути (поле направлений, Дейкстра от вражеской базы) ----------
  // Вражеские постройки проходимы, но с большой ценой: юниты сами «прогрызают» путь.
  computeFlow(slot) {
    const { w, h, tiles } = this.map;
    const enemy = 1 - slot;
    const target = this.map.bases[enemy];
    const dist = new Float32Array(w * h).fill(Infinity);
    const ownerOfCell = new Int8Array(w * h).fill(-1);
    for (const b of this.buildings) ownerOfCell[this.gi(b.cx, b.cy)] = b.owner;

    // Двоичная куча не нужна: цены малы, подойдёт bucket-подобная очередь.
    const start = this.gi(target.x, target.y);
    dist[start] = 0;
    const queue = [[0, start]];
    while (queue.length) {
      // простая приоритетная выборка: очередь короткая относительно карты
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i;
      const [d, ci] = queue.splice(bi, 1)[0];
      if (d > dist[ci]) continue;
      const cx = ci % w, cy = (ci / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        const t = tiles[ni];
        if (!walkable(t)) continue;
        let cost = t === T.FOREST ? FOREST_COST : 1;
        if (ownerOfCell[ni] === enemy) cost = SIEGE_COST; // вражескую постройку придётся ломать
        if (ownerOfCell[ni] === slot) cost = 6;           // свою лучше обойти, но можно протиснуться
        const nd = d + cost;
        if (nd < dist[ni]) { dist[ni] = nd; queue.push([nd, ni]); }
      }
    }
    return dist;
  }

  flowFor(slot) {
    if (this.flowDirty) {
      this.flows[0] = this.computeFlow(0);
      this.flows[1] = this.computeFlow(1);
      this.flowDirty = false;
    }
    return this.flows[slot];
  }

  // ---------- Основной цикл ----------
  step() {
    if (this.over) return;
    this.tick++;
    this.time += this.dt;

    this.updateIncome();
    this.updateUnits();
    this.updateBuildings();
    this.updateBaseTurrets();
    this.updateSuddenDeathDecay();
    this.checkEnd();
  }

  // Турель базы: не даёт снести базу ранним рашем без осадных юнитов.
  updateBaseTurrets() {
    const spec = this.balance.economy.baseTurret;
    if (!spec || !spec.dmg) return;
    for (const p of this.players) {
      p.baseCd = Math.max(0, (p.baseCd || 0) - this.dt);
      if (p.baseCd > 0) continue;
      const base = this.map.bases[p.slot];
      const bx = base.x + 0.5, by = base.y + 0.5;
      let target = null, bestD = Infinity;
      for (const u of this.units) {
        if (u.owner === p.slot || u.hp <= 0) continue;
        const d = Math.hypot(u.x - bx, u.y - by);
        if (d <= spec.range && d < bestD) { bestD = d; target = u; }
      }
      if (!target) continue;
      p.baseCd = 1 / spec.attackRate;
      this.events.push({ t: 'proj', x1: bx, y1: by, x2: target.x, y2: target.y, k: 'bolt' });
      this.damageUnit(target, spec.dmg, p.slot);
    }
    this.reapDead();
  }

  // Sudden death: базы начинают медленно разрушаться сами — матч гарантированно закончится.
  updateSuddenDeathDecay() {
    const m = this.balance.match;
    if (!m.suddenDeathDecayPerSec || this.time < m.suddenDeathAtSec) return;
    const t = Math.min(1, (this.time - m.suddenDeathAtSec) / m.suddenDeathRampSec);
    const decay = m.suddenDeathDecayPerSec * t * this.dt;
    for (const p of this.players) p.baseHp -= decay;
  }

  updateIncome() {
    this.incomeAcc += this.dt;
    const eco = this.balance.economy;
    if (this.incomeAcc >= eco.incomeTickSeconds) {
      this.incomeAcc -= eco.incomeTickSeconds;
      for (const p of this.players) {
        let income = eco.baseIncome;
        let mult = 1;
        for (const b of this.buildings) {
          if (b.owner !== p.slot) continue;
          const spec = this.balance.buildings[b.type];
          if (spec.income) income += spec.income;
          if (spec.incomeMult) mult += spec.incomeMult;
        }
        const gained = Math.round(income * mult);
        p.income = gained;
        p.gold += gained;
        p.goldEarned += gained;
      }
    }
  }

  suddenDeathMult() {
    const m = this.balance.match;
    if (this.time < m.suddenDeathAtSec) return 1;
    const t = Math.min(1, (this.time - m.suddenDeathAtSec) / m.suddenDeathRampSec);
    return 1 + t * 4; // урон по базам растёт до x5
  }

  updateUnits() {
    const dead = [];
    for (const u of this.units) {
      const spec = this.balance.units[u.type];
      u.cd = Math.max(0, u.cd - this.dt);
      const enemySlot = 1 - u.owner;

      // Целитель: лечит самого раненого союзника в радиусе, следует за армией.
      if (spec.healPerSec) {
        this.healerBehavior(u, spec);
        continue;
      }

      // 1. Ищем цель: ближайший вражеский юнит в радиусе атаки (+ небольшой захват).
      const aggroRange = Math.max(spec.range, 1.6);
      let target = null, bestD = Infinity;
      for (const e of this.units) {
        if (e.owner !== enemySlot || e.hp <= 0) continue;
        const d = Math.hypot(e.x - u.x, e.y - u.y);
        if (d < bestD && d <= aggroRange + 0.4) { bestD = d; target = e; }
      }
      // Разрушитель предпочитает постройки, если есть в радиусе.
      let btarget = null, bd = Infinity;
      for (const b of this.buildings) {
        if (b.owner !== enemySlot) continue;
        const d = Math.hypot(b.cx + 0.5 - u.x, b.cy + 0.5 - u.y);
        if (d < bd && d <= Math.max(spec.range, 1.5) + 0.3) { bd = d; btarget = b; }
      }
      const enemyBase = this.map.bases[enemySlot];
      const baseD = Math.hypot(enemyBase.x + 0.5 - u.x, enemyBase.y + 0.5 - u.y);
      const baseInRange = baseD <= Math.max(spec.range, 1.5) + 0.8;

      let attacked = false;
      const prefersBuildings = spec.bonusVsBuildings > 1;
      if (baseInRange) {
        attacked = this.tryAttackBase(u, spec, enemySlot);
      } else if (btarget && (prefersBuildings || !target)) {
        attacked = this.tryAttackBuilding(u, spec, btarget);
      } else if (target && bestD <= spec.range + 0.2) {
        attacked = this.tryAttackUnit(u, spec, target);
      } else if (btarget) {
        attacked = this.tryAttackBuilding(u, spec, btarget);
      }

      // 2. Движение, если не в бою (или цель вне досягаемости).
      if (!attacked && !(target && bestD <= spec.range + 0.2)) {
        this.moveUnit(u, spec, target);
      }
      if (u.hp <= 0) dead.push(u);
    }
    this.reapDead();
  }

  healerBehavior(u, spec) {
    // Лечим самого раненого союзника в радиусе.
    let patient = null, worst = 1;
    for (const a of this.units) {
      if (a.owner !== u.owner || a === u || a.hp <= 0) continue;
      const d = Math.hypot(a.x - u.x, a.y - u.y);
      const frac = a.hp / a.hpMax;
      if (d <= spec.healRadius && frac < worst) { worst = frac; patient = a; }
    }
    if (patient && u.cd <= 0) {
      patient.hp = Math.min(patient.hpMax, patient.hp + spec.healPerSec);
      u.cd = 1;
      this.events.push({ t: 'heal', x: patient.x, y: patient.y });
    }
    // Держится за ближайшим союзником впереди, иначе идёт по потоку.
    let buddy = null, bd = Infinity;
    for (const a of this.units) {
      if (a.owner !== u.owner || a === u || this.balance.units[a.type].healPerSec) continue;
      const d = Math.hypot(a.x - u.x, a.y - u.y);
      if (d < bd) { bd = d; buddy = a; }
    }
    if (buddy && bd > 1.6) {
      this.moveToward(u, spec, buddy.x, buddy.y);
    } else if (!buddy) {
      this.moveUnit(u, spec, null);
    }
  }

  tryAttackUnit(u, spec, target) {
    u.dir = Math.atan2(target.y - u.y, target.x - u.x);
    if (u.cd > 0) return true;
    u.cd = 1 / spec.attackRate;
    const tspec = this.balance.units[target.type];
    const dmg = Math.max(1, spec.dmg - (tspec.armor || 0));
    target.hp -= dmg;
    this.events.push({ t: 'hit', x: target.x, y: target.y, r: spec.range > 2 });
    if (spec.range > 2) this.events.push({ t: 'proj', x1: u.x, y1: u.y, x2: target.x, y2: target.y, k: 'arrow' });
    if (target.hp <= 0) {
      this.players[u.owner].unitsKilled++;
      this.players[target.owner].unitsLost++;
      this.events.push({ t: 'die', x: target.x, y: target.y, u: target.type, owner: target.owner });
    }
    return true;
  }

  tryAttackBuilding(u, spec, b) {
    u.dir = Math.atan2(b.cy + 0.5 - u.y, b.cx + 0.5 - u.x);
    if (u.cd > 0) return true;
    u.cd = 1 / spec.attackRate;
    b.hp -= spec.dmg * spec.bonusVsBuildings * this.suddenDeathMult();
    this.events.push({ t: 'hit', x: b.cx + 0.5, y: b.cy + 0.5 });
    if (b.hp <= 0) {
      this.events.push({ t: 'bdie', x: b.cx + 0.5, y: b.cy + 0.5, b: b.type });
      this.removeBuilding(b);
    }
    return true;
  }

  tryAttackBase(u, spec, enemySlot) {
    const base = this.map.bases[enemySlot];
    u.dir = Math.atan2(base.y + 0.5 - u.y, base.x + 0.5 - u.x);
    if (u.cd > 0) return true;
    u.cd = 1 / spec.attackRate;
    const dmg = spec.dmg * spec.bonusVsBuildings * this.suddenDeathMult();
    this.players[enemySlot].baseHp -= dmg;
    this.events.push({ t: 'basehit', x: base.x + 0.5, y: base.y + 0.5, owner: enemySlot });
    return true;
  }

  moveUnit(u, spec, chaseTarget) {
    if (chaseTarget) {
      this.moveToward(u, spec, chaseTarget.x, chaseTarget.y);
      return;
    }
    // По полю направлений: шаг в соседнюю клетку с минимальной дистанцией до цели.
    const flow = this.flowFor(u.owner);
    const { w } = this.map;
    const cx = Math.floor(u.x), cy = Math.floor(u.y);
    let best = null, bestD = flow[cy * w + cx];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!this.inBounds(nx, ny)) continue;
      if (!walkable(this.map.tiles[ny * w + nx])) continue;
      // диагональ не должна срезать угол через скалу
      if (dx && dy && (!walkable(this.map.tiles[cy * w + nx]) || !walkable(this.map.tiles[ny * w + cx]))) continue;
      const d = flow[ny * w + nx];
      if (d < bestD) { bestD = d; best = [nx, ny]; }
    }
    if (!best) return;
    // Если в следующей клетке вражеская постройка — атакуем её (прогрызаем путь).
    const bId = this.buildGrid[best[1] * this.map.w + best[0]];
    if (bId >= 0) {
      const b = this.buildings.find(x => x.id === bId);
      if (b && b.owner !== u.owner) { this.tryAttackBuilding(u, spec, b); return; }
    }
    this.moveToward(u, spec, best[0] + 0.5, best[1] + 0.5);
  }

  moveToward(u, spec, tx, ty) {
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) return;
    let speed = spec.speed;
    const tile = this.map.tiles[this.gi(Math.floor(u.x), Math.floor(u.y))];
    if (tile === T.FOREST) speed *= FOREST_SPEED;
    if (this.time < u.slowUntil) speed *= (1 - u.slowFactor);
    const step = Math.min(d, speed * this.dt);
    let nx = u.x + (dx / d) * step;
    let ny = u.y + (dy / d) * step;
    // Не заходим в непроходимые тайлы.
    if (this.inBounds(Math.floor(nx), Math.floor(u.y)) && walkable(this.map.tiles[this.gi(Math.floor(nx), Math.floor(u.y))])) u.x = nx;
    if (this.inBounds(Math.floor(u.x), Math.floor(ny)) && walkable(this.map.tiles[this.gi(Math.floor(u.x), Math.floor(ny))])) u.y = ny;
    u.dir = Math.atan2(dy, dx);
    // Лёгкое расталкивание, чтобы юниты не сливались в точку.
    for (const o of this.units) {
      if (o === u || o.hp <= 0) continue;
      const ox = u.x - o.x, oy = u.y - o.y;
      const od = Math.hypot(ox, oy);
      if (od > 0.001 && od < 0.55) {
        u.x += (ox / od) * 0.03;
        u.y += (oy / od) * 0.03;
      }
    }
  }

  updateBuildings() {
    for (const b of this.buildings) {
      const spec = this.balance.buildings[b.type];
      if (spec.kind !== 'defense' || !spec.dmg) continue;
      b.cd = Math.max(0, b.cd - this.dt);
      if (b.cd > 0) continue;
      const bx = b.cx + 0.5, by = b.cy + 0.5;
      let target = null, bestD = Infinity;
      for (const u of this.units) {
        if (u.owner === b.owner || u.hp <= 0) continue;
        const d = Math.hypot(u.x - bx, u.y - by);
        if (d <= spec.range && d < bestD) { bestD = d; target = u; }
      }
      if (!target) continue;
      b.cd = 1 / spec.attackRate;
      if (spec.splash) {
        this.events.push({ t: 'proj', x1: bx, y1: by, x2: target.x, y2: target.y, k: 'shell' });
        this.events.push({ t: 'boom', x: target.x, y: target.y, r: spec.splash });
        for (const u of this.units) {
          if (u.owner === b.owner || u.hp <= 0) continue;
          if (Math.hypot(u.x - target.x, u.y - target.y) <= spec.splash) {
            this.damageUnit(u, spec.dmg, b.owner);
          }
        }
      } else if (spec.slowFactor) {
        this.events.push({ t: 'frost', x: bx, y: by, r: spec.range });
        for (const u of this.units) {
          if (u.owner === b.owner || u.hp <= 0) continue;
          if (Math.hypot(u.x - bx, u.y - by) <= spec.range) {
            u.slowUntil = this.time + spec.slowDuration;
            u.slowFactor = spec.slowFactor;
            this.damageUnit(u, spec.dmg, b.owner);
          }
        }
      } else {
        this.events.push({ t: 'proj', x1: bx, y1: by, x2: target.x, y2: target.y, k: 'arrow' });
        this.damageUnit(target, spec.dmg, b.owner);
      }
    }
    this.reapDead();
  }

  damageUnit(u, dmg, bySlot) {
    const spec = this.balance.units[u.type];
    u.hp -= Math.max(1, dmg - (spec.armor || 0));
    if (u.hp <= 0) {
      this.players[bySlot].unitsKilled++;
      this.players[u.owner].unitsLost++;
      this.events.push({ t: 'die', x: u.x, y: u.y, u: u.type, owner: u.owner });
    }
  }

  reapDead() {
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].hp <= 0) this.units.splice(i, 1);
    }
  }

  checkEnd() {
    const [a, b] = this.players;
    if (a.baseHp <= 0 || b.baseHp <= 0) {
      // Если обе базы упали в один тик (sudden death) — побеждает та, что «менее мертва».
      if (a.baseHp <= 0 && b.baseHp <= 0) {
        const winner = this.tiebreak(a, b);
        a.baseHp = 0; b.baseHp = 0;
        this.finish(winner, winner === null ? 'draw' : 'base');
        return;
      }
      const loser = a.baseHp <= 0 ? a : b;
      loser.baseHp = 0;
      this.finish(1 - loser.slot, 'base');
      return;
    }
    if (this.time >= this.balance.match.hardLimitSec) {
      const winner = this.tiebreak(a, b);
      this.finish(winner, winner === null ? 'draw' : 'timeout');
    }
  }

  // Тайбрейк: HP базы, затем счёт убийств, затем нанесённый экономический урон.
  tiebreak(a, b) {
    if (Math.abs(a.baseHp - b.baseHp) >= 1) return a.baseHp > b.baseHp ? 0 : 1;
    if (a.unitsKilled !== b.unitsKilled) return a.unitsKilled > b.unitsKilled ? 0 : 1;
    if (a.goldEarned !== b.goldEarned) return a.goldEarned > b.goldEarned ? 0 : 1;
    return null;
  }

  finish(winner, reason) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.endReason = reason;
    this.events.push({ t: 'gameover', winner, reason });
  }

  // ---------- Снапшот для клиента ----------
  snapshot() {
    const ev = this.events;
    this.events = [];
    return {
      tick: this.tick,
      time: Math.round(this.time * 10) / 10,
      sd: this.time >= this.balance.match.suddenDeathAtSec,
      players: this.players.map(p => ({
        slot: p.slot, name: p.name, isBot: p.isBot,
        gold: Math.floor(p.gold), income: p.income,
        baseHp: Math.max(0, Math.round(p.baseHp)), baseHpMax: p.baseHpMax,
        kills: p.unitsKilled, losses: p.unitsLost,
      })),
      units: this.units.map(u => [
        u.id, u.owner, u.type,
        Math.round(u.x * 100) / 100, Math.round(u.y * 100) / 100,
        Math.round((u.hp / u.hpMax) * 100), Math.round(u.dir * 100) / 100,
        this.time < u.slowUntil ? 1 : 0,
      ]),
      buildings: this.buildings.map(b => [
        b.id, b.owner, b.type, b.cx, b.cy, Math.round((b.hp / b.hpMax) * 100),
      ]),
      events: ev,
      over: this.over, winner: this.winner, reason: this.endReason,
    };
  }

  // Стартовые данные (карта и т.п.) — шлются один раз.
  initData(slot) {
    return {
      matchId: this.id,
      yourSlot: slot,
      map: { w: this.map.w, h: this.map.h, tiles: Array.from(this.map.tiles), bases: this.map.bases, seed: this.map.seed },
      balance: { units: this.balance.units, buildings: this.balance.buildings, economy: this.balance.economy, match: this.balance.match },
      players: this.players.map(p => ({ slot: p.slot, name: p.name, isBot: p.isBot })),
    };
  }
}

module.exports = { Match, UNIT_CAP };
