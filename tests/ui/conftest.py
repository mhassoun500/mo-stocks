"""Page tests in a real browser (Playwright, Chromium) against the app's own local server, with prices and figures
from tests/fixtures, so they need no internet. Run: python -m pytest -q tests/ui"""
import json
import os
import sys
import tempfile
import threading

# Playwright finds its browser under the home folder; keep that place before the tests move HOME to a scratch folder
if not os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
    if sys.platform == "win32":
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(os.environ.get("LOCALAPPDATA", ""), "ms-playwright")
    elif sys.platform == "darwin":
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.expanduser("~/Library/Caches/ms-playwright")
    else:
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "ms-playwright")
_TMP = tempfile.mkdtemp(prefix="mostocks-ui-")
os.environ["HOME"] = _TMP
os.environ["APPDATA"] = _TMP
os.environ["XDG_DATA_HOME"] = os.path.join(_TMP, "data")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "app"))
sys.path.insert(0, os.path.join(ROOT, "tests", "py"))

import pytest  # noqa: E402

FIX = os.path.join(ROOT, "tests", "fixtures")


def fixture(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


HIST = {"1120": fixture("1120")["rows"], "COMI": fixture("COMI")["rows"], "AAPL": fixture("AAPL")["rows"],
        "XAU-USD-OZ": fixture("GOLD")["rows"], "2222": fixture("1120")["rows"]}
FUND = {"1120": fixture("4014_fund"), "COMI": fixture("COMI_fund"), "AAPL": fixture("AAPL_fund")}


def route_api(route):
    """Outside data from the fixtures; everything the app keeps for itself goes to the real server."""
    from urllib.parse import parse_qs, urlparse
    u = urlparse(route.request.url)
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    c = (q.get("code") or q.get("symbol") or "").split(".")[0].upper()
    p = u.path
    if p == "/api/history":
        if c in HIST:
            return route.fulfill(json={"ok": True, "rows": HIST[c], "name": c, "symbol": c, "source": "fixture", "currency": "SAR"})
        return route.fulfill(json={"ok": False, "error": "no fixture"})
    if p == "/api/fundamentals" and c in FUND:
        return route.fulfill(json=FUND[c])
    if p == "/api/universe":
        return route.fulfill(json={"ok": True, "ex": "SR", "items": [{"symbol": "1120.SR", "name": "الراجحي", "short": "الراجحي", "chg": 0.5},
                                                                      {"symbol": "2222.SR", "name": "أرامكو", "short": "أرامكو", "chg": -0.2}]})
    if p == "/api/indices":
        import markets
        items = []
        for ex, lst in markets.MAIN_INDICES.items():
            for i, (code, name, short, tv_only) in enumerate(lst):
                if code == "^EGX33":
                    items.append({"ex": ex, "code": code, "name": name, "short": short, "ok": False, "error": "متاح من TradingView فقط."})
                    continue
                base = 1000.0 * (i + 2)
                spark = [base * (1 + 0.004 * ((k * 7) % 5 - 2)) for k in range(23)]
                items.append({"ex": ex, "code": code, "name": name, "short": short, "ok": True, "last": spark[-1],
                              "chg": spark[-1] / spark[-2] - 1, "month": spark[-1] / spark[0] - 1, "spark": spark, "t": 0})
        oz = [4000 * (1 + 0.003 * ((k * 5) % 7 - 3)) for k in range(23)]
        items += [{"ex": "GOLD", "code": "XAU-USD-OZ", "open": "GOLD:XAU-USD-OZ", "name": "الذهب — أوقية بالدولار", "short": "الأوقية ($)", "ok": True,
                   "last": oz[-1], "chg": oz[-1] / oz[-2] - 1, "spark": oz},
                  {"ex": "GOLD", "code": "SA24", "open": "GOLD:XAU-SAR-24", "name": "جرام عيار 24", "short": "جرام عيار 24", "cur": "SAR", "karat": 24,
                   "source": "ZahabPrice", "ok": True, "last": 453.82, "chg": None, "updated": "2026-11-18T14:23:54+03:00"},
                  {"ex": "GOLD", "code": "EG21", "open": "GOLD:XAU-EGP-21", "name": "جرام عيار 21", "short": "جرام عيار 21", "cur": "EGP", "karat": 21,
                   "source": "مصراوي", "ok": True, "last": 5830.0, "buy": 5780.0, "chg": -70 / 5900, "updated": "2026-11-18T12:22:54+02:00"}]
        return route.fulfill(json={"ok": True, "items": items})
    if p == "/api/news":
        return route.fulfill(json={"ok": True, "items": [{"title": "خبر", "link": "https://n.example/1", "source": "x", "date": "2026-11-17T10:00:00Z"}]})
    if p in ("/api/profile", "/api/index", "/api/update", "/api/sharialists", "/api/yaaqen", "/api/purify_est", "/api/filings",
             "/api/sectors", "/api/scanfund", "/api/calendar", "/api/ussharia", "/api/search"):
        return route.fulfill(json={"ok": False})
    return route.continue_()


@pytest.fixture(scope="session")
def app_url():
    from http.server import ThreadingHTTPServer
    import funds
    import main
    from test_funds_tadawul import HISTORY, PAGE
    big = PAGE.replace("</tbody>", "".join(
        '<tr><td><a href="?selectedFund=9%05d">صندوق %d</a></td><td>م</td><td>ريال سعودي</td><td>موافق الشريعة</td><td>هدف</td><td>1.5</td><td>0</td><td>2026/11/16</td><td>1</td><td>0</td></tr>' % (i, i)
        for i in range(120)) + "</tbody>")

    def fake_get(u, timeout=25):
        if "fund-screener" in u:
            return big
        if "MutualFundChartDataDownloader" in u:
            return HISTORY
        raise OSError("no network in page tests")
    funds._get = fake_get
    srv = ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
    main.SERVER_PORT[0] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d/" % srv.server_address[1]
    srv.shutdown()


@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def page_for(browser, app_url):
    """page_for(lang) → a fresh page in that language, with its page errors collected in page.errors."""
    ctxs = []

    def make(lang="ar", tour_done=True, theme="light"):
        import core
        core.Store.set("tourDone", tour_done)
        ctx = browser.new_context(viewport={"width": 1400, "height": 1000}, color_scheme=theme)
        ctx.add_init_script("try{localStorage.setItem('mo-lang','%s')}catch(e){}" % lang)
        ctxs.append(ctx)
        p = ctx.new_page()
        p.errors = []
        p.on("pageerror", lambda e: p.errors.append(str(e)))
        p.route("**/api/**", route_api)
        p.base = app_url
        return p
    yield make
    for c in ctxs:
        c.close()
