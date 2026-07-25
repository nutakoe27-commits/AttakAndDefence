'use strict';
// Раннер матчей и матчмейкинг.
// Очередь на двоих; если пара не нашлась за matchmaking.botFallbackSec — подставляем бота.
const { Match } = require('./game/sim');
const { Bot } = require('./game/bot');
const balance = require('./balance');
const db = require('./db');
const crypto = require('crypto');

const BOT_NAMES = ['Генерал Оникс', 'Командор Вега', 'Маршал Гром', 'Стратег Ирбис', 'Полковник Шторм'];
const DISCONNECT_FORFEIT_SEC = 25;

let nextMatchId = 1;

class MatchRunner {
  constructor(playersInfo, onFinish) {
    // playersInfo: [{token, name, ws, isBot}]
    this.id = 'm' + (nextMatchId++);
    this.match = new Match(this.id, balance.get(), playersInfo.map(p => ({ name: p.name, isBot: p.isBot })));
    this.sockets = playersInfo.map(p => p.ws || null);
    this.tokens = playersInfo.map(p => p.token || null);
    this.disconnectedAt = [null, null];
    this.bot = null;
    this.onFinish = onFinish;
    this.finishedNotified = false;
    for (let i = 0; i < playersInfo.length; i++) {
      if (playersInfo[i].isBot) this.bot = new Bot(this.match, i);
    }
    const tickMs = 1000 / this.match.balance.match.tickRate;
    this.interval = setInterval(() => this.tickLoop(), tickMs);
    // Отправляем стартовые данные.
    for (let slot = 0; slot < 2; slot++) this.sendInit(slot);
  }

  sendInit(slot) {
    const ws = this.sockets[slot];
    if (!ws) return;
    this.send(ws, { t: 'matchStart', ...this.match.initData(slot) });
  }

  send(ws, obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch (_) { /* сокет умер — обработает on('close') */ }
    }
  }

  tickLoop() {
    const dt = this.match.dt;
    if (this.bot) this.bot.update(dt);
    this.checkDisconnects();
    this.match.step();
    // Персональные снапшоты: во время планирования каждый видит только своё.
    const events = this.match.takeEvents();
    for (let slot = 0; slot < 2; slot++) {
      this.send(this.sockets[slot], { t: 'snap', s: this.match.snapshotFor(slot, events) });
    }
    if (this.match.over) this.finish();
  }

  checkDisconnects() {
    if (this.match.over) return;
    for (let slot = 0; slot < 2; slot++) {
      if (this.match.players[slot].isBot) continue;
      const ws = this.sockets[slot];
      const alive = ws && ws.readyState === 1;
      if (alive) { this.disconnectedAt[slot] = null; continue; }
      if (this.disconnectedAt[slot] === null) this.disconnectedAt[slot] = Date.now();
      else if (Date.now() - this.disconnectedAt[slot] > DISCONNECT_FORFEIT_SEC * 1000) {
        this.match.finish(1 - slot, 'disconnect');
      }
    }
  }

  handleCommand(slot, msg) {
    const m = this.match;
    let res = null;
    switch (msg.t) {
      case 'spawn': res = m.spawnUnits(slot, String(msg.unit || '')); break;
      case 'unqueue': res = m.unqueueUnits(slot, String(msg.unit || '')); break;
      case 'build': res = m.build(slot, String(msg.type || ''), msg.x | 0, msg.y | 0); break;
      case 'sell': res = m.sell(slot, msg.id | 0); break;
      case 'surrender': m.finish(1 - slot, 'surrender'); res = { ok: true }; break;
      default: return;
    }
    if (res && !res.ok) this.send(this.sockets[slot], { t: 'reject', reason: res.error });
  }

  attach(slot, ws) {
    this.sockets[slot] = ws;
    this.disconnectedAt[slot] = null;
    this.sendInit(slot);
  }

  detach(ws) {
    for (let slot = 0; slot < 2; slot++) {
      if (this.sockets[slot] === ws) this.sockets[slot] = null;
    }
  }

  finish() {
    if (this.finishedNotified) return;
    this.finishedNotified = true;
    clearInterval(this.interval);
    this.onFinish(this);
  }

  stop(reason) {
    this.match.finish(null, reason || 'aborted');
    const snap = this.match.snapshot();
    for (const ws of this.sockets) this.send(ws, { t: 'snap', s: snap });
    this.finish();
  }

  // Сводка для админки.
  adminSummary() {
    const m = this.match;
    return {
      id: this.id,
      time: Math.round(m.time),
      over: m.over,
      phase: m.phase,
      round: m.round,
      players: m.players.map((p, i) => ({
        name: p.name, isBot: p.isBot,
        gold: Math.floor(p.gold), income: p.income,
        baseHp: Math.round(p.baseHp), baseHpMax: p.baseHpMax,
        units: m.units.filter(u => u.owner === i).length,
        buildings: m.buildings.filter(b => b.owner === i).length,
        kills: p.unitsKilled,
        connected: p.isBot || (this.sockets[i] && this.sockets[i].readyState === 1),
      })),
      seed: m.map.seed,
    };
  }
}

const ROOM_TTL_MS = 15 * 60 * 1000;
// Алфавит без похожих символов (нет 0/O, 1/I/L).
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

class Lobby {
  constructor() {
    this.queue = [];          // [{token, name, ws, since, timer}]
    this.rooms = new Map();   // code -> {code, host:{token,name,ws}, createdAt}
    this.matches = new Map(); // id -> MatchRunner
    this.byToken = new Map(); // token -> {runner, slot}
    this.history = [];        // завершённые матчи (для админки)
    this.stats = { totalMatches: 0, botMatches: 0, pvpMatches: 0, friendMatches: 0 };
  }

  botFallbackMs() {
    const b = balance.get();
    return (b.matchmaking && b.matchmaking.botFallbackSec ? b.matchmaking.botFallbackSec : 20) * 1000;
  }

  enqueue(ws, name, token) {
    this.dequeue(ws); // на случай повторного клика
    const entry = { token, name, ws, since: Date.now() };
    entry.timer = setTimeout(() => this.fallbackToBot(entry), this.botFallbackMs());
    this.queue.push(entry);
    this.trySendPair();
    ws.send(JSON.stringify({ t: 'queued', botFallbackSec: this.botFallbackMs() / 1000 }));
  }

  dequeue(ws) {
    const i = this.queue.findIndex(e => e.ws === ws);
    if (i >= 0) {
      clearTimeout(this.queue[i].timer);
      this.queue.splice(i, 1);
    }
  }

  trySendPair() {
    while (this.queue.length >= 2) {
      const a = this.queue.shift();
      const b = this.queue.shift();
      clearTimeout(a.timer); clearTimeout(b.timer);
      this.startMatch([
        { token: a.token, name: a.name, ws: a.ws, isBot: false },
        { token: b.token, name: b.name, ws: b.ws, isBot: false },
      ], 'pvp');
    }
  }

  fallbackToBot(entry) {
    const i = this.queue.indexOf(entry);
    if (i < 0) return;
    this.queue.splice(i, 1);
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    this.startMatch([
      { token: entry.token, name: entry.name, ws: entry.ws, isBot: false },
      { token: null, name: botName + ' [бот]', ws: null, isBot: true },
    ], 'bot');
  }

  startMatch(players, kind) {
    const runner = new MatchRunner(players, r => this.onMatchFinish(r));
    runner.match.kind = kind;
    this.matches.set(runner.id, runner);
    for (let slot = 0; slot < players.length; slot++) {
      if (players[slot].token) this.byToken.set(players[slot].token, { runner, slot });
    }
    this.stats.totalMatches++;
    if (kind === 'bot') this.stats.botMatches++;
    else if (kind === 'friend') this.stats.friendMatches++;
    else this.stats.pvpMatches++;
    console.log(`[match] ${runner.id} старт (${kind}): ${players.map(p => p.name).join(' vs ')}`);
  }

  // ---------- Приватные комнаты («игра с другом») ----------
  // Хост создаёт комнату и получает код; друг вводит код (или открывает ссылку) — матч стартует.
  // Бот-фоллбек в комнатах не работает: ждём именно друга.
  createRoom(ws, name, token) {
    this.dequeue(ws);           // нельзя одновременно искать матч и ждать друга
    this.leaveRoomByWs(ws);     // и держать две комнаты
    this.cleanupRooms();
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    } while (this.rooms.has(code));
    this.rooms.set(code, { code, host: { token, name, ws }, createdAt: Date.now() });
    return code;
  }

  joinRoom(code, ws, name, token) {
    this.cleanupRooms();
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { ok: false, error: 'Комната не найдена. Проверьте код — возможно, друг её закрыл.' };
    if (room.host.ws === ws || room.host.token === token) return { ok: false, error: 'Это ваша собственная комната — отправьте код другу.' };
    if (!room.host.ws || room.host.ws.readyState !== 1) {
      this.rooms.delete(room.code);
      return { ok: false, error: 'Создатель комнаты отключился.' };
    }
    this.rooms.delete(room.code);
    this.dequeue(ws);
    this.startMatch([
      { token: room.host.token, name: room.host.name, ws: room.host.ws, isBot: false },
      { token, name, ws, isBot: false },
    ], 'friend');
    return { ok: true };
  }

  leaveRoomByWs(ws) {
    for (const [code, room] of this.rooms) {
      if (room.host.ws === ws) this.rooms.delete(code);
    }
  }

  cleanupRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.createdAt > ROOM_TTL_MS) this.rooms.delete(code);
      else if (!room.host.ws || room.host.ws.readyState !== 1) this.rooms.delete(code);
    }
  }

  onMatchFinish(runner) {
    const m = runner.match;
    // Запись в БД для аналитики баланса.
    try { db.recordMatch(m.statsSummary()); } catch (e) { console.error('[match] db.recordMatch:', e.message); }
    // Лидерборд: обновляем рейтинг живых игроков (боты не участвуют).
    try {
      for (let slot = 0; slot < 2; slot++) {
        const p = m.players[slot];
        if (p.isBot || !runner.tokens[slot]) continue;
        const outcome = m.winner === slot ? 'win' : m.winner == null ? 'draw' : 'loss';
        const vsBot = m.players[1 - slot].isBot;
        db.updateLeaderboard(runner.tokens[slot], p.name, outcome, vsBot);
      }
    } catch (e) { console.error('[match] leaderboard:', e.message); }
    this.history.unshift({
      id: runner.id,
      finishedAt: Date.now(),
      durationSec: Math.round(m.time),
      winner: m.winner,
      reason: m.endReason,
      players: m.players.map(p => ({
        name: p.name, isBot: p.isBot,
        kills: p.unitsKilled, losses: p.unitsLost,
        goldEarned: p.goldEarned, goldSpent: p.goldSpent,
        baseHp: Math.round(p.baseHp),
      })),
      seed: m.map.seed,
    });
    if (this.history.length > 100) this.history.pop();
    // Матч держим ещё минуту, чтобы клиенты успели показать итоговый экран.
    setTimeout(() => {
      this.matches.delete(runner.id);
      for (const [token, ref] of this.byToken) {
        if (ref.runner === runner) this.byToken.delete(token);
      }
    }, 60 * 1000);
    console.log(`[match] ${runner.id} финиш: winner=${m.winner} reason=${m.endReason} t=${Math.round(m.time)}s`);
  }

  // Реконнект: если токен привязан к живому матчу — возвращаем игрока в бой.
  tryReattach(token, ws) {
    const ref = this.byToken.get(token);
    if (!ref || ref.runner.match.over) return false;
    ref.runner.attach(ref.slot, ws);
    return true;
  }

  findByWs(ws) {
    for (const ref of this.byToken.values()) {
      if (ref.runner.sockets[ref.slot] === ws) return ref;
    }
    return null;
  }

  handleDisconnect(ws) {
    this.dequeue(ws);
    this.leaveRoomByWs(ws);
    for (const runner of this.matches.values()) runner.detach(ws);
  }
}

function newToken() { return crypto.randomBytes(16).toString('hex'); }

module.exports = { Lobby, MatchRunner, newToken };
