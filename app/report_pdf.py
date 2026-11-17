# -*- coding: utf-8 -*-
"""The stock report as a PDF file (Phase 6), in Arabic or English.

The page sends the report's content already written in the user's language (labels, values, the chart as a PNG);
this module only lays it out on A4 pages. Arabic letters are joined with arabic_reshaper and put in visual order
with python-bidi, then drawn with IBM Plex Sans Arabic (SIL Open Font License, shipped in app/data/fonts)."""
import base64
import io
import os
import re
import time

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "fonts")
_READY = []


def _fonts():
    if _READY:
        return
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    pdfmetrics.registerFont(TTFont("MoR", os.path.join(FONT_DIR, "IBMPlexSansArabic-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("MoB", os.path.join(FONT_DIR, "IBMPlexSansArabic-Bold.ttf")))
    _READY.append(1)


AR = re.compile(r"[؀-ۿ]")


def visual(text, rtl):
    """Joined Arabic letters in display order; plain text otherwise."""
    import arabic_reshaper
    from bidi.algorithm import get_display
    t = str(text or "")
    if not AR.search(t):
        return t                      # numbers, codes and English read left to right even in an Arabic page
    return get_display(arabic_reshaper.reshape(t), base_dir="R" if rtl else "L")


def wrap(text, font, size, width):
    """Lines (in reading order) that fit the width; each line is measured as it will be drawn."""
    from reportlab.pdfbase.pdfmetrics import stringWidth
    out = []
    for para in str(text or "").split("\n"):
        words, line = para.split(" "), ""
        for w in words:
            cand = (line + " " + w).strip()
            if line and stringWidth(visual(cand, True), font, size) > width:
                out.append(line)
                line = w
            else:
                line = cand
        out.append(line)
    return out


class Doc:
    W, H, M = 595.27, 841.89, 40

    def __init__(self, rtl):
        from reportlab.pdfgen import canvas
        _fonts()
        self.buf = io.BytesIO()
        self.c = canvas.Canvas(self.buf, pagesize=(self.W, self.H))
        self.rtl, self.y, self.page = rtl, self.H - self.M, 1

    def need(self, h):
        if self.y - h < self.M + 20:
            self.footer()
            self.c.showPage()
            self.page += 1
            self.y = self.H - self.M

    def text(self, s, size=10, bold=False, color=(0.1, 0.1, 0.12), gap=4, indent=0):
        font = "MoB" if bold else "MoR"
        width = self.W - 2 * self.M - indent
        for line in wrap(s, font, size, width):
            self.need(size + gap)
            self.c.setFont(font, size)
            self.c.setFillColorRGB(*color)
            v = visual(line, self.rtl)
            if self.rtl:
                self.c.drawRightString(self.W - self.M - indent, self.y - size, v)
            else:
                self.c.drawString(self.M + indent, self.y - size, v)
            self.y -= size + gap

    def rule(self):
        self.need(10)
        self.c.setStrokeColorRGB(0.85, 0.86, 0.88)
        self.c.line(self.M, self.y - 4, self.W - self.M, self.y - 4)
        self.y -= 12

    def pairs(self, rows, cols=2):
        """Label, value and an optional note under it, side by side in columns."""
        w = (self.W - 2 * self.M) / cols
        for i in range(0, len(rows), cols):
            chunk = rows[i:i + cols]
            h = 44 if any(len(r) > 2 and r[2] for r in chunk) else 32
            self.need(h)
            for j, r in enumerate(chunk):
                x = (self.W - self.M - j * w) if self.rtl else (self.M + j * w)
                lines = ((0, r[0], "MoR", 8.5, (0.42, 0.45, 0.5)), (12, r[1], "MoB", 11, (0.1, 0.1, 0.12)))
                if len(r) > 2 and r[2]:
                    lines += ((26, r[2], "MoR", 8, (0.42, 0.45, 0.5)),)
                for dy, txt, f, sz, col in lines:
                    self.c.setFont(f, sz)
                    self.c.setFillColorRGB(*col)
                    t = visual(_fit(str(txt or "—"), f, sz, w - 8), self.rtl)
                    (self.c.drawRightString if self.rtl else self.c.drawString)(x, self.y - sz - dy, t)
            self.y -= h

    def image(self, data_url, max_h=260):
        m = re.match(r"^data:image/(png|jpeg);base64,(.+)$", data_url or "", re.S)
        if not m:
            return
        from reportlab.lib.utils import ImageReader
        img = ImageReader(io.BytesIO(base64.b64decode(m.group(2))))
        iw, ih = img.getSize()
        w = self.W - 2 * self.M
        h = min(max_h, w * ih / iw)
        w = h * iw / ih
        self.need(h + 8)
        self.c.drawImage(img, (self.W - w) / 2, self.y - h, w, h)
        self.y -= h + 8

    def footer(self):
        self.c.setFont("MoR", 7.5)
        self.c.setFillColorRGB(0.5, 0.52, 0.56)
        s = visual(self.foot, self.rtl)
        self.c.drawCentredString(self.W / 2, 22, s + "  ·  " + str(self.page))

    def finish(self):
        self.footer()
        self.c.save()
        return self.buf.getvalue()


def _fit(s, font, size, width):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    while s and stringWidth(visual(s, True), font, size) > width:
        s = s[:-2] + "…" if len(s) > 2 else ""
    return s


def build(d):
    """d: {lang, title, subtitle, chart, sections: [{title, pairs?: [[k, v]], text?: str, items?: [str]}], footer}"""
    rtl = d.get("lang", "ar") != "en"
    doc = Doc(rtl)
    doc.foot = str(d.get("footer") or "Mo Stocks")[:200]
    doc.text(str(d.get("title") or "")[:200], size=18, bold=True, gap=6)
    if d.get("subtitle"):
        doc.text(str(d["subtitle"])[:300], size=9.5, color=(0.42, 0.45, 0.5), gap=6)
    doc.rule()
    if d.get("chart"):
        doc.image(d["chart"])
    for sec in (d.get("sections") or [])[:30]:
        if not isinstance(sec, dict):
            continue
        doc.need(40)
        doc.text(str(sec.get("title") or "")[:160], size=12.5, bold=True, color=(0.15, 0.32, 0.75), gap=6)
        if sec.get("pairs"):
            doc.pairs([tuple(str(x)[:120] for x in p[:3]) for p in sec["pairs"][:40] if isinstance(p, (list, tuple)) and len(p) >= 2],
                      cols=int(sec.get("cols") or 3))
        for it in (sec.get("items") or [])[:60]:
            doc.text("• " + str(it)[:600], size=9.5, gap=3, indent=6)
        for line in str(sec.get("text") or "")[:12000].split("\n"):
            ln = line.strip().replace("**", "")
            if not ln:
                doc.y -= 3
            elif ln.startswith("#"):
                doc.text(ln.lstrip("#").strip(), size=10.5, bold=True, gap=3)
            elif re.match(r"^[-•*]\s+", ln):
                doc.text("• " + re.sub(r"^[-•*]\s+", "", ln), size=9.5, gap=3, indent=6)
            else:
                doc.text(ln, size=9.5, gap=3)
        doc.y -= 6
    if d.get("disclaimer"):
        doc.rule()
        doc.text(str(d["disclaimer"])[:800], size=8, color=(0.42, 0.45, 0.5), gap=3)
    return doc.finish()


def save(d, folder):
    data = build(d)
    name = re.sub(r"[^\w\-.]+", "_", "MoStocks_%s_%s" % (d.get("code") or "report", time.strftime("%Y-%m-%d")))[:80] + ".pdf"
    path = os.path.join(folder, name)
    base, i = path[:-4], 1
    while os.path.exists(path):
        path = "%s (%d).pdf" % (base, i)
        i += 1
    with open(path, "wb") as f:
        f.write(data)
    return path
