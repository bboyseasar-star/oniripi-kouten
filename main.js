// main.js ── 鬼リピ 式マスター（複数入力フィールド対応・汎用版）
'use strict';
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
let level=1, session=[], idx=0, score=0, hintStep=0, hintGraphLevel=0, locked=false, results=[];
let fields=[];
let lastFocused=null;
const QN = 5;

/* ===== DOM ===== */
const $ = id=>document.getElementById(id);
const screens = { start:$('screen-start'), quiz:$('screen-quiz'), result:$('screen-result') };
function show(name){ Object.values(screens).forEach(s=>s.classList.remove('active')); screens[name].classList.add('active'); }
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
    gctx.strokeStyle=major?'#cdd6ee':'#e9eefb'; gctx.lineWidth=1;
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

/* ===== LaTeX → 有理数 {n,d}（厳密判定用） ===== */
function gcdI(a,b){ a=Math.abs(a);b=Math.abs(b); while(b){[a,b]=[b,a%b];} return a||1; }
function reduceRat(n,d){
  if(d===0) return null;
  if(d<0){ n=-n; d=-d; }
  const g=gcdI(n,d); return { n:n/g, d:d/g };
}
// 生徒入力(LaTeX/プレーン)を有理数 {n,d} に。分数・整数・先頭マイナス・\frac{-a}{b}・-\frac{a}{b} を同一視。
function latexToRat(latex){
  if(latex==null) return null;
  let s = String(latex).replace(/\s+/g,'');
  s = s.replace(/\\left|\\right|\\,|\\!|\\;|\\cdot|\\mleft|\\mright|\\operatorname/g,'');
  s = s.replace(/[−ー–—]/g,'-').replace(/[＋]/g,'+').replace(/[／]/g,'/');
  s = s.replace(/\\dfrac/g,'\\frac').replace(/\\tfrac/g,'\\frac');
  // \frac{a}{b}（中括弧省略の1文字パターンも補正）
  s = s.replace(/\\frac([^{])([^{])/g,'\\frac{$1}{$2}');
  s = s.replace(/\\frac{([^{])}([^{])/g,'\\frac{$1}{$2}');
  s = s.replace(/\\frac([^{]){([^{]+)}/g,'\\frac{$1}{$2}');
  if(s==='') return null;
  // 先頭マイナス + \frac{p}{q}
  let m = s.match(/^(-?)\\frac\{(-?\d+)\}\{(-?\d+)\}$/);
  if(m){
    let n=parseInt(m[2],10), d=parseInt(m[3],10);
    if(m[1]==='-') n=-n;
    return reduceRat(n,d);
  }
  // a/b プレーン分数
  m = s.match(/^(-?\d+)\/(-?\d+)$/);
  if(m) return reduceRat(parseInt(m[1],10),parseInt(m[2],10));
  // 整数
  if(/^-?\d+$/.test(s)) return reduceRat(parseInt(s,10),1);
  return null;
}
// 2つの有理数が値として等しいか（既約化して分子・分母一致）
function ratEq(a,b){ return a&&b&&a.n===b.n&&a.d===b.d; }

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
    const mf=document.createElement('math-field'); mf.setAttribute('virtual-keyboard-mode','off'); mf.dataset.i=i;
    wrap.appendChild(mf); row.appendChild(wrap);
    if(inp.after){ const sp=document.createElement('span'); sp.className='ans-fix'; sp.innerHTML=inp.after; row.appendChild(sp); }
    mf.addEventListener('focus',()=>{ lastFocused=mf; });
    mf.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); if(!locked) submit(); } });
    forceHalfWidth(mf);
    fields.push(mf);
  });
  lastFocused=fields[0]||null;
  typeset(row);
}
function getVal(mf){ return mf.getValue?mf.getValue('latex'):mf.value; }

/* ===== ヘルパーキー ===== */
document.querySelector('.helper-keys').addEventListener('click',e=>{
  const b=e.target.closest('.hkey'); if(!b||locked) return;
  const f=lastFocused||fields[0]; if(!f) return;
  if(b.dataset.cmd==='frac'){ try{ f.executeCommand(['insert','\\frac{#0}{#?}']); }catch(_){ try{ f.insert('\\frac{#0}{#?}'); }catch(__){} } }
  else if(b.dataset.cmd==='minus'){ try{ f.insert('-'); }catch(_){} }
  else if(b.dataset.cmd==='clear'){ f.value=''; }
  f.focus();
});
function forceHalfWidth(f){
  if(!f) return;
  f.setAttribute('inputmode','latin');
  f.addEventListener('compositionend',ev=>{
    const data=ev.data;
    if(data){
      const c=data.replace(/[０-９]/g,s=>String.fromCharCode(s.charCodeAt(0)-0xFEE0))
        .replace(/[ａ-ｚ]/g,s=>String.fromCharCode(s.charCodeAt(0)-0xFEE0))
        .replace(/[Ａ-Ｚ]/g,s=>String.fromCharCode(s.charCodeAt(0)-0xFEE0))
        .replace(/[＋]/g,'+').replace(/[－ー−]/g,'-').replace(/[／]/g,'/');
      f.value=''; f.insert(c);
    }
  });
  f.addEventListener('focus',()=>{
    f.setAttribute('inputmode','latin');
    const sh=f.shadowRoot; if(sh){ const ta=sh.querySelector('textarea'); if(ta){ ta.setAttribute('inputmode','latin'); ta.setAttribute('autocorrect','off'); ta.setAttribute('lang','en'); } }
  });
}

/* ===== ゲーム進行 ===== */
function startGame(reuse){
  if(!reuse) session=generateSession(level,QN);
  idx=0; score=0; results=[];
  $('level-tag').textContent='Lv.'+level;
  show('quiz'); loadQuestion();
}
function loadQuestion(){
  locked=false; hintStep=0; hintGraphLevel=0;
  const q=session[idx];
  $('q-counter').textContent=`Q ${idx+1} / ${session.length}`;
  $('progress-fill').style.width=(idx/session.length*100)+'%';
  $('score-display').textContent=score+'点';
  $('question-label').innerHTML=q.label;
  drawGraph(q, 0);
  $('question-extra').innerHTML=q.extra||'';
  $('feedback-box').className='feedback-box hidden';
  resetHints();
  $('hint-btn').classList.remove('hidden'); $('hint-btn').textContent='💡 ヒント'; $('hint-btn').disabled=false;
  $('submit-btn').classList.remove('hidden'); $('submit-btn').disabled=false;
  $('next-btn').classList.add('hidden');
  buildFields(q);
  setTimeout(()=>{ try{ fields[0].focus(); }catch(_){} },60);
  typeset(screens.quiz);
}

function submit(){
  if(locked) return;
  const q=session[idx];
  const userVals=fields.map(getVal);
  if(userVals.some(v=>!v||!v.trim())){ flashNote('全部のマスを入力してね！'); return; }
  const ok = q.answersRat.every((a,i)=>{
    const v=latexToRat(userVals[i]);
    return ratEq(v,a);
  });
  finishQuestion(ok, userVals);
}
let noteTimer;
function flashNote(msg){
  const note=document.querySelector('.input-note');
  note.dataset.orig=note.dataset.orig||note.textContent;
  note.textContent=msg; note.style.color='var(--ng)';
  clearTimeout(noteTimer); noteTimer=setTimeout(()=>{ note.textContent=note.dataset.orig; note.style.color=''; },1600);
}
function userEqLatex(q,userVals){
  // 区切り記号(\(...\))を含む inputs テンプレは使わず、答えと同じ \left(x,\ y\right) 形式で組む
  const v=userVals.map(s=>cleanLatex((s&&String(s).trim())?s:'?'));
  return `\\left(${v[0]},\\ ${v[1]}\\right)`;
}
function cleanLatex(s){ return String(s).replace(/\\dfrac/g,'\\frac'); }

function finishQuestion(ok,userVals,gaveUp){
  locked=true;
  const q=session[idx];
  if(ok) score+=20;
  $('score-display').textContent=score+'点';
  results.push({ q, userVals: gaveUp?null:userVals, ok });
  const fb=$('feedback-box');
  fb.className='feedback-box '+(ok?'ok':'ng');
  if(ok){ fb.innerHTML='<div class="fb-row" style="font-weight:700;font-size:2.2vh">⭕ 正解！</div>'; }
  else{
    fb.innerHTML=`<div class="fb-row" style="font-weight:700;font-size:2.2vh">${gaveUp?'🏳️ ギブアップ':'❌ ざんねん…'}</div>
      <div class="fb-row"><span class="fb-label">あなたの解答：</span> ${userVals?`\\(${userEqLatex(q,userVals)}\\)`:'（なし）'}</div>
      <div class="fb-row"><span class="fb-label">正しい答え：</span> \\(${q.answerLatex}\\)</div>
      <div class="fb-row"><span class="fb-label">解き方：</span> ${q.solution}</div>`;
  }
  fb.classList.remove('hidden');
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
$('hint-btn').onclick=()=>{
  if(locked) return;
  const q=session[idx];
  if(hintStep>=q.hints.length-1){
    if(!confirm('⚠️ 次のヒントは答えだよ！見ると不正解（ギブアップ）になるけど見る？')) return;
    appendHint(q.hints[q.hints.length-1], hintStep+1, true);
    const cur=fields.map(getVal);
    finishQuestion(false, cur.some(v=>v&&String(v).trim())?cur:null, true); return;
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

$('next-btn').onclick=()=>{ idx++; if(idx>=session.length) showResult(); else loadQuestion(); };

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
  $('review-list').innerHTML=results.map((r,i)=>`<div class="review-item ${r.ok?'ok':'ng'}">
      <div class="ri-q">${r.ok?'⭕':'❌'} 第${i+1}問　${r.q.label}</div>
      <div class="ri-ans">あなた: \\(${r.userVals?userEqLatex(r.q,r.userVals):'なし'}\\) ／ 正解: \\(${r.q.answerLatex}\\)</div></div>`).join('');
  typeset($('review-list'));
}
function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
function burst(){ const end=Date.now()+800; (function f(){ confetti({particleCount:5,angle:60,spread:55,origin:{x:0}}); confetti({particleCount:5,angle:120,spread:55,origin:{x:1}}); if(Date.now()<end) requestAnimationFrame(f); })(); }

/* ===== ボタン ===== */
$('quit-btn').onclick=()=>{ if(confirm('ホームに戻る？（いまのチャレンジは記録されません）')){ renderHome(); show('start'); } };
$('submit-btn').onclick=submit;
$('start-btn').onclick=()=>startGame(false);
$('retry-btn').onclick=()=>startGame(false);
$('home-btn').onclick=()=>{ renderHome(); show('start'); };
$('review-wrong-btn').onclick=()=>{
  const wrong=results.filter(r=>!r.ok).map((r,i)=>({ ...r.q, id:i }));
  if(!wrong.length) return;
  session=wrong; idx=0; score=0; results=[]; $('level-tag').textContent='復習'; show('quiz'); loadQuestion();
};
$('reset-btn').onclick=()=>{ if(confirm('学習履歴と最高スコアを消すよ。いい？')){ store.del(STORE_KEY); renderHome(); } };

/* ===== 起動 ===== */
function boot(){ setupCanvas(); renderHome(); }
if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',boot); else boot();

})();
