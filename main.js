// main.js ── 交点マスター（複数入力フィールド対応・汎用版）
'use strict';

/* ===== 採点（DOM に触らない。回帰テストからも呼ぶ） =====
   採点は GRADER-CORE（grader-core.js）に任せる。正解は文字列 q.answers = [x, y]（'-\frac{3}{4}' など）。
   戻り値は GraderCore の結果 {status, reason, parts, …} に、画面に出すアプリ側の一言 note を足したもの。 */
function koutenHasDecimal(raw){
  var n = GraderCore.normalize(raw);
  return !!(n && n.s && n.s.indexOf('.') >= 0);
}
// 正解が有限小数で書けるか（分母が 2 と 5 だけ）
function koutenTerminates(ans){
  var m = String(ans).match(/\\d?frac\{(\d+)\}\{(\d+)\}/) || String(ans).match(/(\d+)\/(\d+)/);
  var d = m ? parseInt(m[2], 10) : 1;
  while (d % 2 === 0) d /= 2;
  while (d % 5 === 0) d /= 5;
  return d === 1;
}
function gradeAnswer(q, raws){
  raws = raws || [];
  // 空欄・空の枠が1つでもあれば採点しない（書き直してもらう）
  for (var i = 0; i < 2; i++) if (GraderCore.isBlank(raws[i])) return { status: 'empty', reason: 'empty', note: '' };
  for (i = 0; i < 2; i++) if (GraderCore.hasEmptySlot(raws[i])) return { status: 'unreadable', reason: 'emptySlot', note: '' };
  // 「x=\frac32」のように文字を書き添えても読む。x の欄に「y=…」は×
  var rx = GraderCore.gradeNumber(raws[0], q.answers[0], { lhs: 'x' });
  var ry = GraderCore.gradeNumber(raws[1], q.answers[1], { lhs: 'y' });
  var r = GraderCore.worst([rx, ry]);
  r.parts = [rx, ry];
  r.note = koutenNote(r.parts, raws, q.answers);
  return r;
}
// GraderCore の一言が無いときに足す、アプリ側の一言（未約分・符号2つは決定どおり何も出さない）
function koutenNote(parts, raws, answers){
  var i;
  for (i = 0; i < parts.length; i++) if (parts[i].reason === 'expression') return '計算を最後までして、1つの数で答えよう';
  for (i = 0; i < parts.length; i++) {
    if (parts[i].status === 'wrong' && parts[i].reason === 'value' && koutenHasDecimal(raws[i]) && !koutenTerminates(answers[i])) return '割り切れない数は分数で答えよう';
  }
  return '';
}
function koutenNeedsRewrite(r){ return r.reason === 'empty' || r.reason === 'emptySlot'; }

/* ===== 仮想キーボード（タッチ端末） =====
   仮想キーボードの ⏎ は keydown を出さず、欄に beforeinput（inputType 'insertLineBreak'）を出す（MathLive 0.98.4 で確認）。
   キーボードの Enter は keydown で受けて既定の動作を止めるので beforeinput は出ないが、念のため直前に Enter の keydown が
   あったときは何もしない（二重に採点しない）。 */
function onVirtualEnter(field, fn){
  if(!field) return;
  var lastKeyEnter = 0;
  field.addEventListener('keydown', function(e){ if(e.key === 'Enter') lastKeyEnter = Date.now(); }, { capture: true });
  field.addEventListener('beforeinput', function(e){
    if(e.inputType !== 'insertLineBreak') return;
    e.preventDefault();
    if(Date.now() - lastKeyEnter < 500) return;
    fn(e);
  });
}
// 締め切ったら仮想キーボードを閉じる（「次へ」を隠さないように）。
// 出ていたときだけ欄からフォーカスを外す（キーボード付きの端末では、そのまま Enter で次へ進めるように）
function closeVirtualKeyboard(fields){
  var vk = window.mathVirtualKeyboard, wasVisible = false;
  try{ wasVisible = !!(vk && vk.visible); if(vk && vk.hide) vk.hide(); }catch(e){ /* 何もしない */ }
  if(wasVisible) (fields || []).forEach(function(f){ try{ if(f && f.blur) f.blur(); }catch(e){ /* 何もしない */ } });
}

(function(){

/* ===== localStorage ===== */
const STORE_KEY = 'oniripi_kouten_v1';
const mem = {};
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return mem[k]??null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){ mem[k]=v; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){ delete mem[k]; } }
};
function loadData(){ try{ return JSON.parse(store.get(STORE_KEY))||{high:0,history:[]}; }catch(e){ return {high:0,history:[]}; } }
function saveData(d){ store.set(STORE_KEY, JSON.stringify(d)); }

/* ===== 状態 ===== */
let level=1, session=[], idx=0, score=0, hintStep=0, hintGraphLevel=0, locked=false, busy=false, results=[];
// 「決定」の連打で、同じ位置に出る「次へ」まで押してしまわないよう、採点直後は少しだけ押せなくする
const NEXT_GUARD_MS=400;
let nextGuardUntil=0;
let fields=[];
let lastFocused=null;
const QN = 5;

/* ===== DOM ===== */
const $ = id=>document.getElementById(id);
const screens = { start:$('screen-start'), quiz:$('screen-quiz'), result:$('screen-result') };
function show(name){
  Object.values(screens).forEach(s=>s.classList.remove('active')); screens[name].classList.add('active');
  if(window.setWritingMode) window.setWritingMode(name==='quiz' && window.isWritingMode&&window.isWritingMode());
  if(name!=='quiz' && window.clearWriting) window.clearWriting();
}
function typeset(el){ if(window.MathJax&&MathJax.typesetPromise) MathJax.typesetPromise(el?[el]:undefined).catch(()=>{}); }

/* ===== 座標平面の描画（oniripi-1ji-graph 方式を流用） ===== */
const CANVAS_PX = 480;            // 内部描画解像度（CSSで vh スケール）
const LINE_COLORS = ['#2f7ff0', '#e8590c']; // 直線① / 直線②
let gcanvas=null, gctx=null, gRange=6;
function gUnit(){ return CANVAS_PX / (gRange*2); }
function g2c(gx,gy){ const u=gUnit(); return { x:CANVAS_PX/2 + gx*u, y:CANVAS_PX/2 - gy*u }; }

function setupCanvas(){
  gcanvas=$('graph-canvas'); if(!gcanvas) return;
  gctx=gcanvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  gcanvas.width=CANVAS_PX*dpr; gcanvas.height=CANVAS_PX*dpr;
  gctx.setTransform(dpr,0,0,dpr,0,0); // HiDPI（くっきり）
}
function drawGrid(){
  const R=gRange, O=CANVAS_PX/2;
  gctx.fillStyle='#fbfcff'; gctx.fillRect(0,0,CANVAS_PX,CANVAS_PX);
  // グリッド線
  for(let g=-R; g<=R; g++){
    if(g===0) continue;
    const lx=g2c(g,0).x, ly=g2c(0,g).y;
    const major=Math.abs(g)===R-1;
    gctx.strokeStyle=major?'#b8c8e5':'#d7e1f3'; gctx.lineWidth=1;
    gctx.beginPath(); gctx.moveTo(lx,0); gctx.lineTo(lx,CANVAS_PX); gctx.stroke();
    gctx.beginPath(); gctx.moveTo(0,ly); gctx.lineTo(CANVAS_PX,ly); gctx.stroke();
  }
  // 軸
  gctx.strokeStyle='#4a5365'; gctx.lineWidth=2; gctx.lineCap='round';
  gctx.beginPath(); gctx.moveTo(0,O); gctx.lineTo(CANVAS_PX-4,O); gctx.stroke();
  gctx.beginPath(); gctx.moveTo(O,CANVAS_PX); gctx.lineTo(O,4); gctx.stroke();
  gctx.fillStyle='#4a5365';
  gctx.beginPath(); gctx.moveTo(CANVAS_PX-4,O); gctx.lineTo(CANVAS_PX-13,O-5); gctx.lineTo(CANVAS_PX-13,O+5); gctx.fill();
  gctx.beginPath(); gctx.moveTo(O,4); gctx.lineTo(O-5,13); gctx.lineTo(O+5,13); gctx.fill();
  // 軸ラベル
  gctx.font='italic 700 14px Outfit, sans-serif'; gctx.fillStyle='#3a4252';
  gctx.textAlign='left'; gctx.fillText('x',CANVAS_PX-11,O-7);
  gctx.textAlign='center'; gctx.fillText('y',O+12,15);
  // 目盛り数字（範囲が広いLv3は奇数を間引いて見やすく）
  const step = R>=8 ? 2 : 1;
  gctx.font='600 11px Outfit, sans-serif'; gctx.fillStyle='#7a8398';
  for(let g=-(R-1); g<=R-1; g++){
    if(g===0||g%step!==0) continue;
    const cx=g2c(g,0).x, cy=g2c(0,g).y;
    gctx.textAlign='center'; gctx.fillText(g,cx,O+16);
    gctx.textAlign='right'; gctx.fillText(g,O-6,cy+4);
  }
  gctx.textAlign='right'; gctx.fillText('O',O-6,O+16);
}
// 直線 y = (a.n/a.d)x + b を範囲端まで描く（端の格子点ラベル①②を付ける）
function drawGraphLine(a,b,color,label){
  const R=gRange, slope=a.n/a.d;
  const pts=[];
  const yL=slope*(-R)+b, yR=slope*R+b;
  if(yL>=-R&&yL<=R) pts.push({x:-R,y:yL});
  if(yR>=-R&&yR<=R) pts.push({x:R,y:yR});
  if(Math.abs(slope)>1e-9){
    const xT=(R-b)/slope, xB=(-R-b)/slope;
    if(xT>-R&&xT<R) pts.push({x:xT,y:R});
    if(xB>-R&&xB<R) pts.push({x:xB,y:-R});
  }
  if(pts.length<2) return;
  const p=pts.slice(0,2);
  const c1=g2c(p[0].x,p[0].y), c2=g2c(p[1].x,p[1].y);
  gctx.save();
  gctx.strokeStyle=color; gctx.lineWidth=3.5; gctx.lineCap='round';
  gctx.beginPath(); gctx.moveTo(c1.x,c1.y); gctx.lineTo(c2.x,c2.y); gctx.stroke();
  // ラベル①②（線の端、原点から遠い側）
  const end = Math.hypot(c1.x-CANVAS_PX/2,c1.y-CANVAS_PX/2) > Math.hypot(c2.x-CANVAS_PX/2,c2.y-CANVAS_PX/2) ? c1 : c2;
  let lx=end.x, ly=end.y;
  lx += lx>CANVAS_PX/2 ? -16 : 14;
  ly += ly>CANVAS_PX/2 ? -10 : 18;
  lx=Math.max(12,Math.min(CANVAS_PX-12,lx)); ly=Math.max(14,Math.min(CANVAS_PX-8,ly));
  gctx.fillStyle=color; gctx.font='700 16px Outfit, sans-serif';
  gctx.textAlign='center'; gctx.textBaseline='middle';
  gctx.fillText(label,lx,ly); gctx.textBaseline='alphabetic';
  gctx.restore();
}
// ヒント用の格子点●（oniripi-1ji-graph の drawHintDot 方式）
function drawHintDot(gx,gy,label,color){
  const c=g2c(gx,gy);
  gctx.save();
  gctx.fillStyle='rgba(245,158,11,.18)';
  gctx.beginPath(); gctx.arc(c.x,c.y,15,0,Math.PI*2); gctx.fill();
  gctx.fillStyle=color||'#f59e0b'; gctx.strokeStyle='#fff'; gctx.lineWidth=2;
  gctx.beginPath(); gctx.arc(c.x,c.y,8,0,Math.PI*2); gctx.fill(); gctx.stroke();
  if(label){
    gctx.fillStyle='#b45309'; gctx.font='700 11px Outfit, sans-serif';
    gctx.textAlign='center';
    // 上が範囲外に近いときはラベルを下に出す
    const ly = gy>=gRange-1 ? c.y+20 : c.y-16;
    gctx.fillText(label,c.x,ly);
  }
  gctx.restore();
}
// 問題のグラフを描画（式ラベル・交点は出さない）。
// hintGraphLevel: 0=線のみ, 1=直線①の2点, 2=両直線の点
function drawGraph(q, hintGraphLevel){
  if(!gctx) return;
  const lvl = hintGraphLevel||0;
  const g=q.graph; gRange=g.range;
  gctx.clearRect(0,0,CANVAS_PX,CANVAS_PX);
  drawGrid();
  drawGraphLine(g.a1,g.b1,LINE_COLORS[0],'①');
  drawGraphLine(g.a2,g.b2,LINE_COLORS[1],'②');
  // ヒントの格子点（切片点＋右どなりの格子点）
  const hg=q.hintGraph;
  if(lvl>=1 && hg && hg.line1){
    hg.line1.forEach(p=>{ if(p) drawHintDot(p[0],p[1],`(${p[0]}, ${p[1]})`); });
  }
  if(lvl>=2 && hg && hg.line2){
    hg.line2.forEach(p=>{ if(p) drawHintDot(p[0],p[1],`(${p[0]}, ${p[1]})`); });
  }
}

/* ===== レベル選択 ===== */
document.querySelectorAll('.level-btn').forEach(btn=>{
  btn.onclick=()=>{ document.querySelectorAll('.level-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); level=+btn.dataset.level; };
});

/* ===== 履歴 ===== */
function renderHome(){
  const d=loadData();
  $('high-score').textContent=d.high||0;
  const list=$('history-list');
  if(!d.history||!d.history.length){ list.innerHTML='<p class="no-history">まだ記録がないよ！</p>'; return; }
  list.innerHTML=d.history.slice(-20).reverse().map(h=>{
    const pass=h.score>=Math.ceil(h.total*0.8);
    return `<div class="history-item"><span>${h.date} <small>Lv.${h.level}</small></span><span class="${pass?'pass':'fail'}">${h.score}/${h.total} ${pass?'合格':' '}</span></div>`;
  }).join('');
}

/* ===== 入力フィールド生成 ===== */
function buildFields(q){
  const row=$('answer-row'); row.innerHTML=''; fields=[];
  q.inputs.forEach((inp,i)=>{
    if(inp.before){ const sp=document.createElement('span'); sp.className='ans-fix'; sp.innerHTML=inp.before; row.appendChild(sp); }
    const wrap=document.createElement('span'); wrap.className='mf-inline';
    const mf=document.createElement('math-field'); mf.dataset.i=i;
    wrap.appendChild(mf); row.appendChild(wrap);
    if(inp.after){ const sp=document.createElement('span'); sp.className='ans-fix'; sp.innerHTML=inp.after; row.appendChild(sp); }
    mf.addEventListener('focus',()=>{ lastFocused=mf; });
    // 欄は問題ごとに作り直すので、作った直後に1回だけ設定する（値の書き換えはしない）
    GraderCore.setupMathField(mf,{ onEnter:onFieldEnter });
    onVirtualEnter(mf, onFieldEnter);   // 仮想キーボードの ⏎
    // タッチ端末で入力できるよう、仮想キーボードは auto にしておく（MathLive 0.98 の欄は OS のキーボードが出ない）。
    // 部品の版が古くても auto になるよう、ここでも指定する（キーボード付きの端末では出ない）
    mf.setAttribute('math-virtual-keyboard-policy','auto');
    try{ mf.mathVirtualKeyboardPolicy='auto'; }catch(e){}
    fields.push(mf);
  });
  lastFocused=fields[0]||null;
  typeset(row);
}
function getVal(mf){ return mf.getValue?mf.getValue('latex'):mf.value; }

/* ===== ヘルパーキー ===== */
document.querySelector('.helper-keys').addEventListener('click',e=>{
  const b=e.target.closest('.hkey'); if(!b||locked||busy) return;
  const f=lastFocused||fields[0]; if(!f) return;
  if(b.dataset.cmd==='frac'){ try{ f.executeCommand(['insert','\\frac{#0}{#?}']); }catch(_){ try{ f.insert('\\frac{#0}{#?}'); }catch(__){} } }
  else if(b.dataset.cmd==='minus'){ try{ f.insert('-'); }catch(_){} }
  else if(b.dataset.cmd==='clear'){ f.value=''; }
  f.focus();
});
// Enter：未採点なら採点、採点済みなら次へ。押しっぱなし・確認の画面中は何もしない
function onFieldEnter(e){
  if(e&&e.repeat) return;
  if(busy) return;
  if(locked){ if(!$('next-btn').classList.contains('hidden')) $('next-btn').click(); }
  else submit();
}

/* ===== ゲーム進行 ===== */
function startGame(reuse){
  if(!reuse) session=generateSession(level,QN);
  idx=0; score=0; results=[];
  $('level-tag').textContent='Lv.'+level;
  show('quiz'); loadQuestion();
}
function loadQuestion(){
  locked=false; hintStep=0; hintGraphLevel=0; clearFlash();
  const q=session[idx];
  $('q-counter').textContent=`Q ${idx+1} / ${session.length}`;
  $('progress-fill').style.width=(idx/session.length*100)+'%';
  $('score-display').textContent=score+'点';
  $('question-label').innerHTML=q.label;
  drawGraph(q, 0);
  $('question-extra').innerHTML=q.extra||'';
  screens.quiz.classList.remove('has-feedback');
  $('feedback-box').className='feedback-box hidden';
  resetHints();
  $('hint-btn').classList.remove('hidden'); $('hint-btn').textContent='💡 ヒント'; $('hint-btn').disabled=false;
  $('submit-btn').classList.remove('hidden'); $('submit-btn').disabled=false;
  $('next-btn').classList.add('hidden');
  buildFields(q);
  setTimeout(()=>{ try{ fields[0].focus(); }catch(_){} },60);
  setTimeout(()=>{ try{ if(window.clearWriting) window.clearWriting(); }catch(_){} },80);
  typeset(screens.quiz);
}

function submit(){
  if(locked||busy) return;
  const q=session[idx];
  const userVals=fields.map(getVal);
  const r=gradeAnswer(q, userVals);
  // 空欄・空の枠は採点せず、書き直してもらう（この問題は締め切らない）
  if(koutenNeedsRewrite(r)){ flashNote(r.reason==='emptySlot'||userVals.some(v=>GraderCore.hasEmptySlot(v))?'空いている枠（□）があるよ。うめてから決定してね':'全部のマスを入力してね！'); return; }
  finishQuestion(r, userVals);
}
let noteTimer;
function flashNote(msg){
  const note=document.querySelector('.input-note');
  // 元の案内は innerHTML ごと戻す（数式の表示が文字に化けないように）
  if(note.dataset.orig===undefined) note.dataset.orig=note.innerHTML;
  note.textContent=msg; note.style.color='var(--ng)';
  clearTimeout(noteTimer); noteTimer=setTimeout(clearFlash,2200);
}
// 一時的な注意を消して、元の案内に戻す（採点したとき・次の問題へ進んだときも）
function clearFlash(){
  clearTimeout(noteTimer);
  const note=document.querySelector('.input-note');
  if(note&&note.dataset.orig!==undefined){ note.innerHTML=note.dataset.orig; note.style.color=''; delete note.dataset.orig; }
}
function userEqLatex(q,userVals){
  // 区切り記号(\(...\))を含む inputs テンプレは使わず、答えと同じ \left(x,\ y\right) 形式で組む
  const v=userVals.map(s=>hasInput(s)?texOf(s):'?');
  return `\\left(${v[0]},\\ ${v[1]}\\right)`;
}
function hasInput(s){ return !!s && !GraderCore.isBlank(s); }
// 生徒の入力（MathLive の LaTeX）を MathJax で表示できる形にする。生の LaTeX を文字のまま見せない
function texOf(s){
  return escapeHtml(String(s)
    // 全角の数字・記号は半角にそろえて見せる（「１．５」が「1、5」のように崩れないように）
    .replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/　/g,' ')
    .replace(/[−ーｰ]/g,'-')
    .replace(/\\dfrac/g,'\\frac').replace(/\\mleft/g,'\\left').replace(/\\mright/g,'\\right')
    .replace(/\\placeholder(?![A-Za-z])\s*(?:\[[^\]]*\])?\s*(?:\{[^{}]*\})?/g,'\\square')
    // キーボードで打った <= >= や \le \ge・≤ ≥ は、正しい答えと同じ ≦ ≧ で見せる
    .replace(/<=|=</g,'\\leqq ').replace(/>=|=>/g,'\\geqq ')
    .replace(/\\leq?(?![A-Za-z])/g,'\\leqq').replace(/\\geq?(?![A-Za-z])/g,'\\geqq')
    .replace(/\u2264/g,'\\leqq ').replace(/\u2265/g,'\\geqq ')
    // % は MathJax ではコメントの記号なので、\% にして消えないようにする
    .replace(/(^|[^\\])%/g,'$1\\%')
    // スラッシュの分数（MathLive で「-4/2」と打ったまま）も縦の分数で見せる
    .replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g,'\\frac{$1}{$2}')
    // MathJax が知らない \degree は ^{\circ} にする
    .replace(/\{\}\^\{?\\degree\}?/g,'^{\\circ}').replace(/\^\{?\\degree\}?/g,'^{\\circ}').replace(/\\degree(?![A-Za-z])/g,'^{\\circ}'));
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// 答えが分数の問題では、約束ごとをヒント・解説に出しておく（×の画面では未約分の理由を言わない決定のため）
function ruleNote(q){
  return (q.answers||[]).some(a=>/frac|\//.test(String(a))) ? '※分数は約分して書こう。割り切れない数は分数で答えよう。' : '';
}

// r: gradeAnswer の結果（ギブアップは {status:'wrong', reason:'giveUp'}）
function finishQuestion(r,userVals,gaveUp){
  locked=true;
  closeVirtualKeyboard(fields);
  nextGuardUntil=Date.now()+NEXT_GUARD_MS;
  clearFlash();
  const q=session[idx];
  const ok=r.status==='correct';
  const tri=r.status==='negDenominator';   // △（0点）。×と同じ流れで締め切り、復習リストへ
  if(ok) score+=20;
  $('score-display').textContent=score+'点';
  // ギブアップでも、書いていた答えは見せる
  if(userVals&&!userVals.some(hasInput)) userVals=null;
  results.push({ q, userVals, ok, mark: GraderCore.mark(r) });
  const fb=$('feedback-box');
  fb.className='feedback-box '+(ok?'ok':tri?'tri':'ng');
  const msg=gaveUp?'':(r.note||GraderCore.message(r));
  if(ok){ fb.innerHTML='<div class="fb-row" style="font-weight:700;font-size:2.2vh">⭕ 正解！</div>'; }
  else{
    const head=gaveUp?'🏳️ ギブアップ':tri?'△ おしい！（0点）':'❌ 不正解';
    const rule=ruleNote(q);
    fb.innerHTML=`<div class="fb-row" style="font-weight:700;font-size:2.2vh">${head}</div>
      ${msg?`<div class="fb-row fb-msg">${escapeHtml(msg)}</div>`:''}
      <div class="fb-row"><span class="fb-label">あなたの解答：</span> ${userVals?`\\(${userEqLatex(q,userVals)}\\)`:'（なし）'}</div>
      <div class="fb-row"><span class="fb-label">正しい答え：</span> \\(${q.answerLatex}\\)${rule?`<br><small>${rule}</small>`:''}</div>`;
  }
  fb.classList.remove('hidden');
  screens.quiz.classList.add('has-feedback');
  $('submit-btn').classList.add('hidden'); $('hint-btn').classList.add('hidden');
  $('next-btn').classList.remove('hidden');
  typeset(fb);
  if(ok) try{ confetti({particleCount:60,spread:55,origin:{y:.7}}); }catch(_){}
}

/* ヒント（積み重ね式・右カラム固定） */
const HINT_PLACEHOLDER='<div class="hint-placeholder">💡 ヒントを押すと、ここに順番に出るよ</div>';
function resetHints(){
  const box=$('hint-text');
  // 右カラムは最初から表示（空でもプレースホルダーで埋める）
  box.className='hint-text';
  box.innerHTML=HINT_PLACEHOLDER;
}
function appendHint(html,stepNo,isAnswer){
  const box=$('hint-text');
  box.classList.remove('hidden');
  // 最初のヒントが出たらプレースホルダーを消す
  const ph=box.querySelector('.hint-placeholder');
  if(ph) ph.remove();
  const block=document.createElement('div');
  block.className='hint-step'+(isAnswer?' hint-step--answer':'');
  const label=isAnswer?'答え':('ステップ'+stepNo);
  block.innerHTML='<span class="hint-step-no">'+label+'</span>'
    +'<span class="hint-step-body">'+html+'</span>';
  box.appendChild(block);
  typeset(box);
  box.scrollTop=box.scrollHeight;
}
$('hint-btn').onclick=async()=>{
  if(locked||busy) return;
  const q=session[idx];
  if(hintStep>=q.hints.length-1){
    busy=true;
    let yes=false;
    try{ yes=await showConfirm({title:'答えを見る？',message:'次のヒントは答えだよ！見ると不正解（ギブアップ）になります。',okText:'見る',danger:true}); }
    finally{ busy=false; }
    if(!yes||locked) return;
    const rule=ruleNote(q);
    appendHint(q.hints[q.hints.length-1]+(rule?`<br><small>${rule}</small>`:''), hintStep+1, true);
    finishQuestion({status:'wrong',reason:'giveUp'}, fields.map(getVal), true); return;
  }
  // これから見せるステップ（1始まり）：ステップ1で直線①の点、ステップ3で直線②の点を打つ
  const stepNo = hintStep+1;
  if(stepNo===1 && hintGraphLevel<1) hintGraphLevel=1;
  if(stepNo===3 && hintGraphLevel<2) hintGraphLevel=2;
  drawGraph(q, hintGraphLevel);   // 点を打ってから
  appendHint(q.hints[hintStep], stepNo, false);  // テキストを積む
  hintStep++;
  if(hintStep>=q.hints.length-1) $('hint-btn').textContent='⚠️ 答えを見る';
};

$('next-btn').onclick=e=>{
  // 指・マウスで押したときだけ止める（Enter から呼ぶ click() は止めない）
  if(e&&e.isTrusted&&Date.now()<nextGuardUntil) return;
  idx++; if(idx>=session.length) showResult(); else loadQuestion(); };

/* ===== 結果 ===== */
function showResult(){
  $('progress-fill').style.width='100%'; show('result');
  const total=session.length, max=total*20;
  $('result-score').textContent=`${score} / ${max} 点`;
  const pass=score>=Math.ceil(max*0.8);
  const msgs=pass?['🏆 おにリピ クリア！','🔥 完ぺき！交点マスター！','⭐ すごい！この調子！']
                 :['📘 もう一回チャレンジ！','💪 おしい！復習しよう','🌱 まちがいは成長のチャンス'];
  $('result-badge').textContent=pick(msgs);
  if(pass) try{ burst(); }catch(_){}
  const d=loadData(); d.high=Math.max(d.high||0,score); d.history=d.history||[];
  d.history.push({ date:new Date().toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}), score, total:max, level });
  if(d.history.length>50) d.history=d.history.slice(-50); saveData(d);
  const wrong=results.filter(r=>!r.ok);
  $('review-wrong-btn').classList.toggle('hidden',wrong.length===0);
  $('review-list').innerHTML=results.map((r,i)=>`<div class="review-item ${r.ok?'ok':r.mark==='△'?'tri':'ng'}">
      <div class="ri-q">${r.ok?'⭕':r.mark==='△'?'△':'❌'} 第${i+1}問　${r.q.label}</div>
      <div class="ri-ans">あなた: ${r.userVals?`\\(${userEqLatex(r.q,r.userVals)}\\)`:'なし'} ／ 正解: \\(${r.q.answerLatex}\\)</div></div>`).join('');
  typeset($('review-list'));
}
function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
function burst(){ const end=Date.now()+800; (function f(){ confetti({particleCount:5,angle:60,spread:55,origin:{x:0}}); confetti({particleCount:5,angle:120,spread:55,origin:{x:1}}); if(Date.now()<end) requestAnimationFrame(f); })(); }

/* ===== ボタン ===== */
$('quit-btn').onclick=()=>{ if(busy) return; busy=true; showConfirm({title:'ホームに戻る？',message:'いまのチャレンジは記録されません。',okText:'戻る'}).then(ok=>{ busy=false; if(ok){ renderHome(); show('start'); } }); };
$('submit-btn').onclick=submit;
$('start-btn').onclick=()=>startGame(false);
$('retry-btn').onclick=()=>startGame(false);
$('home-btn').onclick=()=>{ renderHome(); show('start'); };
$('review-wrong-btn').onclick=()=>{
  const wrong=results.filter(r=>!r.ok).map((r,i)=>({ ...r.q, id:i }));
  if(!wrong.length) return;
  session=wrong; idx=0; score=0; results=[]; $('level-tag').textContent='復習'; show('quiz'); loadQuestion();
};
$('reset-btn').onclick=()=>{ showConfirm({title:'履歴を消す？',message:'学習履歴と最高スコアを消すよ。',okText:'消す',danger:true}).then(ok=>{ if(ok){ store.del(STORE_KEY); renderHome(); } }); };

/* ===== 起動 ===== */
/* ===== 確認モーダル（confirm 置換） ===== */
function showConfirm({title,message,okText='OK',cancelText='キャンセル',danger=false}){
  return new Promise(resolve=>{
    const ov=$('modal-overlay'),card=$('modal-card');
    $('modal-title').textContent=title; $('modal-message').textContent=message;
    $('modal-ok').textContent=okText; $('modal-cancel').textContent=cancelText;
    $('modal-icon').textContent=danger?'⚠️':'❓'; card.classList.toggle('is-danger',danger);
    ov.classList.remove('hidden');
    const done=v=>{ov.classList.add('hidden');cleanup();resolve(v);};
    const onOk=()=>done(true),onCancel=()=>done(false),onBg=e=>{if(e.target===ov)done(false);};
    function cleanup(){$('modal-ok').removeEventListener('click',onOk);$('modal-cancel').removeEventListener('click',onCancel);ov.removeEventListener('click',onBg);}
    $('modal-ok').addEventListener('click',onOk);$('modal-cancel').addEventListener('click',onCancel);ov.addEventListener('click',onBg);
  });
}

/* ===== クイズ画面全体の手書き（Canvas 2D + Pointer Events） ===== */
function initWriting(){
  const canvas=$('write-canvas'); if(!canvas) return;
  const ctx=canvas.getContext('2d');
  let drawing=false, last=null, pointerId=null, writing=false, hasInk=false, tool='pen';
  function applyTool(){
    ctx.globalCompositeOperation=tool==='eraser'?'destination-out':'source-over';
    ctx.lineWidth=tool==='eraser'?24:3;
    ctx.strokeStyle='#4338ca';
  }
  function resize(){
    const old=document.createElement('canvas');
    if(canvas.width&&canvas.height){ old.width=canvas.width; old.height=canvas.height; old.getContext('2d').drawImage(canvas,0,0); }
    const dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(window.innerWidth*dpr); canvas.height=Math.round(window.innerHeight*dpr);
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    if(old.width&&old.height) ctx.drawImage(old,0,0,old.width,old.height,0,0,canvas.width,canvas.height);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.lineCap='round'; ctx.lineJoin='round'; applyTool();
  }
  function pos(e){ return {x:e.clientX,y:e.clientY}; }
  function isControl(target){ return !!(target&&target.closest&&target.closest('button,math-field,input,textarea,select,a,[role="button"],label')); }
  function stop(){ drawing=false; last=null; pointerId=null; }
  function clear(){
    ctx.clearRect(0,0,canvas.width,canvas.height); hasInk=false;
    $('write-clear').disabled=true; $('write-eraser').disabled=true;
    if(tool==='eraser') setTool('pen');
  }
  function setTool(next){
    tool=next; applyTool();
    const erasing=tool==='eraser';
    $('write-eraser').classList.toggle('is-active',erasing);
    $('write-eraser').setAttribute('aria-pressed',String(erasing));
    $('write-eraser').textContent=erasing?'🧽 鉛筆に戻る':'🧽 消しゴム';
    if(writing) $('write-status').textContent=erasing?'🧽 消しゴム中：なぞった部分だけ消せます':'✍️ 書き込み中：入力欄・ボタンはそのまま押せます';
  }
  function setMode(on){
    writing=!!on;
    canvas.classList.toggle('is-visible',writing);
    $('write-toggle').classList.toggle('is-active',writing);
    $('write-toggle').setAttribute('aria-pressed',String(writing));
    $('write-toggle').textContent=writing?'✍️ 書き終わる':'✏️ 書く';
    $('write-status').classList.toggle('hidden',!writing);
    if(writing) setTool(tool);
    if(!writing) stop();
  }
  document.addEventListener('pointerdown',e=>{
    if(!writing||e.button!==0||isControl(e.target)) return;
    drawing=true; pointerId=e.pointerId; last=pos(e);
    ctx.beginPath(); ctx.arc(last.x,last.y,tool==='eraser'?12:1.5,0,Math.PI*2); ctx.fill();
    hasInk=true; $('write-clear').disabled=false; $('write-eraser').disabled=false; e.preventDefault();
  },true);
  document.addEventListener('pointermove',e=>{
    if(!drawing||e.pointerId!==pointerId) return;
    if(isControl(e.target)){ stop(); return; }
    const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p;
    hasInk=true; $('write-clear').disabled=false; $('write-eraser').disabled=false; e.preventDefault();
  },true);
  document.addEventListener('pointerup',e=>{ if(e.pointerId===pointerId) stop(); },true);
  document.addEventListener('pointercancel',e=>{ if(e.pointerId===pointerId) stop(); },true);
  $('write-toggle').addEventListener('click',()=>setMode(!writing));
  $('write-eraser').addEventListener('click',()=>{ if(hasInk){ setMode(true); setTool(tool==='eraser'?'pen':'eraser'); } });
  $('write-clear').addEventListener('click',clear);
  window.addEventListener('resize',resize);
  window.clearWriting=clear;
  window.setWritingMode=setMode;
  window.isWritingMode=()=>writing;
  resize();
}

function boot(){
  setupCanvas(); renderHome(); initWriting();
  window.addEventListener('load',()=>typeset());
}
if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',boot); else boot();

})();
