#!/usr/bin/env python3
"""List every Arabic UI string (JS literals, HTML text and attributes, server messages) so each
can be given an English translation in tools/i18n/en.json."""
import glob, json, os, re, sys
from html.parser import HTMLParser
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "app", "web")
AR = re.compile(r"[؀-ۿ]")
JS_LIT = re.compile(r"'((?:[^'\\\n]|\\.)*)'")
ESC = {"'": "'", '"': '"', "n": "\n", "\\": "\\", "t": "\t", "/": "/"}


def js_unescape(s):
    return re.sub(r"\\(.)", lambda m: ESC.get(m.group(1), m.group(1)), s)


def js_strings():
    out = []
    for f in glob.glob(os.path.join(WEB, "js", "*.js")):
        for line in open(f, encoding="utf-8"):
            code = re.sub(r"/\*.*?\*/", "", line)
            if code.lstrip().startswith("//"):
                continue
            for m in JS_LIT.finditer(code):
                if AR.search(m.group(1)):
                    out.append(js_unescape(m.group(1)))
    return out


class Html(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        for k, v in attrs:
            if k in ("placeholder", "title", "aria-label", "label", "data-tip") and v and AR.search(v):
                self.out.append(" ".join(v.split()))

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1

    def handle_data(self, d):
        t = " ".join(d.split())
        if not self.skip and t and AR.search(t):
            self.out.append(t)


def html_strings():
    p = Html()
    p.feed(open(os.path.join(WEB, "body.html"), encoding="utf-8").read())
    p.feed(open(os.path.join(WEB, "head.html"), encoding="utf-8").read())
    return p.out


PY_LIT = re.compile(r'"((?:[^"\\\n]|\\.)*)"')


def server_strings():
    out = []
    for f in ("main.py", "funds.py", "tvdata.py"):
        for line in open(os.path.join(ROOT, "app", f), encoding="utf-8"):
            if line.lstrip().startswith("#"):
                continue
            for m in PY_LIT.finditer(line):
                if AR.search(m.group(1)):
                    out.append(m.group(1).replace('\\"', '"'))
    return out


if __name__ == "__main__":
    seen, items = set(), []
    for kind, lst in (("js", js_strings()), ("html", html_strings()), ("srv", server_strings())):
        for s in lst:
            if (kind, s) in seen:
                continue
            seen.add((kind, s))
            items.append([kind, s])
    have = {}
    p = os.path.join(ROOT, "tools", "i18n", "en.json")
    if os.path.exists(p):
        have = json.load(open(p, encoding="utf-8"))
    skip = set(json.load(open(os.path.join(ROOT, "tools", "i18n", "keep_arabic.json"), encoding="utf-8"))) if os.path.exists(os.path.join(ROOT, "tools", "i18n", "keep_arabic.json")) else set()
    missing = [i for i in items if i[1] not in have and i[1] not in skip]
    json.dump(items, open(os.path.join(ROOT, "tools", "i18n", "strings.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(len(items), "strings,", len(missing), "without translation")
    if "--missing" in sys.argv:
        for k, s in missing:
            print(k, "|", s)
