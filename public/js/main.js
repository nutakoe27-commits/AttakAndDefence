// Attack & Defence — клиент: экраны, сеть, ввод, HUD.
import { Net } from './net.js';
import { GameState } from './game.js';
import { Renderer, TILE, T } from './render.js';
import { Tutorial } from './tutorial.js';
import { OWNER_COLORS, makeIcon } from './sprites.js';
import { Ya } from './yandex.js';

const $ = (s) => document.querySelector(s);

const net = new Net();
const gs = new GameState();
const canvas = $('#game-canvas');
const renderer = new Renderer(canvas);
const tutorial = new Tutorial();
let gamePaused = false; // пауза при сворачивании/рекламе (требования Яндекс 1.3, 4.7)

// Инициализация SDK Яндекса (no-op на своём хостинге) и облачных сохранений.
(async () => {
  await Ya.init();
  try {
    const prefs = await Ya.loadAll();
    if (prefs.tutorial_done) localStorage.setItem('ad_tutorial_done', '1');
    if (prefs.name && !nameInput.value) nameInput.value = String(prefs.name).slice(0, 20);
  } catch (_) {}
  Ya.loadingReady();   // сообщаем платформе, что игра готова
  Ya.showBanner();     // стики-баннер в меню
  // Пауза геймплея по сигналам платформы и при сворачивании вкладки.
  Ya.on('pause', () => { gamePaused = true; });
  Ya.on('resume', () => { gamePaused = false; });
  document.addEventListener('visibilitychange', () => { gamePaused = document.hidden; });
})();

// ---------- Экраны ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
  checkOrientation();
}

// Карта широкая — на телефоне в портрете просим повернуть устройство.
function checkOrientation() {
  const inGame = $('#screen-game').classList.contains('active');
  const portrait = window.innerHeight > window.innerWidth;
  const isMobileSize = Math.min(window.innerWidth, window.innerHeight) < 620;
  $('#rotate-overlay').classList.toggle('hidden', !(inGame && portrait && isMobileSize));
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(() => { checkOrientation(); renderer.resize(); }, 250));

// ---------- Главное меню ----------
const nameInput = $('#player-name');
nameInput.value = localStorage.getItem('ad_name') || '';

$('#btn-play').addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Полководец';
  localStorage.setItem('ad_name', name);
  Ya.save({ name });
  if (!net.connected) { toast('Нет соединения с сервером', 'err'); return; }
  net.send({ t: 'queue', name });
});
$('#btn-howto').addEventListener('click', () => $('#howto-modal').classList.remove('hidden'));
$('#btn-howto-close').addEventListener('click', () => $('#howto-modal').classList.add('hidden'));
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-play').click(); });

// ---------- Игра с другом (приватные комнаты) ----------
const friendModal = $('#friend-modal');
let roomOpen = false; // мы — хост открытой комнаты

function myName() {
  const name = nameInput.value.trim() || 'Полководец';
  localStorage.setItem('ad_name', name);
  return name;
}

function friendShowChoose() {
  $('#friend-choose').classList.remove('hidden');
  $('#friend-wait').classList.add('hidden');
  $('#friend-error').textContent = '';
}

$('#btn-friend').addEventListener('click', () => {
  if (!net.connected) { toast('Нет соединения с сервером', 'err'); return; }
  friendShowChoose();
  friendModal.classList.remove('hidden');
  $('#room-code-input').value = '';
});

$('#btn-room-create').addEventListener('click', () => {
  net.send({ t: 'createRoom', name: myName() });
});

function joinRoomByCode(code) {
  code = String(code || '').toUpperCase().trim();
  if (code.length !== 4) { $('#friend-error').textContent = 'Код — 4 символа'; return; }
  $('#friend-error').textContent = '';
  net.send({ t: 'joinRoom', code, name: myName() });
}
$('#btn-room-join').addEventListener('click', () => joinRoomByCode($('#room-code-input').value));
$('#room-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoomByCode(e.target.value); });
$('#room-code-input').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''); });

$('#btn-friend-close').addEventListener('click', () => {
  if (roomOpen) { net.send({ t: 'leaveRoom' }); roomOpen = false; }
  friendModal.classList.add('hidden');
});

net.on('roomCreated', (msg) => {
  roomOpen = true;
  $('#friend-choose').classList.add('hidden');
  $('#friend-wait').classList.remove('hidden');
  $('#friend-code').textContent = msg.code;
  $('#friend-link').value = `${location.origin}/?room=${msg.code}`;
  $('#copy-done').textContent = '';
});

net.on('roomError', (msg) => {
  $('#friend-error').textContent = msg.reason || 'Не удалось войти в комнату';
  friendShowChoose();
  friendModal.classList.remove('hidden');
});

net.on('roomLeft', () => { roomOpen = false; });

$('#btn-copy-link').addEventListener('click', async () => {
  const link = $('#friend-link').value;
  try {
    await navigator.clipboard.writeText(link);
    $('#copy-done').textContent = 'Ссылка скопирована — отправьте её другу';
  } catch {
    $('#friend-link').select();
    $('#copy-done').textContent = 'Выделено — нажмите Ctrl+C';
  }
});

// Пришли по ссылке-приглашению (?room=XXXX): входим сразу после подключения (см. обработчик _open).
let inviteCode = new URLSearchParams(location.search).get('room');

// Анимированный фон меню: тлеющие угли над полем боя.
(function menuBg() {
  const cv = $('#menu-bg');
  const ctx = cv.getContext('2d');
  const sparks = [];
  function resize() { cv.width = innerWidth; cv.height = innerHeight; }
  resize(); addEventListener('resize', resize);
  for (let i = 0; i < 70; i++) {
    sparks.push({ x: Math.random(), y: Math.random(), v: .006 + Math.random() * .02, r: 1 + Math.random() * 2.4, ph: Math.random() * 7 });
  }
  let t = 0;
  (function frame() {
    if (!$('#screen-menu').classList.contains('active')) { requestAnimationFrame(frame); return; }
    t += .016;
    const w = cv.width, h = cv.height;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a1020'); g.addColorStop(.6, '#101826'); g.addColorStop(1, '#1a1410');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // силуэты гор/крепостей
    ctx.fillStyle = '#0b1119';
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 40) {
      const yy = h * .72 + Math.sin(x * .01 + 2) * 30 + Math.sin(x * .003) * 60;
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    // зарево по краям
    const gl = ctx.createRadialGradient(w * .15, h * .8, 20, w * .15, h * .8, w * .45);
    gl.addColorStop(0, 'rgba(60,110,220,.18)'); gl.addColorStop(1, 'transparent');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);
    const gr = ctx.createRadialGradient(w * .85, h * .8, 20, w * .85, h * .8, w * .45);
    gr.addColorStop(0, 'rgba(220,70,50,.16)'); gr.addColorStop(1, 'transparent');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    // искры
    for (const s of sparks) {
      s.y -= s.v * .016 * 60 / 10;
      if (s.y < -0.05) { s.y = 1.05; s.x = Math.random(); }
      const flicker = .4 + Math.sin(t * 3 + s.ph) * .3;
      ctx.fillStyle = s.x < .5 ? `rgba(120,170,255,${flicker})` : `rgba(255,150,90,${flicker})`;
      ctx.beginPath(); ctx.arc(s.x * w + Math.sin(t + s.ph) * 14, s.y * h, s.r, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(frame);
  })();
})();

// ---------- Сеть ----------
const connStatus = $('#conn-status');
net.on('_open', () => {
  connStatus.textContent = '● сервер онлайн';
  connStatus.className = 'conn-status ok';
  // Автовход по ссылке-приглашению (однократно).
  if (inviteCode) {
    const code = inviteCode;
    inviteCode = null;
    history.replaceState(null, '', '/'); // чистим URL, чтобы F5 не пытался войти снова
    joinRoomByCode(code);
  }
});
net.on('_close', () => { connStatus.textContent = '● переподключение…'; connStatus.className = 'conn-status err'; });

let queueTimer = null, queueStart = 0;
net.on('queued', (msg) => {
  showScreen('#screen-queue');
  queueStart = Date.now();
  const fallback = msg.botFallbackSec || 20;
  clearInterval(queueTimer);
  queueTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - queueStart) / 1000);
    $('#queue-seconds').textContent = sec;
    const hint = $('#queue-hint');
    if (sec >= fallback - 3 && sec < fallback) {
      hint.textContent = 'Живых соперников не видно… готовим достойного бота';
      hint.classList.add('warn');
    } else if (sec < fallback - 3) {
      hint.textContent = 'Ищем достойного соперника среди игроков';
      hint.classList.remove('warn');
    }
  }, 250);
});
net.on('queueCancelled', () => { clearInterval(queueTimer); showScreen('#screen-menu'); });
$('#btn-cancel-queue').addEventListener('click', () => net.send({ t: 'cancelQueue' }));

net.on('matchStart', (data) => {
  clearInterval(queueTimer);
  roomOpen = false;
  friendModal.classList.add('hidden');
  gs.init(data);
  $('#screen-end').classList.remove('active');
  showScreen('#screen-game');
  renderer.resize(); // канвас мог быть скрыт (размер 0) до показа экрана
  renderer.setMap(data.map, data.yourSlot);
  buildShop();
  ui.placing = null; ui.selectedBuilding = null; ui.balance = gs.balance;
  const enemyMeta = data.players[1 - data.yourSlot];
  $('#hud-my-name').textContent = data.players[data.yourSlot].name + ' (вы)';
  $('#hud-enemy-name').textContent = enemyMeta.name;
  endShown = false;
  Ya.hideBanner();     // прячем баннер во время боя
  Ya.gameplayStart();  // активный геймплей — для корректной паузы рекламы
  if (tutorial.shouldShow()) setTimeout(() => tutorial.start(), 600);
});

let lastPhase = null;
net.on('snap', (msg) => {
  gs.pushSnapshot(msg.s, ev => renderer.addEvent(ev));
  // Смена фазы: тост + сброс режима стройки при выходе войск.
  const ph = msg.s.phase;
  if (ph && ph !== lastPhase) {
    if (lastPhase !== null && !msg.s.over) {
      if (ph === 'battle') {
        stopPlacing();
        toast('⚔ Бой! Войска выходят', 'info');
      } else {
        const me = msg.s.players[gs.mySlot];
        toast(`Раунд ${msg.s.round} · +${me ? me.income : ''} ◉ — планируйте!`, 'info');
      }
    }
    lastPhase = ph;
  }
});

net.on('reject', (msg) => toast(msg.reason, 'err'));

net.on('hello', (msg) => {
  if (msg.reattached) toast('Вы вернулись в бой!', 'info');
});

net.connect();

// ---------- Магазин ----------
const ui = {
  placing: null,          // {type, cx, cy, valid}
  selectedBuilding: null,
  balance: null,
};
// Отладочные хуки (только чтение состояния) — безвредны, полезны для диагностики.
window.__ui = ui;
window.__renderer = renderer;

function buildShop() {
  const myColors = OWNER_COLORS[gs.mySlot];
  const ub = $('#unit-buttons'); ub.innerHTML = '';
  for (const [key, spec] of Object.entries(gs.balance.units)) {
    ub.appendChild(shopButton('unit', key, spec, myColors));
  }
  const bb = $('#build-buttons'); bb.innerHTML = '';
  for (const [key, spec] of Object.entries(gs.balance.buildings)) {
    bb.appendChild(shopButton('building', key, spec, myColors));
  }
}

function shopButton(kind, key, spec, colors) {
  const btn = document.createElement('button');
  btn.className = 'shop-btn';
  btn.dataset.kind = kind; btn.dataset.key = key;
  const icon = document.createElement('div'); icon.className = 'icon';
  icon.appendChild(makeIcon(kind === 'unit' ? 'unit' : 'building', key, colors));
  const name = document.createElement('div'); name.className = 'name'; name.textContent = spec.name;
  const cost = document.createElement('div'); cost.className = 'cost';
  cost.textContent = spec.cost + (kind === 'unit' ? ` ×${spec.pack}` : '');
  const hk = document.createElement('div'); hk.className = 'hotkey'; hk.textContent = (spec.hotkey || '').toUpperCase();
  btn.append(hk, icon, name, cost);
  btn.addEventListener('click', (e) => {
    if (btn.dataset.longpress === '1') { btn.dataset.longpress = ''; e.preventDefault(); return; }
    kind === 'unit' ? orderUnits(key) : startPlacing(key);
  });
  btn.addEventListener('mouseenter', (e) => { if (!isGhostMouse()) showTooltip(btn, kind, key, spec); });
  btn.addEventListener('mouseleave', hideTooltip);
  // Мобильные тултипы: длинное нажатие (~450мс) показывает описание вместо покупки.
  let lpTimer = null;
  btn.addEventListener('touchstart', () => {
    btn.dataset.longpress = '';
    lpTimer = setTimeout(() => {
      btn.dataset.longpress = '1';
      showTooltip(btn, kind, key, spec);
      if (navigator.vibrate) navigator.vibrate(15);
    }, 450);
  }, { passive: true });
  const lpEnd = () => {
    clearTimeout(lpTimer);
    if (btn.dataset.longpress === '1') setTimeout(hideTooltip, 1600);
  };
  btn.addEventListener('touchend', lpEnd, { passive: true });
  btn.addEventListener('touchcancel', lpEnd, { passive: true });
  return btn;
}

function inPlanPhase() { return gs.curr && gs.curr.phase === 'plan'; }

function orderUnits(key) {
  if (!inPlanPhase()) { toast('Заказ юнитов — только в фазе планирования'); return; }
  net.send({ t: 'spawn', unit: key });
}

function startPlacing(key) {
  if (!inPlanPhase()) { toast('Строить можно только в фазе планирования'); return; }
  ui.placing = { type: key, cx: null, cy: null, valid: false };
  ui.selectedBuilding = null;
  $('#selection-panel').classList.add('hidden');
  canvas.classList.add('placing');
  const hint = $('#placement-hint');
  hint.textContent = IS_TOUCH
    ? 'Тапните по горам на своей половине, затем «✓ Построить»'
    : 'Стройте на горах · ЛКМ — построить · ПКМ / Esc — отмена';
  hint.classList.remove('hidden');
  document.querySelectorAll('.shop-btn').forEach(b => b.classList.toggle('active', b.dataset.key === key && b.dataset.kind === 'building'));
  updatePlaceBar();
}

function stopPlacing() {
  ui.placing = null;
  canvas.classList.remove('placing');
  $('#placement-hint').classList.add('hidden');
  document.querySelectorAll('.shop-btn').forEach(b => b.classList.remove('active'));
  updatePlaceBar();
}

function placementValid(type, cx, cy) {
  if (!gs.map || !gs.curr) return false;
  const { w, h, tiles } = gs.map;
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
  if (tiles[cy * w + cx] !== T.ROCK) return false; // строим только на горах
  const half = w / 2;
  if (gs.mySlot === 0 ? cx >= half : cx < half) return false;
  for (const b of gs.curr.buildings) {
    if (b[3] === cx && b[4] === cy) return false;
  }
  const spec = gs.balance.buildings[type];
  const me = gs.me();
  if (me && me.gold < spec.cost) return false;
  if (spec.maxCount) {
    const count = gs.curr.buildings.filter(b => b[1] === gs.mySlot && b[2] === type).length;
    if (count >= spec.maxCount) return false;
  }
  return true;
}

// ---------- Тултипы ----------
const tooltipEl = $('#tooltip');
function showTooltip(el, kind, key, spec) {
  const rows = [];
  if (kind === 'unit') {
    rows.push(`HP ${spec.hp} · Урон ${spec.dmg}${spec.bonusVsBuildings > 1 ? ` (×${spec.bonusVsBuildings} по базе)` : ''}`);
    rows.push(`Скорость ${spec.speed} · Дальность ${spec.range}${spec.armor ? ` · Броня ${spec.armor}` : ''}`);
    if (spec.healPerSec) rows.push(`Лечение ${spec.healPerSec}/с в радиусе ${spec.healRadius}`);
    rows.push(`Пачка: ${spec.pack} шт.`);
  } else {
    rows.push(`HP ${spec.hp}`);
    if (spec.dmg) rows.push(`Урон ${spec.dmg} · Скорострельность ${spec.attackRate}/с · Радиус ${spec.range}`);
    if (spec.splash) rows.push(`Площадь взрыва: ${spec.splash}`);
    if (spec.slowFactor) rows.push(`Замедление ${Math.round(spec.slowFactor * 100)}% на ${spec.slowDuration}с`);
    if (spec.incomePerRound) rows.push(`Доход +${spec.incomePerRound} за раунд`);
    if (spec.incomeMult) rows.push(`Доход +${Math.round(spec.incomeMult * 100)}%${spec.maxCount ? ` · максимум ${spec.maxCount}` : ''}`);
  }
  tooltipEl.innerHTML = `<div class="t-name">${spec.name} <span class="t-cost">◉ ${spec.cost}</span></div>
    <div class="t-desc">${spec.desc}</div>
    <div class="t-stats">${rows.join('<br>')}</div>`;
  tooltipEl.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  tooltipEl.style.left = Math.min(innerWidth - 270, r.left) + 'px';
  tooltipEl.style.bottom = (innerHeight - r.top + 10) + 'px';
  tooltipEl.style.top = 'auto';
}
function hideTooltip() { tooltipEl.classList.add('hidden'); }

// ---------- Тосты ----------
function toast(text, kind = 'err') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'info' ? ' info' : '');
  el.textContent = text;
  $('#toast-wrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 1800);
  setTimeout(() => el.remove(), 2300);
}

// ---------- Ввод: камера, размещение, выбор ----------
let dragging = false, dragMoved = false, lastMouse = null;

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2 || isGhostMouse()) return;
  const mm = renderer.minimapToWorld(e.offsetX, e.offsetY);
  if (mm) {
    renderer.cam.x = mm[0] * TILE; renderer.cam.y = mm[1] * TILE;
    renderer.clampCam();
    dragging = 'minimap';
    return;
  }
  if (ui.placing) {
    tryBuild();
    return;
  }
  dragging = true; dragMoved = false;
  lastMouse = { x: e.clientX, y: e.clientY };
  canvas.classList.add('dragging');
});

window.addEventListener('mousemove', (e) => {
  // На таче браузер шлёт синтетические mouse-события — они не должны трогать призрак постройки.
  if (isGhostMouse()) return;
  if (dragging === 'minimap') {
    const rect = canvas.getBoundingClientRect();
    const mm = renderer.minimapToWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (mm) { renderer.cam.x = mm[0] * TILE; renderer.cam.y = mm[1] * TILE; renderer.clampCam(); }
    return;
  }
  if (dragging && lastMouse) {
    const dx = e.clientX - lastMouse.x, dy = e.clientY - lastMouse.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    renderer.cam.x -= dx / renderer.cam.zoom;
    renderer.cam.y -= dy / renderer.cam.zoom;
    renderer.clampCam();
    lastMouse = { x: e.clientX, y: e.clientY };
  }
  if (ui.placing) {
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    ui.placing.cx = Math.floor(wx); ui.placing.cy = Math.floor(wy);
    ui.placing.valid = placementValid(ui.placing.type, ui.placing.cx, ui.placing.cy);
  }
});

window.addEventListener('mouseup', (e) => {
  if (isGhostMouse()) { dragging = false; dragMoved = false; return; }
  const wasMinimap = dragging === 'minimap';
  const moved = dragMoved;
  dragging = false; dragMoved = false;
  canvas.classList.remove('dragging');
  if (wasMinimap || ui.placing || moved) return;
  if (e.target !== canvas) return;
  // Клик по своей постройке — выбор.
  const rect = canvas.getBoundingClientRect();
  const [wx, wy] = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const cx = Math.floor(wx), cy = Math.floor(wy);
  if (!gs.curr) return;
  const hit = gs.curr.buildings.find(b => b[3] === cx && b[4] === cy && b[1] === gs.mySlot);
  if (hit) selectBuilding(hit);
  else { ui.selectedBuilding = null; $('#selection-panel').classList.add('hidden'); }
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (ui.placing) stopPlacing();
  else { ui.selectedBuilding = null; $('#selection-panel').classList.add('hidden'); }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const z = Math.max(renderer.minZoom, Math.min(renderer.maxZoom, renderer.cam.zoom * factor));
  renderer.cam.zoom = z;
  renderer.clampCam();
}, { passive: false });

// ---------- Тач-управление ----------
// Пан одним пальцем, пинч-зум двумя, тап = выбор/установка призрака постройки.
// preventDefault в touchend подавляет синтетические mouse-события,
// плюс страховка по времени в mouse-обработчиках (lastTouchAt).
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let lastTouchAt = 0;
// Любой тач в документе помечает время — гасим синтетические mouse-события везде.
window.addEventListener('touchstart', () => { lastTouchAt = Date.now(); }, { passive: true, capture: true });
const tc = { panLast: null, pinchDist: 0, pinchMid: null, moved: false, startAt: 0, startPos: null, onMinimap: false };

function touchPos(t) {
  const rect = canvas.getBoundingClientRect();
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  lastTouchAt = Date.now();
  if (e.touches.length === 1) {
    const p = touchPos(e.touches[0]);
    tc.panLast = p; tc.startPos = p; tc.moved = false; tc.startAt = Date.now();
    tc.onMinimap = !!renderer.minimapToWorld(p.x, p.y);
    if (tc.onMinimap) {
      const mm = renderer.minimapToWorld(p.x, p.y);
      renderer.cam.x = mm[0] * TILE; renderer.cam.y = mm[1] * TILE; renderer.clampCam();
    }
  } else if (e.touches.length === 2) {
    tc.panLast = null; tc.onMinimap = false;
    const [a, b] = [touchPos(e.touches[0]), touchPos(e.touches[1])];
    tc.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    tc.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  lastTouchAt = Date.now();
  if (e.touches.length === 2) {
    // Пинч-зум вокруг середины между пальцами.
    const [a, b] = [touchPos(e.touches[0]), touchPos(e.touches[1])];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (tc.pinchDist > 0) {
      const [wx, wy] = renderer.screenToWorld(mid.x, mid.y);
      const z = Math.max(renderer.minZoom, Math.min(renderer.maxZoom, renderer.cam.zoom * (dist / tc.pinchDist)));
      renderer.cam.zoom = z;
      // Держим точку под пальцами на месте.
      const [wx2, wy2] = renderer.screenToWorld(mid.x, mid.y);
      renderer.cam.x += (wx - wx2) * TILE;
      renderer.cam.y += (wy - wy2) * TILE;
      // Заодно пан серединой пинча.
      if (tc.pinchMid) {
        renderer.cam.x -= (mid.x - tc.pinchMid.x) / renderer.cam.zoom;
        renderer.cam.y -= (mid.y - tc.pinchMid.y) / renderer.cam.zoom;
      }
      renderer.clampCam();
    }
    tc.pinchDist = dist; tc.pinchMid = mid;
    tc.moved = true;
    return;
  }
  if (e.touches.length === 1) {
    const p = touchPos(e.touches[0]);
    if (tc.onMinimap) {
      const mm = renderer.minimapToWorld(p.x, p.y);
      if (mm) { renderer.cam.x = mm[0] * TILE; renderer.cam.y = mm[1] * TILE; renderer.clampCam(); }
      tc.moved = true;
      return;
    }
    if (tc.panLast) {
      // Пока сдвиг в пределах порога тапа — не двигаем камеру, иначе тап промахнётся мимо клетки.
      if (!tc.moved && tc.startPos && Math.hypot(p.x - tc.startPos.x, p.y - tc.startPos.y) <= 9) return;
      tc.moved = true;
      const dx = p.x - tc.panLast.x, dy = p.y - tc.panLast.y;
      renderer.cam.x -= dx / renderer.cam.zoom;
      renderer.cam.y -= dy / renderer.cam.zoom;
      renderer.clampCam();
      tc.panLast = p;
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault(); // не даём браузеру сгенерировать mouse-события
  lastTouchAt = Date.now();
  if (e.touches.length > 0) { // остался палец — продолжаем пан им
    tc.panLast = touchPos(e.touches[0]);
    tc.pinchDist = 0;
    return;
  }
  const wasTap = !tc.moved && tc.startPos && Date.now() - tc.startAt < 600 && !tc.onMinimap;
  const pos = tc.startPos;
  tc.panLast = null; tc.pinchDist = 0; tc.onMinimap = false;
  if (!wasTap || !gs.curr) return;
  handleTap(pos.x, pos.y);
}, { passive: false });

canvas.addEventListener('touchcancel', () => { tc.panLast = null; tc.pinchDist = 0; tc.onMinimap = false; }, { passive: true });

function handleTap(sx, sy) {
  hideTooltip();
  const [wx, wy] = renderer.screenToWorld(sx, sy);
  const cx = Math.floor(wx), cy = Math.floor(wy);
  if (ui.placing) {
    // Первый тап ставит призрак, повторный тап той же клетки — строит.
    if (ui.placing.cx === cx && ui.placing.cy === cy) {
      confirmMobilePlacement();
    } else {
      ui.placing.cx = cx; ui.placing.cy = cy;
      ui.placing.valid = placementValid(ui.placing.type, cx, cy);
      updatePlaceBar();
    }
    return;
  }
  const hit = gs.curr.buildings.find(b => b[3] === cx && b[4] === cy && b[1] === gs.mySlot);
  if (hit) selectBuilding(hit);
  else { ui.selectedBuilding = null; $('#selection-panel').classList.add('hidden'); }
}

// Подавление синтетических mouse-событий после тача (страховка к preventDefault).
function isGhostMouse() { return Date.now() - lastTouchAt < 700; }

// ---------- Полноэкранный режим ----------
// Особенно важен на мобилке: убирает адресную строку браузера.
// На iOS Safari Fullscreen API для страниц недоступен — кнопки просто не показываем.
const docEl = document.documentElement;
const fsSupported = !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen);

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const p = (docEl.requestFullscreen || docEl.webkitRequestFullscreen).call(docEl);
      if (p && p.catch) p.catch(() => {});
    }
  } catch { /* браузер отказал — ничего страшного */ }
}

if (fsSupported) {
  $('#btn-fullscreen').classList.remove('hidden');
  if (IS_TOUCH) $('#btn-fullscreen-menu').classList.remove('hidden');
  $('#btn-fullscreen').addEventListener('click', toggleFullscreen);
  $('#btn-fullscreen-menu').addEventListener('click', toggleFullscreen);
  const onFsChange = () => {
    const inFs = isFullscreen();
    $('#btn-fullscreen').textContent = inFs ? '🡼' : '⛶';
    $('#btn-fullscreen').title = inFs ? 'Выйти из полного экрана' : 'На весь экран';
    $('#btn-fullscreen-menu').textContent = inFs ? '🡼 Обычный режим' : '⛶ На весь экран';
    setTimeout(() => { renderer.resize(); checkOrientation(); }, 150);
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
}

function tryBuild() {
  const p = ui.placing;
  if (!p || p.cx === null) return;
  if (!p.valid) { toast('Здесь строить нельзя'); return; }
  net.send({ t: 'build', type: p.type, x: p.cx, y: p.cy });
  // Shift — серийное строительство.
  if (!keys.has('shift')) stopPlacing();
}

// Мобильная стройка: тап ставит призрак, кнопка «✓ Построить» (или повторный тап) подтверждает.
function confirmMobilePlacement() {
  const p = ui.placing;
  if (!p || p.cx === null) return;
  if (!p.valid) { toast('Здесь строить нельзя'); return; }
  net.send({ t: 'build', type: p.type, x: p.cx, y: p.cy });
  // На мобиле остаёмся в режиме стройки (серийное строительство), выход — кнопка ✕.
  p.cx = null; p.cy = null; p.valid = false;
  updatePlaceBar();
}

function updatePlaceBar() {
  if (!IS_TOUCH) return;
  const bar = $('#mobile-place-bar');
  if (ui.placing) {
    bar.classList.remove('hidden');
    $('#btn-place-ok').disabled = !(ui.placing.cx !== null && ui.placing.valid);
  } else {
    bar.classList.add('hidden');
  }
}
$('#btn-place-ok').addEventListener('click', confirmMobilePlacement);
$('#btn-place-cancel').addEventListener('click', stopPlacing);

function selectBuilding(b) {
  ui.selectedBuilding = b[0];
  const spec = gs.balance.buildings[b[2]];
  $('#sel-title').textContent = spec.name;
  const refund = Math.floor(spec.cost * gs.balance.economy.refundRatio * (b[5] / 100));
  $('#sel-info').innerHTML = `Прочность: ${b[5]}%<br>${spec.desc}`;
  $('#btn-sell').textContent = `Продать за ◉ ${refund}`;
  $('#selection-panel').classList.remove('hidden');
}
$('#btn-sell').addEventListener('click', () => {
  if (ui.selectedBuilding !== null) {
    net.send({ t: 'sell', id: ui.selectedBuilding });
    ui.selectedBuilding = null;
    $('#selection-panel').classList.add('hidden');
  }
});

// Горячие клавиши.
// Физическая клавиша, не зависящая от раскладки (кириллица, Dvorak и т.п.):
// 'KeyQ' -> 'q', 'Digit1'/'Numpad1' -> '1', остальное -> e.key ('escape', 'shift', 'arrowleft').
function physKey(e) {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad') && /^\d$/.test(c.slice(6))) return c.slice(6);
  return (e.key || '').toLowerCase();
}

const keys = new Set();
window.addEventListener('keydown', (e) => {
  const k = physKey(e);
  keys.add(k);
  if (!$('#screen-game').classList.contains('active')) return;
  if (k === 'escape') { stopPlacing(); ui.selectedBuilding = null; $('#selection-panel').classList.add('hidden'); return; }
  if (!gs.balance) return;
  for (const [key, spec] of Object.entries(gs.balance.units)) {
    if (spec.hotkey === k) { orderUnits(key); return; }
  }
  for (const [key, spec] of Object.entries(gs.balance.buildings)) {
    if (spec.hotkey === k) { startPlacing(key); return; }
  }
});
window.addEventListener('keyup', (e) => keys.delete(physKey(e)));

$('#btn-surrender').addEventListener('click', () => {
  if (confirm('Сдаться и покинуть бой?')) net.send({ t: 'surrender' });
});

// ---------- HUD ----------
let lastHudUpdate = 0;
function updateHud(now) {
  if (now - lastHudUpdate < 150 || !gs.curr) return;
  lastHudUpdate = now;
  const me = gs.me(), enemy = gs.enemy();
  $('#hud-gold').textContent = me.gold;
  $('#hud-income').textContent = `+${me.income} за раунд`;
  const t = Math.max(0, gs.curr.time | 0);
  const mm = String((t / 60) | 0).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
  const timerEl = $('#hud-timer');
  timerEl.textContent = `${mm}:${ss}`;
  const sdAt = gs.balance.match.suddenDeathAtSec;
  timerEl.classList.toggle('warn', t > sdAt - 60 && t < sdAt);
  $('#hud-sd').classList.toggle('hidden', !gs.curr.sd);
  // Фазовый баннер: планирование с обратным отсчётом / бой.
  const phaseEl = $('#hud-phase');
  if (gs.curr.phase === 'plan') {
    const left = Math.max(0, Math.ceil(gs.curr.planLeft));
    phaseEl.textContent = `Раунд ${gs.curr.round} · планирование 0:${String(left).padStart(2, '0')}`;
    phaseEl.className = 'hud-phase plan' + (left <= 5 ? ' urgent' : '');
  } else {
    phaseEl.textContent = `⚔ Раунд ${gs.curr.round} · БОЙ`;
    phaseEl.className = 'hud-phase battle';
  }
  updateQueueRow();
  $('#hud-my-hp').style.width = (me.baseHp / me.baseHpMax * 100) + '%';
  $('#hud-my-hp-text').textContent = `${me.baseHp} / ${me.baseHpMax}`;
  $('#hud-enemy-hp').style.width = (enemy.baseHp / enemy.baseHpMax * 100) + '%';
  $('#hud-enemy-hp-text').textContent = `${enemy.baseHp} / ${enemy.baseHpMax}`;
  // Блокировка кнопок: не хватает золота или идёт бой.
  const battle = gs.curr.phase === 'battle';
  document.querySelectorAll('.shop-btn').forEach(btn => {
    const spec = (btn.dataset.kind === 'unit' ? gs.balance.units : gs.balance.buildings)[btn.dataset.key];
    btn.classList.toggle('locked', battle || me.gold < spec.cost);
  });
  // Мобильный призрак стройки: пере-валидируем (золото/занятость меняются).
  if (IS_TOUCH && ui.placing && ui.placing.cx !== null) {
    ui.placing.valid = placementValid(ui.placing.type, ui.placing.cx, ui.placing.cy);
    updatePlaceBar();
  }
}

// Очередь юнитов текущего раунда: чипы с количеством, клик = отменить пачку.
let lastQueueJson = '';
function updateQueueRow() {
  const q = gs.curr.myQueue || {};
  const json = JSON.stringify(q) + gs.curr.phase;
  if (json === lastQueueJson) return;
  lastQueueJson = json;
  const row = $('#queue-row');
  row.innerHTML = '';
  const entries = Object.entries(q);
  if (!entries.length) {
    row.innerHTML = `<span class="queue-empty">${gs.curr.phase === 'plan' ? 'очередь пуста' : 'войска в бою'}</span>`;
    return;
  }
  for (const [type, count] of entries) {
    const spec = gs.balance.units[type];
    if (!spec) continue;
    const chip = document.createElement('span');
    chip.className = 'queue-chip';
    chip.title = `Убрать пачку (${spec.name}) — вернёт ◉ ${spec.cost}`;
    chip.innerHTML = `${spec.name} ×${count} <span class="x">✕</span>`;
    chip.addEventListener('click', () => net.send({ t: 'unqueue', unit: type }));
    row.appendChild(chip);
  }
}

// ---------- Конец матча ----------
let endShown = false;
function maybeShowEnd() {
  if (!gs.over || endShown) return;
  endShown = true;
  stopPlacing();
  Ya.gameplayStop(); // матч окончен — снимаем разметку геймплея
  setTimeout(() => {
    const meWon = gs.winner === gs.mySlot;
    const draw = gs.winner === null || gs.winner === undefined;
    const title = $('#end-title');
    title.textContent = draw ? 'Ничья' : meWon ? '⚔ ПОБЕДА!' : 'Поражение';
    title.className = draw ? 'draw' : meWon ? 'win' : 'lose';
    const reasons = {
      base: draw ? 'Обе базы пали одновременно' : meWon ? 'Вражеская база уничтожена!' : 'Ваша база уничтожена',
      surrender: meWon ? 'Противник сдался' : 'Вы сдались',
      disconnect: meWon ? 'Противник покинул бой' : 'Потеряно соединение',
      timeout: 'Время вышло — победил владелец более крепкой базы',
      draw: 'Абсолютное равенство сил',
      admin: 'Матч остановлен администратором',
    };
    $('#end-reason').textContent = reasons[gs.reason] || '';
    const me = gs.me(), enemy = gs.enemy();
    const t = gs.curr.time | 0;
    $('#end-stats').innerHTML = `
      <tr><th></th><th>Вы</th><th>Противник</th></tr>
      <tr><td>Убито врагов</td><td>${me.kills}</td><td>${enemy.kills}</td></tr>
      <tr><td>Потеряно бойцов</td><td>${me.losses}</td><td>${enemy.losses}</td></tr>
      <tr><td>HP базы</td><td>${me.baseHp}</td><td>${enemy.baseHp}</td></tr>
      <tr><td>Длительность</td><td colspan="2">${(t / 60) | 0} мин ${t % 60} c</td></tr>`;
    showScreen('#screen-end');
  }, 1400);
}

$('#btn-back-menu').addEventListener('click', async () => {
  net.send({ t: 'leaveMatch' });
  // Реклама в логической паузе (между матчами), затем возврат в меню.
  await Ya.showInterstitial();
  showScreen('#screen-menu');
  Ya.showBanner();
});

// ---------- Игровой цикл ----------
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  // Пауза при сворачивании/рекламе: не рендерим (экономим CPU; звук бы заглушался).
  if (gamePaused) { requestAnimationFrame(frame); return; }
  if ($('#screen-game').classList.contains('active') || $('#screen-end').classList.contains('active')) {
    // Стрелки — панорама.
    const pan = 520 * dt / renderer.cam.zoom;
    if (keys.has('arrowleft')) renderer.cam.x -= pan;
    if (keys.has('arrowright')) renderer.cam.x += pan;
    if (keys.has('arrowup')) renderer.cam.y -= pan;
    if (keys.has('arrowdown')) renderer.cam.y += pan;
    renderer.clampCam();
    renderer.draw(gs.interpolated(), dt, ui);
    updateHud(now);
    maybeShowEnd();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
