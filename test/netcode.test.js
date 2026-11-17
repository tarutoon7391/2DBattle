'use strict';
// 遅延・ゆらぎ・パケットロスのある回線を模擬して、(1) 状態が一致するか (2) スローにならないか を確認する。
// サーバー不要:  node test/netcode.test.js
const fs = require('fs'), path = require('path');
const { createSession } = require('../public/net.js');
const simSrc = fs.readFileSync(path.join(__dirname, '../public/sim.js'), 'utf8');
const makeSim = () => new Function(simSrc + ';return{newState,step,cleanInput};')();
const FRAME = 1000 / 60, GOAL = 1800; // 30秒ぶん

function run({ name, latency, jitter, loss }) {
  let t = 0, seq = 0, r = 12345;
  const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const q = []; // {at, seq, fn}
  const at = (ms, fn) => q.push({ at: t + ms, seq: seq++, fn });
  const peers = [0, 1].map(i => {
    const sim = makeSim(), S = sim.newState('online');
    const p = { i, sim, S, snap: null, doneAt: -1, stalls: 0 };
    p.ses = createSession(i, o => {
      if (rand() < loss) return;
      const s = JSON.stringify(o);
      at(latency + rand() * jitter, () => peers[1 - i].ses.onMessage(JSON.parse(s)));
    }, () => t);
    return p;
  });
  for (const p of peers) {
    const tick = () => {
      const ok = p.ses.tick(() => p.sim.cleanInput(rand() < 0.7 ? (rand() * 512) | 0 : 0),
        inp => { p.sim.step(p.S, inp); p.S.events.length = 0; });
      if (!ok) p.stalls++;
      if (p.ses.frame === GOAL && !p.snap) { p.snap = JSON.stringify(p.S); p.doneAt = t; }
      if (!p.snap) at(p.ses.behind() ? FRAME * 8 / 9 : FRAME, tick);
    };
    at(p.i * 7, tick);
    const ping = () => { p.ses.ping(); if (!p.snap) at(500, ping); };
    at(p.i * 3, ping);
  }
  while (q.length && t < 120000) {
    let k = 0; for (let j = 1; j < q.length; j++) if (q[j].at < q[k].at || (q[j].at === q[k].at && q[j].seq < q[k].seq)) k = j;
    const e = q.splice(k, 1)[0]; t = e.at; e.fn();
    if (peers[0].snap && peers[1].snap) break;
  }
  const [a, b] = peers, took = Math.max(a.doneAt, b.doneAt) / 1000, ideal = GOAL / 60;
  const same = a.snap && a.snap === b.snap, speed = ideal / took;
  const ok = same && speed > 0.93;
  console.log(`${ok ? 'OK' : 'NG'} ${name}: 一致=${!!same} 速度=${(speed * 100).toFixed(0)}% 入力遅延=${a.ses.delay}F/${b.ses.delay}F 待ち=${a.stalls}/${b.stalls}回`);
  return ok;
}
const cases = [
  { name: 'P2P 片道10ms', latency: 10, jitter: 3, loss: 0 },
  { name: 'P2P 片道10ms ロス5%', latency: 10, jitter: 5, loss: 0.05 },
  { name: 'P2P 片道30ms ロス2%', latency: 30, jitter: 10, loss: 0.02 },
  { name: '中継 片道90ms', latency: 90, jitter: 10, loss: 0 },
  { name: '中継 片道180ms（米国サーバー経由相当）', latency: 180, jitter: 20, loss: 0 },
  { name: '悪条件 片道120ms ロス10%', latency: 120, jitter: 40, loss: 0.1 },
];
const all = cases.map(run).every(Boolean);
process.exit(all ? 0 : 1);
