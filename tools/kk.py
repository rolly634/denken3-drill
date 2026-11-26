"""過去問 1 回分を作るための共通部品。

    from kk import Exam
    E = Exam("r7s", "R7下", "R7S_R.pdf", jp="R7下期")
    E.prep()                       # ページの下見画像（座標グリッドつき）と本文テキストを作る
    E.fig("q02", page, x0, y0, x1, y1)
    E.q(n, field, text, blanks, expl, figs=["q02"])
    E.c(n, field, title, steps, expl, note="", part="")
    E.done(key)                    # 並べ替え・保存・公式解答との照合
"""
import json, os, sys, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import WORK, TMP
import figcrop as FC
from fields import order_of
from PIL import Image, ImageDraw

ROOT = WORK
ORDER = [str(i) for i in range(1, 15)] + ["15a", "15b", "16a", "16b", "17a", "17b", "18a", "18b"]


class Exam:
    def __init__(self, code, src, pdf, jp, scan=False):
        self.code, self.src, self.pdf, self.jp, self.scan = code, src, pdf, jp, scan
        self.dir = f"{ROOT}/{code}"
        os.makedirs(self.dir, exist_ok=True)
        self.Q, self.C, self.figs = [], [], {}
        fp = f"{self.dir}/figs.json"
        self.cached = json.load(open(fp)) if os.path.exists(fp) else {}

    # ---------- 下見 ----------
    def prep(self, first=4):
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(self.pdf)
        n = len(pdf)
        with open(f"{self.dir}/text.txt", "w") as f:
            for i in range(n):
                f.write(f"=== PAGE {i+1} ===\n{pdf[i].get_textpage().get_text_range()}\n")
        for p in range(first, n):
            out = f"{self.dir}/g{p:02d}.png"
            if self.scan:
                subprocess.run(["pdftoppm", "-r", "108", "-f", str(p), "-l", str(p), "-png", "-singlefile", self.pdf, out[:-4]], check=True, stderr=subprocess.DEVNULL)
            else:
                FC.preview(self.pdf, p, out, 1.5)
            im = Image.open(out).convert("RGB"); d = ImageDraw.Draw(im)
            W, H = im.size
            for u in range(0, int(W / 1.5), 50):
                d.line([(u * 1.5, 0), (u * 1.5, H)], fill=(170, 215, 255), width=1); d.text((u * 1.5 + 2, 152), str(u), fill=(0, 90, 200))
            for v in range(0, int(H / 1.5), 50):
                d.line([(0, v * 1.5), (W, v * 1.5)], fill=(170, 215, 255), width=1); d.text((92, v * 1.5 + 2), str(v), fill=(0, 90, 200))
            im.crop((90, 120, W - 60, H - 150)).save(out)
        return n

    # ---------- 図 ----------
    def fig(self, key, page, x0, y0, x1, y1):
        box = [page, x0, y0, x1, y1]
        c = self.cached.get(key)
        if c and c["box"] == box:
            self.figs[key] = c["svg"]; return
        svg = FC.rcrop(self.pdf, page, x0, y0, x1, y1) if self.scan else FC.raster(FC.crop(self.pdf, page, x0, y0, x1, y1, prefix=f"{self.code}{key}"))
        self.figs[key] = svg
        self.cached[key] = {"box": box, "svg": svg}
        json.dump(self.cached, open(f"{self.dir}/figs.json", "w"))

    def figsheet(self):
        """切り出した図を 1 枚に並べて確認用 PNG にする"""
        import glob
        tiles = []
        for k, s in self.figs.items():
            open(f"{TMP}/_f.svg", "w").write(s)
            subprocess.run(["rsvg-convert", "-z", "1.2", "-b", "white", f"{TMP}/_f.svg", "-o", f"{TMP}/_f_{k}.png"], check=True)
            tiles.append((k, Image.open(f"{TMP}/_f_{k}.png").convert("RGB")))
        W = 900; x = y = rowh = 0; pos = []
        for k, im in tiles:
            if x + im.width > W: x = 0; y += rowh + 25; rowh = 0
            pos.append((x, y)); x += im.width + 15; rowh = max(rowh, im.height)
        S = Image.new("RGB", (W, y + rowh + 25), (220, 220, 220)); d = ImageDraw.Draw(S)
        for (k, im), p in zip(tiles, pos):
            S.paste(im, (p[0], p[1] + 14)); d.text(p, k, fill=(200, 0, 0))
        out = f"{TMP}/{self.code}_figs.png"; S.save(out); return out

    # ---------- 問題 ----------
    def q(self, n, field, text, blanks, expl, figs=None):
        item = {"id": f"{self.code}-{n:02d}", "subject": "理論", "unit": field, "source": f"{self.src} 問{n}",
                "order": order_of(field, self.code, n), "text": text, "blanks": blanks, "explanation": expl}
        if figs: item["figures"] = [{"svg": self.figs[k]} for k in figs]
        self.Q.append(item)

    @staticmethod
    def one(choices, ans):
        return [{"choices": choices, "answer": ans - 1}]

    @staticmethod
    def sub(label, prompt, choices, ans):
        return {"label": label, "prompt": prompt, "choices": choices, "answer": ans - 1}

    @staticmethod
    def pick(choices, ans, label="選択肢から選ぶ"):
        return {"label": label, "choices": choices, "answer": ans - 1,
                "hints": ["計算した値に一番近いものを選ぼ", "単位と桁（10 の何乗か）を確認してね"]}

    @staticmethod
    def S(name, label, expr, hints, unit=None):
        st = {"name": name, "label": label, "expr": expr, "hints": [h for h in hints if h]}
        if unit: st["unit"] = unit
        return st

    def c(self, n, field, title, steps, expl, note="", part=""):
        """途中式。問題文は done() で元の問題文（(a)(b) の問いを含む）から作る"""
        self.C.append({"id": f"{self.code}-{n:02d}{part}-calc", "subject": "理論", "unit": field,
                       "title": f"{self.src} 問{n}{f'({part})' if part else ''} {title}",
                       "order": order_of(field, self.code, n), "vars": {}, "_n": n, "_note": note,
                       "steps": steps, "explanation": expl})

    # ---------- 仕上げ ----------
    def done(self, key):
        by = {x["id"]: x for x in self.Q}
        for t in self.C:
            qq = by[f"{self.code}-{t.pop('_n'):02d}"]
            full = qq["text"]
            prompts = [b["prompt"] for b in qq["blanks"] if b.get("prompt")]
            if prompts: full += "\n\n" + "\n\n".join(prompts)
            note = t.pop("_note")
            if note: full += "\n\n【途中式のメモ】" + note
            t["text"] = full
            if qq.get("figures"): t["figuresFrom"] = qq["id"]
        self.Q.sort(key=lambda x: x["order"]); self.C.sort(key=lambda x: x["order"])
        os.makedirs(f"{ROOT}/out", exist_ok=True)
        qf = f"{ROOT}/out/{self.jp}_理論_問題.json"; cf = f"{ROOT}/out/{self.jp}_理論_途中式.json"
        json.dump({"format": "denken3-drill/v1", "title": f"電験三種 理論 {self.jp}（過去問・個人学習用）", "questions": self.Q},
                  open(qf, "w"), ensure_ascii=False)
        json.dump({"format": "denken3-drill/calc-v1", "title": f"電験三種 理論 {self.jp} 途中式（個人学習用）", "templates": self.C},
                  open(cf, "w"), ensure_ascii=False)
        # 公式解答と照合
        official = dict(zip(ORDER, key))
        mine = {}
        for q in self.Q:
            n = int(q["id"].split("-")[1])
            if len(q["blanks"]) == 1: mine[str(n)] = q["blanks"][0]["answer"] + 1
            else:
                for b in q["blanks"]: mine[f"{n}{b['label']}"] = b["answer"] + 1
        bad = [(k, mine.get(k), official[k]) for k in ORDER if mine.get(k) != official[k]]
        # 途中式の最後の選択が、問題の正解と同じか
        cbad = []
        for t in self.C:
            last = [s for s in t["steps"] if s.get("choices")]
            if not last: continue
            n = int(t["id"].split("-")[1][:2]); part = t["id"].split("-")[1][2:3]
            want = official.get(f"{n}{part}" if part else str(n))
            if want and last[-1]["answer"] + 1 != want: cbad.append((t["id"], last[-1]["answer"] + 1, want))
        import explain; explain.main([cf])
        print(f"{self.jp}: {len(self.Q)} 問, 途中式 {len(self.C)} 問, {os.path.getsize(qf)//1024}KB + {os.path.getsize(cf)//1024}KB")
        print("  公式解答:", "OK" if not bad else f"不一致 {bad}")
        print("  途中式の最後の選択:", "OK" if not cbad else f"不一致 {cbad}")
        return qf, cf
