'use strict';
// Хранилище статистики матчей для регулирования баланса.
// Используется встроенный node:sqlite (Node >= 22.5, без npm-зависимостей).
// Если модуль недоступен (старый Node) — переходим в no-op режим, игра работает без БД.
const path = require('path');
const fs = require('fs');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) { /* нет sqlite — no-op */ }

const DB_PATH = process.env.STATS_DB || path.join(__dirname, 'data', 'stats.db');

class Stats {
  constructor() {
    this.db = null;
    this.enabled = false;
    if (!DatabaseSync) {
      console.warn('[db] node:sqlite недоступен — статистика не записывается. Обновите Node до 22.5+.');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      this.db = new DatabaseSync(DB_PATH);
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.migrate();
      this.enabled = true;
      console.log(`[db] статистика включена: ${DB_PATH}`);
    } catch (e) {
      console.error('[db] не удалось открыть БД, статистика отключена:', e.message);
    }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        duration_sec INTEGER NOT NULL,
        rounds INTEGER NOT NULL,
        winner INTEGER NOT NULL,
        reason TEXT,
        seed INTEGER,
        balance_version INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_matches_ts ON matches(ts);
      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL,
        slot INTEGER NOT NULL,
        is_bot INTEGER NOT NULL,
        won INTEGER NOT NULL,
        kills INTEGER, losses INTEGER,
        gold_earned INTEGER, gold_spent INTEGER, base_hp INTEGER,
        gold_on_units INTEGER, gold_on_eco INTEGER, gold_on_defense INTEGER,
        units_json TEXT, losses_json TEXT, buildings_json TEXT,
        PRIMARY KEY (match_id, slot)
      );
    `);
  }

  recordMatch(s) {
    if (!this.enabled) return;
    try {
      const insM = this.db.prepare(
        `INSERT OR REPLACE INTO matches (id, ts, kind, duration_sec, rounds, winner, reason, seed, balance_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insM.run(s.id, Date.now(), s.kind, s.durationSec, s.rounds, s.winner, s.reason || '', s.seed | 0, s.balanceVersion | 0);
      const insP = this.db.prepare(
        `INSERT OR REPLACE INTO match_players
         (match_id, slot, is_bot, won, kills, losses, gold_earned, gold_spent, base_hp,
          gold_on_units, gold_on_eco, gold_on_defense, units_json, losses_json, buildings_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const p of s.players) {
        insP.run(s.id, p.slot, p.isBot ? 1 : 0, p.won, p.kills | 0, p.losses | 0,
          p.goldEarned | 0, p.goldSpent | 0, p.baseHp | 0,
          p.goldOnUnits | 0, p.goldOnEco | 0, p.goldOnDefense | 0,
          JSON.stringify(p.unitsByType || {}), JSON.stringify(p.lossesByType || {}), JSON.stringify(p.buildingsByType || {}));
      }
    } catch (e) {
      console.error('[db] ошибка записи матча:', e.message);
    }
  }

  // ---------- Аналитика для админки ----------
  // sinceDays: окно в днях (0 = за всё время).
  analytics(sinceDays = 0, unitKeys = [], buildingKeys = []) {
    if (!this.enabled) return { enabled: false };
    const since = sinceDays > 0 ? Date.now() - sinceDays * 86400000 : 0;

    const totals = this.db.prepare(
      `SELECT COUNT(*) n,
              AVG(duration_sec) avgDur,
              AVG(rounds) avgRounds,
              SUM(CASE WHEN kind='pvp' THEN 1 ELSE 0 END) pvp,
              SUM(CASE WHEN kind='bot' THEN 1 ELSE 0 END) bot,
              SUM(CASE WHEN kind='friend' THEN 1 ELSE 0 END) friend,
              SUM(CASE WHEN winner=-1 THEN 1 ELSE 0 END) draws
       FROM matches WHERE ts >= ?`).get(since);

    // Причины завершения.
    const reasons = this.db.prepare(
      `SELECT reason, COUNT(*) n FROM matches WHERE ts >= ? GROUP BY reason ORDER BY n DESC`).all(since);

    // Баланс сторон: как часто побеждает slot 0 (левый).
    const sideWins = this.db.prepare(
      `SELECT SUM(CASE WHEN winner=0 THEN 1 ELSE 0 END) s0,
              SUM(CASE WHEN winner=1 THEN 1 ELSE 0 END) s1
       FROM matches WHERE ts >= ? AND winner >= 0`).get(since);

    // Экономика: средние траты по категориям.
    const eco = this.db.prepare(
      `SELECT AVG(gold_earned) earned, AVG(gold_on_units) units, AVG(gold_on_eco) eco, AVG(gold_on_defense) def
       FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE m.ts >= ?`).get(since);

    // Разбивка по типам: агрегируем JSON в JS (окно ограничено, это дёшево).
    const rows = this.db.prepare(
      `SELECT mp.won, mp.units_json, mp.losses_json, mp.buildings_json
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE m.ts >= ? LIMIT 100000`).all(since);

    const unitAgg = {}, buildAgg = {};
    const ensureU = k => (unitAgg[k] ||= { spawned: 0, lost: 0, usedIn: 0, wonWhenUsed: 0 });
    const ensureB = k => (buildAgg[k] ||= { built: 0, usedIn: 0, wonWhenUsed: 0 });
    for (const r of rows) {
      let u, l, b;
      try { u = JSON.parse(r.units_json || '{}'); l = JSON.parse(r.losses_json || '{}'); b = JSON.parse(r.buildings_json || '{}'); }
      catch { continue; }
      for (const [k, v] of Object.entries(u)) { const a = ensureU(k); a.spawned += v; a.usedIn++; if (r.won) a.wonWhenUsed++; }
      for (const [k, v] of Object.entries(l)) { ensureU(k).lost += v; }
      for (const [k, v] of Object.entries(b)) { const a = ensureB(k); a.built += v; a.usedIn++; if (r.won) a.wonWhenUsed++; }
    }

    const totalPlayerRows = rows.length || 1;
    const units = (unitKeys.length ? unitKeys : Object.keys(unitAgg)).map(k => {
      const a = unitAgg[k] || { spawned: 0, lost: 0, usedIn: 0, wonWhenUsed: 0 };
      return {
        key: k, spawned: a.spawned, lost: a.lost,
        survival: a.spawned ? Math.round((1 - a.lost / a.spawned) * 100) : 0,
        pickRate: Math.round((a.usedIn / totalPlayerRows) * 100),
        winRate: a.usedIn ? Math.round((a.wonWhenUsed / a.usedIn) * 100) : 0,
      };
    });
    const buildings = (buildingKeys.length ? buildingKeys : Object.keys(buildAgg)).map(k => {
      const a = buildAgg[k] || { built: 0, usedIn: 0, wonWhenUsed: 0 };
      return {
        key: k, built: a.built,
        avgPerPlayer: Math.round((a.built / totalPlayerRows) * 10) / 10,
        pickRate: Math.round((a.usedIn / totalPlayerRows) * 100),
        winRate: a.usedIn ? Math.round((a.wonWhenUsed / a.usedIn) * 100) : 0,
      };
    });

    return {
      enabled: true,
      window: sinceDays > 0 ? `${sinceDays} дн.` : 'всё время',
      totals: {
        matches: totals.n | 0,
        avgDurationSec: Math.round(totals.avgDur || 0),
        avgRounds: Math.round((totals.avgRounds || 0) * 10) / 10,
        pvp: totals.pvp | 0, bot: totals.bot | 0, friend: totals.friend | 0, draws: totals.draws | 0,
      },
      sideBalance: { slot0: sideWins.s0 | 0, slot1: sideWins.s1 | 0 },
      economy: {
        avgEarned: Math.round(eco.earned || 0),
        avgOnUnits: Math.round(eco.units || 0),
        avgOnEco: Math.round(eco.eco || 0),
        avgOnDefense: Math.round(eco.def || 0),
      },
      reasons,
      units, buildings,
    };
  }

  recentMatches(limit = 30) {
    if (!this.enabled) return [];
    return this.db.prepare(
      `SELECT id, ts, kind, duration_sec, rounds, winner, reason FROM matches ORDER BY ts DESC LIMIT ?`).all(limit | 0);
  }
}

module.exports = new Stats();
