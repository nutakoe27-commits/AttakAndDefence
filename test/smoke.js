'use strict';
// Смоук-тест: генерация карт, бот против бота (ускоренно), проверка инвариантов.
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

console.log('2. Базовые механики');
{
  const bal = balance.loadDefault();
  const m = new Match('t1', bal, [{ name: 'A' }, { name: 'B' }], 42);
  const r1 = m.spawnUnits(0, 'soldier');
  check(r1.ok, 'спавн юнитов проходит');
  check(m.units.length === bal.units.soldier.pack, 'заспавнилась целая пачка');
  check(m.players[0].gold === bal.economy.startGold - bal.units.soldier.cost, 'золото списано');
  const rBad = m.spawnUnits(0, 'nosuch');
  check(!rBad.ok, 'неизвестный юнит отклонён');

  // Стройка на своей половине — ок, на чужой — нет.
  let built = false;
  outer: for (let y = 2; y < m.map.h - 2; y++) for (let x = 2; x < m.map.w / 2; x++) {
    if (m.placementError(0, 'mine', x, y) === null) {
      check(m.build(0, 'mine', x, y).ok, 'постройка шахты на своей половине');
      built = true; break outer;
    }
  }
  check(built, 'нашлось место под шахту');
  check(!m.build(0, 'mine', m.map.w - 3, Math.floor(m.map.h / 2) + 2).ok, 'стройка на чужой половине отклонена');

  // Доход тикает.
  const goldBefore = m.players[1].gold;
  for (let i = 0; i < bal.match.tickRate * 3; i++) m.step();
  check(m.players[1].gold > goldBefore, 'пассивный доход начисляется');
}

console.log('3. Бот против бота — полный матч (ускоренно)');
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
    console.log(`    игра ${g + 1}: ${Math.round(m.time / 60)}м ${Math.round(m.time % 60)}с, победитель=${m.winner}, причина=${m.endReason}, юнитов создано=${m.players[0].unitsSpawned}+${m.players[1].unitsSpawned}`);
    check(m.over, `матч ${g + 1} завершился`);
  }
  const avg = durations.reduce((a, b) => a + b) / durations.length;
  console.log(`    средняя длительность: ${(avg / 60).toFixed(1)} мин (цель 10-15, при равных ботах допустим таймаут)`);
  check(avg >= 300, 'матчи не заканчиваются мгновенно (>5 мин)');
}

console.log('4. Снапшоты и события');
{
  const bal = balance.loadDefault();
  const m = new Match('t2', bal, [{ name: 'A' }, { name: 'B' }], 7);
  m.spawnUnits(0, 'scout');
  m.step();
  const snap = m.snapshot();
  check(Array.isArray(snap.units) && snap.units.length > 0, 'юниты в снапшоте');
  check(snap.players[0].gold >= 0, 'в снапшоте есть данные игроков');
  const init = m.initData(0);
  check(init.map.tiles.length === init.map.w * init.map.h, 'initData содержит карту');
  check(!!init.balance.units.scout, 'initData содержит баланс');
}

console.log('5. Sudden death и таймаут');
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
