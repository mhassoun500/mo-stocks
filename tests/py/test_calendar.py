"""Phase 4, step 3: the events calendar for watchlist and portfolio stocks."""
import core
import filings
import markets

NOW = 1795000000000          # 2026-11-17
DAY = 86400


def test_events_from_yahoo_sec_and_market_lists(monkeypatch):
    prof = {"AAPL": {"ok": True, "earningsDates": [], "exDividendDate": NOW / 1000 + 5 * DAY, "dividendDate": None},
            "1120.SR": {"ok": True, "earningsDates": [NOW / 1000 - 30 * DAY, NOW / 1000 + 40 * DAY], "exDividendDate": NOW / 1000 - 90 * DAY},
            "COMI.CA": {"ok": False}}
    monkeypatch.setattr(markets, "get_profile", lambda sym: prof.get(sym, {"ok": False}))

    def cfile(code, ex):
        if ex == "US":
            return {"ok": True, "record": {"due": {"date": NOW + 60 * DAY * 1000}}}
        if code == "COMI":
            return {"ok": True, "source": "البورصة المصرية", "items": [
                {"type": "assembly", "date": NOW - 2 * DAY * 1000, "title": "دعوة الجمعية العامة العادية", "url": "u1"},
                {"type": "board", "date": NOW - DAY * 1000, "title": "x", "url": "u2"},
                {"type": "dividend", "date": NOW - 60 * DAY * 1000, "title": "old", "url": "u3"}]}
        return {"ok": True, "items": []}
    monkeypatch.setattr(filings, "company_file", cfile)
    d = markets.events_calendar([{"code": "AAPL", "ex": "US"}, {"code": "1120", "ex": "SR"}, {"code": "COMI", "ex": "CA"},
                          {"code": "AAPL", "ex": "US"}, {"code": "XAU", "ex": "GOLD"}, {"code": "<bad>", "ex": "US"}], NOW)
    ev = [(e["code"], e["kind"], e.get("est", False)) for e in d["events"]]
    assert ("AAPL", "exdiv", False) in ev and ("AAPL", "earn", True) in ev, "no Yahoo date: the SEC estimate, marked"
    assert ("1120", "earn", False) in ev and not any(c == "1120" and k == "exdiv" for c, k, _ in ev), "past events are dropped"
    assert ("COMI", "ann_assembly", False) in ev and not any(k == "ann_board" for _, k, _ in ev)
    assert not any(e.get("title") == "old" for e in d["events"]), "announcements older than a month are dropped"
    assert [e["t"] for e in d["events"]] == sorted(e["t"] for e in d["events"])
    assert len({(e["code"], e["kind"]) for e in d["events"]}) == len(d["events"]), "each asset once"
    assert d["failed"] == []


def test_one_failing_asset_does_not_hide_the_others(monkeypatch):
    def prof(sym):
        if sym == "MSFT":
            raise RuntimeError("down")
        return {"ok": True, "earningsDates": [NOW / 1000 + DAY]}
    monkeypatch.setattr(markets, "get_profile", prof)
    monkeypatch.setattr(markets, "_asset_events", lambda c, e, n: (_ for _ in ()).throw(OSError("x")) if c == "MSFT" else [{"t": NOW, "kind": "earn", "src": "Y"}])
    d = markets.events_calendar([{"code": "MSFT", "ex": "US"}, {"code": "AAPL", "ex": "US"}], NOW)
    assert d["failed"] == ["MSFT"] and [e["code"] for e in d["events"]] == ["AAPL"]
