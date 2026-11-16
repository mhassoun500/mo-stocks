"""Step 2: the learning record, automatic order, majority vote, data checks, periodic check, silent errors logged."""
import collections
import json
import os
import time

import pytest

import core
import main
import markets
import prices
import system
import tvdata
import sources
from sources import base, consensus, core_sources, health, keyed, quality, admin
from sources.base import Connector, NoData, REG, Registry, MIN_SAMPLES


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(base, "sleep", lambda s: None)
    monkeypatch.setattr(tvdata.CLIENT, "available", lambda: False)
    monkeypatch.setattr(prices, "fetch_stooq", lambda sym: (_ for _ in ()).throw(prices.NotFound("x")))
    monkeypatch.setattr(REG, "path", None)
    REG.detail.clear()
    prices.MEM.clear()
    markets.MEM.clear()
    core.Store.set("src_off", [])
    core.Store.set("prefs", {})
    core.Store.set("src_auto", True)
    core.Store.set("src_cross", False)
    health.ROUNDS.clear()
    health.ALERTED.clear()
    yield


def feed(kind, market, cid, oks, fails=0, ms=300.0):
    for _ in range(oks):
        REG._count(cid, "ok", ms, kind=kind, market=market)
    for _ in range(fails):
        REG._count(cid, "fail", err="boom", kind=kind, market=market)


# ---------------------------------------------------------------- learning and order
def test_default_order_is_kept_until_there_is_enough_history():
    feed("history", "SR", "yahoo", 2)
    feed("history", "SR", "stooq", 0, 2)
    assert REG.ids("history", "SR") == REG.order["history"]          # fewer than MIN_SAMPLES outcomes


def test_a_source_that_keeps_failing_in_one_market_drops_behind_in_that_market_only():
    tv_first = REG.order["history"]
    assert tv_first[0] == "tradingview" and tv_first.index("yahoo") == 1
    feed("history", "SR", "tradingview", 2, 8)       # bad in Saudi Arabia
    feed("history", "SR", "yahoo", 10)
    feed("history", "US", "tradingview", 10)
    feed("history", "US", "yahoo", 10)
    assert REG.ids("history", "SR").index("yahoo") < REG.ids("history", "SR").index("tradingview")
    assert REG.ids("history", "US")[:2] == ["tradingview", "yahoo"]


def test_three_failures_in_a_row_send_a_source_to_the_back_for_a_while():
    feed("history", "US", "tradingview", 12)
    assert REG.ids("history", "US")[0] == "tradingview"
    feed("history", "US", "tradingview", 0, 3)
    assert REG.ids("history", "US")[-1] == "tradingview"
    REG.d("history", "US", "tradingview")["lastFail"] -= base.COOLDOWN + 5      # the pause is over
    assert REG.ids("history", "US")[0] == "tradingview" or REG.score("history", "US", "tradingview") > 50


def test_a_very_slow_source_and_a_stale_one_lose_points_but_a_slightly_slower_one_does_not():
    feed("history", "US", "tradingview", 10, ms=1300)
    feed("history", "US", "yahoo", 10, ms=300)
    assert REG.ids("history", "US")[0] == "tradingview"             # speed alone does not reorder
    REG.detail.clear()
    feed("history", "US", "tradingview", 10, ms=12000)
    feed("history", "US", "yahoo", 10, ms=300)
    assert REG.ids("history", "US")[0] == "yahoo"
    REG.detail.clear()
    feed("history", "US", "tradingview", 10)
    feed("history", "US", "yahoo", 10)
    REG.d("history", "US", "tradingview")["stale"] = [1] * 10        # always late
    REG.d("history", "US", "yahoo")["stale"] = [0] * 10
    assert REG.ids("history", "US")[0] == "yahoo"


def test_disagreeing_sources_lose_points():
    feed("fundamentals", "US", "tvscan", 10)
    feed("fundamentals", "US", "yahoo", 10)
    for _ in range(6):
        REG.vote("fundamentals", "US", "tvscan", False)
        REG.vote("fundamentals", "US", "yahoo", True)
    assert REG.ids("fundamentals", "US")[0] == "yahoo"


def test_the_users_choice_of_yahoo_first_and_the_auto_switch_win(monkeypatch):
    monkeypatch.setattr(tvdata.CLIENT, "available", lambda: True)
    feed("history", "US", "yahoo", 2, 10)
    feed("history", "US", "tradingview", 10)
    core.Store.set("prefs", {"dataSource": "yahoo"})
    assert [c.id for c in REG.chain("history", "US")][0] == "yahoo"
    core.Store.set("prefs", {})
    admin.set_auto(False)
    assert REG.ids("history", "US") == REG.order["history"]


def test_history_marks_old_data_as_stale_in_the_record(monkeypatch):
    old = [[(time.time() - 40 * 86400) * 1000 + i * 86400000, 1, 2, 0.5, 1.5, 10] for i in range(10)]
    monkeypatch.setattr(prices, "fetch_yahoo", lambda s, r, i="1d": {"ok": True, "source": "Yahoo Finance", "symbol": s, "interval": i,
                                                                    "name": "x", "currency": "USD", "rows": old, "dividends": [], "splits": []})
    main.get_history("ZZOLD", "US", "1y")
    assert REG.d("history", "US", "yahoo")["stale"] == [1]


def test_the_record_survives_a_restart_and_ignores_garbage(tmp_path):
    path = str(tmp_path / "stats.json")
    r = Registry()
    r.register(core_sources.Yahoo())
    r.path = path
    r._count("yahoo", "ok", 250, kind="history", market="SR")
    r._count("yahoo", "fail", err="x", kind="history", market="SR")
    r.maybe_save(True)
    r2 = Registry()
    r2.register(core_sources.Yahoo())
    r2.load(path)
    row = r2.detail[("history", "SR", "yahoo")]
    assert row["recent"] == [1, 0] and row["streak"] == 1 and r2.stats["yahoo"]["calls"] == 2
    open(path, "w").write("{not json")
    r3 = Registry()
    r3.register(core_sources.Yahoo())
    r3.load(path)
    assert r3.detail == {}
    json.dump({"detail": {"history|SR|ghost": {"recent": [1]}}}, open(path, "w"))
    r3.load(path)
    assert r3.detail == {}


def test_reset_clears_everything_and_status_reports_markets():
    feed("history", "SR", "yahoo", 9, 1, ms=420)
    st = [s for s in REG.status() if s["id"] == "yahoo"][0]
    assert st["markets"]["SR"]["rate"] == 90 and st["markets"]["SR"]["ms"] == 420
    assert "history" in admin.status()["ranking"] and "SR" in admin.status()["ranking"]["history"]
    admin.reset()
    st = [s for s in REG.status() if s["id"] == "yahoo"][0]
    assert st["calls"] == 0 and st["markets"] == {}


# ---------------------------------------------------------------- majority vote
def test_vote_needs_three_sources_and_more_than_half_close():
    tol = ("rel", 0.05)
    assert consensus.vote({"a": 100, "b": 130}, tol) == (None, [])
    v, out = consensus.vote({"a": 100, "b": 101, "c": 150}, tol)
    assert abs(v - 100.5) < 1e-9 and out == ["c"]
    assert consensus.vote({"a": 100, "b": 130, "c": 170}, tol) == (None, [])
    assert consensus.close_to(2.0, 2.4, ("abs", 0.5)) and not consensus.close_to(2.0, 2.6, ("abs", 0.5))


def fake_fund(**kw):
    base_f = {"close": 100.0, "price_earnings_ttm": 20.0, "price_book_fq": 3.0, "price_target_average": 120.0, "dividends_yield_current": 1.0}
    base_f.update(kw)
    return base_f


def test_cross_check_takes_the_majority_and_scores_the_dissenter(monkeypatch):
    monkeypatch.setattr(core_sources.Yahoo, "fundamentals", lambda self, code, ex: fake_fund(close=120.0))
    monkeypatch.setattr(keyed.AlphaVantage, "key", lambda self: "abc12345")
    monkeypatch.setattr(keyed.AlphaVantage, "fundamentals", lambda self, code, ex: fake_fund(close=121.0))
    f, rep = consensus.cross_check("US", "tvscan", fake_fund(close=100.0), "ZZ", "US")
    assert f["close"] == 120.5 and rep["conflicts"][0]["key"] == "close" and rep["conflicts"][0]["against"] == ["TradingView"]
    assert sorted(rep["sources"]) == ["Alpha Vantage", "TradingView", "Yahoo Finance"]
    assert REG.d("fundamentals", "US", "tvscan")["disagree"] == 1 and REG.d("fundamentals", "US", "yahoo")["agree"] >= 1
    assert f["price_earnings_ttm"] == 20.0          # fields that agree are untouched


def test_cross_check_with_two_sources_reports_but_keeps_the_first(monkeypatch):
    monkeypatch.setattr(core_sources.Yahoo, "fundamentals", lambda self, code, ex: fake_fund(close=150.0))
    f, rep = consensus.cross_check("US", "tvscan", fake_fund(close=100.0), "ZZ", "US")
    c = rep["conflicts"][0]
    assert f["close"] == 100.0 and c["used"] is None and set(c["values"]) == {"TradingView", "Yahoo Finance"}


def test_cross_check_agreement_and_failures(monkeypatch):
    monkeypatch.setattr(core_sources.Yahoo, "fundamentals", lambda self, code, ex: fake_fund(close=101.0))
    f, rep = consensus.cross_check("US", "tvscan", fake_fund(close=100.0), "ZZ", "US")
    assert rep["conflicts"] == [] and REG.d("fundamentals", "US", "yahoo")["agree"] >= 1
    def boom(self, code, ex):
        raise ConnectionError("down")
    monkeypatch.setattr(core_sources.Yahoo, "fundamentals", boom)
    f, rep = consensus.cross_check("US", "tvscan", fake_fund(), "ZZ", "US")
    assert rep is None and f == fake_fund()           # the others failed: nothing to compare


def test_get_fundamentals_carries_the_comparison(monkeypatch):
    core.Store.set("src_cross", True)
    monkeypatch.setattr(markets, "tv_scan", lambda m, b: {"data": [{"d": [100, 20, 3] + [None] * 22}]})
    monkeypatch.setattr(core_sources.Yahoo, "fundamentals", lambda self, code, ex: fake_fund(close=100.5, price_earnings_ttm=20.5, price_book_fq=3.0))
    monkeypatch.setattr(markets, "sector_multiples", lambda m, s: {})
    monkeypatch.setattr(markets, "market_multiples", lambda m: {})
    r = main.get_fundamentals("ZZCC", "US")
    assert r["ok"] and r["checks"]["conflicts"] == [] and "Yahoo Finance" in r["checks"]["sources"]


# ---------------------------------------------------------------- data checks
def day(i):
    return 1700000000000 + i * 86400000


def rows_ok(n=40):
    return [[day(i), 10, 11, 9, 10 + (i % 3) * 0.1, 1000] for i in range(n)]


def codes(res):
    return {i["code"]: i["n"] for i in quality.check_history(res)}


def test_clean_data_has_no_issues_and_intraday_is_skipped():
    assert quality.check_history({"rows": rows_ok(), "interval": "1d", "offline": True}) == []
    r = rows_ok()
    r[5][4] = 0
    assert quality.check_history({"rows": r, "interval": "60m"}) == []


def test_each_kind_of_doubtful_data_is_found():
    r = rows_ok()
    r[5][4] = 0                              # zero price
    r[8][2], r[8][3] = 8, 12                 # high below low
    r[12][0] = r[11][0]                      # repeated date
    r[20][4], r[20][2] = 20, 21              # +100% in one day ...
    r[21][4] = 10                            # ... and back
    r[30][0] += 20 * 86400000                # a three-week hole
    for i in range(31, 40):
        r[i][0] += 20 * 86400000
    got = codes({"rows": r, "interval": "1d", "offline": True})
    assert got["zero"] == 1 and got["bar"] == 1 and got["order"] == 1 and got["jump"] == 2 and got["gap"] == 1


def test_a_split_explains_a_big_move():
    r = rows_ok()
    for i in range(20, 40):
        r[i][4] = 5.0
    assert codes({"rows": r, "interval": "1d", "offline": True, "splits": [[day(20), "2:1"]]}).get("jump") is None
    assert codes({"rows": r, "interval": "1d", "offline": True}).get("jump") == 1


def test_old_last_bar_is_flagged_unless_data_is_a_saved_copy():
    old = [[(time.time() - 30 * 86400) * 1000 + i * 86400000, 10, 11, 9, 10, 1] for i in range(10)]
    assert codes({"rows": old, "interval": "1d"}).get("stale") == 1
    assert "stale" not in codes({"rows": old, "interval": "1d", "offline": True})


def test_history_result_carries_the_quality_list(monkeypatch):
    r = rows_ok()
    r[5][4] = 0
    r = [[(time.time() - (len(r) - i) * 86400) * 1000] + x[1:] for i, x in enumerate(r)]
    monkeypatch.setattr(prices, "fetch_yahoo", lambda s, rg, i="1d": {"ok": True, "source": "Yahoo Finance", "symbol": s, "interval": i,
                                                                     "name": "x", "currency": "USD", "rows": r, "dividends": [], "splits": []})
    res = main.get_history("ZZQ", "US", "1y")
    assert res["ok"] and res["quality"] == [{"code": "zero", "n": 1, "level": "bad"}]


# ---------------------------------------------------------------- periodic check and alerts
def fake_conn(cid, behaviour):
    cls = type("F_" + cid, (Connector,), dict(id=cid, name="Fake " + cid, kinds=("history",), markets=("US",),
                                            history=lambda self, **kw: behaviour()))
    return cls()


def with_registry(monkeypatch, *conns):
    items = collections.OrderedDict((c.id, c) for c in conns)
    for c in conns:
        REG.stats.setdefault(c.id, {"calls": 0, "ok": 0, "fail": 0, "nodata": 0, "ms": 0.0, "lastOk": 0, "lastFail": 0, "lastError": ""})
    monkeypatch.setattr(REG, "items", items)


def test_a_source_that_fails_two_rounds_in_a_row_is_announced_once_and_recovery_clears_it(monkeypatch):
    state = {"down": True}
    def behave():
        if state["down"]:
            raise ConnectionError("down")
        return {"ok": True, "rows": [[1, 1, 1, 1, 1, 1]]}
    with_registry(monkeypatch, fake_conn("fk1", behave))
    alerts = []
    monkeypatch.setattr(health, "alert", lambda conn: alerts.append(conn.id))
    assert health.check_all()["fk1"] == "down" and alerts == []
    assert health.check_all()["fk1"] == "down" and alerts == ["fk1"]
    health.check_all()
    assert alerts == ["fk1"]                          # not announced again while it stays down
    state["down"] = False
    assert health.check_all()["fk1"] == "ok" and "fk1" not in health.ALERTED
    state["down"] = True
    health.check_all(); health.check_all()
    assert alerts == ["fk1", "fk1"]


def test_no_data_is_not_an_outage_and_unready_sources_are_not_probed(monkeypatch):
    def none():
        raise NoData()
    idle = fake_conn("fk2", none)
    keyless = fake_conn("fk3", none)
    keyless.key_service = "x"
    keyless.key = lambda: ""
    with_registry(monkeypatch, idle, keyless)
    assert health.check_all(notify=False) == {"fk2": "idle"}
    assert health.probes(core_sources.Stooq())[0][1] == "US"


def test_the_alert_uses_desktop_and_telegram_and_can_be_switched_off(monkeypatch):
    sent = []
    monkeypatch.setattr(system, "notify_desktop", lambda t, b: sent.append(("desk", b)))
    monkeypatch.setattr(system, "telegram_send", lambda text, **k: sent.append(("tg", text)))
    monkeypatch.setattr(core, "tg_token", lambda: "tok")
    core.Store.set("prefs", {"telegram": {"chatId": "42"}})
    health.alert(core_sources.Yahoo())
    assert [k for k, _ in sent] == ["desk", "tg"] and "Yahoo Finance" in sent[0][1]
    sent.clear()
    admin.set_watch(False)
    health.alert(core_sources.Yahoo())
    assert sent == []


def test_probe_now_starts_a_check_in_the_background(monkeypatch):
    called = []
    monkeypatch.setattr(health, "check_all", lambda notify=True: called.append(notify) or {})
    st = admin.probe_now()
    assert st["checking"] is True
    for _ in range(50):
        if called:
            break
        time.sleep(0.02)
    assert called == [False]


# ---------------------------------------------------------------- errors that used to vanish
def test_a_swallowed_error_now_reaches_the_error_log(monkeypatch):
    def boom(*a, **k):
        raise OSError("no notify-send here")
    monkeypatch.setattr(system.subprocess, "Popen", boom)
    assert system.notify_desktop("t", "b") is False
    assert "system.notify_desktop" in core.errors_text() and "no notify-send here" in core.errors_text()


def test_the_same_error_is_written_once_a_minute():
    core.record("WARN", "dedupe-test", "same message")
    core.record("WARN", "dedupe-test", "same message")
    core.record("WARN", "dedupe-test", "other message")
    text = core.errors_text()
    assert text.count("dedupe-test: same message") == 1 and text.count("dedupe-test: other message") == 1
