'use strict';
// API админ-панели: авторизация по паролю, статистика, live-матчи, редактор баланса.
const crypto = require('crypto');
const balance = require('./balance');
const db = require('./db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[admin] ⚠ ADMIN_PASSWORD не задан — используется пароль по умолчанию "admin". Обязательно смените его на проде!');
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiresAt
const loginAttempts = new Map(); // ip -> {count, until}

const startedAt = Date.now();

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function checkToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function rateLimited(ip) {
  const rec = loginAttempts.get(ip);
  if (rec && rec.until > Date.now()) return true;
  return false;
}

function noteFailure(ip) {
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  rec.count++;
  if (rec.count >= 5) { rec.until = Date.now() + 5 * 60 * 1000; rec.count = 0; }
  loginAttempts.set(ip, rec);
}

// Возвращает true, если запрос обработан этим модулем.
async function handle(req, res, lobby, onlineCount) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  if (!path.startsWith('/api/admin/')) return false;

  try {
    if (path === '/api/admin/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '?';
      if (rateLimited(ip)) return json(res, 429, { ok: false, error: 'Слишком много попыток. Подождите 5 минут.' }), true;
      const body = await readBody(req);
      const given = String(body.password || '');
      const a = Buffer.from(given), b = Buffer.from(ADMIN_PASSWORD);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) { noteFailure(ip); return json(res, 401, { ok: false, error: 'Неверный пароль' }), true; }
      return json(res, 200, { ok: true, token: issueToken() }), true;
    }

    if (!checkToken(req)) return json(res, 401, { ok: false, error: 'Не авторизован' }), true;

    if (path === '/api/admin/overview' && req.method === 'GET') {
      const hist = lobby.history;
      const durations = hist.map(h => h.durationSec);
      const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
      return json(res, 200, {
        ok: true,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        online: onlineCount(),
        openRooms: lobby.rooms ? lobby.rooms.size : 0,
        activeMatches: [...lobby.matches.values()].filter(r => !r.match.over).length,
        stats: { ...lobby.stats, avgDurationSec: avgDuration, finished: hist.length },
        balanceVersion: balance.get().version,
      }), true;
    }

    if (path === '/api/admin/matches' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        active: [...lobby.matches.values()].filter(r => !r.match.over).map(r => r.adminSummary()),
        history: lobby.history.slice(0, 30),
      }), true;
    }

    if (path === '/api/admin/stats' && req.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '0', 10) || 0;
      const bal = balance.get();
      const a = db.analytics(days, Object.keys(bal.units), Object.keys(bal.buildings));
      // Добавим человекочитаемые имена из баланса.
      if (a.enabled) {
        for (const u of a.units) u.name = bal.units[u.key] ? bal.units[u.key].name : u.key;
        for (const b of a.buildings) b.name = bal.buildings[b.key] ? bal.buildings[b.key].name : b.key;
      }
      return json(res, 200, { ok: true, stats: a }), true;
    }

    if (path === '/api/admin/balance' && req.method === 'GET') {
      return json(res, 200, { ok: true, balance: balance.get(), default: balance.loadDefault() }), true;
    }

    if (path === '/api/admin/balance' && req.method === 'POST') {
      const body = await readBody(req);
      const result = balance.applyPatch(body.patch || {});
      if (!result.ok) return json(res, 400, { ok: false, errors: result.errors }), true;
      console.log('[admin] баланс обновлён');
      return json(res, 200, { ok: true, balance: result.balance, note: 'Применится к новым матчам' }), true;
    }

    if (path === '/api/admin/balance/reset' && req.method === 'POST') {
      const b = balance.resetToDefault();
      console.log('[admin] баланс сброшен к дефолту');
      return json(res, 200, { ok: true, balance: b }), true;
    }

    if (path.startsWith('/api/admin/matches/') && req.method === 'POST' && path.endsWith('/stop')) {
      const id = path.split('/')[4];
      const runner = lobby.matches.get(id);
      if (!runner) return json(res, 404, { ok: false, error: 'Матч не найден' }), true;
      runner.stop('admin');
      return json(res, 200, { ok: true }), true;
    }

    return json(res, 404, { ok: false, error: 'Нет такого метода' }), true;
  } catch (e) {
    console.error('[admin] ошибка:', e);
    return json(res, 500, { ok: false, error: 'Внутренняя ошибка' }), true;
  }
}

module.exports = { handle };
