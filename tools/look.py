"""作った問題をアプリで開いて、スクリーンショットを横に並べた 1 枚にする（見た目の確認用）。
使い方: python3 tools/look.py R7下期 r7s-01,r7s-02 [dark|light]"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import WORK, TMP, launch, serve
from playwright.sync_api import sync_playwright
from PIL import Image

jp = sys.argv[1]; ids = sys.argv[2].split(","); scheme = sys.argv[3] if len(sys.argv) > 3 else "dark"
U = "http://localhost:8765/"
serve()
qs = open(f"{WORK}/out/{jp}_理論_問題.json").read()
with sync_playwright() as p:
    b = launch(p)
    pg = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, color_scheme=scheme).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(U + "#/settings"); pg.click("text=テキストを貼り付けて取り込む"); pg.fill('[data-act="import-text"]', qs); pg.click('[data-act="import-paste"]'); pg.wait_for_timeout(400)
    outs = []
    for qid in ids:
        pg.goto(U + "#/list"); pg.wait_for_timeout(250); pg.click(f'.qrow[data-id="{qid}"]'); pg.wait_for_timeout(700)
        f = f"{TMP}/look_{qid}.png"; pg.screenshot(path=f, full_page=True); outs.append(f)
    b.close()
ims = [Image.open(f).convert("RGB") for f in outs]
for im in ims: im.thumbnail((390, 1800))
S = Image.new("RGB", (sum(i.width for i in ims) + 10 * len(ims), max(i.height for i in ims)), "gray"); x = 0
for im in ims: S.paste(im, (x, 0)); x += im.width + 10
out = f"{TMP}/look.png"; S.save(out); print(out, errs or "")
