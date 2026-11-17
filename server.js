'use strict';
// 2DBattle サーバー：静的ファイル配信 ＋ 入力を相手に中継するだけの WebSocket。
// ゲームの計算はすべてブラウザ側（public/sim.js）で行う。サーバーは勝敗も状態も持たない。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ルーム: コード → [ws, ws]
const rooms = new Map();
let publicWait = null; // ランダムマッチで相手待ちのルーム
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function leave(ws) {
  const code = ws.room; if (!code) return;
  ws.room = null;
  const players = rooms.get(code); if (!players) return;
  rooms.delete(code);
  if (publicWait === code) publicWait = null;
  for (const other of players) if (other !== ws) { other.room = null; other.peer = null; send(other, { t: 'left' }); }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 });
wss.on('connection', ws => {
  ws.alive = true; ws.room = null; ws.peer = null;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'in') {
      if (ws.peer && Number.isInteger(m.f) && Number.isInteger(m.b)) send(ws.peer, { t: 'in', f: m.f, b: m.b & 511 });
    } else if (m.t === 'join') {
      leave(ws);
      let code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      if (!code) {
        if (publicWait && rooms.has(publicWait)) { code = publicWait; publicWait = null; }
        else { code = '#' + Math.random().toString(36).slice(2, 10); publicWait = code; }
      }
      let players = rooms.get(code);
      if (!players) { players = []; rooms.set(code, players); }
      if (players.length >= 2) { send(ws, { t: 'full' }); return; }
      players.push(ws); ws.room = code;
      if (players.length === 1) send(ws, { t: 'wait', room: code });
      else {
        const seed = (Math.random() * 0xffffffff) >>> 0;
        players[0].peer = players[1]; players[1].peer = players[0];
        send(players[0], { t: 'start', you: 0, seed });
        send(players[1], { t: 'start', you: 1, seed });
      }
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// 切れた接続の掃除（Railway のプロキシ越しでも接続を保つための ping も兼ねる）
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; try { ws.ping(); } catch (e) {}
  }
}, 25000);

server.listen(PORT, () => console.log(`2DBattle listening on :${PORT}`));
