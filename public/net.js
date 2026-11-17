'use strict';
// ================= オンライン同期（ロールバック方式） =================
// 互いに「Nフレーム目の入力」だけを送り合う。相手の入力が届くのを待たずに
// 「相手はさっきと同じ入力を続けている」と予測して先に進め、
// 実際の入力が届いて予測が外れていたら、その時点まで巻き戻して計算し直す。
// → 自分の操作は回線が遅くても DELAY フレームで反応し、判定は最終的に両者で必ず一致する。
// パケットは「相手が未受信の入力すべて」を毎回載せるので、再送なしの通信路（WebRTC）でも
// 順番どおり届く通信路（WebSocket中継）でも同じコードで動く。DOM 非依存（Node のテストからも使う）。
const NET_DELAY=2, NET_MAX_PRED=24, NET_MAX_PACK=40, NET_FRAME_MS=1000/60;
const netClone=typeof structuredClone==='function'?structuredClone:(o=>JSON.parse(JSON.stringify(o)));
// state: 初期状態 / stepFn(state,[p1入力,p2入力]) → 次の状態（同じオブジェクトを書き換えて返してよい）
function createSession(you, send, now, state, stepFn){
  const n={you,state,frame:0,synced:0,sent:-1,local:{},remote:{},used:{},snap:{},shown:{},
           localMin:0,rAck:-1,peerAck:-1,lastReal:0,stall:0,rtt:-1,ahead:0,rollbacks:0,maxRb:0,out:[],onSync:null};
  n.packet=()=>{
    const b=[], f=n.peerAck+1;
    for(let k=f;k<=n.sent&&b.length<NET_MAX_PACK;k++) b.push(n.local[k]);
    return{t:'in',f,b,a:n.rAck,c:n.frame};
  };
  function sim(f,fresh){ // フレーム f を1つ進める。演出イベントは「まだ出していないもの」だけ外へ渡す
    const ri=n.remote[f]!==undefined?n.remote[f]:n.lastReal, li=n.local[f];
    n.used[f]=ri;
    n.state=stepFn(n.state,you===0?[li,ri]:[ri,li]);
    const ev=n.state.events;
    if(ev&&ev.length){
      const seen=n.shown[f]||(n.shown[f]={});
      for(const e of ev){
        const k=e.type+':'+(e.owner!==undefined?e.owner:'')+':'+(e.i!==undefined?e.i:'');
        if(fresh||!seen[k]){seen[k]=1; n.out.push(e);}
      }
      n.state.events=[];
    }
  }
  // sample(): 今の自分の入力を返す。戻り値 false は「相手の入力が遅れすぎて待っている」
  n.tick=sample=>{
    // 1. 自分の入力を DELAY フレーム先に予約して送る
    const target=n.frame+NET_DELAY;
    if(n.sent<target){
      const b=sample();
      while(n.sent<target) n.local[++n.sent]=b;
      send(n.packet());
    }
    // 2. 届いた入力と予測を照合し、外れていた最初のフレームから計算し直す
    let rb=-1, f=n.synced;
    for(;f<n.frame&&n.remote[f]!==undefined;f++) if(rb<0&&n.used[f]!==n.remote[f]) rb=f;
    if(rb>=0){
      n.state=netClone(n.snap[rb]);
      for(let g=rb;g<n.frame;g++){ if(g>rb) n.snap[g]=netClone(n.state); sim(g,false); }
      n.rollbacks++; n.maxRb=Math.max(n.maxRb,n.frame-rb);
    }
    for(let g=n.synced;g<f;g++){ // ここまでは確定。古い記録を捨てる
      if(n.onSync) n.onSync(g+1,g+1===n.frame?n.state:n.snap[g+1]);
      delete n.snap[g]; delete n.used[g]; delete n.remote[g]; delete n.shown[g];
    }
    n.synced=f;
    while(n.localMin<=n.peerAck&&n.localMin<n.synced) delete n.local[n.localMin++];
    // 3. 予測で進みすぎない（相手の入力が長く来ないときは待つ）
    if(n.frame-n.synced>=NET_MAX_PRED){ if(++n.stall%4===0) send(n.packet()); return false; }
    n.stall=0;
    // 4. 1フレーム進める
    n.snap[n.frame]=netClone(n.state);
    sim(n.frame,true);
    n.frame++;
    return true;
  };
  n.drain=()=>{const o=n.out; n.out=[]; return o;};
  n.ping=()=>send({t:'ping',ts:now()});
  n.onMessage=m=>{
    if(!m||typeof m!=='object') return;
    if(m.t==='in'){
      if(!Number.isInteger(m.f)||!Array.isArray(m.b)||m.b.length>NET_MAX_PACK) return;
      for(let i=0;i<m.b.length;i++){
        const f=m.f+i;
        if(f>=n.synced&&f<n.frame+600&&n.remote[f]===undefined&&Number.isInteger(m.b[i])) n.remote[f]=m.b[i]&511;
      }
      while(n.remote[n.rAck+1]!==undefined){n.rAck++; n.lastReal=n.remote[n.rAck];}
      if(Number.isInteger(m.a)&&m.a>n.peerAck&&m.a<=n.sent) n.peerAck=m.a;
      if(Number.isInteger(m.c)){
        const d=m.c+(n.rtt>0?n.rtt/2/NET_FRAME_MS:0)-n.frame; // 相手が何フレーム先にいるか
        n.ahead=n.ahead*0.9+d*0.1;
      }
    }else if(m.t==='ping'){ send({t:'pong',ts:m.ts}); }
    else if(m.t==='pong'&&typeof m.ts==='number'){
      const r=Math.max(0,now()-m.ts);
      n.rtt=n.rtt<0?r:n.rtt*0.7+r*0.3;
    }
  };
  n.behind=()=>n.ahead>1; // 相手より遅れている → 呼び出し側で少し早回しして時刻を合わせる
  return n;
}
if(typeof module!=='undefined') module.exports={createSession};
