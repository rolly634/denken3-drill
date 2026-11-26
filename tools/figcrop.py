"""PDF のページから図の部分だけを、テーマに合わせて色が変わるベクター SVG として切り出す。

使い方（Python から）:
    page_svg(pdf, page)              -> ページ全体の SVG ファイルパス（キャッシュ）
    preview(pdf, page, out_png, z)   -> 位置決め用の PNG（座標は SVG 単位 × z）
    crop(pdf, page, x0, y0, x1, y1)  -> 切り出した SVG 文字列（座標は SVG 単位）
"""
import os, re, subprocess, xml.etree.ElementTree as ET

NS = {"svg": "http://www.w3.org/2000/svg", "xlink": "http://www.w3.org/1999/xlink"}
ET.register_namespace("", NS["svg"])
ET.register_namespace("xlink", NS["xlink"])
HREF = "{%s}href" % NS["xlink"]
from paths import WORK
CACHE = os.path.join(WORK, "_pages")
os.makedirs(CACHE, exist_ok=True)


def page_svg(pdf, page):
    key = os.path.basename(pdf).split("-", 1)[0]
    out = f"{CACHE}/{key}-{page}.svg"
    if not os.path.exists(out):
        subprocess.run(["pdftocairo", "-svg", "-f", str(page), "-l", str(page), pdf, out], check=True, stderr=subprocess.DEVNULL)
    return out


def preview(pdf, page, out_png, z=1.5):
    subprocess.run(["rsvg-convert", "-z", str(z), "-b", "white", page_svg(pdf, page), "-o", out_png], check=True)


def _matrix(tr):
    if not tr:
        return (1, 0, 0, 1, 0, 0)
    m = re.match(r"matrix\(([^)]*)\)", tr)
    if m:
        return tuple(float(v) for v in re.split(r"[ ,]+", m.group(1).strip()))
    m = re.match(r"translate\(([^)]*)\)", tr)
    if m:
        v = [float(x) for x in re.split(r"[ ,]+", m.group(1).strip())]
        return (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
    return (1, 0, 0, 1, 0, 0)


def _mul(a, b):  # a ∘ b
    return (a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5])


def _apply(m, x, y):
    return m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]


def _path_bbox(d, m):
    nums = [float(v) for v in re.findall(r"-?\d*\.?\d+(?:e-?\d+)?", d)]
    pts = [_apply(m, nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
    if not pts:
        return None
    xs, ys = zip(*pts)
    return min(xs), min(ys), max(xs), max(ys)


def _hits(bb, box, pad=1.0):
    return not (bb[2] < box[0] - pad or bb[0] > box[2] + pad or bb[3] < box[1] - pad or bb[1] > box[3] + pad)


def _recolor(el):
    for attr in ("fill", "stroke"):
        v = el.get(attr)
        if not v or not v.startswith("rgb("):
            continue
        r, g, b = [float(x.strip().rstrip("%")) for x in v[4:-1].split(",")]
        if max(r, g, b) < 35:            # 黒っぽい → 文字色
            el.set(attr, "currentColor")
        elif min(r, g, b) > 97:          # 白 → 背景色
            if attr == "fill":
                el.attrib.pop("fill"); el.set("class", (el.get("class", "") + " bg").strip())
            else:
                el.set(attr, "var(--surface)")
        # それ以外の灰色や色はそのまま


def crop(pdf, page, x0, y0, x1, y1, pad=4, prefix="f"):
    tree = ET.parse(page_svg(pdf, page))
    root = tree.getroot()
    box = (x0, y0, x1, y1)
    defs = root.find("svg:defs", NS)
    used, keep = set(), []

    def walk(el, m, parent_out):
        tag = el.tag.split("}")[1]
        mm = _mul(m, _matrix(el.get("transform")))
        if tag == "g":
            g = ET.Element(el.tag, {k: v for k, v in el.attrib.items()})
            for ch in el:
                walk(ch, mm, g)
            if len(g):
                _recolor(g)
                if g.get("clip-path"):
                    used.add(g.get("clip-path")[5:-1])
                parent_out.append(g)
        elif tag == "use":
            x, y = float(el.get("x", 0)), float(el.get("y", 0))
            px, py = _apply(mm, x, y)
            if box[0] - 2 <= px <= box[2] + 2 and box[1] - 2 <= py <= box[3] + 2:
                used.add(el.get(HREF)[1:])
                parent_out.append(el)
        elif tag in ("path", "rect", "line", "polyline", "polygon", "circle", "ellipse", "image"):
            if el.get("stroke", "").startswith("rgb(100%") and el.get("fill") == "none":
                return  # トンボ（白い線）
            if tag == "path":
                bb = _path_bbox(el.get("d", ""), mm)
            elif tag == "rect" or tag == "image":
                x, y, w, h = (float(el.get(k, 0)) for k in ("x", "y", "width", "height"))
                p1, p2 = _apply(mm, x, y), _apply(mm, x + w, y + h)
                bb = (min(p1[0], p2[0]), min(p1[1], p2[1]), max(p1[0], p2[0]), max(p1[1], p2[1]))
            else:
                bb = box
            if bb and _hits(bb, box):
                # ページ全体を覆う白い長方形などは不要
                if bb[2] - bb[0] > 400 and bb[3] - bb[1] > 500:
                    return
                _recolor(el)
                if el.get("clip-path"):
                    used.add(el.get("clip-path")[5:-1])
                if tag == "image":
                    pass
                parent_out.append(el)

    body = ET.Element("{%s}g" % NS["svg"])
    for el in list(root):
        if el.tag.endswith("defs"):
            continue
        walk(el, (1, 0, 0, 1, 0, 0), body)

    out = ET.Element("{%s}svg" % NS["svg"])
    vb = (x0 - pad, y0 - pad, (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad)
    out.set("viewBox", " ".join(f"{v:.2f}" for v in vb))
    out.set("width", f"{vb[2]:.1f}")
    out.set("height", f"{vb[3]:.1f}")
    new_defs = ET.SubElement(out, "{%s}defs" % NS["svg"])
    if defs is not None:
        # グリフは入れ子（symbol / g の中の path）。使われているものだけ残す
        for el in defs.iter():
            i = el.get("id")
            if i and i in used:
                new_defs.append(el)
                for u in el.iter():
                    if u.get(HREF):
                        used.add(u.get(HREF)[1:])
        for el in defs.iter():
            i = el.get("id")
            if i and i in used and el not in list(new_defs):
                new_defs.append(el)
    cp = ET.SubElement(new_defs, "{%s}clipPath" % NS["svg"], {"id": "fcrop"})
    ET.SubElement(cp, "{%s}rect" % NS["svg"], {"x": f"{vb[0]:.2f}", "y": f"{vb[1]:.2f}", "width": f"{vb[2]:.2f}", "height": f"{vb[3]:.2f}"})
    body.set("clip-path", "url(#fcrop)")
    out.append(body)
    s = ET.tostring(out, encoding="unicode")
    # 1 つの画面に複数の図が並ぶので、id がぶつからないように接頭辞を付ける
    s = re.sub(r'id="([^"]+)"', lambda m: f'id="{prefix}-{m.group(1)}"', s)
    s = re.sub(r'href="#([^"]+)"', lambda m: f'href="#{prefix}-{m.group(1)}"', s)
    s = re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{prefix}-{m.group(1)})', s)
    s = s.replace("ns0:", "").replace(":ns0", "")
    # 数値の桁を減らして軽くする
    s = re.sub(r"(\d+\.\d{2})\d+", r"\1", s)
    return s


def raster(svg, scale=2.2, levels=8):
    """切り出した SVG を「線の濃さ＝透明度」の PNG にして、<image> 1 枚だけの軽い SVG に包む。
    白い部分は透明になり、背景色に関係なく見える。ダークモードではアプリの CSS（image.ink）で反転する。"""
    import io, base64, tempfile
    from PIL import Image
    src = svg.replace('fill="currentColor"', 'fill="#000"').replace('stroke="currentColor"', 'stroke="#000"')
    src = src.replace('class="bg"', 'fill="#fff"').replace('stroke="var(--surface)"', 'stroke="#fff"')
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(src); path = f.name
    png = subprocess.run(["rsvg-convert", "-z", str(scale), "-b", "white", path], check=True, capture_output=True).stdout
    os.unlink(path)
    im = Image.open(io.BytesIO(png)).convert("L")
    step = 255 / (levels - 1)
    alpha = im.point(lambda v: int(round((255 - v) / step) * step))
    out = Image.new("LA", im.size)
    out.putalpha(alpha)
    q = out.convert("RGBA").quantize(colors=levels, method=Image.Quantize.FASTOCTREE)
    buf = io.BytesIO(); q.save(buf, "PNG", optimize=True)
    w, h = im.size[0] / scale, im.size[1] / scale
    b64 = base64.b64encode(buf.getvalue()).decode()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {w:.1f} {h:.1f}">'
            f'<image class="ink" width="{w:.1f}" height="{h:.1f}" href="data:image/png;base64,{b64}"/></svg>')


def rcrop(pdf, page, x0, y0, x1, y1, pad=4, dpi=200, levels=8):
    """スキャン画像の PDF 用：ページを画像にして箱（pt 単位）を切り抜き、raster() と同じ形の SVG にする。"""
    import io, base64
    from PIL import Image
    key = os.path.basename(pdf).split("-", 1)[0]
    png = f"{CACHE}/{key}-{page}-{dpi}.png"
    if not os.path.exists(png):
        subprocess.run(["pdftoppm", "-r", str(dpi), "-f", str(page), "-l", str(page), "-gray", "-png", "-singlefile", pdf, png[:-4]],
                       check=True, stderr=subprocess.DEVNULL)
    s = dpi / 72
    im = Image.open(png).convert("L")
    im = im.crop((int((x0 - pad) * s), int((y0 - pad) * s), int((x1 + pad) * s), int((y1 + pad) * s)))
    step = 255 / (levels - 1)
    alpha = im.point(lambda v: 0 if v > 200 else int(round((255 - v) / step) * step))
    out = Image.new("LA", im.size); out.putalpha(alpha)
    q = out.convert("RGBA").quantize(colors=levels, method=Image.Quantize.FASTOCTREE)
    buf = io.BytesIO(); q.save(buf, "PNG", optimize=True)
    w, h = im.size[0] / s, im.size[1] / s
    b64 = base64.b64encode(buf.getvalue()).decode()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {w:.1f} {h:.1f}">'
            f'<image class="ink" width="{w:.1f}" height="{h:.1f}" href="data:image/png;base64,{b64}"/></svg>')
