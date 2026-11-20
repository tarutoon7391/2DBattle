'use strict';
// 遅延・ゆらぎ・パケットロスのある回線を模擬して、
// (1) 確定した状態が両者で一致するか (2) スローにならないか を確認する。サーバー不要:  node test/netcode.test.js
const fs = require('fs'), path = require('path');
const { createSession } = require('../public/net.js');
const simSrc = fs.readFileSync(path.join(__dirname, '../public/chars.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../public/sim.js'), 'utf8');
const makeSim = () => new Function(simSrc + ';return{newState,step,cleanInput};')();
const FRAME = 1000 / 60, GOAL = 1800; // 30秒ぶん

let caseNo = 0;
function run({ name, latency, jitter, loss }) {
  const chars = [caseNo % 6, (caseNo * 2 + 3) % 6]; caseNo++; // ケースごとに違うキャラの組み合わせ
  let t = 0, seq = 0, r = 12345;
  const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const q = [];
  const at = (ms, fn) => q.push({ at: t + ms, seq: seq++, fn });
  const peers = [0, 1].map(i => {
    const sim = makeSim();
    const p = { i, sim, snap: null, doneAt: -1, stalls: 0, held: 0, hold: 0, events: 0 };
    p.ses = createSession(i, o => {
      if (rand() < loss) return;
      const s = JSON.stringify(o);
      at(latency + rand() * jitter, () => peers[1 - i].ses.onMessage(JSON.parse(s)));
    }, () => t, sim.newState('online', chars), (st, inp) => { sim.step(st, inp); return st; });
    p.ses.onSync = (f, st) => { if (f === GOAL) { p.snap = JSON.stringify({ ...st, events: [] }); p.doneAt = t; } };
    return p;
  });
  for (const p of peers) {
    // 人間っぽく、同じ入力を数フレーム押し続ける（予測が当たったり外れたりする）
    const sample = () => { if (p.hold-- <= 0) { p.held = p.sim.cleanInput(rand() < 0.8 ? (rand() * 512) | 0 : 0); p.hold = 2 + ((rand() * 12) | 0); } return p.held; };
    const tick = () => {
      if (!p.ses.tick(sample)) p.stalls++;
      p.events += p.ses.drain().length;
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
  const same = !!a.snap && a.snap === b.snap, speed = ideal / took;
  const ok = same && speed > 0.93;
  const st = JSON.parse(a.snap || '{}');
  console.log(`${ok ? 'OK' : 'NG'} ${name}: 一致=${same} 速度=${(speed * 100).toFixed(0)}% 巻き戻し最大=${Math.max(a.ses.maxRb, b.ses.maxRb)}F 待ち=${a.stalls}/${b.stalls}回 (round=${st.round} hp=${st.p && st.p.map(x => x.hp)} 演出=${a.events}/${b.events})`);
  return ok;
}
const cases = [
  { name: 'P2P 片道10ms', latency: 10, jitter: 3, loss: 0 },
  { name: 'P2P 片道10ms ロス5%', latency: 10, jitter: 5, loss: 0.05 },
  { name: 'P2P 片道30ms ロス2%', latency: 30, jitter: 10, loss: 0.02 },
  { name: '中継 片道90ms', latency: 90, jitter: 10, loss: 0 },
  { name: '中継 片道180ms（米国サーバー経由相当）', latency: 180, jitter: 20, loss: 0 },
  { name: '悪条件 片道250ms ロス10%', latency: 250, jitter: 40, loss: 0.1 },
];
process.exit(cases.map(run).every(Boolean) ? 0 : 1);
