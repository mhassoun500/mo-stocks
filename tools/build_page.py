#!/usr/bin/env python3
"""Assemble app/web/* into the single-file app/page.html (served by the desktop app and
published as the web page). Optionally download the Google Fonts for offline use:

    python tools/build_page.py            # build page.html
    python tools/build_page.py --fonts    # also refresh app/fonts/ (needs internet)
"""
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


def build():
    head = read("head.html")
    body = read("body.html").replace("{{LOGO}}", read("logo.inc").strip())
    js = "\n".join(read("js", n + ".js") for n in JS_ORDER)
    page = head.rstrip() + "\n\n" + body.rstrip() + "\n\n<script>\n(function(){\n'use strict';\n" + js + "\n})();\n</script>\n"
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
