"""アプリの自動テスト。ブラウザ（Playwright + Chromium）でアプリを開いて確かめる。

    pip install playwright && python3 -m playwright install chromium
    python3 tests/run.py            # 全部
    python3 tests/run.py store      # 名前に store を含むテストだけ

Chrome を使うときは環境変数 CHROME=/usr/bin/google-chrome。
問題データは tests/fixtures.py の作りものだけを使う（過去問は使わない）。
"""
import functools, http.server, json, os, socketserver, sys, threading, traceback
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import fixtures as F

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", "8766"))
U = f"http://localhost:{PORT}/"
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class Page:
    """1 テスト 1 コンテキスト（保存領域もテストごとにまっさら）。"""

    def __init__(self, browser, **kw):
        self.ctx = browser.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True, **kw)
        self.ctx.route("https://accounts.google.com/**", lambda r: r.fulfill(body="", content_type="text/javascript"))
        self.pg = self.ctx.new_page()
        self.errors = []
        self.pg.on("pageerror", lambda e: self.errors.append(str(e)))
        self.pg.on("dialog", lambda d: d.accept())

    def open(self, hash="#/"):
        self.pg.goto(U + hash)
        self.pg.wait_for_function("()=>typeof store!=='undefined' && !!store.d")
        self.pg.wait_for_timeout(150)

    def js(self, expr, arg=None):
        return self.pg.evaluate(expr, arg)

    def paste(self, text):
        self.open("#/settings")
        self.js("()=>document.querySelector('details').open=true")
        self.pg.fill('[data-act="import-text"]', text)
        self.pg.click('[data-act="import-paste"]')
        self.pg.wait_for_timeout(400)

    def toast(self):
        return self.pg.inner_text("#toast")

    def counts(self):
        return self.js("()=>[Object.keys(store.d.questions).length, Object.keys(store.d.cards).length, Object.keys(calcData().templates).length]")

    def reload(self):
        self.pg.reload()
        self.pg.wait_for_function("()=>typeof store!=='undefined' && !!store.d")
        self.pg.wait_for_timeout(200)

    def close(self):
        assert not self.errors, f"ページのエラー: {self.errors}"
        self.ctx.close()


# ---------------- 取り込み ----------------
@test
def import_each_format(P):
    P.paste(F.questions_file())
    P.paste(F.cards_file())
    P.paste(F.calc_file())
    assert P.counts() == [3, 1, 1], P.counts()
    # bookmark: true は初回だけ、SVG の script は除去
    assert P.js("()=>store.d.bookmarks") == ["t-q3"]
    P.open("#/list"); P.pg.click('.qrow[data-id="t-q2"]'); P.pg.wait_for_timeout(300)
    assert P.pg.locator("#app svg").count() >= 1
    assert P.pg.locator("#app svg script").count() == 0  # 表示するときに除去


@test
def import_pack(P):
    P.paste(F.pack_file("パックA"))
    assert P.counts() == [3, 1, 1], P.counts()
    assert P.js("()=>store.d.ui.lastPack.title") == "パックA"
    P.paste(F.pack_file("パックB"))  # 同じ id は上書き（増えない）
    assert P.counts() == [3, 1, 1]


@test
def import_rejects_bad(P):
    P.paste("これはJSONではない")
    assert "JSON" in P.toast()
    P.paste(json.dumps({"format": "denken3-drill/backup-v1", "data": {}}))
    assert "バックアップ" in P.toast()
    bad = {"format": "denken3-drill/v1", "questions": [{"id": "x", "subject": "理論", "text": "t", "blanks": [{"choices": ["a", "b"], "answer": 5}]}]}
    P.paste(json.dumps(bad))
    assert P.counts()[0] == 0


# ---------------- 保存 ----------------
@test
def store_migrates_localstorage(P):
    P.open()
    P.js("""async()=>{ store.db.close(); await new Promise(r=>{const q=indexedDB.deleteDatabase('denken3-drill'); q.onsuccess=q.onerror=q.onblocked=()=>r();});
      localStorage.setItem('denken3-drill:v1', JSON.stringify({v:1, questions:{a:{id:'a',subject:'理論',text:'t',blanks:[{choices:['x','y'],answer:0}]}}, bookmarks:['a'], progress:{a:{weak:true}}})); }""")
    P.reload()
    assert P.js("()=>[store.migrated, Object.keys(store.d.questions), store.d.bookmarks, localStorage.getItem('denken3-drill:v1')]") == [True, ["a"], ["a"], None]


@test
def store_survives_quick_reload(P):
    P.paste(F.pack_file())
    P.js("()=>{ store.d.bookmarks.push('t-q1'); store.save(); }")  # 150ms 待たずに閉じる
    P.reload()
    assert "t-q1" in P.js("()=>store.d.bookmarks")
    assert P.counts() == [3, 1, 1]


@test
def backup_export_and_restore(P):
    P.paste(F.pack_file())
    P.js("()=>{ store.d.progress['t-q1']={n:1,ok:0,streak:0,weak:true}; store.save(); }")
    P.open("#/settings")
    with P.pg.expect_download() as dl:
        P.pg.click('[data-act="export"]')
    path = dl.value.path()
    bk = json.load(open(path))
    assert bk["format"] == "denken3-drill/backup-v1" and len(bk["data"]["questions"]) == 3
    P.pg.wait_for_timeout(300)
    assert P.js("()=>!!store.d.ui.lastBackup")
    P.pg.click('[data-act="reset-all"]'); P.pg.wait_for_timeout(400)
    assert P.counts() == [0, 0, 0]
    P.open("#/settings")
    P.pg.set_input_files('[data-act="restore"]', path); P.pg.wait_for_timeout(600)
    P.reload()
    assert P.counts() == [3, 1, 1]
    assert P.js("()=>store.d.progress['t-q1'].weak") is True


@test
def reset_progress_keeps_data(P):
    P.paste(F.pack_file())
    P.js("()=>{ store.d.progress['t-q1']={n:1,ok:1}; store.d.cprog['t-card1']={n:1}; store.save(); }")
    P.open("#/settings")
    P.pg.click('[data-act="reset-progress"]'); P.pg.wait_for_timeout(300)
    assert P.js("()=>[Object.keys(store.d.progress).length, Object.keys(store.d.cprog).length]") == [0, 0]
    assert P.counts() == [3, 1, 1]


# ---------------- 演習 ----------------
@test
def play_grade_and_weak(P):
    P.paste(F.questions_file())
    P.open("#/list"); P.pg.click('.qrow[data-id="t-q1"]'); P.pg.wait_for_timeout(300)
    assert P.js("()=>store.d.session.cur.id") == "t-q1"
    P.js("()=>{ const c=store.d.session.cur; c.picks=[1]; grade(store.d.questions['t-q1']); }")
    assert P.js("()=>store.d.progress['t-q1'].weak") is True
    for _ in range(2):  # 2 回連続正解で苦手から外れる
        P.js("()=>{ const c=store.d.session.cur; c.graded=false; c.picks=[0]; grade(store.d.questions['t-q1']); }")
    assert P.js("()=>store.d.progress['t-q1'].weak") is False


# ---------------- 計算練習 ----------------
@test
def calc_eval_cases(P):
    P.open()
    cases = [("40÷0.8", 50), ("√3×200", 346.410161514), ("2π×50", 314.159265), ("√(8²+6²)", 10), ("100√2", 141.421356),
             ("cos(60)", 0.5), ("10m", 0.01), ("4.7μ", 4.7e-6), ("2k×3", 6000), ("-3^2", -9), ("(1+2)(3+4)", 21),
             ("50%", 0.5), ("1.5×10^3", 1500), ("Ans+1", 2), ("２＋３", 5), ("5−2", 3), ("1e3", 1000)]
    for src, want in cases:
        got = P.js("([s])=>{try{return calcEval(s,{Ans:1},{si:true})}catch(e){return 'ERR '+e.message}}", [src])
        assert isinstance(got, (int, float)) and abs(got - want) <= 1e-6 * max(1, abs(want)), (src, got, want)
    for src in ["2+", "(3", "abc"]:
        assert str(P.js("([s])=>{try{return calcEval(s,{},{si:true})}catch(e){return 'ERR'}}", [src])).startswith("ERR"), src


@test
def calc_template_flow(P):
    P.paste(F.calc_file())
    P.open("#/calc"); P.pg.click('[data-c="open"][data-id="t-calc1"]'); P.pg.wait_for_timeout(300)
    sc = P.js("()=>calcScope()")
    assert sc["V"] / sc["R"] >= 2
    for name in ["I", "P"]:
        for ch in f"{sc[name]:.4f}":
            P.pg.click(f'.ck[data-ins="{ch}"]')
        P.pg.click('[data-c="submit"]'); P.pg.wait_for_timeout(250)
    P.pg.click('[data-c="choice"][data-k="0"]'); P.pg.wait_for_timeout(500)
    assert P.pg.locator(".c-done").count() == 1


# ---------------- Google Drive（API はダミー） ----------------
@test
def drive_list_get_backup(P):
    pack = F.pack_file("Driveのパック")
    uploads = []

    def api(route):
        u = route.request.url
        if "upload/drive" in u:
            uploads.append(route.request.post_data or "")
            return route.fulfill(body='{"id":"bk1"}', content_type="application/json")
        if "alt=media" in u:
            return route.fulfill(body=pack, content_type="application/json")
        if "denken3-drill" in u.replace("%27", "'").replace("+", " "):
            return route.fulfill(body='{"files":[{"id":"F1","name":"denken3-drill"}]}', content_type="application/json")
        return route.fulfill(body=json.dumps({"files": [
            {"id": "P1", "name": "denken3-pack.json", "modifiedTime": "2026-01-02T00:00:00Z", "size": "100"},
            {"id": "B1", "name": "denken3-backup-20260101.json", "modifiedTime": "2026-01-01T00:00:00Z", "size": "50"}]}),
            content_type="application/json")

    P.ctx.route("https://www.googleapis.com/**", api)
    P.open("#/settings")
    P.js("()=>{ window.driveToken=()=>Promise.resolve('tok'); }")
    P.pg.click('[data-drive="list"]'); P.pg.wait_for_timeout(500)
    listing = P.pg.inner_text('[data-slot="drive"]')
    assert "denken3-pack.json" in listing and "denken3-backup-20260101.json" in listing, listing
    P.pg.click('[data-drive="get"][data-id="P1"]'); P.pg.wait_for_timeout(800)
    assert P.counts() == [3, 1, 1]
    P.js("()=>{ window.driveToken=()=>Promise.resolve('tok'); }")
    P.pg.click('[data-drive="backup"]'); P.pg.wait_for_timeout(800)
    assert uploads and "backup-v1" in uploads[0]
    assert P.js("()=>!!store.d.ui.lastBackup")


# ---------------- 画面がひととおり開くか ----------------
@test
def all_screens_render(P):
    P.paste(F.pack_file())
    for h in ["#/", "#/list", "#/weak", "#/bookmarks", "#/random", "#/cards", "#/calc", "#/settings"]:
        P.open(h)
        assert P.pg.inner_text("#app").strip(), h


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    srv = serve()
    ok = ng = 0
    with sync_playwright() as p:
        kw = {"args": ["--no-sandbox"]}
        if os.environ.get("CHROME"):
            kw["executable_path"] = os.environ["CHROME"]
        browser = p.chromium.launch(**kw)
        for fn in TESTS:
            if only not in fn.__name__:
                continue
            P = Page(browser)
            try:
                fn(P)
                P.close()
                ok += 1
                print(f"  ok  {fn.__name__}")
            except Exception:
                ng += 1
                print(f"  NG  {fn.__name__}")
                traceback.print_exc(limit=2)
        browser.close()
    srv.shutdown()
    print(f"\n{ok} 件 OK / {ng} 件 NG")
    sys.exit(1 if ng else 0)


if __name__ == "__main__":
    main()
