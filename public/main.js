// ================= 入力・描画・オンライン通信 =================
'use strict';
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
const COL=[{body:'#ff6a4d',light:'#ffd0b8',dark:'#8a2a1a'},{body:'#4da3ff',light:'#c8e4ff',dark:'#1a4a8a'}];
let S=newState('cpu'), showBoxes=false, dummyGuard=true;

// ---------- 入力 ----------
const keys=new Set();
const KEY_P1={KeyW:BT.UP,KeyS:BT.DOWN,KeyA:BT.LEFT,KeyD:BT.RIGHT,KeyJ:BT.L,KeyK:BT.M,KeyL:BT.H,KeyU:BT.SP,KeyI:BT.SU};
const KEY_P2={ArrowUp:BT.UP,ArrowDown:BT.DOWN,ArrowLeft:BT.LEFT,ArrowRight:BT.RIGHT,
  Comma:BT.L,Period:BT.M,Slash:BT.H,Semicolon:BT.SP,Quote:BT.SU,
  Numpad1:BT.L,Numpad2:BT.M,Numpad3:BT.H,Numpad4:BT.SP,Numpad5:BT.SU};
addEventListener('keydown',e=>{
  if(e.target&&e.target.tagName==='INPUT') return;
  if(e.code==='F2'){e.preventDefault(); toggleBoxes(); return;}
  if(KEY_P1[e.code]!=null||KEY_P2[e.code]!=null||e.code==='Space') e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>keys.clear());
function keyBits(map){let b=0; for(const k in map) if(keys.has(k)) b|=map[k]; return b;}
function padBits(gp){
  if(!gp) return 0;
  let b=0; const ax=gp.axes[0]||0, ay=gp.axes[1]||0, bt=k=>gp.buttons[k]&&gp.buttons[k].pressed;
  if(ax<-0.5||bt(14))b|=BT.LEFT; if(ax>0.5||bt(15))b|=BT.RIGHT;
  if(ay<-0.5||bt(12))b|=BT.UP; if(ay>0.5||bt(13))b|=BT.DOWN;
  if(bt(2))b|=BT.L; if(bt(3))b|=BT.M; if(bt(5)||bt(7))b|=BT.H; if(bt(0))b|=BT.SP; if(bt(1)||bt(4)||bt(6))b|=BT.SU;
  return b;
}
function humanInputs(){
  let pads=[]; try{pads=[...(navigator.getGamepads?navigator.getGamepads():[])].filter(Boolean);}catch(e){}
  if(S.mode==='2p') return[keyBits(KEY_P1)|padBits(pads[0]), keyBits(KEY_P2)|padBits(pads[1])];
  return[keyBits(KEY_P1)|keyBits(KEY_P2)|padBits(pads[0]), 0];
}

// ---------- UI ----------
const modeBtns=[...document.querySelectorAll('[data-mode]')];
const btnBoxes=document.getElementById('btnBoxes'), btnGuard=document.getElementById('btnGuard');
function pname(i){
  if(S.mode==='online') return (i===0?'P1':'P2')+(net&&net.you===i?'（あなた）':'');
  return i===0?'P1':(S.mode==='2p'?'P2':S.mode==='cpu'?'CPU':'DUMMY');
}
function setMode(mode){
  if(mode!=='online'||S.mode!=='online') leaveOnline();
  S=newState(mode); S.dummyGuard=dummyGuard; resetFx();
  onlinePanel.hidden=mode!=='online';
  if(mode==='online'&&!net) setStatus('ルームコードを決めて「入室」。空欄ならランダムマッチ');
  modeBtns.forEach(b=>b.classList.toggle('on',b.dataset.mode===mode));
  btnGuard.disabled=mode!=='training';
  cv.focus();
}
modeBtns.forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
function toggleBoxes(){showBoxes=!showBoxes; btnBoxes.innerHTML=`判定表示 ${showBoxes?'ON':'OFF'} <kbd>F2</kbd>`; btnBoxes.classList.toggle('on',showBoxes);}
btnBoxes.onclick=()=>{toggleBoxes(); cv.focus();};
btnGuard.onclick=()=>{dummyGuard=!dummyGuard; S.dummyGuard=dummyGuard; btnGuard.textContent=`ダミーガード ${dummyGuard?'ON':'OFF'}`; btnGuard.classList.toggle('on',dummyGuard); cv.focus();};
document.getElementById('btnReset').onclick=()=>{if(S.mode!=='online') setMode(S.mode);};

// ---------- オンライン ----------
// 同期の中身は net.js。ここは「つなぐ」部分だけ：
// Railway のサーバーは相手探しと合図（シグナリング）に使い、入力はブラウザ同士で直接送る（WebRTC）。
// 直接つながらない回線では、サーバー中継（WebSocket）に自動で切り替わる。
const ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]};
let net=null, statusText='';
const onlinePanel=document.getElementById('onlinePanel'), roomInput=document.getElementById('room'),
      netStatus=document.getElementById('netStatus');
function setStatus(t){statusText=t; netStatus.textContent=t;}
function leaveOnline(){
  if(!net) return;
  const n=net; net=null;
  clearInterval(n.pingT); clearTimeout(n.timer);
  try{n.pc&&n.pc.close();}catch(e){}
  try{n.ws.close();}catch(e){}
}
const p2p=n=>!!(n.dc&&n.dc.readyState==='open');
function netSend(n,o){
  const s=JSON.stringify(o);
  if(p2p(n)){try{n.dc.send(s); return;}catch(e){}}
  if(n.ws.readyState===1) n.ws.send(s);
}
function wsSend(n,o){if(n.ws.readyState===1) n.ws.send(JSON.stringify(o));}
function updateStatus(n){
  if(net!==n||!n.started) return;
  const r=n.ses.rtt<0?'-':Math.round(n.ses.rtt);
  setStatus(`対戦中：あなたは P${n.you+1} ｜ ${p2p(n)?'P2P直結':'サーバー中継'} ｜ ping ${r}ms ｜ 入力遅延 ${n.ses.delay}F`);
}
function beginMatch(n){
  if(net!==n||n.started) return;
  clearTimeout(n.timer); n.started=true;
  S=newState('online'); S.rng=n.seed>>>0; resetFx(); updateStatus(n); cv.focus();
}
function setupRtc(n){
  let pc; try{pc=new RTCPeerConnection(ICE);}catch(e){return;}
  n.pc=pc;
  pc.onicecandidate=e=>{if(e.candidate) wsSend(n,{t:'sig',c:e.candidate});};
  const bind=dc=>{
    n.dc=dc;
    dc.onopen=()=>{if(net!==n) return; n.ses.rtt=-1; beginMatch(n); updateStatus(n);};
    dc.onmessage=ev=>{if(net!==n) return; let m; try{m=JSON.parse(ev.data);}catch(e){return;} n.ses.onMessage(m);};
    dc.onclose=()=>{if(n.dc===dc) n.dc=null; updateStatus(n);};
  };
  if(n.you===0){
    bind(pc.createDataChannel('in',{ordered:false,maxRetransmits:0}));
    n.sig=n.sig.then(async()=>{await pc.setLocalDescription(await pc.createOffer()); wsSend(n,{t:'sig',sdp:pc.localDescription});}).catch(()=>{});
  }else pc.ondatachannel=e=>bind(e.channel);
}
async function onSig(n,m){
  const pc=n.pc; if(!pc) return;
  if(m.sdp){
    await pc.setRemoteDescription(m.sdp);
    if(m.sdp.type==='offer'){await pc.setLocalDescription(await pc.createAnswer()); wsSend(n,{t:'sig',sdp:pc.localDescription});}
  }else if(m.c) await pc.addIceCandidate(m.c);
}
function joinOnline(){
  leaveOnline();
  const room=roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
  roomInput.value=room;
  let ws;
  try{ws=new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');}
  catch(e){setStatus('サーバーに接続できません'); return;}
  const n={ws,ses:null,pc:null,dc:null,you:-1,seed:0,started:false,matched:false,timer:0,pingT:0,sig:Promise.resolve()};
  net=n; S=newState('online'); resetFx(); setStatus('接続中…');
  ws.onopen=()=>ws.send(JSON.stringify({t:'join',room}));
  ws.onmessage=ev=>{
    if(net!==n) return;
    let m; try{m=JSON.parse(ev.data);}catch(e){return;}
    if(m.t==='wait') setStatus(room?`ルーム「${room}」で相手を待っています…（相手にも同じコードを入れてもらう）`:'対戦相手を探しています…');
    else if(m.t==='start'){
      n.you=m.you; n.seed=m.seed; n.matched=true;
      n.ses=createSession(m.you,o=>netSend(n,o),()=>performance.now());
      setStatus('相手が見つかりました。接続を確立中…');
      setupRtc(n);
      n.ses.ping();
      n.pingT=setInterval(()=>{n.ses.ping(); updateStatus(n);},500);
      n.timer=setTimeout(()=>beginMatch(n),3000); // P2Pが3秒でつながらなければサーバー中継で開始
    }
    else if(m.t==='sig'){n.sig=n.sig.then(()=>onSig(n,m)).catch(()=>{});}
    else if(m.t==='in'||m.t==='ping'||m.t==='pong'){if(n.ses) n.ses.onMessage(m);}
    else if(m.t==='full'){leaveOnline(); setStatus('そのルームは満員です。別のコードで試して');}
    else if(m.t==='left'){leaveOnline(); setStatus('相手が切断しました。もう一度「入室」で再マッチ');}
  };
  ws.onclose=()=>{if(net===n){leaveOnline(); setStatus(n.matched?'接続が切れました。もう一度「入室」で再接続':'サーバーに接続できませんでした');}};
}
function tickOnline(){
  return net.ses.tick(
    ()=>cleanInput(keyBits(KEY_P1)|keyBits(KEY_P2)|padBits(firstPad())),
    inp=>{
      if(S.phase==='end'&&S.pt>60&&((inp[0]|inp[1])&(BT.L|BT.M|BT.H|BT.SP|BT.SU))){const seed=S.rng; S=newState('online'); S.rng=seed; resetFx();}
      step(S,inp);
    });
}
function firstPad(){try{return [...(navigator.getGamepads?navigator.getGamepads():[])].filter(Boolean)[0];}catch(e){return null;}}
document.getElementById('btnJoin').onclick=joinOnline;
roomInput.addEventListener('keydown',e=>{if(e.key==='Enter') joinOnline();});

// ---------- 演出（描画専用・シミュには影響しない） ----------
let fx=[], shake=0, hpDisp=[MAX_HP,MAX_HP], comboShow=[{n:0,t:0},{n:0,t:0}];
function resetFx(){fx=[]; shake=0; hpDisp=[MAX_HP,MAX_HP]; comboShow=[{n:0,t:0},{n:0,t:0}];}
function takeEvents(){
  for(const e of S.events){
    if(e.type==='hit'){
      fx.push({k:'hit',x:e.x/FX,y:e.y/FX,t:0,max:e.big?22:14,big:e.big,c:COL[e.owner].light});
      shake=Math.max(shake,e.big?9:4);
      comboShow[e.owner]={n:e.combo,t:80};
    }else if(e.type==='block') fx.push({k:'block',x:e.x/FX,y:e.y/FX,t:0,max:12});
    else if(e.type==='clash') fx.push({k:'hit',x:e.x/FX,y:e.y/FX,t:0,max:16,big:true,c:'#fff'});
    else if(e.type==='thud'){fx.push({k:'dust',x:e.x/FX,y:e.y/FX,t:0,max:20}); shake=Math.max(shake,3);}
    else if(e.type==='super') fx.push({k:'superflash',t:0,max:45,i:e.i});
  }
  S.events.length=0;
}

// ---------- 背景 ----------
const bg=document.createElement('canvas'); bg.width=W; bg.height=H;
(function(){
  const g=bg.getContext('2d');
  const sky=g.createLinearGradient(0,0,0,480); sky.addColorStop(0,'#120f24'); sky.addColorStop(1,'#3a2440');
  g.fillStyle=sky; g.fillRect(0,0,W,480);
  g.fillStyle='rgba(255,220,180,.10)'; g.beginPath(); g.arc(760,170,90,0,Math.PI*2); g.fill();
  let seed=7; const r=()=>(seed=(seed*16807)%2147483647)/2147483647;
  g.fillStyle='#1d1630';
  for(let x=0;x<W;){const w=40+r()*70,h=80+r()*170; g.fillRect(x,480-h,w,h); x+=w+4;}
  g.fillStyle='#140f22';
  for(let x=-20;x<W;){const w=60+r()*90,h=40+r()*90; g.fillRect(x,480-h,w,h); x+=w+10;}
  g.fillStyle='rgba(255,210,120,.35)';
  for(let i=0;i<120;i++) g.fillRect(r()*W,300+r()*170,3,4);
  const fl=g.createLinearGradient(0,480,0,H); fl.addColorStop(0,'#3b3048'); fl.addColorStop(1,'#1a1522');
  g.fillStyle=fl; g.fillRect(0,480,W,H-480);
  g.strokeStyle='rgba(255,255,255,.06)'; g.lineWidth=1;
  for(let i=-10;i<=20;i++){g.beginPath(); g.moveTo(500+i*60,480); g.lineTo(500+i*140,H); g.stroke();}
  g.strokeStyle='rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(0,480.5); g.lineTo(W,480.5); g.stroke();
})();

// ---------- 描画ヘルパ ----------
function rr(x,y,w,h,r=6){ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(x,y,w,h,Math.min(r,Math.abs(w)/2,Math.abs(h)/2)); else ctx.rect(x,y,w,h); ctx.fill();}
function circle(x,y,r){ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();}
function text(str,x,y,size,color,align='center',stroke=true){
  ctx.font=`900 ${size}px system-ui,"Hiragino Sans","Noto Sans JP",sans-serif`;
  ctx.textAlign=align; ctx.textBaseline='middle';
  if(stroke){ctx.lineWidth=Math.max(3,size/8); ctx.strokeStyle='rgba(0,0,0,.85)'; ctx.strokeText(str,x,y);}
  ctx.fillStyle=color; ctx.fillText(str,x,y);
}

function drawFighter(p){
  const c=COL[p.i], st=p.state, m=p.move?MOVES[p.move]:null;
  ctx.save();
  ctx.translate(p.x/FX,p.y/FX); ctx.scale(p.facing,1);
  // 影
  ctx.save(); ctx.scale(1,1); ctx.fillStyle='rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(0,(FLOOR-p.y)/FX,36,7,0,0,Math.PI*2); ctx.fill(); ctx.restore();
  let body=c.body;
  if((st==='hitstun'||st==='launch')&&(S.frame>>1)%2) body='#ffffff';
  if(st==='getup') ctx.globalAlpha=(S.frame>>1)%2?0.45:0.9;
  if(m&&m.super){ctx.shadowColor=c.light; ctx.shadowBlur=30;}
  if(m&&m.inv&&p.mf>=m.inv[0]&&p.mf<=m.inv[1]){ctx.shadowColor='#fff'; ctx.shadowBlur=18;}
  ctx.fillStyle=body;
  let head=null;
  if((st==='down'||st==='ko')&&!p.air){rr(-50,-24,95,24); circle(-64,-14,15);}
  else if(st==='launch'||st==='ko'){ctx.rotate(-0.9); rr(-24,-120,48,60); rr(-20,-62,40,48); circle(0,-138,16);}
  else if(p.air){rr(-24,-125,48,60); ctx.fillStyle=c.dark; rr(-20,-70,40,44); ctx.fillStyle=body; head=[4,-142,16];}
  else if(p.crouch){ctx.fillStyle=c.dark; rr(-30,-42,60,42); ctx.fillStyle=body; rr(-26,-94,52,54); head=[6,-110,17];}
  else{
    if(st==='hitstun') ctx.rotate(-0.12);
    ctx.fillStyle=c.dark; rr(-22,-72,17,72); rr(5,-72,17,72);
    ctx.fillStyle=body; rr(-26,-134,52,66); head=[2,-152,18];
  }
  if(head){
    circle(head[0],head[1],head[2]);
    ctx.fillStyle=c.light; rr(head[0]-head[2],head[1]-6,head[2]*2,6,2);
    ctx.beginPath(); ctx.moveTo(head[0]-head[2],head[1]-4); ctx.lineTo(head[0]-head[2]-18,head[1]-10+Math.sin(S.frame/5)*3); ctx.lineTo(head[0]-head[2]-14,head[1]+2); ctx.fill();
    ctx.fillStyle='#fff'; rr(head[0]+8,head[1]-1,7,4,1);
  }
  // 手足（攻撃）
  ctx.shadowBlur=0;
  if(m&&m.box){
    const [bx,by,bw,bh]=m.box, act=p.mf>=m.s&&p.mf<m.s+m.a;
    ctx.fillStyle=act?c.light:body;
    if(bh>bw){ // 縦長（昇竜など）
      if(act) rr(bx+bw/2-12,-(by+bh),24,bh); else rr(4,-120,22,30);
    }else{
      const lh=Math.min(bh,22), ly=-(by+bh/2)-lh/2;
      if(act) rr(bx-10,ly,bw+10,lh);
      else if(p.mf<m.s) rr(-14,ly,30,lh);
      else rr(bx-10,ly,(bw+10)*0.55,lh);
      if(act){ctx.fillStyle='#fff'; rr(bx+bw-18,ly,18,lh);}
    }
  }else if(m&&m.proj&&p.mf>=m.s-5&&p.mf<m.s+10){
    ctx.fillStyle=c.light; rr(18,-112,46,22);
  }else if(head&&st!=='hitstun'&&!p.air){
    ctx.fillStyle=c.dark; rr(14,p.crouch?-84:-122,26,14); // 構えの腕
  }
  if(st==='blockstun'){
    ctx.strokeStyle='rgba(170,225,255,.9)'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(8,p.crouch?-52:-84,p.crouch?56:84,-1.1,1.1); ctx.stroke();
  }
  ctx.restore();
}
function drawProj(q){
  const x=q.x/FX,y=q.y/FX,c=COL[q.owner];
  const g=ctx.createRadialGradient(x,y,2,x,y,q.w*0.8);
  g.addColorStop(0,'#fff'); g.addColorStop(0.35,c.light); g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(x,y,q.w*0.8,q.h*0.7,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=c.body; ctx.globalAlpha=.35;
  ctx.beginPath(); ctx.ellipse(x-Math.sign(q.vx)*28,y,26,q.h*0.4,0,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
}
function drawBox(r,fill,stroke){
  const x=r.x/FX,y=r.y/FX,w=r.w/FX,h=r.h/FX;
  if(fill){ctx.fillStyle=fill; ctx.fillRect(x,y,w,h);}
  ctx.strokeStyle=stroke; ctx.lineWidth=1.5; ctx.strokeRect(x+.5,y+.5,w-1,h-1);
}
function drawBoxes(){
  for(const p of S.p){
    for(const h of hurtBoxes(p)) drawBox(h,p.inv?'rgba(255,255,255,.12)':'rgba(80,200,255,.12)',p.inv?'#fff':'#5ac8ff');
    const hb=activeBox(p); if(hb) drawBox(hb,'rgba(255,60,60,.35)','#ff4040');
    ctx.strokeStyle='#ffd34d'; ctx.beginPath(); ctx.moveTo(p.x/FX,p.y/FX-6); ctx.lineTo(p.x/FX,p.y/FX+6); ctx.stroke();
  }
  for(const q of S.projs) drawBox({x:q.x-q.w*FX/2,y:q.y-q.h*FX/2,w:q.w*FX,h:q.h*FX},'rgba(255,60,60,.35)','#ff4040');
}
function drawFx(){
  for(const f of fx){
    const k=f.t/f.max;
    if(f.k==='hit'){
      ctx.strokeStyle=f.c; ctx.globalAlpha=1-k; ctx.lineWidth=f.big?5:3;
      const R=(f.big?70:40)*(0.3+k);
      ctx.beginPath(); ctx.arc(f.x,f.y,R,0,Math.PI*2); ctx.stroke();
      for(let i=0;i<8;i++){const a=i*Math.PI/4+0.3; ctx.beginPath(); ctx.moveTo(f.x+Math.cos(a)*R*0.4,f.y+Math.sin(a)*R*0.4); ctx.lineTo(f.x+Math.cos(a)*R*1.2,f.y+Math.sin(a)*R*1.2); ctx.stroke();}
      ctx.globalAlpha=1;
    }else if(f.k==='block'){
      ctx.strokeStyle='#bfe6ff'; ctx.globalAlpha=1-k; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(f.x,f.y,14+k*26,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=1;
    }else if(f.k==='dust'){
      ctx.fillStyle='rgba(200,190,210,'+(0.5*(1-k))+')';
      for(let i=-2;i<=2;i++){ctx.beginPath(); ctx.arc(f.x+i*18*(1+k),f.y-6-k*10,8+k*8,0,Math.PI*2); ctx.fill();}
    }
  }
}
function drawHUD(){
  const name=pname;
  // 体力
  for(let i=0;i<2;i++){
    const p=S.p[i], x0=i===0?40:550, w=410;
    hpDisp[i]=Math.max(p.hp,hpDisp[i]-(S.hitstop||S.freeze?0:5));
    if(p.hp>hpDisp[i]) hpDisp[i]=p.hp;
    ctx.fillStyle='#0a0a10'; ctx.fillRect(x0-3,25,w+6,28);
    const fill=(v,col)=>{const ww=w*v/MAX_HP; ctx.fillStyle=col; ctx.fillRect(i===0?x0:x0+w-ww,28,ww,22);};
    fill(hpDisp[i],'#d23a3a');
    fill(p.hp,p.hp<MAX_HP*0.25?'#ffb02e':'#ffe14d');
    text(name(i),i===0?x0:x0+w,68,18,COL[i].light,i===0?'left':'right');
    for(let k=0;k<WIN_ROUNDS;k++){
      const cx=i===0?x0+60+k*22:x0+w-60-k*22;
      ctx.fillStyle=k<S.wins[i]?'#ffd34d':'#2b2b38'; circle(cx,68,7);
    }
  }
  // タイマー
  ctx.fillStyle='#0a0a10'; ctx.fillRect(468,18,64,42);
  text(S.mode==='training'?'∞':String(Math.ceil(S.timer/60)).padStart(2,'0'),500,40,30,'#fff','center',false);
  // ゲージ
  for(let i=0;i<2;i++){
    const p=S.p[i], x0=i===0?40:700, w=260, full=p.meter>=MAX_METER;
    ctx.fillStyle='#0a0a10'; ctx.fillRect(x0-2,526,w+4,16);
    const ww=w*p.meter/MAX_METER;
    ctx.fillStyle=full?((S.frame>>3)%2?'#7ef0ff':'#3fc8ff'):'#2f86c9';
    ctx.fillRect(i===0?x0:x0+w-ww,528,ww,12);
    text(full?'SUPER  MAX':'SUPER',i===0?x0:x0+w,512,14,full?'#7ef0ff':'#9aa',i===0?'left':'right');
  }
  // コンボ
  for(let i=0;i<2;i++){
    const c=comboShow[i]; if(c.t>0){c.t--; if(c.n>=2) text(`${c.n} HITS`,i===0?60:940,150,34,'#ffd34d',i===0?'left':'right');}
  }
  // 判定・フレーム情報
  if(showBoxes||S.mode==='training'){
    for(let i=0;i<2;i++){
      const p=S.p[i]; let s=p.state;
      if(p.move){const m=MOVES[p.move]; const ph=p.mf<m.s?'発生':p.mf<m.s+m.a?'持続':'硬直'; s=`${m.name} ${p.mf}/${m.T}F ${ph}`;}
      else if(p.state==='hitstun'||p.state==='blockstun') s+=` 残り${p.stun}F`;
      text(s,i===0?40:960,100,13,'#c9cbd6',i===0?'left':'right',true);
    }
    const a=S.lastAdv;
    if(a){
      const v=a.adv==='down'?'ダウン':a.adv==null?'-':(a.adv>0?'+':'')+a.adv+'F';
      const col=a.adv==='down'||a.adv>0?'#7dffb0':a.adv<0?'#ff8a8a':'#fff';
      text(`${name(a.i)} ${a.move}（${a.blocked?'ガード':'ヒット'}）有利 ${v}`,500,92,14,col);
    }
  }
}
function drawMessages(){
  if(S.phase==='intro') text(S.pt<55?`ROUND ${S.round}`:'FIGHT!',500,250,S.pt<55?64:80,S.pt<55?'#fff':'#ffd34d');
  else if(S.phase==='ko'){
    const name=pname;
    text(S.koReason==='ko'?'K.O.':'TIME UP',500,230,90,'#ff5a4a');
    if(S.pt>60) text(S.roundWinner<0?'DRAW':`${name(S.roundWinner)} WIN`,500,320,44,'#fff');
  }else if(S.phase==='end'){
    const name=pname(S.matchWinner);
    ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(0,0,W,H);
    text(`${name} の勝ち！`,500,240,68,'#ffd34d');
    if(S.pt>60) text('攻撃ボタンでもう一戦',500,320,24,'#fff');
  }
  if(S.mode==='online'){
    if(!net||!net.started){
      ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,W,H);
      text('ONLINE',500,220,60,'#ffd34d'); text(statusText,500,300,20,'#fff');
    }else if(net.ses.stall>30) text('通信待ち…',500,130,22,'#fff');
  }
  if(S.freeze>0){
    const p=S.p[S.freezeOwner];
    text(MOVES.SU.name,p.x/FX,p.y/FX-210,34,COL[p.i].light);
  }
}
function render(){
  ctx.save();
  if(shake>0){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake); if(!S.hitstop) shake*=0.8; if(shake<0.5) shake=0;}
  ctx.drawImage(bg,0,0);
  if(S.freeze>0){ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,W,H);}
  const order=S.freeze>0?[1-S.freezeOwner,S.freezeOwner]:(S.p[0].state==='attack'?[1,0]:[0,1]);
  for(const i of order) drawFighter(S.p[i]);
  for(const q of S.projs) drawProj(q);
  drawFx();
  if(showBoxes) drawBoxes();
  ctx.restore();
  drawHUD(); drawMessages();
  if(!S.hitstop) for(const f of fx) f.t++;
  fx=fx.filter(f=>f.t<f.max);
}

// ---------- メインループ（60F固定ステップ） ----------
const FRAME=1000/60; let acc=0,last=performance.now();
function loop(now){
  acc+=Math.min(100,now-last); last=now;
  let n=0;
  while(acc>=FRAME&&n<5){
    if(S.mode==='online'){
      if(!net||!net.started||!tickOnline()){acc=0; break;}
      takeEvents(); acc-=FRAME; n++; continue;
    }
    const inp=humanInputs();
    if(S.mode==='cpu') inp[1]=aiInput(S,1);
    else if(S.mode==='training') inp[1]=dummyInput(S);
    if(S.phase==='end'&&S.pt>60&&((inp[0]|inp[1])&(BT.L|BT.M|BT.H|BT.SP|BT.SU))){setMode(S.mode);}
    step(S,inp); takeEvents();
    acc-=FRAME; n++;
  }
  // 相手より遅れているときは少しだけ早回しして追いつく
  if(S.mode==='online'&&net&&net.started&&net.ses.behind()) acc+=FRAME/8;
  render();
  requestAnimationFrame(loop);
}
cv.focus();
requestAnimationFrame(loop);
