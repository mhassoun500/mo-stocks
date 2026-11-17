#!/usr/bin/env python3
"""Diagnostics for the live check (run on GitHub): what exactly each troubled source answers. Prints only
status codes, sizes, headers and the start of answers; nothing is saved or sent anywhere."""
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app"))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def get(url, headers=None, data=None):
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h, data=data), timeout=40) as r:
            body = r.read()
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return "ERR", {}, str(e).encode()


def show(name, url, **kw):
    st, hd, body = get(url, **kw)
    keep = {k: v for k, v in hd.items() if k.lower() in ("server", "content-type", "location", "set-cookie", "akamai-grn", "x-akamai-transformed", "cf-ray")}
    print("== %s\n   status %s, %d bytes, %s\n   %r" % (name, st, len(body), json.dumps(keep)[:300], body[:300]))
    return body


if __name__ == "__main__":
    from sources import defs
    full = {"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "ar,en;q=0.9",
            "Referer": "https://www.saudiexchange.sa/"}
    show("Saudi Exchange fund screener, plain", "https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/fund-screener?locale=ar")
    show("Saudi Exchange fund screener, browser headers", "https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/fund-screener?locale=ar", headers=full)
    show("Saudi Exchange home", "https://www.saudiexchange.sa/", headers=full)
    import time
    now = time.time()
    url = defs.feed("eg") % (time.strftime("%d/%m/%Y", time.gmtime(now - 3 * 86400)), time.strftime("%d/%m/%Y", time.gmtime(now + 86400)))
    body = show("EGX disclosures search", url, headers={"Accept": "text/html", "Accept-Language": "ar"})
    print("   NewsDetails links: %d, (XXX.CA) codes: %d" % (body.count(b"NewsDetails.aspx?NewsID="), body.count(b".CA)")))
    i = body.find(b"NewsDetails.aspx?NewsID=")
    print("   around the first link: %r" % body[max(0, i - 200):i + 300])
    body = show("SEC submissions (browser-like)", "https://data.sec.gov/submissions/CIK0000320193.json", headers={"Accept": "application/json"})
    body = show("SEC submissions (named app)", "https://data.sec.gov/submissions/CIK0000320193.json", headers={"User-Agent": "MoStocks mo-stocks@users.noreply.github.com", "Accept": "application/json"})
    # one Form 4 report: does its XML come back and read?
    import filings
    from sources.base import REG
    d = json.loads(filings.sec_get("https://data.sec.gov/submissions/CIK0000320193.json").decode())
    items = [x for x in filings.parse_sec_submissions(d) if x["form"] == "4"][:3]
    uas = ["MoStocks desktop app admin@mostocks.app", "MoStocks/2.14 (+https://github.com/mhassoun500/mo-stocks) contact@mostocks.app",
           "Mozilla/5.0 (compatible; MoStocks/2.14; +https://github.com/mhassoun500/mo-stocks)", UA]
    for ua in uas:
        for u in ([x["raw"] for x in items[:1]] + ["https://data.sec.gov/submissions/CIK0000320193.json"]):
            st, hd, body = get(u, headers={"User-Agent": ua, "Accept": "*/*"})
            print("   SEC %-45s %-28s -> %s %d bytes %r" % (ua[:45], u[-28:], st, len(body), body[:40]))
    raise SystemExit(0)
    # TradingView: which interest and income columns have values
    from markets import tv_scan, TV_MARKET_OF
    cols = ["name", "total_revenue_fy", "non_oper_interest_income_fy", "interest_income_fy", "non_oper_income_fy",
            "pretax_income_fy", "other_income_fy", "interest_income_net_fy", "total_non_oper_income_fy", "net_interest_income_fy"]
    for code, ex in (("2050", "SR"), ("SWDY", "CA"), ("AAPL", "US")):
        for c in cols[1:]:
            try:
                d = tv_scan(TV_MARKET_OF[ex], {"filter": [{"left": "name", "operation": "equal", "right": code}], "columns": ["name", c], "range": [0, 3]})
                vals = [r["d"][1] for r in d.get("data") or []]
                print("   TV %s %-30s %s" % (code, c, vals[:2]))
            except Exception as e:
                print("   TV %s %-30s ERROR %s" % (code, c, str(e)[:80]))
