'use strict';
// Бот-противник средней сложности.
// Стратегия: ранняя экономика -> оборона узких мест -> волны атак, растущие со временем.
// «Средний» уровень достигается паузами между действиями и шансом ошибки (пропуска хода).
const { T, walkable } = require('./mapgen');

class Bot {
  constructor(match, slot) {
    this.match = match;
    this.slot = slot;
    this.cfg = match.balance.bot;
    this.actionTimer = 1.5;
    this.attackTimer = this.randRange(this.cfg.attackIntervalSec) * 0.6; // первая волна чуть раньше
    this.wave = 0;
    this.buildSpots = this.findBuildSpots();
    this.chokeSpots = this.findChokeSpots();
  }

  randRange([a, b]) { return a + Math.random() * (b - a); }

  // Клетки своей половины, пригодные для застройки, отсортированные по близости к базе.
  findBuildSpots() {
    const m = this.match, map = m.map;
    const base = map.bases[this.slot];
    const spots = [];
    const half = map.w / 2;
    for (let y = 1; y < map.h - 1; y++) {
      for (let x = 1; x < map.w - 1; x++) {
        if (this.slot === 0 ? x >= half : x < half) continue;
        if (map.tiles[y * map.w + x] !== T.GROUND) continue;
        if (x === base.x && y === base.y) continue;
        spots.push({ x, y, d: Math.hypot(x - base.x, y - base.y) });
      }
    }
    spots.sort((a, b) => a.d - b.d);
    return spots;
  }

  // Узкие места: проходимые клетки своей половины, у которых мало проходимых соседей —
  // там башня перекрывает максимум трафика.
  findChokeSpots() {
    const m = this.match, map = m.map;
    const scored = [];
    for (const s of this.buildSpots) {
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const t = map.tiles[(s.y + dy) * map.w + (s.x + dx)];
        if (walkable(t)) open++;
      }
      // Ближе к середине карты и в узком месте — лучше.
      const midDist = Math.abs(s.x - map.w / 2);
      scored.push({ ...s, score: open + midDist * 0.35 });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored;
  }

  update(dt) {
    const m = this.match;
    if (m.over) return;
    this.actionTimer -= dt;
    this.attackTimer -= dt;

    if (this.actionTimer <= 0) {
      this.actionTimer = this.cfg.actionIntervalSec * (0.7 + Math.random() * 0.6);
      // Шанс «ошибки» — бот просто пропускает ход. Так он ощущается человечнее.
      if (Math.random() > this.cfg.mistakeChance) this.think();
    }
    if (this.attackTimer <= 0) {
      this.attackTimer = this.randRange(this.cfg.attackIntervalSec) / Math.pow(this.cfg.aggressionRamp, this.wave * 0.4);
      this.launchWave();
    }
  }

  me() { return this.match.players[this.slot]; }

  myBuildings(type) {
    return this.match.buildings.filter(b => b.owner === this.slot && (!type || b.type === type));
  }

  incomingThreat() {
    // Сколько вражеских юнитов на нашей половине.
    const half = this.match.map.w / 2;
    let n = 0;
    for (const u of this.match.units) {
      if (u.owner === this.slot) continue;
      if (this.slot === 0 ? u.x < half : u.x >= half) n++;
    }
    return n;
  }

  think() {
    const m = this.match;
    const p = this.me();
    const threat = this.incomingThreat();

    // 1. Срочная оборона: враг у ворот.
    if (threat >= this.cfg.defendThreshold) {
      // Сначала живая сила: свои юниты у базы перехватывают волну.
      const defenders = m.units.filter(u => {
        if (u.owner !== this.slot) return false;
        const half = m.map.w / 2;
        return this.slot === 0 ? u.x < half : u.x >= half;
      }).length;
      if (defenders < threat && p.gold >= m.balance.units.soldier.cost) {
        m.spawnUnits(this.slot, Math.random() < 0.4 ? 'archer' : 'soldier');
        return;
      }
      if (this.defendNow()) return;
    }

    // 2. Ранний приоритет: хотя бы одна защитная башня в первые минуты.
    const defTowers = this.myBuildings().filter(b => m.balance.buildings[b.type].kind === 'defense' && b.type !== 'barricade').length;
    if (m.time < 120 && defTowers === 0 && p.gold >= m.balance.buildings.arrow.cost) {
      this.placeChoke('arrow');
      return;
    }

    // 3. Экономика или оборона по фазе игры.
    const phase = Math.min(1, m.time / 300); // 0 в начале, 1 после 5 минут
    const ecoWeight = this.cfg.ecoWeightEarly * (1 - phase) + this.cfg.ecoWeightLate * phase;
    if (Math.random() < ecoWeight) {
      this.growEconomy();
    } else {
      this.growDefense();
    }
  }

  growEconomy() {
    const m = this.match, p = this.me();
    const mines = this.myBuildings('mine').length;
    const banks = this.myBuildings('bank').length;
    const bankSpec = m.balance.buildings.bank;
    // Банк выгоден, когда доход уже высок.
    if (mines >= 4 && banks < (bankSpec.maxCount || 5) && p.gold >= bankSpec.cost * 1.2) {
      this.placeSafe('bank');
      return;
    }
    if (p.gold >= m.balance.buildings.mine.cost) this.placeSafe('mine');
  }

  growDefense() {
    const m = this.match, p = this.me();
    const towers = this.myBuildings().filter(b => m.balance.buildings[b.type].kind === 'defense');
    const roll = Math.random();
    let type = 'arrow';
    if (towers.length >= 2 && roll < 0.3) type = 'cannon';
    else if (towers.length >= 1 && roll < 0.5) type = 'frost';
    const spec = m.balance.buildings[type];
    if (p.gold < spec.cost) return;
    this.placeChoke(type);
  }

  defendNow() {
    const m = this.match, p = this.me();
    // Башня рядом с ближайшим врагом на нашей территории.
    const half = m.map.w / 2;
    let closest = null, bd = Infinity;
    const base = m.map.bases[this.slot];
    for (const u of m.units) {
      if (u.owner === this.slot) continue;
      if (this.slot === 0 ? u.x >= half : u.x < half) continue;
      const d = Math.hypot(u.x - base.x, u.y - base.y);
      if (d < bd) { bd = d; closest = u; }
    }
    if (!closest) return false;
    const type = p.gold >= m.balance.buildings.cannon.cost && Math.random() < 0.4 ? 'cannon' : 'arrow';
    if (p.gold < m.balance.buildings[type].cost) return false;
    // Ищем свободную клетку между врагом и базой.
    const spots = this.buildSpots
      .filter(s => m.buildGrid[s.y * m.map.w + s.x] < 0)
      .map(s => ({ ...s, ed: Math.hypot(s.x - closest.x, s.y - closest.y) }))
      .filter(s => s.ed > 1.5 && s.ed < 6)
      .sort((a, b) => a.ed - b.ed);
    for (const s of spots.slice(0, 8)) {
      if (m.build(this.slot, type, s.x, s.y).ok) return true;
    }
    return false;
  }

  placeSafe(type) {
    // Экономика — поближе к базе, подальше от передовой.
    const m = this.match;
    for (const s of this.buildSpots) {
      if (s.d > 10) break;
      if (m.buildGrid[s.y * m.map.w + s.x] >= 0) continue;
      if (m.build(this.slot, type, s.x, s.y).ok) return true;
    }
    // Всё занято у базы — берём любую клетку.
    for (const s of this.buildSpots) {
      if (m.buildGrid[s.y * m.map.w + s.x] >= 0) continue;
      if (m.build(this.slot, type, s.x, s.y).ok) return true;
    }
    return false;
  }

  placeChoke(type) {
    const m = this.match;
    for (const s of this.chokeSpots) {
      if (m.buildGrid[s.y * m.map.w + s.x] >= 0) continue;
      // Немного рандома, чтобы башни не вставали всегда в одни и те же точки.
      if (Math.random() < 0.35) continue;
      if (m.build(this.slot, type, s.x, s.y).ok) return true;
    }
    return this.placeSafe(type);
  }

  launchWave() {
    const m = this.match, p = this.me();
    this.wave++;
    // Состав волны зависит от фазы игры и бюджета: ранние волны скромнее.
    const budgetShare = 0.38 + Math.min(0.42, this.wave * 0.045);
    let budget = p.gold * budgetShare;
    const late = m.time > 300;
    const comps = late
      ? [['tank', 'healer', 'soldier', 'breaker'], ['breaker', 'breaker', 'soldier', 'archer'], ['tank', 'archer', 'archer', 'healer']]
      : [['soldier', 'scout'], ['soldier', 'archer'], ['scout', 'scout', 'soldier'], ['soldier', 'soldier']];
    const comp = comps[Math.floor(Math.random() * comps.length)];
    for (const type of comp) {
      const cost = m.balance.units[type].cost;
      if (budget < cost || p.gold < cost) continue;
      if (m.spawnUnits(this.slot, type).ok) budget -= cost;
    }
    // Остаток бюджета — в дешёвых юнитов.
    while (budget >= m.balance.units.scout.cost && p.gold >= m.balance.units.scout.cost) {
      if (!m.spawnUnits(this.slot, 'scout').ok) break;
      budget -= m.balance.units.scout.cost;
    }
  }
}

module.exports = { Bot };
