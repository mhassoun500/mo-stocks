# -*- coding: utf-8 -*-
"""Optional sources that need the user's own free API key (added from the settings). Without a key they stay idle.
Their answers are turned into the same shapes the app already uses."""
import calendar
import time
import urllib.parse

from .base import Connector, NoData, AuthError, http_json, REG

BARS = {"1y": 260, "2y": 520, "5y": 1300, "max": 5000}


def _num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def _ms(date_str):
    t = time.strptime(date_str[:10], "%Y-%m-%d")
    return calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0)) * 1000


def _history_result(source, code, rows, name=""):
    rows = [r for r in rows if r and r[4] is not None]
    rows.sort(key=lambda r: r[0])
    if len(rows) < 2:
        raise NoData()
    return {"ok": True, "source": source, "symbol": code.upper(), "interval": "1d", "name": name or code.upper(),
            "currency": "", "rows": rows, "dividends": [], "splits": []}


class TwelveData(Connector):
    id, name = "twelvedata", "Twelve Data"
    kinds = ("history",)
    key_service = "twelvedata"
    keys_url = "https://twelvedata.com/pricing"
    gap = 0.5          # the free plan allows 8 calls a minute
    per_min = 8
    note = "شموع يومية؛ الخطة المجانية تغطي الأسهم الأمريكية وبعض البورصات الأخرى"

    def history(self, code, ex, rng, interval="1d", lite=False):
        if interval != "1d":
            raise NoData()
        sym = code.upper().split(".")[0]
        q = {"symbol": sym, "interval": "1day", "outputsize": BARS.get(rng, 520), "apikey": self.key(), "order": "ASC"}
        if ex == "SR":
            q["exchange"] = "Tadawul"
        elif ex == "CA":
            q["exchange"] = "EGX"
        d = http_json("https://api.twelvedata.com/time_series?" + urllib.parse.urlencode(q))
        if d.get("status") == "error" or "values" not in d:
            c = int(d.get("code") or 0)
            if c in (401, 403):
                raise AuthError(d.get("message") or "key refused")
            if c == 429:
                raise ConnectionError(d.get("message") or "rate limit")
            raise NoData()
        rows = [[_ms(v["datetime"]), _num(v.get("open")), _num(v.get("high")), _num(v.get("low")),
                 _num(v.get("close")), _num(v.get("volume")) or 0] for v in d["values"]]
        meta = d.get("meta") or {}
        r = _history_result("Twelve Data", code, rows)
        r["currency"] = meta.get("currency") or ""
        return r


class FMP(Connector):
    id, name = "fmp", "Financial Modeling Prep"
    kinds = ("history", "fundamentals")
    key_service = "fmp"
    keys_url = "https://site.financialmodelingprep.com/developer/docs"
    gap = 0.5
    per_min = 30
    note = "شموع يومية ونسب الشركات؛ الخطة المجانية 250 طلبًا يوميًا"

    def _sym(self, code, ex):
        c = code.upper().split(".")[0]
        return c + {"SR": ".SR", "CA": ".CA"}.get(ex, "")

    def _get(self, path, **q):
        q["apikey"] = self.key()
        d = http_json("https://financialmodelingprep.com/stable/%s?%s" % (path, urllib.parse.urlencode(q)))
        if isinstance(d, dict) and d.get("Error Message"):
            raise AuthError(str(d["Error Message"])[:120])
        return d

    def history(self, code, ex, rng, interval="1d", lite=False):
        if interval != "1d":
            raise NoData()
        d = self._get("historical-price-eod/full", symbol=self._sym(code, ex))
        if not isinstance(d, list) or not d:
            raise NoData()
        n = BARS.get(rng, 520)
        rows = [[_ms(v["date"]), _num(v.get("open")), _num(v.get("high")), _num(v.get("low")), _num(v.get("close")),
                 _num(v.get("volume")) or 0] for v in d]
        rows.sort(key=lambda r: r[0])
        return _history_result("Financial Modeling Prep", code, rows[-n:])

    def fundamentals(self, code, ex):
        sym = self._sym(code, ex)
        prof = self._get("profile", symbol=sym)
        prof = prof[0] if isinstance(prof, list) and prof else None
        if not prof or not _num(prof.get("price")):
            raise NoData()
        rat = self._get("ratios-ttm", symbol=sym)
        rat = rat[0] if isinstance(rat, list) and rat else {}
        km = self._get("key-metrics-ttm", symbol=sym)
        km = km[0] if isinstance(km, list) and km else {}
        pt = self._get("price-target-consensus", symbol=sym)
        pt = pt[0] if isinstance(pt, list) and pt else {}
        dy = _num(rat.get("dividendYieldTTM"))
        roe = _num(km.get("returnOnEquityTTM"))
        return {"close": _num(prof.get("price")), "price_earnings_ttm": _num(rat.get("priceToEarningsRatioTTM")),
                "price_book_fq": _num(rat.get("priceToBookRatioTTM")),
                "price_target_average": _num(pt.get("targetConsensus")), "price_target_high": _num(pt.get("targetHigh")),
                "price_target_low": _num(pt.get("targetLow")),
                "dividends_yield_current": dy * 100 if dy is not None else None,
                "return_on_equity_fq": roe * 100 if roe is not None else None,
                "sector": prof.get("sector") or "", "market_cap_basic": _num(prof.get("marketCap")),
                "currency": prof.get("currency") or ""}


class AlphaVantage(Connector):
    id, name = "alphavantage", "Alpha Vantage"
    kinds = ("fundamentals",)
    markets = ("US",)
    key_service = "alphavantage"
    keys_url = "https://www.alphavantage.co/support/#api-key"
    gap = 0.5          # the free plan allows 5 calls a minute and 25 a day
    per_min = 5
    note = "نظرة على الشركات الأمريكية؛ الخطة المجانية 25 طلبًا يوميًا"

    def _get(self, **q):
        q["apikey"] = self.key()
        d = http_json("https://www.alphavantage.co/query?" + urllib.parse.urlencode(q))
        if isinstance(d, dict) and (d.get("Note") or d.get("Information")):
            raise ConnectionError(str(d.get("Note") or d.get("Information"))[:160])
        return d

    def fundamentals(self, code, ex):
        sym = code.upper().split(".")[0]
        o = self._get(function="OVERVIEW", symbol=sym)
        if not o or not o.get("Symbol"):
            raise NoData()
        qt = (self._get(function="GLOBAL_QUOTE", symbol=sym).get("Global Quote") or {})
        px = _num(qt.get("05. price"))
        if not px:
            raise NoData()
        dy, roe = _num(o.get("DividendYield")), _num(o.get("ReturnOnEquityTTM"))
        return {"close": px, "price_earnings_ttm": _num(o.get("PERatio")), "price_book_fq": _num(o.get("PriceToBookRatio")),
                "earnings_per_share_diluted_ttm": _num(o.get("DilutedEPSTTM") or o.get("EPS")),
                "book_value_per_share_fq": _num(o.get("BookValue")),
                "price_target_average": _num(o.get("AnalystTargetPrice")),
                "dividends_yield_current": dy * 100 if dy is not None else None,
                "return_on_equity_fq": roe * 100 if roe is not None else None,
                "sector": (o.get("Sector") or "").title(), "market_cap_basic": _num(o.get("MarketCapitalization"))}


class Finnhub(Connector):
    id, name = "finnhub", "Finnhub"
    kinds = ("fundamentals",)
    markets = ("US",)
    key_service = "finnhub"
    keys_url = "https://finnhub.io/register"
    gap = 1.0
    per_min = 55
    note = "مؤشرات الشركات الأمريكية؛ الخطة المجانية 60 طلبًا في الدقيقة"

    def _get(self, path, **q):
        q["token"] = self.key()
        return http_json("https://finnhub.io/api/v1/%s?%s" % (path, urllib.parse.urlencode(q)))

    def fundamentals(self, code, ex):
        sym = code.upper().split(".")[0]
        px = _num((self._get("quote", symbol=sym) or {}).get("c"))
        m = (self._get("stock/metric", symbol=sym, metric="all") or {}).get("metric") or {}
        if not px or not m:
            raise NoData()
        return {"close": px, "price_earnings_ttm": _num(m.get("peTTM") or m.get("peBasicExclExtraTTM")),
                "price_book_fq": _num(m.get("pbQuarterly") or m.get("pbAnnual")),
                "earnings_per_share_diluted_ttm": _num(m.get("epsTTM")),
                "book_value_per_share_fq": _num(m.get("bookValuePerShareQuarterly")),
                "dividends_yield_current": _num(m.get("dividendYieldIndicatedAnnual")),
                "return_on_equity_fq": _num(m.get("roeTTM")), "market_cap_basic": (_num(m.get("marketCapitalization")) or 0) * 1e6 or None}


for _c in (TwelveData, FMP, AlphaVantage, Finnhub):
    REG.register(_c())
