"""テスト用の小さなデータ。過去問・教材の文章は使わない（すべて作りもの）。"""
import json

QUESTIONS = [
    {
        "id": "t-q1", "subject": "理論", "unit": "テスト単元", "source": "テスト 1", "order": 1,
        "text": "抵抗 $R$ に電圧 $V$ をかけたときの電流は{{1}}である。",
        "blanks": [{"label": "1", "choices": ["$V/R$", "$VR$", "$R/V$", "$V^2R$"], "answer": 0}],
        "explanation": "オームの法則。",
    },
    {
        "id": "t-q2", "subject": "理論", "unit": "テスト単元", "source": "テスト 2", "order": 2,
        "text": "{{1}}と{{2}}を選ぶ。",
        "blanks": [
            {"label": "1", "choices": ["あ", "い"], "answer": 1},
            {"label": "2", "choices": ["う", "え", "お", "か"], "answer": 2},
        ],
        "explanation": "テスト。",
        "figures": [{"svg": "<svg viewBox=\"0 0 10 10\"><rect class=\"bg\" width=\"5\" height=\"5\"/><script>x()</script></svg>"}],
    },
    {
        "id": "t-q3", "subject": "電力", "unit": "テスト単元B", "source": "テスト 3", "order": 3, "bookmark": True,
        "text": "テスト問題 3 の答えは？",
        "blanks": [{"prompt": "答えは？", "choices": ["A", "B", "C", "D"], "answer": 3}],
        "explanation": "",
    },
]

CARDS = [
    {
        "id": "t-card1", "subject": "理論", "unit": "テスト", "order": 1,
        "front": "電圧 $V$、電流 $I$ のときの電力 $P$ は？",
        "choices": ["$P = VI$", "$P = V/I$", "$P = I/V$", "$P = V + I$"], "answer": 0,
        "name": "電力", "formula": "$P = VI$",
        "vars": [["P", "電力", "W"], ["V", "電圧", "V"], ["I", "電流", "A"]],
        "conditions": "直流。",
    },
]

TEMPLATES = [
    {
        "id": "t-calc1", "subject": "理論", "unit": "テスト", "title": "オームの法則と電力",
        "vars": {"V": [100, 200], "R": {"min": 10, "max": 50, "step": 10}},
        "where": "V/R >= 2",
        "text": "抵抗 {{R}} Ω に {{V}} V をかける。電流と電力は？",
        "steps": [
            {"name": "I", "label": "電流 $I$", "unit": "A", "expr": "V/R", "hints": ["$I = V/R$"]},
            {"name": "P", "label": "電力 $P$", "unit": "W", "expr": "V*I"},
            {"label": "電力は電流が増えると", "choices": ["増える", "減る"], "answer": 0},
        ],
        "explanation": "$I = {{I}}$ A、$P = {{P}}$ W",
    },
]


def questions_file():
    return json.dumps({"format": "denken3-drill/v1", "title": "テスト問題", "questions": QUESTIONS}, ensure_ascii=False)


def cards_file():
    return json.dumps({"format": "denken3-drill/cards-v1", "title": "テストカード", "cards": CARDS}, ensure_ascii=False)


def calc_file():
    return json.dumps({"format": "denken3-drill/calc-v1", "templates": TEMPLATES}, ensure_ascii=False)


def pack_file(title="テストパック"):
    return json.dumps({"format": "denken3-drill/pack-v1", "title": title, "createdAt": "2026-01-01",
                       "questions": QUESTIONS, "templates": TEMPLATES, "cards": CARDS}, ensure_ascii=False)
