# 過去問 → 問題ファイルの変換ツール

過去問の PDF から、アプリで使う問題（4 択）と計算練習（途中式）を作る道具。
作業は Claude のチャット（コードを動かせる環境）で、PDF を渡して進める前提。

> **過去問のデータ（PDF・問題文・解答・図・できた JSON）は、このリポジトリに入れない。**
> 作業フォルダ `KK_WORK` はリポジトリの外に置く（中に置くとツールが止まる）。
> 回ごとの作成スクリプト（`build_<回>.py`）も問題文を含むので、非公開リポジトリに置く。

## 準備

```sh
pip install playwright pypdfium2 pillow && python3 -m playwright install chromium
# 図の切り出しに poppler-utils（pdftocairo）と librsvg（rsvg-convert）を使う
export KK_WORK=~/kakomon-work      # 作業フォルダ（既定）
```

## ファイル

| ファイル | 役目 |
|---|---|
| `paths.py` | 作業フォルダ・一時フォルダ・ブラウザの設定 |
| `kk.py` | 1 回分を作る部品 `Exam`（下見、図、問題、途中式、仕上げと公式解答の照合） |
| `figcrop.py` | PDF のページから図だけをベクター SVG で切り出す（`crop`）。スキャン PDF は画像で切り出す（`rcrop`） |
| `explain.py` | 途中式の解説を「解き方の流れ／まとめ／もっとくわしく」に書き直す（何度やっても同じ） |
| `fields.py` | 分野と回の順番、`order` の計算 |
| `check.py` | できた回をアプリに入れて、途中式が最後まで計算できるか確かめる |
| `look.py` | できた問題をアプリで開いてスクリーンショットを並べる |
| `make_pack.py` | できた回をまとめパックにする（3.0MB ごとに自動で分ける） |

## 1 回分の作り方

`build_<回>.py` を 1 つ書いて動かす。

```python
import sys; sys.path.insert(0, "<このリポジトリ>/tools")
from kk import Exam
E = Exam("r8s", "R8下", "R8S_R.pdf", jp="R8下期")    # スキャン PDF なら scan=True
E.prep()                                  # 下見画像（座標の目盛りつき）と本文テキストを KK_WORK/r8s/ に作る
E.fig("q02", 5, 120, 300, 480, 520)       # ページ, x0, y0, x1, y1（SVG 単位）
E.q(1, "直流回路", "問題文 {{1}} …", E.one(["…", "…", "…", "…", "…"], 3), "解説", figs=["q02"])
E.c(1, "直流回路", "見出し", [E.S("I", "電流 $I$", "V/R", ["ヒント"], "A"), E.pick([...], 3)], "まとめ")
E.done([3, 1, 4, …])                       # 公式解答 22 個（問1〜14、15a〜18b）
```

- 下見画像の座標から SVG 単位へは `x = 100 + (px − 60) / 1.5`、`y = 100 + (py − 30) / 1.5`。ページは画像の g 番号。
- `done` が、分野順に並べて `KK_WORK/out/<回>_理論_問題.json` と `…_途中式.json` を書き、公式解答と照合し、解説を書き直す。

## 仕上げ

```sh
python3 tools/check.py R8下期                       # 途中式が全部計算できるか
python3 tools/look.py R8下期 r8s-01,r8s-02          # 見た目
python3 tools/make_pack.py --extra "$KK_WORK/out/計算練習パック_オリジナル15問.json"
```

`KK_WORK/pack/` にできたパックを Drive の `denken3-drill` フォルダに置き（古いパックは消す）、アプリの設定 → Google Drive から取り込む。
