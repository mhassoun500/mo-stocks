"""Phase 2 step 3: the yearly earnings history that feeds the stock's own past multiple."""
import json
import time

import pytest

import markets


def _ts(rows):
    return json.dumps({"timeseries": {"result": [{"meta": {}, "annualDilutedEPS": [
        {"asOfDate": d, "reportedValue": {"raw": v, "fmt": str(v)}} for d, v in rows]}]}}).encode()


def _chart(points):
    return {"chart": {"result": [{"timestamp": [p[0] for p in points],
                                  "indicators": {"quote": [{"close": [p[1] for p in points]}]}}]}}


@pytest.fixture(autouse=True)
def no_cache(monkeypatch):
    monkeypatch.setattr(markets, "cache_get", lambda k, max_age=None: (None, None))
    monkeypatch.setattr(markets, "cache_put", lambda k, v: None)


def _day(y, m, d):
    import calendar
    return calendar.timegm((y, m, d, 0, 0, 0))


def test_eps_history_pairs_each_year_with_the_price_at_its_year_end(monkeypatch):
    monkeypatch.setattr(markets.Yahoo, "with_crumb", lambda f: json.loads(_ts([("2023-12-31", 2.0), ("2024-12-31", 3.0)])))
    monkeypatch.setattr(markets, "http_json", lambda url, timeout=20: _chart(
        [(_day(2023, 11, 1), 40.0), (_day(2023, 12, 1), 44.0), (_day(2024, 11, 1), 60.0), (_day(2024, 12, 1), 66.0), (_day(2025, 1, 1), 70.0)]))
    out = markets.eps_history("1120", "SR")
    assert [(o["d"], o["eps"], o["px"]) for o in out] == [("2023-12-31", 2.0, 44.0), ("2024-12-31", 3.0, 66.0)]


def test_eps_history_skips_years_without_a_nearby_price(monkeypatch):
    monkeypatch.setattr(markets.Yahoo, "with_crumb", lambda f: json.loads(_ts([("2015-12-31", 1.0), ("2024-12-31", 3.0)])))
    monkeypatch.setattr(markets, "http_json", lambda url, timeout=20: _chart([(_day(2024, 12, 1), 66.0)]))
    assert [o["d"] for o in markets.eps_history("1120", "SR")] == ["2024-12-31"]


def test_eps_history_returns_empty_when_yahoo_fails(monkeypatch):
    def boom(f):
        raise OSError("down")
    monkeypatch.setattr(markets.Yahoo, "with_crumb", boom)
    assert markets.eps_history("1120", "SR") == []
    assert markets._safe_eps_history("1120", "SR") == []


def test_fundamentals_ask_for_the_new_columns():
    for c in ("free_cash_flow_per_share_ttm", "earnings_per_share_diluted_yoy_growth_fy", "total_revenue_yoy_growth_ttm", "earnings_per_share_forecast_next_fy"):
        assert c in markets.FUND_COLS
