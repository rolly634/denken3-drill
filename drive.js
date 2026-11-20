'use strict';

/* =========================================================
   Google Drive 連携（設定画面）
   - Google でログインして、Drive の「denken3-drill」フォルダのファイルを一覧・取り込みする
   - バックアップを同じフォルダに保存する
   ログインはブラウザの中だけ（Google Identity Services のトークン）。トークンは保存しない。
   app.js のあとに読み込み、app.js のヘルパー（store・toast・importText など）を使う。
   ========================================================= */

const DRIVE_CLIENT_ID = '478536741025-l7m05ehcfo7cha0ivi1e867jbbpdrgct.apps.googleusercontent.com';
// 見る：フォルダの中のファイルを読む／書く：このアプリが作るバックアップだけ
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER = 'denken3-drill';
const DRIVE_API = 'https://www.googleapis.com/';

const drive = { token: '', exp: 0, files: null, busy: '', err: '', folderId: '' };

function driveLoadGis() {
  return new Promise((resolve, reject) => {
    if (window.google && google.accounts && google.accounts.oauth2) { resolve(); return; }
    let s = document.getElementById('gis-script');
    if (!s) {
      s = document.createElement('script');
      s.id = 'gis-script'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => resolve(), { once: true });
    s.addEventListener('error', () => reject(new Error('Google のログインを読み込めませんでした（通信を確認してね）')), { once: true });
  });
}

// ボタンを押した流れの中でログイン画面を出す（先に読み込んでおかないと、ポップアップが止められることがある）
function driveToken() {
  if (drive.token && Date.now() < drive.exp - 60000) return Promise.resolve(drive.token);
  const ask = () => new Promise((resolve, reject) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        drive.token = r.access_token;
        drive.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        resolve(drive.token);
      },
      error_callback: (e) => reject(new Error(e && e.type === 'popup_closed' ? 'ログインを閉じました' : 'ログインできませんでした（ポップアップを許可してね）')),
    });
    tc.requestAccessToken();
  });
  if (window.google && google.accounts && google.accounts.oauth2) return ask();
  return driveLoadGis().then(ask);
}

async function driveFetch(path, opt = {}) {
  const t = await driveToken();
  const res = await fetch(DRIVE_API + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: `Bearer ${t}` }, opt.headers || {}) }));
  if (res.status === 401) { drive.token = ''; throw new Error('ログインが切れました。もう一度押してね'); }
  if (!res.ok) {
    let m = '';
    try { m = (await res.json()).error.message; } catch (e) { /* noop */ }
    throw new Error(`Drive エラー（${res.status}）${m ? `：${m}` : ''}`);
  }
  return res;
}

async function driveFolder(create) {
  if (drive.folderId) return drive.folderId;
  const q = encodeURIComponent(`name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r = await (await driveFetch(`drive/v3/files?q=${q}&fields=files(id,name)&orderBy=modifiedTime desc&pageSize=10`)).json();
  if (r.files && r.files.length) { drive.folderId = r.files[0].id; return drive.folderId; }
  if (!create) return '';
  const made = await (await driveFetch('drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  })).json();
  drive.folderId = made.id;
  return drive.folderId;
}

async function driveList() {
  const fid = await driveFolder(false);
  if (!fid) return [];
  const q = encodeURIComponent(`'${fid}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`);
  const r = await (await driveFetch(`drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=50`)).json();
  return (r.files || []).filter((f) => /\.json$/i.test(f.name));
}

/* ---------- 画面 ---------- */
function driveKind(name) { return /backup/i.test(name) ? 'バックアップ' : /pack|パック/i.test(name) ? 'まとめパック' : '問題ファイル'; }
function driveDate(iso) { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

function driveBoxHTML() {
  const lp = store.d.ui.lastPack;
  let list = '';
  if (drive.files) {
    list = drive.files.length
      ? `<ul class="drive-list">${drive.files.map((f) => {
        const isNew = driveKind(f.name) === 'まとめパック' && (!lp || new Date(f.modifiedTime).getTime() > lp.at);
        return `<li><div class="drive-f"><b>${esc(f.name)}</b><span>${esc(driveKind(f.name))} ・ ${driveDate(f.modifiedTime)}${f.size ? ` ・ ${fmtBytes(Number(f.size))}` : ''}${isNew ? ' ・ <em>新しい版</em>' : ''}</span></div>
          <button class="btn" data-drive="get" data-id="${esc(f.id)}" data-name="${esc(f.name)}" ${drive.busy ? 'disabled' : ''}>取り込む</button></li>`;
      }).join('')}</ul>`
      : `<p class="fine">Drive に「${DRIVE_FOLDER}」フォルダが見つからないか、中に .json ファイルがありません。</p>`;
  }
  return `${drive.busy ? `<p class="drive-busy">${esc(drive.busy)}</p>` : ''}${drive.err ? `<p class="drive-err">${esc(drive.err)}</p>` : ''}${list}`;
}

function driveSettingsHTML() {
  const lp = store.d.ui.lastPack;
  return `<section class="section" id="drive">
      <h2>Google Drive</h2>
      <p>Google でログインして、Drive の「${DRIVE_FOLDER}」フォルダにある問題のまとめパックを取り込めます。「Drive に保存」で、バックアップを同じフォルダに保存できます。${lp ? `<br>最後に取り込んだパック：${esc(lp.title || '（名前なし）')}（${driveDate(new Date(lp.at).toISOString())}）` : ''}</p>
      <div class="row">
        <button class="btn primary" data-drive="list" ${drive.busy ? 'disabled' : ''}>${I.download}Drive を見る</button>
        <button class="btn" data-drive="backup" ${drive.busy ? 'disabled' : ''}>${I.upload}Drive に保存</button>
      </div>
      <div data-slot="drive">${driveBoxHTML()}</div>
    </section>`;
}

function driveRefresh() {
  const sec = document.getElementById('drive');
  if (!sec) return;
  sec.outerHTML = driveSettingsHTML();
  driveBindSettings();
}

async function driveRun(label, fn) {
  drive.busy = label; drive.err = ''; driveRefresh();
  try { await fn(); } catch (e) { drive.err = e.message || String(e); }
  drive.busy = '';
  driveRefresh();
}

function driveBindSettings() {
  driveLoadGis().catch(() => {}); // 押したときにすぐログイン画面を出せるよう、先に読み込んでおく
  const sec = document.getElementById('drive');
  if (!sec) return;
  sec.querySelector('[data-drive="list"]').addEventListener('click', () => driveRun('Drive を見ています…', async () => { drive.files = await driveList(); }));
  sec.querySelector('[data-drive="backup"]').addEventListener('click', () => driveRun('Drive にバックアップしています…', driveBackup));
  sec.querySelectorAll('[data-drive="get"]').forEach((b) => b.addEventListener('click', () => {
    const { id, name } = b.dataset;
    let text = '';
    driveRun(`「${name}」を読み込んでいます…`, async () => {
      text = await (await driveFetch(`drive/v3/files/${encodeURIComponent(id)}?alt=media`)).text();
    }).then(() => {
      if (!text) return;
      let fmt = '';
      try { fmt = JSON.parse(text).format; } catch (e) { /* importText が知らせる */ }
      if (fmt === 'denken3-drill/backup-v1') restoreBackup(text); else importText(text);
    });
  }));
}

async function driveBackup() {
  await store.flush();
  const fid = await driveFolder(true);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const name = `denken3-backup-${stamp}.json`;
  const body = JSON.stringify({ format: 'denken3-drill/backup-v1', app: APP_VERSION, exportedAt: d.toISOString(), data: store.d });
  const boundary = `b${Date.now()}`;
  const meta = JSON.stringify({ name, parents: [fid], mimeType: 'application/json' });
  const payload = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`, body, `\r\n--${boundary}--`]);
  await driveFetch('upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: payload });
  store.d.ui.lastBackup = Date.now(); store.save();
  toast(`Drive に保存しました：${name}`);
  if (drive.files) drive.files = await driveList();
  setTimeout(() => { if (document.getElementById('drive')) viewSettings(); }, 0); // 「最後のバックアップ」の表示を更新
}
