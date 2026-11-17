'use strict';
// サーバー経由で2クライアントがランダム入力を流し合い、最終状態が完全一致するかを確認する。
// 使い方: サーバーを起動してから  node test/lockstep.test.js [ws://localhost:3000/ws]
const fs = require('fs'), path = require('path');
const WebSocket = require('ws');
const simSrc = fs.readFileSync(path.join(__dirname, '../public/sim.js'), 'utf8');
const makeSim = () => new Function(simSrc + ';return{newState,step,cleanInput};')();
const URL = process.argv[2] || 'ws://localhost:3000/ws';
const DELAY = 3, FRAMES = 3000, ROOM = 'T' + Date.now().toString(36).toUpperCase();

function client(seed) {
  return new Promise((resolve, reject) => {
    const sim = makeSim(), ws = new WebSocket(URL);
    let S = null, you = -1, frame = 0, sent = DELAY - 1, r = seed;
    const local = {}, remote = {};
    const rand = () => (r = (r * 16807) % 2147483647);
    const pump = () => {
      for (;;) {
        if (frame >= FRAMES) { ws.close(); return resolve(JSON.stringify(S)); }
        const target = frame + DELAY;
        if (sent < target) {
          const b = sim.cleanInput(rand() % 20 < 14 ? rand() % 512 : 0);
          local[target] = b; sent = target; ws.send(JSON.stringify({ t: 'in', f: target, b }));
        }
        const li = frame < DELAY ? 0 : local[frame], ri = frame < DELAY ? 0 : remote[frame];
        if (ri === undefined) return;
        sim.step(S, you === 0 ? [li, ri] : [ri, li]); S.events.length = 0; frame++;
      }
    };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: ROOM })));
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.t === 'start') { you = m.you; S = sim.newState('online'); S.rng = m.seed >>> 0; pump(); }
      else if (m.t === 'in') { remote[m.f] = m.b; if (S) pump(); }
      else if (m.t === 'left' && frame < FRAMES) reject(new Error('peer left at frame ' + frame));
    });
    ws.on('error', reject);
  });
}
Promise.all([client(11), client(97)]).then(([a, b]) => {
  const s = JSON.parse(a);
  console.log(`frames=${s.frame} round=${s.round} wins=${s.wins} hp=${s.p.map(p => p.hp)}`);
  if (a !== b) { console.error('NG: 状態が一致しません（デシンク）'); process.exit(1); }
  console.log('OK: 両クライアントの状態が完全一致');
  process.exit(0);
}).catch(e => { console.error('NG:', e.message); process.exit(1); });
