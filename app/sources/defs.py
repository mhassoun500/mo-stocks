# -*- coding: utf-8 -*-
"""Definitions file: the few things that change when a website changes its layout (page patterns and list addresses).

It is DATA only. A newer copy is read from the project's repository on GitHub, checked, and used only if every check
passes; nothing in it is ever executed. If a check fails, or there is no connection, the built-in values are used.
"""
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

SCHEMA = 1
MAX_BYTES = 64 * 1024
REPO = "mhassoun500/mo-stocks"
PATH = "defs/definitions.json"
HOSTS = ("www.argaam.com", "stocks.templatesnippet.com", "www.sp-funds.com")
PURIFY_HOSTS = ("data.argaam.com", "almaqased.net", "www.almaqased.net")
REGEX_KEYS = ("ref_re", "ref_alt_re", "row_re", "cell_re", "name_prefix_re")

DEFAULTS = {
    "schema": SCHEMA, "version": 1, "min_app": "2.11.0", "updated": "2026-11-17",
    "urls": {
        "argaam": "https://www.argaam.com/ar/company/shariahcompanies/1/3/%d",
        "eg": "https://stocks.templatesnippet.com/data/stocks_merged.json",
        "spus": "https://www.sp-funds.com/wp-content/uploads/data/TidalFG_Holdings_SPUS.csv",
    },
    "argaam": {
        "ref_re": r'<span class="inst_name">([^<]+)</span>\s*<br\s*/?>\s*<sup[^>]*>[^<]*<br\s*/?>\s*<span>([^<]*)</span>',
        "ref_alt_re": r'<span class="inst_name">([^<]+)</span>',
        "row_re": r'<td class="stock-symbol">\s*(\d+)\s*</td>\s*<td class="argaam-font company-name">\s*<a [^>]*>([^<]+)</a>\s*</td>(.*?)</tr>',
        "cell_re": r'<td class="center">(.*?)</td>',
        "name_prefix_re": r"^شركة\s+",
        "tick": "✔",
    },
    # optional (older apps ignore it): the yearly purification study; a new year's file only needs a new address here
    "purify": {
        "maqased_sa": {"url": "https://data.argaam.com/files/download/2ac6ef5f-f610-4fcf-98ca-05a1e6358c0d.pdf", "period": "2025"},
    },
}

# a page excerpt in the layout the patterns above expect; any new pattern must still read it correctly
SAMPLE_PAGE = (
    '<span class="inst_name">الراجحي المالية</span><br/><sup class="x">تاريخ<br/><span>2026-06-30</span></sup>'
    '<span class="inst_name">العثيمين</span><br/><sup class="x">تاريخ<br/><span>2026-05-31</span></sup>'
    '<table><tr><td class="stock-symbol"> 1120 </td><td class="argaam-font company-name"><a href="/x">شركة الراجحي</a></td>'
    '<td class="center">✔</td><td class="center"></td></tr></table>')
SAMPLE_EXPECT = ([["الراجحي المالية", "2026-06-30"], ["العثيمين", "2026-05-31"]], {"1120": {"n": "الراجحي", "v": "10"}})

LOCK = threading.Lock()
STATE = {"loaded": None, "source": "built-in", "checked": 0, "error": ""}


def _core():
    import core
    return core


def _vt(s):
    return tuple(int(x) for x in re.findall(r"\d+", str(s))[:3]) or (0,)


def validate(d, app_version=None):
    """Returns (ok, reason). Strict: unknown shapes are rejected, not repaired."""
    if not isinstance(d, dict):
        return False, "not an object"
    if d.get("schema") != SCHEMA:
        return False, "unsupported schema"
    if not isinstance(d.get("version"), int) or d["version"] < 1:
        return False, "bad version"
    if app_version and app_version != "dev" and _vt(d.get("min_app", "0")) > _vt(app_version):
        return False, "needs a newer app"
    urls = d.get("urls")
    if not isinstance(urls, dict) or set(urls) != set(DEFAULTS["urls"]):
        return False, "urls"
    for k, u in urls.items():
        p = urllib.parse.urlparse(u) if isinstance(u, str) else None
        if not p or p.scheme != "https" or p.hostname not in HOSTS or len(u) > 300:
            return False, "url %s not allowed" % k
    if "%d" not in urls["argaam"]:
        return False, "argaam url needs %d"
    a = d.get("argaam")
    if not isinstance(a, dict) or set(a) != set(DEFAULTS["argaam"]):
        return False, "argaam"
    for k in REGEX_KEYS:
        v = a.get(k)
        if not isinstance(v, str) or not v or len(v) > 700:
            return False, "pattern %s" % k
        try:
            re.compile(v, re.S)
        except re.error:
            return False, "pattern %s does not compile" % k
    if not isinstance(a.get("tick"), str) or not 0 < len(a["tick"]) <= 4:
        return False, "tick"
    if "purify" in d:
        pu = d["purify"]
        if not isinstance(pu, dict) or set(pu) - {"maqased_sa"}:
            return False, "purify"
        for k, v in pu.items():
            u = v.get("url") if isinstance(v, dict) else None
            p = urllib.parse.urlparse(u) if isinstance(u, str) else None
            if not p or p.scheme != "https" or p.hostname not in PURIFY_HOSTS or len(u) > 300:
                return False, "purify url %s not allowed" % k
            if not isinstance(v.get("period", ""), str) or len(v.get("period", "")) > 12 or set(v) - {"url", "period"}:
                return False, "purify %s" % k
    # behavioural check: the patterns must read the built-in sample page correctly
    try:
        import sharia
        got = sharia.parse_argaam(SAMPLE_PAGE, a)
    except Exception as e:
        return False, "sample page failed (%s)" % e
    if got != SAMPLE_EXPECT:
        return False, "sample page read wrongly"
    return True, ""


def _file():
    return os.path.join(_core().DATA_DIR, "definitions.json")


def current():
    with LOCK:
        return STATE["loaded"] or DEFAULTS


def get(*path):
    v = current()
    for k in path:
        v = v[k]
    return v


def purify(key="maqased_sa"):
    """Address and financial year of a purification study: the downloaded definitions if they name one, else built-in."""
    return (current().get("purify") or DEFAULTS["purify"]).get(key) or DEFAULTS["purify"][key]


def load():
    """Use the downloaded copy if it is valid and newer than the built-in one."""
    try:
        with open(_file(), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return False
    ok, why = validate(d, _core().VERSION)
    if ok and d["version"] > DEFAULTS["version"]:
        with LOCK:
            STATE.update(loaded=d, source="downloaded")
        return True
    if not ok:
        _core().record("WARN", "defs.load", "saved definitions rejected: %s" % why)
    return False


def fetch(repo=None, timeout=15):
    repo = (repo or REPO).strip()
    if not re.match(r"^[\w.-]+/[\w.-]+$", repo):
        raise ValueError("bad repository name")
    url = "https://raw.githubusercontent.com/%s/main/%s" % (repo, PATH)
    req = urllib.request.Request(url, headers={"User-Agent": "MoStocks"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("definitions file too large")
    return json.loads(raw.decode("utf-8"))


def refresh(repo=None):
    """Download, check, keep. Returns {"ok", "changed", "version", "error"}; never raises."""
    core = _core()
    out = {"ok": True, "changed": False}
    try:
        d = fetch(repo)
        ok, why = validate(d, core.VERSION)
        if not ok:
            raise ValueError("definitions file rejected: %s" % why)
        if d["version"] > current()["version"]:
            tmp = _file() + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False)
            os.replace(tmp, _file())
            with LOCK:
                STATE.update(loaded=d, source="downloaded")
            out["changed"] = True
        STATE["error"] = ""
    except Exception as e:
        STATE["error"] = str(e)[:200]
        core.record("WARN", "defs.refresh", e)
        out.update(ok=False, error=STATE["error"])
    STATE["checked"] = time.time()
    out["version"] = current()["version"]
    return out


def status():
    c = current()
    return {"version": c["version"], "updated": c.get("updated", ""), "source": STATE["source"],
            "builtin": DEFAULTS["version"], "checked": STATE["checked"], "error": STATE["error"]}


def loop(quit_event):
    quit_event.wait(120)
    while not quit_event.is_set():
        try:
            if _core().Store.get("defs_auto", True):
                refresh()
        except Exception as e:
            _core().record("WARN", "defs.loop", e)
        quit_event.wait(24 * 3600)
