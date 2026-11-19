'use strict';

/* =========================================================
   ギャル先生モード
   取り込んだ問題を、AI のギャル先生と一問一答で解く。
   - 選択肢の正誤はアプリが判定する（AI には判定させない）
   - 不正解ならヒント 3 段階 → それでもダメなら答えを開示
   - 正解したら「なんで？」の深掘り（自由記述）を AI が評価
   - AI は自分の Anthropic API キーでブラウザから直接呼ぶ
   app.js のあとに読み込む（app.js のヘルパーを使う）。
   ========================================================= */

const GAL_SECRET = 'denken3-drill:secret'; // API キーはバックアップに含めないよう別のキーに置く
const GAL_API = 'https://api.anthropic.com/v1/messages';
const GAL_MODELS = [
  ['claude-opus-5-5', 'Opus 5.5（じっくり・おすすめ）'],
  ['claude-sonnet-5-5', 'Sonnet 5.5（バランス）'],
  ['claude-haiku-5-5', 'Haiku 5.5（速い・安い）'],
  ['demo', 'デモ（AIなし・決まった返事）'],
];
/* 料金の目安（USD / 100万トークン、2026年11月時点の公表値）。月の上限の計算に使う */
const GAL_PRICE = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};
const GAL_HINT_MAX = 3;
const GAL_EXPLAIN_TRIES = 2;
const GAL_RESULT = { first: '○', hinted: '△', wrong: '×', skip: '–' };

I.chat = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" stroke-width="2.6"/></svg>';
I.send = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>';

/* ---------------- データ ---------------- */
function galData() {
  // 参照が変わらないように、その場で足りないところだけ補う
  if (!store.d.gal || typeof store.d.gal !== 'object') store.d.gal = {};
  const g = store.d.gal;
  if (g.live === undefined) g.live = null;
  if (!Array.isArray(g.history)) g.history = [];
  if (!g.weakTags || typeof g.weakTags !== 'object') g.weakTags = {};
  if (!g.qstat || typeof g.qstat !== 'object') g.qstat = {}; // 問題ごとの記録（ふつうの「苦手克服」とは別）
  if (!g.spend || typeof g.spend !== 'object') g.spend = {}; // 月ごとの料金の目安 { '2026-11': 1.23 }
  if (!g.settings || typeof g.settings !== 'object') g.settings = {};
  const def = { model: 'claude-opus-5-5', maxCalls: 60, budget: 20, deepDive: true, count: 5, order: 'weak', subject: 'all' };
  for (const [k, v] of Object.entries(def)) if (!(k in g.settings)) g.settings[k] = v;
  return g;
}
const galKey = () => { try { return localStorage.getItem(GAL_SECRET) || ''; } catch (e) { return ''; } };
const galIsDemo = () => galData().settings.model === 'demo';
const galReady = () => galIsDemo() || !!galKey();
const galMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const galSpent = () => galData().spend[galMonth()] || 0;
const usd = (v) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;
function galAddSpend(model, u) {
  const pr = GAL_PRICE[model];
  if (!pr) return;
  const g = galData(); const m = galMonth();
  g.spend[m] = (g.spend[m] || 0) + (u.in * pr[0] + u.out * pr[1]) / 1e6;
}
/* ギャル先生での弱点：直近の結果が一発正解でなかった問題 */
const galWeak = (id) => { const r = galData().qstat[id]; return !!(r && r.last !== 'first'); };
function topWeakTags(n = 6) {
  return Object.entries(galData().weakTags).sort((a, b) => b[1].count - a[1].count || b[1].lastAt - a[1].lastAt).slice(0, n);
}

/* ---------------- 小さな Markdown ----------------
   AI の文章を安全に表示する（HTML はすべてエスケープ）。$...$ は KaTeX に任せる。 */
function mdInline(s) {
  return s
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+?)`/g, '<code>$1</code>');
}
function mdToHtml(src) {
  const lines = esc(String(src || '')).replace(/\r/g, '').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => mdInline(c.trim()));
      html += `<div class="g-tbl"><table><thead><tr>${cells(line).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        html += `<tr>${cells(lines[i]).map((c) => `<td>${c}</td>`).join('')}</tr>`;
        i++;
      }
      html += '</tbody></table></div>';
      continue;
    }
    if (/^\s*([-・*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      html += ordered ? '<ol>' : '<ul>';
      while (i < lines.length && /^\s*([-・*]|\d+[.)])\s+/.test(lines[i])) {
        html += `<li>${mdInline(lines[i].replace(/^\s*([-・*]|\d+[.)])\s+/, ''))}</li>`;
        i++;
      }
      html += ordered ? '</ol>' : '</ul>';
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) { html += `<p class="g-h">${mdInline(line.replace(/^#{1,4}\s+/, ''))}</p>`; i++; continue; }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-・*]|\d+[.)])\s+/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i]) && !/^#{1,4}\s+/.test(lines[i])) {
      para.push(mdInline(lines[i])); i++;
    }
    html += `<p>${para.join('<br>')}</p>`;
  }
  return html;
}

/* ---------------- AI 呼び出し ---------------- */
const GAL_SYSTEM = `返事は必ず teach ツールで返してください。
あなたは電験三種（第三種電気主任技術者試験）の家庭教師「ギャル先生」です。
生徒はスマホだけで、紙もペンもない場所で練習しています。

# 口調
- ギャル口調で明るく。絵文字は1メッセージに2〜3個まで。
- 新しい概念は大胆なたとえで説明する（例：首振り扇風機、ブランコ、山登り、重たいトラック、風船、綱引き）。
- 呼びかけは「キミ」。

# 教え方のルール
- 選択肢の正誤はアプリが判定済み。あなたはその判定を絶対に覆さない。
- ヒントを出すときは、正解の選択肢・その記号（ア・イ…）・正解の数値を絶対に言わない。
- 正解でも、用語のあいまいさ（例：磁束と磁束密度、「変化が大きい」と「速い」、最大値と瞬時値）があれば短く訂正する。
- 公式は「なぜそうなるか」を一言そえる。
- 問題文と教材の解説にない数値を勝手に作らない。自信がないことは断定しない。

# 書式
- message は Markdown。数式は $...$ で書く（KaTeX で表示される）。HTML は使わない。
- スマホ1画面に収まる長さ（目安 4〜10 行）。見出しは使わない。
- 表は本当に必要なときだけ。`;

const GAL_TOOL = {
  name: 'teach',
  description: 'ギャル先生の発言をアプリに渡す。必ずこのツールで返す。',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '生徒に見せる発言（Markdown、数式は $...$）' },
      verdict: { type: 'string', enum: ['correct', 'partial', 'wrong'], description: '自由記述の評価をするときだけ。correct=○, partial=△, wrong=×' },
      deep_dive: { type: 'string', description: '正解のあとに出す「なんで？」の深掘り質問（自由記述で1〜3行で答えられるもの）。指示があるときだけ' },
      model_answer: { type: 'string', description: '深掘り質問の模範解答（短く）。開示を指示されたときだけ' },
      weak_tags: { type: 'array', items: { type: 'string' }, description: '間違え方の短いタグ（例：P/S取り違え、√3忘れ、進み遅れ逆）。既存タグがあれば同じ表記を使う' },
      new_terms: {
        type: 'array',
        description: 'この発言で初めて出した記号・単位・用語',
        items: { type: 'object', properties: { symbol: { type: 'string' }, reading: { type: 'string' }, meaning: { type: 'string' }, origin: { type: 'string' } }, required: ['symbol', 'meaning'] },
      },
    },
    required: ['message'],
  },
};

/* ストリーミング中の JSON から message の中身だけを取り出す */
function partialMessage(json) {
  const m = /"message"\s*:\s*"/.exec(json);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') break;
    if (c !== '\\') { out += c; continue; }
    const n = json[i + 1];
    if (n === undefined) break;
    if (n === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue;
    }
    out += { n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' }[n] ?? n;
    i++;
  }
  return out;
}

class GalError extends Error {
  constructor(kind, msg) { super(msg); this.kind = kind; }
}

async function galCall(prompt, onText, demoFn) {
  const s = galData().settings;
  const live = galData().live;
  if (live) {
    if (live.calls >= s.maxCalls) throw new GalError('limit', `このセッションの AI 呼び出し上限（${s.maxCalls}回）に達しました`);
    live.calls += 1;
  }
  if (s.model === 'demo') return galDemoStream(demoFn(), onText);
  const key = galKey();
  if (!key) throw new GalError('nokey', 'API キーが設定されていません');
  if (s.budget > 0 && galSpent() >= s.budget) throw new GalError('budget', `今月の上限 ${usd(s.budget)} に達しました（目安 ${usd(galSpent())}）`);
  if (!navigator.onLine) throw new GalError('offline', 'オフラインです');
  let res;
  try {
    res = await fetch(GAL_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: s.model, max_tokens: 1200, stream: true,
        system: GAL_SYSTEM,
        // 思考が常にオンのモデルでは tool_choice の強制が使えないため auto にして、文章だけの返事にも対応する
        tools: [GAL_TOOL], tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) { throw new GalError('offline', '通信できませんでした'); }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error.message; } catch (e) { /* noop */ }
    const kind = res.status === 401 ? 'auth' : (res.status === 429 || res.status === 529) ? 'busy' : 'api';
    throw new GalError(kind, `${res.status} ${detail}`.trim());
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = ''; let json = ''; let shown = ''; let text = '';
  const usage = { in: 0, out: 0 };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k;
    while ((k = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
      if (ev.type === 'message_start' && ev.message && ev.message.usage) usage.in = ev.message.usage.input_tokens || 0;
      else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'input_json_delta') {
        json += ev.delta.partial_json || '';
        const t = partialMessage(json);
        if (t !== shown) { shown = t; onText(t); }
      } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        text += ev.delta.text || '';
        if (!json) onText(text);
      } else if (ev.type === 'message_delta' && ev.usage) usage.out = ev.usage.output_tokens || usage.out;
      else if (ev.type === 'error') throw new GalError('api', (ev.error && ev.error.message) || 'エラー');
    }
  }
  let out = null;
  if (json) { try { out = JSON.parse(json); } catch (e) { out = { message: shown }; } }
  if (!out || !out.message) out = { message: (shown || text).trim() || '（うまく返事を受け取れませんでした。もう一回やってみて）' };
  if (live) { live.usage.in += usage.in; live.usage.out += usage.out; }
  galAddSpend(s.model, usage);
  store.save();
  return out;
}

async function galDemoStream(out, onText) {
  const msg = out.message;
  for (let i = 1; i <= msg.length; i += 6) {
    onText(msg.slice(0, i));
    await new Promise((r) => setTimeout(r, 16));
  }
  onText(msg);
  return out;
}

async function galPing() {
  const s = galData().settings;
  if (s.model === 'demo') return 'デモなので通信しません';
  const key = galKey();
  if (!key) throw new GalError('nokey', 'API キーが設定されていません');
  const res = await fetch(GAL_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: s.model, max_tokens: 16, messages: [{ role: 'user', content: '「OK」とだけ返して' }] }),
  });
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json()).error.message; } catch (e) { /* noop */ }
    throw new GalError(res.status === 401 ? 'auth' : 'api', `${res.status} ${detail}`.trim());
  }
  return '接続できました';
}

function galErrorText(e) {
  switch (e && e.kind) {
    case 'nokey': return 'API キーが設定されてないみたい。設定 → ギャル先生（AI）から入れてね🙏';
    case 'auth': return 'API キーが通らなかった…🥲 設定でキーを確認してみて！';
    case 'busy': return 'いまAIが混んでるっぽい💦 ちょっと待ってから「もう一回」してみて！';
    case 'offline': return '電波がないみたい📵 オフラインのときは、ふつうのドリルで練習してね！';
    case 'limit': return `${e.message}。設定で上限を変えられるよ。`;
    case 'budget': return `${e.message}。設定 → ギャル先生（AI）で上限を変えられるよ💸`;
    default: return `AI からエラーが返ってきた…（${e && e.message ? e.message : '不明'}）`;
  }
}

/* ---------------- プロンプト ---------------- */
function galBlankText(q, bi) {
  const b = q.blanks[bi];
  return b.prompt ? b.prompt : `空欄［${b.label ?? bi + 1}］に入るもの`;
}
function galQuestionContext(q, bi, cur) {
  const b = q.blanks[bi];
  const text = q.text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, '［$1］');
  const order = cur.order[bi];
  const choices = order.map((ci, k) => `${KANA[k]}: ${b.choices[ci]}`).join('\n');
  const ansK = KANA[order.indexOf(b.answer)];
  const log = cur.log.slice(-12).map((m) => `${m.who === 't' ? '先生' : '生徒'}: ${m.text}`).join('\n');
  const tags = topWeakTags(8).map(([t, v]) => `${t}（${v.count}回）`).join('、') || 'まだなし';
  return `【問題】${q.subject}${q.unit ? `／${q.unit}` : ''}${q.source ? `（${q.source}）` : ''}
${text}

【いま答える欄】${galBlankText(q, bi)}（全${q.blanks.length}欄中の${bi + 1}つ目）
【選択肢（生徒に見えている順）】
${choices}
【正解】${ansK}: ${b.choices[b.answer]}
【教材の解説】${q.explanation || '（なし）'}
【この問題でのこれまでのやりとり】
${log || '（まだなし）'}
【生徒の弱点タグ（多い順）】${tags}`;
}
const pickText = (q, bi, ci) => q.blanks[bi].choices[ci];

/* ---------------- デモ用の返事 ---------------- */
const galDemo = {
  correct: (deep) => ({
    message: 'せいか〜い！🎉 ちゃんと理屈で選べてるじゃん✨\n\nポイントは「**共通なもの**」に注目することね。直列なら電流、並列なら電圧が共通だよ💡',
    deep_dive: deep ? 'じゃあ聞くね😏 なんでそれが正解になるのか、自分の言葉で1〜2行で説明してみて！' : undefined,
  }),
  hint: (lv) => ({
    message: [
      'おしい〜！😏 でもちょっと待って。\n\n**問題文の数字が、どの量（電圧？電流？電力？）なのか**、単位を見てもう一回考えてみて💡',
      'ヒント2いくよ🔥\n\n使う式を思い出してみて。$P = VI\\cos\\theta$ みたいに、**何と何の関係か**を1本の式にすると見えてくるよ📐',
      'ラストヒント⚠️\n\nあと一歩！ 残ってる選択肢を、さっきの式に**当てはめて検算**してみて。合うのは1つだけだよ😉',
    ][Math.min(lv, 3) - 1],
    weak_tags: ['デモ：式の選び方'],
  }),
  reveal: () => ({ message: '答えはこれだよ👆 問題文の空欄にも正解を入れといたから確認してね！\n\n次は同じパターンで落とさないように、**単位チェック**のクセをつけよ💪', weak_tags: ['デモ：式の選び方'] }),
  judge: (n) => (n < 2
    ? { message: '入口は合ってる！👏 でも「なんで」の部分がもうひと声✨\n\n**何が共通で、何を足すのか**を入れて言ってみて！', verdict: 'partial' }
    : { message: 'オッケー、だいぶ言えてる！👏 模範解答も置いとくね📝', verdict: 'partial', model_answer: '直列は電流が共通なので電圧を足す、並列は電圧が共通なので電流を足す。' }),
  chat: () => ({ message: 'いい質問〜！🙌 デモなので決まった返事だけど、本物のギャル先生ならここでちゃんと答えるよ😉' }),
  summary: () => ({ message: 'おつかれ〜！🎉 今回は全体的にいい感じ✨\n\n- **良かった**：理屈で考えて選べてた\n- **弱点**：単位の確認が甘いとこ\n- **次のおすすめ**：苦手優先でもう1セット💪' }),
};

/* ---------------- セッション ---------------- */
function galCandidates(subject) {
  return allQ(subject).filter((q) => Array.isArray(q.blanks) && q.blanks.length);
}
function galBuildQueue(st) {
  const list = galCandidates(st.subject);
  let ids;
  if (st.order === 'seq') ids = list.map((q) => q.id);
  else if (st.order === 'weak') {
    const st = galData().qstat;
    const weak = shuffle(list.filter((q) => galWeak(q.id)).map((q) => q.id));
    const fresh = shuffle(list.filter((q) => !st[q.id]).map((q) => q.id));
    const rest = shuffle(list.filter((q) => st[q.id] && !galWeak(q.id)).map((q) => q.id));
    ids = weak.concat(fresh, rest);
  } else ids = shuffle(list.map((q) => q.id));
  return ids.slice(0, st.count);
}
function galNewCur(qid) {
  const q = store.d.questions[qid];
  return {
    qid, bi: 0, phase: 'answer', hints: 0, wrongs: [],
    order: q.blanks.map((b) => shuffle(b.choices.map((_, i) => i))),
    blankRes: [], log: [], deep: null, deepTries: 0, firstTry: true, hintTotal: 0,
  };
}
function galStart() {
  const g = galData();
  const ids = galBuildQueue(g.settings);
  if (!ids.length) { toast('出題できる問題がありません'); return; }
  g.live = {
    id: `g${Date.now()}`, startedAt: Date.now(), subject: g.settings.subject,
    queue: ids, pos: 0, cur: galNewCur(ids[0]), items: [], calls: 0, usage: { in: 0, out: 0 },
    feed: [], busy: false,
  };
  galPushQuestion();
  store.save();
  go('#/galplay');
}
const galCurQ = () => { const L = galData().live; return L && store.d.questions[L.cur.qid]; };

/* feed: 画面に並ぶ吹き出し。{ k: 'q'|'t'|'u'|'sys', ... } */
function galPushQuestion() {
  const L = galData().live;
  L.feed.push({ k: 'q', qid: L.cur.qid, n: L.pos + 1, total: L.queue.length });
  galPushBlankPrompt();
}
function galPushBlankPrompt() {
  const L = galData().live; const q = galCurQ(); const c = L.cur;
  if (q.blanks.length > 1 || q.blanks[c.bi].prompt) {
    const b = q.blanks[c.bi];
    L.feed.push({ k: 'sys', text: b.prompt ? `［${b.label ?? c.bi + 1}］${b.prompt}` : `空欄［${b.label ?? c.bi + 1}］を選んでね（${c.bi + 1}/${q.blanks.length}）` });
  }
}
function galTeacherSay(out) {
  const L = galData().live;
  const msg = { k: 't', text: out.message || '' };
  if (out.verdict) msg.verdict = out.verdict;
  if (out.model_answer) msg.model = out.model_answer;
  if (Array.isArray(out.new_terms) && out.new_terms.length) msg.terms = out.new_terms.slice(0, 4);
  L.feed.push(msg);
  L.cur.log.push({ who: 't', text: out.message || '' });
  if (Array.isArray(out.weak_tags)) {
    const W = galData().weakTags;
    for (const raw of out.weak_tags.slice(0, 3)) {
      const t = String(raw).trim().slice(0, 24);
      if (!t) continue;
      W[t] = { count: (W[t] ? W[t].count : 0) + 1, lastAt: Date.now(), lastQid: L.cur.qid };
      if (!L.cur.tags) L.cur.tags = [];
      if (!L.cur.tags.includes(t)) L.cur.tags.push(t);
    }
  }
}

async function galAsk(prompt, demoFn) {
  const L = galData().live;
  L.busy = true; L.err = null;
  galRender();
  const bubble = document.getElementById('g-stream');
  let out;
  try {
    out = await galCall(prompt, (t) => {
      const el = document.getElementById('g-stream');
      if (el) { el.classList.remove('typing'); el.querySelector('.g-txt').textContent = t; galScrollEnd(false); }
    }, demoFn);
  } catch (e) {
    L.busy = false; L.err = { text: galErrorText(e), kind: e.kind };
    store.save(); galRender();
    return null;
  }
  void bubble;
  L.busy = false;
  galTeacherSay(out);
  store.save();
  return out;
}

/* 選択肢をタップしたとき */
async function galPick(k) {
  const L = galData().live; const q = galCurQ(); const c = L.cur;
  if (L.busy || c.phase !== 'answer') return;
  const b = q.blanks[c.bi];
  const ci = c.order[c.bi][k];
  if (c.wrongs.includes(ci)) return;
  L.feed.push({ k: 'u', text: `${KANA[k]}　${pickText(q, c.bi, ci)}` });
  c.log.push({ who: 's', text: `${KANA[k]}（${pickText(q, c.bi, ci)}）を選んだ` });
  const ctx = galQuestionContext(q, c.bi, c);
  if (ci === b.answer) {
    c.blankRes[c.bi] = c.hints ? 'hinted' : 'first';
    if (c.hints) c.firstTry = false;
    const deep = galData().settings.deepDive && c.bi === q.blanks.length - 1;
    L.feed.push({ k: 'mark', ok: true, text: c.hints ? `正解（ヒント${c.hints}回）` : '正解！' });
    c.phase = 'wait';
    const out = await galAsk(`${ctx}

【状況】生徒は ${KANA[k]}（${pickText(q, c.bi, ci)}）を選んで正解しました（ヒント${c.hints}回のあと）。
【指示】ほめて、なぜそれが正解か短く説明してください。選び方に用語のあいまいさがありそうなら一言そえる。初めて出す記号・単位があれば new_terms に。
${deep ? 'deep_dive に「なんで？」の深掘り質問を1つ入れてください（この問題の理解を確かめる、1〜3行の自由記述で答えられるもの。message の最後でもその質問を投げかける）。' : 'deep_dive は入れないでください。'}`, () => galDemo.correct(deep));
    if (!out) { c.phase = 'retry-correct'; store.save(); galRender(); return; }
    galAfterCorrect(out, deep);
  } else {
    c.wrongs.push(ci); c.firstTry = false;
    c.hints += 1; c.hintTotal += 1;
    L.feed.push({ k: 'mark', ok: false, text: '不正解' });
    c.phase = 'wait';
    if (c.hints > GAL_HINT_MAX || c.wrongs.length >= b.choices.length - 1) {
      c.blankRes[c.bi] = 'wrong';
      L.feed.push({ k: 'mark', ok: true, text: `正解は ${KANA[c.order[c.bi].indexOf(b.answer)]}　${b.choices[b.answer]}` });
      const out = await galAsk(`${ctx}

【状況】生徒は ${KANA[k]}（${pickText(q, c.bi, ci)}）を選んで不正解。ヒントを${GAL_HINT_MAX}回出したあとなので、答えを開示します。
【指示】正解（${KANA[c.order[c.bi].indexOf(b.answer)]}）と、なぜそうなるかを解説してください。生徒がどこで勘違いしたかも推測して一言。weak_tags に間違え方のタグを。`, galDemo.reveal);
      c.revealed = true;
      if (!out) { c.phase = 'retry-reveal'; store.save(); galRender(); return; }
      galNextBlankOrDone();
    } else {
      const lv = c.hints;
      const out = await galAsk(`${ctx}

【状況】生徒は ${KANA[k]}（${pickText(q, c.bi, ci)}）を選んで不正解（${lv}回目の不正解）。
【指示】ヒントのレベル${lv}を出してください。レベル1=考える方向づけ、レベル2=具体的な手がかり（使う関係式や注目点）、レベル3=ほぼ答えだが最後の一歩は本人に。
正解の選択肢・記号・数値は絶対に言わない。生徒がその選択肢を選んだ理由（よくある勘違い）を推測して指摘してよい。weak_tags に間違え方のタグを。`, () => galDemo.hint(lv));
      if (!out) { c.phase = 'answer'; store.save(); galRender(); return; }
      c.phase = 'answer';
      store.save(); galRender();
    }
  }
}
function galAfterCorrect(out, deep) {
  const L = galData().live; const c = L.cur;
  if (deep && out.deep_dive) { c.deep = out.deep_dive; c.phase = 'explain'; store.save(); galRender(); return; }
  galNextBlankOrDone();
}
function galNextBlankOrDone() {
  const L = galData().live; const q = galCurQ(); const c = L.cur;
  if (c.bi < q.blanks.length - 1) {
    c.bi += 1; c.hints = 0; c.wrongs = []; c.phase = 'answer';
    galPushBlankPrompt();
  } else c.phase = 'next';
  store.save(); galRender();
}

/* 深掘りの自由記述 */
async function galExplain(text) {
  const L = galData().live; const q = galCurQ(); const c = L.cur;
  if (L.busy || c.phase !== 'explain') return;
  c.deepTries += 1;
  L.feed.push({ k: 'u', text });
  c.log.push({ who: 's', text });
  c.phase = 'wait';
  const last = c.deepTries >= GAL_EXPLAIN_TRIES;
  const out = await galAsk(`${galQuestionContext(q, q.blanks.length - 1, c)}

【深掘り質問】${c.deep}
【生徒の答え（${c.deepTries}回目）】${text}
【指示】この答えを評価して verdict を入れてください（correct=○、partial=△、wrong=×）。
- correct：ほめて、言葉の精度を上げる一言があれば添える。
${last ? '- partial / wrong：これが最後なので model_answer に模範解答を入れ、message でも要点を説明する。' : '- partial / wrong：答えを言わずにヒントを出して、もう一度答えてもらう。'}`, () => galDemo.judge(c.deepTries));
  if (!out) { c.deepTries -= 1; c.phase = 'explain'; store.save(); galRender(); return; }
  c.deepVerdict = out.verdict || 'partial';
  if (out.verdict === 'correct' || last) { c.deep = null; galNextBlankOrDone(); return; }
  c.phase = 'explain'; store.save(); galRender();
}
function galSkipExplain() {
  const L = galData().live; const c = L.cur;
  if (L.busy || c.phase !== 'explain') return;
  L.feed.push({ k: 'sys', text: '深掘りはスキップしました' });
  c.deep = null; c.deepVerdict = 'skip';
  galNextBlankOrDone();
}

/* 生徒からの質問 */
async function galChat(text) {
  const L = galData().live; const q = galCurQ(); const c = L.cur;
  if (L.busy) return;
  const prev = c.phase;
  L.feed.push({ k: 'u', text });
  c.log.push({ who: 's', text: `（質問）${text}` });
  c.phase = 'wait';
  const answered = prev === 'next' || prev === 'explain';
  await galAsk(`${galQuestionContext(q, c.bi, c)}

【状況】生徒から質問が来ました：「${text}」
【指示】質問に答えてください。${answered ? '' : 'この欄はまだ解答中なので、正解の選択肢・記号・数値は言わないこと。'}質問が問題と関係なければ、短く答えて練習に戻るよう促す。`, galDemo.chat);
  c.phase = prev;
  store.save(); galRender();
}

function galRecordItem() {
  const L = galData().live; const q = galCurQ(); const c = L.cur;
  const res = c.blankRes.includes('wrong') ? 'wrong' : c.blankRes.includes('hinted') ? 'hinted' : 'first';
  L.items.push({ qid: c.qid, result: res, hints: c.hintTotal, tags: c.tags || [], deep: c.deepVerdict || null });
  // ギャル先生の記録はふつうの学習記録（苦手克服）とは別に持つ
  const st = galData().qstat;
  const r = st[q.id] || { n: 0, first: 0 };
  r.n += 1; if (res === 'first') r.first += 1;
  r.last = res; r.at = Date.now();
  st[q.id] = r;
}
function galNextQuestion() {
  const L = galData().live;
  if (L.busy || L.cur.phase !== 'next') return;
  galRecordItem();
  L.pos += 1;
  if (L.pos >= L.queue.length) { galFinish(); return; }
  L.cur = galNewCur(L.queue[L.pos]);
  galPushQuestion();
  store.save(); galRender();
  galScrollToLastQuestion();
}
async function galFinish(early = false) {
  const g = galData(); const L = g.live;
  if (!L) return;
  if (early && L.cur && L.cur.phase === 'next') galRecordItem();
  const rec = {
    id: L.id, startedAt: L.startedAt, endedAt: Date.now(), subject: L.subject,
    items: L.items, usage: L.usage, calls: L.calls, comment: '',
  };
  g.history.unshift(rec);
  g.history = g.history.slice(0, 30);
  g.live = null;
  store.save();
  go('#/galdone');
  if (rec.items.length && galReady()) {
    const lines = rec.items.map((it, i) => {
      const q = store.d.questions[it.qid];
      return `${i + 1}. ${q ? `${q.unit || q.subject}：${galSnippet(q, 40)}` : it.qid} → ${{ first: '一発正解', hinted: `ヒント${it.hints}回で正解`, wrong: '答えを開示' }[it.result]}${it.tags.length ? `（${it.tags.join('、')}）` : ''}${it.deep ? ` 深掘り:${it.deep}` : ''}`;
    }).join('\n');
    try {
      const out = await galCallSummary(`【今回のセッション結果】\n${lines}\n【弱点タグ（通算・多い順）】${topWeakTags(6).map(([t, v]) => `${t}（${v.count}回）`).join('、') || 'なし'}\n【指示】総評を書いてください：良かった点・弱点・次のおすすめを、箇条書き3つ＋ひとことで。`);
      rec.comment = out.message || '';
    } catch (e) { rec.comment = ''; }
    store.save();
    if (location.hash === '#/galdone') viewGalDone();
  }
}
async function galCallSummary(prompt) {
  const s = galData().settings;
  if (s.model === 'demo') return galDemo.summary();
  return galCall(prompt, (t) => {
    const el = document.getElementById('g-sum');
    if (el) { el.classList.remove('typing'); el.querySelector('.g-txt').textContent = t; }
  }, galDemo.summary);
}
function galRetry() {
  const L = galData().live; const c = L.cur;
  L.err = null;
  if (c.phase === 'retry-correct') {
    const q = galCurQ();
    const deep = galData().settings.deepDive && c.bi === q.blanks.length - 1;
    c.phase = 'wait';
    galAsk(`${galQuestionContext(q, c.bi, c)}

【状況】生徒は正解しました（ヒント${c.hints}回のあと）。
【指示】ほめて、なぜ正解か短く説明。${deep ? 'deep_dive に深掘り質問を1つ。' : ''}`, () => galDemo.correct(deep)).then((out) => {
      if (!out) { c.phase = 'retry-correct'; store.save(); galRender(); return; }
      galAfterCorrect(out, deep);
    });
  } else if (c.phase === 'retry-reveal') {
    c.phase = 'next'; store.save(); galRender();
  } else galRender();
}

/* ---------------- 数式キー ----------------
   紙とペンがなくても π や √3 をすぐ打てるように、入力欄の上に記号のキーを出す。 */
const GAL_KEYS = ['π', '√', '√3', '²', '×', '÷', '/', '(', ')', 'θ', '°', 'Ω', '≒', '±', 'cos', 'sin', 'tan', 'φ', 'ω', '→'];
function galKeysHTML(open) {
  return `<div class="g-keys" ${open ? '' : 'hidden'}>${GAL_KEYS.map((k) => `<button type="button" class="g-key" data-key="${esc(k)}">${esc(k)}</button>`).join('')}</div>`;
}
function galInsert(ta, str) {
  const a = ta.selectionStart ?? ta.value.length;
  const b = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, a) + str + ta.value.slice(b);
  const pos = a + str.length;
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event('input'));
}

/* ---------------- 画面 ---------------- */
/* 一覧用の短い抜粋。$...$ の途中で切ると数式が崩れるので、数式は切らない */
function galSnippet(q, n = 34) {
  const t = plainSnippet(q);
  let out = ''; let len = 0; let i = 0;
  while (i < t.length && len < n) {
    if (t[i] === '$') {
      const j = t.indexOf('$', i + 1);
      if (j < 0) break;
      out += t.slice(i, j + 1); len += 3; i = j + 1;
    } else { out += t[i]; len += 1; i += 1; }
  }
  return i < t.length ? `${out}…` : out;
}
function galScrollEnd(smooth = true) {
  window.scrollTo({ top: document.body.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}
function galScrollToLastQuestion() {
  const qs = document.querySelectorAll('.g-q');
  const el = qs[qs.length - 1];
  if (el) window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 70, behavior: 'smooth' });
}

function galQuestionCard(item, live) {
  const q = store.d.questions[item.qid];
  if (!q) return '';
  const cur = live && live.cur.qid === item.qid && live.queue[live.pos] === item.qid ? live.cur : null;
  const slot = (label) => {
    const bi = q.blanks.findIndex((b, i) => String(b.label ?? i + 1) === String(label));
    const active = cur && bi === cur.bi && cur.phase !== 'next';
    const done = cur ? bi < cur.bi || (bi === cur.bi && cur.phase === 'next') : true;
    let inner = esc(label);
    if (done && bi >= 0) inner += `<b>${choiceHTML(q.blanks[bi].choices[q.blanks[bi].answer])}</b>`;
    return `<span class="slot ${active ? 'g-active' : ''} ${done ? 'ok' : ''}">${inner}</span>`;
  };
  return `<article class="g-q">
    <div class="g-qmeta"><span class="tag">${item.n} / ${item.total}</span><span>${esc(q.subject)}${q.unit ? ` ・ ${esc(q.unit)}` : ''}</span><span>${esc(srcLabel(q))}</span></div>
    <div class="qtext">${rich(q.text, slot)}${figuresHTML(q.figures)}</div>
  </article>`;
}
function galTermsHTML(terms) {
  return `<div class="g-terms">${terms.map((t) => `<div class="g-term"><b>${inlineRich(t.symbol || '')}</b>${t.reading ? `<span class="rd">${esc(t.reading)}</span>` : ''}<span>${inlineRich(t.meaning || '')}${t.origin ? `<small>由来：${inlineRich(t.origin)}</small>` : ''}</span></div>`).join('')}</div>`;
}
function galFeedHTML(L) {
  return L.feed.map((m) => {
    if (m.k === 'q') return galQuestionCard(m, L);
    if (m.k === 'sys') return `<p class="g-sys">${inlineRich(m.text)}</p>`;
    if (m.k === 'mark') return `<p class="g-mark ${m.ok ? 'ok' : 'ng'}">${m.ok ? '○' : '×'} ${esc(m.text)}</p>`;
    if (m.k === 'u') return `<div class="g-msg u"><div class="g-bub">${inlineRich(m.text)}</div></div>`;
    const v = m.verdict ? `<span class="g-verdict ${m.verdict}">${{ correct: '○', partial: '△', wrong: '×' }[m.verdict]}</span>` : '';
    return `<div class="g-msg t"><span class="g-av" aria-hidden="true">ギャ</span><div class="g-bub">${v}${mdToHtml(m.text)}${m.model ? `<div class="g-model"><b>模範解答</b>${mdToHtml(m.model)}</div>` : ''}${m.terms ? galTermsHTML(m.terms) : ''}</div></div>`;
  }).join('');
}

function galDockHTML(L) {
  const q = galCurQ(); const c = L.cur;
  if (L.busy) return '<div class="g-dock-note">ギャル先生が考え中…</div>';
  if (L.err) {
    return `<div class="g-err">${esc(L.err.text)}</div>
      <div class="g-row">${L.err.kind === 'offline' || L.err.kind === 'nokey' ? '<a class="btn" href="#/list">ふつうのドリルへ</a>' : ''}
      <button class="btn primary" data-g="retry">もう一回</button></div>`;
  }
  const kp = c.phase === 'explain' ? L.kp !== false : !!L.kp;
  const ask = (ph) => `${galKeysHTML(kp)}<form class="g-input" data-g="form"><button type="button" class="g-kbtn" data-g="kp" aria-pressed="${kp}" aria-label="数式キー">√π</button><textarea rows="1" maxlength="400" placeholder="${ph}" aria-label="${ph}"></textarea><button class="iconbtn" aria-label="送る">${I.send}</button></form>`;
  if (c.phase === 'answer') {
    const b = q.blanks[c.bi];
    const order = c.order[c.bi];
    const long = order.some((ci) => String(b.choices[ci]).length > 14 || isSvg(b.choices[ci]));
    return `<div class="choices ${long ? '' : 'cols2'}">${order.map((ci, k) => {
      const wrong = c.wrongs.includes(ci);
      return `<button class="choice ${wrong ? 'is-wrong dim' : ''}" data-g="pick" data-k="${k}" ${wrong ? 'disabled' : ''}><span class="k">${KANA[k]}</span><span class="v">${choiceHTML(b.choices[ci])}</span>${wrong ? '<span class="mk">×</span>' : ''}</button>`;
    }).join('')}</div>${ask('先生に質問する（例：なんでこの式？）')}`;
  }
  if (c.phase === 'explain') {
    return `<p class="g-deep">${inlineRich(c.deep)}</p>${ask('自分の言葉で答えてみて')}<div class="g-row"><button class="btn" data-g="skip">スキップ</button></div>`;
  }
  if (c.phase === 'next') {
    const last = L.pos >= L.queue.length - 1;
    return `${ask('気になったことを質問する')}<div class="g-row"><button class="btn primary" data-g="next">${last ? '終わって総評を見る' : `次の問題へ ${I.next}`}</button></div>`;
  }
  return '';
}

function galRender() {
  if (location.hash !== '#/galplay') return;
  const L = galData().live;
  if (!L) { go('#/gal'); return; }
  const answered = L.items.length;
  const draft = document.querySelector('.g-input textarea');
  const keep = draft ? draft.value : '';
  app().innerHTML = `${topbar('ギャル先生', `${L.pos + 1} / ${L.queue.length}問 ・ 済 ${answered}`, '<button class="btn g-end" data-g="end">終了</button>', '#/gal')}
    <div class="g-feed">${galFeedHTML(L)}
      ${L.busy ? '<div class="g-msg t" id="g-stream"><span class="g-av" aria-hidden="true">ギャ</span><div class="g-bub typing"><span class="g-txt"></span><span class="g-dots"><i></i><i></i><i></i></span></div></div>' : ''}
    </div>
    <div class="g-dock"><div class="g-dock-in">${galDockHTML(L)}</div></div>`;
  typeset(app());
  const ta = document.querySelector('.g-input textarea');
  if (ta && keep) ta.value = keep;
  galBindDock();
  requestAnimationFrame(() => {
    const dock = document.querySelector('.g-dock');
    app().style.paddingBottom = dock ? `${dock.offsetHeight + 24}px` : '';
    galScrollEnd(false);
  });
}
function galBindDock() {
  const f = document.querySelector('[data-g="form"]');
  if (!f) return;
  const ta = f.querySelector('textarea');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; };
  ta.addEventListener('input', grow);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    const L = galData().live;
    if (L.cur.phase === 'explain') galExplain(text); else galChat(text);
  });
  document.querySelectorAll('.g-key').forEach((k) => {
    k.addEventListener('pointerdown', (e) => e.preventDefault()); // 入力欄のフォーカスを外さない
    k.addEventListener('click', () => { galInsert(ta, k.dataset.key); ta.focus({ preventScroll: true }); });
  });
  const kb = f.querySelector('[data-g="kp"]');
  kb.addEventListener('click', () => {
    const box = document.querySelector('.g-keys');
    const open = box.hidden;
    box.hidden = !open; kb.setAttribute('aria-pressed', String(open));
    galData().live.kp = open;
    const dock = document.querySelector('.g-dock');
    app().style.paddingBottom = dock ? `${dock.offsetHeight + 24}px` : '';
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); }
  });
}

/* セッション設定（#/gal） */
function viewGal() {
  const g = galData(); const st = g.settings;
  if (g.live) {
    const L = g.live;
    app().innerHTML = `${topbar('ギャル先生')}
      <div class="callout"><p>途中のセッションがあるよ（${L.pos + 1} / ${L.queue.length}問）。</p>
      <div class="g-row"><a class="btn primary" href="#/galplay">続きから</a><button class="btn" data-g="discard">終わりにする</button></div></div>`;
    $('[data-g="discard"]').addEventListener('click', () => { galFinish(true); });
    return;
  }
  const all = galCandidates('all');
  const subs = subjectsPresent(all);
  const subject = st.subject !== 'all' && !subs.includes(st.subject) ? 'all' : st.subject;
  const n = galCandidates(subject).length;
  const tags = topWeakTags(6);
  const last = g.history[0];
  app().innerHTML = `${topbar('ギャル先生', 'AI と一問一答で理解を確かめる')}
    ${!all.length ? `<div class="callout"><p>まだ問題がないよ。問題ファイル（.json）を取り込むと始められるよ。</p><a class="btn primary block" href="#/settings">${I.upload}問題を取り込む</a></div>` : ''}
    ${!galReady() ? `<div class="callout"><p>ギャル先生を呼ぶには Anthropic の API キーが必要だよ。設定で入れるか、まずはモデルを「デモ」にして画面だけ試してみてね。</p><a class="btn primary block" href="#/settings?gal">${I.gear}API キーを設定する</a></div>` : ''}
    <section class="section">
      <h2>範囲</h2>
      <div class="chips">${[['all', 'すべて', all.length]].concat(subs.map((s) => [s, s, galCandidates(s).length])).map(([v, label, k]) =>
        `<button class="chip" data-g="subj" data-v="${esc(v)}" aria-pressed="${v === subject}">${esc(label)}<small>${k}</small></button>`).join('')}</div>
      <h2>出し方</h2>
      <div class="modesw g-3">${[['weak', '弱点優先', 'ミス→未出題→その他'], ['random', 'ランダム', ''], ['seq', '順番', '一覧の順']].map(([v, l, s]) =>
        `<button data-g="order" data-v="${v}" aria-pressed="${st.order === v}">${l}${s ? `<small>${s}</small>` : ''}</button>`).join('')}</div>
      <h2>問題数</h2>
      <div class="modesw g-4">${[3, 5, 10, 20].map((k) => `<button data-g="count" data-v="${k}" aria-pressed="${st.count === k}">${k}問</button>`).join('')}</div>
      <label class="g-check"><input type="checkbox" data-g="deep" ${st.deepDive ? 'checked' : ''}> 正解したら「なんで？」の深掘り質問をする</label>
      <button class="btn primary block" data-g="start" ${n && galReady() ? '' : 'disabled'}>${I.chat}始める（最大 ${Math.min(st.count, n)}問）</button>
      <p class="g-note">モデル：${esc((GAL_MODELS.find(([v]) => v === st.model) || [st.model, st.model])[1])}　<a href="#/settings?gal">変更</a></p>
    </section>
    ${tags.length ? `<section class="section"><h2>最近の弱点タグ</h2><div class="g-tags">${tags.map(([t, v]) => `<span class="g-tag">${esc(t)}<small>${v.count}</small></span>`).join('')}</div></section>` : ''}
    ${last ? `<section class="section"><h2>前回の結果</h2>${galResultTable(last)}<a class="btn block" href="#/galdone">総評を見る</a></section>` : ''}`;
  app().querySelectorAll('[data-g="subj"]').forEach((b) => b.addEventListener('click', () => { st.subject = b.dataset.v; store.save(); viewGal(); }));
  app().querySelectorAll('[data-g="order"]').forEach((b) => b.addEventListener('click', () => { st.order = b.dataset.v; store.save(); viewGal(); }));
  app().querySelectorAll('[data-g="count"]').forEach((b) => b.addEventListener('click', () => { st.count = Number(b.dataset.v); store.save(); viewGal(); }));
  $('[data-g="deep"]').addEventListener('change', (e) => { st.deepDive = e.target.checked; store.save(); });
  $('[data-g="start"]').addEventListener('click', () => { st.subject = subject; galStart(); });
  typeset(app());
}

function galResultTable(rec) {
  return `<table class="g-res"><tbody>${rec.items.map((it, i) => {
    const q = store.d.questions[it.qid];
    return `<tr><td class="r ${it.result}">${GAL_RESULT[it.result]}</td><td>${i + 1}. ${esc(q ? srcLabel(q) : it.qid)}<small>${esc(q ? galSnippet(q) : '')}</small>${it.tags.length ? `<span class="g-tags">${it.tags.map((t) => `<span class="g-tag">${esc(t)}</span>`).join('')}</span>` : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function viewGalPlay() {
  const L = galData().live;
  if (!L) { go('#/gal'); return; }
  if (L.busy) L.busy = false; // 再読み込みで止まった呼び出しは捨てる
  if (L.cur.phase === 'wait') { L.cur.phase = 'answer'; }
  galRender();
}

function viewGalDone() {
  const g = galData();
  const rec = g.history[0];
  if (!rec) { go('#/gal'); return; }
  const n = rec.items.length;
  const first = rec.items.filter((i) => i.result === 'first').length;
  const hinted = rec.items.filter((i) => i.result === 'hinted').length;
  const tags = [...new Set(rec.items.flatMap((i) => i.tags))];
  app().innerHTML = `${topbar('ギャル先生 ・ 総評', '', '', '#/gal')}
    <section class="stats"><div class="stat"><b>${first}</b><span>一発正解 ○</span></div><div class="stat"><b>${hinted}</b><span>ヒントで正解 △</span></div><div class="stat"><b>${n - first - hinted}</b><span>答えを見た ×</span></div></section>
    ${n ? '' : '<p class="lead">回答した問題はありませんでした。</p>'}
    ${rec.comment ? `<div class="g-msg t"><span class="g-av" aria-hidden="true">ギャ</span><div class="g-bub">${mdToHtml(rec.comment)}</div></div>`
      : n && galReady() ? '<div class="g-msg t" id="g-sum"><span class="g-av" aria-hidden="true">ギャ</span><div class="g-bub typing"><span class="g-txt"></span><span class="g-dots"><i></i><i></i><i></i></span></div></div>' : ''}
    ${n ? `<section class="section"><h2>問題ごとの結果</h2>${galResultTable(rec)}</section>` : ''}
    ${tags.length ? `<section class="section"><h2>今回の弱点タグ</h2><div class="g-tags">${tags.map((t) => `<span class="g-tag">${esc(t)}</span>`).join('')}</div></section>` : ''}
    <p class="g-note">AI 呼び出し ${rec.calls}回 ・ トークン 入力 ${rec.usage.in.toLocaleString()} ／ 出力 ${rec.usage.out.toLocaleString()} ・ 今月の料金の目安 ${usd(galSpent())}</p>
    <div class="done"><div class="btns"><a class="btn primary" href="#/gal">${I.chat}もう1セット</a><a class="btn" href="#/">ホーム</a></div></div>`;
  typeset(app());
}

/* 設定画面のセクション（app.js の viewSettings から呼ぶ） */
function galSettingsHTML() {
  const st = galData().settings;
  const key = galKey();
  return `<section class="section" id="gal">
    <h2>ギャル先生（AI）</h2>
    <p>Anthropic の API キーを入れると、ギャル先生と一問一答できます。キーはこの端末のブラウザにだけ保存され、バックアップの書き出しには含まれません。料金はキーの持ち主（あなた）の Anthropic アカウントにかかります。料金の目安はアプリでの概算で、上限に達すると AI を呼ばなくなります（0 で上限なし）。</p>
    <label class="g-field"><span>API キー</span>
      <input type="password" autocomplete="off" spellcheck="false" data-g="key" placeholder="${key ? `設定済み（…${esc(key.slice(-4))}）` : 'sk-ant-…'}"></label>
    <label class="g-field"><span>モデル</span>
      <select data-g="model">${GAL_MODELS.map(([v, l]) => `<option value="${v}" ${st.model === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="g-field"><span>月の料金の上限（USD・目安）<small>今月の目安 ${usd(galSpent())}</small></span>
      <input type="number" min="0" max="1000" step="1" inputmode="decimal" data-g="budget" value="${st.budget}"></label>
    <label class="g-field"><span>1セッションの AI 呼び出し上限</span>
      <input type="number" min="5" max="500" step="5" inputmode="numeric" data-g="max" value="${st.maxCalls}"></label>
    <div class="row">
      <button class="btn primary" data-g="save">保存</button>
      <button class="btn" data-g="test">接続テスト</button>
      <button class="btn danger" data-g="delkey" ${key ? '' : 'disabled'}>キーを削除</button>
    </div>
  </section>`;
}
function galBindSettings() {
  const st = galData().settings;
  const keyIn = $('[data-g="key"]');
  if (!keyIn) return;
  const saveAll = () => {
    const v = keyIn.value.trim();
    if (v) { try { localStorage.setItem(GAL_SECRET, v); } catch (e) { toast('キーを保存できませんでした'); return false; } keyIn.value = ''; }
    st.model = $('[data-g="model"]').value;
    st.maxCalls = Math.max(5, Math.min(500, Number($('[data-g="max"]').value) || 60));
    const bud = Number($('[data-g="budget"]').value);
    st.budget = Number.isFinite(bud) && bud >= 0 ? Math.min(bud, 1000) : 20;
    store.save();
    return true;
  };
  $('[data-g="save"]').addEventListener('click', () => { if (saveAll()) { toast('ギャル先生の設定を保存しました'); viewSettings(); requestAnimationFrame(() => document.getElementById('gal')?.scrollIntoView()); } });
  $('[data-g="test"]').addEventListener('click', async (e) => {
    if (!saveAll()) return;
    const b = e.currentTarget; b.disabled = true; b.textContent = '確認中…';
    try { toast(await galPing()); } catch (err) { toast(err.kind === 'auth' ? 'API キーが正しくないみたい' : `接続できませんでした（${err.message}）`); }
    b.disabled = false; b.textContent = '接続テスト';
  });
  $('[data-g="delkey"]').addEventListener('click', () => {
    if (!confirm('この端末から API キーを削除します。よろしいですか？')) return;
    try { localStorage.removeItem(GAL_SECRET); } catch (e) { /* noop */ }
    toast('API キーを削除しました'); viewSettings();
  });
}

/* ---------------- イベント・ルート ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-g]');
  if (!el || location.hash !== '#/galplay') return;
  const a = el.dataset.g;
  if (a === 'pick') galPick(Number(el.dataset.k));
  else if (a === 'next') galNextQuestion();
  else if (a === 'skip') galSkipExplain();
  else if (a === 'retry') galRetry();
  else if (a === 'end') {
    const L = galData().live;
    if (L && !L.busy && confirm('ここで終わって総評を見る？')) galFinish(true);
  }
});

routes.gal = viewGal;
routes.galplay = viewGalPlay;
routes.galdone = viewGalDone;

/* ホームのメニューに出す一言 */
function galHomeSub() {
  const g = galData();
  if (g.live) return `続きから（${g.live.pos + 1} / ${g.live.queue.length}問）`;
  if (!galReady()) return 'API キーを入れると使える（デモもあるよ）';
  const n = Object.keys(g.qstat).filter(galWeak).length;
  return n ? `弱点 ${n}問 ・ 一問一答で理解を確かめる` : 'AI と一問一答で理解を確かめる';
}
