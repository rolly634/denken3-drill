"""できた回の JSON（WORK/out/*_理論_問題.json と *_理論_途中式.json）を、まとめパック（pack-v1）にする。

使い方: python3 tools/make_pack.py [--max-mb 3.0] [--out DIR]

ルール
- 回ごとに「問題＋途中式」をひと組にして、古い回から順にパックへ詰める。
- 1 パックが --max-mb（既定 3.0MB。Claude から Drive へ 1 回で送れる量の目安）を超えそうなら、次のパックに分ける。
  1 つの回は 2 つのパックに分けない（途中式が同じパックの問題の図を使うため）。
- パックの中は分野順（order）に並べる。名前は denken3-pack_理論_<最初の回>-<最後の回>.json。
- --extra に渡したファイル（オリジナルの計算練習など。v1 / calc-v1 / cards-v1 / pack-v1）は、
  ファイルごとに別のパック denken3-pack_<ファイル名>.json にする。
"""
import argparse, glob, json, os, re, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import WORK

ERA = {"H": 0, "R": 100}


def exam_key(jp):
    m = re.match(r"([HR])(\d+)(上期|下期)?", jp)
    return ERA[m.group(1)] + int(m.group(2)) * 2 + (1 if m.group(3) == "下期" else 0)


def short(jp):
    return jp.replace("上期", "上").replace("下期", "下")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-mb", type=float, default=3.0)
    ap.add_argument("--out", default=os.path.join(WORK, "pack"))
    ap.add_argument("--extra", nargs="*", default=[])
    a = ap.parse_args()
    limit = int(a.max_mb * 1024 * 1024)
    os.makedirs(a.out, exist_ok=True)

    exams = []
    for qf in glob.glob(f"{WORK}/out/*_理論_問題.json"):
        jp = os.path.basename(qf).split("_")[0]
        if not re.match(r"[HR]\d", jp):
            continue
        cf = qf.replace("_問題.json", "_途中式.json")
        q = json.load(open(qf))["questions"]
        t = json.load(open(cf))["templates"] if os.path.exists(cf) else []
        size = len(json.dumps(q, ensure_ascii=False).encode()) + len(json.dumps(t, ensure_ascii=False).encode())
        exams.append((exam_key(jp), jp, q, t, size))
    exams.sort()
    if not exams:
        sys.exit(f"{WORK}/out に回のファイルがありません")

    groups, cur, cur_size = [], [], 0
    for e in exams:
        if e[4] > limit:
            sys.exit(f"{e[1]} だけで {e[4] / 1048576:.1f}MB あり、--max-mb を超えています")
        if cur and cur_size + e[4] > limit - 2048:
            groups.append(cur); cur, cur_size = [], 0
        cur.append(e); cur_size += e[4]
    groups.append(cur)

    today = datetime.date.today().isoformat()
    for g in groups:
        first, last = short(g[0][1]), short(g[-1][1])
        span = first if first == last else f"{first}-{last}"
        qs = sorted([q for e in g for q in e[2]], key=lambda x: x.get("order", 0))
        ts = sorted([t for e in g for t in e[3]], key=lambda x: x.get("order", 0))
        pack = {"format": "denken3-drill/pack-v1", "title": f"電験三種 理論 過去問 {span}（分野別・個人学習用）",
                "createdAt": today, "questions": qs, "templates": ts, "cards": []}
        path = os.path.join(a.out, f"denken3-pack_理論_{span}.json")
        json.dump(pack, open(path, "w"), ensure_ascii=False)
        print(f"{os.path.basename(path)}: {len(qs)} 問, 途中式 {len(ts)}, {os.path.getsize(path) / 1048576:.2f}MB")

    for f in a.extra:
        d = json.load(open(f))
        name = os.path.splitext(os.path.basename(f))[0]
        qs = d.get("questions", []) if isinstance(d, dict) else d
        pack = {"format": "denken3-drill/pack-v1", "title": d.get("title") or name, "createdAt": today,
                "questions": qs, "templates": d.get("templates", []), "cards": d.get("cards", [])}
        path = os.path.join(a.out, f"denken3-pack_{name}.json")
        json.dump(pack, open(path, "w"), ensure_ascii=False)
        size = os.path.getsize(path)
        print(f"{os.path.basename(path)}: 問題 {len(pack['questions'])}, 途中式 {len(pack['templates'])}, カード {len(pack['cards'])}, {size / 1048576:.2f}MB"
              + ("  ※ --max-mb を超えています" if size > limit else ""))


if __name__ == "__main__":
    main()
