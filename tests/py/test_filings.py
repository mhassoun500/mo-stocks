"""Step 6: company file: disclosures (Saudi Exchange, EGX, SEC EDGAR), insiders (Form 4), record and expected results date."""
import calendar
import copy
import http.client
import json
import threading
from http.server import ThreadingHTTPServer

import pytest

import core
import filings
import main
import server as srvmod
from sources import base, defs
from sources.base import REG, Throttle

DAY = 86400000

# two entries exactly as the Saudi Exchange list returns them (17 Nov 2026), trimmed to the fields the app reads
SA_FEED = json.dumps({"announcementList": [
    {"SYMBOL": "2330", "PR_DATE": "Nov 17, 2026", "TITLE": "المتقدمة",
     "SHORT_DESC": "إعلان الشركة المتقدمة للبتروكيماويات عن استقالة عضو مجلس الإدارة واللجنة التنفيذية وتعيين عضو بديل في مجلس الإدارة",
     "PRESS_REL_ID": 99324, "newsDateStr": "17/11/2026 09:50:02",
     "announcementUrl": "/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements/issuer-announcements-details/?anId=99324&anCat=1&cs=2330&locale=ar"},
    {"SYMBOL": "4170", "SHORT_DESC": "إعلان إلحاقي من شركة المشروعات السياحية (شمس) بخصوص إعلان الشركة عن النتائج المالية الأولية للفترة المنتهية في 2026-09-30 (تسعة أشهر)",
     "PRESS_REL_ID": 99317, "newsDateStr": "16/11/2026 16:03:09", "announcementUrl": "/x?anId=99317"},
    {"SYMBOL": "TASI", "SHORT_DESC": "not a company", "PRESS_REL_ID": 1, "newsDateStr": ""},
], "totalCount": 91915})

# rows as the EGX disclosures search page has them
EGX_PAGE = """<table id="ctl00_C_N_GVNews"><tr> <td width="10" align="right"> <img src="/Images-ar/BlackArrowHome.jpg"> </td> <td class="Linkhome" align="right"> <a href="NewsDetails.aspx?NewsID=298125"> <span id="ctl00_C_N_GVNews_ctl02_lblTitle">اسيك للتعدين "أسكوم " (ASCM.CA) تعلن نتائج أعمالها المستقلة عن 9 أشهر</span></a></td> </tr>
<tr> <td> </td> <td class="Linkhome"> <a href="NewsDetails.aspx?NewsID=298120"> <span id="x">إعادة التعامل على الخدمات الملاحية والبترولية  - ماريديف (MOIL.CA)</span></a></td> </tr>
<tr> <td> </td> <td class="Linkhome"> <a href="NewsDetails.aspx?NewsID=298100"> <span id="y">تعاملات الداخليين والمساهمين الرئيسيين على الشركات المقيدة: جلسة 06/10/2026</span></a></td> </tr></table>"""


def ms(y, m, d):
    return calendar.timegm((y, m, d, 0, 0, 0)) * 1000


SEC_SUB = {"cik": "0000320193", "filings": {"recent": {
    "accessionNumber": ["0000320193-26-000101", "0000320193-26-000090", "0000320193-26-000080", "0000320193-25-000070"],
    "filingDate": ["2026-10-30", "2026-10-02", "2026-08-01", "2025-10-31"],
    "form": ["8-K", "4", "10-Q", "10-K"],
    "primaryDocument": ["a8k.htm", "xslF345X05/wk-form4_1.xml", "q3.htm", "k.htm"],
    "primaryDocDescription": ["8-K", "FORM 4", "10-Q", "10-K"],
    "items": ["2.02,9.01", "", "", ""]}}}

FORM4 = """<?xml version="1.0"?><ownershipDocument>
<reportingOwner><reportingOwnerId><rptOwnerName>SOMEONE</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>CFO</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable>
<nonDerivativeTransaction><transactionDate><value>2026-10-01</value></transactionDate><transactionCoding><transactionCode>S</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>230.5</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-10-01</value></transactionDate><transactionCoding><transactionCode>A</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>5000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-09-15</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>200</value></transactionShares><transactionPricePerShare><value>220</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
</nonDerivativeTable></ownershipDocument>"""


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setattr(core, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(core, "CACHE_DIR", str(tmp_path / "cache"), raising=False)
    (tmp_path / "cache").mkdir()
    monkeypatch.setattr(core, "ERROR_LOG", str(tmp_path / "errors.log"))
    monkeypatch.setattr(core, "_RECENT", {})
    monkeypatch.setitem(defs.STATE, "loaded", None)
    monkeypatch.setattr(base, "sleep", lambda s: None)
    core.Store.set("src_off", [])
    for c in REG.items.values():
        c.throttle = Throttle(c.per_min, c.gap)


# ---------------------------------------------------------------- reading the lists
def test_saudi_feed_is_read_with_riyadh_time_and_links():
    rows = filings.parse_saudi_feed(SA_FEED)
    assert [r["code"] for r in rows] == ["2330", "4170"], "index rows are not companies"
    a = rows[0]
    assert a["id"] == "SA99324" and a["dated"] and a["date"] == ms(2026, 11, 17) + (9 * 60 + 50 - 180) * 60000
    assert a["url"].startswith("https://www.saudiexchange.sa/wps/portal/") and "anId=99324" in a["url"]
    assert filings.classify(a["title"]) == "board" and filings.classify(rows[1]["title"]) == "results"


def test_egx_feed_takes_the_code_from_the_title_and_the_date_it_was_seen():
    rows = filings.parse_egx_feed(EGX_PAGE, 123)
    assert [(r["code"], r["id"]) for r in rows] == [("ASCM", "EG298125"), ("MOIL", "EG298120")], "the market-wide bulletin has no company"
    assert rows[0]["date"] == 123 and not rows[0]["dated"] and rows[0]["url"].endswith("NewsID=298125")
    assert filings.classify(rows[0]["title"]) == "results" and filings.classify(rows[1]["title"]) == "resume"


def test_merging_keeps_the_first_seen_date_and_the_newest_first():
    old = [{"id": "EG1", "code": "A", "date": 100, "dated": False, "title": "x"}]
    new = [{"id": "EG1", "code": "A", "date": 999, "dated": False, "title": "x"}, {"id": "EG2", "code": "B", "date": 500, "dated": False, "title": "y"}]
    m = filings.merge_feed(old, new)
    assert [(x["id"], x["date"]) for x in m] == [("EG2", 500), ("EG1", 100)]
    dated = [{"id": "EG1", "code": "A", "date": 50, "dated": True, "title": "x"}]
    assert filings.merge_feed(m, dated)[-1]["dated"], "a real date replaces a first-seen one"
    assert len(filings.merge_feed([], [{"id": str(i), "code": "A", "date": i, "title": ""} for i in range(10)], keep=3)) == 3


def test_refresh_reads_both_markets_and_logs_failures(monkeypatch):
    monkeypatch.setattr(base, "http_get", lambda url, headers=None, timeout=20, data=None:
                        SA_FEED.encode() if "saudiexchange" in url else (_ for _ in ()).throw(OSError("timed out")))
    from sources import core_sources
    monkeypatch.setattr(core_sources, "http_get", base.http_get)
    res = filings.refresh_feeds()
    assert res == {"SR": 2, "CA": False}
    assert "filings.feed CA" in open(core.ERROR_LOG, encoding="utf-8").read()
    f = filings.company_file("2330.SR", "SR")
    assert f["ok"] and not f["complete"] and f["watching"] and f["items"][0]["type"] == "board"
    assert f["link"].endswith("cs=2330") and f["record"]["n"] == 1
    assert filings.company_file("1120", "SR")["items"] == []


# ---------------------------------------------------------------- SEC
def test_sec_filings_list_and_insider_reports():
    items = filings.parse_sec_submissions(SEC_SUB)
    assert [x["form"] for x in items] == ["8-K", "4", "10-Q", "10-K"]
    assert items[0]["type"] == "results", "an 8-K under item 2.02 is a results announcement"
    assert items[1]["type"] == "insider" and items[1]["raw"] == "https://www.sec.gov/Archives/edgar/data/320193/000032019326000090/wk-form4_1.xml"
    assert items[2]["url"] == "https://www.sec.gov/Archives/edgar/data/320193/000032019326000080/q3.htm"
    ins = filings.parse_form4(FORM4)
    assert [(x["side"], x["shares"], x["price"]) for x in ins] == [("sell", 1000, 230.5), ("buy", 200, 220)], "awards are not buys"
    assert ins[0]["role"] == "officer" and ins[0]["title"] == "CFO" and "SOMEONE" not in json.dumps(ins), "no names"


def test_us_company_file_through_the_edgar_connector(monkeypatch):
    calls = []

    def sec(url, timeout=25):
        calls.append(url)
        return (json.dumps(SEC_SUB) if "submissions" in url else FORM4).encode()
    monkeypatch.setattr(filings, "sec_get", sec)
    monkeypatch.setattr(REG.items["edgar"], "cik", lambda t: "320193")
    monkeypatch.setattr(filings.time, "time", lambda: ms(2026, 11, 17) / 1000)
    f = filings.company_file("AAPL", "US")
    assert f["ok"] and f["complete"] and f["source"] == "SEC EDGAR" and len(f["items"]) == 4
    assert "raw" not in f["items"][1] and len(f["insiders"]) == 2
    assert calls[0].endswith("CIK0000320193.json") and calls[1].endswith("/000032019326000090/wk-form4_1.xml")
    assert filings.company_file("AAPL", "US") == f and len(calls) == 2, "kept for a few hours"


def test_record_counts_and_estimates_the_next_results_date():
    now = ms(2026, 11, 17)
    items = [{"date": ms(y, 3, d), "title": "نتائج", "dated": True} for y, d in ((2023, 10), (2024, 14), (2025, 12))]
    items += [{"date": ms(2026, 6, 1), "title": "قرارات مجلس الإدارة", "dated": True}]
    r = filings.record_of(items, now)
    assert r["n"] == 4 and r["byType"] == {"results": 3, "board": 1}
    assert r["due"]["from"] == 3 and abs(r["due"]["date"] - ms(2027, 3, 12)) < 3 * DAY
    assert filings.record_of(items[:2], now)["due"] is None, "two past dates are too few to estimate"
    spread = [{"date": ms(y, mo, 10), "title": "نتائج", "dated": True} for y, mo in ((2025, 2), (2025, 5), (2025, 8))]
    assert filings.record_of(spread, now)["due"] is None, "three different quarters, one date each: no habit to go by"


def test_unsupported_and_bad_codes():
    assert not filings.company_file("XAU", "GOLD")["ok"]
    assert not filings.company_file("12;rm", "SR")["ok"]


# ---------------------------------------------------------------- definitions
def test_feed_addresses_can_be_updated_but_only_to_the_exchanges():
    def ok(fe):
        d = copy.deepcopy(defs.DEFAULTS)
        d["feeds"] = fe
        return defs.validate(d, "2.13.1")[0]
    assert ok({"sa": "https://www.saudiexchange.sa/new/list", "eg": "https://www.egx.com.eg/ar/N.aspx?from=%s&to=%s"})
    assert not ok({"sa": "https://evil.example/x"})
    assert not ok({"eg": "https://www.egx.com.eg/ar/N.aspx?from=%s"})
    assert not ok({"us": "https://www.sec.gov/"})
    assert defs.feed("sa") == defs.DEFAULTS["feeds"]["sa"]


# ---------------------------------------------------------------- route
@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
    main.SERVER_PORT[0] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()


def test_route(server, monkeypatch):
    monkeypatch.setattr(filings, "company_file", lambda code, ex: {"ok": True, "code": code, "ex": ex})
    c = http.client.HTTPConnection("127.0.0.1", server, timeout=10)
    c.request("GET", "/api/filings?code=COMI&ex=CA", headers={"Host": "127.0.0.1:%d" % server, "X-Mo-Token": main.API_TOKEN})
    assert json.loads(c.getresponse().read()) == {"ok": True, "code": "COMI", "ex": "CA"}
