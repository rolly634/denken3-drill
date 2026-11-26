"""途中式テンプレートの解説を、ステップ①②③…に沿った詳しい解説に書き直す（何度実行しても同じ結果）。
使い方: python3 explain.py [ファイル...]（省略時は out/*_途中式.json 全部）"""
import json, glob, math, re, sys

MARK_FLOW, MARK_SUM, MARK_MORE = "【解き方の流れ】", "【まとめ】", "【もっとくわしく】"
OLD = [("**解き方の流れ**", "**まとめ**", "**もっとくわしく**")]
NUM = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮"


def env():
    r = math.radians
    return {"sqrt": math.sqrt, "pi": math.pi, "abs": abs, "min": min, "max": max,
            "sin": lambda x: math.sin(r(x)), "cos": lambda x: math.cos(r(x)), "tan": lambda x: math.tan(r(x)),
            "asin": lambda x: math.degrees(math.asin(x)), "acos": lambda x: math.degrees(math.acos(x)),
            "atan": lambda x: math.degrees(math.atan(x)), "log": math.log10, "ln": math.log, "exp": math.exp, "e": math.e}


def ev(expr, scope):
    s = expr.replace("^", "**").replace("×", "*").replace("÷", "/").replace("π", "pi").replace("√", "sqrt")
    s = re.sub(r"(\d)\s*([kMmμu])(?![A-Za-z_(])", lambda m: m.group(1) + {"k": "e3", "M": "e6", "m": "e-3", "μ": "e-6", "u": "e-6"}[m.group(2)], s)
    return eval(s, {"__builtins__": {}}, {**env(), **scope})


def fmt(v):
    if v == 0: return "0"
    a = abs(v)
    if 1e-3 <= a < 1e5:
        t = f"{v:.4g}"
        return t
    m, e = f"{v:.3e}".split("e")
    m = m.rstrip("0").rstrip(".")
    return f"{m}\\times10^{{{int(e)}}}"


def strip_old(expl):
    """前回付けた流れ・まとめを外して、元の短い解説を取り出す"""
    for f, su, mo in [(MARK_FLOW, MARK_SUM, MARK_MORE)] + OLD:
        if expl.startswith(f) and su in expl:
            return expl.split(su, 1)[1].split(mo, 1)[0].strip()
    return expl


def show(expr, scope):
    s = expr
    for n in sorted(scope, key=len, reverse=True):
        s = re.sub(rf"(?<![A-Za-z0-9_]){re.escape(n)}(?![A-Za-z0-9_(])", "(" + fmt(scope[n]).replace("\\times10^{", "×10^").replace("}", "") + ")", s)
    s = re.sub(r"\((-?[0-9.]+(?:×10\^-?\d+)?)\)", r"\1", s)
    s = re.sub(r"(\d)e(-?\d+)", r"\1×10^\2", s)
    s = s.replace("sqrt", "√").replace("pi", "π").replace("^2", "²").replace("*", " × ").replace("/", " ÷ ").replace("+", " + ")
    s = re.sub(r"(?<=[0-9)πA-Za-z]) ?-(?=[0-9(√π])", " − ", s)
    return s


def build(t, qexpl):
    orig = strip_old(t.get("explanation", ""))
    scope, lines, k = {}, [], 0
    for st in t["steps"]:
        mark = NUM[k] if k < len(NUM) else f"({k+1})"; k += 1
        hints = [h.strip() for h in st.get("hints", []) if h.strip()]
        if st.get("choices"):
            ans = st["choices"][st["answer"]]
            if st.get("label", "").endswith("選択肢から選ぶ") or "選ぶ" in st.get("label", ""):
                head = st["label"].replace("選択肢から選ぶ", "").strip()
                lines.append(f"{mark} {head + ' ' if head else ''}計算結果にいちばん近いのは ({st['answer']+1}) {ans}")
            else:
                why = "。".join(h.rstrip("。") for h in hints)
                lines.append(f"{mark} {st['label']}\n" + (f"・{why}\n" if why else "") + f"→ {ans}")
            continue
        try:
            v = ev(st["expr"], scope)
        except Exception as ex:
            raise RuntimeError(f"{t['id']} {st.get('name')}: {st['expr']} ({ex})")
        unit = st.get("unit", "")
        calc = show(st["expr"], scope)
        if st.get("name"): scope[st["name"]] = v
        why = "".join("・" + h + "\n" for h in hints)
        lines.append(f"{mark} {st['label']}\n{why}・計算：{calc}\n→ ${fmt(v)}$" + (f" {unit}" if unit else ""))
    out = MARK_FLOW + "\n\n" + "\n\n".join(lines) + f"\n\n{MARK_SUM}\n\n{orig}"
    if qexpl: out += f"\n\n{MARK_MORE}\n\n{qexpl}"
    return out


def main(files):
    for cf in files:
        qf = cf.replace("_途中式.json", "_問題.json")
        qs = {q["id"]: q for q in json.load(open(qf))["questions"]}
        d = json.load(open(cf))
        for t in d["templates"]:
            qid = t.get("figuresFrom") or re.sub(r"(\d\d)[ab]?-calc$", r"\1", t["id"])
            q = qs.get(qid) or qs.get(re.sub(r"(\d\d)[ab]?-calc$", r"\1", t["id"]))
            t["explanation"] = build(t, q["explanation"] if q else "")
        json.dump(d, open(cf, "w"), ensure_ascii=False)
        print(cf.split("/")[-1], len(d["templates"]), "OK")


if __name__ == "__main__":
    import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from paths import WORK
    main(sys.argv[1:] or sorted(f for f in glob.glob(f"{WORK}/out/*_理論_途中式.json") if "分野別" not in f))
