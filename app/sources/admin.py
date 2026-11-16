# -*- coding: utf-8 -*-
"""Settings-side helpers: list the sources, switch one off, save or delete a key, test a source."""
import time

from .base import REG, NoData
from . import health


def _core():
    import core
    return core


def status():
    return {"ok": True, "sources": REG.status(), "ranking": REG.ranking(), "auto": REG.auto(),
            "watch": bool(_core().Store.get("src_watch", True)),
            "checking": health.BUSY.is_set()}


def set_auto(on):
    _core().Store.set("src_auto", bool(on))
    return status()


def set_watch(on):
    _core().Store.set("src_watch", bool(on))
    return status()


def reset():
    REG.reset()
    health.ROUNDS.clear()
    health.ALERTED.clear()
    return status()


def probe_now():
    """Start a check round in the background; the page polls the status."""
    if not health.BUSY.is_set():
        import threading
        threading.Thread(target=lambda: health.check_all(notify=False), daemon=True).start()
    return dict(status(), checking=True)


def set_enabled(cid, enabled):
    if cid not in REG.items:
        return {"ok": False, "error": "مصدر غير معروف."}
    c = _core()
    off = [i for i in (c.Store.get("src_off", []) or []) if i != cid]
    if not enabled:
        off.append(cid)
    c.Store.set("src_off", off)
    return status()


def set_key(cid, key):
    conn = REG.items.get(cid)
    key = (key or "").strip()
    if not conn or not conn.key_service:
        return {"ok": False, "error": "هذا المصدر لا يحتاج مفتاحًا."}
    if len(key) < 8 or len(key) > 200 or any(ch.isspace() for ch in key):
        return {"ok": False, "error": "المفتاح لا يبدو صحيحًا."}
    conn.save_key(key)
    return status()


def delete_key(cid):
    conn = REG.items.get(cid)
    if conn and conn.key_service:
        conn.delete_key()
    return status()


def test(cid):
    """Make one small real request so the user sees at once whether the source (and its key) works."""
    conn = REG.items.get(cid)
    if not conn:
        return {"ok": False, "error": "مصدر غير معروف."}
    if not conn.ready():
        return {"ok": False, "error": "أضف المفتاح أولًا." if conn.key_service else "المصدر غير جاهز."}
    probes = [("history", dict(code="AAPL", ex="US", rng="1y", interval="1d", lite=True)),
              ("fundamentals", dict(code="AAPL", ex="US")), ("news", dict(q="Apple", region="US")),
              ("sharia", {})]
    for kind, kw in probes:
        if kind in conn.kinds:
            break
    else:
        return {"ok": True, "skipped": True}
    t0 = time.time()
    tried = []
    v, err = REG._attempt(conn, kind, tried, kw)
    ms = round((time.time() - t0) * 1000)
    if err is None:
        return {"ok": True, "ms": ms, "kind": kind}
    if isinstance(err, NoData):
        return {"ok": True, "ms": ms, "kind": kind, "nodata": True}
    return {"ok": False, "ms": ms, "kind": kind, "error": str(err)[:200]}
