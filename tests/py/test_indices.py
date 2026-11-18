"""2.18.2: the main indices of each market for the dashboard."""
import markets


def rows(n, start=100.0, step=1.0):
    return [[1700000000000 + i * 86400000, 0, 0, 0, start + i * step, 0] for i in range(n)]


def test_index_card_last_change_month_and_spark():
    c = markets.index_card("^GSPC", "إس آند بي 500", "S&P 500", False, hist=lambda code, ex, rng: {"ok": True, "rows": rows(40), "source": "x"})
    assert c["ok"] and c["last"] == 139 and abs(c["chg"] - (139 / 138 - 1)) < 1e-12
    assert abs(c["month"] - (139 / 117 - 1)) < 1e-12 and len(c["spark"]) == 23


def test_index_card_missing_or_tradingview_only(monkeypatch):
    c = markets.index_card("^DJI", "داو", "Dow", False, hist=lambda *a: {"ok": False, "error": "no data"})
    assert not c["ok"] and c["error"] == "no data"
    monkeypatch.setattr(markets, "prefer_tv", lambda: False)
    asked = []
    c = markets.index_card("^EGX33", "إي جي إكس 33", "EGX33", True, hist=lambda *a: asked.append(a))
    assert not c["ok"] and "TradingView" in c["error"] and asked == [], "not asked from Yahoo, which has no such index"


def test_all_markets_and_the_requested_ones():
    names = {it[2] for lst in markets.MAIN_INDICES.values() for it in lst}
    assert {"TASI", "MT30", "EGX30", "EGX70", "EGX100", "EGX33", "S&P 500", "Nasdaq", "Dow Jones"} == names
    asked = []
    r = markets.get_main_indices(hist=lambda code, ex, rng: asked.append((code, ex)) or {"ok": True, "rows": rows(30)},
                                 gold=lambda: [{"code": "SA24", "ok": True}, {"code": "EG21", "ok": False}])
    assert r["ok"] and len(r["items"]) == 12 and [x["ex"] for x in r["items"]].count("CA") == 4
    g = [x for x in r["items"] if x["ex"] == "GOLD"]
    assert [x["code"] for x in g] == ["XAU-USD-OZ", "SA24", "EG21"] and ("XAU-USD-OZ", "GOLD") in asked
    assert [x["open"] for x in g] == ["GOLD:XAU-USD-OZ", "GOLD:XAU-SAR-24", "GOLD:XAU-EGP-21"]
    assert len(markets.get_main_indices("SR", hist=lambda *a: {"ok": True, "rows": rows(30)}, gold=lambda: 1 / 0)["items"]) == 2
    for code, _n, _s, tv_only in [it for lst in markets.MAIN_INDICES.values() for it in lst]:
        assert code in markets.TV_INDEX, code + " has a TradingView symbol"
