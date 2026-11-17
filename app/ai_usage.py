# -*- coding: utf-8 -*-
"""What the AI assistants cost (Phase 5, step 1).

Every answer is recorded with the tokens the provider says it used. The cost is an estimate from a price table
(app/data/ai_prices.json, with the user's own prices from Settings taking the lead). A monthly limit in dollars,
when set, stops new requests once the month's estimate reaches it, until the user confirms a request."""
import json
import os
import threading
import time

import core

PRICES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "ai_prices.json")
LOCK = threading.Lock()
KEEP = 300                     # recent requests kept in the log


def table():
    try:
        with open(PRICES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"rows": [], "search": {}}


def price_of(model, user=None):
    """(input, output) dollars per million tokens: the user's own price for the model first, then the longest
    matching name in the table. None when the model is unknown (its cost is then shown as unknown, not as zero)."""
    m = (model or "").strip().lower()
    for k, v in (user or {}).items():
        if k.strip().lower() == m and isinstance(v, (list, tuple)) and len(v) == 2:
            try:
                return float(v[0]), float(v[1])
            except (TypeError, ValueError):
                pass
    best = None
    for name, i, o in table().get("rows") or []:
        if m.startswith(name) and (best is None or len(name) > len(best[0])):
            best = (name, i, o)
    return (best[1], best[2]) if best else None


def cost(prov, model, usage, searches=0, user=None):
    p = price_of(model, user)
    if not p or not usage:
        return None
    c = (usage.get("in") or 0) / 1e6 * p[0] + (usage.get("out") or 0) / 1e6 * p[1]
    c += (searches or 0) * ((table().get("search") or {}).get(prov) or 0)
    return round(c, 6)


def month_key(t=None):
    return time.strftime("%Y-%m", time.localtime(t or time.time()))


def _prefs():
    return core.Store.get("prefs", {}) or {}


def cap():
    """The monthly limit in dollars, or None when the user has not set one."""
    c = _prefs().get("aiCap") or {}
    try:
        v = float(c.get("usd"))
    except (TypeError, ValueError):
        return None
    return v if c.get("on") and v > 0 else None


def month_spent(month=None):
    m = (core.Store.get("aiUsage", {}) or {}).get("months", {}).get(month or month_key()) or {}
    return m.get("cost", 0.0)


def blocked():
    """A reason to hold the request (the month's estimate reached the limit), or None."""
    c = cap()
    if c is None:
        return None
    s = month_spent()
    return {"cap": c, "spent": round(s, 4)} if s >= c else None


def record(prov, model, usage, searches=0, kind="ask"):
    """Add one answer to the month's totals and to the recent list; returns its estimated cost (or None)."""
    user = _prefs().get("aiPrices") or {}
    c = cost(prov, model, usage, searches, user)
    with LOCK:
        d = core.Store.get("aiUsage", {}) or {}
        months = d.setdefault("months", {})
        m = months.setdefault(month_key(), {"cost": 0.0, "in": 0, "out": 0, "n": 0, "unknown": 0, "byProv": {}})
        m["in"] += (usage or {}).get("in") or 0
        m["out"] += (usage or {}).get("out") or 0
        m["n"] += 1
        if c is None:
            m["unknown"] += 1
        else:
            m["cost"] = round(m["cost"] + c, 6)
            bp = m["byProv"].setdefault(prov, 0.0)
            m["byProv"][prov] = round(bp + c, 6)
        for k in sorted(months)[:-13]:                 # a year of months is enough
            del months[k]
        rec = d.setdefault("recent", [])
        rec.insert(0, {"t": int(time.time() * 1000), "prov": prov, "model": model, "in": (usage or {}).get("in"),
                       "out": (usage or {}).get("out"), "cost": c, "kind": kind, "searches": searches or 0})
        del rec[KEEP:]
        core.Store.set("aiUsage", d)
    return c


def summary():
    d = core.Store.get("aiUsage", {}) or {}
    t = table()
    return {"ok": True, "month": month_key(), "months": d.get("months", {}), "recent": (d.get("recent") or [])[:50],
            "cap": cap(), "spent": round(month_spent(), 6), "checked": t.get("checked"), "note": t.get("note"),
            "sources": t.get("sources"), "rows": t.get("rows")}
