#!/usr/bin/env python3
"""Live check of the outside sources, run by hand on GitHub (Actions > Live sources check > Run workflow).

Each line says OK, WARN or FAIL with what came back, so a source that changed its layout or address is seen
before a user meets it. Nothing is saved and nothing is sent anywhere; the exit code is 1 only when a source
the app depends on is broken."""
import json
import os
import sys
import tempfile
import traceback

os.environ.setdefault("HOME", tempfile.mkdtemp())
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app"))

RESULTS = []


def check(name, fn, required=True):
    try:
        msg = fn()
        RESULTS.append(("OK  ", name, msg))
    except Exception as e:
        RESULTS.append(("FAIL" if required else "WARN", name, "%s: %s" % (type(e).__name__, str(e)[:300])))
        if os.environ.get("LIVE_DEBUG"):
            traceback.print_exc()


def saudi_fund_list():
    import funds
    rows = funds.fetch_tadawul_list()
    off = sum(1 for r in rows if r["sharia"] == "official")
    r = rows[0]
    return "%d funds, %d listed Sharia compliant; first: %s = %s %s on %s" % (len(rows), off, r["id"], r["price"], r["currency"], r["date"])


def saudi_fund_history():
    import funds
    rows = funds.fetch_tadawul_history("SA003215")
    assert len(rows) > 100, "only %d prices" % len(rows)
    return "%d daily prices, last %s" % (len(rows), rows[-1][1])


def maqased_pdf():
    import purify
    from sources import defs
    p = defs.purify("maqased_sa")
    d = purify.fetch_maqased(p["url"], p["period"])
    rows = d["rows"]
    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "data", "purify_sa.json"), encoding="utf-8") as f:
        shipped = json.load(f)["rows"]
    same = sum(1 for c, v in rows.items() if c in shipped and abs(shipped[c][0] - v[0]) < 1e-9 and shipped[c][1] == v[1])
    assert same >= 0.95 * len(shipped), "the app's PDF reader agrees with the shipped copy on only %d of %d companies" % (same, len(shipped))
    return "%d companies read with pypdf; %d of %d match the copy shipped with the app" % (len(rows), same, len(shipped))


def tradingview_purify_columns():
    import markets
    out = []
    for code, ex in (("2050", "SR"), ("SWDY", "CA"), ("AAPL", "US")):
        f = markets._purify_tradingview(code, ex)
        out.append("%s: %s" % (code, f and {k: f.get(k) for k in ("rev", "int", "sector", "period")}))
    return "; ".join(out)


def edgar_figures():
    from sources import edgar
    from sources.base import REG
    c = REG.items["edgar"]
    f = c.fundamentals("AAPL", "US")
    return "revenue %s, interest %s" % (f.get("total_revenue_fy"), f.get("non_oper_interest_income_fy"))


def saudi_announcements():
    from sources.base import REG
    rows = REG.items["sa_announce"].filings()
    assert rows, "no announcements read"
    return "%d announcements, newest %s: %s" % (len(rows), rows[0]["code"], rows[0]["title"][:60])


def egx_disclosures():
    from sources.base import REG
    rows = REG.items["egx_news"].filings()
    assert rows, "no disclosures read"
    return "%d disclosures, newest %s: %s" % (len(rows), rows[0]["code"], rows[0]["title"][:60])


def sec_company_file():
    """The insiders part needs a contact e-mail; the run uses the repository secret SEC_CONTACT when the owner set one."""
    import core
    import filings
    c = os.environ.get("SEC_CONTACT", "").strip()
    if c:
        core.Store.set("prefs", {"secContact": c})
    f = filings.company_file("AAPL", "US")
    assert f.get("ok"), f.get("error")
    ins = ("no contact e-mail set, insiders skipped" if f.get("insidersNeed") == "contact"
           else "%d insider buys/sells in a year" % len(f["insiders"] or []))
    import time
    rec = f["record"]
    span = "%s..%s" % tuple(time.strftime("%Y-%m-%d", time.gmtime((x or 0) / 1000)) for x in (rec.get("first"), rec.get("last")))
    return "%d filings, %s, results due %s; all %d read: %s, %s" % (len(f["items"]), ins, (rec.get("due") or {}).get("date"), rec["n"], rec["byType"], span)


def scanner_fair_values():
    """Phase 4: one market-wide read gives the scanner what it needs for fair values."""
    import markets
    out = []
    for ex in ("SR", "CA"):
        d = markets.scan_fundamentals(ex)
        assert d.get("ok"), d.get("error")
        withpe = sum(1 for f in d["f"].values() if f.get("price_earnings_ttm"))
        out.append("%s: %d companies, %d with P/E, %d sectors with medians" % (ex, len(d["f"]), withpe, len(d["med"]) - 1))
    return "; ".join(out)


def calendar_dates():
    import markets
    d = markets.events_calendar([{"code": "AAPL", "ex": "US"}, {"code": "2222", "ex": "SR"}, {"code": "COMI", "ex": "CA"}])
    return "%d events, failed %s: %s" % (len(d["events"]), d["failed"], ", ".join("%s %s%s" % (e["code"], e["kind"], "*" if e.get("est") else "") for e in d["events"][:8]))


def mubasher_funds():
    import funds
    rows = funds.fetch_fund_list("EG")
    return "%d Egyptian funds" % len(rows)


def mubasher_fund_history():
    import funds
    rows = funds.fetch_fund_history(2680)
    return "%d prices, last %s" % (len(rows), rows[-1] if rows else None)


if __name__ == "__main__":
    import core  # noqa: F401  (sets up the data folder)
    check("Saudi Exchange fund list", saudi_fund_list)
    check("Saudi Exchange fund history", saudi_fund_history)
    check("Al-Maqased purification study (PDF)", maqased_pdf)
    check("TradingView revenue and interest columns", tradingview_purify_columns, required=False)
    check("SEC EDGAR revenue and interest", edgar_figures, required=False)
    check("Saudi Exchange announcements", saudi_announcements)
    check("EGX disclosures", egx_disclosures)
    check("SEC EDGAR filings and Form 4", sec_company_file, required=False)
    check("Scanner fair values (TradingView, whole market)", scanner_fair_values, required=False)
    check("Events calendar (Yahoo, SEC)", calendar_dates, required=False)
    check("Mubasher Egyptian fund list (old address)", mubasher_funds, required=False)
    check("Mubasher fund history files", mubasher_fund_history, required=False)
    for status, name, msg in RESULTS:
        print("%s  %-44s %s" % (status, name, msg))
    sys.exit(1 if any(r[0] == "FAIL" for r in RESULTS) else 0)
