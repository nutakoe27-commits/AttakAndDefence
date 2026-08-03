'use strict';
// E2E: поднимаем сервер, два WS-клиента (PvP), команды, снапшоты, админ-API, бот-фоллбек.
const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const PORT = 3177;
let failed = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { console.error('  ✗ ' + msg); failed++; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fetchJson(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); } catch (e) { resolve({ status: res.statusCode, raw: data }); } });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function wsClient(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const client = { ws, name, msgs: [], token: null, snap: null, init: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    client.msgs.push(m);
    if (m.t === 'hello') client.token = m.token;
    if (m.t === 'matchStart') client.init = m;
    if (m.t === 'snap') client.snap = m.s;
  });
  return new Promise((resolve) => {
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', name })); resolve(client); });
  });
}
const send = (c, obj) => c.ws.send(JSON.stringify(obj));
async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await sleep(100);
  }
  throw new Error('timeout: ' + what);
}

(async () => {
  const STATS_DB = path.join(require('os').tmpdir(), `ad_e2e_stats_${process.pid}.db`);
  const server = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), ADMIN_PASSWORD: 'testpass123', STATS_DB },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await sleep(800);

  try {
    console.log('1. Статика');
    const idx = await fetchJson('/');
    check(idx.status === 200, 'index.html отдаётся');
    const admin = await fetchJson('/admin');
    check(admin.status === 200, 'админка отдаётся');
    const trav = await fetchJson('/../server/index.js');
    check(trav.status !== 200 || !String(trav.raw).includes('createServer'), 'path traversal закрыт');

    console.log('2. Админ-API');
    const badLogin = await fetchJson('/api/admin/login', { method: 'POST', body: { password: 'wrong' } });
    check(badLogin.status === 401, 'неверный пароль отклонён');
    const login = await fetchJson('/api/admin/login', { method: 'POST', body: { password: 'testpass123' } });
    check(login.status === 200 && login.body.token, 'логин работает');
    const auth = { Authorization: 'Bearer ' + login.body.token };
    const noAuth = await fetchJson('/api/admin/overview');
    check(noAuth.status === 401, 'без токена доступ закрыт');
    const overview = await fetchJson('/api/admin/overview', { headers: auth });
    check(overview.status === 200 && typeof overview.body.online === 'number', 'overview отвечает');
    const balGet = await fetchJson('/api/admin/balance', { headers: auth });
    check(balGet.body.ok && balGet.body.balance.units.scout, 'баланс читается');
    const patch = await fetchJson('/api/admin/balance', { method: 'POST', headers: auth, body: { patch: { units: { scout: { cost: 75 } } } } });
    check(patch.body.ok, 'патч баланса применяется');
    const balGet2 = await fetchJson('/api/admin/balance', { headers: auth });
    check(balGet2.body.balance.units.scout.cost === 75, 'патч сохранился');
    const badPatch = await fetchJson('/api/admin/balance', { method: 'POST', headers: auth, body: { patch: { units: { scout: { cost: 'дорого' } } } } });
    check(!badPatch.body.ok, 'нечисловой патч отклонён');
    const reset = await fetchJson('/api/admin/balance/reset', { method: 'POST', headers: auth });
    check(reset.body.ok && reset.body.balance.units.scout.cost === 70, 'сброс к дефолту');
    // Ускоряем раунды для дальнейших тестов (применится к новым матчам).
    await fetchJson('/api/admin/balance', { method: 'POST', headers: auth, body: { patch: { match: { planPhaseSec: 5, battleMinSec: 1 } } } });

    console.log('3. Два человека в одном матче (через комнату)');
    const c1 = await wsClient('Аня');
    const c2 = await wsClient('Борис');
    await waitFor(() => c1.token && c2.token, 3000, 'hello');
    send(c1, { t: 'createRoom', name: 'Аня' });
    await waitFor(() => c1.msgs.some(m => m.t === 'roomCreated'), 3000, 'roomCreated');
    const roomCode = c1.msgs.find(m => m.t === 'roomCreated').code;
    send(c2, { t: 'joinRoom', code: roomCode, name: 'Борис' });
    await waitFor(() => c1.init && c2.init, 5000, 'matchStart');
    check(c1.init.matchId === c2.init.matchId, 'оба в одном матче');
    check(c1.init.yourSlot !== c2.init.yourSlot, 'слоты разные');
    check(c1.init.map.tiles.length === c1.init.map.w * c1.init.map.h, 'карта пришла');
    check(c1.init.botMatch === false, 'матч с другом — не ботовый');

    console.log('4. Раунды: планирование, скрытность, бой');
    await waitFor(() => c1.snap, 3000, 'первый снапшот');
    check(c1.snap.phase === 'plan', 'матч начинается с планирования');
    // Поиск клетки под постройку.
    const map = c1.init.map, slot = c1.init.yourSlot;
    let bx = -1, by = -1;
    outer: for (let y = 2; y < map.h - 2; y++) {
      for (let x = 2; x < map.w - 2; x++) {
        const myHalf = slot === 0 ? x < map.w / 2 : x >= map.w / 2;
        if (myHalf && map.tiles[y * map.w + x] === 1) { bx = x; by = y; break outer; } // 1 = горы
      }
    }
    send(c1, { t: 'build', type: 'mine', x: bx, y: by });
    await waitFor(() => c1.snap.buildings.length > 0, 3000, 'постройка в снапшоте');
    check(true, 'строительство в фазе планирования работает');
    check(c2.snap.buildings.length === 0, 'противник НЕ видит постройку во время планирования');
    const rejBefore = c1.msgs.filter(m => m.t === 'reject').length;
    send(c1, { t: 'build', type: 'mine', x: bx, y: by });
    await waitFor(() => c1.msgs.filter(m => m.t === 'reject').length > rejBefore, 3000, 'reject');
    check(true, 'занятая клетка отклоняется');
    send(c1, { t: 'spawn', unit: 'soldier' });
    await waitFor(() => c1.snap.myQueue && c1.snap.myQueue.soldier > 0, 3000, 'очередь юнитов');
    check(true, 'юниты встали в очередь');
    check(!c2.snap.myQueue || !c2.snap.myQueue.soldier, 'противник не видит чужую очередь');
    send(c1, { t: 'unqueue', unit: 'soldier' });
    await waitFor(() => !c1.snap.myQueue.soldier, 3000, 'отмена очереди');
    check(true, 'отмена пачки из очереди работает');
    send(c1, { t: 'spawn', unit: 'soldier' });
    await waitFor(() => c1.snap.phase === 'battle', 10000, 'начало боя');
    check(true, 'фаза боя началась');
    await waitFor(() => c1.snap.units.length > 0, 3000, 'войска на поле');
    check(true, 'очередь вышла на поле в начале боя');
    check(c2.snap.buildings.length === 1, 'в бою постройка противника раскрылась');

    console.log('5. Live-матчи в админке и сдача');
    const matches = await fetchJson('/api/admin/matches', { headers: auth });
    check(matches.body.active.length === 1, 'матч виден в админке');
    check(matches.body.active[0].players.some(p => p.name === 'Аня'), 'имена игроков в админке');
    send(c2, { t: 'surrender' });
    await waitFor(() => c1.snap && c1.snap.over, 3000, 'конец матча');
    check(c1.snap.winner === c1.init.yourSlot, 'победа при сдаче противника');
    const hist = await fetchJson('/api/admin/matches', { headers: auth });
    check(hist.body.history.length === 1, 'матч попал в историю');

    console.log('6. Матч с ботом (выбор сложности) + пауза на обучении + реконнект');
    const c3 = await wsClient('Соло');
    await waitFor(() => c3.token, 3000, 'hello c3');
    send(c3, { t: 'playBot', name: 'Соло', difficulty: 'hard' });
    await waitFor(() => c3.init, 5000, 'бот-матч');
    const botPlayer = c3.init.players.find(p => p.isBot);
    check(!!botPlayer, 'матч с ботом создан мгновенно: ' + (botPlayer && botPlayer.name));
    check(c3.init.difficulty === 'hard', 'сложность передана боту: ' + c3.init.difficulty);
    check(c3.init.botMatch === true, 'помечен как ботовый матч');
    // Пауза на обучении: время матча замирает.
    await waitFor(() => c3.snap && c3.snap.time > 0.5, 4000, 'матч идёт');
    send(c3, { t: 'pauseMatch', on: true });
    await sleep(400);
    const tPause = c3.snap.time;
    await sleep(900);
    check(Math.abs(c3.snap.time - tPause) < 0.2, `на паузе время стоит (${tPause} ≈ ${c3.snap.time})`);
    send(c3, { t: 'pauseMatch', on: false });
    await sleep(600);
    check(c3.snap.time > tPause + 0.3, 'после снятия паузы время снова идёт');
    // Реконнект: закрываем сокет, открываем новый с тем же токеном.
    const savedToken = c3.token;
    c3.ws.close();
    await sleep(500);
    const c4 = await wsClient('Соло');
    await waitFor(() => c4.token, 2000, 'hello c4');
    send(c4, { t: 'hello', token: savedToken, name: 'Соло' });
    await waitFor(() => c4.init, 4000, 'реконнект в матч');
    check(c4.init.matchId === c3.init.matchId, 'реконнект вернул в тот же матч');
    console.log('6.5. Статистика/БД: завершённый матч записан, аналитика считается');
    {
      const st = await fetchJson('/api/admin/stats?days=0', { headers: auth });
      if (st.body.stats && st.body.stats.enabled) {
        check(st.body.stats.totals.matches >= 1, 'матчи записаны в БД');
        check(Array.isArray(st.body.stats.units) && st.body.stats.units.length > 0, 'аналитика по юнитам есть');
        check(!!st.body.stats.economy && typeof st.body.stats.economy.avgEarned === 'number', 'экономическая аналитика считается');
        check(!!st.body.stats.sideBalance, 'баланс сторон посчитан');
      } else {
        check(true, 'node:sqlite недоступен — статистика в no-op режиме (не ошибка)');
      }
    }

    console.log('6.7. Лидерборд');
    {
      // c1 выиграл матч (сдача c2 в секции 5) — должен попасть в рейтинг.
      let lbMsg = null;
      c1.msgs.length = 0;
      send(c1, { t: 'leaderboard' });
      await waitFor(() => (lbMsg = c1.msgs.find(m => m.t === 'leaderboard')), 3000, 'ответ лидерборда');
      if (lbMsg.disabled) {
        check(true, 'лидерборд в no-op (нет sqlite) — не ошибка');
      } else {
        check(Array.isArray(lbMsg.top) && lbMsg.top.length >= 2, `в топе есть игроки (${lbMsg.top.length})`);
        check(lbMsg.me && lbMsg.me.rank >= 1 && typeof lbMsg.me.rating === 'number', `свой ранг: #${lbMsg.me.rank}, рейтинг ${lbMsg.me.rating}`);
        const winner = lbMsg.top.find(p => p.name === 'Аня');
        check(!!winner && winner.rating > 1000, 'победитель получил рейтинг > 1000');
      }
    }

    console.log('7. Приватные комнаты (игра с другом)');
    const h1 = await wsClient('Хост');
    const h2 = await wsClient('Друг');
    await waitFor(() => h1.token && h2.token, 3000, 'hello host/friend');
    send(h1, { t: 'createRoom', name: 'Хост' });
    await waitFor(() => h1.msgs.some(m => m.t === 'roomCreated'), 3000, 'roomCreated');
    const code = h1.msgs.find(m => m.t === 'roomCreated').code;
    check(/^[A-Z2-9]{4}$/.test(code), 'код комнаты валиден: ' + code);
    const ovRoom = await fetchJson('/api/admin/overview', { headers: auth });
    check(ovRoom.body.openRooms === 1, 'комната видна в админке');
    send(h2, { t: 'joinRoom', code: 'XXXX', name: 'Друг' });
    await waitFor(() => h2.msgs.some(m => m.t === 'roomError'), 3000, 'roomError');
    check(true, 'неверный код отклонён');
    send(h1, { t: 'joinRoom', code, name: 'Хост' });
    await waitFor(() => h1.msgs.some(m => m.t === 'roomError'), 3000, 'self-join error');
    check(true, 'вход в свою комнату отклонён');
    send(h2, { t: 'joinRoom', code: code.toLowerCase(), name: 'Друг' });
    await waitFor(() => h1.init && h2.init, 5000, 'friend matchStart');
    check(h1.init.matchId === h2.init.matchId, 'друзья в одном матче (код без учёта регистра)');
    check(h1.init.players.every(p => !p.isBot), 'бота в матче с другом нет');
    const ovRoom2 = await fetchJson('/api/admin/overview', { headers: auth });
    check(ovRoom2.body.openRooms === 0, 'комната закрылась после старта');
    check(ovRoom2.body.stats.friendMatches >= 1, 'friend-матч посчитан в статистике');
    h1.ws.close(); h2.ws.close();

    await fetchJson('/api/admin/balance/reset', { method: 'POST', headers: auth });
    c1.ws.close(); c2.ws.close(); c4.ws.close();
  } catch (e) {
    console.error('  ✗ ИСКЛЮЧЕНИЕ: ' + e.message);
    failed++;
  } finally {
    server.kill();
  }
  console.log(failed === 0 ? '\nE2E ПРОЙДЕН' : `\nПРОВАЛЕНО: ${failed}`);
  process.exit(failed ? 1 : 0);
})();
