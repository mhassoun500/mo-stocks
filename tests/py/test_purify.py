"""Phase 3 step 2: purification figures from several sources, kept apart by kind, with the program's estimate last."""
import collections
import copy
import http.client
import json
import os
import threading
from http.server import ThreadingHTTPServer

import pytest

import core
import main
import markets
import purify
import server as srvmod
from sources import base, defs, edgar
from sources.base import FormatChanged, NoData, REG

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
BUNDLED = os.path.join(ROOT, "app", "data", "purify_sa.json")

# lines exactly as the text of the 2025 Al-Maqased study reads (presentation forms already folded by the reader),
# including a header, a page date, a stray glyph, the Aramco special case, a Nomu company and the three verdicts
STUDY_LINES = [
    "٢٦/١٠/٢٢",
    "التسلسلرمز الشركةالشركاتالرأي الشرعيالقطاعمبلغ التطهير لكل سهمالسوق",
    "12222شركة الÑيت العÎبية السعوديةراجع المنهجية فقرة ١٨الطاقة0.05رئيسي",
    "3671201شركة تكوين المتطورة للصناعاتغير متوافقةالمواد الأساسية0.01رئيسي",
    "2901202مبكوشركة الشرق الأوسط لصناعة وإنتاج الورق )مبكو(مختلطةالمواد الأساسية0.19رئيسي",
    "22030المصاûشركة المصاûŅ العÎبية السعوديةنقيةالطاقة0.06رئيسي",
    "3724084شركة دراية الماليةغير متوافقةالخدمات المالية0.81رئيسي",
    "3549589فادشركة فاد العالميةمختلطةتجزئة وتوÒيع السلع الكمالية )موازي(2.73موازي",
    "2879655مسقاشركة مسقا للاستثمارنقيةإدارة وتطوير العقارات )موازي(0.01موازي",
    "اختصار الشركة",
    "Ņ",
]
STUDY_EXPECT = {"2222": [0.05, "s", "main"], "1201": [0.01, "n", "main"], "1202": [0.19, "m", "main"],
                "2030": [0.06, "p", "main"], "4084": [0.81, "n", "main"], "9589": [2.73, "m", "nomu"],
                "9655": [0.01, "p", "nomu"]}


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setattr(core, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(core, "CACHE_DIR", str(tmp_path / "cache"), raising=False)
    monkeypatch.setattr(core, "ERROR_LOG", str(tmp_path / "errors.log"))
    monkeypatch.setattr(core, "_RECENT", {})
    monkeypatch.setitem(defs.STATE, "loaded", None)
    monkeypatch.setattr(base, "sleep", lambda s: None)
    os.makedirs(str(tmp_path / "cache"), exist_ok=True)
    core.Store.set("src_off", [])


# ---------------------------------------------------------------- reading the study
def test_study_rows_are_read_from_the_pdf_text():
    assert purify.parse_maqased_text("\n".join(STUDY_LINES)) == STUDY_EXPECT


def test_study_rows_read_right_to_left_are_understood_too():
    """Some PDF readers give each Arabic line reversed; the same row must come out the same."""
    rev = "\n".join(line[::-1] for line in STUDY_LINES)
    assert purify.parse_maqased_text(rev) == STUDY_EXPECT


def test_sequence_number_is_not_mistaken_for_the_code():
    rows = purify.parse_maqased_text("1904327الرمزشركة الرمز العقاريةنقيةإدارة وتطوير العقارات0.12رئيسي")
    assert rows == {"4327": [0.12, "p", "main"]}


def test_bundled_study_matches_the_published_counts():
    d = json.load(open(BUNDLED, encoding="utf-8"))
    rows = d["rows"]
    assert len(rows) == 382                       # 260 main market + 121 Nomu + Aramco, as the study states
    assert collections.Counter(r[1] for r in rows.values()) == {"p": 286, "m": 80, "n": 15, "s": 1}
    assert all(len(c) == 4 and c.isdigit() for c in rows)
    assert all(0 <= r[0] < 100 and r[2] in ("main", "nomu") for r in rows.values())
    assert d["unit"] == "amt" and d["period"] == "2025"
    assert d["pdf"] == defs.DEFAULTS["purify"]["maqased_sa"]["url"]   # the shipped copy is the file the definitions name


def test_fetch_refuses_a_file_that_is_not_the_study(monkeypatch):
    monkeypatch.setattr(base, "http_get", lambda *a, **k: b"<html>moved</html>")
    with pytest.raises(FormatChanged):
        purify.fetch_maqased("https://data.argaam.com/x.pdf", "2026")
    monkeypatch.setattr(base, "http_get", lambda *a, **k: b"%PDF-1.7 ...")
    monkeypatch.setattr(purify, "pdf_text", lambda data: "\n".join(STUDY_LINES))   # only 7 rows: a layout change
    with pytest.raises(FormatChanged):
        purify.fetch_maqased("https://data.argaam.com/x.pdf", "2026")
    assert "format.maqased" in open(core.ERROR_LOG, encoding="utf-8").read()


def test_fetch_reads_a_full_study(monkeypatch):
    many = ["%d%04dشركة %dنقيةالطاقة0.%02dرئيسي" % (i, 1000 + i, i, i % 100) for i in range(1, 260)]
    monkeypatch.setattr(base, "http_get", lambda *a, **k: b"%PDF-1.7 ...")
    monkeypatch.setattr(purify, "pdf_text", lambda data: "\n".join(many))
    d = purify.fetch_maqased("https://data.argaam.com/new.pdf", "2026")
    assert len(d["rows"]) == 259 and d["period"] == "2026" and d["pdf"].endswith("new.pdf") and d["unit"] == "amt"


# ---------------------------------------------------------------- the connector and the yearly refresh
def test_connector_does_not_download_the_copy_it_already_ships():
    with pytest.raises(NoData):
        REG.items["maqased"].sharia()


def test_connector_reads_a_new_year_once(monkeypatch):
    d = copy.deepcopy(defs.DEFAULTS)
    d["version"] = 2
    d["purify"]["maqased_sa"] = {"url": "https://data.argaam.com/files/download/2026.pdf", "period": "2026"}
    monkeypatch.setitem(defs.STATE, "loaded", d)
    calls = []
    monkeypatch.setattr(purify, "fetch_maqased", lambda url, year: calls.append(url) or {"pdf": url, "period": year, "rows": {"1120": [0.1, "p", "main"]}})
    out = REG.items["maqased"].sharia()
    assert out["period"] == "2026" and calls == ["https://data.argaam.com/files/download/2026.pdf"]
    core.cache_put("sharia|pur_sa", out)
    assert REG.items["maqased"].sharia() == out and len(calls) == 1      # cached: not downloaded again


def test_refresh_treats_nothing_newer_as_normal(monkeypatch):
    monkeypatch.setattr(REG, "items", {"maqased": REG.items["maqased"]})
    res = markets.sharia_refresh()
    assert res == {"pur_sa": None}
    assert not os.path.exists(core.ERROR_LOG) or "pur_sa" not in open(core.ERROR_LOG, encoding="utf-8").read()
    assert "pur_sa" in markets.sharia_lists()


# ---------------------------------------------------------------- definitions file
def test_definitions_accept_a_new_study_address_and_refuse_strange_ones():
    def with_purify(v):
        d = copy.deepcopy(defs.DEFAULTS)
        d["purify"] = v
        return defs.validate(d, "2.13.0")
    assert with_purify({"maqased_sa": {"url": "https://almaqased.net/wp-content/uploads/2027/list.pdf", "period": "2026"}}) == (True, "")
    assert not with_purify({"maqased_sa": {"url": "https://evil.example/list.pdf", "period": "2026"}})[0]
    assert not with_purify({"maqased_sa": {"url": "http://data.argaam.com/list.pdf"}})[0]
    assert not with_purify({"maqased_sa": {"url": "https://data.argaam.com/a.pdf", "run": "x"}})[0]
    assert not with_purify({"other": {"url": "https://data.argaam.com/a.pdf"}})[0]
    old = copy.deepcopy(defs.DEFAULTS)
    del old["purify"]                          # a file written for older versions is still fine
    assert defs.validate(old, "2.13.0") == (True, "")
    assert defs.purify()["url"] == defs.DEFAULTS["purify"]["maqased_sa"]["url"]


# ---------------------------------------------------------------- the program's estimate
def test_estimate_is_interest_over_revenue_and_never_invented():
    assert purify.estimate_pct(1000, 25, "Process Industries") == 2.5
    assert purify.estimate_pct(1000, 0, "") == 0
    assert purify.estimate_pct(1000, 25, "Finance") is None          # interest is a bank's business
    assert purify.estimate_pct(1000, 25, "بنوك") is None
    assert purify.estimate_pct(0, 25, "") is None
    assert purify.estimate_pct(None, 25, "") is None
    assert purify.estimate_pct(100, 250, "") is None                  # more interest than revenue: figures do not fit
    assert purify.estimate_pct(100, -1, "") is None


def test_estimate_endpoint_logic(monkeypatch):
    monkeypatch.setattr(markets, "_purify_tradingview", lambda c, ex: {"rev": 2e9, "int": 3e7, "sector": "Retail Trade", "period": "2025", "source": "TradingView"})
    r = markets.purify_estimate("4190.SR", "SR")
    assert r["ok"] and r["pct"] == 1.5 and r["period"] == "2025" and r["source"] == "TradingView"
    monkeypatch.setattr(markets, "_purify_tradingview", lambda c, ex: (_ for _ in ()).throw(AssertionError("cached, no call")))
    assert markets.purify_estimate("4190", "SR")["pct"] == 1.5


def test_estimate_failures_are_explained_logged_and_not_kept(monkeypatch):
    monkeypatch.setattr(markets, "_purify_tradingview", lambda c, ex: {"rev": 5e9, "int": 1e9, "sector": "Finance", "period": "", "source": "TradingView"})
    r = markets.purify_estimate("1120", "SR")
    assert not r["ok"] and "مالية" in r["error"]

    def boom(c, ex):
        raise RuntimeError("unknown column")
    monkeypatch.setattr(markets, "_purify_tradingview", boom)
    r = markets.purify_estimate("COMI", "CA")
    assert not r["ok"] and "unknown column" in open(core.ERROR_LOG, encoding="utf-8").read()
    assert core.cache_get("purest|CA|COMI")[0] is None
    assert not markets.purify_estimate("X", "GOLD")["ok"]


def test_us_estimate_falls_back_to_sec_filings(monkeypatch):
    monkeypatch.setattr(markets, "_purify_tradingview", lambda c, ex: None)
    monkeypatch.setattr(markets, "_purify_edgar", lambda c: {"rev": 4e8, "int": 2e6, "sector": "", "period": "", "source": "SEC EDGAR"})
    r = markets.purify_estimate("ZZZ", "US")
    assert r["ok"] and r["pct"] == 0.5 and r["source"] == "SEC EDGAR"


def test_edgar_reads_revenue_and_interest():
    fy = lambda v, end: {"val": v, "fp": "FY", "form": "10-K", "end": end, "filed": end}
    facts = {"facts": {"us-gaap": {
        "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [fy(900, "2024-12-31"), fy(1000, "2025-12-31")]}},
        "InvestmentIncomeInterest": {"units": {"USD": [fy(12, "2025-12-31")]}}}}}
    f = edgar.from_facts(facts)
    assert f["total_revenue_fy"] == 1000 and f["non_oper_interest_income_fy"] == 12


# ---------------------------------------------------------------- server and page
@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
    main.SERVER_PORT[0] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()


def test_estimate_route(server, monkeypatch):
    monkeypatch.setattr(srvmod, "purify_estimate", lambda code, ex: {"ok": True, "pct": 1.25, "code": code, "ex": ex})
    c = http.client.HTTPConnection("127.0.0.1", server, timeout=10)
    c.request("GET", "/api/purify_est?code=2050&ex=SR", headers={"Host": "127.0.0.1:%d" % server, "X-Mo-Token": main.API_TOKEN})
    j = json.loads(c.getresponse().read())
    assert j == {"ok": True, "pct": 1.25, "code": "2050", "ex": "SR"}


def test_page_ships_the_study():
    """The built page (made by tools/build_page.py before the tests run) carries the study for the browser side."""
    import re
    page = open(os.path.join(ROOT, "app", "page.html"), encoding="utf-8").read()
    m = re.search(r'<script type="application/json" id="purify-sa">(.*?)</script>', page, re.S)
    assert m and len(json.loads(m.group(1))["rows"]) == 382
    assert 'id="purBadge"' in page and 'data-sort="purN"' in page
