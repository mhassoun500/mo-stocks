# -*- coding: utf-8 -*-
"""Periodic check of every ready source with one small real request per market, and an alert when a source breaks."""
import threading
import time

from .base import REG, MARKETS, NoData

INTERVAL = 3 * 3600
FIRST_DELAY = 300
SYMBOL = {"SR": "1120", "CA": "COMI", "US": "AAPL"}
ROUNDS = {}        # connector id -> consecutive rounds in which every probe failed
ALERTED = set()    # connectors already announced as down
BUSY = threading.Event()


def _core():
    import core
    return core


def probes(conn):
    """(kind, market, kwargs) the check makes for one connector."""
    out = []
    for kind in ("history", "fundamentals"):
        if kind in conn.kinds:
            for mk in MARKETS:
                if mk in conn.markets:
                    kw = dict(code=SYMBOL[mk], ex=mk)
                    if kind == "history":
                        kw.update(rng="1y", interval="1d", lite=True)
                    out.append((kind, mk, kw))
    if "news" in conn.kinds:
        out.append(("news", "US", dict(q="Apple", region="US")))
    return out


def check_all(notify=True):
    """One round over every ready connector. Returns {connector id: "ok" | "down" | "idle"}."""
    if BUSY.is_set():
        return {}
    BUSY.set()
    result = {}
    try:
        for cid, conn in list(REG.items.items()):
            if not conn.available():
                continue
            ps = probes(conn)
            if not ps:
                continue
            good = bad = 0
            for kind, mk, kw in ps:
                if _core().QUIT.is_set():
                    return result
                v, err = REG._attempt(conn, kind, [], kw, mk)
                if err is None:
                    good += 1
                elif not isinstance(err, NoData):
                    bad += 1
            if good:
                ROUNDS[cid] = 0
                result[cid] = "ok"
                if cid in ALERTED:
                    ALERTED.discard(cid)
            elif bad:
                ROUNDS[cid] = ROUNDS.get(cid, 0) + 1
                result[cid] = "down"
                if ROUNDS[cid] >= 2 and cid not in ALERTED:
                    ALERTED.add(cid)
                    if notify:
                        alert(conn)
            else:
                result[cid] = "idle"
        REG.maybe_save(True)
    finally:
        BUSY.clear()
    return result


def alert(conn):
    c = _core()
    if not c.Store.get("src_watch", True):
        return
    title = "Mo Stocks"
    body = "تعذّر الاتصال بمصدر البيانات %s في آخر فحصين. يستخدم البرنامج المصادر الأخرى." % conn.name
    try:
        import system
        system.notify_desktop(title, body)
        if c.pref("telegram.chatId", "") and c.tg_token():
            system.telegram_send("⚠️ " + body)
    except Exception as e:
        c.record("WARN", "source alert", e)


def loop():
    c = _core()
    c.QUIT.wait(FIRST_DELAY)
    while not c.QUIT.is_set():
        if c.Store.get("src_watch", True):
            try:
                check_all()
            except Exception as e:
                c.record("WARN", "source check", e)
        c.QUIT.wait(INTERVAL)
