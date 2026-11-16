# -*- coding: utf-8 -*-
"""SEC EDGAR: official US filings (free, no key). Gives the annual figures the fair-value methods need."""
import re

from .base import Connector, NoData, http_json, REG


def _core():
    import core
    return core


def latest(facts, tag, unit, annual_only=False):
    """Newest value of a us-gaap tag: from the latest 10-K when annual_only, else from any filing."""
    node = ((facts.get("us-gaap") or {}).get(tag) or {}).get("units", {}).get(unit) or []
    rows = [r for r in node if r.get("val") is not None and (not annual_only or (r.get("fp") == "FY" and r.get("form") == "10-K"))]
    if not rows:
        return None
    rows.sort(key=lambda r: (r.get("end") or "", r.get("filed") or ""))
    return rows[-1]["val"]


def from_facts(d):
    """Map an EDGAR company-facts document to the field names the app uses (annual figures)."""
    f = d.get("facts") or {}
    eps = latest(f, "EarningsPerShareDiluted", "USD/shares", True)
    if eps is None:
        eps = latest(f, "EarningsPerShareBasic", "USD/shares", True)
    shares = None
    sh = ((f.get("dei") or {}).get("EntityCommonStockSharesOutstanding") or {}).get("units", {}).get("shares") or []
    if sh:
        shares = sorted(sh, key=lambda r: (r.get("end") or "", r.get("filed") or ""))[-1]["val"]
    return {"last_annual_eps": eps, "earnings_per_share_fy": eps,
            "net_income_fy": latest(f, "NetIncomeLoss", "USD", True),
            "total_equity_fq": latest(f, "StockholdersEquity", "USD"),
            "total_shares_outstanding_fundamental": shares,
            "dps_common_stock_prim_issue_fy": latest(f, "CommonStockDividendsPerShareDeclared", "USD/shares", True)}


class Edgar(Connector):
    id, name = "edgar", "SEC EDGAR"
    kinds = ("fundamentals",)
    markets = ("US",)
    official = True
    gap = 0.2          # the SEC allows 10 requests a second
    per_min = 120
    note = "إفصاحات الشركات الأمريكية الرسمية: ربحية السهم السنوية وحقوق الملكية وصافي الدخل وتوزيعات السهم"

    def cik(self, ticker):
        c = _core()
        hit, _ = c.cache_get("cik|" + ticker, max_age=90 * 86400)
        if hit:
            return hit
        d = http_json("https://efts.sec.gov/LATEST/search-index?q=%%22%s%%22&forms=10-K" % ticker)
        for h in (d.get("hits") or {}).get("hits") or []:
            s = h.get("_source") or {}
            for nm, ck in zip(s.get("display_names") or [], s.get("ciks") or []):
                if re.search(r"\(%s\)" % re.escape(ticker), nm):
                    c.cache_put("cik|" + ticker, ck)
                    return ck
        raise NoData()

    def fundamentals(self, code, ex):
        t = code.upper().split(".")[0]
        c = _core()
        hit, _ = c.cache_get("edgar|" + t, max_age=12 * 3600)
        out = hit
        if not out:
            d = http_json("https://data.sec.gov/api/xbrl/companyfacts/CIK%s.json" % self.cik(t).zfill(10), timeout=45)
            out = from_facts(d)
            if out.get("earnings_per_share_fy") is None and out.get("total_equity_fq") is None:
                raise NoData()
            c.cache_put("edgar|" + t, out)
        import prices
        px = None
        try:
            rows = prices.get_history(t, "US", "1y").get("rows") or []
            px = rows[-1][4] if rows else None
        except Exception:
            px = None
        if not px:
            raise NoData()
        res = dict(out)
        res["close"] = px
        res["sector"] = ""
        return res


REG.register(Edgar())
