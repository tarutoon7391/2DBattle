// ================= キャラクターデータ =================
// 技データだけを持つ（処理は sim.js）。全キャラ同じ操作で、技の中身が違う。
// box: [前方オフセット, 足元からの高さ, 幅, 高さ]（px・右向き基準）
// s=発生 a=持続 r=硬直（フレーム） hs=ヒット硬直 bs=ガード硬直 kb=ノックバック
// 主な特殊フラグ:
//   chain/cancel … 通常技のつながり（chain の数字が大きい方へ）／技でキャンセル可
//   kd=ダウンを奪う  lift=浮かせる（追撃2回まで）  jc=当たったらジャンプでキャンセル可
//   rehit=nフレームごとに多段ヒット  moveVx=[開始F,終了F,速度] 前進  rise=飛び上がる  lv=[縦,横] 浮かせ方の指定
//   throw=投げ（ガード不可） notech=投げ抜け不可  armor=[開始F,終了F] 1発耐える  inv=[開始F,終了F] 無敵
//   proj=飛び道具（max=同時に出せる数 stick=壁に刺さってから爆発までのF ex=爆発 heavy=普通の弾を消して進む breaker=heavy の弾とも相殺）
//   land=空中技の着地硬直
//   sword=剣を使う技（剣を投げている間はリーチ45%・威力60%）  alt=剣を投げている間に化ける技
'use strict';
const BASE_MOVES={
  '5L':{name:'立ち弱',s:4,a:3,r:7,dmg:30,hs:15,bs:11,box:[20,108,72,22],guard:'mid',kb:400,meter:20,chain:1,cancel:true},
  '5M':{name:'立ち中',s:7,a:4,r:13,dmg:60,hs:19,bs:14,box:[20,92,95,26],guard:'mid',kb:500,meter:30,chain:2,cancel:true},
  '5H':{name:'立ち強',s:11,a:5,r:20,dmg:100,hs:23,bs:16,box:[20,78,118,36],guard:'mid',kb:650,meter:50,chain:3,cancel:true},
  '2L':{name:'しゃがみ弱',s:4,a:3,r:7,dmg:25,hs:14,bs:10,box:[20,8,75,20],guard:'low',kb:400,meter:20,chain:1,cancel:true},
  '2M':{name:'しゃがみ中',s:7,a:4,r:13,dmg:55,hs:18,bs:13,box:[20,5,100,22],guard:'low',kb:500,meter:30,chain:2,cancel:true},
  '2H':{name:'足払い',s:10,a:5,r:26,dmg:90,hs:0,bs:14,box:[20,0,125,20],guard:'low',kb:300,meter:50,chain:3,cancel:true,kd:true},
  '6H':{name:'前強（中段）',s:18,a:4,r:18,dmg:90,hs:21,bs:14,box:[20,60,100,70],guard:'high',kb:500,meter:50},
  'TH':{name:'投げ',s:5,a:2,r:22,dmg:110,hs:0,bs:0,box:[0,40,78,80],guard:'mid',kb:300,meter:40,throw:true,kd:true},
  'RC':{name:'ブレイクアッパー',s:5,a:4,r:16,dmg:50,hs:0,bs:14,box:[5,10,95,140],guard:'mid',kb:300,meter:0,cancel:true,launcher:true},
  'jL':{name:'ジャンプ弱',s:4,a:6,r:4,dmg:40,hs:16,bs:11,box:[10,40,65,30],guard:'high',kb:350,meter:20,air:true},
  'jM':{name:'ジャンプ中',s:6,a:5,r:6,dmg:65,hs:19,bs:13,box:[10,15,80,40],guard:'high',kb:400,meter:30,air:true},
  'jH':{name:'ジャンプ強',s:8,a:5,r:8,dmg:95,hs:22,bs:15,box:[0,-10,85,50],guard:'high',kb:450,meter:50,air:true},
  'spN':{name:'波動弾',s:13,a:1,r:32,meter:20,special:true,proj:{kind:'ball',vx:750,dmg:70,hs:20,bs:14,w:44,h:32,y:105,life:110}},
  'spD':{name:'スライディング',s:8,a:12,r:22,dmg:80,hs:0,bs:12,box:[0,0,90,22],guard:'low',kb:300,meter:60,special:true,kd:true,crouch:true,moveVx:[8,19,900]},
  'spU':{name:'昇竜拳',s:3,a:12,r:28,dmg:120,hs:0,bs:18,box:[5,60,60,110],guard:'mid',kb:200,meter:60,special:true,kd:true,inv:[1,7],rise:{f:3,vx:200,vy:-1500}},
  'spF':{name:'突進拳',s:12,a:6,r:20,dmg:90,hs:24,bs:12,box:[15,85,90,30],guard:'mid',kb:800,meter:60,special:true,moveVx:[6,17,1100]},
  'SU':{name:'烈光撃',s:6,a:20,r:30,dmg:320,hs:0,bs:20,box:[0,40,110,110],guard:'mid',kb:400,meter:0,super:true,kd:true,inv:[1,12],moveVx:[6,25,1400],chip:40},
};
// 基本技を土台に、キャラごとの差分を上書きする。fresh:true は土台を引き継がず丸ごと差し替え
function buildMoves(over){
  const o={};
  for(const k in BASE_MOVES) o[k]={...BASE_MOVES[k]};
  for(const k in over){
    const v={...over[k]}, fresh=v.fresh; delete v.fresh;
    o[k]=fresh?{guard:'mid',kb:400,hs:0,bs:14,meter:60,...v}:{...(o[k]||{}),...v};
  }
  for(const id in o){
    const m=o[id]; m.id=id; m.T=m.s-1+m.a+m.r;
    if(m.rehit&&!m._split){m.meter=Math.ceil(m.meter/Math.ceil(m.a/m.rehit)); m._split=true;} // 多段技のゲージ増加は合計で1技ぶん
  }
  return o;
}
const SP={fresh:true,special:true}, SUP={fresh:true,super:true,meter:0,kd:true};
const CHARS=[
  { id:'hayate', name:'ハヤテ', type:'スタンダード', hp:1000, walkF:360, walkB:280, jumpVy:-1550, jumpVx:420,
    desc:'飛び道具・対空・突進がそろった基本キャラ。まずはこれ。',
    col:{body:'#ff6a4d',light:'#ffd0b8',dark:'#8a2a1a'}, col2:{body:'#d9a441',light:'#fff0c2',dark:'#7a5510'}, look:'band',
    moves:buildMoves({}) },

  { id:'renji', name:'レンジ', type:'スタンダード（攻め）', hp:1000, walkF:390, walkB:290, jumpVy:-1550, jumpVx:440,
    desc:'踏み込む強攻撃と多段技で押し込む。立ち強→前強がつながり、中段は↓技。',
    col:{body:'#4da3ff',light:'#c8e4ff',dark:'#1a4a8a'}, col2:{body:'#7b6cff',light:'#dcd8ff',dark:'#2c2480'}, look:'spiky',
    moves:buildMoves({
      '5M':{s:6,r:14,dmg:55,box:[20,80,100,30]},
      '5H':{name:'踏み込み突き',s:12,r:22,dmg:95,box:[20,70,125,40],moveVx:[4,11,500]},
      '6H':{name:'踏み込み蹴り',s:14,a:5,r:20,dmg:85,hs:0,guard:'mid',box:[25,50,110,60],kd:true,chain:4,cancel:true,moveVx:[6,13,700]},
      '2H':{s:9,r:24},
      'spN':{...SP,name:'地走り',s:11,a:1,r:28,meter:20,proj:{kind:'wave',vx:900,dmg:60,hs:18,bs:13,w:50,h:50,y:25,life:45}},
      'spD':{...SP,name:'踵落とし（中段）',s:20,a:5,r:18,dmg:100,hs:22,box:[10,40,95,120],guard:'high',moveVx:[8,19,350]},
      'spU':{...SP,name:'双昇脚',s:5,a:14,r:26,dmg:65,rehit:7,kd:true,bs:18,box:[5,50,70,110],kb:200,inv:[1,5],rise:{f:5,vx:300,vy:-1350}},
      'spF':{...SP,name:'旋風脚',s:10,a:24,r:18,dmg:40,rehit:8,hs:20,box:[-10,70,110,50],kb:250,moveVx:[8,33,650]},
      'SU':{...SUP,name:'滅・連牙',s:5,a:30,r:28,dmg:80,rehit:6,bs:20,box:[0,30,115,120],lv:[-650,560],inv:[1,10],moveVx:[5,34,620],chip:12},
    }) },

  { id:'gouzan', name:'ゴウザン', type:'投げキャラ', hp:1200, walkF:250, walkB:200, jumpVy:-1400, jumpVx:330, bulk:130,
    desc:'足は遅いが体力と一発が大きい。技（その場）は抜けられない投げ、→技は1発耐えて突っ込む。',
    col:{body:'#5fbf6a',light:'#d6f5d9',dark:'#1f5a28'}, col2:{body:'#b98a5a',light:'#f3e2cf',dark:'#5c3d1e'}, look:'bald',
    moves:buildMoves({
      '5L':{s:5,r:8,dmg:35,box:[20,100,80,26]},
      '5M':{s:9,r:15,dmg:75,box:[20,80,105,34]},
      '5H':{s:14,a:6,r:24,dmg:125,hs:25,box:[20,60,125,60],kb:800},
      '2L':{s:5,r:8,dmg:30},
      '2M':{s:8,r:15,dmg:65},
      '2H':{s:12,a:6,r:28,dmg:105,box:[20,0,130,24]},
      '6H':{name:'ヘッドバット（中段）',s:16,r:20,dmg:100,box:[20,90,85,70]},
      'jH':{name:'ボディプレス',s:8,a:12,r:6,dmg:105,box:[-30,-10,90,40]},
      'TH':{dmg:150,r:24,box:[0,40,95,80]},
      'spN':{...SP,name:'スクリュードライバー',s:7,a:2,r:36,dmg:230,throw:true,notech:true,kd:true,box:[0,30,125,100],meter:80},
      'spD':{...SP,name:'地ならし',s:16,a:4,r:26,dmg:85,guard:'low',kd:true,box:[10,0,190,26]},
      'spU':{...SP,name:'対空かち上げ',s:6,a:8,r:26,dmg:140,kd:true,bs:18,box:[0,90,90,130],armor:[1,13]},
      'spF':{...SP,name:'ショルダーチャージ',s:14,a:10,r:22,dmg:110,kd:true,bs:16,box:[10,50,80,90],moveVx:[8,23,950],armor:[4,23]},
      'SU':{...SUP,name:'大山落とし',s:4,a:3,r:40,dmg:400,throw:true,notech:true,box:[0,30,135,110],inv:[1,6]},
    }) },

  { id:'mizuki', name:'ミヅキ', type:'技巧・コンボ', hp:900, walkF:430, walkB:340, jumpVy:-1600, jumpVx:460, airJumps:1, airChain:true, spCancel:true,
    desc:'威力は低いが手数で稼ぐ。2段ジャンプ、空中で弱→中→強、技から別の技へキャンセル、↓強で浮かせてジャンプで追える。',
    col:{body:'#e86ad6',light:'#ffd6f8',dark:'#7a1f6e'}, col2:{body:'#4fd1c5',light:'#d2fbf6',dark:'#156a62'}, look:'tail',
    moves:buildMoves({
      '5L':{s:3,r:6,dmg:22,box:[20,105,68,22]},
      '5M':{s:6,r:14,dmg:45},
      '5H':{s:9,r:17,dmg:75,hs:22},
      '2L':{s:3,r:6,dmg:20},
      '2M':{s:6,r:13,dmg:42},
      '2H':{name:'蹴り上げ',s:9,a:5,r:22,dmg:60,guard:'mid',box:[15,40,80,120],kd:false,lift:true,jc:true},
      '6H':{s:16,r:16,dmg:70},
      'jL':{s:3,r:3,dmg:30,chain:1,cancel:true},
      'jM':{s:5,dmg:48,chain:2,cancel:true},
      'jH':{s:7,dmg:70,chain:3,cancel:true},
      'jS':{...SP,name:'急降下蹴り',s:6,a:20,r:6,dmg:60,hs:20,bs:12,box:[0,-20,60,60],air:true,dive:{vy:1400,vx:700},meter:40,land:18}, // 着地硬直が長く、当てても着地から技につながらない
      'TH':{dmg:100},
      'spN':{...SP,name:'連掌',s:6,a:13,r:18,dmg:28,rehit:4,hs:18,bs:12,box:[15,80,85,50],kb:150,meter:25},
      'spD':{...SP,name:'滑り蹴り',s:7,a:10,r:18,dmg:60,guard:'low',kd:true,bs:12,box:[0,0,85,22],crouch:true,moveVx:[7,16,1000]},
      'spU':{...SP,name:'燕返し',s:4,a:8,r:24,dmg:80,kd:true,bs:18,box:[5,60,65,110],kb:200,inv:[1,4],rise:{f:4,vx:150,vy:-1400}},
      'spF':{...SP,name:'影抜け（裏回り）',s:10,a:1,r:10,meter:10,inv:[5,10],tele:{f:8,off:70}},
      'SU':{...SUP,name:'乱れ桜',s:5,a:36,r:24,dmg:48,rehit:4,bs:20,box:[0,40,100,110],lv:[-500,520],inv:[1,8],moveVx:[5,40,500],chip:6},
    }) },

  { id:'tsurugi', name:'ツルギ', type:'長剣', hp:1000, walkF:300, walkB:240, jumpVy:-1500, jumpVx:380,
    desc:'とにかくリーチが長いが振りは遅い。技で剣を投げると壁に刺さって爆発（もう一度技で即起爆）。投げている間はリーチと威力が落ちる。',
    col:{body:'#9aa7c7',light:'#f1f5ff',dark:'#3a4466'}, col2:{body:'#c7a34a',light:'#fff3c9',dark:'#6a5216'}, look:'sword',
    moves:buildMoves({
      '5L':{name:'柄打ち',s:5,r:8,dmg:35,box:[20,100,75,24]},
      '5M':{name:'横薙ぎ',s:9,r:16,dmg:70,box:[20,85,175,26],sword:true},
      '5H':{name:'大振り',s:15,r:26,dmg:115,hs:24,box:[20,60,235,50],sword:true},
      '2L':{s:5,r:8,dmg:28},
      '2M':{name:'下段突き',s:9,r:16,dmg:62,box:[20,5,180,22],sword:true},
      '2H':{name:'大足払い',s:14,r:30,dmg:95,box:[20,0,230,22],sword:true},
      '6H':{name:'兜割り（中段）',s:22,r:22,dmg:110,box:[30,40,210,150],sword:true},
      'jL':{s:5},
      'jM':{box:[10,20,150,36],dmg:68,sword:true},
      'jH':{s:10,a:6,dmg:100,box:[-10,-30,170,70],sword:true},
      'spN':{...SP,name:'投剣',s:14,a:1,r:26,meter:20,alt:'spX',
             proj:{kind:'sword',vx:1500,dmg:90,hs:22,bs:15,w:150,h:18,y:100,life:200,stick:50,heavy:true,ex:{w:210,h:210,dmg:120}}},
      'spX':{...SP,name:'起爆',s:5,a:1,r:14,meter:0,detonate:true},
      'spD':{...SP,name:'地擦り斬り',s:11,a:5,r:24,dmg:85,guard:'low',kd:true,box:[20,0,240,26],crouch:true,sword:true},
      'spU':{...SP,name:'昇り斬り',s:6,a:8,r:30,dmg:110,kd:true,bs:18,box:[10,40,120,200],inv:[1,4],sword:true},
      'spF':{...SP,name:'大回転斬り',s:13,a:20,r:24,dmg:45,rehit:7,hs:20,box:[-120,60,300,50],kb:250,moveVx:[10,32,450],sword:true},
      'SU':{...SUP,name:'天断ち',s:8,a:8,r:40,dmg:340,bs:22,box:[20,0,420,260],inv:[1,8],chip:50,sword:true},
    }) },

  { id:'hotaru', name:'ホタル', type:'飛び道具', hp:900, walkF:330, walkB:300, jumpVy:-1550, jumpVx:400, zone:true,
    desc:'4種類の弾で近づかせない。その場＝速い弾（2発まで）、↓＝地を這う下段、↑＝斜め上の対空、→＝ゆっくり進む大玉。近距離は弱い。',
    col:{body:'#ffd24d',light:'#fff6cf',dark:'#8a6a10'}, col2:{body:'#ff8fa3',light:'#ffe1e7',dark:'#8a2a3e'}, look:'hat',
    moves:buildMoves({
      '5L':{s:5,dmg:25},
      '5M':{s:8,dmg:50,box:[20,85,105,26]},
      '5H':{s:12,r:22,dmg:80,box:[20,70,130,36],kb:900},
      '2H':{s:11,dmg:75},
      '6H':{name:'突き放し',s:13,r:20,dmg:70,guard:'mid',kb:1300,box:[20,70,100,60]},
      'jH':{dmg:80},
      'spN':{...SP,name:'光弾',s:10,a:1,r:24,meter:15,proj:{kind:'ball',vx:1000,dmg:55,hs:18,bs:13,w:36,h:26,y:105,life:110,max:2,breaker:true}}, // ツルギの投剣とも相殺できる
      'spD':{...SP,name:'地這い（下段）',s:13,a:1,r:28,meter:20,proj:{kind:'wave',vx:650,dmg:60,hs:19,bs:13,w:60,h:30,y:15,life:140,guard:'low'}},
      'spU':{...SP,name:'対空弾',s:9,a:1,r:28,meter:20,proj:{kind:'ball',vx:700,vy:-700,dmg:70,hs:0,bs:14,w:40,h:40,y:130,life:60,kd:true}},
      'spF':{...SP,name:'重光球',s:18,a:1,r:30,meter:25,proj:{kind:'orb',vx:260,dmg:90,hs:24,bs:18,w:70,h:70,y:95,life:260,heavy:true}},
      'SU':{...SUP,name:'極光砲',s:10,a:18,r:36,dmg:300,bs:22,box:[40,60,760,70],inv:[1,6],chip:60,beam:true},
    }) },
];
if(typeof module!=='undefined') module.exports={CHARS,BASE_MOVES};
