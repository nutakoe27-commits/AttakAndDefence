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

console.log('1. Генерация карт (50 сидов)');
{
  let allConnected = true, groundOk = true;
  for (let seed = 1; seed <= 50; seed++) {
    const map = generateMap(seed);
    if (!connected(map.tiles, map.bases[0], map.bases[1])) allConnected = false;
    let ground = 0;
    for (const t of map.tiles) if (t === T.GROUND) ground++;
    if (ground < map.w * map.h * 0.3) groundOk = false;
  }
  check(allConnected, 'базы связаны на всех 50 картах');
  check(groundOk, 'на всех картах достаточно земли под застройку');
  const m1 = generateMap(42), m2 = generateMap(42);
  check(JSON.stringify(Array.from(m1.tiles)) === JSON.stringify(Array.from(m2.tiles)), 'карта детерминирована по сиду');
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

  let built = false;
  outer: for (let y = 2; y < m.map.h - 2; y++) for (let x = 2; x < m.map.w / 2; x++) {
    if (m.placementError(0, 'mine', x, y) === null) {
      check(m.build(0, 'mine', x, y).ok, 'постройка шахты в фазе планирования');
      built = true; break outer;
    }
  }
  check(built, 'нашлось место под шахту');
  check(!m.build(0, 'mine', m.map.w - 3, Math.floor(m.map.h / 2) + 2).ok, 'стройка на чужой половине отклонена');

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

  // Доход тикает в любой фазе.
  const goldBefore = m.players[1].gold;
  for (let i = 0; i < bal.match.tickRate * 3; i++) m.step();
  check(m.players[1].gold > goldBefore, 'пассивный доход начисляется');
}

console.log('3. Баррикады не пропускают даже своих');
{
  const bal = balance.loadDefault();
  const m = new Match('bar', bal, [{ name: 'A' }, { name: 'B' }], 42);
  m.players[0].gold = 10000;
  const base = m.map.bases[0];
  // Кольцо баррикад вокруг собственной базы.
  let ring = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
    const r = m.build(0, 'barricade', base.x + dx, base.y + dy);
    if (r.ok) ring++;
  }
  check(ring >= 12, `кольцо из ${ring} баррикад построено`);
  m.spawnUnits(0, 'soldier');
  m.planLeft = 0.01;
  m.step(); m.step();
  const barricadesBefore = m.buildings.filter(b => b.type === 'barricade').length;
  // Полминуты боя: солдаты должны прогрызть собственную баррикаду, чтобы выйти.
  for (let i = 0; i < bal.match.tickRate * 30 && m.units.length > 0; i++) m.step();
  const barricadesAfter = m.buildings.filter(b => b.type === 'barricade').length;
  check(barricadesAfter < barricadesBefore, `запертые войска сломали свою баррикаду (${barricadesBefore} -> ${barricadesAfter})`);
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
