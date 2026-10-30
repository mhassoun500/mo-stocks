#!/usr/bin/env python3
"""Assemble app/web/* into the single-file app/page.html (served by the desktop app and
published as the web page). Optionally download the Google Fonts for offline use:

    python tools/build_page.py            # build page.html
    python tools/build_page.py --fonts    # also refresh app/fonts/ (needs internet)
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "app", "web")
JS_ORDER = ["core", "indicators", "engine", "chart", "views", "fundsui", "favs", "watch", "journal", "prefs", "boot"]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def read(*p):
    with open(os.path.join(WEB, *p), encoding="utf-8") as f:
        return f.read()


AR = re.compile(r"[\u0600-\u06FF]")
JS_LIT = re.compile(r"'((?:[^'\\\n]|\\.)*)'")
I18N_DIR = os.path.join(ROOT, "tools", "i18n")


def wrap_js_strings(js):
    """Every Arabic string literal becomes _t('...') so it shows in English when that language is on."""
    out = []
    for line in js.split("\n"):
        if line.lstrip().startswith("//"):
            out.append(line)
            continue
        out.append(JS_LIT.sub(lambda m: "_t(%s)" % m.group(0) if AR.search(m.group(1)) else m.group(0), line))
    return "\n".join(out)


def server_pattern(ar):
    """'تعذّر جلب %s' -> a regex for the message as the page receives it, with groups for the values."""
    parts = re.split(r"%(?:-?\d*(?:\.\d+)?)[sdf]", ar.replace("%%", "%"))
    return "(.+?)".join(re.escape(p) for p in parts), len(parts) - 1


def i18n_data():
    path = os.path.join(I18N_DIR, "en.json")
    if not os.path.exists(path):
        return {"t": {}, "p": []}
    en = json.load(open(path, encoding="utf-8"))
    t, pats = {}, []
    for ar, tr in en.items():
        if not tr:
            continue
        if re.search(r"%(?:-?\d*(?:\.\d+)?)[sdf]", ar):
            rx, n = server_pattern(ar)
            k = iter(range(1, n + 1))
            rep = re.sub(r"%(?:-?\d*(?:\.\d+)?)[sdf]", lambda m: "$%d" % next(k), tr.replace("%%", "%"))
            pats.append([rx, rep])
        else:
            t[" ".join(ar.split()) if "<" not in ar else ar] = tr
            t[ar] = tr
    return {"t": t, "p": pats}


def build():
    head = read("head.html")
    body = read("body.html").replace("{{LOGO}}", read("logo.inc").strip())
    js = wrap_js_strings("\n".join(read("js", n + ".js") for n in JS_ORDER))
    data = json.dumps(i18n_data(), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = (head.rstrip() + "\n\n" + body.rstrip() + '\n\n<script type="application/json" id="i18n-data">' + data
            + "</script>\n<script>\n(function(){\n'use strict';\n" + js + "\n})();\n</script>\n")
    out = os.path.join(ROOT, "app", "page.html")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print("wrote", out, len(page) // 1024, "KB")


def fetch_fonts():
    head = read("head.html")
    url = re.search(r'href="(https://fonts\.googleapis\.com/css2[^"]+)"', head).group(1).replace("&amp;", "&")
    css = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read().decode()
    dest = os.path.join(ROOT, "app", "fonts")
    os.makedirs(dest, exist_ok=True)
    for old in os.listdir(dest):
        os.remove(os.path.join(dest, old))
    n = 0

    def repl(m):
        nonlocal n
        n += 1
        name = "f%03d.woff2" % n
        data = urllib.request.urlopen(urllib.request.Request(m.group(1), headers={"User-Agent": UA}), timeout=30).read()
        with open(os.path.join(dest, name), "wb") as f:
            f.write(data)
        return "url(/fonts/%s)" % name

    css = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", repl, css)
    with open(os.path.join(dest, "fonts.css"), "w", encoding="utf-8") as f:
        f.write(css)
    print("fonts:", n, "files")


if __name__ == "__main__":
    if "--fonts" in sys.argv:
        fetch_fonts()
    build()
