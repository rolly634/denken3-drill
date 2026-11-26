"""作った回をアプリに取り込んで、途中式が最後まで計算できるか確かめる。
使い方: python3 tools/check.py R7下期"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import WORK, launch, serve
from playwright.sync_api import sync_playwright

jp = sys.argv[1]
U = "http://localhost:8765/"
serve()
qs = open(f"{WORK}/out/{jp}_理論_問題.json").read()
cs = open(f"{WORK}/out/{jp}_理論_途中式.json").read()
with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: (errs.append("ALERT " + d.message), d.dismiss()))
    pg.goto(U + "#/settings")
    for f in (qs, cs):
        pg.click("text=テキストを貼り付けて取り込む"); pg.fill('[data-act="import-text"]', f); pg.click('[data-act="import-paste"]'); pg.wait_for_timeout(400)
        pg.goto(U + "#/settings"); pg.wait_for_timeout(150)
    print("  取り込み:", pg.evaluate("()=>[Object.keys(store.d.questions).length, Object.keys(calcData().templates).length]"))
    for r in pg.evaluate("""()=>Object.values(calcData().templates).map(t=>{const {scope}=calcInstance(t); const S=calcSymScope(t,{});
        return t.id+' | '+t.steps.map(s=>s.choices?('選'+(s.answer+1)):(s.name+'='+calcFmt(scope[s.name],4)+(S[s.name]&&symWorthShowing(S[s.name])?'('+symText(S[s.name])+')':''))).join(' , ');})"""):
        print("   ", r)
    b.close()
print("  エラー:", errs or "なし")
