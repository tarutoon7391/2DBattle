'use strict';
// サーバー中継で2クライアントがランダム入力を流し合い、状態が完全一致するかを確認する。
// 使い方: サーバーを起動してから  node test/lockstep.test.js [ws://localhost:3000/ws]
const fs = require('fs'), path = require('path');
const WebSocket = require('ws');
const { createSession } = require('../public/net.js');
const simSrc = fs.readFileSync(path.join(__dirname, '../public/sim.js'), 'utf8');
const makeSim = () => new Function(simSrc + ';return{newState,step,cleanInput};')();
const URL = process.argv[2] || 'ws://localhost:3000/ws';
const FRAMES = 3000, ROOM = 'T' + Date.now().toString(36).toUpperCase();

function client(seed) {
  return new Promise((resolve, reject) => {
    const sim = makeSim(), ws = new WebSocket(URL);
    let S = null, ses = null, r = seed, done = false;
    const rand = () => (r = (r * 16807) % 2147483647);
    const pump = () => {
      if (done) return;
      while (ses.frame < FRAMES && ses.tick(() => sim.cleanInput(rand() % 20 < 14 ? rand() % 512 : 0), inp => { sim.step(S, inp); S.events.length = 0; }));
      if (ses.frame >= FRAMES) { done = true; resolve(JSON.stringify(S)); }
    };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: ROOM })));
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.t === 'start') {
        S = sim.newState('online'); S.rng = m.seed >>> 0;
        ses = createSession(m.you, o => ws.readyState === 1 && ws.send(JSON.stringify(o)), () => Date.now());
        pump();
      } else if (m.t === 'in') { ses.onMessage(m); pump(); }
      else if (m.t === 'left' && !done) reject(new Error('peer left at frame ' + ses.frame));
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
