// コンボ探索（ビームサーチ）：攻撃側が動ける／キャンセルできる瞬間ごとに全行動を試し、コンボ数が伸びる枝を残す
// 使い方: node test/combo-search.js public <キャラ番号|all> [永久とみなすヒット数=40] [探索の幅=120]
//   環境変数 M=0|1000（ゲージ） C=0|1（画面端） DUMP=1（見つけたコンボの内訳を表示）
const fs=require('fs');const dir=process.argv[2]||'public';
const src=fs.readFileSync(dir+'/chars.js','utf8')+'\n'+fs.readFileSync(dir+'/sim.js','utf8');
const A=new Function(src+';return{newState,step,BT,CHARS,FX,MV,ACTIONABLE};')();const B=A.BT;
const ACTS={L:B.L,M:B.M,H:B.H,'2L':B.DOWN|B.L,'2M':B.DOWN|B.M,'2H':B.DOWN|B.H,'6H':B.RIGHT|B.H,S:B.SP,'2S':B.DOWN|B.SP,'8S':B.UP|B.SP,'6S':B.RIGHT|B.SP,
  J:B.UP,JF:B.UP|B.RIGHT,W:B.RIGHT,_:0,R:0,SU:B.SU,RC:B.L|B.M|B.H};
const names=Object.keys(ACTS);
const fwdFix=(s,bits)=>{const a=s.p[0],d=s.p[1];if(a.x>d.x&&(bits&B.RIGHT))return (bits&~B.RIGHT)|B.LEFT;return bits;}; // 「前」を相手側に
function search(ch,meter,corner,LIMIT,BEAM){
  const s0=A.newState('2p',[ch,0]);s0.phase='fight';s0.p[0].x=corner?84000:40000;s0.p[1].x=s0.p[0].x+7000;s0.p[0].meter=meter;
  let front=[{s:JSON.stringify(s0),seq:[],c:0,f:0,dmg:0}],best={c:0,seq:[],dmg:0};
  for(let it=0;it<400&&front.length;it++){
    const next=[];
    for(const n of front){
      for(const an of names){
        if((an==='SU'||an==='RC')&&!meter) continue;
        const s=JSON.parse(n.s);const a=s.p[0],d=s.p[1];let c=n.c,alive=true,f=n.f,hp0=d.hp;
        const bits=fwdFix(s,ACTS[an]);const hold=an==='W'?4:(an==='_'?2:2);
        const mv0=a.move,st0=a.state;
        for(let k=0;k<60;k++){
          const inp=k<hold?bits:0;
          const before=d.combo;
          A.step(s,[inp,0]);s.events.length=0;f++;if(!meter)a.meter=0;d.hp=1000;s.timer=5000;
          if(d.combo<before||(before>0&&d.combo===0)){alive=false;break;} // コンボが途切れた
          if(d.combo>c)c=d.combo;
          if(k>=hold){ // 次に行動を選べる瞬間まで進める
            const free=A.ACTIONABLE.has(a.state);
            const can=free||(an!=='R'&&a.state==='attack'&&a.hitConn&&a.mf>=A.MV(a).s&&s.hitstop===0);
            if(can) break; // R は「硬直が終わるまで何もしない」（目押し用）
          }
        }
        if(c===0&&f>40) alive=false; // 最初の1発が当たらない枝は捨てる
        if(!alive){ if(c>best.c){best={c,seq:[...n.seq,an]};} continue; }
        const dmgTot=n.dmg+0;
        next.push({s:JSON.stringify(s),seq:[...n.seq,an],c,f,q:c*1000+(d.state==='hitstun'?d.stun:(d.state==='launch'?12:0))});
        if(c>best.c) best={c,seq:[...n.seq,an]};
        if(c>=LIMIT) return {inf:true,...best};
      }
    }
    // 似た状態をまとめてから、コンボ数が多く・経過フレームが短い順に残す
    const seen=new Map();
    for(const n of next){const s=JSON.parse(n.s),a=s.p[0],d=s.p[1];const key=[n.c,a.state,a.move,a.mf>>1,(a.x-d.x)>>9,a.y>>10,d.state,d.stun>>1,d.y>>10,d.jug,a.air,a.aj,a.airUsed,a.spc,s.projs.length].join('|');if(!seen.has(key))seen.set(key,n);}
    // 地上/空中・相手が浮いているか、で分けて各グループから上位を残す（空中ルートが地上ルートに押し出されないように）
    const groups=new Map();
    for(const n of seen.values()){const st=JSON.parse(n.s),a=st.p[0],d=st.p[1];const g=(a.air?1:0)+(d.state==='launch'?2:0)+(a.aj?4:0)+(d.jug?8:0);if(!groups.has(g))groups.set(g,[]);groups.get(g).push(n);}
    front=[];for(const arr of groups.values())front.push(...arr.sort((x,y)=>y.q-x.q||x.f-y.f).slice(0,Math.ceil(BEAM/3)));
  }
  return {inf:false,...best};
}
function replay(ch,meter,corner,seq){
  const s=A.newState('2p',[ch,0]);s.phase='fight';s.p[0].x=corner?84000:40000;s.p[1].x=s.p[0].x+7000;s.p[0].meter=meter;const a=s.p[0],d=s.p[1];let out=[],dmgSum=0;
  for(const an of seq){const bits=fwdFix(s,ACTS[an]);const hold=an==='W'?4:2;
    for(let k=0;k<60;k++){const c0=d.combo,h0=d.hp;A.step(s,[k<hold?bits:0,0]);s.events.length=0;if(!meter)a.meter=0;dmgSum+=h0-d.hp;d.hp=1000;s.timer=5000;if(d.combo<c0)dmgSum=0;
      if(d.combo>c0)out.push(`${d.combo}:${a.move||'弾'}→${d.state}${d.state==='hitstun'?d.stun:''}${d.state==='launch'?'(jug'+d.jug+')':''}`);
      if(k>=hold){const free=A.ACTIONABLE.has(a.state);if(free||(an!=='R'&&a.state==='attack'&&a.hitConn&&a.mf>=A.MV(a).s&&s.hitstop===0))break;}}}
  console.log(process.env.DUMP==='2'?'ダメージ合計 '+dmgSum:out.join('  ')+'  ダメージ合計 '+dmgSum);
}
const only=process.argv[3]!==undefined&&process.argv[3]!=='all'?[+process.argv[3]]:A.CHARS.map((_,i)=>i);
const LIMIT=+process.argv[4]||40,BEAM=+process.argv[5]||120;
const METERS=process.env.M?[+process.env.M]:[0,1000],CORNERS=process.env.C?[process.env.C==='1']:[false,true];
for(const ch of only) for(const meter of METERS) for(const corner of CORNERS){
  const r=search(ch,meter,corner,LIMIT,BEAM);
  if(process.env.DUMP) replay(ch,meter,corner,r.seq);
  console.log(A.CHARS[ch].name,meter?'ゲージ有':'ゲージ無',corner?'端  ':'中央',r.inf?`【永久】${r.c}ヒット以上`:`最大${r.c}ヒット`,'|',r.seq.slice(0,r.inf?45:60).join(' '));
}
