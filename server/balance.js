'use strict';
// Загрузка и хранение баланса. Дефолт лежит в config/balance.json,
// правки из админки сохраняются в config/balance.custom.json и переживают рестарт.
const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, 'config', 'balance.json');
const CUSTOM_PATH = path.join(__dirname, 'config', 'balance.custom.json');

let current = null;

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = Array.isArray(base) ? [] : { ...(base || {}) };
  for (const key of Object.keys(patch)) {
    out[key] = deepMerge(base ? base[key] : undefined, patch[key]);
  }
  return out;
}

function loadDefault() {
  return JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'));
}

function load() {
  const def = loadDefault();
  if (fs.existsSync(CUSTOM_PATH)) {
    try {
      const custom = JSON.parse(fs.readFileSync(CUSTOM_PATH, 'utf8'));
      current = deepMerge(def, custom);
    } catch (e) {
      console.error('[balance] повреждён balance.custom.json, использую дефолт:', e.message);
      current = def;
    }
  } else {
    current = def;
  }
  return current;
}

function get() {
  if (!current) load();
  return current;
}

// Валидация: числа должны остаться числами и быть в разумных пределах.
function validatePatch(patch, base) {
  const errors = [];
  function walk(p, b, trail) {
    for (const key of Object.keys(p)) {
      const pv = p[key];
      const bv = b ? b[key] : undefined;
      const here = trail ? trail + '.' + key : key;
      if (bv === undefined) { errors.push(`неизвестное поле: ${here}`); continue; }
      if (typeof bv === 'number') {
        if (typeof pv !== 'number' || !isFinite(pv)) { errors.push(`${here}: ожидается число`); continue; }
        if (pv < 0) errors.push(`${here}: не может быть отрицательным`);
        if (pv > 1e6) errors.push(`${here}: слишком большое значение`);
      } else if (typeof bv === 'string') {
        if (typeof pv !== 'string' || pv.length > 200) errors.push(`${here}: ожидается строка`);
      } else if (Array.isArray(bv)) {
        if (!Array.isArray(pv)) errors.push(`${here}: ожидается массив`);
      } else if (typeof bv === 'object' && bv !== null) {
        if (typeof pv !== 'object' || pv === null) { errors.push(`${here}: ожидается объект`); continue; }
        walk(pv, bv, here);
      }
    }
  }
  walk(patch, base, '');
  return errors;
}

function applyPatch(patch) {
  const base = get();
  const errors = validatePatch(patch, base);
  if (errors.length) return { ok: false, errors };
  current = deepMerge(base, patch);
  fs.writeFileSync(CUSTOM_PATH, JSON.stringify(current, null, 2));
  return { ok: true, balance: current };
}

function resetToDefault() {
  if (fs.existsSync(CUSTOM_PATH)) fs.unlinkSync(CUSTOM_PATH);
  current = loadDefault();
  return current;
}

module.exports = { load, get, applyPatch, resetToDefault, loadDefault };
