// ================= シミュレーション（決定論・描画なし） =================
// step(state, [p1Input, p2Input]) だけでゲームが1フレーム進む。
// 入力は9bitの整数、状態は整数だけのプレーンなオブジェクト。
// → 両者が同じ入力を流せば同じ結果になるので、オンラインは入力だけを同期する。
'use strict';
const FX=100, W=1000, H=560, FLOOR=480*FX;
const STAGE_L=40*FX, STAGE_R=960*FX, HALF_W=25*FX;
const GRAV=80, JUMP_VY=-1550, JUMP_VX=420, WALK_F=360, WALK_B=280;
// 技の入力猶予：技ボタンの後 SP_LATE フレーム以内に方向を入れても、↑を入れてジャンプが出た後 JUMP_LATE フレーム以内に技ボタンを押しても、その方向の技になる
const SP_LATE=5, JUMP_LATE=6, SP_RANK={spN:0,spF:1,spD:2,spU:3};
const MAX_HP=1000, MAX_METER=1000, ROUND_TIME=99*60, WIN_ROUNDS=2, BUF_LEN=6;
const BT={UP:1,DOWN:2,LEFT:4,RIGHT:8,L:16,M:32,H:64,SP:128,SU:256};
const ATK_KEYS=['L','M','H','SP','SU'];
const ACTIONABLE=new Set(['idle','walk','crouch','jump']);

// box: [前方オフセット, 足元からの高さ, 幅, 高さ]（px・右向き基準）
// s=発生 a=持続 r=硬直（フレーム） hs=ヒット硬直 bs=ガード硬直 kb=ノックバック
const MOVES={
  '5L':{name:'立ち弱',s:4,a:3,r:7,dmg:30,hs:15,bs:11,box:[20,108,72,22],guard:'mid',kb:400,meter:20,chain:1,cancel:true},
  '5M':{name:'立ち中',s:7,a:4,r:13,dmg:60,hs:19,bs:14,box:[20,92,95,26],guard:'mid',kb:500,meter:30,chain:2,cancel:true},
  '5H':{name:'立ち強',s:11,a:5,r:20,dmg:100,hs:23,bs:16,box:[20,78,118,36],guard:'mid',kb:650,meter:50,chain:3,cancel:true},
  '2L':{name:'しゃがみ弱',s:4,a:3,r:7,dmg:25,hs:14,bs:10,box:[20,8,75,20],guard:'low',kb:400,meter:20,chain:1,cancel:true},
  '2M':{name:'しゃがみ中',s:7,a:4,r:13,dmg:55,hs:18,bs:13,box:[20,5,100,22],guard:'low',kb:500,meter:30,chain:2,cancel:true},
  '2H':{name:'足払い',s:10,a:5,r:26,dmg:90,hs:0,bs:14,box:[20,0,125,20],guard:'low',kb:300,meter:50,chain:3,cancel:true,kd:true},
  'jL':{name:'ジャンプ弱',s:4,a:6,r:4,dmg:40,hs:16,bs:11,box:[10,40,65,30],guard:'high',kb:350,meter:20,air:true},
  'jM':{name:'ジャンプ中',s:6,a:5,r:6,dmg:65,hs:19,bs:13,box:[10,15,80,40],guard:'high',kb:400,meter:30,air:true},
  'jH':{name:'ジャンプ強',s:8,a:5,r:8,dmg:95,hs:22,bs:15,box:[0,-10,85,50],guard:'high',kb:450,meter:50,air:true},
  'spN':{name:'波動弾',s:13,a:1,r:32,meter:20,special:true,
         proj:{vx:750,dmg:70,hs:20,bs:14,w:44,h:32,y:105,life:110}},
  'spD':{name:'スライディング',s:8,a:12,r:22,dmg:80,hs:0,bs:12,box:[0,0,90,22],guard:'low',kb:300,meter:60,special:true,kd:true,moveVx:[8,19,900]},
  'spU':{name:'昇竜拳',s:3,a:12,r:28,dmg:120,hs:0,bs:18,box:[5,60,60,110],guard:'mid',kb:200,meter:60,special:true,kd:true,inv:[1,7],rise:{f:3,vx:200,vy:-1500}},
  'spF':{name:'突進拳',s:12,a:6,r:20,dmg:90,hs:24,bs:12,box:[15,85,90,30],guard:'mid',kb:800,meter:60,special:true,moveVx:[6,17,1100]},
  'SU':{name:'超必殺・烈光撃',s:6,a:20,r:30,dmg:320,hs:0,bs:20,box:[0,40,110,110],guard:'mid',kb:400,meter:0,super:true,kd:true,inv:[1,12],moveVx:[6,25,1400],chip:40},
};
for(const id in MOVES){const m=MOVES[id]; m.id=id; m.T=m.s-1+m.a+m.r;}

function rnd(s){s.rng=(Math.imul(s.rng,1103515245)+12345)>>>0; return (s.rng>>>8)/16777216;}

function newFighter(i,meter){
  return{i,x:(i===0?330:670)*FX,y:FLOOR,vx:0,vy:0,push:0,facing:i===0?1:-1,air:false,crouch:false,
    hp:MAX_HP,meter:meter||0,state:'idle',t:0,move:null,mf:0,hitDone:false,hitConn:false,stun:0,inv:0,combo:0,
    prevIn:0,curIn:0,buf:{L:0,M:0,H:0,SP:0,SU:0},idleT:0,jt:0};
}
function newState(mode){
  return{mode,frame:0,rng:20261117,phase:mode==='training'?'fight':'intro',pt:0,round:1,wins:[0,0],
    timer:ROUND_TIME,hitstop:0,freeze:0,freezeOwner:-1,p:[newFighter(0),newFighter(1)],projs:[],events:[],
    roundWinner:-1,koReason:'',matchWinner:-1,lastAdv:null,dummyGuard:true,
    ai:{hold:0,t:0,def:false,threat:false,oAir:false,aa:false}};
}
function resetRound(s){
  const m0=s.p[0].meter,m1=s.p[1].meter;
  s.p=[newFighter(0,m0),newFighter(1,m1)]; s.projs=[]; s.timer=ROUND_TIME;
  s.phase='intro'; s.pt=0; s.hitstop=0; s.freeze=0;
}

function cleanInput(inp){
  if((inp&BT.LEFT)&&(inp&BT.RIGHT)) inp&=~(BT.LEFT|BT.RIGHT);
  if((inp&BT.UP)&&(inp&BT.DOWN)) inp&=~BT.DOWN;
  return inp;
}
function dirs(p,inp){
  const f=p.facing===1?BT.RIGHT:BT.LEFT, b=p.facing===1?BT.LEFT:BT.RIGHT;
  return{up:!!(inp&BT.UP),down:!!(inp&BT.DOWN),fwd:!!(inp&f),back:!!(inp&b)};
}
function toWorld(p,b){
  const x=p.facing===1?p.x+b[0]*FX:p.x-(b[0]+b[2])*FX;
  return{x,y:p.y-(b[1]+b[3])*FX,w:b[2]*FX,h:b[3]*FX};
}
const ov=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;

function hurtBoxes(p){
  let b;
  if((p.state==='down'||p.state==='ko')&&!p.air) b=[-60,0,120,28];
  else if(p.air) b=[-28,20,56,130];
  else if(p.crouch) b=[-32,0,64,100];
  else b=[-30,0,60,160];
  const out=[toWorld(p,b)];
  if(p.state==='attack'){
    const m=MOVES[p.move];
    if(m.box&&p.mf>=m.s&&p.mf<m.s+m.a+(m.r>>1)&&m.box[2]>24&&m.box[3]>12)
      out.push(toWorld(p,[m.box[0]+10,m.box[1]+4,m.box[2]-20,m.box[3]-8]));
  }
  return out;
}
function activeBox(p){
  if(p.state!=='attack'||p.hitDone) return null;
  const m=MOVES[p.move]; if(!m.box) return null;
  if(p.mf<m.s||p.mf>m.s+m.a-1) return null;
  return toWorld(p,m.box);
}

function pickMove(s,p,d){
  const b=p.buf;
  if(b.SU&&p.meter>=MAX_METER&&!p.air) return 'SU';
  if(b.SP&&!p.air){
    if(d.up) return 'spU';
    if(d.down) return 'spD';
    if(d.fwd) return 'spF';
    if(!s.projs.some(q=>q.owner===p.i)) return 'spN';
  }
  for(const k of ['H','M','L']) if(b[k]) return p.air?'j'+k:(d.down?'2':'5')+k;
  return null;
}
function canCancel(f,t){
  if(t.super) return !f.super;
  if(f.special||f.super) return false;
  if(t.special) return !!f.cancel;
  if(f.air||t.air) return false;
  return !!(f.chain&&t.chain&&t.chain>f.chain);
}
function startMove(s,p,id){
  const m=MOVES[id];
  p.state='attack'; p.move=id; p.mf=0; p.hitDone=false; p.hitConn=false;
  for(const k of ATK_KEYS) p.buf[k]=0;
  if(!p.air){p.vx=0; p.crouch=(id[0]==='2'||id==='spD');}
  if(m.super){p.meter=0; s.freeze=45; s.freezeOwner=p.i; s.events.push({type:'super',i:p.i});}
}
function attackTick(s,p){
  p.mf++;
  const m=MOVES[p.move];
  if(m.inv&&p.mf>=m.inv[0]&&p.mf<=m.inv[1]) p.inv=1;
  if(!p.air&&!m.rise) p.vx=(m.moveVx&&p.mf>=m.moveVx[0]&&p.mf<=m.moveVx[1])?m.moveVx[2]*p.facing:0;
  if(m.rise&&p.mf===m.rise.f){p.air=true; p.vy=m.rise.vy; p.vx=m.rise.vx*p.facing;}
  if(m.proj&&p.mf===m.s){
    const j=m.proj;
    s.projs.push({owner:p.i,x:p.x+p.facing*60*FX,y:p.y-j.y*FX,vx:j.vx*p.facing,w:j.w,h:j.h,life:j.life,
      name:m.name,dmg:j.dmg,hs:j.hs,bs:j.bs,guard:'mid',kb:400,meter:30,special:true,dead:false});
  }
  if(m.air){ if(p.mf>=m.T){p.state='jump'; p.move=null;} }
  else if(m.rise){ /* 着地で終了 */ }
  else if(p.mf>=m.T){p.state='idle'; p.move=null; p.crouch=false;}
}

function updateFighter(s,p,o){
  const inp=p.curIn, canAct=s.phase==='fight';
  p.inv=0;
  if(ACTIONABLE.has(p.state)) p.combo=0;
  if(!p.air&&(p.state==='idle'||p.state==='walk'||p.state==='crouch'||p.state==='land')){
    if(o.x>p.x) p.facing=1; else if(o.x<p.x) p.facing=-1;
  }
  const d=dirs(p,inp);
  if(canAct){
    if(p.state==='jump'&&p.jt<=JUMP_LATE&&p.buf.SP&&d.up){
      // ↑が少し先に入ってジャンプになった直後なら、昇竜に切り替える
      p.y=FLOOR; p.vy=0; p.vx=0; p.air=false; startMove(s,p,'spU');
    }else if(p.state==='attack'&&!p.air&&p.mf<=SP_LATE&&SP_RANK[p.move]!==undefined){
      // 技ボタンが少し先に入った場合：出始めのうちは、後から入った方向の技に切り替える
      const want=d.up?'spU':d.down?'spD':d.fwd?'spF':'spN';
      if(SP_RANK[want]>SP_RANK[p.move]) startMove(s,p,want);
    }
    if(ACTIONABLE.has(p.state)){
      const id=pickMove(s,p,d); if(id) startMove(s,p,id);
    }else if(p.state==='attack'&&p.hitConn){
      const m=MOVES[p.move];
      if(p.mf>=m.s&&p.mf<=m.s+m.a+10){
        const id=pickMove(s,p,d);
        if(id&&canCancel(m,MOVES[id])) startMove(s,p,id);
      }
    }
  }
  switch(p.state){
    case 'idle': case 'walk': case 'crouch':
      if(!canAct){p.state='idle'; p.vx=0; p.crouch=false; break;}
      if(d.up){
        p.state='jump'; p.jt=0; p.air=true; p.crouch=false; p.vy=JUMP_VY;
        p.vx=d.fwd?JUMP_VX*p.facing:(d.back?-JUMP_VX*p.facing:0);
      }else if(d.down){p.state='crouch'; p.crouch=true; p.vx=0;}
      else{
        p.crouch=false;
        if(d.fwd){p.state='walk'; p.vx=WALK_F*p.facing;}
        else if(d.back){p.state='walk'; p.vx=-WALK_B*p.facing;}
        else{p.state='idle'; p.vx=0;}
      }
      break;
    case 'attack': attackTick(s,p); break;
    case 'jump': p.jt++; break;
    case 'hitstun': case 'blockstun': if(--p.stun<=0) p.state='idle'; break;
    case 'land': if(--p.t<=0) p.state='idle'; break;
    case 'down': p.inv=1; p.combo=0; if(--p.t<=0){p.state='getup'; p.t=18;} break;
    case 'getup': p.inv=1; if(--p.t<=0) p.state='idle'; break;
    case 'launch': case 'ko': p.inv=1; break;
  }
}

function onLand(s,p){
  switch(p.state){
    case 'jump': p.state='land'; p.t=3; p.vx=0; break;
    case 'attack':{const m=MOVES[p.move]; p.move=null; p.state='land'; p.t=m&&m.air?4:12; p.vx=0; break;}
    case 'launch':
      p.vx=0;
      if(p.hp<=0&&s.mode!=='training'){p.state='ko';}
      else{p.state='down'; p.t=36;}
      s.events.push({type:'thud',x:p.x,y:p.y});
      break;
    case 'ko': p.vx=0; break;
    default: p.state='idle'; p.vx=0;
  }
}
const clampX=p=>{if(p.x<STAGE_L+HALF_W)p.x=STAGE_L+HALF_W; if(p.x>STAGE_R-HALF_W)p.x=STAGE_R-HALF_W;};
function physics(s,p){
  if(p.air){
    p.vy+=GRAV; p.x+=p.vx; p.y+=p.vy;
    if(p.y>=FLOOR){p.y=FLOOR; p.vy=0; p.air=false; onLand(s,p);}
  }else p.x+=p.vx;
  if(p.push){p.x+=p.push; p.push=(p.push*85/100)|0;}
  clampX(p);
}
function pushApart(s){
  const [a,b]=s.p;
  if(Math.abs(a.y-b.y)>=120*FX) return;
  const need=2*HALF_W;
  let dx=b.x-a.x, o=need-Math.abs(dx);
  if(o<=0) return;
  const sA=dx>0?-1:(dx<0?1:(a.facing===1?-1:1));
  const h1=o>>1; a.x+=sA*h1; b.x-=sA*(o-h1); clampX(a); clampX(b);
  dx=b.x-a.x; o=need-Math.abs(dx);
  if(o>0){
    const wallA=a.x<=STAGE_L+HALF_W||a.x>=STAGE_R-HALF_W;
    if(wallA){b.x-=sA*o; clampX(b);} else {a.x+=sA*o; clampX(a);}
  }
}
function updateProjs(s){
  for(const q of s.projs){
    q.x+=q.vx; q.life--;
    if(q.life<=0||q.x<STAGE_L-50*FX||q.x>STAGE_R+50*FX) q.dead=true;
  }
  const live=s.projs.filter(q=>!q.dead);
  for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++){
    const A=live[i],B=live[j];
    if(A.owner!==B.owner&&Math.abs(A.x-B.x)<(A.w+B.w)*FX/2&&Math.abs(A.y-B.y)<(A.h+B.h)*FX/2){
      A.dead=B.dead=true; s.events.push({type:'clash',x:(A.x+B.x)>>1,y:A.y});
    }
  }
}
function canBlock(d,a,guard,proj){
  if(d.air) return false;
  if(!(d.state==='idle'||d.state==='walk'||d.state==='crouch'||d.state==='blockstun')) return false;
  const inp=d.curIn;
  const away=proj?(proj.vx>0?BT.RIGHT:BT.LEFT):(a.x>d.x?BT.LEFT:BT.RIGHT);
  if(!(inp&away)) return false;
  const crouching=!!(inp&BT.DOWN);
  if(guard==='low'&&!crouching) return false;
  if(guard==='high'&&crouching) return false;
  d.crouch=crouching;
  return true;
}
function contact(r1,r2){
  const x1=Math.max(r1.x,r2.x),x2=Math.min(r1.x+r1.w,r2.x+r2.w);
  const y1=Math.max(r1.y,r2.y),y2=Math.min(r1.y+r1.h,r2.y+r2.h);
  return{px:(x1+x2)>>1,py:(y1+y2)>>1};
}
function checkHits(s){
  const ev=[];
  for(let i=0;i<2;i++){
    const a=s.p[i],d=s.p[1-i],hb=activeBox(a);
    if(!hb||d.inv) continue;
    const hit=hurtBoxes(d).find(h=>ov(hb,h));
    if(hit) ev.push({a,d,m:MOVES[a.move],proj:null,...contact(hb,hit)});
  }
  for(const q of s.projs){
    if(q.dead) continue;
    const d=s.p[1-q.owner]; if(d.inv) continue;
    const r={x:q.x-q.w*FX/2,y:q.y-q.h*FX/2,w:q.w*FX,h:q.h*FX};
    const hit=hurtBoxes(d).find(h=>ov(r,h));
    if(hit){ev.push({a:s.p[q.owner],d,m:q,proj:q,...contact(r,hit)}); q.dead=true;}
  }
  for(const e of ev) applyHit(s,e);
}
function applyHit(s,e){
  const {a,d,m,proj}=e;
  const dir=proj?(proj.vx>0?1:-1):(d.x>a.x?1:(d.x<a.x?-1:a.facing));
  if(!proj){a.hitDone=true; a.hitConn=true;}
  const kb=m.kb||400, special=!!(m.special||m.super);
  const blocked=canBlock(d,a,m.guard||'mid',proj);
  let adv=null;
  if(blocked){
    d.state='blockstun'; d.stun=m.bs; d.move=null; d.vx=0; d.push=dir*kb;
    const chip=m.chip!=null?m.chip:(special?(m.dmg/8|0):0);
    d.hp=Math.max(0,d.hp-chip);
    a.meter=Math.min(MAX_METER,a.meter+(m.meter>>1)); d.meter=Math.min(MAX_METER,d.meter+15);
    s.hitstop=8;
    if(!proj) adv=m.bs-(m.T-a.mf);
    s.events.push({type:'block',x:e.px,y:e.py});
  }else{
    const scale=Math.max(m.super?50:30,100-10*Math.max(0,d.combo-1));
    const dmg=(m.dmg*scale/100)|0;
    d.hp=Math.max(0,d.hp-dmg); d.combo++;
    a.meter=Math.min(MAX_METER,a.meter+m.meter); d.meter=Math.min(MAX_METER,d.meter+(dmg>>1));
    d.move=null;
    if(s.mode==='training'&&d.hp<1) d.hp=1;
    if(m.kd||!m.hs||d.air||d.hp<=0){
      d.state='launch'; d.air=true; d.crouch=false;
      d.vy=m.super?-1300:-950; d.vx=dir*(m.super?520:360); d.push=0;
      if(!proj) adv='down';
    }else{
      d.state='hitstun'; d.stun=m.hs; d.vx=0; d.push=dir*kb;
      if(!proj) adv=m.hs-(m.T-a.mf);
    }
    s.hitstop=m.super?26:(m.dmg>=90?13:(m.dmg>=50?10:8));
    s.events.push({type:'hit',x:e.px,y:e.py,big:m.dmg>=90||!!m.super,owner:a.i,combo:d.combo});
  }
  if(d.hp<=0&&d.state!=='launch'){d.state='launch'; d.air=true; d.vy=-950; d.vx=dir*360; d.push=0;}
  if(!proj&&!a.air){
    const wall=dir>0?(STAGE_R-HALF_W-d.x):(d.x-(STAGE_L+HALF_W));
    if(wall<30*FX) a.push=-dir*kb;
  }
  if(!proj) s.lastAdv={i:a.i,move:m.name,adv,blocked};
}
function endRound(s,reason){
  const [a,b]=s.p; let w=-1;
  if(a.hp>b.hp) w=0; else if(b.hp>a.hp) w=1;
  if(w>=0) s.wins[w]++;
  s.roundWinner=w; s.koReason=reason; s.phase='ko'; s.pt=0;
}

function step(s,inputs){
  s.frame++;
  for(let i=0;i<2;i++){
    const p=s.p[i], inp=cleanInput(inputs[i]|0);
    const pressed=inp&~p.prevIn;
    p.curIn=inp; p.prevIn=inp;
    if(pressed&BT.L)p.buf.L=BUF_LEN; if(pressed&BT.M)p.buf.M=BUF_LEN; if(pressed&BT.H)p.buf.H=BUF_LEN;
    if(pressed&BT.SP)p.buf.SP=BUF_LEN; if(pressed&BT.SU)p.buf.SU=BUF_LEN;
  }
  if(s.freeze>0){s.freeze--; return;}
  if(s.hitstop>0){s.hitstop--; return;}
  for(const p of s.p) for(const k of ATK_KEYS) if(p.buf[k]>0) p.buf[k]--;
  s.pt++;
  if(s.phase==='intro'&&s.pt>=100){s.phase='fight'; s.pt=0;}
  const [p0,p1]=s.p;
  updateFighter(s,p0,p1); updateFighter(s,p1,p0);
  physics(s,p0); physics(s,p1);
  updateProjs(s);
  pushApart(s);
  checkHits(s);
  s.projs=s.projs.filter(q=>!q.dead);
  if(s.mode==='training'){
    for(const p of s.p){
      p.idleT=ACTIONABLE.has(p.state)?p.idleT+1:0;
      if(p.idleT>40){p.hp=MAX_HP; p.meter=MAX_METER;}
    }
  }
  if(s.phase==='fight'){
    if(p0.hp<=0||p1.hp<=0) endRound(s,'ko');
    else if(s.mode!=='training'&&--s.timer<=0){s.timer=0; endRound(s,'time');}
  }else if(s.phase==='ko'&&s.pt>=180){
    if(s.wins[0]>=WIN_ROUNDS||s.wins[1]>=WIN_ROUNDS){
      s.phase='end'; s.pt=0; s.matchWinner=s.wins[0]>=WIN_ROUNDS?0:1;
    }else{s.round++; resetRound(s);}
  }
}

// ===== CPU / トレーニングダミー（状態とシード乱数だけで決まる＝決定論） =====
function aiInput(s,i){
  const p=s.p[i],o=s.p[1-i],ai=s.ai;
  if(s.phase!=='fight'){ai.t=0; return 0;}
  const fwd=o.x>p.x?BT.RIGHT:BT.LEFT, back=fwd===BT.RIGHT?BT.LEFT:BT.RIGHT;
  const dist=Math.abs(o.x-p.x)/FX;
  const oProj=s.projs.some(q=>q.owner===o.i&&Math.abs(q.x-p.x)<320*FX&&((q.vx>0)===(p.x>q.x)));
  const threat=(o.state==='attack'&&dist<260)||oProj;
  if(threat&&!ai.threat) ai.def=rnd(s)<0.6;
  ai.threat=threat;
  if(o.air&&!ai.oAir) ai.aa=rnd(s)<0.5;
  ai.oAir=o.air;
  if(p.state==='attack'&&p.hitConn){
    const nx={'2L':BT.DOWN|BT.M,'5L':BT.M,'5M':BT.H,
      '2M':(s.frame&1)?(BT.DOWN|BT.SP):(fwd|BT.SP),
      '5H':p.meter>=MAX_METER?BT.SU:(fwd|BT.SP)}[p.move];
    return nx||0;
  }
  if(ai.aa&&o.air&&!p.air&&dist<170&&ACTIONABLE.has(p.state)) return BT.UP|BT.SP;
  if(threat&&ai.def&&!p.air&&(ACTIONABLE.has(p.state)||p.state==='blockstun')){
    const low=o.state==='attack'&&MOVES[o.move].guard==='low';
    return back|(low?BT.DOWN:0);
  }
  if(p.state==='jump'&&p.vy>0&&dist<170) return BT.H;
  if(ai.t>0){ai.t--; return ai.hold;}
  const r=rnd(s); let h=0,t=8;
  const myProj=s.projs.some(q=>q.owner===i);
  if(p.meter>=MAX_METER&&dist<240&&r<0.2){h=BT.SU; t=2;}
  else if(dist>380){
    if(r<0.3&&!myProj){h=BT.SP; t=16;}
    else if(r<0.42){h=BT.UP|fwd; t=6;}
    else{h=fwd; t=12+(((r*1000)|0)%14);}
  }else if(dist>150){
    if(r<0.15){h=fwd|BT.SP; t=4;}
    else if(r<0.3){h=BT.UP|fwd; t=6;}
    else if(r<0.42&&!myProj){h=BT.SP; t=16;}
    else if(r<0.52){h=back; t=10;}
    else{h=fwd; t=10;}
  }else{
    if(r<0.25){h=BT.DOWN|BT.L; t=3;}
    else if(r<0.38){h=BT.L; t=3;}
    else if(r<0.5){h=BT.DOWN|BT.H; t=3;}
    else if(r<0.6){h=BT.H; t=3;}
    else if(r<0.7){h=BT.DOWN|BT.SP; t=3;}
    else if(r<0.85){h=back|BT.DOWN; t=12;}
    else{h=back; t=10;}
  }
  ai.hold=h; ai.t=t; return 0;
}
function dummyInput(s){
  const p=s.p[1],o=s.p[0];
  if(!s.dummyGuard) return 0;
  const away=o.x>p.x?BT.LEFT:BT.RIGHT;
  const atk=o.state==='attack', proj=s.projs.some(q=>q.owner===0);
  if(!(atk||proj||p.state==='blockstun'||o.air)) return 0;
  const low=atk&&MOVES[o.move].guard==='low';
  return away|(low?BT.DOWN:0);
}
