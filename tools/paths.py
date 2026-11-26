"""置き場所の設定。作業フォルダ（過去問 PDF・下見画像・できた JSON）は、このリポジトリの外に置く。

    KK_WORK   作業フォルダ（既定 ~/kakomon-work）。out/ にできた JSON が入る
    CHROME    使う Chrome（任意。なければ Playwright の Chromium）
"""
import os, tempfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(TOOLS)
WORK = os.path.abspath(os.path.expanduser(os.environ.get("KK_WORK", "~/kakomon-work")))
TMP = os.path.join(tempfile.gettempdir(), "kakomon")
if os.path.commonpath([WORK, APP]) == APP:
    raise SystemExit(f"KK_WORK（{WORK}）がリポジトリの中にあります。過去問データが公開されないよう、外のフォルダにしてください")
os.makedirs(WORK, exist_ok=True)
os.makedirs(TMP, exist_ok=True)


def launch(p):
    kw = {"args": ["--no-sandbox"]}
    if os.environ.get("CHROME"):
        kw["executable_path"] = os.environ["CHROME"]
    return p.chromium.launch(**kw)


def serve(port=8765):
    """アプリをローカルで配信する（同じポートで動いていればそれを使う）"""
    import functools, http.server, socketserver, threading, urllib.request
    try:
        urllib.request.urlopen(f"http://localhost:{port}/", timeout=1)
        return
    except Exception:
        pass
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=APP)
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", port), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
