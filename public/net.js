'use strict';
// ================= オンライン同期（ロックステップ・可変ディレイ） =================
// 互いに「Nフレーム目の入力」だけを送り合い、両方そろったフレームだけ進める。
// - 入力は delay フレーム先に予約。delay は ping から自動調整（遅い回線でもスローにならない）
// - パケットは「相手が未受信の入力すべて」を毎回載せる。届かなくても次のパケットで埋まるので、
//   再送なしの通信路（WebRTC）でも、順番どおり届く通信路（WebSocket中継）でも同じコードで動く
// DOM に依存しないので Node のテストからも使える。
const NET_MIN_DELAY=2, NET_MAX_DELAY=15, NET_MAX_PACK=30, NET_FRAME_MS=1000/60;
function createSession(you, send, now){
  const n={you,frame:0,sent:-1,delay:3,local:{},remote:{},localMin:0,rAck:-1,peerAck:-1,
           stall:0,rtt:-1,low:0,ahead:0};
  n.packet=()=>{
    const b=[], f=n.peerAck+1;
    for(let k=f;k<=n.sent&&b.length<NET_MAX_PACK;k++) b.push(n.local[k]);
    return{t:'in',f,b,a:n.rAck,c:n.frame};
  };
  // sample(): 今の自分の入力を返す / stepFn([p1入力,p2入力]): 1フレーム進める
  n.tick=(sample,stepFn)=>{
    const target=n.frame+n.delay;
    if(n.sent<target){
      const b=sample();
      while(n.sent<target) n.local[++n.sent]=b;
      send(n.packet());
    }
    const li=n.local[n.frame], ri=n.remote[n.frame];
    if(ri===undefined){ if(++n.stall%4===0) send(n.packet()); return false; }
    n.stall=0;
    stepFn(you===0?[li,ri]:[ri,li]);
    delete n.remote[n.frame]; n.frame++;
    while(n.localMin<=n.peerAck&&n.localMin<n.frame) delete n.local[n.localMin++];
    return true;
  };
  n.ping=()=>send({t:'ping',ts:now()});
  n.onMessage=m=>{
    if(!m||typeof m!=='object') return;
    if(m.t==='in'){
      if(!Number.isInteger(m.f)||!Array.isArray(m.b)||m.b.length>NET_MAX_PACK) return;
      for(let i=0;i<m.b.length;i++){
        const f=m.f+i;
        if(f>=n.frame&&f<n.frame+600&&n.remote[f]===undefined&&Number.isInteger(m.b[i])) n.remote[f]=m.b[i]&511;
      }
      while(n.remote[n.rAck+1]!==undefined) n.rAck++;
      if(Number.isInteger(m.a)&&m.a>n.peerAck&&m.a<=n.sent) n.peerAck=m.a;
      if(Number.isInteger(m.c)){
        const d=m.c+(n.rtt>0?n.rtt/2/NET_FRAME_MS:0)-n.frame; // 相手が何フレーム先にいるか
        n.ahead=n.ahead*0.9+d*0.1;
      }
    }else if(m.t==='ping'){ send({t:'pong',ts:m.ts}); }
    else if(m.t==='pong'&&typeof m.ts==='number'){
      const r=Math.max(0,now()-m.ts);
      n.rtt=n.rtt<0?r:n.rtt*0.7+r*0.3;
      const need=Math.min(NET_MAX_DELAY,Math.max(NET_MIN_DELAY,Math.ceil(n.rtt/2/NET_FRAME_MS)+1));
      if(need>n.delay){n.delay=need; n.low=0;}
      else if(need<n.delay){ if(++n.low>=6){n.delay--; n.low=0;} }
      else n.low=0;
    }
  };
  n.behind=()=>n.ahead>1.5; // 相手より遅れている → 呼び出し側で少し早回しする
  return n;
}
if(typeof module!=='undefined') module.exports={createSession};
