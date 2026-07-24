'use strict';
// Бот-противник средней сложности для режима «коридор в горах».
//
// Что делает его «умным, но не слишком»:
//  - анализирует карту: считает, сколько клеток коридора простреливает каждая
//    горная клетка, и ставит башни в изгибах (лучшие точки покрытия),
//    но выбирает случайно из топа, а не строго оптимально;
//  - собирает разведку между раундами (потери базы, прорывы, пробил ли он сам
//    оборону) и корректирует состав волн: не пробил дважды — копит на тяжёлый кулак;
//  - резервирует ~45% золота раунда под армию — не уходит в глухую оборону;
//  - действует с паузами и с шансом «ошибки» (пропуск хода) — оставляет игроку окна.
const { T, walkable } = require('./mapgen');

const TOWER_RANGE_EST = 3.6; // оценочный радиус для расчёта покрытия коридора

class Bot {
  constructor(match, slot) {
    this.match = match;
    this.slot = slot;
    this.cfg = match.balance.bot;
    this.actionTimer = 1.0;
    this.plannedRound = 0;
    this.wavesQueued = 0;
    this.analyzeMap();
    // Разведка.
    this.intel = { incursion: 0, hpLostLastBattle: 0, dealtLastBattle: 0 };
    this.battleSnap = null;   // {myHp, foeHp, t} на момент начала боя
    this.stuckRounds = 0;     // подряд раундов без урона по вражеской базе
    this.savingPunch = false; // копим золото на тяжёлую волну
    this.reserve = 0;
  }

  // ---------- Анализ карты ----------
  // Для каждой горной клетки своей половины считаем покрытие: сколько клеток
  // коридора попадает в радиус башни. Изгибы змейки дают лучшие точки.
  analyzeMap() {
    const m = this.match, map = m.map;
    const base = map.bases[this.slot];
    const half = map.w / 2;
    const corridor = [];
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (walkable(map.tiles[y * map.w + x])) corridor.push({ x, y });
    }
    this.spots = [];
    for (let y = 1; y < map.h - 1; y++) {
      for (let x = 1; x < map.w - 1; x++) {
        if (this.slot === 0 ? x >= half : x < half) continue;
        if (map.tiles[y * map.w + x] !== T.ROCK) continue;
        let coverage = 0;
        for (const c of corridor) {
          const d = Math.hypot(c.x - x, c.y - y);
          if (d <= TOWER_RANGE_EST) coverage++;
        }
        this.spots.push({ x, y, coverage, dBase: Math.hypot(x - base.x, y - base.y) });
      }
    }
    // Боевые точки: хорошее покрытие, ближе к своей базе — надёжнее.
    this.towerSpots = this.spots
      .filter(s => s.coverage >= 6)
      .sort((a, b) => (b.coverage - b.dBase * 0.35) - (a.coverage - a.dBase * 0.35));
    // Экономика — подальше от коридора (координаты всё равно безопасны, но так красивее).
    this.ecoSpots = [...this.spots].sort((a, b) => (a.dBase + a.coverage * 0.3) - (b.dBase + b.coverage * 0.3));
  }

  me() { return this.match.players[this.slot]; }
  foe() { return this.match.players[1 - this.slot]; }
  canSpend(cost) { return this.me().gold - cost >= this.reserve; }

  myBuildings(type) {
    return this.match.buildings.filter(b => b.owner === this.slot && (!type || b.type === type));
  }

  isFree(s) { return this.match.buildGrid[s.y * this.match.map.w + s.x] < 0; }

  // ---------- Главный цикл ----------
  update(dt) {
    const m = this.match;
    if (m.over) return;

    if (m.phase === 'battle') {
      if (!this.battleSnap) this.battleSnap = { myHp: this.me().baseHp, foeHp: this.foe().baseHp, t: m.time };
      const half = m.map.w / 2;
      let n = 0;
      for (const u of m.units) {
        if (u.owner === this.slot) continue;
        if (this.slot === 0 ? u.x < half : u.x >= half) n++;
      }
      this.intel.incursion = Math.max(this.intel.incursion, n);
      return;
    }

    if (this.plannedRound !== m.round) this.startRound();

    this.actionTimer -= dt;
    if (this.actionTimer > 0) return;
    this.actionTimer = this.cfg.actionIntervalSec * (0.55 + Math.random() * 0.5);
    if (Math.random() < this.cfg.mistakeChance) return;
    this.think();

    if (!this.waveDone && m.planLeft < (m.balance.match.planPhaseSec ?? 20) * 0.45) {
      this.queueWave();
      this.waveDone = true;
    }
  }

  startRound() {
    const m = this.match;
    const me = this.me();
    // Итоги прошлого боя (без учёта распада sudden death).
    if (this.battleSnap) {
      const mc = m.balance.match;
      const decay = m.time > mc.suddenDeathAtSec ? (mc.suddenDeathDecayPerSec ?? 0) * (m.time - this.battleSnap.t) : 0;
      this.intel.hpLostLastBattle = Math.max(0, this.battleSnap.myHp - me.baseHp - decay);
      this.intel.dealtLastBattle = Math.max(0, this.battleSnap.foeHp - this.foe().baseHp - decay);
      this.battleSnap = null;
      // Наши волны дважды разбились об оборону без урона базе? Копим кулак.
      if (this.wavesQueued > 0 && this.intel.dealtLastBattle < 30) this.stuckRounds++;
      else this.stuckRounds = 0;
      if (this.stuckRounds >= 2 && !this.savingPunch && Math.random() < 0.75) {
        this.savingPunch = true;
        this.stuckRounds = 0;
      }
    }
    this.plannedRound = m.round;
    this.waveDone = false;
    // Резерв под армию растёт с раундами: ранний бот вкладывается в экономику
    // (шахты окупаются меньше чем за раунд), поздний — фондирует крупные волны.
    const investPhase = Math.min(1, (m.round - 1) / 7);
    this.reserve = me.gold * (0.18 + investPhase * 0.4);
  }

  // Сколько шахт хотим к этому раунду (растёт, но с потолком).
  desiredMines() { return Math.min(9, 2 + this.match.round); }

  think() {
    const m = this.match;
    const mines = this.myBuildings('mine').length;
    const banks = this.myBuildings('bank').length;
    const bankSpec = m.balance.buildings.bank;
    const defTowers = this.myBuildings().filter(b => m.balance.buildings[b.type].kind === 'defense').length;

    // 1. Экономическая база — высший приоритет, пока шахт меньше цели.
    // Экономика окупается быстро, поэтому даже слегка залезаем в резерв.
    if (mines < this.desiredMines() && this.me().gold >= m.balance.buildings.mine.cost * 1.1) {
      if (this.placeEco('mine')) return;
    }

    // 2. Нас бьют — усиливаем оборону.
    const pressured = this.intel.hpLostLastBattle > 0 || this.intel.incursion >= this.cfg.defendThreshold;
    if (pressured && Math.random() < 0.7) {
      this.intel.incursion = Math.max(0, this.intel.incursion - 3);
      if (this.growDefense()) return;
    }

    // 3. Ранняя первая башня.
    if (m.round <= 3 && defTowers === 0 && this.canSpend(m.balance.buildings.arrow.cost)) {
      this.placeTower('arrow');
      return;
    }

    // 4. Банк, когда экономика уже развёрнута — множитель окупается на большом доходе.
    if (mines >= 3 && banks < (bankSpec.maxCount || 5) && this.canSpend(bankSpec.cost) && Math.random() < 0.5) {
      if (this.placeEco('bank')) return;
    }

    // 5. Экономика или оборона по фазе игры.
    const phase = Math.min(1, m.time / 300);
    const ecoWeight = this.cfg.ecoWeightEarly * (1 - phase) + this.cfg.ecoWeightLate * phase;
    if (Math.random() < ecoWeight) this.growEconomy();
    else this.growDefense();
  }

  growEconomy() {
    const m = this.match;
    const mines = this.myBuildings('mine').length;
    const banks = this.myBuildings('bank').length;
    const bankSpec = m.balance.buildings.bank;
    if (mines >= 3 && banks < (bankSpec.maxCount || 5) && this.canSpend(bankSpec.cost)) {
      this.placeEco('bank');
      return;
    }
    if (this.canSpend(m.balance.buildings.mine.cost)) this.placeEco('mine');
  }

  growDefense() {
    const m = this.match;
    const towers = this.myBuildings().filter(b => m.balance.buildings[b.type].kind === 'defense');
    const roll = Math.random();
    let type = 'arrow';
    if (towers.length >= 2 && roll < 0.3) type = 'cannon';
    else if (towers.length >= 1 && roll < 0.5) type = 'frost';
    const spec = m.balance.buildings[type];
    if (!this.canSpend(spec.cost)) return false;
    return this.placeTower(type);
  }

  // Башня: лучшие точки покрытия + бонус за кластер (замедление + сплэш рядом = зона смерти).
  // Выбор случайный из топ-4 — сильно, но не идеально.
  placeTower(type) {
    const m = this.match;
    const candidates = this.towerSpots.filter(s => this.isFree(s)).slice(0, 12);
    if (!candidates.length) return this.placeEco(type);
    const myDef = this.myBuildings().filter(b => m.balance.buildings[b.type].kind === 'defense');
    const scored = candidates.map(s => {
      let cluster = 0;
      for (const b of myDef) {
        if (Math.hypot(b.cx - s.x, b.cy - s.y) <= 2.5) cluster++;
      }
      return { s, score: s.coverage + cluster * 3 };
    }).sort((a, b) => b.score - a.score);
    const pick = scored[Math.floor(Math.random() * Math.min(4, scored.length))].s;
    return m.build(this.slot, type, pick.x, pick.y).ok;
  }

  placeEco(type) {
    const m = this.match;
    for (const s of this.ecoSpots) {
      if (!this.isFree(s)) continue;
      if (m.build(this.slot, type, s.x, s.y).ok) return true;
    }
    return false;
  }

  // ---------- Волны ----------
  queueWave() {
    const m = this.match, p = this.me();

    // Копим кулак: пропускаем волну, золото переходит на следующий раунд.
    if (this.savingPunch && this.wavesQueued > 0) {
      this.savingPunch = false;
      this.punchNext = true;
      return;
    }

    this.wavesQueued++;
    this.reserve = 0;
    let budget = p.gold * (this.punchNext ? 0.95 : 0.8 + Math.min(0.15, this.wavesQueued * 0.02));

    const late = m.time > 300;
    let comps;
    if (this.punchNext) {
      // Тяжёлый кулак: танки держат урон башен, целители тянут, разрушители ломают.
      comps = [['tank', 'tank', 'healer', 'breaker', 'breaker'], ['tank', 'healer', 'breaker', 'soldier', 'soldier']];
      this.punchNext = false;
    } else if (late) {
      comps = [['tank', 'healer', 'soldier', 'breaker'], ['breaker', 'breaker', 'soldier', 'archer'], ['tank', 'archer', 'archer', 'healer']];
    } else {
      comps = [['soldier', 'scout'], ['soldier', 'archer'], ['scout', 'scout', 'soldier'], ['soldier', 'soldier']];
    }
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
}

module.exports = { Bot };
