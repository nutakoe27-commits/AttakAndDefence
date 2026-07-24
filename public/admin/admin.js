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
      if (currentPage === 'analytics') loadStats();
    });
  });

  // ---------- Аналитика ----------
  function bar(pct, color) {
    const w = Math.max(0, Math.min(100, pct));
    return `<div class="mini-bar"><i style="width:${w}%;background:${color || 'var(--accent)'}"></i></div>`;
  }
  function winColor(wr) { return wr >= 55 ? 'var(--green)' : wr <= 45 ? 'var(--red)' : '#c9a13a'; }

  async function loadStats() {
    const days = $('#stats-range').value;
    let r;
    try { r = await api('stats?days=' + days); } catch { return; }
    const s = r.stats;
    const body = $('#stats-body');
    if (!s || !s.enabled) {
      body.innerHTML = '<div class="note">Статистика недоступна: на сервере нет node:sqlite (нужен Node 22.5+) или ещё не сыграно ни одного матча. Данные появятся после первых завершённых матчей.</div>';
      return;
    }
    const t = s.totals;
    const sb = s.sideBalance, sbTotal = (sb.slot0 + sb.slot1) || 1;
    const ec = s.economy;
    const unitRows = s.units.sort((a, b) => b.spawned - a.spawned).map(u => `
      <tr>
        <td class="row-name">${esc(u.name)}</td>
        <td>${u.spawned}</td>
        <td>${u.pickRate}% ${bar(u.pickRate)}</td>
        <td>${u.survival}%</td>
        <td style="color:${winColor(u.winRate)}">${u.winRate}% ${bar(u.winRate, winColor(u.winRate))}</td>
      </tr>`).join('');
    const buildRows = s.buildings.sort((a, b) => b.built - a.built).map(b => `
      <tr>
        <td class="row-name">${esc(b.name)}</td>
        <td>${b.built}</td>
        <td>${b.avgPerPlayer}</td>
        <td>${b.pickRate}% ${bar(b.pickRate)}</td>
        <td style="color:${winColor(b.winRate)}">${b.winRate}% ${bar(b.winRate, winColor(b.winRate))}</td>
      </tr>`).join('');
    const reasons = s.reasons.map(r => `${esc(r.reason || '—')}: ${r.n}`).join(' · ');
    body.innerHTML = `
      <div class="cards">
        ${card('Матчей (' + s.window + ')', t.matches)}
        ${card('Средняя длит.', fmtDur(t.avgDurationSec))}
        ${card('Раундов в среднем', t.avgRounds)}
        ${card('Ничьих', t.draws)}
      </div>
      <div class="panel">
        <h3>Баланс сторон</h3>
        <div class="side-balance">
          <span>Левая база: <b>${sb.slot0}</b> (${Math.round(sb.slot0 / sbTotal * 100)}%)</span>
          ${bar(Math.round(sb.slot0 / sbTotal * 100), '#4da3ff')}
          <span>Правая база: <b>${sb.slot1}</b> (${Math.round(sb.slot1 / sbTotal * 100)}%)</span>
        </div>
        <div class="note" style="margin-top:10px">Здоровый баланс — около 50/50. Сильный перекос означает преимущество стороны (проверьте генерацию карты/старт). Причины концовок: ${reasons}</div>
      </div>
      <div class="panel">
        <h3>Юниты <span class="hint2">(pick — доля игроков, взявших юнита; win — их winrate; survival — доля выживших)</span></h3>
        <div class="table-wrap"><table>
          <tr><th>Юнит</th><th>Выпущено</th><th>Pick rate</th><th>Выживаемость</th><th>Win rate</th></tr>
          ${unitRows || '<tr><td colspan=5 style="color:var(--muted)">нет данных</td></tr>'}
        </table></div>
      </div>
      <div class="panel">
        <h3>Постройки</h3>
        <div class="table-wrap"><table>
          <tr><th>Постройка</th><th>Построено</th><th>В среднем/игрок</th><th>Pick rate</th><th>Win rate</th></tr>
          ${buildRows || '<tr><td colspan=5 style="color:var(--muted)">нет данных</td></tr>'}
        </table></div>
      </div>
      <div class="panel">
        <h3>Экономика (в среднем за матч на игрока)</h3>
        <div class="cards">
          ${card('Заработано', ec.avgEarned)}
          ${card('На юнитов', ec.avgOnUnits)}
          ${card('На экономику', ec.avgOnEco)}
          ${card('На оборону', ec.avgOnDefense)}
        </div>
      </div>`;
  }
  $('#btn-stats-refresh').addEventListener('click', loadStats);
  $('#stats-range').addEventListener('change', loadStats);

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
        card('Комнат ждёт друга', r.openRooms ?? 0) +
        card('Активных матчей', r.activeMatches) +
        card('Аптайм', fmtDur(r.uptimeSec)) +
        card('Версия баланса', r.balanceVersion);
      const s = r.stats;
      $('#dash-stats').innerHTML =
        card('Всего матчей', s.totalMatches) +
        card('PvP (очередь)', s.pvpMatches) +
        card('С другом', s.friendMatches ?? 0) +
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
        at.innerHTML = '<tr><th>ID</th><th>Время</th><th>Фаза</th><th>Игроки</th><th>База</th><th>Золото</th><th>Армия</th><th>Постройки</th><th></th></tr>' +
          r.active.map(m => {
            const rows = m.players.map(p => `
              <div>${p.isBot ? '<span class="tag bot">БОТ</span>' : '<span class="tag human">ЧЕЛ</span>'}
              ${esc(p.name)} ${p.connected ? '' : '<span class="tag off">offline</span>'}</div>`).join('');
            const hp = m.players.map(p => `<div class="hp-mini" title="${p.baseHp}/${p.baseHpMax}"><i style="width:${(p.baseHp / p.baseHpMax * 100) | 0}%"></i></div>`).join('<br>');
            const gold = m.players.map(p => `<div>◉ ${p.gold} <span style="color:var(--muted)">(+${p.income}/с)</span></div>`).join('');
            const units = m.players.map(p => `<div>${p.units}</div>`).join('');
            const blds = m.players.map(p => `<div>${p.buildings}</div>`).join('');
            const phase = m.phase === 'plan' ? `📝 план R${m.round}` : `⚔ бой R${m.round}`;
            return `<tr>
              <td>${m.id}</td><td>${fmtDur(m.time)}</td><td>${phase}</td>
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
    speed: 'Скорость', armor: 'Броня', bonusVsBuildings: '×базе', healPerSec: 'Лечение/с',
    healRadius: 'Радиус лечения', incomePerRound: 'Доход/раунд', incomeMult: '+доход, доля', maxCount: 'Макс. шт',
    splash: 'Сплэш', slowFactor: 'Замедление, доля', slowDuration: 'Замедление, с',
    planPhaseSec: 'Планирование, с', battleMinSec: 'Мин. бой, с', battleMaxSec: 'Макс. бой, с',
    fatiguePctPerSec: 'Усталость, доля HP/с',
    startGold: 'Стартовое золото', baseIncomePerRound: 'Базовый доход/раунд', incomeGrowthPerRound: 'Рост дохода/раунд',
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
