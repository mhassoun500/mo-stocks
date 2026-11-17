"""Phase 4, step 2: the scanner's market-wide figures for fair value."""
import markets


def fake_scan(rows):
    def scan(market, body, timeout=25):
        fake_scan.bodies.append((market, body))
        cols = body["columns"]
        return {"data": [{"d": [r.get(c) for c in cols]} for r in rows]}
    fake_scan.bodies = []
    return scan


ROWS = [{"name": "2222", "close": 25.0, "price_earnings_ttm": 16.0, "price_book_fq": 4.0, "sector": "Energy Minerals", "dividends_yield_current": 6.0},
        {"name": "2010", "close": 60.0, "price_earnings_ttm": 20.0, "price_book_fq": 1.5, "sector": "Process Industries", "dividends_yield_current": 4.0},
        {"name": "2020", "close": 90.0, "price_earnings_ttm": 10.0, "price_book_fq": 2.0, "sector": "Process Industries"},
        {"name": "4001", "close": 12.0, "price_earnings_ttm": -3.0, "sector": "Retail Trade"},           # loss-making: not in medians
        {"name": "9999", "close": 8.0, "price_earnings_ttm": 400.0, "sector": "Retail Trade"}]           # outlier: not in medians


def test_one_read_gives_every_company_and_sector_medians(monkeypatch):
    monkeypatch.setattr(markets, "tv_scan", fake_scan(ROWS))
    d = markets.scan_fundamentals("SR")
    assert d["ok"] and set(d["f"]) == {"2222", "2010", "2020", "4001", "9999"}
    assert d["f"]["2010"]["price_book_fq"] == 1.5 and "dividends_yield_current" not in d["f"]["2020"], "missing figures are left out"
    m = d["med"]["Process Industries"]
    assert m["pe"] == 15.0 and m["pb"] == 1.75 and m["n"] == 2 and m["dy"] == 4.0 and m["ndy"] == 1
    assert "Retail Trade" not in d["med"] and d["med"]["*"]["n"] == 3
    market, body = fake_scan.bodies[0]
    assert market == "ksa" and body["columns"][0] == "name" and "price_target_average" in body["columns"]
    assert markets.scan_fundamentals("SR") is not None and len(fake_scan.bodies) == 1, "kept for hours"


def test_a_failed_read_says_so(monkeypatch):
    def boom(market, body, timeout=25):
        raise OSError("down")
    monkeypatch.setattr(markets, "tv_scan", boom)
    d = markets.scan_fundamentals("CA", "50")
    assert not d["ok"] and "السعر العادل" in d["error"]
    assert not markets.scan_fundamentals("XX")["ok"]
