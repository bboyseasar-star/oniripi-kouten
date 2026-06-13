// questions.js ── 鬼リピ 交点マスター（グラフから交点を求める）
// 座標平面に2直線だけを描き、式は出さない。生徒はグラフから各直線の式を読み、
// 連立して交点(x,y)を求める。交点は分数になる（目視即答できない）。
// 交点座標は厳密な有理数演算（分子・分母の整数ペア）で計算・約分する。

/* ===== 有理数ユーティリティ ===== */
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }
const RNG = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];

// 分数を既約化（符号は分子に集約：分母は常に正）
function reduce(n, d) {
  if (d === 0) return null;
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const isInt = r => r.d === 1;

/* ===== LaTeX 生成 ===== */
// 整数 or 既約分数を LaTeX に。負は分数全体の前に -\frac{p}{q}（分子分母に負号を残さない）
function ratLatex(r) {
  if (isInt(r)) return String(r.n);
  const sign = r.n < 0 ? '-' : '';
  return `${sign}\\frac{${Math.abs(r.n)}}{${r.d}}`;
}
// 傾き a（分数 {n,d}）を直線式の係数項に。例 1→'x', -1→'-x', 2→'2x', 1/2→'\frac{1}{2}x'
function slopeTerm(a) {
  if (a.n === 0) return '';
  if (isInt(a)) {
    if (a.n === 1) return 'x';
    if (a.n === -1) return '-x';
    return `${a.n}x`;
  }
  const sign = a.n < 0 ? '-' : '';
  return `${sign}\\frac{${Math.abs(a.n)}}{${a.d}}x`;
}
// y = a x + b の LaTeX（a は分数{n,d}、b は整数）
function lineLatex(a, b) {
  let s = slopeTerm(a);
  if (b > 0) s += (s ? '+' : '') + b;
  else if (b < 0) s += '' + b;
  else if (!s) s = '0';
  return `y=${s}`;
}

/* ===== 直線データ（傾き a={n,d}, 切片 b 整数） ===== */
// 直線が描画範囲 [-R,R] 内で通る格子点を2つ以上持つか判定（式が読み取れる条件）
function latticePoints(a, b, R) {
  // a.d で割り切れる x のとき y が整数。x = a.d * k。(0,b) は a.n*0/a.d=0 で必ず格子点
  const pts = [];
  for (let x = -R; x <= R; x++) {
    // y = (a.n*x)/a.d + b が整数か
    if ((a.n * x) % a.d !== 0) continue;
    const y = (a.n * x) / a.d + b;
    if (y >= -R && y <= R) pts.push({ x, y });
  }
  return pts;
}

// ヒント用：切片(0,b)と「右どなりの一番近い格子点」を返す。
// 直線 y=(a.n/a.d)x+b の格子点は x が a.d の倍数のところ。
// 右どなりは x=a.d → (a.d, b+a.n)。範囲(±(R-1))外なら、範囲内にある0に一番近い格子点を採用し、
// 「右に/左に・上に/下に」の向き表現も実際に合わせる（堅牢に）。
function hintDots(a, b, R) {
  const lim = R - 1;                 // グリッドの目盛りが見える範囲
  const q = a.d;                     // x はこの倍数で格子点
  const p = a.n;                     // x が +q 増えると y は +p
  const b0 = [0, b];
  // 候補：x = k*q（k=±1,±2,…）のうち、(x,y) が範囲内で原点に一番近いもの。右(k>0)を優先。
  let best = null;                   // {x,y,k}
  for (let k = 1; k <= 2 * R; k++) {
    for (const s of [1, -1]) {       // まず右(+)、なければ左(-)
      const x = s * k * q;
      const y = b + s * k * p;
      if (Math.abs(x) > lim || Math.abs(y) > lim) continue;
      // 右どなり(k=1,s=1)を最優先。それ以外は |x| が最小のものを選ぶ。
      if (!best) { best = { x, y, dirRight: s > 0 }; }
      break;
    }
    if (best) break;
  }
  // 万一見つからなければ切片だけ返す（描画は1点のみ）
  if (!best) return { p0: b0, p1: null, readText: '' };
  const dx = best.x - 0, dy = best.y - b;
  const hStr = (dx >= 0 ? '右に' : '左に') + Math.abs(dx);
  const vStr = (dy >= 0 ? '上に' : '下に') + Math.abs(dy);
  return { p0: b0, p1: [best.x, best.y], readText: `${hStr}・${vStr}、で傾きが読めるね` };
}

// 2直線の交点を有理数で求める：交点 x=(b2-b1)/(a1-a2)
function intersect(a1, b1, a2, b2) {
  // a1,a2 は {n,d}。a1-a2 = (a1.n*a2.d - a2.n*a1.d)/(a1.d*a2.d)
  const slopeDiffN = a1.n * a2.d - a2.n * a1.d;
  const slopeDiffD = a1.d * a2.d;
  if (slopeDiffN === 0) return null; // 平行
  // x = (b2-b1) / (slopeDiff) = (b2-b1) * slopeDiffD / slopeDiffN
  const X = reduce((b2 - b1) * slopeDiffD, slopeDiffN);
  // y = a1*x + b1 = (a1.n * X.n)/(a1.d * X.d) + b1
  const Y = reduce(a1.n * X.n + b1 * a1.d * X.d, a1.d * X.d);
  return { X, Y };
}

/* ===== 6ステップ ヒント生成（点を打つ→自分で式を考える→式表示、を2直線ぶん） ===== */
// d1/d2 は hintDots() の戻り値（切片点・右どなり格子点・読み取りテキスト）
function buildHints(a1, b1, a2, b2, X, Y, d1, d2) {
  const L1 = lineLatex(a1, b1);
  const L2 = lineLatex(a2, b2);
  // 連立： a1 x + b1 = a2 x + b2  →  (a1-a2)x = b2-b1  →  x = ...
  const dN = a1.n * a2.d - a2.n * a1.d; // 傾き差の分子（共通分母 a1.d*a2.d）
  const dD = a1.d * a2.d;
  const diffB = b2 - b1;
  const slopeDiffR = reduce(dN, dD);
  const coefStr = isInt(slopeDiffR)
    ? (slopeDiffR.n === 1 ? '' : slopeDiffR.n === -1 ? '-' : String(slopeDiffR.n))
    : ratLatex(slopeDiffR);
  const solveX =
    `\\(${L1.slice(2)}=${L2.slice(2)}\\) を解くと、` +
    `\\(${coefStr}x=${diffB}\\Rightarrow x=${ratLatex(X)}\\)`;

  return [
    // 1: 直線①に点を打つ（式は出さない）
    `直線①の<b>切片の点</b>と、その<b>右の一番近い格子点</b>に注目（グラフに●を打ったよ）。${d1.readText}`,
    // 2: 直線①の式
    `直線①の式は \\(${L1}\\)`,
    // 3: 直線②にも点を打つ
    `直線②も同じように読もう（グラフに●を打ったよ）。${d2.readText}`,
    // 4: 直線②の式
    `直線②の式は \\(${L2}\\)`,
    // 5: 連立して x
    `2式を連立して \\(x\\) を解こう。${solveX}`,
    // 6: （答え）代入して y、交点
    `\\(x=${ratLatex(X)}\\) を代入して \\(y=${ratLatex(Y)}\\)。交点 \\(\\left(${ratLatex(X)},\\ ${ratLatex(Y)}\\right)\\)`
  ];
}

// 共通：問題オブジェクトを組み立てる
function buildQuestion(level, a1, b1, a2, b2, R) {
  const sol = intersect(a1, b1, a2, b2);
  if (!sol) return null;
  const { X, Y } = sol;
  // 交点が描画範囲内か
  if (Math.abs(X.n / X.d) > R || Math.abs(Y.n / Y.d) > R) return null;
  // 各直線が範囲内に格子点を2つ以上持つか（式が読めること）
  if (latticePoints(a1, b1, R).length < 2) return null;
  if (latticePoints(a2, b2, R).length < 2) return null;

  // ヒント用：各直線の「切片点」と「右どなりの格子点」
  const d1 = hintDots(a1, b1, R);
  const d2 = hintDots(a2, b2, R);
  // 右どなり格子点が範囲内に取れない問題は採用しない（点が打てないと体験が崩れる）
  if (!d1.p1 || !d2.p1) return null;

  return {
    level,
    label: 'グラフの2直線の交点の座標を求めなさい',
    // グラフ描画用データ（main.js が canvas に描く）
    graph: { a1, b1, a2, b2, range: R },
    display: '', // 式は出さない（グラフに差し替え）
    extra: '',
    inputs: INPUTS,
    // 答えは有理数（分子・分母ペア）
    answersRat: [X, Y],
    answerLatex: `\\left(${ratLatex(X)},\\ ${ratLatex(Y)}\\right)`,
    // ヒントでグラフに打つ点（step1→直線①, step3→直線②）
    hintGraph: {
      line1: [d1.p0, d1.p1],   // [[0,b1],[gx,gy]]
      line2: [d2.p0, d2.p1]
    },
    hints: buildHints(a1, b1, a2, b2, X, Y, d1, d2),
    solution:
      `直線①②の式を読み、連立して \\(x=${ratLatex(X)}\\)、` +
      `代入して \\(y=${ratLatex(Y)}\\)。交点 \\(\\left(${ratLatex(X)},\\ ${ratLatex(Y)}\\right)\\)`
  };
}

// 交点座標の表示テンプレート： ( [x] , [y] )
const INPUTS = [
  { before: '\\((\\)', after: '\\(,\\)' },
  { before: '', after: '\\()\\)' }
];

const INT = n => ({ n, d: 1 }); // 整数傾き
// 分数傾き候補（分母2か3、既約、|a|≤2）
const FRAC_SLOPES = [
  { n: 1, d: 2 }, { n: -1, d: 2 }, { n: 3, d: 2 }, { n: -3, d: 2 },
  { n: 1, d: 3 }, { n: -1, d: 3 }, { n: 2, d: 3 }, { n: -2, d: 3 },
  { n: 4, d: 3 }, { n: -4, d: 3 }
];

/* ===== Lv1：両方とも整数傾き（交点は分数のみ採用） ===== */
function genLevel1() {
  const R = 6;
  for (let tries = 0; tries < 200; tries++) {
    let a1 = INT(RNG(-2, 2)), a2 = INT(RNG(-2, 2));
    if (a1.n === a2.n) continue;
    if (a1.n === 0 && a2.n === 0) continue;
    const b1 = RNG(-5, 5), b2 = RNG(-5, 5);
    if (b1 === b2) continue;
    const sol = intersect(a1, b1, a2, b2);
    if (!sol) continue;
    if (isInt(sol.X) && isInt(sol.Y)) continue; // 整数交点は捨てる
    const q = buildQuestion(1, a1, b1, a2, b2, R);
    if (q) return q;
  }
  return null;
}

/* ===== Lv2：一方が分数傾き・他方が整数傾き（交点は分数のみ採用） ===== */
function genLevel2() {
  const R = 6;
  for (let tries = 0; tries < 300; tries++) {
    const fracFirst = Math.random() < 0.5;
    let a1, a2;
    if (fracFirst) { a1 = pick(FRAC_SLOPES); a2 = INT(RNG(-2, 2)); }
    else { a1 = INT(RNG(-2, 2)); a2 = pick(FRAC_SLOPES); }
    // 分母3の傾きは q≤3 で格子点が範囲内である必要 → R=6 なら (3, b+n) が範囲内ならOK
    const b1 = RNG(-4, 4), b2 = RNG(-4, 4);
    if (a1.n === a2.n && a1.d === a2.d) continue;
    const sol = intersect(a1, b1, a2, b2);
    if (!sol) continue;
    if (isInt(sol.X) && isInt(sol.Y)) continue; // 整数交点は捨てる
    const q = buildQuestion(2, a1, b1, a2, b2, R);
    if (q) return q;
  }
  return null;
}

/* ===== Lv3：応用（範囲±8、少なくとも一方が分数傾き、約20%だけ整数交点も混ぜる） ===== */
function genLevel3() {
  const R = 8;
  const allowIntX = Math.random() < 0.2; // 約20%は整数交点も許容
  for (let tries = 0; tries < 400; tries++) {
    const bothFrac = Math.random() < 0.5;
    let a1, a2;
    if (bothFrac) { a1 = pick(FRAC_SLOPES); a2 = pick(FRAC_SLOPES); }
    else if (Math.random() < 0.5) { a1 = pick(FRAC_SLOPES); a2 = INT(RNG(-2, 2)); }
    else { a1 = INT(RNG(-2, 2)); a2 = pick(FRAC_SLOPES); }
    if (a1.n === a2.n && a1.d === a2.d) continue;
    const b1 = RNG(-5, 5), b2 = RNG(-5, 5);
    const sol = intersect(a1, b1, a2, b2);
    if (!sol) continue;
    const intX = isInt(sol.X) && isInt(sol.Y);
    if (intX && !allowIntX) continue;
    const q = buildQuestion(3, a1, b1, a2, b2, R);
    if (q) return q;
  }
  // フォールバック：整数交点許容で再挑戦
  for (let tries = 0; tries < 200; tries++) {
    let a1 = pick(FRAC_SLOPES), a2 = INT(RNG(-2, 2));
    const b1 = RNG(-5, 5), b2 = RNG(-5, 5);
    const sol = intersect(a1, b1, a2, b2);
    if (!sol) continue;
    const q = buildQuestion(3, a1, b1, a2, b2, R);
    if (q) return q;
  }
  return null;
}

function generateSession(level, count = 5) {
  const gen = level === 1 ? genLevel1 : level === 2 ? genLevel2 : genLevel3;
  const out = [], seen = new Set();
  let g = 0;
  while (out.length < count && g < 600) {
    g++;
    const q = gen();
    if (!q) continue;
    const gr = q.graph;
    const key = `${gr.a1.n}/${gr.a1.d},${gr.b1}|${gr.a2.n}/${gr.a2.d},${gr.b2}`;
    if (seen.has(key)) continue;
    seen.add(key);
    q.id = out.length;
    out.push(q);
  }
  return out;
}

// Node環境（検証用）でも使えるようにエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateSession, reduce, intersect, ratLatex, latticePoints, gcd, hintDots, lineLatex };
}
