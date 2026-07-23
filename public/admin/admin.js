// Админ-панель: логин, дашборд, live-матчи, редактор баланса.
'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  let token = sessionStorage.getItem('ad_admin_token') || null;
  let balanceData = null;   // текущий баланс с сервера
  let defaultData = null;   // дефолтный баланс (для подсветки отличий)
  let pendingPatch = {};    // несохранённые правки
  let pollTimer = null;

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch('/api/admin/' + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401 && path !== 'login') { logout(); throw new Error('unauthorized'); }
    return res.json();
  }

  function toast(text, ok = true) {
    const el = document.createElement('div');
    el.className = 'admin-toast' + (ok ? '' : ' err');
    el.textContent = text;
    $('#admin-toast-wrap').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ---------- Логин ----------
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#login-password').value;
    try {
      const r = await api('login', { method: 'POST', body: JSON.stringify({ password }) });
      if (!r.ok) { $('#login-error').textContent = r.error || 'Ошибка'; return; }
      token = r.token;
      sessionStorage.setItem('ad_admin_token', token);
      enterApp();
    } catch {
      $('#login-error').textContent = 'Сервер недоступен';
    }
  });

  function logout() {
    token = null;
    sessionStorage.removeItem('ad_admin_token');
    clearInterval(pollTimer);
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  }
  $('#btn-logout').addEventListener('click', logout);

  async function enterApp() {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    await Promise.all([refreshOverview(), refreshMatches(), loadBalance()]);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      refreshOverview();
      if (currentPage === 'matches') refreshMatches();
    }, 3000);
  }

  // ---------- Навигация ----------
  let currentPage = 'dashboard';
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      currentPage = btn.dataset.page;
      $('#page-' + currentPage).classList.add('active');
      if (currentPage === 'matches') refreshMatches();
    });
  });

  // ---------- Дашборд ----------
  function card(label, value, sub = '') {
    return `<div class="card"><div class="card-label">${label}</div><div class="card-value">${value}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
  }

  function fmtDur(sec) {
    const h = (sec / 3600) | 0, m = ((sec % 3600) / 60) | 0;
    return h ? `${h}ч ${m}м` : `${m}м ${sec % 60 | 0}с`;
  }

  async function refreshOverview() {
    try {
      const r = await api('overview');
      if (!r.ok) return;
      $('#live-indicator').classList.remove('off');
      $('#dash-cards').innerHTML =
        card('Онлайн', r.online) +
        card('В очереди', r.inQueue) +
        card('Активных матчей', r.activeMatches) +
        card('Аптайм', fmtDur(r.uptimeSec)) +
        card('Версия баланса', r.balanceVersion);
      const s = r.stats;
      $('#dash-stats').innerHTML =
        card('Всего матчей', s.totalMatches) +
        card('PvP', s.pvpMatches) +
        card('Против бота', s.botMatches) +
        card('Завершено (в истории)', s.finished) +
        card('Средняя длительность', fmtDur(s.avgDurationSec));
    } catch {
      $('#live-indicator').classList.add('off');
    }
  }

  // ---------- Матчи ----------
  async function refreshMatches() {
    try {
      const r = await api('matches');
      if (!r.ok) return;
      $('#active-count').textContent = r.active.length;
      const at = $('#active-matches');
      if (!r.active.length) {
        at.innerHTML = '<tr><td style="color:var(--muted)">Сейчас нет активных матчей</td></tr>';
      } else {
        at.innerHTML = '<tr><th>ID</th><th>Время</th><th>Игроки</th><th>База</th><th>Золото</th><th>Армия</th><th>Постройки</th><th></th></tr>' +
          r.active.map(m => {
            const rows = m.players.map(p => `
              <div>${p.isBot ? '<span class="tag bot">БОТ</span>' : '<span class="tag human">ЧЕЛ</span>'}
              ${esc(p.name)} ${p.connected ? '' : '<span class="tag off">offline</span>'}</div>`).join('');
            const hp = m.players.map(p => `<div class="hp-mini" title="${p.baseHp}/${p.baseHpMax}"><i style="width:${(p.baseHp / p.baseHpMax * 100) | 0}%"></i></div>`).join('<br>');
            const gold = m.players.map(p => `<div>◉ ${p.gold} <span style="color:var(--muted)">(+${p.income}/с)</span></div>`).join('');
            const units = m.players.map(p => `<div>${p.units}</div>`).join('');
            const blds = m.players.map(p => `<div>${p.buildings}</div>`).join('');
            return `<tr>
              <td>${m.id}</td><td>${fmtDur(m.time)}</td>
              <td>${rows}</td><td>${hp}</td><td>${gold}</td><td>${units}</td><td>${blds}</td>
              <td><button class="btn btn-danger btn-small" data-stop="${m.id}">Остановить</button></td>
            </tr>`;
          }).join('');
        at.querySelectorAll('[data-stop]').forEach(b => b.addEventListener('click', async () => {
          if (!confirm(`Остановить матч ${b.dataset.stop}?`)) return;
          const rr = await api(`matches/${b.dataset.stop}/stop`, { method: 'POST' });
          toast(rr.ok ? 'Матч остановлен' : (rr.error || 'Ошибка'), rr.ok);
          refreshMatches();
        }));
      }
      const ht = $('#history-matches');
      if (!r.history.length) {
        ht.innerHTML = '<tr><td style="color:var(--muted)">История пуста</td></tr>';
      } else {
        ht.innerHTML = '<tr><th>Когда</th><th>Длит.</th><th>Игроки</th><th>Исход</th><th>Счёт (убийства)</th></tr>' +
          r.history.map(h => {
            const names = h.players.map((p, i) => {
              const winner = h.winner === i;
              return `${p.isBot ? '🤖' : '👤'} ${esc(p.name)}${winner ? ' <span class="tag win">победа</span>' : ''}`;
            }).join('<br>');
            const reasons = { base: 'база уничтожена', surrender: 'сдача', disconnect: 'дисконнект', timeout: 'таймаут', draw: 'ничья', admin: 'остановлен админом' };
            return `<tr>
              <td>${new Date(h.finishedAt).toLocaleTimeString('ru')}</td>
              <td>${fmtDur(h.durationSec)}</td>
              <td>${names}</td>
              <td>${reasons[h.reason] || h.reason || '—'}</td>
              <td>${h.players.map(p => p.kills).join(' : ')}</td>
            </tr>`;
          }).join('');
      }
    } catch {}
  }

  function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

  // ---------- Редактор баланса ----------
  // Человекочитаемые подписи для полей.
  const FIELD_LABELS = {
    cost: 'Цена', pack: 'Пачка, шт', hp: 'HP', dmg: 'Урон', attackRate: 'Атак/с', range: 'Дальность',
    speed: 'Скорость', armor: 'Броня', bonusVsBuildings: '×постройкам', healPerSec: 'Лечение/с',
    healRadius: 'Радиус лечения', income: 'Доход/с', incomeMult: '+доход, доля', maxCount: 'Макс. шт',
    splash: 'Сплэш', slowFactor: 'Замедление, доля', slowDuration: 'Замедление, с',
    startGold: 'Стартовое золото', baseIncome: 'Базовый доход/с', incomeTickSeconds: 'Период дохода, с',
    baseHp: 'HP базы', refundRatio: 'Возврат при продаже', targetDurationMin: 'Целевая длит., мин',
    suddenDeathAtSec: 'Sudden death, с', suddenDeathRampSec: 'Разгон SD, с', suddenDeathDecayPerSec: 'Распад баз, HP/с',
    hardLimitSec: 'Жёсткий лимит, с', tickRate: 'Тикрейт', difficulty: 'Сложность',
    actionIntervalSec: 'Интервал действий, с', ecoWeightEarly: 'Вес экономики (старт)', ecoWeightLate: 'Вес экономики (лейт)',
    defendThreshold: 'Порог обороны, юнитов', aggressionRamp: 'Рост агрессии', mistakeChance: 'Шанс ошибки',
    botFallbackSec: 'Бот через, с',
  };
  const HIDDEN_FIELDS = new Set(['name', 'desc', 'hotkey', 'kind', 'attackIntervalSec']);

  async function loadBalance() {
    const r = await api('balance');
    if (!r.ok) return;
    balanceData = r.balance;
    defaultData = r.default;
    pendingPatch = {};
    renderBalanceEditor();
    renderSettingsEditor();
    updateDirty();
  }

  function numInput(path, value, defValue) {
    const changed = defValue !== undefined && value !== defValue;
    return `<input type="number" step="any" data-path="${path}" value="${value}" ${changed ? 'class="changed" title="дефолт: ' + defValue + '"' : ''}>`;
  }

  function specTable(kindKey, entries, defEntries) {
    // entries: {key: spec}. Собираем список всех числовых полей.
    const fields = [];
    for (const spec of Object.values(entries)) {
      for (const [f, v] of Object.entries(spec)) {
        if (HIDDEN_FIELDS.has(f) || typeof v !== 'number') continue;
        if (!fields.includes(f)) fields.push(f);
      }
    }
    let html = '<div class="table-wrap"><table class="bal-table"><tr><th>Название</th>';
    for (const f of fields) html += `<th>${FIELD_LABELS[f] || f}</th>`;
    html += '</tr>';
    for (const [key, spec] of Object.entries(entries)) {
      html += `<tr><td><div class="row-name">${esc(spec.name || key)}</div><div class="spec-desc">${esc(spec.desc || '')}</div></td>`;
      for (const f of fields) {
        if (typeof spec[f] !== 'number') { html += '<td>—</td>'; continue; }
        const def = defEntries && defEntries[key] ? defEntries[key][f] : undefined;
        html += `<td>${numInput(`${kindKey}.${key}.${f}`, spec[f], def)}</td>`;
      }
      html += '</tr>';
    }
    return html + '</table></div>';
  }

  function flatTable(kindKey, obj, defObj) {
    let html = '<div class="table-wrap"><table class="bal-table">';
    for (const [f, v] of Object.entries(obj)) {
      if (typeof v === 'number') {
        html += `<tr><td>${FIELD_LABELS[f] || f}</td><td>${numInput(`${kindKey}.${f}`, v, defObj ? defObj[f] : undefined)}</td></tr>`;
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        for (const [f2, v2] of Object.entries(v)) {
          if (typeof v2 !== 'number') continue;
          html += `<tr><td>${FIELD_LABELS[f] || f} → ${FIELD_LABELS[f2] || f2}</td><td>${numInput(`${kindKey}.${f}.${f2}`, v2, defObj && defObj[f] ? defObj[f][f2] : undefined)}</td></tr>`;
        }
      }
    }
    return html + '</table></div>';
  }

  function renderBalanceEditor() {
    const el = $('#balance-editor');
    el.innerHTML = `
      <div class="bal-section"><h3>⚔ Юниты</h3>${specTable('units', balanceData.units, defaultData.units)}</div>
      <div class="bal-section"><h3>🏰 Постройки</h3>${specTable('buildings', balanceData.buildings, defaultData.buildings)}</div>
      <div class="bal-section"><h3>◉ Экономика</h3>${flatTable('economy', balanceData.economy, defaultData.economy)}</div>
      <div class="bal-section"><h3>⏱ Матч</h3>${flatTable('match', balanceData.match, defaultData.match)}</div>`;
    bindInputs(el);
  }

  function renderSettingsEditor() {
    const el = $('#settings-editor');
    el.innerHTML = `
      <div class="bal-section"><h3>🤖 Бот</h3>${flatTable('bot', balanceData.bot, defaultData.bot)}</div>
      <div class="bal-section"><h3>🎯 Матчмейкинг</h3>${flatTable('matchmaking', balanceData.matchmaking, defaultData.matchmaking)}</div>`;
    bindInputs(el);
  }

  function bindInputs(root) {
    root.querySelectorAll('input[data-path]').forEach(inp => {
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!isFinite(v)) return;
        setPath(pendingPatch, inp.dataset.path.split('.'), v);
        inp.classList.add('changed');
        updateDirty();
      });
    });
  }

  function setPath(obj, parts, value) {
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!o[parts[i]]) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
  }

  function updateDirty() {
    const dirty = Object.keys(pendingPatch).length > 0;
    $('#balance-dirty').classList.toggle('hidden', !dirty);
  }

  async function saveBalance() {
    if (!Object.keys(pendingPatch).length) { toast('Нет изменений'); return; }
    const r = await api('balance', { method: 'POST', body: JSON.stringify({ patch: pendingPatch }) });
    if (!r.ok) {
      toast('Ошибка: ' + (r.errors ? r.errors.join('; ') : r.error), false);
      return;
    }
    toast('Баланс сохранён — применится к новым матчам');
    await loadBalance();
  }

  $('#btn-balance-save').addEventListener('click', saveBalance);
  $('#btn-settings-save').addEventListener('click', saveBalance);
  $('#btn-balance-reset').addEventListener('click', async () => {
    if (!confirm('Сбросить ВЕСЬ баланс к значениям по умолчанию?')) return;
    const r = await api('balance/reset', { method: 'POST' });
    if (r.ok) { toast('Баланс сброшен'); await loadBalance(); }
  });

  // ---------- Автовход по сохранённому токену ----------
  if (token) {
    api('overview').then(r => { if (r.ok) enterApp(); else logout(); }).catch(() => logout());
  }
})();
