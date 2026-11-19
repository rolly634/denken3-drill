'use strict';

/* =========================================================
   計算練習モード（AI なしで動く）
   - 数字ガチャ：テンプレートの数値を毎回ランダムに変え、答えもアプリが計算する
   - 途中式ステップ：計算を小分けにして 1 段ずつ入力・判定（ヒント 3 段階）
   - 電験キーパッド：√・π・√3・k/m/μ・Ans・計算履歴つき。入力欄がそのまま電卓
   app.js のあとに読み込む（app.js のヘルパーとルーターを使う）。
   ========================================================= */

const CALC_FORMAT = 'denken3-drill/calc-v1';
const CALC_TOL = 0.01; // 相対誤差 1% 以内を正解とする
const CALC_HINT_MAX = 3;

I.calc = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" stroke-width="2.2"/></svg>';
I.dice = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01" stroke-width="2.6"/></svg>';

/* ---------------- データ ---------------- */
function calcData() {
  if (!store.d.calc || typeof store.d.calc !== 'object') store.d.calc = {};
  const c = store.d.calc;
  if (!c.templates || typeof c.templates !== 'object') c.templates = {};
  if (!c.stats || typeof c.stats !== 'object') c.stats = {};
  if (!Array.isArray(c.tape)) c.tape = [];
  if (c.live === undefined) c.live = null;
  return c;
}
const calcList = () => Object.values(calcData().templates).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.id).localeCompare(String(b.id)));

/* ---------------- 数式の計算 ----------------
   eval は使わず、小さな構文解析で計算する。
   使えるもの：+ - * / ^ ( )、× ÷ − · √ π ² ³、暗黙のかけ算（2π、√3(…)）、
   比較 < <= > >= == != と && ||（テンプレートの条件用）、
   関数 sqrt abs sin cos tan asin acos atan（角度は「度」）log ln exp round min max、
   数値の後ろの k M m μ u（電卓入力のときだけ）。 */
const CALC_FN = {
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10,
  sin: (d) => Math.sin(d * Math.PI / 180), cos: (d) => Math.cos(d * Math.PI / 180), tan: (d) => Math.tan(d * Math.PI / 180),
  asin: (x) => Math.asin(x) * 180 / Math.PI, acos: (x) => Math.acos(x) * 180 / Math.PI, atan: (x) => Math.atan(x) * 180 / Math.PI,
  round: (x, n = 0) => { const k = 10 ** n; return Math.round(x * k) / k; },
  min: Math.min, max: Math.max,
};
const CALC_SI = { k: 1e3, M: 1e6, m: 1e-3, 'μ': 1e-6, u: 1e-6 };

function calcNormalize(src) {
  return String(src)
    .replace(/[０-９．（）＋－＊／]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-')
    .replace(/π/g, 'pi').replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/⁻/g, '-').replace(/[⁰¹⁴⁵⁶⁷⁸⁹]/g, (c) => '0145678 9'.charAt('⁰¹⁴⁵⁶⁷⁸⁹'.indexOf(c)).trim());
}
function calcTokens(src, si) {
  const s = calcNormalize(src);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      let v = Number(num[0]); i += num[0].length;
      if (si && CALC_SI[s[i]] !== undefined && !/[A-Za-z]/.test(s[i + 1] || '')) { v *= CALC_SI[s[i]]; i++; }
      out.push({ t: 'n', v }); continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op2 = s.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||', '**'].includes(op2)) { out.push({ t: 'op', v: op2 === '**' ? '^' : op2 }); i += 2; continue; }
    if ('+-*/^(),<>√%'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`読めない文字「${c}」`);
  }
  return out;
}
function calcEval(src, scope = {}, opt = {}) {
  const tk = calcTokens(src, opt.si);
  let p = 0;
  const peek = () => tk[p];
  const isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;
  const eat = (v) => { if (!isOp(v)) throw new Error(`「${v}」がありません`); p++; };
  const startsPrimary = () => { const t = peek(); return t && (t.t === 'n' || t.t === 'id' || (t.t === 'op' && (t.v === '(' || t.v === '√'))); };
  function primary() {
    const t = peek();
    if (!t) throw new Error('式が途中で終わっています');
    if (t.t === 'n') { p++; return t.v; }
    if (t.t === 'op' && t.v === '(') { p++; const v = or(); eat(')'); return v; }
    if (t.t === 'op' && t.v === '√') { p++; return Math.sqrt(power()); }
    if (t.t === 'id') {
      p++;
      if (isOp('(') && CALC_FN[t.v]) {
        p++;
        const args = [];
        if (!isOp(')')) { args.push(or()); while (isOp(',')) { p++; args.push(or()); } }
        eat(')');
        return CALC_FN[t.v](...args);
      }
      if (t.v === 'pi') return Math.PI;
      if (Object.prototype.hasOwnProperty.call(scope, t.v)) return Number(scope[t.v]);
      throw new Error(`「${t.v}」は使えません`);
    }
    throw new Error(`「${t.v}」の位置がおかしいです`);
  }
  function postfix() { let v = primary(); while (isOp('%')) { p++; v /= 100; } return v; }
  function power() { const b = postfix(); if (isOp('^')) { p++; return b ** unary(); } return b; }
  function unary() { if (isOp('-')) { p++; return -unary(); } if (isOp('+')) { p++; return unary(); } return power(); }
  function term() {
    let v = unary();
    for (;;) {
      if (isOp('*')) { p++; v *= unary(); } else if (isOp('/')) { p++; v /= unary(); } else if (startsPrimary()) v *= unary(); else return v;
    }
  }
  function sum() { let v = term(); for (;;) { if (isOp('+')) { p++; v += term(); } else if (isOp('-')) { p++; v -= term(); } else return v; } }
  function cmp() {
    let v = sum();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !['<', '<=', '>', '>=', '==', '!='].includes(t.v)) return v;
      p++; const r = sum();
      v = { '<': v < r, '<=': v <= r, '>': v > r, '>=': v >= r, '==': Math.abs(v - r) < 1e-9, '!=': Math.abs(v - r) >= 1e-9 }[t.v] ? 1 : 0;
    }
  }
  function and() { let v = cmp(); while (isOp('&&')) { p++; const r = cmp(); v = v && r ? 1 : 0; } return v; }
  function or() { let v = and(); while (isOp('||')) { p++; const r = and(); v = v || r ? 1 : 0; } return v; }
  if (!tk.length) throw new Error('式が空です');
  const v = or();
  if (p < tk.length) throw new Error(`「${tk[p].v}」の位置がおかしいです`);
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error('計算できませんでした');
  return v;
}

/* 表示用の数値（3 桁の有効数字。整数ならそのまま） */
function calcFmt(x, sig = 3) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '?';
  if (Math.abs(x - Math.round(x)) < 1e-9 * Math.max(1, Math.abs(x)) && Math.abs(x) < 1e7) return String(Math.round(x));
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) {
    const e = Math.floor(Math.log10(a));
    const m = Number((x / 10 ** e).toPrecision(sig));
    return `${m}×10^${e}`;
  }
  return String(Number(x.toPrecision(sig)));
}

/* ---------------- テンプレート ---------------- */
function calcPick(spec) {
  if (Array.isArray(spec)) return spec[Math.floor(Math.random() * spec.length)];
  if (spec && Array.isArray(spec.choices)) return spec.choices[Math.floor(Math.random() * spec.choices.length)];
  if (spec && Number.isFinite(spec.min) && Number.isFinite(spec.max)) {
    const step = spec.step > 0 ? spec.step : 1;
    const n = Math.floor((spec.max - spec.min) / step + 1e-9);
    return Number((spec.min + step * Math.floor(Math.random() * (n + 1))).toPrecision(12));
  }
  return Number(spec);
}
/* 数値を決めて、途中の値をすべて計算する */
function calcInstance(tpl, fixed) {
  for (let tries = 0; tries < 300; tries++) {
    const scope = {};
    for (const [k, spec] of Object.entries(tpl.vars || {})) scope[k] = fixed && fixed[k] !== undefined ? fixed[k] : calcPick(spec);
    try {
      for (const [k, ex] of Object.entries(tpl.let || {})) scope[k] = calcEval(ex, scope);
      const okWhere = (tpl.where ? [].concat(tpl.where) : []).every((w) => calcEval(w, scope));
      if (!okWhere) { if (fixed) break; continue; }
      for (const st of tpl.steps) {
        if (st.choices) continue;
        const v = calcEval(st.expr, scope);
        if (!Number.isFinite(v)) throw new Error('not finite');
        if (st.name) scope[st.name] = v;
      }
      const vars = {};
      for (const k of Object.keys(tpl.vars || {})) vars[k] = scope[k];
      return { vars, scope };
    } catch (e) { if (fixed) throw e; }
  }
  throw new Error(`「${tpl.title || tpl.id}」の数値を決められませんでした（条件を見直してください）`);
}
/* {{名前}} を値に、{{=式}} を計算結果に置きかえる */
function calcFill(str, scope) {
  return String(str || '').replace(/\{\{\s*(=)?\s*([^}]+?)\s*\}\}/g, (m, isExpr, body) => {
    try {
      if (isExpr) return calcFmt(calcEval(body, scope));
      if (Object.prototype.hasOwnProperty.call(scope, body)) return calcFmt(scope[body], 4);
    } catch (e) { /* noop */ }
    return m;
  });
}
const calcStepValue = (st, scope) => (st.choices ? st.answer : calcEval(st.expr, scope));

/* ---------------- 取り込み ---------------- */
function calcValidate(t, i) {
  const at = `テンプレート${i + 1}${t && t.id ? `（${t.id}）` : ''}`;
  if (!t || typeof t !== 'object') return `${at}：形式が正しくありません`;
  if (!t.id || !t.title || !t.text) return `${at}：id・title・text は必須です`;
  if (!Array.isArray(t.steps) || !t.steps.length) return `${at}：steps がありません`;
  for (const [j, st] of t.steps.entries()) {
    if (!st.label) return `${at}：ステップ${j + 1} に label がありません`;
    if (st.choices) {
      if (!Array.isArray(st.choices) || st.choices.length < 2 || !Number.isInteger(st.answer) || !st.choices[st.answer]) return `${at}：ステップ${j + 1} の choices / answer が正しくありません`;
    } else if (!st.expr) return `${at}：ステップ${j + 1} に expr がありません`;
  }
  try { calcInstance(t); } catch (e) { return `${at}：${e.message}`; }
  return null;
}
function calcImport(list) {
  const C = calcData();
  const errors = []; let added = 0; let updated = 0;
  list.forEach((t, i) => {
    const err = calcValidate(t, i);
    if (err) { errors.push(err); return; }
    const clean = JSON.parse(JSON.stringify(t));
    clean.subject = String(clean.subject || '理論');
    if (C.templates[t.id]) updated++; else added++;
    C.templates[t.id] = clean;
  });
  if (!store.save()) return;
  const msg = `計算問題を取り込みました：新規 ${added}問 ／ 更新 ${updated}問${errors.length ? ` ／ エラー ${errors.length}件` : ''}`;
  if (errors.length) alert(`${msg}\n\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? '\n…' : ''}`);
  else toast(msg);
  viewSettings();
}

/* ---------------- セッション ---------------- */
function calcStart(id, keepVars) {
  const C = calcData();
  const tpl = C.templates[id];
  if (!tpl) { toast('問題が見つかりません'); return; }
  let inst;
  try { inst = calcInstance(tpl); } catch (e) { toast(e.message); return; }
  if (keepVars && C.live && C.live.id === id) {
    // 同じ数字が出たら、もう一回だけ引き直す
    const same = Object.keys(inst.vars).every((k) => inst.vars[k] === C.live.vars[k]);
    if (same && Object.keys(inst.vars).length) { try { inst = calcInstance(tpl); } catch (e) { /* noop */ } }
  }
  C.live = { id, vars: inst.vars, si: 0, tries: 0, hints: 0, steps: [], input: '', layer: 0, done: false, startedAt: Date.now() };
  store.save();
  if (location.hash === '#/calcplay') viewCalcPlay(); else go('#/calcplay');
}
function calcNextId(excludeId) {
  const C = calcData();
  const list = calcList().filter((t) => t.id !== excludeId);
  if (!list.length) return excludeId;
  const score = (t) => { const s = C.stats[t.id]; if (!s) return 0; return s.last === 'clean' ? 2 : 1; };
  const min = Math.min(...list.map(score));
  const pool = list.filter((t) => score(t) === min);
  return pool[Math.floor(Math.random() * pool.length)].id;
}
function calcScope() {
  const C = calcData(); const L = C.live; const tpl = C.templates[L.id];
  return calcInstance(tpl, L.vars).scope;
}
const CALC_PRAISE = ['せいか〜い！🎉', 'いいじゃん✨', 'ナイス計算！💯', 'その調子〜🔥', 'バッチリ👏'];
const CALC_OOPS = ['おしい〜！ヒントいくよ💡', 'ちょい待って😏 ヒント見てみて', 'もう一回いこ🔥'];

function calcSubmit(raw) {
  const C = calcData(); const L = C.live; const tpl = C.templates[L.id];
  if (!L || L.done) return;
  const st = tpl.steps[L.si];
  const scope = calcScope();
  const want = calcStepValue(st, scope);
  let got; let ok;
  if (st.choices) { got = raw; ok = raw === want; }
  else {
    try { got = calcEval(raw, { Ans: calcAns() }, { si: true }); } catch (e) { L.msg = { kind: 'err', text: e.message }; calcRender(); return; }
    const tol = Number.isFinite(st.tol) ? st.tol : Number.isFinite(tpl.tol) ? tpl.tol : CALC_TOL;
    ok = Math.abs(got - want) <= Math.max(Math.abs(want) * tol, 1e-9);
  }
  if (ok) {
    L.steps[L.si] = { got, ok: true, hints: L.tries };
    if (!st.choices) calcPushTape(raw, got, true);
    L.msg = { kind: 'ok', text: CALC_PRAISE[Math.floor(Math.random() * CALC_PRAISE.length)] };
    calcAdvance();
  } else {
    L.tries += 1; L.hints += 1;
    const hints = calcHints(st);
    if (L.tries > Math.min(CALC_HINT_MAX, hints.length)) {
      L.steps[L.si] = { got, ok: false, shown: true, hints: L.tries };
      L.msg = { kind: 'ng', text: `答えは ${st.choices ? st.choices[want] : `${calcFmt(want)}${st.unit ? ` ${st.unit}` : ''}`} だよ。次のステップはこの値で進めよ👍` };
      calcAdvance();
    } else {
      L.msg = { kind: 'ng', text: `${CALC_OOPS[Math.min(L.tries - 1, CALC_OOPS.length - 1)]}${st.choices ? '' : `（キミの答え：${calcFmt(got)}）`}` };
    }
  }
  store.save(); calcRender();
}
function calcHints(st) {
  const h = Array.isArray(st.hints) ? st.hints.slice(0, CALC_HINT_MAX) : [];
  if (!h.length && st.expr) h.push('使う式を思い出してみて。問題文の数字が、どの量（電圧・電流・電力…）なのか単位で確かめよ💡');
  return h;
}
function calcAdvance() {
  const C = calcData(); const L = C.live; const tpl = C.templates[L.id];
  L.si += 1; L.tries = 0; L.input = '';
  if (L.si >= tpl.steps.length) {
    L.done = true;
    const clean = L.steps.every((s) => s.ok && !s.hints);
    const s = C.stats[L.id] || { n: 0, clean: 0 };
    s.n += 1; if (clean) s.clean += 1; s.last = clean ? 'clean' : 'miss'; s.at = Date.now();
    C.stats[L.id] = s;
  }
}
function calcAns() {
  const C = calcData();
  return C.tape.length ? C.tape[0].v : 0;
}
function calcPushTape(expr, v, judged = false) {
  const C = calcData();
  const e = String(expr).trim();
  if (e === 'Ans') return; // 「＝」のあとの Ans をそのまま判定したときは二重に残さない
  if (C.tape[0] && C.tape[0].e === e && C.tape[0].v === v) return;
  C.tape.unshift({ e, v, j: judged ? 1 : 0 });
  C.tape = C.tape.slice(0, 30);
}

/* ---------------- キーパッド ---------------- */
const CALC_KEYS = [
  [
    ['7'], ['8'], ['9'], ['÷'], ['√'],
    ['4'], ['5'], ['6'], ['×'], ['π'],
    ['1'], ['2'], ['3'], ['−'], ['²'],
    ['0'], ['.'], ['('], [')'], ['+'],
  ],
  [
    ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['^'], ['√3', '√3'],
    ['asin', 'asin('], ['acos', 'acos('], ['atan', 'atan('], ['2π', '2π'], ['1/x', '1/('],
    ['k', 'k'], ['M', 'M'], ['m', 'm'], ['μ', 'μ'], ['%'],
    ['×10ⁿ', '×10^'], ['×10⁻ⁿ', '×10^-'], ['³', '^3'], [','], ['Ans', 'Ans'],
  ],
];
function calcKeypadHTML(L) {
  const keys = CALC_KEYS[L.layer || 0];
  return `<div class="ck-grid">${keys.map(([label, ins]) => `<button type="button" class="ck ${/^[0-9.]$/.test(label) ? 'num' : ''}" data-c="key" data-ins="${esc(ins ?? label)}">${esc(label)}</button>`).join('')}
    <button type="button" class="ck fn" data-c="layer" aria-pressed="${L.layer === 1}">${L.layer === 1 ? '123' : 'fn'}</button>
    <button type="button" class="ck" data-c="key" data-ins="Ans">Ans</button>
    <button type="button" class="ck" data-c="bs" aria-label="1文字消す">⌫</button>
    <button type="button" class="ck" data-c="eq">＝</button>
    <button type="button" class="ck go" data-c="submit">判定</button></div>`;
}

/* ---------------- 画面 ---------------- */
function calcProblemHTML(tpl, scope) {
  return `<article class="card c-prob"><div class="g-qmeta"><span class="tag">${esc(tpl.unit || tpl.subject)}</span><span>${esc(tpl.title)}</span></div>
    <div class="qtext">${rich(calcFill(tpl.text, scope))}${figuresHTML((tpl.figures || []).map((f) => ({ ...(typeof f === 'string' ? { svg: f } : f), svg: calcFill(typeof f === 'string' ? f : f.svg, scope) })))}</div></article>`;
}
function calcStepsHTML(tpl, L, scope) {
  return `<ol class="c-steps">${tpl.steps.map((st, i) => {
    const label = calcFill(st.label, scope);
    if (i < L.si || L.done) {
      const r = L.steps[i] || {};
      const want = calcStepValue(st, scope);
      const val = st.choices ? st.choices[want] : `${calcFmt(want)}${st.unit ? ` ${esc(st.unit)}` : ''}`;
      return `<li class="c-step done ${r.ok ? (r.hints ? 'hinted' : 'ok') : 'ng'}"><span class="mk">${r.ok ? (r.hints ? '△' : '○') : '×'}</span><span class="lb">${inlineRich(label)}</span><b>${st.choices ? inlineRich(val) : val}</b></li>`;
    }
    if (i === L.si) {
      const hints = calcHints(st).slice(0, L.tries);
      return `<li class="c-step cur"><span class="mk">${i + 1}</span><span class="lb">${inlineRich(label)}${st.unit ? `<small>〔${esc(st.unit)}〕</small>` : ''}</span>
        ${hints.map((h, k) => `<div class="c-hint"><span class="g-av" aria-hidden="true">ギャ</span><div class="c-hint-b"><b>ヒント${k + 1}</b>${rich(calcFill(h, scope))}</div></div>`).join('')}</li>`;
    }
    return `<li class="c-step todo"><span class="mk">${i + 1}</span><span class="lb">${inlineRich(label)}</span></li>`;
  }).join('')}</ol>`;
}
function calcDisplayHTML(L, st) {
  let preview = '';
  if (L.input.trim()) {
    try { preview = `= ${calcFmt(calcEval(L.input, { Ans: calcAns() }, { si: true }), 6)}`; } catch (e) { preview = '…'; }
  }
  return `<div class="c-disp" aria-live="polite"><div class="c-expr">${esc(L.input) || `<span class="ph">${st ? '式や数値を入力（例：40÷0.8）' : ''}</span>`}<span class="caret"></span></div><div class="c-prev">${esc(preview)}${st && st.unit ? ` <small>${esc(st.unit)}</small>` : ''}</div></div>`;
}
function calcTapeHTML() {
  const t = calcData().tape.slice(0, 6);
  if (!t.length) return '';
  return `<div class="c-tape" aria-label="計算履歴">${t.map((x, i) => `<button type="button" data-c="tape" data-i="${i}"><span>${esc(x.e)}</span><b>${esc(calcFmt(x.v, 6))}</b></button>`).join('')}</div>`;
}
function calcMsgHTML(L) {
  if (!L.msg) return '';
  return `<p class="c-msg ${L.msg.kind}">${inlineRich(L.msg.text)}</p>`;
}
function calcDoneHTML(tpl, L, scope) {
  const clean = L.steps.filter((s) => s.ok && !s.hints).length;
  return `<section class="card c-done">
    <p class="c-score"><b>${clean}</b> / ${tpl.steps.length} ステップを一発正解${clean === tpl.steps.length ? ' 🎉 パーフェクト！' : ''}</p>
    ${tpl.explanation ? `<h3>解説</h3><div class="expl">${rich(calcFill(tpl.explanation, scope))}</div>` : ''}
    <div class="btns">
      <button class="btn primary" data-c="again">${I.dice}同じ問題を別の数字で</button>
      <button class="btn" data-c="next">次の問題 ${I.next}</button>
      <button class="btn" data-c="ask">Claude に聞く文をコピー</button>
      <a class="btn" href="#/calc">一覧へ</a>
    </div></section>`;
}

function calcRender() {
  if (location.hash !== '#/calcplay') return;
  const C = calcData(); const L = C.live;
  const tpl = L && C.templates[L.id];
  if (!tpl) { go('#/calc'); return; }
  const scope = calcScope();
  const st = L.done ? null : tpl.steps[L.si];
  const y = window.scrollY;
  app().innerHTML = `${topbar('計算練習', `${esc(tpl.unit || tpl.subject)} ・ ステップ ${Math.min(L.si + 1, tpl.steps.length)}/${tpl.steps.length}`, `<button class="iconbtn" data-c="again" aria-label="別の数字で解き直す">${I.dice}</button>`, '#/calc')}
    ${calcProblemHTML(tpl, scope)}
    ${calcStepsHTML(tpl, L, scope)}
    ${calcMsgHTML(L)}
    ${L.done ? calcDoneHTML(tpl, L, scope) : ''}
    ${st ? `<div class="c-dock"><div class="c-dock-in">
      ${st.choices
        ? `<div class="choices">${st.choices.map((ch, k) => `<button class="choice" data-c="choice" data-k="${k}"><span class="k">${KANA[k]}</span><span class="v">${inlineRich(ch)}</span></button>`).join('')}</div>`
        : `${calcTapeHTML()}${calcDisplayHTML(L, st)}${calcKeypadHTML(L)}`}
    </div></div>` : ''}`;
  typeset(app());
  requestAnimationFrame(() => {
    const dock = document.querySelector('.c-dock');
    app().style.paddingBottom = dock ? `${dock.offsetHeight + 20}px` : '';
    const cur = document.querySelector('.c-step.cur') || document.querySelector('.c-done');
    if (cur && L.scroll) {
      const r = cur.getBoundingClientRect();
      const bottom = window.innerHeight - (dock ? dock.offsetHeight : 0);
      if (r.top < 60 || r.bottom > bottom) window.scrollTo({ top: window.scrollY + r.top - 70, behavior: 'smooth' });
      L.scroll = false;
    } else window.scrollTo(0, y);
  });
}
/* キーを押したときは表示部分だけ書きかえる（全体を描き直すとちらつくため） */
function calcRefreshDisplay() {
  const C = calcData(); const L = C.live; const tpl = C.templates[L.id];
  const el = document.querySelector('.c-disp');
  if (el) el.outerHTML = calcDisplayHTML(L, tpl.steps[L.si]);
}

function viewCalcPlay() {
  const L = calcData().live;
  if (!L) { go('#/calc'); return; }
  L.scroll = true;
  calcRender();
}

function viewCalc() {
  const C = calcData();
  const list = calcList();
  const tried = list.filter((t) => C.stats[t.id]).length;
  const clean = list.filter((t) => C.stats[t.id] && C.stats[t.id].last === 'clean').length;
  const units = [...new Set(list.map((t) => t.unit || t.subject))];
  app().innerHTML = `${topbar('計算練習', '数字が毎回変わる・途中式を1段ずつ')}
    ${!list.length ? `<div class="callout"><p>まだ計算問題がないよ。計算問題ファイル（<code>${CALC_FORMAT}</code>）を取り込むと始められるよ。</p><a class="btn primary block" href="#/settings">${I.upload}問題を取り込む</a></div>` : `
    <section class="stats"><div class="stat"><b>${list.length}</b><span>問題</span></div><div class="stat"><b>${tried}</b><span>挑戦した</span></div><div class="stat"><b>${clean}</b><span>前回パーフェクト</span></div></section>
    <button class="btn primary block" data-c="pick">${I.dice}おまかせで1問（未挑戦・ミス優先）</button>
    ${units.map((u) => `<section class="section"><h2>${esc(u)}</h2><div class="c-list">${list.filter((t) => (t.unit || t.subject) === u).map((t) => {
      const s = C.stats[t.id];
      return `<button class="c-row" data-c="open" data-id="${esc(t.id)}"><span class="c-st ${s ? s.last : ''}">${s ? (s.last === 'clean' ? '○' : '△') : '・'}</span><span class="tx"><b>${esc(t.title)}</b><small>${t.steps.length}ステップ${s ? ` ・ ${s.n}回挑戦 ・ パーフェクト${s.clean}回` : ''}</small></span>${I.next}</button>`;
    }).join('')}</div></section>`).join('')}`}
    <p class="g-note">キーパッドの「fn」で sin・cos（角度は度）、√3、k・m・μ、×10ⁿ が出るよ。</p>`;
  $('[data-c="pick"]')?.addEventListener('click', () => calcStart(calcNextId(null)));
  app().querySelectorAll('[data-c="open"]').forEach((b) => b.addEventListener('click', () => calcStart(b.dataset.id)));
}

function calcAskText() {
  const C = calcData(); const L = C.live; const tpl = C.templates[L.id];
  const scope = calcScope();
  const lines = tpl.steps.map((st, i) => {
    const r = L.steps[i] || {};
    const want = calcStepValue(st, scope);
    const mine = st.choices ? st.choices[r.got] ?? '' : r.got !== undefined ? calcFmt(r.got, 4) : '';
    return `${i + 1}. ${calcFill(st.label, scope)}：正解 ${st.choices ? st.choices[want] : `${calcFmt(want)} ${st.unit || ''}`}／自分 ${mine}${r.ok ? (r.hints ? '（ヒントで正解）' : '（一発正解）') : '（答えを見た）'}`;
  }).join('\n');
  return `電験三種の計算練習をしていて、この問題でつまずいたところを、ギャル先生の口調で「なんでそうなるか」から教えてほしいです。

【問題】${calcFill(tpl.text, scope).replace(/\$/g, '')}

【途中式と自分の答え】
${lines}`;
}

/* ---------------- イベント ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-c]');
  if (!el || location.hash !== '#/calcplay') return;
  const C = calcData(); const L = C.live;
  if (!L) return;
  const a = el.dataset.c;
  if (a === 'key') { L.input += el.dataset.ins; if (L.layer === 1) { L.layer = 0; calcRender(); return; } calcRefreshDisplay(); store.save(); }
  else if (a === 'bs') {
    const m = /(Ans|asin\(|acos\(|atan\(|sin\(|cos\(|tan\(|×10\^-?|.)$/u.exec(L.input);
    L.input = m ? L.input.slice(0, -m[0].length) : '';
    calcRefreshDisplay(); store.save();
  } else if (a === 'layer') { L.layer = L.layer === 1 ? 0 : 1; calcRender(); }
  else if (a === 'eq') {
    if (!L.input.trim()) return;
    try {
      const v = calcEval(L.input, { Ans: calcAns() }, { si: true });
      calcPushTape(L.input, v); L.input = 'Ans'; L.msg = null;
    } catch (err) { L.msg = { kind: 'err', text: err.message }; }
    store.save(); calcRender();
  } else if (a === 'tape') {
    const t = C.tape[Number(el.dataset.i)];
    if (t) { L.input += calcFmt(t.v, 6).replace('×10^', '×10^'); calcRefreshDisplay(); store.save(); }
  } else if (a === 'submit') { if (L.input.trim()) { L.scroll = true; calcSubmit(L.input); } }
  else if (a === 'choice') { L.scroll = true; calcSubmit(Number(el.dataset.k)); }
  else if (a === 'again') calcStart(L.id, true);
  else if (a === 'next') calcStart(calcNextId(L.id));
  else if (a === 'ask') {
    const text = calcAskText();
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast('コピーしました。Claude アプリに貼り付けて聞いてね'))
      .catch(() => { prompt('この文をコピーして Claude に貼り付けてね', text); });
  }
});
document.addEventListener('keydown', (e) => {
  if (location.hash !== '#/calcplay') return;
  const L = calcData().live;
  if (!L || L.done || e.target.closest('input, textarea, select')) return;
  if (/^[0-9.+\-*/^()]$/.test(e.key)) { L.input += { '*': '×', '/': '÷', '-': '−' }[e.key] || e.key; calcRefreshDisplay(); e.preventDefault(); }
  else if (e.key === 'Backspace') { L.input = L.input.slice(0, -1); calcRefreshDisplay(); e.preventDefault(); }
  else if (e.key === 'Enter') { if (L.input.trim()) { L.scroll = true; calcSubmit(L.input); } e.preventDefault(); }
});

function calcHomeSub() {
  const list = calcList();
  if (!list.length) return '数字が毎回変わる計算問題（要取り込み）';
  const C = calcData();
  const miss = list.filter((t) => C.stats[t.id] && C.stats[t.id].last !== 'clean').length;
  return `${list.length}問${miss ? ` ・ ミス ${miss}問` : ''} ・ 途中式を1段ずつ、電卓つき`;
}

routes.calc = viewCalc;
routes.calcplay = viewCalcPlay;
