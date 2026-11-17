# -*- coding: utf-8 -*-
"""Fill what the data sources could not give, by asking the AI assistant to search the web.

The answers are kept apart from confirmed data: each one must carry a link to the page it came from, is checked here
(type, range, date), and is shown in the page with its own label. Anything without a usable link is dropped.
"""
import datetime
import json
import math
import re
import urllib.parse

FIELDS = ("fair", "sharia", "purification", "earnings")
VERDICTS = ("ok", "no", "doubt")
LABEL = {"fair": "القيمة العادلة", "sharia": "الحكم الشرعي", "purification": "نسبة التطهير", "earnings": "موعد إعلان الأرباح"}

SYSTEM = ("You are a careful financial research assistant. Search the web and answer ONLY with one JSON object, no other text. "
          "Use null for anything you cannot find on a page you actually opened. Never estimate, never guess, never invent a link. "
          "Every answer needs the exact https link of the page that states it.")


def build_prompt(code, name, ex, missing):
    market = {"SR": "Saudi Exchange (Tadawul)", "CA": "Egyptian Exchange (EGX)", "US": "US market"}.get(ex, ex)
    want = [f for f in FIELDS if f in (missing or [])]
    spec = {
        "fair": '"fair": {"value": number, "currency": "ISO code", "basis": "who estimated it and how, one short sentence", "url": "https://..."}',
        "sharia": '"sharia": {"verdict": "ok | no | doubt", "by": "the body or list that ruled", "date": "YYYY-MM-DD or empty", "url": "https://..."}',
        "purification": '"purification": {"pct": number between 0 and 100, "by": "who published it", "date": "YYYY-MM-DD or empty", "url": "https://..."}',
        "earnings": '"earnings": {"date": "YYYY-MM-DD", "url": "https://..."}',
    }
    user = ("Stock: %s (%s) on %s.\nFind only these items: %s.\nReturn exactly this JSON shape, using null for an item you cannot source:\n{%s}"
            % (code, name or code, market, ", ".join(want), ", ".join(spec[f] for f in want)))
    return SYSTEM, user


def _num(v, lo, hi):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) and lo < x <= hi else None


def _url(u):
    if not isinstance(u, str) or len(u) > 400:
        return None
    p = urllib.parse.urlparse(u.strip())
    if p.scheme != "https" or not p.hostname or "." not in p.hostname:
        return None
    return u.strip()


def _date(s, back=400, ahead=500):
    try:
        d = datetime.date.fromisoformat(str(s)[:10])
    except ValueError:
        return None
    today = datetime.date.today()
    return d.isoformat() if today - datetime.timedelta(days=back) <= d <= today + datetime.timedelta(days=ahead) else None


def _text(s, n=160):
    return " ".join(str(s or "").split())[:n]


def parse_reply(text, missing=None):
    """-> {"items": {field: {...}}, "rejected": {field: reason}}. Only checked items are returned."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return {"items": {}, "rejected": {"all": "no JSON in the reply"}}
    try:
        d = json.loads(m.group(0))
    except ValueError:
        return {"items": {}, "rejected": {"all": "the reply is not valid JSON"}}
    if not isinstance(d, dict):
        return {"items": {}, "rejected": {"all": "unexpected shape"}}
    items, bad = {}, {}
    for f in FIELDS:
        v = d.get(f)
        if v is None or (missing is not None and f not in missing):
            continue
        if not isinstance(v, dict):
            bad[f] = "unexpected shape"
            continue
        url = _url(v.get("url"))
        if not url:
            bad[f] = "no usable source link"
            continue
        if f == "fair":
            x = _num(v.get("value"), 0, 1e7)
            if x is None:
                bad[f] = "value out of range"
                continue
            items[f] = {"value": x, "currency": _text(v.get("currency"), 8).upper(), "basis": _text(v.get("basis")), "url": url}
        elif f == "sharia":
            if v.get("verdict") not in VERDICTS:
                bad[f] = "unknown verdict"
                continue
            items[f] = {"verdict": v["verdict"], "by": _text(v.get("by")), "date": _date(v.get("date"), 3000, 0) or "", "url": url}
        elif f == "purification":
            x = _num(v.get("pct"), 0, 100)
            if x is None:
                bad[f] = "percentage out of range"
                continue
            items[f] = {"pct": x, "by": _text(v.get("by")), "date": _date(v.get("date"), 3000, 0) or "", "url": url}
        else:
            dt = _date(v.get("date"), 30, 500)
            if not dt:
                bad[f] = "date out of range"
                continue
            items[f] = {"date": dt, "url": url}
    return {"items": items, "rejected": bad}


def fill(AI, prov, model, base, code, name, ex, missing):
    """Ask the assistant (web search required) and return checked items."""
    missing = [f for f in (missing or []) if f in FIELDS]
    if not missing:
        return {"ok": False, "error": "لا يوجد ما يُملأ."}
    from ai_providers import PROVIDERS
    if not PROVIDERS.get(prov, {}).get("web"):
        return {"ok": False, "error": "هذه الميزة تحتاج بحثًا على الإنترنت، وهو غير متاح مع هذا الاختيار. استخدم Claude أو Gemini بحساب يدعم البحث."}
    system, user = build_prompt(code, name, ex, missing)
    r = AI.ask(prov, model, system, user, True, base=base, max_tokens=1500, kind="fill")
    if not r.get("ok"):
        return r
    if r.get("noWeb"):
        return {"ok": False, "error": "هذه الميزة تحتاج بحثًا على الإنترنت، وهو غير متاح مع هذا الاختيار. استخدم Claude أو Gemini بحساب يدعم البحث."}
    p = parse_reply(r.get("text"), missing)
    p.update(ok=True, name=r.get("name"), model=r.get("model"), searches=r.get("searches", 0), missing=missing)
    return p
