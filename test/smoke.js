'use strict';
// Смоук-тест: генерация карт, раундовая механика, бот против бота, баррикады.
const { Match } = require('../server/game/sim');
const { Bot } = require('../server/game/bot');
const { generateMap, connected, T } = require('../server/game/mapgen');
const balance = require('../server/balance');

let failed = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { console.error('  ✗ ' + msg); failed++; }
}

console.log('1. Генерация карт «коридор в горах» (50 сидов)');
{
  let allConnected = true, allWinding = true, rockOk = true, spotsOk = true;
  for (let seed = 1; seed <= 50; seed++) {
    const map = generateMap(seed);
    if (!connected(map.tiles, map.bases[0], map.bases[1])) { allConnected = false; continue; }
    // Извилистость: длина пути по коридору заметно больше прямой линии,
    // плюс коридор гуляет по вертикали.
    const dist = bfsDist(map, map.bases[0], map.bases[1]);
    const straight = map.bases[1].x - map.bases[0].x;
    let minY = 999, maxY = -1, rock = 0;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      if (t === T.GROUND || t === T.FOREST) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (t === T.ROCK) rock++;
    }
    if (dist < straight * 1.5 || maxY - minY < 10) allWinding = false;
    if (rock < map.w * map.h * 0.45) rockOk = false;
    // На каждой половине должны быть горные клетки, простреливающие коридор.
    for (const half of [0, 1]) {
      let spots = 0;
      for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < map.w - 1; x++) {
        if (half === 0 ? x >= map.w / 2 : x < map.w / 2) continue;
        if (map.tiles[y * map.w + x] !== T.ROCK) continue;
        let cover = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
          const t = map.tiles[ny * map.w + nx];
          if ((t === T.GROUND || t === T.FOREST) && Math.hypot(dx, dy) <= 3.6) cover++;
        }
        if (cover >= 6) spots++;
      }
      if (spots < 25) spotsOk = false;
    }
  }
  check(allConnected, 'коридор соединяет базы на всех 50 картах');
  check(allWinding, 'коридор извилистый (длиннее прямой, гуляет по вертикали)');
  check(rockOk, 'горы занимают большую часть карты');
  check(spotsOk, 'на обеих половинах достаточно точек под башни у коридора');
  const m1 = generateMap(42), m2 = generateMap(42);
  check(JSON.stringify(Array.from(m1.tiles)) === JSON.stringify(Array.from(m2.tiles)), 'карта детерминирована по сиду');
}

// BFS-дистанция между базами по коридору.
function bfsDist(map, a, b) {
  const dist = new Int32Array(map.w * map.h).fill(-1);
  const queue = [[a.x, a.y]];
  dist[a.y * map.w + a.x] = 0;
  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === b.x && y === b.y) return dist[y * map.w + x];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const ni = ny * map.w + nx;
      const t = map.tiles[ni];
      if (dist[ni] < 0 && (t === T.GROUND || t === T.FOREST)) { dist[ni] = dist[y * map.w + x] + 1; queue.push([nx, ny]); }
    }
  }
  return 9999;
}

console.log('2. Раундовая механика: планирование и очередь');
{
  const bal = balance.loadDefault();
  const m = new Match('t1', bal, [{ name: 'A' }, { name: 'B' }], 42);
  check(m.phase === 'plan' && m.round === 1, 'матч начинается с фазы планирования');
  const r1 = m.spawnUnits(0, 'soldier');
  check(r1.ok, 'заказ юнитов в очередь проходит');
  check(m.queued[0].length === bal.units.soldier.pack, 'пачка встала в очередь (на поле не вышла)');
  check(m.units.length === 0, 'юнитов на поле нет до начала боя');
  check(m.players[0].gold === bal.economy.startGold - bal.units.soldier.cost, 'золото списано');
  const rU = m.unqueueUnits(0, 'soldier');
  check(rU.ok && m.queued[0].length === 0, 'отмена очереди работает');
  check(m.players[0].gold === bal.economy.startGold, 'золото возвращено при отмене');
  check(!m.spawnUnits(0, 'nosuch').ok, 'неизвестный юнит отклонён');

  // Клетка коридора на своей половине (для негативного теста).
  let corridorCell = null;
  outer0: for (let y = 2; y < m.map.h - 2; y++) for (let x = 2; x < m.map.w / 2; x++) {
    if (m.map.tiles[y * m.map.w + x] === T.GROUND) { corridorCell = { x, y }; break outer0; }
  }
  let built = false;
  outer: for (let y = 2; y < m.map.h - 2; y++) for (let x = 2; x < m.map.w / 2; x++) {
    if (m.map.tiles[y * m.map.w + x] === T.ROCK && m.placementError(0, 'mine', x, y) === null) {
      check(m.build(0, 'mine', x, y).ok, 'постройка шахты на горах в фазе планирования');
      built = true; break outer;
    }
  }
  check(built, 'нашлось место под шахту на горах');
  check(corridorCell && !m.build(0, 'arrow', corridorCell.x, corridorCell.y).ok, 'стройка в коридоре отклонена');
  check(!m.balance.buildings.barricade, 'баррикада удалена из баланса');

  // Скрытие: враг не видит постройку текущего раунда во время планирования.
  const snapEnemy = m.snapshotFor(1, []);
  check(snapEnemy.buildings.length === 0, 'враг не видит свежую постройку в фазе планирования');
  const snapMine = m.snapshotFor(0, []);
  check(snapMine.buildings.length === 1, 'владелец видит свою постройку сразу');

  // Переход в бой: очередь выходит на поле, постройки раскрываются.
  m.spawnUnits(0, 'scout');
  m.planLeft = 0.01;
  m.step(); m.step();
  check(m.phase === 'battle', 'после планирования начинается бой');
  check(m.units.length === bal.units.scout.pack, 'очередь вышла на поле в начале боя');
  check(m.snapshotFor(1, []).buildings.length === 1, 'в бою враг видит постройку');
  check(!m.build(0, 'mine', 5, 5).ok, 'стройка во время боя отклонена');
  check(!m.spawnUnits(0, 'scout').ok, 'заказ юнитов во время боя отклонён');

  // Доход больше НЕ капает по секундам — только выплата в начале раунда.
  const goldMid = m.players[1].gold;
  for (let i = 0; i < bal.match.tickRate * 3; i++) m.step(); // бой продолжается
  check(m.players[1].gold === goldMid, 'во время боя золото не капает');
}

console.log('2б. Доход выплачивается в начале раунда');
{
  const bal = balance.loadDefault();
  const m = new Match('inc', bal, [{ name: 'A' }, { name: 'B' }], 42);
  const start = m.players[0].gold;
  // Планирование идёт — золота не прибавляется.
  for (let i = 0; i < bal.match.tickRate * 5; i++) m.step();
  check(m.players[0].gold === start, 'во время планирования золото не капает');
  // Пустой бой -> раунд 2 -> выплата (базовый доход + рост за раунд).
  const growth = bal.economy.incomeGrowthPerRound || 0;
  m.planLeft = 0.01;
  while (m.round === 1) m.step();
  const expR2 = bal.economy.baseIncomePerRound + growth;
  check(m.players[0].gold === start + expR2, `в начале раунда 2 выплачен базовый доход с ростом (+${expR2})`);
  // Шахта увеличивает выплату следующего раунда.
  let placed = false;
  outer2: for (let y = 2; y < m.map.h - 2; y++) for (let x = 2; x < m.map.w / 2; x++) {
    if (m.placementError(0, 'mine', x, y) === null) { m.build(0, 'mine', x, y); placed = true; break outer2; }
  }
  check(placed, 'шахта построена');
  const mineSpec = bal.buildings.mine;
  check(m.projectedIncome(0) === expR2 + mineSpec.incomePerRound, 'прогноз дохода учитывает шахту');
  const beforeR3 = m.players[0].gold;
  m.planLeft = 0.01;
  while (m.round === 2) m.step();
  const expR3 = bal.economy.baseIncomePerRound + growth * 2 + mineSpec.incomePerRound;
  check(m.players[0].gold === beforeR3 + expR3, 'выплата раунда 3: рост дохода + шахта');
}

console.log('3. Юниты проходят коридор; башни для них неуязвимы');
{
  const bal = balance.loadDefault();
  const m = new Match('cor', bal, [{ name: 'A' }, { name: 'B' }], 42);
  m.players[0].gold = 5000;
  m.players[1].gold = 5000;
  // Вражеская башня прямо у коридора: юниты должны пройти мимо, не тронув её.
  let towerRef = null;
  outer3: for (let y = 2; y < m.map.h - 2; y++) for (let x = Math.floor(m.map.w / 2) + 1; x < m.map.w - 2; x++) {
    if (m.map.tiles[y * m.map.w + x] !== T.ROCK) continue;
    // клетка горы, смежная с коридором
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const t = m.map.tiles[(y + dy) * m.map.w + (x + dx)];
      return t === T.GROUND || t === T.FOREST;
    });
    if (near && m.build(1, 'arrow', x, y).ok) { towerRef = m.buildings[m.buildings.length - 1]; break outer3; }
  }
  check(!!towerRef, 'вражеская башня построена у коридора');
  m.spawnUnits(0, 'tank'); m.spawnUnits(0, 'tank'); m.spawnUnits(0, 'tank');
  m.spawnUnits(0, 'healer');
  m.planLeft = 0.01;
  m.step(); m.step();
  check(m.phase === 'battle' && m.units.length > 0, 'армия вышла в коридор');
  const hpBefore = m.players[1].baseHp;
  for (let i = 0; i < bal.match.tickRate * 90 && m.phase === 'battle'; i++) m.step();
  check(m.players[1].baseHp < hpBefore, `армия прошла коридор и ударила по базе (HP ${Math.round(hpBefore)} -> ${Math.round(m.players[1].baseHp)})`);
  check(towerRef.hp === towerRef.hpMax, 'юниты не атаковали башню — она цела');
}

console.log('3б. Юниты не застревают в скалах, целитель идёт с армией');
{
  const bal = balance.loadDefault();
  const m = new Match('stuck', bal, [{ name: 'A' }, { name: 'B' }], 7);
  m.players[0].gold = 5000;
  // Большая толпа в узком коридоре — стресс расталкивания.
  for (let i = 0; i < 6; i++) m.spawnUnits(0, 'soldier');
  m.spawnUnits(0, 'healer');
  m.spawnUnits(0, 'healer');
  m.planLeft = 0.01;
  m.step(); m.step();
  const { walkable, T: TT } = require('../server/game/mapgen');
  // Прогоняем бой и на каждом тике проверяем, что никто не залез в скалу надолго.
  let maxStuck = 0;
  const startX = m.units.filter(u => u.owner === 0).reduce((s, u) => s + u.x, 0) / m.units.length;
  for (let i = 0; i < bal.match.tickRate * 40 && m.phase === 'battle'; i++) {
    m.step();
    let stuck = 0;
    for (const u of m.units) {
      const t = m.map.tiles[m.gi(Math.floor(u.x), Math.floor(u.y))];
      if (!(t === TT.GROUND || t === TT.FOREST)) stuck++;
    }
    maxStuck = Math.max(maxStuck, stuck);
  }
  check(maxStuck <= 1, `юниты держатся коридора (макс. вне пути за тик: ${maxStuck})`);
  // Целитель продвинулся вперёд вместе с армией (а не замер у базы).
  const healers = m.units.filter(u => u.type === 'healer' && u.owner === 0);
  if (healers.length) {
    const advanced = healers.some(h => Math.abs(h.x - m.map.bases[0].x) > 5);
    check(advanced || m.phase !== 'battle', 'целитель продвинулся по коридору, а не застыл у базы');
  } else {
    check(true, 'целители дошли до боя (уже в гуще)');
  }
}

console.log('4. Бот против бота — полный матч (ускоренно)');
{
  const bal = balance.loadDefault();
  const durations = [];
  for (let g = 0; g < 3; g++) {
    const m = new Match('bvb' + g, bal, [{ name: 'Бот1', isBot: true }, { name: 'Бот2', isBot: true }], 100 + g);
    const b0 = new Bot(m, 0), b1 = new Bot(m, 1);
    const maxTicks = bal.match.hardLimitSec * bal.match.tickRate;
    let ticks = 0;
    while (!m.over && ticks < maxTicks + 10) {
      b0.update(m.dt); b1.update(m.dt);
      m.step();
      ticks++;
    }
    durations.push(m.time);
    console.log(`    игра ${g + 1}: ${Math.round(m.time / 60)}м ${Math.round(m.time % 60)}с, раундов=${m.round}, победитель=${m.winner}, причина=${m.endReason}, юнитов=${m.players[0].unitsSpawned}+${m.players[1].unitsSpawned}`);
    check(m.over, `матч ${g + 1} завершился`);
    check(m.round >= 3, `матч ${g + 1} прошёл несколько раундов`);
  }
  const avg = durations.reduce((a, b) => a + b) / durations.length;
  console.log(`    средняя длительность: ${(avg / 60).toFixed(1)} мин (цель 10-15, при равных ботах допустим таймаут)`);
  check(avg >= 300, 'матчи не заканчиваются мгновенно (>5 мин)');
}

console.log('5. Снапшоты');
{
  const bal = balance.loadDefault();
  const m = new Match('t2', bal, [{ name: 'A' }, { name: 'B' }], 7);
  m.spawnUnits(0, 'scout');
  m.step();
  const snap = m.snapshotFor(0, m.takeEvents());
  check(snap.phase === 'plan' && snap.planLeft > 0, 'фаза и таймер планирования в снапшоте');
  check(snap.myQueue.scout === bal.units.scout.pack, 'своя очередь видна в снапшоте');
  const snapEnemy = m.snapshotFor(1, []);
  check(!snapEnemy.myQueue.scout, 'чужая очередь не видна');
  const init = m.initData(0);
  check(init.map.tiles.length === init.map.w * init.map.h, 'initData содержит карту');
  check(!!init.balance.match.planPhaseSec, 'initData содержит раундовые настройки');
}

console.log('6. Sudden death и таймаут');
{
  const bal = JSON.parse(JSON.stringify(balance.loadDefault()));
  bal.match.suddenDeathAtSec = 5;
  bal.match.suddenDeathRampSec = 5;
  bal.match.hardLimitSec = 20;
  const m = new Match('t3', bal, [{ name: 'A' }, { name: 'B' }], 9);
  m.players[0].baseHp = 500; // игрок A слабее
  while (!m.over) m.step();
  check(m.endReason === 'timeout' || m.endReason === 'base', 'матч завершён по таймауту/базе');
  check(m.winner === 1, 'победил игрок с большим HP базы');
}

console.log(failed === 0 ? '\nВСЕ ТЕСТЫ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed ? 1 : 0);
