'use strict';
// Бот-противник средней сложности для раундового режима.
// В фазе планирования: экономика -> оборона узких мест -> очередь волны.
// В фазе боя действовать нельзя — бот «смотрит» и собирает разведданные
// (сколько врагов дошло до его половины, сколько HP базы потеряно),
// чтобы в следующем раунде скорректировать план.
// «Средний» уровень: паузы между действиями и шанс ошибки (пропуска хода).
const { T, walkable } = require('./mapgen');

class Bot {
  constructor(match, slot) {
    this.match = match;
    this.slot = slot;
    this.cfg = match.balance.bot;
    this.actionTimer = 1.0;
    this.plannedRound = 0;      // раунд, для которого уже запланирована волна
    this.wavesQueued = 0;
    this.buildSpots = this.findBuildSpots();
    this.chokeSpots = this.findChokeSpots();
    // Разведка прошлого боя.
    this.intel = { incursion: 0, hpAtBattleStart: match.players[slot].baseHp, hpLostLastBattle: 0 };
  }

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

  // Узкие места: мало проходимых соседей + ближе к середине карты.
  findChokeSpots() {
    const m = this.match, map = m.map;
    const scored = [];
    for (const s of this.buildSpots) {
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const t = map.tiles[(s.y + dy) * map.w + (s.x + dx)];
        if (walkable(t)) open++;
      }
      const midDist = Math.abs(s.x - map.w / 2);
      scored.push({ ...s, score: open + midDist * 0.35 });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored;
  }

  update(dt) {
    const m = this.match;
    if (m.over) return;

    if (m.phase === 'battle') {
      // Разведка: считаем максимум вражеских юнитов на нашей половине за бой.
      const half = m.map.w / 2;
      let n = 0;
      for (const u of m.units) {
        if (u.owner === this.slot) continue;
        if (this.slot === 0 ? u.x < half : u.x >= half) n++;
      }
      this.intel.incursion = Math.max(this.intel.incursion, n);
      return;
    }

    // Фаза планирования.
    if (this.plannedRound !== m.round) {
      // Начало нового раунда: фиксируем потери прошлого боя, сбрасываем счётчики.
      const me = m.players[this.slot];
      this.intel.hpLostLastBattle = Math.max(0, this.intel.hpAtBattleStart - me.baseHp);
      this.intel.hpAtBattleStart = me.baseHp;
      this.plannedRound = m.round;
      this.waveDone = false;
      this.actionTimer = 0.6 + Math.random() * 0.8;
    }

    this.actionTimer -= dt;
    if (this.actionTimer > 0) return;
    this.actionTimer = this.cfg.actionIntervalSec * (0.55 + Math.random() * 0.5);
    // Шанс «ошибки» — бот просто пропускает ход, чтобы ощущаться человечнее.
    if (Math.random() < this.cfg.mistakeChance) return;
    this.think();

    // Волну ставим ближе к концу планирования, когда экономика раунда уже потрачена.
    if (!this.waveDone && m.planLeft < (m.balance.match.planPhaseSec ?? 20) * 0.45) {
      this.queueWave();
      this.waveDone = true;
    }
  }

  me() { return this.match.players[this.slot]; }

  myBuildings(type) {
    return this.match.buildings.filter(b => b.owner === this.slot && (!type || b.type === type));
  }

  think() {
    const m = this.match;
    const p = this.me();

    // 1. Реакция на прошлый бой: нас продавили — усиливаем оборону.
    const pressured = this.intel.hpLostLastBattle > 0 || this.intel.incursion >= this.cfg.defendThreshold;
    if (pressured && Math.random() < 0.7) {
      this.intel.incursion = Math.max(0, this.intel.incursion - 3);
      if (this.growDefense()) return;
    }

    // 2. Ранний приоритет: хотя бы одна башня в первые раунды.
    const defTowers = this.myBuildings().filter(b => m.balance.buildings[b.type].kind === 'defense' && b.type !== 'barricade').length;
    if (m.round <= 3 && defTowers === 0 && p.gold >= m.balance.buildings.arrow.cost) {
      this.placeChoke('arrow');
      return;
    }

    // 3. Экономика или оборона по фазе игры.
    const phase = Math.min(1, m.time / 300);
    const ecoWeight = this.cfg.ecoWeightEarly * (1 - phase) + this.cfg.ecoWeightLate * phase;
    if (Math.random() < ecoWeight) this.growEconomy();
    else this.growDefense();
  }

  growEconomy() {
    const m = this.match, p = this.me();
    const mines = this.myBuildings('mine').length;
    const banks = this.myBuildings('bank').length;
    const bankSpec = m.balance.buildings.bank;
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
    // Иногда — баррикада, чтобы перекроить пути (в т.ч. и свои: бот про это знает
    // и ставит их сбоку от прямой линии на свою базу).
    if (towers.length >= 2 && roll > 0.85) type = 'barricade';
    const spec = m.balance.buildings[type];
    if (p.gold < spec.cost) return false;
    return this.placeChoke(type);
  }

  queueWave() {
    const m = this.match, p = this.me();
    this.wavesQueued++;
    // Бюджет волны растёт от раунда к раунду; на старте бот скромнее.
    const share = Math.min(0.8, 0.35 + this.wavesQueued * 0.05);
    let budget = p.gold * share;
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
    while (budget >= m.balance.units.scout.cost && p.gold >= m.balance.units.scout.cost) {
      if (!m.spawnUnits(this.slot, 'scout').ok) break;
      budget -= m.balance.units.scout.cost;
    }
  }

  placeSafe(type) {
    const m = this.match;
    for (const s of this.buildSpots) {
      if (s.d > 10) break;
      if (m.buildGrid[s.y * m.map.w + s.x] >= 0) continue;
      if (m.build(this.slot, type, s.x, s.y).ok) return true;
    }
    for (const s of this.buildSpots) {
      if (m.buildGrid[s.y * m.map.w + s.x] >= 0) continue;
      if (m.build(this.slot, type, s.x, s.y).ok) return true;
    }
    return false;
  }

  placeChoke(type) {
    const m = this.match;
    const base = m.map.bases[this.slot];
    for (const s of this.chokeSpots) {
      if (m.buildGrid[s.y * m.map.w + s.x] >= 0) continue;
      if (Math.random() < 0.35) continue;
      // Баррикаду не ставим на прямой линии базы, чтобы не запереть свои волны.
      if (type === 'barricade' && Math.abs(s.y - base.y) < 3) continue;
      if (m.build(this.slot, type, s.x, s.y).ok) return true;
    }
    return this.placeSafe(type === 'barricade' ? 'arrow' : type);
  }
}

module.exports = { Bot };
