'use strict';
// Attack & Defence — точка входа.
// HTTP: статика клиента и админки + admin API. WS (/ws): игровой протокол.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const balance = require('./balance');
const admin = require('./admin');
const { Lobby, newToken } = require('./match');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
// Заглушка под будущий домен: когда купите домен, задайте PUBLIC_ORIGIN=https://ваш-домен
// (используется для логов/ссылок; клиент работает по относительным URL и не требует правок).
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || `http://<IP-вашего-сервера>:${PORT}`;

balance.load();
const lobby = new Lobby();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/admin' || urlPath === '/admin/') urlPath = '/admin/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  // Защита от выхода за пределы public/.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

const wss = new WebSocketServer({ noServer: true });
let onlineSockets = new Set();

const server = http.createServer(async (req, res) => {
  const handled = await admin.handle(req, res, lobby, () => onlineSockets.size);
  if (!handled) serveStatic(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  onlineSockets.add(ws);
  ws.isAlive = true;
  ws.playerToken = null;
  ws.playerName = 'Игрок';

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString().slice(0, 4096)); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'hello': {
        // Клиент присылает свой токен (или получает новый). По токену возможен реконнект в бой.
        const token = (typeof msg.token === 'string' && /^[a-f0-9]{32}$/.test(msg.token)) ? msg.token : newToken();
        ws.playerToken = token;
        ws.playerName = sanitizeName(msg.name);
        const reattached = lobby.tryReattach(token, ws);
        ws.send(JSON.stringify({ t: 'hello', token, reattached }));
        break;
      }
      case 'playBot': {
        if (!ws.playerToken) return;
        ws.playerName = sanitizeName(msg.name || ws.playerName);
        lobby.startBotMatch(ws, ws.playerName, ws.playerToken, String(msg.difficulty || 'medium'));
        break;
      }
      case 'createRoom': {
        if (!ws.playerToken) return;
        ws.playerName = sanitizeName(msg.name || ws.playerName);
        const code = lobby.createRoom(ws, ws.playerName, ws.playerToken);
        ws.send(JSON.stringify({ t: 'roomCreated', code }));
        break;
      }
      case 'joinRoom': {
        if (!ws.playerToken) return;
        ws.playerName = sanitizeName(msg.name || ws.playerName);
        const res = lobby.joinRoom(msg.code, ws, ws.playerName, ws.playerToken);
        if (!res.ok) ws.send(JSON.stringify({ t: 'roomError', reason: res.error }));
        // при успехе оба игрока получают matchStart из startMatch
        break;
      }
      case 'leaveRoom':
        lobby.leaveRoomByWs(ws);
        ws.send(JSON.stringify({ t: 'roomLeft' }));
        break;
      case 'spawn': case 'unqueue': case 'build': case 'sell': case 'surrender': case 'pauseMatch': {
        const ref = ws.playerToken ? lobby.byToken.get(ws.playerToken) : null;
        if (ref && ref.runner.sockets[ref.slot] === ws) ref.runner.handleCommand(ref.slot, msg);
        break;
      }
      case 'leaveMatch': {
        // Игрок вышел на главный экран после конца матча.
        const ref = ws.playerToken ? lobby.byToken.get(ws.playerToken) : null;
        if (ref && ref.runner.match.over) lobby.byToken.delete(ws.playerToken);
        break;
      }
      case 'leaderboard': {
        const db = require('./db');
        if (!db.enabled) { ws.send(JSON.stringify({ t: 'leaderboard', disabled: true, top: [], me: null })); break; }
        ws.send(JSON.stringify({
          t: 'leaderboard',
          top: db.topPlayers(50),
          me: ws.playerToken ? db.playerRank(ws.playerToken) : null,
        }));
        break;
      }
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong', now: Date.now() }));
        break;
    }
  });

  ws.on('close', () => {
    onlineSockets.delete(ws);
    lobby.handleDisconnect(ws);
  });
  ws.on('error', () => { /* закрытие обработает close */ });
});

function sanitizeName(name) {
  const s = String(name || '').replace(/[^\p{L}\p{N} _\-\.]/gu, '').trim().slice(0, 20);
  return s || 'Игрок';
}

// Пинг мёртвых сокетов.
setInterval(() => {
  for (const ws of onlineSockets) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 30000);

server.listen(PORT, HOST, () => {
  console.log('══════════════════════════════════════════════');
  console.log('  Attack & Defence — сервер запущен');
  console.log(`  Локально:  http://localhost:${PORT}`);
  console.log(`  Публично:  ${PUBLIC_ORIGIN}`);
  console.log(`  Админка:   ${PUBLIC_ORIGIN}/admin`);
  console.log('══════════════════════════════════════════════');
});
