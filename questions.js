// questions.js ── 鬼リピ 交点マスター
// 2直線の交点（連立方程式の解）を求める。答えは x, y（2マス）

function gcd(a,b){ a=Math.abs(a);b=Math.abs(b); while(b){[a,b]=[b,a%b];} return a||1; }
const RNG=(lo,hi)=>lo+Math.floor(Math.random()*(hi-lo+1));
const pick=a=>a[Math.floor(Math.random()*a.length)];
function coefTerm(c,v){ if(c===0) return ''; if(c===1) return v; if(c===-1) return '-'+v; return c+v; }
function joinTerms(terms){ const t=terms.filter(s=>s!==''); if(!t.length) return '0'; let s=t[0]; for(let i=1;i<t.length;i++) s+=t[i].startsWith('-')?t[i]:'+'+t[i]; return s; }
function yEq(a,b){ // y=ax+b 整数
  let s=a===0?'':a===1?'x':a===-1?'-x':a+'x';
  let bs=b>0?(s?'+':'')+b:b<0?''+b:(s?'':'0');
  return `y=${s}${bs}`;
}
function lineStd(A,B,C){ return `${joinTerms([coefTerm(A,'x'),coefTerm(B,'y')])}=${C}`; }

// 交点座標を表示する入力テンプレート： ( [x] , [y] )
const INPUTS=[ {before:'\\((\\)', after:'\\(,\\)'}, {before:'', after:'\\()\\)'} ];

// 交点 (px,py) を整数で、傾き a1≠a2 の2直線を作る
function makeLines(){
  const px=RNG(-3,3), py=RNG(-3,4);
  let a1,a2;
  do{ a1=pick([-2,-1,1,2,3]); a2=pick([-2,-1,1,2,3]); }while(a1===a2);
  const b1=py-a1*px, b2=py-a2*px;
  return {px,py,a1,b1,a2,b2};
}

/* ===== Lv1：両方 y= の形（代入で解く） ===== */
function genLevel1(){
  const {px,py,a1,b1,a2,b2}=makeLines();
  return {
    level:1,
    label:'2直線の交点の座標を求めなさい',
    display:`\\(\\begin{cases}${yEq(a1,b1)}\\\\ ${yEq(a2,b2)}\\end{cases}\\)`,
    extra:'', inputs:INPUTS, answers:[px,py], answerLatex:`(${px},\\ ${py})`,
    hints:[
      `2つの式の \\(y\\) が等しいから、\\(${yEq(a1,b1).slice(2)}=${yEq(a2,b2).slice(2)}\\) とおけるよ。`,
      `これを解くと \\(x=${px}\\)。どちらかの式に代入して \\(y\\) を求めよう。`,
      `交点は \\((${px},\\ ${py})\\)`
    ],
    solution:`\\(${yEq(a1,b1).slice(2)}=${yEq(a2,b2).slice(2)}\\) を解いて \\(x=${px}\\)、代入して \\(y=${py}\\)。交点 \\((${px},\\ ${py})\\)`
  };
}

/* ===== Lv2：片方が ax+by=c ===== */
function genLevel2(){
  const {px,py,a1,b1,a2}=makeLines();
  // line1: y=a1 x+b1、line2: 標準形 A x + B y = C（傾き a2 の直線を作る）
  const B=pick([1,2,-1]); const A=-a2*B; const C=A*px+B*py;
  return {
    level:2,
    label:'2直線の交点の座標を求めなさい',
    display:`\\(\\begin{cases}${yEq(a1,b1)}\\\\ ${lineStd(A,B,C)}\\end{cases}\\)`,
    extra:'', inputs:INPUTS, answers:[px,py], answerLatex:`(${px},\\ ${py})`,
    hints:[
      `上の式 \\(${yEq(a1,b1)}\\) を下の式に代入しよう。`,
      `\\(y\\) を消すと \\(x\\) の方程式になる。解くと \\(x=${px}\\)。`,
      `交点は \\((${px},\\ ${py})\\)`
    ],
    solution:`\\(${yEq(a1,b1)}\\) を代入して \\(x=${px}\\)、\\(y=${py}\\)。交点 \\((${px},\\ ${py})\\)`
  };
}

/* ===== Lv3：両方 ax+by=c（連立を解く） ===== */
function genLevel3(){
  const {px,py,a1,a2}=makeLines();
  const B1=pick([1,2,-2]); const A1=-a1*B1; const C1=A1*px+B1*py;
  const B2=pick([1,3,2]);  const A2=-a2*B2; const C2=A2*px+B2*py;
  return {
    level:3,
    label:'連立方程式を解いて交点を求めなさい',
    display:`\\(\\begin{cases}${lineStd(A1,B1,C1)}\\\\ ${lineStd(A2,B2,C2)}\\end{cases}\\)`,
    extra:'', inputs:INPUTS, answers:[px,py], answerLatex:`(${px},\\ ${py})`,
    hints:[
      `加減法か代入法で \\(x\\) か \\(y\\) を消そう。`,
      `係数をそろえて1文字を消すと解ける。\\(x=${px}\\)。`,
      `交点は \\((${px},\\ ${py})\\)`
    ],
    solution:`連立方程式を解いて \\(x=${px},\\ y=${py}\\)。交点 \\((${px},\\ ${py})\\)`
  };
}

function generateSession(level,count=5){
  const gen=level===1?genLevel1:level===2?genLevel2:genLevel3;
  const out=[], seen=new Set(); let g=0;
  while(out.length<count && g<300){
    g++; const q=gen();
    const key=q.display+'|'+q.answerLatex;
    if(seen.has(key)) continue; seen.add(key); q.id=out.length; out.push(q);
  }
  return out;
}
