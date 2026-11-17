"""Step 3: definitions file, page-format change detection, "fill the missing" checks, Sharia list import."""
import base64
import copy
import io
import json
import os

import pytest

import core
import sharia
import sharia_import
import sources
from sources import aifill, base, defs
from sources.base import FormatChanged, REG

D0 = copy.deepcopy(defs.DEFAULTS)
REPO_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "defs", "definitions.json")

NEW_PAGE = ('<div class="ref"><b class="who">الراجحي المالية</b><i>2026-06-30</i></div>'
            '<div class="ref"><b class="who">العثيمين</b><i>2026-05-31</i></div>'
            '<div class="row"><s>1120</s><a href="/x">شركة الراجحي</a><u>✔</u><u>✘</u></div>')


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setattr(core, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(core, "ERROR_LOG", str(tmp_path / "errors.log"))
    monkeypatch.setattr(core, "_RECENT", {})
    monkeypatch.setitem(defs.STATE, "loaded", None)
    monkeypatch.setitem(defs.STATE, "source", "built-in")
    monkeypatch.setitem(defs.STATE, "error", "")
    monkeypatch.setattr(base, "sleep", lambda s: None)
    REG.detail.clear()
    core.Store.set("src_off", [])


def newer(**over):
    d = copy.deepcopy(D0)
    d["version"] = 2
    for k, v in over.items():
        d[k] = v
    return d


# ---------------------------------------------------------------- A. definitions file
def test_builtin_definitions_are_valid_and_match_the_repo_file():
    assert defs.validate(D0, "2.11.0") == (True, "")
    with open(REPO_FILE, encoding="utf-8") as f:
        assert json.load(f) == D0          # the file on GitHub and the built-in copy cannot drift apart


def test_definitions_reject_bad_files():
    def bad(d, why, app="2.11.0"):
        ok, reason = defs.validate(d, app)
        assert not ok and why in reason, reason
    bad("x", "object")
    bad(newer(schema=9), "schema")
    bad(newer(version="2"), "version")
    bad(newer(min_app="9.0.0"), "newer app")
    d = newer(); d["urls"]["spus"] = "http://www.sp-funds.com/a.csv"; bad(d, "not allowed")
    d = newer(); d["urls"]["eg"] = "https://evil.example.com/a.json"; bad(d, "not allowed")
    d = newer(); d["urls"]["argaam"] = "https://www.argaam.com/page"; bad(d, "%d")
    d = newer(); d["argaam"]["row_re"] = "(unclosed"; bad(d, "compile")
    d = newer(); d["argaam"]["cell_re"] = ""; bad(d, "pattern")
    d = newer(); d["argaam"]["row_re"] = "x" * 800; bad(d, "pattern")
    d = newer(); d["argaam"]["row_re"] = r"<td>(\d+)</td>(.*?)</td>(.*?)</tr>"; bad(d, "sample")   # compiles but reads the sample wrongly
    d = newer(); d["argaam"]["extra"] = "1"; bad(d, "argaam")
    d = newer(); d["extra"] = 1
    assert defs.validate(d, "2.11.0")[0]       # unknown top-level keys are harmless data


def test_definitions_with_new_patterns_read_a_changed_page(monkeypatch):
    d = newer()
    d["argaam"].update(ref_re=r'<b class="who">([^<]+)</b><i>([^<]*)</i>', ref_alt_re=r'<b class="who">([^<]+)</b>',
                       row_re=r'<s>(\d+)</s><a [^>]*>([^<]+)</a>(.*?)</div>', cell_re=r"<u>(.*?)</u>")
    assert sharia.parse_argaam(NEW_PAGE, D0["argaam"])[1] == {}          # built-in patterns cannot read it
    monkeypatch.setitem(defs.STATE, "loaded", d)
    refs, rows = sharia.parse_argaam(NEW_PAGE)                            # the downloaded ones can
    assert refs[0] == ["الراجحي المالية", "2026-06-30"] and rows["1120"] == {"n": "الراجحي", "v": "10"}


def test_refresh_saves_a_valid_newer_file_and_survives_restart(monkeypatch):
    d = newer()
    monkeypatch.setattr(defs, "fetch", lambda repo=None, timeout=15: d)
    r = defs.refresh()
    assert r["ok"] and r["changed"] and r["version"] == 2 and defs.status()["source"] == "downloaded"
    monkeypatch.setitem(defs.STATE, "loaded", None)                        # "restart"
    assert defs.current()["version"] == 1 and defs.load() and defs.current()["version"] == 2


def test_refresh_ignores_same_or_older_and_rejects_invalid(monkeypatch):
    monkeypatch.setattr(defs, "fetch", lambda repo=None, timeout=15: copy.deepcopy(D0))
    assert defs.refresh()["changed"] is False
    bad = newer(); bad["urls"]["eg"] = "https://evil.example.com/x"
    monkeypatch.setattr(defs, "fetch", lambda repo=None, timeout=15: bad)
    r = defs.refresh()
    assert not r["ok"] and "rejected" in r["error"] and defs.current()["version"] == 1
    assert not os.path.exists(defs._file())
    assert "defs.refresh" in open(core.ERROR_LOG, encoding="utf-8").read()


def test_refresh_without_connection_keeps_builtin(monkeypatch):
    def boom(repo=None, timeout=15):
        raise OSError("offline")
    monkeypatch.setattr(defs, "fetch", boom)
    r = defs.refresh()
    assert not r["ok"] and defs.current()["version"] == 1 and defs.status()["error"]


def test_fetch_refuses_odd_repo_names_and_big_files(monkeypatch):
    with pytest.raises(ValueError):
        defs.fetch("../../etc/passwd")

    class R:
        def __init__(self, n): self.n = n
        def read(self, k): return b"x" * min(k, self.n)
        def __enter__(self): return self
        def __exit__(self, *a): pass
    monkeypatch.setattr(defs.urllib.request, "urlopen", lambda req, timeout=0: R(10 ** 6))
    with pytest.raises(ValueError):
        defs.fetch()


def test_corrupt_saved_file_is_ignored_and_logged(tmp_path):
    bad = newer(); bad["argaam"]["row_re"] = "(oops"
    (tmp_path / "definitions.json").write_text(json.dumps(bad), encoding="utf-8")
    assert not defs.load() and defs.current()["version"] == 1
    assert "rejected" in open(core.ERROR_LOG, encoding="utf-8").read()


# ---------------------------------------------------------------- B. page-format change
def test_argaam_layout_change_raises_and_logs_a_sample(monkeypatch):
    page = "<html>" + "<div>new layout</div>" * 200 + "</html>"
    monkeypatch.setattr(sharia, "_get", lambda url, timeout=40: page)
    with pytest.raises(FormatChanged):
        sharia.fetch_saudi()
    log = open(core.ERROR_LOG, encoding="utf-8").read()
    assert "format.argaam" in log and "no company row matched" in log and "new layout" in log


def test_format_change_goes_through_the_registry_as_a_failure(monkeypatch):
    monkeypatch.setattr(sharia, "_get", lambda url, timeout=40: "<p>x</p>" * 400)
    with pytest.raises(Exception) as e:
        REG.call_one("argaam", "sharia")
    assert isinstance(e.value, FormatChanged) or "argaam" in str(e.value).lower() or "تغيّر" in str(e.value)
    st = {s["id"]: s for s in REG.status()}["argaam"]
    assert st["lastFail"] and st["lastError"]


def test_egypt_and_spus_format_changes(monkeypatch):
    rows = [{"ticker": "A%d" % i} for i in range(150)]
    monkeypatch.setattr(sharia, "_get", lambda url, timeout=40: json.dumps(rows))
    with pytest.raises(FormatChanged):
        sharia.fetch_egypt()
    monkeypatch.setattr(sharia, "_get", lambda url, timeout=40: "Foo,Bar\n1,2\n")
    with pytest.raises(FormatChanged):
        sharia.fetch_spus()
    log = open(core.ERROR_LOG, encoding="utf-8").read()
    assert "format.egsharia" in log and "format.spus" in log


def test_a_short_or_partial_page_is_not_called_a_format_change(monkeypatch):
    monkeypatch.setattr(sharia, "_get", lambda url, timeout=40: "<p>hi</p>")
    with pytest.raises(ValueError):
        sharia.fetch_saudi()


# ---------------------------------------------------------------- C. fill the missing with the assistant
def reply(**parts):
    return "Here you go:\n```json\n" + json.dumps(parts) + "\n```"


def test_parse_reply_accepts_checked_items_only():
    import datetime
    soon = (datetime.date.today() + datetime.timedelta(days=20)).isoformat()
    r = aifill.parse_reply(reply(
        fair={"value": 98.5, "currency": "sar", "basis": "analyst mean", "url": "https://example.com/a"},
        sharia={"verdict": "ok", "by": "Al Rajhi Capital", "date": "2026-03-31", "url": "https://example.com/b"},
        purification={"pct": 1.7, "by": "Musaffa", "url": "https://example.com/c"},
        earnings={"date": soon, "url": "https://example.com/d"}))
    it = r["items"]
    assert it["fair"]["value"] == 98.5 and it["fair"]["currency"] == "SAR"
    assert it["sharia"]["verdict"] == "ok" and it["purification"]["pct"] == 1.7 and it["earnings"]["date"] == soon
    assert not r["rejected"]


def test_parse_reply_rejects_unsourced_or_implausible_items():
    r = aifill.parse_reply(reply(
        fair={"value": 98.5, "url": "http://example.com/a"},                      # not https
        sharia={"verdict": "maybe", "url": "https://example.com/b"},              # unknown verdict
        purification={"pct": 140, "url": "https://example.com/c"},                # impossible percentage
        earnings={"date": "2019-01-01", "url": "https://example.com/d"}))         # long past
    assert r["items"] == {} and set(r["rejected"]) == {"fair", "sharia", "purification", "earnings"}
    assert aifill.parse_reply("no json here")["rejected"]["all"]
    assert aifill.parse_reply("{broken")["rejected"]["all"]
    assert aifill.parse_reply(reply(fair={"value": 0, "url": "https://a.com/x"}))["rejected"]["fair"]
    assert aifill.parse_reply(reply(fair=None, sharia=None))["items"] == {}       # null = "not found", not an error


def test_parse_reply_keeps_to_what_was_asked():
    r = aifill.parse_reply(reply(fair={"value": 5, "url": "https://a.com/x"}, purification={"pct": 2, "url": "https://a.com/y"}), ["fair"])
    assert list(r["items"]) == ["fair"]


class FakeAI:
    def __init__(self, res): self.res, self.seen = res, None
    def ask(self, prov, model, system, user, web=False, key=None, base=None, max_tokens=1800, **kw):
        self.seen = (prov, system, user, web)
        return self.res


def test_fill_needs_web_search_and_never_falls_back_to_guessing():
    ai = FakeAI({"ok": True, "text": reply(fair={"value": 5, "url": "https://a.com/x"}), "searches": 2, "name": "Claude"})
    r = aifill.fill(ai, "claude", "m", None, "1120", "Al Rajhi", "SR", ["fair", "bogus"])
    assert r["ok"] and r["items"]["fair"]["value"] == 5 and r["missing"] == ["fair"]
    prov, system, user, web = ai.seen
    assert web is True and "Never estimate" in system and "1120" in user and "Tadawul" in user and "sharia" not in user
    assert not aifill.fill(FakeAI({}), "openai", "m", None, "AAPL", "", "US", ["fair"])["ok"]            # no web search with this provider
    nw = FakeAI({"ok": True, "text": reply(fair={"value": 5, "url": "https://a.com/x"}), "noWeb": True})
    r = aifill.fill(nw, "claude", "m", None, "1120", "", "SR", ["fair"])
    assert not r["ok"] and "بحث" in r["error"]                                                              # answered without searching: refused
    assert not aifill.fill(ai, "claude", "m", None, "1120", "", "SR", [])["ok"]
    assert aifill.fill(FakeAI({"ok": False, "error": "x"}), "claude", "m", None, "1", "", "SR", ["fair"]) == {"ok": False, "error": "x"}


# ---------------------------------------------------------------- D. Sharia list import
def test_classify_gets_negatives_right():
    c = sharia_import.classify
    assert c("متوافق") == "ok" and c("غير متوافق") == "no" and c("غير متوافقة") == "no" and c("Non-Compliant") == "no"
    assert c("Compliant") == "ok" and c("محل نظر") == "doubt" and c("حلال") == "ok" and c("حرام") == "no"
    assert c("1") == "ok" and c("0") == "no" and c("✔") == "ok" and c("") is None and c("hello") is None
    assert c("سهم 1120 غير متوافق مع الضوابط") == "no"          # a negative inside a line must not be read as compliant
    assert c("قفاوتم ريغ") == "no"                                # Arabic pulled out of a PDF in reverse order


def csv_bytes(text, enc="utf-8-sig"):
    return text.encode(enc)


def test_import_csv_with_arabic_header_and_semicolons():
    data = csv_bytes("الرمز;الشركة;الحكم\n1120;الراجحي;متوافق\n2222;أرامكو;متوافق\n1180;الأهلي;غير متوافق\n7010;اتصالات;محل نظر\nxx;bad;؟\n")
    r = sharia_import.preview("list.csv", data, "SR")
    assert r["ok"] and r["ok_list"] == ["1120", "2222"] and r["no_list"] == ["1180"] and r["doubt"] == ["7010"] and r["skipped"] == 1


def test_import_csv_without_header_english_and_windows_arabic_encoding():
    r = sharia_import.preview("a.csv", csv_bytes("AAPL,Compliant\nMSFT,Compliant\nJPM,Non-Compliant\n"), "US")
    assert r["ok_list"] == ["AAPL", "MSFT"] and r["no_list"] == ["JPM"]
    r = sharia_import.preview("b.csv", csv_bytes("الرمز,الحكم\n1120,متوافق\n1150,غير متوافق\n", "cp1256"), "")
    assert r["ok_list"] == ["1120"] and r["no_list"] == ["1150"]


def test_import_flags_contradictions_and_suffixes():
    r = sharia_import.preview("c.csv", csv_bytes("symbol,status\n1120.SR,compliant\n1120,non-compliant\nCOMI.CA,compliant\n"), "")
    assert r["conflicts"] == ["1120"] and r["ok_list"] == ["COMI"] and r["no_list"] == []


def test_import_errors_are_plain():
    assert not sharia_import.preview("x.csv", b"", "SR")["ok"]
    assert "5" in sharia_import.preview("x.csv", b"a" * (6 * 1024 * 1024), "SR")["error"]
    assert not sharia_import.preview("x.csv", csv_bytes("hello,world\nfoo,bar\n"), "SR")["ok"]
    assert not sharia_import.preview("x.pdf", b"%PDF-1.4 not really", "SR")["ok"]


def make_pdf(lines):
    reportlab = pytest.importorskip("reportlab")
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for ln in lines:
        c.drawString(40, y, ln)
        y -= 18
    c.save()
    return buf.getvalue()


def test_import_pdf_text():
    pytest.importorskip("pypdf")
    pdf = make_pdf(["Approved list - Q3 2026", "1120 Al Rajhi Compliant", "2222 Aramco Compliant", "1180 SNB Non-Compliant",
                    "Page 1 of 1"])
    r = sharia_import.preview("q3.pdf", pdf, "SR")
    assert r["ok"] and r["kind"] == "pdf" and r["ok_list"] == ["1120", "2222"] and r["no_list"] == ["1180"] and r["skipped"] >= 2


def test_import_pdf_without_text_is_explained():
    pytest.importorskip("pypdf")
    pdf = make_pdf([""])
    r = sharia_import.preview("scan.pdf", pdf, "SR")
    assert not r["ok"] and "CSV" in r["error"]


def test_import_route(monkeypatch):
    import http.client
    import threading
    from http.server import ThreadingHTTPServer
    import main
    srv = ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
    port = srv.server_address[1]
    main.SERVER_PORT[0] = port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        def post(body):
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            c.request("POST", "/api/shariaimport", body=json.dumps(body).encode(),
                      headers={"Host": "127.0.0.1:%d" % port, "X-Mo-Token": main.API_TOKEN, "Content-Type": "application/json"})
            return json.loads(c.getresponse().read())
        url = "data:text/csv;base64," + base64.b64encode(b"symbol,status\n1120,compliant\n1180,non-compliant\n").decode()
        r = post({"name": "a.csv", "dataUrl": url, "ex": "SR"})
        assert r["ok"] and r["ok_list"] == ["1120"] and r["no_list"] == ["1180"]
        assert not post({"name": "a.csv"})["ok"]
    finally:
        srv.shutdown()


# ---------------------------------------------------------------- Step 4: purification ratio
def test_egypt_purification_uses_haram_income_and_rejects_nonsense():
    f = sharia.eg_purification
    assert f({"haram_earnings_percentage": 8.0814}) == 8.081
    assert f({"haram_earnings_percentage": None, "sp_haram_earning_percentage": 3}) == 3.0
    assert f({"haram_earnings_percentage": 0}) == 0.0
    assert f({}) is None and f({"haram_earnings_percentage": 140}) is None and f({"haram_earnings_percentage": "5"}) is None
    assert f({"haram_earnings_percentage": True}) is None


def test_fetch_egypt_carries_the_ratio(monkeypatch):
    data = [{"symbol": "S%d" % i, "name_ar": "x", "haram_earnings_percentage": (i % 10) if i % 3 else None} for i in range(150)]
    monkeypatch.setattr(sharia, "_get", lambda url, timeout=40: json.dumps(data))
    rows = sharia.fetch_egypt()["rows"]
    assert rows["S1"]["p"] == 1.0 and "p" not in rows["S3"] and rows["S2"]["p"] == 2.0


def test_old_egypt_cache_without_ratios_is_refreshed(monkeypatch):
    import markets
    calls = []
    store = {"sharia|sa": ({"x": 1}, 9e12), "sharia|eg": ({"rows": {"A": {"n": "a", "v": "1"}}}, 9e12)}
    monkeypatch.setattr(markets, "cache_get", lambda k: store.get(k, (None, 0)))
    monkeypatch.setattr(markets, "sharia_refresh", lambda: calls.append(1) or {})
    n = [0]

    def wait(t):
        n[0] += 1
        if n[0] >= 2:
            markets.QUIT.set()
        return markets.QUIT.is_set()
    monkeypatch.setattr(markets.QUIT, "wait", wait)
    try:
        markets.sharia_refresher()
    finally:
        markets.QUIT.clear()
    assert calls == [1]
    calls.clear()
    store["sharia|eg"] = ({"rows": {"A": {"n": "a", "v": "1", "p": 2.0}}}, 9e12)
    n[0] = 0
    try:
        markets.sharia_refresher()
    finally:
        markets.QUIT.clear()
    assert calls == []
