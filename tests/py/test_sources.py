"""Connector framework, the sources behind it, and the way the app uses them. No network: every request is faked."""
import json
import socket
import time
import types
import urllib.error

import pytest

import core
import main
import markets
import prices
import sharia
import tvdata
import sources
from sources import base, keyed, edgar, admin, core_sources
from sources.base import Connector, NoData, Registry, SourcesFailed, Throttle, RateLimited, AuthError


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    """No real waiting, no TradingView session, empty caches, nothing switched off."""
    monkeypatch.setattr(base, "sleep", lambda s: None)
    monkeypatch.setattr(tvdata.CLIENT, "available", lambda: False)
    monkeypatch.setattr(prices, "fetch_stooq", lambda sym: (_ for _ in ()).throw(prices.NotFound("no such Stooq symbol")))
    prices.MEM.clear()
    markets.MEM.clear()
    core.Store.set("src_off", [])
    core.Store.set("prefs", {})
    core.Store.set("src_auto", True)
    core.Store.set("src_cross", False)       # the extra-source comparison has its own tests
    monkeypatch.setattr(sources.REG, "path", None)
    sources.REG.detail.clear()
    for c in sources.REG.items.values():
        c.throttle = Throttle(c.per_min, c.gap)
    yield


def make(cid, kind, fn, **attrs):
    cls = type("C_" + cid, (Connector,), dict(id=cid, name=cid, kinds=(kind,), markets=("US", "SR", "CA"),
                                            **{kind: lambda self, **kw: fn(**kw)}, **attrs))
    return cls()


def reg_with(*conns, kind="history"):
    r = Registry()
    for c in conns:
        r.register(c)
    r.set_order(kind, [c.id for c in conns])
    return r


# ---------------------------------------------------------------- the registry
def test_first_working_source_wins_and_failures_fall_through():
    calls = []
    def bad(**kw):
        calls.append("a")
        raise ValueError("boom")
    r = reg_with(make("a", "history", bad), make("b", "history", lambda **kw: {"rows": [1]}), make("c", "history", lambda **kw: calls.append("c")))
    v, meta = r.call("history", "US")
    assert v == {"rows": [1]} and meta["id"] == "b" and calls == ["a"]
    assert [t["state"] for t in meta["tried"]] == ["fail", "ok"]
    assert r.stats["a"]["fail"] == 1 and r.stats["b"]["ok"] == 1 and "boom" in r.stats["a"]["lastError"]


def test_nodata_is_not_a_failure_and_all_nodata_raises_nodata():
    def none(**kw):
        raise NoData("الرمز غير موجود")
    r = reg_with(make("a", "history", none), make("b", "history", none))
    with pytest.raises(NoData) as e:
        r.call("history", "US")
    assert str(e.value) == "الرمز غير موجود" and r.stats["a"]["fail"] == 0 and r.stats["a"]["nodata"] == 1


def test_everything_failing_raises_with_the_first_error():
    def down(msg):
        def f(**kw):
            raise ConnectionError(msg)
        return f
    r = reg_with(make("a", "history", down("first"), retries=0), make("b", "history", down("second"), retries=0))
    with pytest.raises(SourcesFailed) as e:
        r.call("history", "US")
    assert str(e.value) == "first"


def test_mixed_nodata_and_failure_counts_as_nodata():
    def none(**kw):
        raise NoData()
    def down(**kw):
        raise ConnectionError("x")
    r = reg_with(make("a", "history", down, retries=0), make("b", "history", none))
    with pytest.raises(NoData):
        r.call("history", "US")


def test_unavailable_sources_are_skipped():
    a = make("a", "history", lambda **kw: {"x": 1})
    a.enabled = lambda: False
    b = make("b", "history", lambda **kw: {"x": 2})
    b.markets = ("SR",)
    c = make("c", "history", lambda **kw: {"x": 3})
    c.key_service = "k"
    c.key = lambda: ""
    d = make("d", "history", lambda **kw: {"x": 4})
    r = reg_with(a, b, c, d)
    assert [x.id for x in r.chain("history", "US")] == ["d"]
    assert [x.id for x in r.chain("history", "SR")] == ["b", "d"]


# ---------------------------------------------------------------- retries and throttle
def test_transient_errors_are_retried_with_growing_delay(monkeypatch):
    sleeps = []
    monkeypatch.setattr(base, "sleep", sleeps.append)
    n = [0]
    def flaky(**kw):
        n[0] += 1
        if n[0] < 3:
            raise urllib.error.URLError("temporary")
        return {"ok": 1}
    c = make("f", "history", flaky, retries=2, retry_delay=0.5)
    assert c.run("history") == {"ok": 1} and n[0] == 3 and sleeps == [0.5, 1.0]


def test_retry_after_header_is_honoured_and_other_errors_are_not_retried(monkeypatch):
    sleeps = []
    monkeypatch.setattr(base, "sleep", sleeps.append)
    n = [0]
    def limited(**kw):
        n[0] += 1
        if n[0] == 1:
            raise urllib.error.HTTPError("u", 429, "slow", {"Retry-After": "3"}, None)
        return 1
    assert make("l", "history", limited).run("history") == 1 and sleeps == [3.0]
    m = [0]
    def broken(**kw):
        m[0] += 1
        raise ValueError("bug")
    with pytest.raises(ValueError):
        make("b", "history", broken, retries=3).run("history")
    assert m[0] == 1
    m[0] = 0
    def gone(**kw):
        m[0] += 1
        raise urllib.error.HTTPError("u", 404, "nf", {}, None)
    with pytest.raises(urllib.error.HTTPError):
        make("g", "history", gone, retries=3).run("history")
    assert m[0] == 1


def test_throttle_spaces_requests_and_refuses_long_waits(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(base, "time", types.SimpleNamespace(time=lambda: clock[0]))
    slept = []
    def fake_sleep(s):
        slept.append(round(s, 2))
        clock[0] += s
    monkeypatch.setattr(base, "sleep", fake_sleep)
    t = Throttle(gap=1.0)
    t.wait()
    t.wait()
    assert slept == [1.0]
    q = Throttle(per_min=2, max_wait=3)
    q.wait()
    q.wait()
    with pytest.raises(RateLimited):
        q.wait()
    clock[0] += 61
    q.wait()  # a minute later the budget is back


def test_rate_limited_source_is_skipped_not_waited_for(monkeypatch):
    c = make("a", "history", lambda **kw: {"x": 1}, per_min=1)
    b = make("b", "history", lambda **kw: {"x": 2})
    r = reg_with(c, b)
    assert r.call("history", "US")[1]["id"] == "a"
    assert r.call("history", "US")[1]["id"] == "b"
    assert r.stats["a"]["fail"] == 1


# ---------------------------------------------------------------- default order
def ids(kind, ex="US"):
    return [c.id for c in sources.REG.chain(kind, ex)]


def test_default_order_and_yahoo_first_setting(monkeypatch):
    monkeypatch.setattr(tvdata.CLIENT, "available", lambda: True)
    assert ids("history")[:2] == ["tradingview", "yahoo"]
    core.Store.set("prefs", {"dataSource": "yahoo"})
    assert ids("history")[:2] == ["yahoo", "tradingview"]


def test_keyed_sources_stay_idle_without_a_key(monkeypatch):
    assert "twelvedata" not in ids("history") and "fmp" not in ids("fundamentals")
    monkeypatch.setattr(keyed.TwelveData, "key", lambda self: "abc12345")
    assert "twelvedata" in ids("history")
    assert ids("history", "SR").count("stooq") == 0   # Stooq only serves US symbols here


def test_switching_a_source_off():
    admin.set_enabled("yahoo", False)
    assert "yahoo" not in ids("history")
    admin.set_enabled("yahoo", True)
    assert "yahoo" in ids("history")


# ---------------------------------------------------------------- price history through the chain
def rows(n=30):
    day = 86400000
    return [[1700000000000 + i * day, 10 + i, 11 + i, 9 + i, 10.5 + i, 1000] for i in range(n)]


def yahoo_ok(symbol, rng, interval="1d"):
    return {"ok": True, "source": "Yahoo Finance", "symbol": symbol, "interval": interval, "name": "X", "currency": "USD",
            "rows": rows(), "dividends": [], "splits": []}


def test_history_uses_yahoo_when_tradingview_is_not_signed_in(monkeypatch):
    monkeypatch.setattr(prices, "fetch_yahoo", yahoo_ok)
    r = main.get_history("ZZA", "US", "1y")
    assert r["ok"] and r["source"] == "Yahoo Finance" and "note" not in r


def test_history_falls_back_to_tradingview_with_a_note(monkeypatch):
    monkeypatch.setattr(tvdata.CLIENT, "available", lambda: True)
    core.Store.set("prefs", {"dataSource": "yahoo"})
    def down(*a, **k):
        raise ConnectionError("no net")
    monkeypatch.setattr(prices, "fetch_yahoo", down)
    monkeypatch.setattr(prices, "fetch_tv", lambda code, ex, rng, interval="1d", lite=False: {
        "ok": True, "source": "TradingView", "symbol": code, "interval": interval, "name": "X", "currency": "USD",
        "rows": rows(), "dividends": [], "splits": []})
    r = main.get_history("ZZB", "US", "1y")
    assert r["source"] == "TradingView" and r["note"] == "تعذّر الجلب من Yahoo Finance فاستُخدم TradingView."


def test_history_falls_back_to_stooq_for_us_symbols(monkeypatch):
    def down(*a, **k):
        raise ConnectionError("no net")
    monkeypatch.setattr(prices, "fetch_yahoo", down)
    monkeypatch.setattr(prices, "fetch_stooq", lambda sym: rows())
    r = main.get_history("ZZC", "US", "1y")
    assert r["ok"] and r["source"] == "Stooq" and r["note"].endswith("فاستُخدم Stooq.")
    assert sources.REG.stats["yahoo"]["fail"] >= 1


def test_history_uses_a_keyed_source_when_the_free_ones_fail(monkeypatch):
    def down(*a, **k):
        raise ConnectionError("no net")
    monkeypatch.setattr(prices, "fetch_yahoo", down)
    monkeypatch.setattr(prices, "fetch_stooq", down)
    monkeypatch.setattr(keyed.TwelveData, "key", lambda self: "abc12345")
    monkeypatch.setattr(keyed, "http_json", lambda url, headers=None, timeout=20: {
        "meta": {"currency": "USD"}, "status": "ok", "values": [
            {"datetime": "2026-01-0%d" % i, "open": "1", "high": "2", "low": "0.5", "close": "1.5", "volume": "10"} for i in range(1, 5)]})
    r = main.get_history("ZZD", "US", "1y")
    assert r["ok"] and r["source"] == "Twelve Data" and len(r["rows"]) == 4 and r["note"]


def test_history_not_found_everywhere(monkeypatch):
    def nf(*a, **k):
        raise prices.NotFound("الرمز ZZE غير موجود في Yahoo Finance.")
    monkeypatch.setattr(prices, "fetch_yahoo", nf)
    r = main.get_history("ZZE", "US", "1y")
    assert not r["ok"] and r["notFound"] and "ZZE" in r["error"]
    monkeypatch.setattr(prices, "fetch_yahoo", lambda *a, **k: (_ for _ in ()).throw(NoData("english only")))
    prices.MEM.clear()
    r = main.get_history("ZZF", "US", "1y")
    assert r["notFound"] and "ZZF" in r["error"]       # an English reason is replaced by the Arabic message


def test_history_all_down_falls_back_to_saved_data_or_reports_offline(monkeypatch):
    def down(*a, **k):
        raise ConnectionError("تعذّر الاتصال بـ Yahoo Finance. تأكد من اتصال الإنترنت.")
    monkeypatch.setattr(prices, "fetch_yahoo", down)
    monkeypatch.setattr(prices, "fetch_stooq", down)
    r = main.get_history("ZZG", "US", "1y")
    assert not r["ok"] and r["offline"] and "Yahoo" in r["error"]


# ---------------------------------------------------------------- fundamentals chain
def test_fundamentals_chain_reaches_a_keyed_source(monkeypatch):
    def down(market, body):
        raise OSError("scanner down")
    monkeypatch.setattr(markets, "tv_scan", down)
    monkeypatch.setattr(markets, "get_profile", lambda sym: {"ok": False})
    monkeypatch.setattr(keyed.AlphaVantage, "key", lambda self: "abc12345")
    def av(url, headers=None, timeout=20):
        if "OVERVIEW" in url:
            return {"Symbol": "ZZH", "PERatio": "20", "PriceToBookRatio": "3", "EPS": "5", "BookValue": "30",
                    "AnalystTargetPrice": "130", "DividendYield": "0.02", "ReturnOnEquityTTM": "0.15", "Sector": "TECHNOLOGY"}
        return {"Global Quote": {"05. price": "100"}}
    monkeypatch.setattr(keyed, "http_json", av)
    monkeypatch.setattr(markets, "sector_multiples", lambda m, s: {})
    monkeypatch.setattr(markets, "market_multiples", lambda m: {})
    r = main.get_fundamentals("ZZH", "US")
    f = r["f"]
    assert r["ok"] and r["source"] == "Alpha Vantage" and f["close"] == 100 and f["dividends_yield_current"] == 2.0
    assert f["return_on_equity_fq"] == 15.0 and f["price_target_average"] == 130 and f["sector"] == "Technology"


def test_tradingview_scanner_is_labelled_tradingview(monkeypatch):
    monkeypatch.setattr(markets, "tv_scan", lambda m, b: {"data": [{"d": [100] + [None] * 25}]})
    monkeypatch.setattr(markets, "sector_multiples", lambda m, s: {})
    monkeypatch.setattr(markets, "market_multiples", lambda m: {})
    r = main.get_fundamentals("ZZI", "SR")
    assert r["ok"] and r["source"] == "TradingView" and r["f"]["close"] == 100


# ---------------------------------------------------------------- keyed sources, parsing (answers are faked)
def with_key(monkeypatch, cls):
    monkeypatch.setattr(cls, "key", lambda self: "abc12345")
    return cls()


def test_twelvedata_errors(monkeypatch):
    c = with_key(monkeypatch, keyed.TwelveData)
    monkeypatch.setattr(keyed, "http_json", lambda *a, **k: {"status": "error", "code": 401, "message": "bad key"})
    with pytest.raises(AuthError):
        c.history("AAPL", "US", "1y")
    monkeypatch.setattr(keyed, "http_json", lambda *a, **k: {"status": "error", "code": 400, "message": "symbol missing"})
    with pytest.raises(NoData):
        c.history("AAPL", "US", "1y")
    seen = []
    monkeypatch.setattr(keyed, "http_json", lambda url, **k: seen.append(url) or {"status": "ok", "values": [
        {"datetime": "2026-03-02", "open": "2", "high": "3", "low": "1", "close": "2.5", "volume": "5"},
        {"datetime": "2026-03-01", "open": "1", "high": "2", "low": "1", "close": "1.5", "volume": "5"}]})
    r = c.history("1120", "SR", "1y")
    assert "exchange=Tadawul" in seen[0] and r["rows"][0][0] < r["rows"][1][0] and r["rows"][1][4] == 2.5


def test_fmp_history_and_fundamentals(monkeypatch):
    c = with_key(monkeypatch, keyed.FMP)
    def get(url, headers=None, timeout=20):
        if "historical-price-eod" in url:
            assert "symbol=COMI.CA" in url
            return [{"date": "2026-03-02", "open": 2, "high": 3, "low": 1, "close": 2.5, "volume": 5},
                    {"date": "2026-03-01", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 5}]
        if "profile" in url:
            return [{"price": 80, "sector": "Financial Services", "marketCap": 1e9, "currency": "EGP"}]
        if "ratios-ttm" in url:
            return [{"priceToEarningsRatioTTM": 8, "priceToBookRatioTTM": 1.2, "dividendYieldTTM": 0.05}]
        if "key-metrics" in url:
            return [{"returnOnEquityTTM": 0.2}]
        return [{"targetConsensus": 95, "targetHigh": 110, "targetLow": 70}]
    monkeypatch.setattr(keyed, "http_json", get)
    h = c.history("COMI", "CA", "1y")
    assert h["source"] == "Financial Modeling Prep" and h["rows"][0][4] == 1.5
    f = c.fundamentals("COMI", "CA")
    assert f["close"] == 80 and f["dividends_yield_current"] == 5.0 and f["return_on_equity_fq"] == 20.0
    assert f["price_target_average"] == 95
    monkeypatch.setattr(keyed, "http_json", lambda *a, **k: {"Error Message": "Invalid API KEY"})
    with pytest.raises(AuthError):
        c.fundamentals("COMI", "CA")


def test_finnhub_and_alphavantage_limits(monkeypatch):
    c = with_key(monkeypatch, keyed.Finnhub)
    monkeypatch.setattr(keyed, "http_json", lambda url, **k: {"c": 50} if "quote" in url else {"metric": {
        "peTTM": 15, "pbQuarterly": 2, "epsTTM": 3.3, "bookValuePerShareQuarterly": 25, "dividendYieldIndicatedAnnual": 1.5,
        "roeTTM": 12, "marketCapitalization": 1000}})
    f = c.fundamentals("XYZ", "US")
    assert f["close"] == 50 and f["price_book_fq"] == 2 and f["market_cap_basic"] == 1e9
    monkeypatch.setattr(keyed, "http_json", lambda url, **k: {"c": 0} if "quote" in url else {"metric": {}})
    with pytest.raises(NoData):
        c.fundamentals("XYZ", "US")
    a = with_key(monkeypatch, keyed.AlphaVantage)
    monkeypatch.setattr(keyed, "http_json", lambda *a_, **k: {"Information": "25 requests per day"})
    with pytest.raises(ConnectionError):
        a.fundamentals("XYZ", "US")


# ---------------------------------------------------------------- SEC EDGAR
FACTS = {"facts": {
    "us-gaap": {
        "EarningsPerShareDiluted": {"units": {"USD/shares": [
            {"end": "2025-09-27", "val": 6.1, "fp": "FY", "form": "10-K", "filed": "2025-11-01"},
            {"end": "2026-06-27", "val": 2.0, "fp": "Q3", "form": "10-Q", "filed": "2026-07-31"},
            {"end": "2026-09-26", "val": 8.98, "fp": "FY", "form": "10-K", "filed": "2026-11-03"}]}},
        "NetIncomeLoss": {"units": {"USD": [{"end": "2026-09-26", "val": 1e11, "fp": "FY", "form": "10-K", "filed": "2026-11-03"}]}},
        "StockholdersEquity": {"units": {"USD": [{"end": "2026-06-27", "val": 7e10, "fp": "Q3", "form": "10-Q", "filed": "2026-07-31"}]}},
        "CommonStockDividendsPerShareDeclared": {"units": {"USD/shares": [{"end": "2026-09-26", "val": 1.0, "fp": "FY", "form": "10-K", "filed": "2026-11-03"}]}}},
    "dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": [{"end": "2026-10-15", "val": 1.5e10, "filed": "2026-11-03"}]}}}}}


def test_edgar_facts_mapping():
    f = edgar.from_facts(FACTS)
    assert f["earnings_per_share_fy"] == 8.98 and f["last_annual_eps"] == 8.98          # the 10-K, not the 10-Q
    assert f["total_equity_fq"] == 7e10 and f["total_shares_outstanding_fundamental"] == 1.5e10
    assert f["dps_common_stock_prim_issue_fy"] == 1.0 and f["net_income_fy"] == 1e11


def test_edgar_connector_finds_the_filer_and_pairs_the_price(monkeypatch):
    c = edgar.Edgar()
    def get(url, headers=None, timeout=20):
        if "search-index" in url:
            return {"hits": {"hits": [{"_source": {"display_names": ["OTHER CO  (OTH)  (CIK 0000000001)"], "ciks": ["0000000001"]}},
                                       {"_source": {"display_names": ["APPLE INC  (ZZEDG)  (CIK 0000320193)"], "ciks": ["0000320193"]}}]}}
        assert "CIK0000320193" in url
        return FACTS
    monkeypatch.setattr(edgar, "http_json", get)
    monkeypatch.setattr(prices, "get_history", lambda code, ex, rng: {"rows": rows(5)})
    f = c.fundamentals("ZZEDG", "US")
    assert f["close"] == rows(5)[-1][4] and f["earnings_per_share_fy"] == 8.98
    monkeypatch.setattr(edgar, "http_json", lambda *a, **k: {"hits": {"hits": []}})
    with pytest.raises(NoData):
        c.fundamentals("NOFILER", "US")


# ---------------------------------------------------------------- news
BING = """<?xml version="1.0"?><rss xmlns:News="https://www.bing.com/news/search"><channel>
<item><title>Big move - Reuters</title><link>http://a</link><pubDate>Mon</pubDate><News:Source>Reuters</News:Source></item>
<item><title>Second</title><link>http://b</link><pubDate>Tue</pubDate></item></channel></rss>""".encode()


def test_news_falls_back_to_bing(monkeypatch):
    def get(url, headers=None, timeout=20):
        if "google" in url:
            raise urllib.error.URLError("blocked")
        return BING
    monkeypatch.setattr(core_sources, "http_get", get)
    r = main.get_news("apple zzq", "US")
    assert r["ok"] and r["items"][0] == {"title": "Big move", "link": "http://a", "date": "Mon", "source": "Reuters"}
    assert len(r["items"]) == 2


def test_news_fails_politely(monkeypatch):
    def down(url, headers=None, timeout=20):
        raise urllib.error.URLError("offline")
    monkeypatch.setattr(core_sources, "http_get", down)
    assert main.get_news("nothing zzr", "SR")["ok"] is False


# ---------------------------------------------------------------- Sharia lists and funds go through connectors
def test_sharia_refresh_runs_the_connectors(monkeypatch):
    monkeypatch.setattr(sharia, "fetch_saudi", lambda: {"source": "sa"})
    monkeypatch.setattr(sharia, "fetch_egypt", lambda: (_ for _ in ()).throw(ValueError("incomplete")))
    monkeypatch.setattr(sharia, "fetch_spus", lambda: {"source": "spus"})
    admin.set_enabled("spus", False)
    res = markets.sharia_refresh()
    assert res == {"sa": True, "eg": False, "pur_sa": None}     # the purification study ships with the app: nothing newer
    assert core.cache_get("sharia|sa")[0] == {"source": "sa"} and sources.REG.stats["egsharia"]["fail"] >= 1


def test_funds_use_the_mubasher_connector(monkeypatch):
    import funds
    monkeypatch.setattr(funds, "fetch_fund_list", lambda country="EG": [{"id": 1, "name": "x", "country": country, "price": 1, "date": 1}])
    got = sources.REG.call_one("mubasher", "funds", op="list", country="EG")
    assert got[0]["country"] == "EG"
    admin.set_enabled("mubasher", False)
    with pytest.raises(SourcesFailed):
        sources.REG.call_one("mubasher", "funds", op="list", country="EG")


# ---------------------------------------------------------------- settings side
def test_admin_keys_and_tests(monkeypatch):
    assert not admin.set_key("yahoo", "abcdefgh1234")["ok"]          # no key needed there
    assert not admin.set_key("fmp", "short")["ok"] and not admin.set_key("fmp", "has space in it")["ok"]
    saved = {}
    monkeypatch.setattr(core.tvdata, "secret_save", lambda path, text, service=None: saved.update({path: text}))
    monkeypatch.setattr(core.tvdata, "secret_load", lambda path, service=None: saved.get(path))
    monkeypatch.setattr(core.tvdata, "secret_delete", lambda path, service=None: saved.pop(path, None))
    assert admin.test("fmp") == {"ok": False, "error": "أضف المفتاح أولًا."}
    st = admin.set_key("fmp", "abcdefgh1234")
    fmp = next(s for s in st["sources"] if s["id"] == "fmp")
    assert fmp["hasKey"] and fmp["needsKey"] and "abcdefgh1234" not in json.dumps(st)   # the key is never sent back
    monkeypatch.setattr(prices, "fetch_yahoo", yahoo_ok)
    assert admin.test("yahoo")["ok"]
    monkeypatch.setattr(prices, "fetch_yahoo", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("x")))
    t = admin.test("yahoo")
    assert not t["ok"] and "x" in t["error"]
    admin.delete_key("fmp")
    assert not next(s for s in admin.status()["sources"] if s["id"] == "fmp")["hasKey"]


def test_status_lists_every_connector_with_its_numbers():
    st = admin.status()
    got = {s["id"] for s in st["sources"]}
    assert {"yahoo", "tradingview", "tvscan", "stooq", "googlenews", "bingnews", "argaam", "egsharia", "spus", "mubasher",
            "twelvedata", "fmp", "alphavantage", "finnhub", "edgar"} <= got
    assert all({"calls", "ok", "fail", "ms", "enabled", "kinds"} <= set(s) for s in st["sources"])
