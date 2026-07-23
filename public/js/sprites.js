// Процедурные «спрайты»: юниты и постройки рисуются кодом.
// Используется и в мировом рендере, и для иконок в магазине.

export const OWNER_COLORS = [
  { main: '#4da3ff', dark: '#1e5aa8', light: '#a8d2ff', glow: 'rgba(77,163,255,.55)' },
  { main: '#ff5d5d', dark: '#a82525', light: '#ffb0a8', glow: 'rgba(255,93,93,.55)' },
];

// ---------- Юниты ----------
// ctx уже перенесён в центр юнита, масштаб: 1 тайл = ts пикселей.
export function drawUnit(ctx, type, colors, ts, dir, walkPhase, slowed) {
  const s = ts / 32; // нормализация под базовый размер 32px
  ctx.save();
  ctx.scale(s, s);
  // Тень
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(0, 6, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();

  if (slowed) {
    ctx.strokeStyle = 'rgba(140,220,255,.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
  }
  const bob = Math.sin(walkPhase) * 1.2;
  ctx.translate(0, bob);
  ctx.rotate(dir + Math.PI / 2); // юниты «смотрят» по направлению движения

  switch (type) {
    case 'scout': drawScout(ctx, colors); break;
    case 'soldier': drawSoldier(ctx, colors); break;
    case 'archer': drawArcher(ctx, colors); break;
    case 'tank': drawTank(ctx, colors); break;
    case 'breaker': drawBreaker(ctx, colors); break;
    case 'healer': drawHealer(ctx, colors); break;
    default: drawSoldier(ctx, colors);
  }
  ctx.restore();
}

function body(ctx, colors, r) {
  const g = ctx.createRadialGradient(-r * .35, -r * .35, r * .2, 0, 0, r);
  g.addColorStop(0, colors.light);
  g.addColorStop(.55, colors.main);
  g.addColorStop(1, colors.dark);
  ctx.fillStyle = g;
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

function drawScout(ctx, c) {
  // лёгкий бегун: маленькое тело + капюшон-клин
  body(ctx, c, 6);
  ctx.fillStyle = c.dark;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(4.5, -2); ctx.lineTo(-4.5, -2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(-1, -13, 2, 5); // кинжал
}

function drawSoldier(ctx, c) {
  body(ctx, c, 8);
  // щит
  ctx.fillStyle = '#c8ccd4'; ctx.strokeStyle = '#555';
  ctx.beginPath(); ctx.ellipse(-7, 0, 3, 6.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // меч
  ctx.strokeStyle = '#e8e8ee'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(7, -2); ctx.lineTo(12, -10); ctx.stroke();
  ctx.strokeStyle = '#8a6b30'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(6, -1); ctx.lineTo(8, -4); ctx.stroke();
  // шлем
  ctx.fillStyle = '#aeb6c2';
  ctx.beginPath(); ctx.arc(0, -1, 4.5, Math.PI, 0); ctx.fill();
}

function drawArcher(ctx, c) {
  body(ctx, c, 7);
  // лук
  ctx.strokeStyle = '#a07a3a'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(0, -6, 7, Math.PI * 0.15, Math.PI * 0.85, false); ctx.stroke();
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = .8;
  ctx.beginPath(); ctx.moveTo(-6.6, -3.9); ctx.lineTo(6.6, -3.9); ctx.stroke();
  // стрела
  ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, -12); ctx.stroke();
  // капюшон
  ctx.fillStyle = '#2f6b3a';
  ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
}

function drawTank(ctx, c) {
  // массивный панцирь-шестиугольник
  const r = 11;
  const g = ctx.createRadialGradient(-4, -4, 2, 0, 0, r + 2);
  g.addColorStop(0, c.light); g.addColorStop(.5, c.main); g.addColorStop(1, c.dark);
  ctx.fillStyle = g; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // заклёпки
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    ctx.beginPath(); ctx.arc(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3), 1.1, 0, Math.PI * 2); ctx.fill();
  }
  // смотровая щель
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(-4, -6, 8, 2.5);
}

function drawBreaker(ctx, c) {
  body(ctx, c, 9);
  // рога тарана
  ctx.strokeStyle = '#d8cba8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-5, -6); ctx.quadraticCurveTo(-9, -12, -4, -15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(5, -6); ctx.quadraticCurveTo(9, -12, 4, -15); ctx.stroke();
  ctx.lineCap = 'butt';
  // металлический лоб
  ctx.fillStyle = '#9aa2ae';
  ctx.beginPath(); ctx.arc(0, -4, 5, Math.PI, 0); ctx.fill();
}

function drawHealer(ctx, c) {
  body(ctx, c, 7);
  // белая мантия
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.arc(0, 0, 4.8, 0, Math.PI * 2); ctx.fill();
  // зелёный крест
  ctx.fillStyle = '#2fae5a';
  ctx.fillRect(-1.4, -4, 2.8, 8);
  ctx.fillRect(-4, -1.4, 8, 2.8);
}

// ---------- Постройки ----------
// ctx перенесён в ЦЕНТР клетки, ts = размер тайла.
export function drawBuilding(ctx, type, colors, ts, time, hpFrac) {
  const s = ts / 32;
  ctx.save();
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.beginPath(); ctx.ellipse(0, 11, 13, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  switch (type) {
    case 'mine': drawMine(ctx, colors, time); break;
    case 'bank': drawBank(ctx, colors); break;
    case 'arrow': drawArrowTower(ctx, colors); break;
    case 'cannon': drawCannon(ctx, colors, time); break;
    case 'frost': drawFrost(ctx, colors, time); break;
    case 'barricade': drawBarricade(ctx, colors); break;
  }
  // Повреждения: трещины при < 50% HP
  if (hpFrac !== undefined && hpFrac < 0.5) {
    ctx.strokeStyle = `rgba(0,0,0,${.7 - hpFrac})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(-2, -1); ctx.lineTo(-5, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, -6); ctx.lineTo(3, 0); ctx.lineTo(7, 6); ctx.stroke();
  }
  ctx.restore();
}

function drawMine(ctx, c, time) {
  // деревянный сруб над штольней
  ctx.fillStyle = '#6b4e2a';
  ctx.fillRect(-11, -4, 22, 14);
  ctx.fillStyle = '#543d20';
  ctx.fillRect(-11, -4, 22, 3);
  // крыша
  ctx.fillStyle = '#8a6535';
  ctx.beginPath(); ctx.moveTo(-13, -4); ctx.lineTo(0, -14); ctx.lineTo(13, -4); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke();
  // вход в штольню
  ctx.fillStyle = '#1d1610';
  ctx.beginPath(); ctx.arc(0, 10, 6, Math.PI, 0); ctx.fill();
  // мерцающее золото
  const tw = (Math.sin(time * 3) + 1) / 2;
  ctx.fillStyle = `rgba(245,197,66,${.5 + tw * .5})`;
  ctx.beginPath(); ctx.arc(-4, 7, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3, 8.5, 1.2, 0, Math.PI * 2); ctx.fill();
  // флажок владельца
  flag(ctx, c, 10, -13);
}

function drawBank(ctx, c) {
  // здание с колоннами
  ctx.fillStyle = '#cfc7b4';
  ctx.fillRect(-12, -6, 24, 16);
  ctx.fillStyle = '#e2dbc9';
  for (let i = -9; i <= 9; i += 6) ctx.fillRect(i - 1.5, -5, 3, 14);
  // фронтон
  ctx.fillStyle = '#d8d0bd';
  ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(0, -15); ctx.lineTo(14, -6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
  // монета
  ctx.fillStyle = '#f5c542';
  ctx.beginPath(); ctx.arc(0, -10, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#a8842a'; ctx.lineWidth = .8; ctx.stroke();
  flag(ctx, c, 12, -14);
}

function drawArrowTower(ctx, c) {
  // круглая каменная башня
  const g = ctx.createLinearGradient(-10, 0, 10, 0);
  g.addColorStop(0, '#9aa2ae'); g.addColorStop(.5, '#c3cad4'); g.addColorStop(1, '#7d8590');
  ctx.fillStyle = g;
  ctx.fillRect(-8, -8, 16, 19);
  ctx.beginPath(); ctx.arc(0, -8, 8, Math.PI, 0); ctx.fill();
  // зубцы
  ctx.fillStyle = '#8d95a1';
  for (let i = -8; i < 8; i += 4.5) ctx.fillRect(i, -16, 3, 4);
  // бойница
  ctx.fillStyle = '#20242c';
  ctx.fillRect(-1.5, -6, 3, 7);
  // кладка
  ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = .7;
  for (let y = -4; y < 10; y += 4) { ctx.beginPath(); ctx.moveTo(-8, y); ctx.lineTo(8, y); ctx.stroke(); }
  flag(ctx, c, 6, -18);
}

function drawCannon(ctx, c, time) {
  // квадратный бастион с вращающимся стволом
  ctx.fillStyle = '#5c636e';
  ctx.fillRect(-11, -9, 22, 20);
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.strokeRect(-11, -9, 22, 20);
  ctx.fillStyle = '#6d7580';
  ctx.fillRect(-9, -7, 18, 16);
  // ствол (легкое «дыхание»)
  const a = Math.sin(time * .7) * .4;
  ctx.save();
  ctx.rotate(a);
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(-3, -16, 6, 14);
  ctx.fillStyle = '#41464e';
  ctx.fillRect(-3, -16, 6, 3);
  ctx.restore();
  ctx.fillStyle = '#23262c';
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
  flag(ctx, c, 9, -12);
}

function drawFrost(ctx, c, time) {
  // ледяной кристалл на постаменте
  ctx.fillStyle = '#4a5566';
  ctx.fillRect(-8, 4, 16, 7);
  const pulse = (Math.sin(time * 2) + 1) / 2;
  const g = ctx.createLinearGradient(0, -14, 0, 6);
  g.addColorStop(0, `rgba(190,240,255,${.85 + pulse * .15})`);
  g.addColorStop(1, '#3d9dd6');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#bfeaff'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -15); ctx.lineTo(6, -3); ctx.lineTo(3.5, 6); ctx.lineTo(-3.5, 6); ctx.lineTo(-6, -3);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // блик
  ctx.strokeStyle = `rgba(255,255,255,${.4 + pulse * .4})`;
  ctx.beginPath(); ctx.moveTo(-2, -10); ctx.lineTo(-3.5, -2); ctx.stroke();
  flag(ctx, c, 7, -8);
}

function drawBarricade(ctx, c) {
  // деревянные колья крест-накрест
  ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-10, 8); ctx.lineTo(-2, -10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-2, 8); ctx.lineTo(6, -10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, 8); ctx.lineTo(12, -6); ctx.stroke();
  ctx.strokeStyle = '#8f6b3a';
  ctx.beginPath(); ctx.moveTo(10, 8); ctx.lineTo(-8, -8); ctx.stroke();
  ctx.lineCap = 'butt';
  // верёвка
  ctx.strokeStyle = '#c9b98a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(11, 1); ctx.stroke();
  flag(ctx, c, -11, -8);
}

function flag(ctx, c, x, y) {
  ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = c.main;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y + 1.8); ctx.lineTo(x, y + 3.6); ctx.closePath(); ctx.fill();
}

// ---------- База (замок) ----------
export function drawBase(ctx, colors, ts, time, hpFrac) {
  const s = ts / 32;
  ctx.save();
  ctx.scale(s, s);
  // Тень
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.ellipse(0, 16, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
  // Стены
  const g = ctx.createLinearGradient(-16, 0, 16, 0);
  g.addColorStop(0, '#848c98'); g.addColorStop(.5, '#b9c1cc'); g.addColorStop(1, '#6d7580');
  ctx.fillStyle = g;
  ctx.fillRect(-16, -8, 32, 24);
  // Зубцы стены
  ctx.fillStyle = '#7f8792';
  for (let i = -16; i < 16; i += 6) ctx.fillRect(i, -12, 4, 5);
  // Центральная башня
  ctx.fillStyle = '#98a0ac';
  ctx.fillRect(-8, -22, 16, 16);
  for (let i = -8; i < 8; i += 5) ctx.fillRect(i, -26, 3.4, 5);
  // Ворота
  ctx.fillStyle = '#3a2c18';
  ctx.beginPath(); ctx.arc(0, 16, 7, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(0, 16); ctx.stroke();
  // Окно-бойница со свечением
  const tw = (Math.sin(time * 1.7) + 1) / 2;
  ctx.fillStyle = `rgba(255,200,90,${.5 + tw * .5})`;
  ctx.fillRect(-2, -18, 4, 6);
  // Флаг на шпиле
  ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -36); ctx.stroke();
  const wave = Math.sin(time * 4) * 1.6;
  ctx.fillStyle = colors.main;
  ctx.beginPath();
  ctx.moveTo(0, -36); ctx.quadraticCurveTo(6, -35 + wave, 12, -34);
  ctx.lineTo(12, -29); ctx.quadraticCurveTo(6, -30 + wave, 0, -29);
  ctx.closePath(); ctx.fill();
  // Повреждения
  if (hpFrac < 0.6) {
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-12, -6); ctx.lineTo(-7, 2); ctx.lineTo(-10, 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(5, 4); ctx.lineTo(9, 12); ctx.stroke();
  }
  if (hpFrac < 0.3) {
    // дым
    for (let i = 0; i < 3; i++) {
      const ph = (time * .5 + i * .33) % 1;
      ctx.fillStyle = `rgba(60,60,60,${(1 - ph) * .5})`;
      ctx.beginPath(); ctx.arc(6 - i * 4, -24 - ph * 18, 3 + ph * 5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// Иконка для кнопки магазина.
export function makeIcon(kind, type, ownerColors) {
  const cv = document.createElement('canvas');
  cv.width = 52; cv.height = 52;
  const ctx = cv.getContext('2d');
  ctx.translate(26, 28);
  if (kind === 'unit') drawUnit(ctx, type, ownerColors, 52, -Math.PI / 2, 0, false);
  else drawBuilding(ctx, type, ownerColors, 44, 1.2, 1);
  cv.style.width = '26px'; cv.style.height = '26px';
  return cv;
}
