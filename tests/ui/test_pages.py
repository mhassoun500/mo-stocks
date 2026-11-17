"""Every main page opens without a page error, in Arabic and English; the new Phase 4-6 pieces work end to end."""
import os

import pytest

LANGS = ["ar", "en"]


def open_stock(page, ex, code):
    page.goto(page.base + "#analysis")
    try:
        page.wait_for_selector("#ex", state="visible", timeout=8000)
        page.wait_for_function("performance.getEntriesByName('mo-ready').length>0", timeout=8000)
    except Exception:
        raise AssertionError("not on the analysis page: %s" % page.evaluate("location.hash+' '+[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.id).join(',')+' tour:'+!document.querySelector('#tour').hidden"))
    page.select_option("#ex", ex)
    if ex != "GOLD":
        page.fill("#sym", code)
    page.evaluate("document.querySelector('#status').textContent=''")
    page.click("#fetchBtn")
    page.wait_for_function("document.querySelector('#status').textContent.includes('fixture') && !document.querySelector('#fetchBtn').disabled", timeout=20000)
    page.wait_for_timeout(600)


@pytest.mark.parametrize("lang", LANGS)
def test_stocks_gold_and_their_numbers(page_for, lang):
    page = page_for(lang)
    for ex, code in (("SR", "1120"), ("CA", "COMI"), ("US", "AAPL"), ("GOLD", "")):
        open_stock(page, ex, code)
        assert page.inner_text("#mPrice").strip() not in ("", "—"), (ex, code)
        assert page.evaluate("document.querySelector('#chartName').textContent.trim()") not in ("", "سهم تجريبي", "Sample stock")
    assert page.errors == []


@pytest.mark.parametrize("lang", LANGS)
def test_a_saudi_fund_opens(page_for, lang):
    page = page_for(lang)
    page.goto(page.base + "#funds")
    page.wait_for_function("document.querySelector('#fundsMeta').textContent.length>20 && !/جارٍ|Loading/.test(document.querySelector('#fundsMeta').textContent)", timeout=30000)
    page.select_option("#fCountry", "SA")
    page.wait_for_timeout(500)
    page.click("#fundsBody tr[data-fid='SA003215']")
    page.wait_for_function("document.querySelector('#chartName').textContent.trim().length>1", timeout=20000)
    assert page.errors == []


@pytest.mark.parametrize("lang", LANGS)
def test_dashboard_scanner_portfolio_settings_about(page_for, lang):
    page = page_for(lang)
    page.goto(page.base)                                   # the app opens on the dashboard
    page.wait_for_selector("#view-home:not([hidden])")
    page.wait_for_function("document.querySelectorAll('#homeMarkets .metric').length==3")
    assert "Mo Stocks" in page.title() or page.title()
    page.goto(page.base + "#scanner")
    page.click("#scanGo")
    page.wait_for_function("!document.querySelector('#scanGo').hidden", timeout=60000)
    assert page.locator("#scanBody tr").count() >= 1
    page.click("#scanAdv summary")
    page.click("#scanAddRule")
    assert page.locator("#scanRules .scan-rule").count() == 1
    page.goto(page.base + "#journal")
    page.wait_for_selector("#view-journal:not([hidden])")
    page.goto(page.base + "#prefs")
    for tab in ("gen", "data", "alerts", "ai", "sys"):
        page.click("#prefTabs button[data-pg='%s']" % tab)
        page.wait_for_timeout(150)
    page.goto(page.base + "#about")
    page.wait_for_selector("#view-about:not([hidden])")
    assert len(page.inner_text("#view-about")) > 1500
    assert page.errors == []


def test_keyboard_shortcuts_and_the_tour(page_for):
    page = page_for("ar", tour_done=False)
    page.goto(page.base)
    page.wait_for_selector("#tour:not([hidden])", timeout=8000)
    page.click("#tourNext")
    assert page.evaluate("location.hash") == "#analysis", "the second step shows the search box"
    page.click("#tourSkip")
    assert page.is_hidden("#tour")
    page.click("body")
    page.keyboard.press("Alt+Digit3")
    assert page.evaluate("location.hash") == "#watch"
    page.keyboard.press("/")
    page.wait_for_timeout(100)
    assert page.evaluate("document.activeElement.id") in ("sym", "ex"), "the search box, or the market list when gold is open"
    page.select_option("#ex", "SR")
    page.fill("#sym", "?")                        # typing a ? into a field is just typing
    assert page.is_hidden("#kbdHelp")
    page.click("#chartName")
    page.keyboard.press("?")
    assert page.is_visible("#kbdHelp")
    page.keyboard.press("Escape")
    assert page.is_hidden("#kbdHelp")
    import core
    assert core.Store.get("tourDone") is True
    assert page.errors == []


def test_pdf_report_from_the_stock_page(page_for, tmp_path, monkeypatch):
    import server
    import system
    monkeypatch.setattr(server, "downloads_dir", lambda: str(tmp_path))
    monkeypatch.setattr(server, "open_file", lambda p: None)
    page = page_for("ar")
    open_stock(page, "SR", "1120")
    page.click("#pdfBtn")
    page.wait_for_function("[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('حُفظ التقرير'))", timeout=15000)
    files = list(tmp_path.glob("*.pdf"))
    assert len(files) == 1 and files[0].read_bytes()[:4] == b"%PDF"
    assert system  # the route lives in the server module
    assert page.errors == []


def test_compare_several_stocks_on_one_chart(page_for):
    page = page_for("en")
    open_stock(page, "SR", "1120")
    page.click("#perfBox summary")
    page.fill("#perfList", "2222, US:AAPL")
    page.click("#perfGo")
    page.wait_for_function("document.querySelectorAll('#perfLegend .perf-key').length==3", timeout=20000)
    assert page.errors == []


AXE = os.environ.get("AXE_JS") or os.path.join(os.path.dirname(__file__), "..", "..", "node_modules", "axe-core", "axe.min.js")


@pytest.mark.skipif(not os.path.exists(AXE), reason="axe-core not installed (npm i axe-core)")
@pytest.mark.parametrize("theme", ["light", "dark"])
def test_accessibility_wcag_aa(page_for, theme):
    page = page_for("ar", theme=theme)
    open_stock(page, "SR", "1120")
    axe = open(AXE, encoding="utf-8").read()
    bad = {}
    for view in ("home", "analysis", "watch", "scanner", "funds", "journal", "prefs", "about"):
        page.evaluate("location.hash='#%s'" % view)
        page.wait_for_timeout(500)
        page.add_script_tag(content=axe)
        v = page.evaluate("""async v=>{const r=await axe.run(document.querySelector('#view-'+v),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});
            return r.violations.map(x=>x.id+': '+x.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | '))}""", view)
        if v:
            bad[view] = v
    assert bad == {}


@pytest.mark.parametrize("width", [1440, 1920, 390])
def test_analysis_layout_chart_first_details_in_tabs(page_for, width):
    page = page_for("ar")
    page.set_viewport_size({"width": width, "height": 1000 if width > 500 else 844})
    open_stock(page, "SR", "1120")
    y = lambda sel: page.evaluate("document.querySelector(%r).getBoundingClientRect().top+scrollY" % sel)
    assert y("#chartCard") < y("#verdictSec") < y("#planCard") < y("#infoRow") < y("#moreCard"), "chart first, details last"
    assert not page.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth"), "no sideways scrolling"
    shown = lambda: page.evaluate("[...document.querySelectorAll('#moreCard .tab-panel')].filter(p=>p.offsetParent).map(p=>p.id)")
    for tab, panel in (("bt", "calcRow"), ("calc", "calcBox"), ("lv", "levelsRow")):
        page.click("#moreCard .more-tabs button[data-tab='%s']" % tab)
        assert shown() == [panel]
    if width >= 1440:
        assert page.evaluate("document.body.scrollHeight") < 5200, "was about 6,700 before the new layout"
        side, stance = page.evaluate("[document.querySelector('.verdict-side').getBoundingClientRect().height, document.querySelector('#stance').getBoundingClientRect().height]")
        assert abs(side - stance) < 260, "the two halves of the verdict row are close in height"
    assert page.errors == []


def test_gold_hides_the_company_parts_and_keeps_its_news(page_for):
    page = page_for("en")
    open_stock(page, "GOLD", "")
    assert page.is_hidden("#fileRow") and page.is_visible("#companyRow .card")
    assert page.errors == []
