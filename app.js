'use strict';

/* =========================================================
   電験三種 短答ドリル
   データはすべて端末のブラウザ (localStorage) に保存する。
   ========================================================= */

const APP_VERSION = '1.5.1';
const KEY = 'denken3-drill:v1';
const SUBJECTS = ['理論', '電力', '機械', '法規'];
const KANA = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ'];
const CLEAR_STREAK = 2; // 苦手克服から外れるのに必要な連続正解数

/* ---------------- icons ---------------- */
const I = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/></svg>',
  resume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5.5v13l10-6.5z"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h4v4M4 20l16-16M20 16v4h-4M15 15l5 5M4 4l5 5"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7 9l5-5 5 5M5 20h14"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};

/* ---------------- storage ---------------- */
const store = {
  d: null,
  load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { raw = null; }
    this.d = normalize(raw);
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.d)); return true; }
    catch (e) { toast('保存できませんでした（端末の空き容量を確認してください）'); return false; }
  },
};
function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    v: 1,
    questions: d.questions && typeof d.questions === 'object' ? d.questions : {},
    progress: d.progress && typeof d.progress === 'object' ? d.progress : {},
    bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks : [],
    session: d.session || null,
    lastSession: d.lastSession || null,
    ui: Object.assign({ subject: 'all', mode: 'output' }, d.ui || {}), // mode: output（演習）/ input（暗記）
  };
}

/* ---------------- helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const app = () => document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function subjectRank(s) { const i = SUBJECTS.indexOf(s); return i < 0 ? 99 : i; }
function compareQ(a, b) {
  return subjectRank(a.subject) - subjectRank(b.subject)
    || String(a.subject).localeCompare(String(b.subject), 'ja')
    || (a.order ?? 1e9) - (b.order ?? 1e9)
    || String(a.id).localeCompare(String(b.id), 'ja', { numeric: true });
}
function allQ(subject = 'all') {
  return Object.values(store.d.questions)
    .filter((q) => subject === 'all' || q.subject === subject)
    .sort(compareQ);
}
const prog = (id) => store.d.progress[id] || null;
const isWeak = (id) => !!(store.d.progress[id] && store.d.progress[id].weak);
const isBm = (id) => store.d.bookmarks.includes(id);
function weakQ(subject = 'all') { return allQ(subject).filter((q) => isWeak(q.id)); }
function bmQ(subject = 'all') { return allQ(subject).filter((q) => isBm(q.id)); }
function subjectsPresent(list) {
  const set = new Set(list.map((q) => q.subject));
  return [...set].sort((a, b) => subjectRank(a) - subjectRank(b) || a.localeCompare(b, 'ja'));
}

/* 文章 → HTML（$...$ は KaTeX に任せる / {{n}} は空欄） */
function rich(str, slotFn) {
  let html = esc(str);
  if (slotFn) html = html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => slotFn(k));
  return html.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}
function inlineRich(str) { return esc(str).replace(/\n/g, '<br>'); }
function plainSnippet(q) {
  return q.text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, '［$1］').replace(/\n+/g, ' ');
}
function typeset(root) {
  if (!window.renderMathInElement) return;
  try {
    window.renderMathInElement(root, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      throwOnError: false,
      strict: 'ignore',
    });
  } catch (e) { /* 数式の表示に失敗しても本文は読めるようにする */ }
}

/* ---------------- figures (SVG) ----------------
   問題データの図は SVG 文字列で受け取り、危険な要素・属性を取り除いてから表示する。 */
const SVG_BLOCK = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'style',
  'animate', 'set', 'animatemotion', 'animatetransform', 'handler', 'listener']);
const svgCache = new Map();
const isSvg = (s) => typeof s === 'string' && /^\s*<svg[\s>]/i.test(s);
function sanitizeSvg(src) {
  if (svgCache.has(src)) return svgCache.get(src);
  let out = '';
  try {
    const doc = new DOMParser().parseFromString(String(src), 'image/svg+xml');
    const root = doc.documentElement;
    if (root && root.nodeName.toLowerCase() === 'svg' && !doc.getElementsByTagName('parsererror').length) {
      const walk = (el) => {
        for (const ch of [...el.children]) {
          if (SVG_BLOCK.has(ch.nodeName.toLowerCase())) { ch.remove(); continue; }
          walk(ch);
        }
        for (const a of [...el.attributes]) {
          const n = a.name.toLowerCase();
          const v = a.value.trim().toLowerCase();
          if (n.startsWith('on')) el.removeAttribute(a.name);
          else if ((n === 'href' || n.endsWith(':href')) && !(v.startsWith('#') || v.startsWith('data:image/png') || v.startsWith('data:image/jpeg'))) el.removeAttribute(a.name);
          else if (/url\s*\(\s*['"]?(?!#)|javascript:|expression\s*\(/.test(v)) el.removeAttribute(a.name);
        }
      };
      walk(root);
      const w = parseFloat(root.getAttribute('width'));
      const h = parseFloat(root.getAttribute('height'));
      if (!root.getAttribute('viewBox') && w && h) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
      root.removeAttribute('width');
      root.removeAttribute('height');
      root.setAttribute('class', `fig-svg ${root.getAttribute('class') || ''}`.trim());
      root.setAttribute('role', 'img');
      out = new XMLSerializer().serializeToString(root);
    }
  } catch (e) { out = ''; }
  svgCache.set(src, out);
  return out;
}
function normFigures(v) {
  if (!v) return [];
  const list = Array.isArray(v) ? v : [v];
  return list.map((f) => (typeof f === 'string' ? { svg: f } : f))
    .filter((f) => f && isSvg(f.svg))
    .map((f) => ({ svg: String(f.svg), caption: f.caption ? String(f.caption) : undefined }));
}
function figuresHTML(list) {
  return normFigures(list).map((f) => {
    const svg = sanitizeSvg(f.svg);
    if (!svg) return '';
    return `<figure class="figure" data-act="zoom" tabindex="0" aria-label="図（タップで拡大）">${svg}${f.caption ? `<figcaption>${inlineRich(f.caption)}</figcaption>` : ''}</figure>`;
  }).join('');
}
function choiceHTML(s) {
  return isSvg(s) ? `<span class="choice-fig">${sanitizeSvg(s)}</span>` : inlineRich(s);
}
function openZoom(fig) {
  const svg = fig.querySelector('svg');
  if (!svg) return;
  const ov = document.createElement('div');
  ov.className = 'zoom-ov';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', '図の拡大表示（タップで閉じる）');
  ov.innerHTML = `<div class="zoom-inner">${svg.outerHTML}</div><p class="zoom-hint">タップで閉じる ・ 2本指で拡大</p>`;
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
}

let toastTimer = 0;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function topbar(title, sub = '', right = '', backHref = '#/') {
  return `<header class="topbar">
    <a class="iconbtn" href="${backHref}" aria-label="戻る">${I.back}</a>
    <h1>${esc(title)}${sub ? `<small>${sub}</small>` : ''}</h1>
    ${right}
  </header>`;
}
function starBtn(id) {
  const on = isBm(id);
  return `<button class="iconbtn star ${on ? 'on' : ''}" data-act="bm" data-id="${esc(id)}" aria-pressed="${on}" aria-label="ブックマーク">${I.star}</button>`;
}
function toggleBookmark(id) {
  const b = store.d.bookmarks;
  const i = b.indexOf(id);
  if (i >= 0) b.splice(i, 1); else b.push(id);
  store.save();
  const on = i < 0;
  document.querySelectorAll(`[data-act="bm"][data-id="${CSS.escape(id)}"]`).forEach((el) => {
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
    const lab = el.querySelector('.lab');
    if (lab) lab.textContent = on ? 'ブックマーク済み' : 'ブックマーク';
  });
  toast(on ? 'ブックマークに追加しました' : 'ブックマークを外しました');
}

function chipsHTML(list, selected) {
  const subs = subjectsPresent(list);
  const chips = [['all', 'すべて', list.length]].concat(subs.map((s) => [s, s, list.filter((q) => q.subject === s).length]));
  return `<div class="chips" role="group" aria-label="科目で絞り込み">${chips.map(([v, label, n]) =>
    `<button class="chip" data-act="subject" data-v="${esc(v)}" aria-pressed="${v === selected}">${esc(label)}<small>${n}</small></button>`).join('')}</div>`;
}
function currentSubject(list) {
  const s = store.d.ui.subject;
  if (s !== 'all' && !list.some((q) => q.subject === s)) return 'all';
  return s;
}

function statusOf(id) {
  const p = prog(id);
  if (!p) return ['', '–'];
  return p.last === 'ok' ? ['ok', '○'] : ['ng', '×'];
}
function rowsHTML(list, { grouped = true } = {}) {
  let html = '';
  let curGroup = null;
  let open = false;
  for (const q of list) {
    const g = `${q.subject} ・ ${q.unit || 'その他'}`;
    if (grouped && g !== curGroup) {
      if (open) html += '</ul>';
      html += `<h2 class="group-h">${esc(g)}</h2><ul class="qlist">`;
      curGroup = g; open = true;
    } else if (!grouped && !open) { html += '<ul class="qlist">'; open = true; }
    const [cls, mark] = statusOf(q.id);
    html += `<li><button class="qrow" data-act="open" data-id="${esc(q.id)}">
      <span class="st ${cls}" aria-hidden="true">${mark}</span>
      <span class="body">
        <span class="src">${esc(q.source || q.id)}${isWeak(q.id) ? '<span class="weak">苦手</span>' : ''}</span>
        <span class="snip">${esc(plainSnippet(q))}</span>
      </span>
      ${isBm(q.id) ? `<span class="bm" aria-label="ブックマーク済み">${I.star}</span>` : ''}
    </button></li>`;
  }
  if (open) html += '</ul>';
  return html;
}

/* ---------------- sessions ---------------- */
const MODE_TITLE = { list: '問題一覧', weak: '苦手克服', bookmark: 'ブックマーク', random: 'ランダム演習' };

function startSession(mode, ids, pos = 0, subject = 'all') {
  if (!ids.length) { toast('出題できる問題がありません'); return; }
  store.d.session = {
    mode, subject, title: MODE_TITLE[mode] || '演習',
    queue: ids, pos, endless: mode === 'random', cur: null,
    stats: { n: 0, ok: 0 }, startedAt: Date.now(),
  };
  store.save();
  go('#/play');
}
function randomQueue(subject, avoidFirst) {
  const ids = allQ(subject).map((q) => q.id);
  let q = shuffle(ids);
  if (q.length > 1 && q[0] === avoidFirst) { [q[0], q[1]] = [q[1], q[0]]; }
  return q;
}

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

/* ---------------- views ---------------- */
function viewHome() {
  const qs = allQ();
  const answered = qs.filter((q) => prog(q.id));
  const lastOk = answered.filter((q) => prog(q.id).last === 'ok').length;
  const weakN = weakQ().length;
  const bmN = bmQ().length;
  const s = store.d.session;
  let resumeSub = 'まだ記録がありません';
  let resumeOn = false;
  if (s && s.queue && s.queue.length) {
    const q = store.d.questions[s.queue[s.pos]];
    resumeOn = true;
    resumeSub = `${esc(s.title)}${s.endless ? '' : `（${s.pos + 1}/${s.queue.length}）`}${q ? ` ・ ${esc(q.source || q.id)}` : ''}`;
  }
  app().innerHTML = `
    <header class="brand">
      <div class="brand-text">
        <div class="kicker">電験三種 ・ 短答式</div>
        <h1>短答ドリル</h1>
      </div>
      <a class="iconbtn" href="#/settings" aria-label="設定と問題の取り込み">${I.gear}</a>
    </header>
    <section class="stats" aria-label="学習状況">
      <div class="stat"><b>${qs.length}</b><span>収録問題</span></div>
      <div class="stat"><b>${answered.length}</b><span>回答済み</span></div>
      <div class="stat"><b>${answered.length ? pct(lastOk, answered.length) + '<small style="font-size:13px">%</small>' : '–'}</b><span>直近の正答率</span></div>
    </section>
    ${qs.length ? '' : `<div class="callout"><p>まだ問題がありません。Claude が作った問題ファイル（.json）を取り込むと演習を始められます。</p>
      <a class="btn primary block" href="#/settings">${I.upload}問題を取り込む</a></div>`}
    <nav class="menu">
      <a class="menu-item ${resumeOn ? 'primary' : ''}" href="#/resume" aria-disabled="${!resumeOn}">
        <span class="ic">${I.resume}</span><span class="tx"><b>続きから</b><span>${resumeSub}</span></span></a>
      <a class="menu-item" href="#/list" aria-disabled="${!qs.length}">
        <span class="ic">${I.list}</span><span class="tx"><b>問題一覧</b><span>科目・単元ごとに選んで解く</span></span>
        <span class="badge">${qs.length}</span></a>
      <a class="menu-item" href="#/weak" aria-disabled="${!qs.length}">
        <span class="ic">${I.target}</span><span class="tx"><b>苦手克服</b><span>間違えた問題（${CLEAR_STREAK}回連続正解で卒業）</span></span>
        <span class="badge ${weakN ? 'ng' : ''}">${weakN}</span></a>
      <a class="menu-item" href="#/bookmarks" aria-disabled="${!qs.length}">
        <span class="ic">${I.star}</span><span class="tx"><b>ブックマーク</b><span>あとで見返したい問題</span></span>
        <span class="badge">${bmN}</span></a>
      <a class="menu-item" href="#/random" aria-disabled="${!qs.length}">
        <span class="ic">${I.shuffle}</span><span class="tx"><b>ランダム演習</b><span>区切りなく次々に出題</span></span></a>
    </nav>
    ${installHTML()}
  `;
}

let deferredInstall = null;
function installHTML() {
  if (!deferredInstall) return '';
  return `<div style="margin-top:16px"><button class="btn block" data-act="install">ホーム画面にアプリとして追加</button></div>`;
}

function viewList() {
  const all = allQ();
  const sub = currentSubject(all);
  const list = allQ(sub);
  app().innerHTML = `${topbar('問題一覧', `${list.length}問`)}
    ${chipsHTML(all, sub)}
    <p class="lead">タップした問題から、この並び順で出題します。</p>
    ${list.length ? rowsHTML(list) : `<div class="empty">問題がありません</div>`}`;
  bindRows((id) => {
    const ids = list.map((q) => q.id);
    startSession('list', ids, Math.max(0, ids.indexOf(id)), sub);
  });
}

function viewCollection(kind) {
  const isWeakView = kind === 'weak';
  const base = isWeakView ? weakQ() : bmQ();
  const sub = currentSubject(base);
  const list = isWeakView ? weakQ(sub) : bmQ(sub);
  const title = isWeakView ? '苦手克服' : 'ブックマーク';
  const mode = isWeakView ? 'weak' : 'bookmark';
  const emptyMsg = isWeakView
    ? `${I.target}<p>苦手な問題はありません。<br>間違えた問題はここに集まり、${CLEAR_STREAK}回連続で正解すると外れます。</p>`
    : `${I.star}<p>ブックマークした問題はありません。<br>問題画面・解説画面の ☆ から追加できます。</p>`;
  app().innerHTML = `${topbar(title, `${list.length}問`)}
    ${base.length ? chipsHTML(base, sub) : ''}
    ${list.length ? `
      <button class="btn primary block" data-act="start">${I.resume}${list.length}問を解く</button>
      <div style="height:8px"></div>
      ${rowsHTML(list)}` : `<div class="empty">${emptyMsg}</div>`}`;
  const ids = list.map((q) => q.id);
  $('[data-act="start"]')?.addEventListener('click', () => startSession(mode, ids, 0, sub));
  bindRows((id) => startSession(mode, ids, Math.max(0, ids.indexOf(id)), sub));
}

function viewRandom() {
  const all = allQ();
  const sub = currentSubject(all);
  const n = allQ(sub).length;
  app().innerHTML = `${topbar('ランダム演習')}
    <p class="lead">選んだ範囲からランダムに出題します。全問を一巡すると並びを変えてまた最初から。好きなところでやめられます。</p>
    ${chipsHTML(all, sub)}
    <button class="btn primary block" data-act="start" ${n ? '' : 'disabled'}>${I.shuffle}${sub === 'all' ? '全科目' : esc(sub)}（${n}問）で始める</button>`;
  $('[data-act="start"]').addEventListener('click', () => startSession('random', randomQueue(sub), 0, sub));
}

function bindRows(onOpen) {
  typeset(app());
  app().querySelectorAll('[data-act="open"]').forEach((el) => el.addEventListener('click', () => onOpen(el.dataset.id)));
}

/* ---------- play ---------- */
function ensureCur(s) {
  // 削除された問題はとばす
  let guard = 0;
  while (s.pos < s.queue.length && !store.d.questions[s.queue[s.pos]] && guard++ < 10000) s.pos++;
  if (s.pos >= s.queue.length) return null;
  const id = s.queue[s.pos];
  const q = store.d.questions[id];
  if (!s.cur || s.cur.id !== id || !Array.isArray(s.cur.picks) || s.cur.picks.length !== q.blanks.length) {
    s.cur = {
      id,
      orders: q.blanks.map((b) => shuffle(b.choices.map((_, i) => i))),
      picks: q.blanks.map(() => null),
      graded: false,
    };
    store.save();
  }
  return q;
}

function viewPlay() {
  const s = store.d.session;
  if (!s) { go('#/'); return; }
  const q = ensureCur(s);
  if (!q) { finishSession(); return; }
  const c = s.cur;
  const multi = q.blanks.length > 1;
  const labels = q.blanks.map((b, i) => (b.label != null ? String(b.label) : String(i + 1)));
  const inText = new Set();
  const textHTML = rich(q.text, (k) => {
    const bi = labels.indexOf(k);
    inText.add(k);
    if (c.graded && bi >= 0) {
      const b = q.blanks[bi];
      const ans = b.choices[b.answer];
      return `<span class="slot ${c.results[bi] ? 'ok' : 'ng'}">${esc(k)}<b>${isSvg(ans) ? '（図）' : esc(ans)}</b></span>`;
    }
    return `<span class="slot">${esc(k)}</span>`;
  });

  const counter = s.endless
    ? `${(s.count || 0) + 1}問目 ・ 正解 ${s.stats.ok}`
    : `${s.pos + 1} / ${s.queue.length}`;
  if (store.d.ui.mode === 'input') { viewInput(s, q, counter); return; }

  const blanksHTML = q.blanks.map((b, bi) => {
    const order = c.orders[bi];
    const longest = Math.max(...b.choices.map((t) => t.length));
    const cols2 = !b.choices.some((t) => t.includes('$') || isSvg(t)) && ((b.choices.length === 4 && longest <= 6) || (b.choices.length === 2 && longest <= 12));
    let head = '';
    if (multi || b.prompt) {
      const lab = labels[bi];
      const showLab = multi && inText.has(lab);
      const res = c.graded ? `<span class="res ${c.results[bi] ? 'ok' : 'ng'}">${c.results[bi] ? '○ 正解' : '× 不正解'}</span>` : '';
      // 文中に空欄がある → ラベル表示（補足があれば下に）／ 文中にない → 設問文を見出しに
      const title = (showLab || !b.prompt) ? `<span class="lbl">${esc(lab)}</span>` : `<span>${inlineRich(b.prompt)}</span>`;
      head = `<div class="blank-h">${title}${res}</div>
        ${showLab && b.prompt ? `<p class="prompt">${inlineRich(b.prompt)}</p>` : ''}`;
    }
    const btns = order.map((ci, pos) => {
      let cls = 'choice';
      let mk = '';
      if (c.graded) {
        if (ci === b.answer) { cls += ' is-answer'; mk = '○'; }
        else if (ci === c.picks[bi]) { cls += ' is-wrong'; mk = '×'; }
        else cls += ' dim';
      } else if (c.picks[bi] === ci) cls += ' sel';
      return `<button class="${cls}" data-act="pick" data-b="${bi}" data-c="${ci}" ${c.graded ? 'disabled' : ''} aria-pressed="${c.picks[bi] === ci}">
        <span class="k">${KANA[pos]}</span><span class="v">${choiceHTML(b.choices[ci])}</span><span class="mk">${mk}</span></button>`;
    }).join('');
    return `<section class="blank" aria-label="${multi ? `空欄 ${esc(labels[bi])}` : '選択肢'}">${head}<div class="choices ${cols2 ? 'cols2' : ''}">${btns}</div></section>`;
  }).join('');

  let resultHTML = '';
  if (c.graded) {
    const okN = c.results.filter(Boolean).length;
    const all = okN === c.results.length;
    resultHTML = `<div class="result ${all ? 'ok' : 'ng'}" id="result">
        <span class="big">${all ? '○' : '×'}</span>
        <div><b>${all ? '正解' : '不正解'}${multi ? `（${okN}/${c.results.length}）` : ''}</b><span>${esc(c.note || '')}</span></div>
      </div>
      <section class="explain" aria-label="解説">
        <h2>解説 ${bmLineBtn(q.id)}</h2>
        ${q.explanation ? rich(q.explanation) : '<p>解説はありません。</p>'}
        ${figuresHTML(q.explanationFigures)}
      </section>`;
  }

  const allPicked = c.picks.every((p) => p !== null);
  let action = '';
  if (c.graded) {
    const isLast = !s.endless && s.pos + 1 >= s.queue.length;
    action = `<button class="btn primary" data-act="next">${isLast ? '結果を見る' : '次の問題'}${I.next}</button>`;
  } else if (multi) {
    action = `<button class="btn primary" data-act="grade" ${allPicked ? '' : 'disabled'}>${allPicked ? '採点する' : `あと${c.picks.filter((p) => p === null).length}か所 選んでください`}</button>`;
  }

  app().innerHTML = `${topbar(s.title, counter, starBtn(q.id))}
    ${modeSwitchHTML()}
    <div class="meta">
      <span class="tag">${esc(q.subject)}</span>
      ${q.unit ? `<span>${esc(q.unit)}</span>` : ''}
      <span>${esc(q.source || q.id)}</span>
      ${isWeak(q.id) ? '<span class="tag weak">苦手</span>' : ''}
    </div>
    <article class="qtext">${textHTML}${figuresHTML(q.figures)}</article>
    ${blanksHTML}
    ${resultHTML}
    <div class="actionbar"><div class="inner">${prevBtnHTML(s)}${action || '<span class="grow"></span>'}</div></div>`;
  typeset(app());

  app().querySelectorAll('[data-act="pick"]').forEach((el) => el.addEventListener('click', () => {
    const bi = +el.dataset.b; const ci = +el.dataset.c;
    if (c.graded) return;
    c.picks[bi] = ci;
    store.save();
    if (!multi) { grade(q); return; }
    const y = window.scrollY;
    viewPlay();
    window.scrollTo(0, y);
  }));
  $('[data-act="grade"]')?.addEventListener('click', () => grade(q));
  $('[data-act="next"]')?.addEventListener('click', nextQuestion);
}

/* ---------- インプット（暗記）モード ----------
   赤シートのように空欄を隠し、タップでその空欄の答えを表示／もう一度タップで隠す。
   正誤は記録しない。問題・答え・解説を1画面にまとめる。 */
function modeSwitchHTML() {
  const m = store.d.ui.mode === 'input' ? 'input' : 'output';
  return `<div class="modesw" role="group" aria-label="モード切り替え">
    <button data-act="mode" data-v="output" aria-pressed="${m === 'output'}">アウトプット<small>解いて採点</small></button>
    <button data-act="mode" data-v="input" aria-pressed="${m === 'input'}">インプット<small>隠して暗記</small></button>
  </div>`;
}
function maskHTML(bi, label, ans, shown) {
  return `<button class="mask ${shown ? 'shown' : ''}" data-act="reveal" data-b="${bi}" aria-pressed="${shown}" aria-label="空欄 ${esc(label)} の答え">`
    + `<span class="ml">${esc(label)}</span><span class="ma">${choiceHTML(ans)}</span></button>`;
}
function viewInput(s, q, counter) {
  const c = s.cur;
  const labels = q.blanks.map((b, i) => (b.label != null ? String(b.label) : String(i + 1)));
  if (!Array.isArray(c.shown) || c.shown.length !== q.blanks.length) c.shown = q.blanks.map(() => false);
  const ansOf = (bi) => q.blanks[bi].choices[q.blanks[bi].answer];
  const inText = new Set();
  const textHTML = rich(q.text, (k) => {
    const bi = labels.indexOf(k);
    if (bi < 0) return `<span class="slot">${esc(k)}</span>`;
    inText.add(bi);
    return maskHTML(bi, k, ansOf(bi), c.shown[bi]);
  });
  // 文中に空欄がない解答欄は、問題の下に答えの欄を置く
  const rest = q.blanks.map((b, bi) => bi).filter((bi) => !inText.has(bi));
  const single = rest.length === 1 && q.blanks.length === 1;
  const restHTML = rest.length ? `<section class="answers" aria-label="答え">${rest.map((bi) => {
    const b = q.blanks[bi];
    const head = b.prompt ? inlineRich(b.prompt) : (single ? '答え' : `解答欄 ${esc(labels[bi])}`);
    return `<div class="ans-row"><div class="ans-h">${head}</div>${maskHTML(bi, single ? '答え' : labels[bi], ansOf(bi), c.shown[bi])}</div>`;
  }).join('')}</section>` : '';
  const multi = q.blanks.length > 1;
  const allShown = c.shown.every(Boolean);
  const isLast = !s.endless && s.pos + 1 >= s.queue.length;
  app().innerHTML = `${topbar(s.title, counter, starBtn(q.id))}
    ${modeSwitchHTML()}
    <div class="meta">
      <span class="tag">${esc(q.subject)}</span>
      ${q.unit ? `<span>${esc(q.unit)}</span>` : ''}
      <span>${esc(q.source || q.id)}</span>
      ${isWeak(q.id) ? '<span class="tag weak">苦手</span>' : ''}
    </div>
    <article class="qtext input">${textHTML}${figuresHTML(q.figures)}</article>
    ${restHTML}
    <section class="explain" aria-label="解説">
      <h2>解説 ${bmLineBtn(q.id)}</h2>
      ${q.explanation ? rich(q.explanation) : '<p>解説はありません。</p>'}
      ${figuresHTML(q.explanationFigures)}
    </section>
    <div class="actionbar"><div class="inner">
      ${prevBtnHTML(s)}
      ${multi ? `<button class="btn" data-act="reveal-all">${allShown ? 'すべて隠す' : 'すべて表示'}</button>` : ''}
      <button class="btn primary" data-act="next">${isLast ? '終わる' : '次へ'}${I.next}</button>
    </div></div>`;
  typeset(app());
  const sync = () => {
    app().querySelectorAll('[data-act="reveal"]').forEach((el) => {
      const on = !!c.shown[+el.dataset.b];
      el.classList.toggle('shown', on);
      el.setAttribute('aria-pressed', String(on));
    });
    const all = $('[data-act="reveal-all"]');
    if (all) all.textContent = c.shown.every(Boolean) ? 'すべて隠す' : 'すべて表示';
    store.save();
  };
  app().querySelectorAll('[data-act="reveal"]').forEach((el) => el.addEventListener('click', () => {
    const bi = +el.dataset.b;
    c.shown[bi] = !c.shown[bi];
    sync();
  }));
  $('[data-act="reveal-all"]')?.addEventListener('click', () => {
    const v = !c.shown.every(Boolean);
    c.shown = c.shown.map(() => v);
    sync();
  });
  $('[data-act="next"]').addEventListener('click', nextQuestion);
}
function prevBtnHTML(s) {
  return `<button class="btn prev" data-act="prev" ${s.pos > 0 ? '' : 'disabled'} aria-label="前の問題">${I.back}前へ</button>`;
}
function bmLineBtn(id) {
  const on = isBm(id);
  return `<button class="iconbtn star bmline ${on ? 'on' : ''}" data-act="bm" data-id="${esc(id)}" aria-pressed="${on}">${I.star}<span class="lab">${on ? 'ブックマーク済み' : 'ブックマーク'}</span></button>`;
}

function grade(q) {
  const s = store.d.session;
  const c = s.cur;
  if (c.graded || c.picks.some((p) => p === null)) return;
  c.results = q.blanks.map((b, i) => c.picks[i] === b.answer);
  const ok = c.results.every(Boolean);
  const p = store.d.progress[q.id] || { n: 0, ok: 0, streak: 0, weak: false };
  p.n += 1;
  if (ok) {
    p.ok += 1;
    p.streak += 1;
    if (p.weak && p.streak >= CLEAR_STREAK) { p.weak = false; c.note = `${CLEAR_STREAK}回連続正解！ 苦手克服から外れました`; }
    else if (p.weak) c.note = `あと${CLEAR_STREAK - p.streak}回連続で正解すると苦手克服から外れます`;
    else c.note = p.n > 1 ? `通算 ${p.ok}/${p.n} 回正解` : '';
  } else {
    p.streak = 0;
    c.note = p.weak ? '苦手克服に入ったままです' : '苦手克服に追加しました';
    p.weak = true;
  }
  p.last = ok ? 'ok' : 'ng';
  p.at = Date.now();
  store.d.progress[q.id] = p;
  s.stats.n += 1;
  if (ok) s.stats.ok += 1;
  c.graded = true;
  store.save();
  const y = window.scrollY;
  viewPlay();
  window.scrollTo(0, y);
  const r = document.getElementById('result');
  if (r) {
    const rect = r.getBoundingClientRect();
    if (rect.top > window.innerHeight * 0.55) window.scrollTo({ top: window.scrollY + rect.top - 90, behavior: 'smooth' });
  }
}

function prevQuestion() {
  const s = store.d.session;
  if (!s || s.pos <= 0) return;
  s.pos -= 1;
  s.count = Math.max(0, (s.count || 0) - 1);
  s.cur = null;
  store.save();
  viewPlay();
  window.scrollTo(0, 0);
}

function nextQuestion() {
  const s = store.d.session;
  s.count = (s.count || 0) + 1;
  s.pos += 1;
  s.cur = null;
  if (s.pos >= s.queue.length) {
    if (s.endless) {
      const last = s.queue[s.queue.length - 1];
      s.queue = randomQueue(s.subject, last);
      s.pos = 0;
      if (!s.queue.length) { finishSession(); return; }
    } else { finishSession(); return; }
  }
  store.save();
  viewPlay();
  window.scrollTo(0, 0);
}

function finishSession() {
  const s = store.d.session;
  if (s) {
    store.d.lastSession = { mode: s.mode, subject: s.subject, title: s.title, queue: s.queue, stats: s.stats };
    store.d.session = null;
    store.save();
  }
  go('#/done');
}

function viewDone() {
  const l = store.d.lastSession;
  if (!l) { go('#/'); return; }
  const weakN = weakQ().length;
  app().innerHTML = `${topbar('おつかれさまでした')}
    <div class="done">
      <p>${esc(l.title)} の演習が終わりました</p>
      ${l.stats.n ? `<div class="ring">${l.stats.ok} / ${l.stats.n}</div>
      <p>正答率 ${pct(l.stats.ok, l.stats.n)}%</p>` : '<p>最後の問題まで確認しました</p>'}
      <div class="btns">
        <button class="btn primary" data-act="again">${I.resume}同じ問題をもう一度</button>
        ${weakN ? `<a class="btn" href="#/weak">${I.target}苦手克服へ（${weakN}問）</a>` : ''}
        <a class="btn" href="#/">トップへ戻る</a>
      </div>
    </div>`;
  $('[data-act="again"]').addEventListener('click', () => {
    const ids = l.queue.filter((id) => store.d.questions[id]);
    startSession(l.mode, l.mode === 'random' ? shuffle(ids) : ids, 0, l.subject);
  });
}

/* ---------- settings ---------- */
function viewSettings() {
  const qs = allQ();
  const bySub = subjectsPresent(qs).map((s) => `<dt>${esc(s)}</dt><dd>${qs.filter((q) => q.subject === s).length}問</dd>`).join('');
  app().innerHTML = `${topbar('設定・問題の取り込み')}
    <section class="section">
      <h2>問題を取り込む</h2>
      <p>Claude が作った問題ファイル（.json）を選んでください。同じ番号の問題は新しい内容で上書きされ、学習記録はそのまま残ります。</p>
      <label class="btn primary block">${I.upload}ファイルを選ぶ<input type="file" accept=".json,application/json,text/plain" class="visually-hidden" data-act="import-file"></label>
      <details>
        <summary>テキストを貼り付けて取り込む</summary>
        <textarea data-act="import-text" placeholder='{"format":"denken3-drill/v1","questions":[...]}'></textarea>
        <div style="height:8px"></div>
        <button class="btn block" data-act="import-paste">貼り付けた内容を取り込む</button>
      </details>
    </section>

    <section class="section">
      <h2>収録状況</h2>
      ${qs.length ? `<dl class="kv">${bySub}<dt>合計</dt><dd>${qs.length}問</dd></dl>` : '<p>まだ問題がありません。</p>'}
    </section>

    <section class="section">
      <h2>バックアップ</h2>
      <p>問題・学習記録・ブックマークは、この端末のブラウザの中だけに保存されています。ブラウザのデータを消すとすべて失われるので、ときどき書き出しておいてください。</p>
      <div class="row">
        <button class="btn" data-act="export">${I.download}書き出す</button>
        <label class="btn">${I.upload}読み込む<input type="file" accept=".json,application/json" class="visually-hidden" data-act="restore"></label>
      </div>
    </section>

    <section class="section">
      <h2>リセット</h2>
      <p>「学習記録だけ消す」は問題を残したまま、正誤・苦手克服・続きからの記録を消します。</p>
      <div class="row">
        <button class="btn danger" data-act="reset-progress">学習記録だけ消す</button>
        <button class="btn danger" data-act="reset-all">すべて消す</button>
      </div>
    </section>
    <p class="fine">電験三種 短答ドリル v${APP_VERSION}</p>`;

  $('[data-act="import-file"]').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) importText(await f.text());
  });
  $('[data-act="import-paste"]').addEventListener('click', () => importText($('[data-act="import-text"]').value));
  $('[data-act="export"]').addEventListener('click', exportBackup);
  $('[data-act="restore"]').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) restoreBackup(await f.text());
  });
  $('[data-act="reset-progress"]').addEventListener('click', () => {
    if (!confirm('学習記録（正誤・苦手克服・続きから）を消します。ブックマークと問題は残ります。よろしいですか？')) return;
    store.d.progress = {}; store.d.session = null; store.d.lastSession = null;
    store.save(); toast('学習記録を消しました'); viewSettings();
  });
  $('[data-act="reset-all"]').addEventListener('click', () => {
    if (!confirm('問題・学習記録・ブックマークをすべて消します。元に戻せません。よろしいですか？')) return;
    store.d = normalize(null); store.save(); toast('すべてのデータを消しました'); viewSettings();
  });
}

function validateQuestion(q, i) {
  const where = `${i + 1}件目${q && q.id ? `（${q.id}）` : ''}`;
  if (!q || typeof q !== 'object') return `${where}: 形式が正しくありません`;
  if (!q.id || typeof q.id !== 'string') return `${where}: id がありません`;
  if (!q.subject) return `${where}: subject（科目）がありません`;
  if (!q.text) return `${where}: text（問題文）がありません`;
  if (!Array.isArray(q.blanks) || !q.blanks.length) return `${where}: blanks（解答欄）がありません`;
  for (const [bi, b] of q.blanks.entries()) {
    if (!Array.isArray(b.choices) || b.choices.length < 2) return `${where}: 解答欄${bi + 1}の選択肢が足りません`;
    if (!Number.isInteger(b.answer) || b.answer < 0 || b.answer >= b.choices.length) return `${where}: 解答欄${bi + 1}の正解番号が正しくありません`;
  }
  return null;
}

function importText(text) {
  let data;
  try { data = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch (e) { toast('ファイルを読み取れませんでした（JSON形式ではありません）'); return; }
  if (data && data.format === 'denken3-drill/backup-v1') { toast('これはバックアップファイルです。「バックアップ → 読み込む」から読み込んでください'); return; }
  const list = Array.isArray(data) ? data : data && data.questions;
  if (!Array.isArray(list) || !list.length) { toast('問題が見つかりませんでした'); return; }
  const errors = [];
  let added = 0; let updated = 0;
  list.forEach((q, i) => {
    const err = validateQuestion(q, i);
    if (err) { errors.push(err); return; }
    const clean = {
      id: q.id, subject: String(q.subject), unit: q.unit ? String(q.unit) : '', source: q.source ? String(q.source) : '',
      order: Number.isFinite(q.order) ? q.order : undefined, text: String(q.text),
      blanks: q.blanks.map((b) => ({
        label: b.label != null ? String(b.label) : undefined,
        prompt: b.prompt ? String(b.prompt) : undefined,
        choices: b.choices.map(String), answer: b.answer,
      })),
      explanation: q.explanation ? String(q.explanation) : '',
      figures: normFigures(q.figures || q.figure),
      explanationFigures: normFigures(q.explanationFigures),
    };
    if (!clean.figures.length) delete clean.figures;
    if (!clean.explanationFigures.length) delete clean.explanationFigures;
    if (store.d.questions[q.id]) updated++; else added++;
    store.d.questions[q.id] = clean;
  });
  if (!store.save()) return;
  const msg = `取り込みました：新規 ${added}問 ／ 更新 ${updated}問${errors.length ? ` ／ エラー ${errors.length}件` : ''}`;
  if (errors.length) alert(`${msg}\n\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? '\n…' : ''}`);
  else toast(msg);
  viewSettings();
}

function exportBackup() {
  const payload = { format: 'denken3-drill/backup-v1', app: APP_VERSION, exportedAt: new Date().toISOString(), data: store.d };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `denken3-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('バックアップを書き出しました');
}

function restoreBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { toast('ファイルを読み取れませんでした'); return; }
  if (!data || data.format !== 'denken3-drill/backup-v1' || !data.data) {
    toast('バックアップファイルではありません（問題ファイルは「問題を取り込む」から）');
    return;
  }
  const n = Object.keys(data.data.questions || {}).length;
  if (!confirm(`バックアップ（${n}問）で今のデータを置き換えます。よろしいですか？`)) return;
  store.d = normalize(data.data);
  store.save();
  toast('バックアップを読み込みました');
  viewSettings();
}

/* ---------------- router ---------------- */
const routes = {
  '': viewHome,
  list: viewList,
  weak: () => viewCollection('weak'),
  bookmarks: () => viewCollection('bookmark'),
  random: viewRandom,
  play: viewPlay,
  resume: () => { if (store.d.session) go('#/play'); else go('#/'); },
  done: viewDone,
  settings: viewSettings,
};
function render() {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0];
  (routes[r] || viewHome)();
  if (r !== 'resume') window.scrollTo(0, 0);
}

/* 全画面共通のイベント（ブックマーク・科目チップ・インストール） */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'bm') { e.preventDefault(); toggleBookmark(el.dataset.id); }
  else if (act === 'zoom') { if (!el.closest('.choice')) openZoom(el); }
  else if (act === 'prev') { prevQuestion(); }
  else if (act === 'mode') {
    if (store.d.ui.mode === el.dataset.v) return;
    store.d.ui.mode = el.dataset.v; store.save();
    viewPlay(); window.scrollTo(0, 0);
  } else if (act === 'subject') {
    store.d.ui.subject = el.dataset.v; store.save();
    const y = window.scrollY; render(); window.scrollTo(0, Math.min(y, 0));
  } else if (act === 'install' && deferredInstall) {
    deferredInstall.prompt();
    deferredInstall.userChoice.finally(() => { deferredInstall = null; if (!location.hash || location.hash === '#/') viewHome(); });
  }
});
window.addEventListener('scroll', () => {
  const tb = document.querySelector('.topbar');
  if (tb) tb.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (!location.hash || location.hash === '#/') viewHome();
});
window.addEventListener('hashchange', render);
window.addEventListener('storage', (e) => { if (e.key === KEY) { store.load(); render(); } });

function boot() {
  store.load();
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
