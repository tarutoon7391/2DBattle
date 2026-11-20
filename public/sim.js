// ================= シミュレーション（決定論・描画なし） =================
// step(state, [p1Input, p2Input]) だけでゲームが1フレーム進む。
// 入力は9bitの整数、状態は整数だけのプレーンなオブジェクト。
// → 両者が同じ入力を流せば同じ結果になるので、オンラインは入力だけを同期する。
'use strict';
const FX=100, W=1000, H=560, FLOOR=480*FX;
const STAGE_L=40*FX, STAGE_R=960*FX, HALF_W=25*FX;
const GRAV=80;
// 技の入力猶予：技ボタンの後 SP_LATE フレーム以内に方向を入れても、↑を入れてジャンプが出た後 JUMP_LATE フレーム以内に技ボタンを押しても、その方向の技になる
const SP_LATE=5, JUMP_LATE=6, SP_RANK={spN:0,spF:1,spD:2,spU:3};
// RC_COST: ブレイクアッパーの消費ゲージ / KARA: 出始め3F以内なら同時押し技（1=投げ・ブレイク、2=ブレイクのみ）に化けられる通常技 / JUGGLE: ブレイクで浮かせた相手に追撃できる回数
const RC_COST=500, KARA={'5L':1,'2L':1,'5M':1,'2M':1,'5H':2,'2H':2,'6H':2,'TH':2}, JUGGLE=3, ALL3=16|32|64;
const HS_FREE=4, HS_DECAY=1, HS_MIN=6; // のけぞり短縮：HS_FREE ヒットまでは通常、以降1ヒットごとに HS_DECAY フレーム短く（下限 HS_MIN）
const TECH_WINDOW=10; // 投げ抜けの受付：つかまれてからこのフレーム数以内に 弱+中（つかまれる直前6F以内の入力も有効）
const THROWABLE=new Set(['idle','walk','crouch','attack','land']);
const MAX_METER=1000, ROUND_TIME=99*60, WIN_ROUNDS=2, BUF_LEN=6;
const BT={UP:1,DOWN:2,LEFT:4,RIGHT:8,L:16,M:32,H:64,SP:128,SU:256};
const ATK_KEYS=['L','M','H','SP','SU'];
const ACTIONABLE=new Set(['idle','walk','crouch','jump']);

// 技データは chars.js。MV(p) = そのキャラの「いま出している技」、MV(p,id) = そのキャラの技 id
const MV=(p,id)=>CHARS[p.ch].moves[id||p.move];
// 剣を投げている間、剣を使う技はリーチが45%になる
function moveBox(p,m){
  const b=m.box;
  if(!(m.sword&&p.noSword)) return b;
  return [b[0]<0?((b[0]*45/100)|0):b[0],b[1],(b[2]*45/100)|0,b[3]];
}

function rnd(s){s.rng=(Math.imul(s.rng,1103515245)+12345)>>>0; return (s.rng>>>8)/16777216;}

function newFighter(i,meter,ch){
  return{i,ch:ch|0,x:(i===0?330:670)*FX,y:FLOOR,vx:0,vy:0,push:0,facing:i===0?1:-1,air:false,crouch:false,
    hp:CHARS[ch|0].hp,meter:meter||0,state:'idle',t:0,move:null,mf:0,hitDone:false,hitConn:false,stun:0,inv:0,combo:0,
    prevIn:0,curIn:0,buf:{L:0,M:0,H:0,SP:0,SU:0},idleT:0,jt:0,canc:false,spIn:0,jug:0,airUsed:false,
    pressed:0,aj:0,spc:0,gm:null,armorUsed:false,noSword:false,noGain:false};
}
function newState(mode,chars){
  chars=chars||[0,0];
  return{mode,frame:0,rng:20261117,phase:mode==='training'?'fight':'intro',pt:0,round:1,wins:[0,0],
    timer:ROUND_TIME,hitstop:0,freeze:0,freezeOwner:-1,chars:[chars[0]|0,chars[1]|0],p:[newFighter(0,0,chars[0]),newFighter(1,0,chars[1])],projs:[],events:[],
    roundWinner:-1,koReason:'',matchWinner:-1,lastAdv:null,dummyGuard:true,
    ai:{hold:0,t:0,def:false,threat:false,oAir:false,aa:false,gr:false,tech:false}};
}
function resetRound(s){
  const m0=s.p[0].meter,m1=s.p[1].meter;
  s.p=[newFighter(0,m0,s.chars[0]),newFighter(1,m1,s.chars[1])]; s.projs=[]; s.timer=ROUND_TIME;
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
  else if(p.state==='launch') b=[-32,-((FLOOR-p.y)/FX|0),64,150+((FLOOR-p.y)/FX|0)]; // 浮かされ中は足元の地面まで判定を伸ばし、キャンセルで出した追撃が下をくぐらないようにする
  else if(p.air) b=[-28,20,56,130];
  else if(p.crouch) b=[-32,0,64,100];
  else b=[-30,0,60,160];
  const out=[toWorld(p,b)];
  if(p.state==='attack'){
    const m=MV(p), mb=m.box&&moveBox(p,m);
    if(mb&&!m.beam&&p.mf>=m.s&&p.mf<m.s+m.a+(m.r>>1)&&mb[2]>24&&mb[3]>12)
      out.push(toWorld(p,[mb[0]+10,mb[1]+4,mb[2]-20,mb[3]-8]));
  }
  return out;
}
function activeBox(p){
  if(p.state!=='attack'||p.hitDone) return null;
  const m=MV(p); if(!m.box) return null;
  if(p.mf<m.s||p.mf>m.s+m.a-1) return null;
  return toWorld(p,moveBox(p,m));
}

// cancel=true: 当てた技からのキャンセルとして選ぶ（空中攻撃1回制限を無視する。つながるかは canCancel が決める）
function pickMove(s,p,d,cancel){
  const b=p.buf, C=CHARS[p.ch].moves;
  if(b.SU&&p.meter>=MAX_METER&&(!p.air||(p.state==='attack'&&p.move==='spU'))) return 'SU'; // 昇竜系は空中でも必殺技でキャンセルできる
  if(b.SP){
    let id=null;
    if(p.air){ if(C.jS&&(cancel||!p.airUsed)) id='jS'; }
    else{
      const q=dirs(p,p.spIn);
      id=(d.up||q.up)?'spU':(d.down||q.down)?'spD':(d.fwd||q.fwd)?'spF':'spN';
      if(p.noSword&&C[id].alt) id=C[id].alt; // 剣を投げている間は起爆に化ける
    }
    if(id){
      const j=C[id].proj; // 飛び道具は同時に出せる数まで
      if(!j||s.projs.filter(q=>q.owner===p.i&&q.src===id).length<(j.max||1)) return id;
    }
  }
  if(p.air&&p.airUsed&&!cancel) return null; // 空中攻撃は1回のジャンプにつき1回まで（昇りで当てて下りでもう一度、のループ防止）
  const q=dirs(p,p.spIn), down=d.down||q.down, fwd=d.fwd||q.fwd;
  for(const k of ['H','M','L']) if(b[k]) return p.air?'j'+k:(down?'2':(k==='H'&&fwd?'6':'5'))+k;
  return null;
}
function canCancel(p,f,t){
  const C=CHARS[p.ch];
  if(f.throw) return false;
  if(t.super) return !f.super;
  if(f.super) return false;
  if(f.special) return !!(C.spCancel&&t.special&&t.id!==f.id&&p.spc<1&&!f.air&&!t.air); // 技→別の技（1回だけ）
  if(t.special) return !!f.cancel&&f.air===t.air;
  if(f.air||t.air) return !!(C.airChain&&f.air&&t.air&&f.chain&&t.chain>f.chain);
  return !!(f.chain&&t.chain&&t.chain>f.chain);
}
// canc: 当てた技からのキャンセルで出したか。キャンセルで出した技だけが、浮いている相手に当たる（追撃）
function startMove(s,p,id,canc){
  const m=MV(p,id), from=p.state==='attack'&&p.move?MV(p):null;
  p.spc=canc&&from&&from.special&&m.special?p.spc+1:0;
  p.armorUsed=false;
  if((m.super||m.launcher)&&p.air){p.y=FLOOR; p.vy=0; p.air=false;} // 昇竜拳からのキャンセルは地上に戻って出す
  p.state='attack'; p.move=id; p.mf=0; p.hitDone=false; p.hitConn=false; p.canc=!!canc;
  if(canc&&m.box){ // キャンセルで出した打撃は、離れていたら出始めに間合いを詰める（最大110px）
    const o=s.p[1-p.i], ox=o.x+((o.push*20/3)|0); // 相手がノックバックで下がる分も見込む
    const gap=Math.min(110*FX,Math.abs(ox-p.x)-70*FX);
    p.push=gap>0?(o.x>p.x?1:-1)*((gap*15/100)|0):0;
  }
  for(const k of ATK_KEYS) p.buf[k]=0;
  if(m.air) p.airUsed=true;
  if(!p.air){p.vx=0; p.crouch=(id[0]==='2'||!!m.crouch);}
  if(m.launcher||m.super) p.noGain=true; // ブレイク・必殺技を使ったコンボ中は、もうゲージが増えない（ゲージを回収しながら続く永久コンボの防止）
  if(m.launcher){p.meter-=RC_COST; s.events.push({type:'rc',i:p.i,x:p.x,y:p.y});}
  if(m.super){p.meter=0; s.freeze=45; s.freezeOwner=p.i; s.events.push({type:'super',i:p.i});}
}
function spawnProj(s,p,m){
  const j=m.proj;
  if(s.projs.filter(q=>q.owner===p.i&&q.src===m.id).length>=(j.max||1)) return;
  s.projs.push({owner:p.i,src:m.id,kind:j.kind||'ball',phase:0,x:p.x+p.facing*60*FX,y:p.y-j.y*FX,vx:j.vx*p.facing,vy:j.vy||0,
    w:j.w,h:j.h,life:j.life,stick:j.stick||0,fuse:0,heavy:!!j.heavy,breaker:!!j.breaker,ex:j.ex||null,hitDone:false,
    canc:p.canc,name:m.name,dmg:j.dmg,hs:j.hs,bs:j.bs,guard:j.guard||'mid',kb:400,meter:30,special:true,kd:!!j.kd,dead:false});
}
// 刺さった剣を爆発させる（爆発は数フレームだけ当たり判定が出る）
function explode(s,q){
  q.phase=2; q.life=8; q.vx=0; q.vy=0; q.w=q.ex.w; q.h=q.ex.h; q.dmg=q.ex.dmg; q.hs=0; q.kd=true; q.guard='mid'; q.hitDone=false; q.name='爆発';
  s.events.push({type:'boom',x:q.x,y:q.y,owner:q.owner});
}
function attackTick(s,p){
  p.mf++;
  const m=MV(p);
  if(m.inv&&p.mf>=m.inv[0]&&p.mf<=m.inv[1]) p.inv=1;
  if(m.rehit&&p.hitDone&&p.mf>m.s&&p.mf<m.s+m.a&&(p.mf-m.s)%m.rehit===0) p.hitDone=false; // 多段ヒット
  if(!p.air&&!m.rise) p.vx=(m.moveVx&&p.mf>=m.moveVx[0]&&p.mf<=m.moveVx[1])?m.moveVx[2]*p.facing:0;
  if(m.rise&&p.mf===m.rise.f){p.air=true; p.vy=m.rise.vy; p.vx=m.rise.vx*p.facing;}
  if(m.dive&&p.mf===m.s){p.vy=m.dive.vy; p.vx=m.dive.vx*p.facing;}
  if(m.tele&&p.mf===m.tele.f){ // 相手の裏へ回る
    const o=s.p[1-p.i]; p.x=o.x+(o.x>=p.x?1:-1)*m.tele.off*FX; clampX(p);
    s.events.push({type:'tele',x:p.x,y:p.y,i:p.i});
  }
  if(m.proj&&p.mf===m.s) spawnProj(s,p,m);
  if(m.detonate&&p.mf===m.s) for(const q of s.projs) if(q.owner===p.i&&q.ex&&q.phase<2) explode(s,q);
  if(m.air){ if(p.mf>=m.T){p.state='jump'; p.move=null;} }
  else if(m.rise){ /* 着地で終了 */ }
  else if(p.mf>=m.T){p.state='idle'; p.move=null; p.crouch=false;}
}

function updateFighter(s,p,o){
  const inp=p.curIn, canAct=s.phase==='fight', C=CHARS[p.ch];
  p.inv=0;
  if(ACTIONABLE.has(p.state)){p.combo=0; o.noGain=false;} // コンボが切れたら、相手のゲージ増加停止も解除
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
      if(SP_RANK[want]>SP_RANK[p.move]) startMove(s,p,want,p.canc);
    }
    { // 同時押し：弱+中+強＝ブレイクアッパー、弱+中＝投げ。数フレームのズレは許容する
      const b=p.buf, held=p.curIn&ALL3, mv=p.move?MV(p):null;
      const ground=ACTIONABLE.has(p.state)&&!p.air;
      const early=p.state==='attack'&&!p.air&&p.mf<=3&&!p.hitConn?(KARA[p.move]||0):0;
      if(p.meter>=RC_COST&&((b.L&&b.M&&b.H)||(early&&held===ALL3))
         &&(ground||(p.state==='attack'&&!mv.super&&!mv.launcher&&(!p.air||p.move==='spU')))) startMove(s,p,'RC',true);
      else if((ground&&b.L&&b.M&&!b.H)||(early===1&&held===(16|32))) startMove(s,p,'TH');
    }
    if(ACTIONABLE.has(p.state)){
      const id=pickMove(s,p,d); if(id) startMove(s,p,id);
    }else if(p.state==='attack'&&p.hitConn){
      const m=MV(p);
      if(p.mf>=m.s&&p.mf<=m.s+m.a+10){
        const id=pickMove(s,p,d,true);
        if(id&&canCancel(p,m,MV(p,id))) startMove(s,p,id,true);
        else if(m.jc&&d.up&&!p.air){ // 当てたらジャンプでキャンセル
          p.state='jump'; p.move=null; p.jt=JUMP_LATE+1; p.airUsed=false; p.aj=C.airJumps|0; p.air=true; p.crouch=false; p.vy=C.jumpVy;
          p.vx=d.fwd?C.jumpVx*p.facing:(d.back?-C.jumpVx*p.facing:0);
        }
      }
    }
  }
  switch(p.state){
    case 'idle': case 'walk': case 'crouch':
      if(!canAct){p.state='idle'; p.vx=0; p.crouch=false; break;}
      if(d.up){
        p.state='jump'; p.jt=0; p.airUsed=false; p.aj=C.airJumps|0; p.air=true; p.crouch=false; p.vy=C.jumpVy;
        p.vx=d.fwd?C.jumpVx*p.facing:(d.back?-C.jumpVx*p.facing:0);
      }else if(d.down){p.state='crouch'; p.crouch=true; p.vx=0;}
      else{
        p.crouch=false;
        if(d.fwd){p.state='walk'; p.vx=C.walkF*p.facing;}
        else if(d.back){p.state='walk'; p.vx=-C.walkB*p.facing;}
        else{p.state='idle'; p.vx=0;}
      }
      break;
    case 'attack': attackTick(s,p); break;
    case 'jump':
      p.jt++;
      if(canAct&&p.aj>0&&p.jt>8&&(p.pressed&BT.UP)){ // 2段ジャンプ（空中攻撃の回数は戻らない）
        p.aj--; p.vy=(C.jumpVy*9/10)|0; p.vx=d.fwd?C.jumpVx*p.facing:(d.back?-C.jumpVx*p.facing:0);
        s.events.push({type:'tele',x:p.x,y:p.y,i:p.i});
      }
      break;
    case 'hitstun': case 'blockstun': if(--p.stun<=0) p.state='idle'; break;
    case 'land': if(--p.t<=0) p.state='idle'; break;
    case 'grabbed': // つかまれ中：弱+中で投げ抜け、時間切れで投げが成立
      p.inv=1;
      {
        const tm=o.state==='attack'&&o.move===p.gm?MV(o):null;
        if(!tm){p.state='idle'; break;} // 投げた側が潰された
        if(!tm.notech&&p.buf.L&&p.buf.M){techBreak(s,o,p); break;}
        if(--p.t<=0) applyHit(s,{a:o,d:p,m:tm,proj:null,px:(o.x+p.x)>>1,py:p.y-90*FX});
      }
      break;
    case 'down': p.inv=1; p.combo=0; if(--p.t<=0){p.state='getup'; p.t=18;} break;
    case 'getup': p.inv=1; if(--p.t<=0) p.state='idle'; break;
    case 'launch': case 'ko': p.inv=1; break;
  }
}

function onLand(s,p){
  switch(p.state){
    case 'jump': p.state='land'; p.t=3; p.vx=0; break;
    case 'attack':{const m=MV(p); p.move=null; p.state='land'; p.t=m&&m.land?m.land:(m&&m.air?4:12); /* land=その技の着地硬直 */ p.vx=0; break;}
    case 'launch':
      p.vx=0; p.jug=0;
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
const projDir=(q,d)=>q.vx>0?1:(q.vx<0?-1:(d.x>=q.x?1:-1)); // 当たったときに押される向き
function updateProjs(s){
  for(const q of s.projs){
    if(q.phase===1){ if(--q.fuse<=0) explode(s,q); continue; }   // 刺さって待機中
    if(q.phase===2){ if(--q.life<=0) q.dead=true; continue; }     // 爆発中
    q.x+=q.vx; q.y+=q.vy; q.life--;
    const wall=q.x<=STAGE_L+10*FX||q.x>=STAGE_R-10*FX;
    if(q.stick&&(wall||q.life<=0)){
      if(q.x<STAGE_L+10*FX) q.x=STAGE_L+10*FX; if(q.x>STAGE_R-10*FX) q.x=STAGE_R-10*FX;
      q.phase=1; q.fuse=q.stick; q.vx=0; q.vy=0; s.events.push({type:'stick',x:q.x,y:q.y});
    }else if(q.life<=0||q.x<STAGE_L-50*FX||q.x>STAGE_R+50*FX||q.y<-200*FX) q.dead=true;
  }
  const live=s.projs.filter(q=>!q.dead&&q.phase===0);
  for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++){
    const A=live[i],B=live[j];
    if(A.owner!==B.owner&&Math.abs(A.x-B.x)<(A.w+B.w)*FX/2&&Math.abs(A.y-B.y)<(A.h+B.h)*FX/2){
      // 重い弾は普通の弾を消して進む。ただし breaker の弾は重い弾とも相殺する
      if(A.heavy===B.heavy||(A.heavy?B.breaker:A.breaker)) A.dead=B.dead=true; else if(A.heavy) B.dead=true; else A.dead=true;
      s.events.push({type:'clash',x:(A.x+B.x)>>1,y:A.y});
    }
  }
}
function canBlock(d,a,guard,proj){
  if(d.air) return false;
  if(!(d.state==='idle'||d.state==='walk'||d.state==='crouch'||d.state==='blockstun')) return false;
  const inp=d.curIn;
  // 動いている弾は進行方向の逆、止まっている爆発は撃った相手の逆（どちらも普通の後ろ入れでガードできる）
  const away=proj&&proj.vx!==0?(proj.vx>0?BT.RIGHT:BT.LEFT):(a.x>d.x?BT.LEFT:BT.RIGHT);
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
// 投げ抜け：a=投げた側 d=抜けた側。ダメージなしで互いに離れ、同じ硬直で仕切り直し
function techBreak(s,a,d){
  const dir=d.x>=a.x?1:-1;
  for(const [p,sg] of [[a,-dir],[d,dir]]){
    p.state='land'; p.t=14; p.move=null; p.vx=0; p.push=sg*700; p.crouch=false;
    for(const k of ATK_KEYS) p.buf[k]=0;
  }
  s.hitstop=6; s.events.push({type:'tech',x:(a.x+d.x)>>1,y:d.y-110*FX});
}
function checkHits(s){
  const ev=[], grabs=[];
  for(let i=0;i<2;i++){
    const a=s.p[i],d=s.p[1-i],hb=activeBox(a);
    if(!hb) continue;
    const m=MV(a);
    if(m.throw){ if(d.inv||d.air||!THROWABLE.has(d.state)) continue; }
    else if(d.inv&&!(d.state==='launch'&&(a.canc||d.jug>0||(m.rehit&&a.hitConn)))) continue; // 多段技は自分で浮かせた相手に続けて当たる
    const hit=hurtBoxes(d).find(h=>ov(hb,h));
    if(!hit) continue;
    if(m.throw) grabs.push({a,d}); else ev.push({a,d,m,proj:null,...contact(hb,hit)});
  }
  for(const q of s.projs){
    if(q.dead||q.phase===1||(q.phase===2&&q.hitDone)) continue;
    const d=s.p[1-q.owner]; if(d.inv&&!(d.state==='launch'&&(q.canc||d.jug>0))) continue;
    const r={x:q.x-q.w*FX/2,y:q.y-q.h*FX/2,w:q.w*FX,h:q.h*FX};
    const hit=hurtBoxes(d).find(h=>ov(r,h));
    if(hit){ev.push({a:s.p[q.owner],d,m:q,proj:q,...contact(r,hit)}); if(q.phase===2) q.hitDone=true; else q.dead=true;}
  }
  for(const e of ev) applyHit(s,e);
  if(grabs.length===2) techBreak(s,grabs[0].a,grabs[0].d); // 同時に投げ合ったら相殺
  else for(const {a,d} of grabs){
    if(d.state==='hitstun'||d.state==='launch') continue; // 同じフレームに打撃が当たっていたら投げは不成立
    if(a.state!=='attack'||!a.move) continue; // 投げた側が同じフレームに殴られていたら不成立
    const tm=MV(a);
    if(!tm.notech&&d.state==='attack'&&d.move&&MV(d).throw){techBreak(s,a,d); continue;} // 相手も投げを出しかけていたら投げ抜け扱い
    a.hitDone=true; d.state='grabbed'; d.gm=a.move; d.t=tm.notech?3:TECH_WINDOW; d.move=null; d.vx=0; d.push=0; d.crouch=false;
  }
}
function applyHit(s,e){
  const {a,d,m,proj}=e;
  const dir=proj?projDir(proj,d):(d.x>a.x?1:(d.x<a.x?-1:a.facing));
  const power=(!proj&&m.sword&&a.noSword)?60:100; // 剣を投げている間の剣技は威力60%
  const wasLaunch=d.state==='launch';
  if(!proj){a.hitDone=true; a.hitConn=true;}
  const kb=m.kb||400, special=!!(m.special||m.super);
  const blocked=!m.throw&&canBlock(d,a,m.guard||'mid',proj);
  if(!blocked&&!m.throw&&!m.super&&d.state==='attack'&&!d.armorUsed){ // アーマー：1発だけ、ひるまずに耐える（ダメージは7割受ける）
    const dm=MV(d), dmg=(m.dmg*power*7/1000)|0;
    if(dm.armor&&d.mf>=dm.armor[0]&&d.mf<=dm.armor[1]&&d.hp>dmg){
      d.armorUsed=true; d.hp-=dmg; a.meter=Math.min(MAX_METER,a.meter+(m.meter>>1)); s.hitstop=8;
      s.events.push({type:'armor',x:e.px,y:e.py}); return;
    }
  }
  if(d.state==='launch'&&d.jug>0) d.jug--;
  let adv=null;
  if(blocked){
    d.state='blockstun'; d.stun=m.bs; d.move=null; d.vx=0; d.push=dir*kb;
    const chip=m.chip!=null?m.chip:(special?(m.dmg/8|0):0);
    d.hp=Math.max(0,d.hp-chip);
    if(!a.noGain) a.meter=Math.min(MAX_METER,a.meter+(m.meter>>1));
    d.meter=Math.min(MAX_METER,d.meter+15);
    s.hitstop=8;
    if(!proj) adv=m.bs-(m.T-a.mf);
    s.events.push({type:'block',x:e.px,y:e.py});
  }else{
    const scale=Math.max(m.super?50:30,100-10*Math.max(0,d.combo-1));
    const dmg=(m.dmg*power*scale/10000)|0;
    d.hp=Math.max(0,d.hp-dmg); d.combo++;
    if(!a.noGain) a.meter=Math.min(MAX_METER,a.meter+m.meter);
    d.meter=Math.min(MAX_METER,d.meter+(dmg>>1));
    d.move=null;
    if(s.mode==='training'&&d.hp<1) d.hp=1;
    if(m.kd||m.lift||!m.hs||d.air||d.hp<=0){
      d.state='launch'; d.air=true; d.crouch=false;
      // ダウン技は高く・近くに浮かせて、キャンセルした追撃が届くようにする
      const lv=m.lv||(m.super?[-1300,520]:m.launcher?[-1500,60]:m.lift?[-1350,80]:m.kd?[-1200,150]:[-950,360]);
      d.vy=lv[0]; d.vx=dir*lv[1]; d.push=0;
      if(m.launcher) d.jug=JUGGLE;
      else if(m.lift&&!wasLaunch) d.jug=2; // 浮いている相手に当て直しても追撃回数は増えない
      if(!proj) adv='down';
    }else{
      // コンボが長くなるほどのけぞりが短くなる（4ヒット目から1発ごとに-1F）。目押しで延々つなぐ永久コンボを止める
      const hs=Math.max(HS_MIN,m.hs-Math.max(0,d.combo-HS_FREE)*HS_DECAY);
      d.state='hitstun'; d.stun=hs; d.vx=0; d.push=dir*kb;
      if(!proj) adv=hs-(m.T-a.mf);
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
    p.curIn=inp; p.prevIn=inp; p.pressed=pressed;
    if(pressed&BT.L)p.buf.L=BUF_LEN; if(pressed&BT.M)p.buf.M=BUF_LEN; if(pressed&BT.H)p.buf.H=BUF_LEN;
    if(pressed&BT.SP) p.buf.SP=BUF_LEN;
    if(pressed&(BT.L|BT.M|BT.H|BT.SP)) p.spIn=inp&15; // 攻撃・技ボタンを押した瞬間の方向も覚えておく（ヒットストップ中の先行入力用）
     if(pressed&BT.SU)p.buf.SU=BUF_LEN;
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
  for(const p of s.p) p.noSword=s.projs.some(q=>q.owner===p.i&&q.kind==='sword');
  if(s.mode==='training'){
    for(const p of s.p){
      p.idleT=ACTIONABLE.has(p.state)?p.idleT+1:0;
      if(p.idleT>40){p.hp=CHARS[p.ch].hp; p.meter=MAX_METER;}
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
  if(p.state==='grabbed'){ // 投げ抜けは35%で成功
    if(!ai.gr){ai.gr=true; ai.tech=rnd(s)<0.35;}
    return ai.tech?(BT.L|BT.M):0;
  }
  ai.gr=false;
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
    const low=(o.state==='attack'&&MV(o).guard==='low')||s.projs.some(q=>q.owner===o.i&&q.guard==='low');
    return back|(low?BT.DOWN:0);
  }
  if(p.state==='jump'&&p.vy>0&&dist<170) return BT.H;
  if(ai.t>0){ai.t--; return ai.hold;}
  const r=rnd(s); let h=0,t=8;
  const myProj=s.projs.some(q=>q.owner===i);
  const C=CHARS[p.ch], grab=!!C.moves.spN.throw; // 技（その場）が投げのキャラは遠くで振らない
  if(grab&&dist<130&&r<0.25&&ACTIONABLE.has(p.state)){ai.hold=BT.SP; ai.t=3; return 0;}
  if(C.zone&&dist>150&&r<0.6){ // 飛び道具キャラは離れて撃ち分ける
    const k=(r*1000|0)%4; ai.hold=k===0?BT.SP:k===1?(BT.DOWN|BT.SP):k===2?(fwd|BT.SP):(o.air?(BT.UP|BT.SP):back); ai.t=k===3&&!o.air?10:4; return 0;
  }
  if(p.meter>=MAX_METER&&dist<240&&r<0.2){h=BT.SU; t=2;}
  else if(dist>380){
    if(r<0.3&&!myProj&&!grab){h=BT.SP; t=16;}
    else if(r<0.42){h=BT.UP|fwd; t=6;}
    else{h=fwd; t=12+(((r*1000)|0)%14);}
  }else if(dist>150){
    if(r<0.15){h=fwd|BT.SP; t=4;}
    else if(r<0.3){h=BT.UP|fwd; t=6;}
    else if(r<0.42&&!myProj&&!grab){h=BT.SP; t=16;}
    else if(r<0.52){h=back; t=10;}
    else{h=fwd; t=10;}
  }else{
    if(r<0.22){h=BT.DOWN|BT.L; t=3;}
    else if(r<0.33){h=BT.L; t=3;}
    else if(r<0.44){h=BT.DOWN|BT.H; t=3;}
    else if(r<0.52){h=BT.H; t=3;}
    else if(r<0.58){h=fwd|BT.H; t=3;}
    else if(r<0.66&&dist<110){h=BT.L|BT.M; t=3;}
    else if(r<0.74){h=BT.DOWN|BT.SP; t=3;}
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
  const low=(atk&&MV(o).guard==='low')||s.projs.some(q=>q.owner===0&&q.guard==='low');
  return away|(low?BT.DOWN:0);
}
