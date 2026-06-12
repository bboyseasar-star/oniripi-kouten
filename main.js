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
let level=1, session=[], idx=0, score=0, hintStep=0, locked=false, results=[];
let fields=[];
let lastFocused=null;
const QN = 5;

/* ===== DOM ===== */
const $ = id=>document.getElementById(id);
const screens = { start:$('screen-start'), quiz:$('screen-quiz'), result:$('screen-result') };
function show(name){ Object.values(screens).forEach(s=>s.classList.remove('active')); screens[name].classList.add('active'); }
function typeset(el){ if(window.MathJax&&MathJax.typesetPromise) MathJax.typesetPromise(el?[el]:undefined).catch(()=>{}); }

/* ===== LaTeX → 数値 ===== */
function latexToNumber(latex){
  if(latex==null) return NaN;
  let s = String(latex).replace(/\s+/g,'');
  s = s.replace(/\\left|\\right|\\,|\\!|\\;|\\cdot|\\mleft|\\mright/g,'');
  s = s.replace(/[−ー–—]/g,'-').replace(/[＋]/g,'+');
  let m = s.match(/^(-?)\\d?frac\{(-?\d+)\}\{(-?\d+)\}$/);
  if(m){ const sign=m[1]==='-'?-1:1; return sign*(parseFloat(m[2])/parseFloat(m[3])); }
  m = s.match(/^(-?\d+)\/(-?\d+)$/);
  if(m){ return parseFloat(m[1])/parseFloat(m[2]); }
  if(/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return NaN;
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
  locked=false; hintStep=0;
  const q=session[idx];
  $('q-counter').textContent=`Q ${idx+1} / ${session.length}`;
  $('progress-fill').style.width=(idx/session.length*100)+'%';
  $('score-display').textContent=score+'点';
  $('question-label').innerHTML=q.label;
  $('question-display').innerHTML=q.display||'';
  $('question-extra').innerHTML=q.extra||'';
  $('feedback-box').className='feedback-box hidden';
  $('hint-text').className='hint-text hidden';
  $('hint-btn').classList.remove('hidden'); $('hint-btn').textContent='💡 ヒント';
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
  const ok = q.answers.every((a,i)=>{
    const v=latexToNumber(userVals[i]);
    return !isNaN(v) && Math.abs(v-a)<1e-9;
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
  return q.inputs.map((inp,i)=>`${inp.before||''} ${cleanLatex(userVals[i]||'?')} ${inp.after||''}`).join(' ');
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
      <div class="fb-row"><span class="fb-label">あなたの解答：</span> \\(${userVals?userEqLatex(q,userVals):'（なし）'}\\)</div>
      <div class="fb-row"><span class="fb-label">正しい答え：</span> \\(${q.answerLatex}\\)</div>
      <div class="fb-row"><span class="fb-label">解き方：</span> ${q.solution}</div>`;
  }
  fb.classList.remove('hidden');
  $('submit-btn').classList.add('hidden'); $('hint-btn').classList.add('hidden');
  $('next-btn').classList.remove('hidden');
  typeset(fb);
  if(ok) try{ confetti({particleCount:60,spread:55,origin:{y:.7}}); }catch(_){}
}

/* ヒント */
$('hint-btn').onclick=()=>{
  if(locked) return;
  const q=session[idx];
  if(hintStep>=q.hints.length-1){
    if(!confirm('⚠️ 次のヒントは答えだよ！見ると不正解（ギブアップ）になるけど見る？')) return;
    $('hint-text').innerHTML=q.hints[q.hints.length-1]; $('hint-text').classList.remove('hidden'); typeset($('hint-text'));
    finishQuestion(false, fields.map(getVal), true); return;
  }
  $('hint-text').innerHTML=q.hints[hintStep]; $('hint-text').classList.remove('hidden'); typeset($('hint-text'));
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
function boot(){ renderHome(); }
if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',boot); else boot();

})();
