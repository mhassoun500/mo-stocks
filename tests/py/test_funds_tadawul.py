"""2.13.1: Saudi funds from the Saudi Exchange's own fund screener (Mubasher's old fund API now answers 404)."""
import json

import pytest

import core
import funds
import prices
import sources
from sources import base, admin
from sources.base import Throttle

# rows exactly as the screener page sends them (17 Nov 2026), including the commented-out column that hides a <td>
PAGE = """<table><thead><tr><th>اسم الصندوق</th></tr></thead><tbody>
<tr class="showTr"> <td class="align"><a href="/wps/portal/saudiexchange/hidden/company-profile-mutual-fund/!ut/p/z1/X/?selectedFund=003215#Z7" class="ellipsis">صندوق الاستثمار كابيتال للتوزيعات الربعية</a></td> <td class="align">شركة الاستثمار للأوراق المالية والوساطة</td> <td>ريال سعودي</td> <td>موافق الشريعة</td> <td>نمو و الدخل</td> <td>9.8144</td> <td>-3.06</td> <td>2026/11/16</td> <td>120,529,511.5</td> <td>0.26</td> <!-- <td class="fundExpo"></td> --> </tr>
<tr class="showTr"> <td class="align"><a href="/wps/portal/saudiexchange/hidden/company-profile-mutual-fund/!ut/p/z1/X/?selectedFund=135001#Z7" class="ellipsis">صندوق بيت المال الخليجي للأسهم السعودية</a></td> <td class="align">بيت المال الخليجي</td> <td>ريال سعودي</td> <td>N/A</td> <td>نمو و الدخل</td> <td>26.9982</td> <td>3.21</td> <td>2026/11/16</td> <td>20,276,496.31</td> <td>0.61</td> <!-- <td class="fundExpo">LO</td> --> </tr>
<tr> <td class="align"><a href="/wps/portal/saudiexchange/hidden/company-profile-mutual-fund/!ut/p/z1/X/?selectedFund=008004#Z7" class="ellipsis">صندوق العربي المالية للمتاجرة بالدولار الأمريكي (المتوافق مع الشريعة)</a></td> <td class="align">شركة العربي المالية</td> <td>دولار أمريكي</td> <td>موافق الشريعة</td> <td>المحافظة على رأس المال</td> <td>23.1885</td> <td>3.28</td> <td>2026/11/16</td> <td>4,325,881.42</td> <td>0.32</td> <!-- <td class="fundExpo">LO</td> --> </tr>
<tr> <td class="align"><a href="/wps/portal/saudiexchange/hidden/company-profile-mutual-fund/!ut/p/z1/X/?selectedFund=001004#Z7" class="ellipsis">صندوق الرياض للأسهم الأمريكية</a></td> <td class="align">شركة الرياض المالية</td> <td>دولار أمريكي</td> <td>N/A</td> <td>تنمية رأس المال</td> <td>189.8726</td> <td>4.86</td> <td>2024/11/11</td> <td>5,745,952.78</td> <td>2.294</td> <!-- <td class="fundExpo">US</td> --> </tr>
</tbody></table>"""

HISTORY = json.dumps([
    {"valuationDate": "2023-04-04", "mutualFundNav": 10.0, "unitPrice": 10.0, "ytdChange": 0.0},
    {"valuationDate": "2023-04-06", "mutualFundNav": 9.9968, "unitPrice": 9.9968},
    {"valuationDate": "2023-04-06", "mutualFundNav": 9.9970, "unitPrice": 9.9970},
    {"valuationDate": "bad", "unitPrice": 1},
    {"valuationDate": "2026-11-16", "mutualFundNav": 9.8144, "unitPrice": 9.8144},
])


@pytest.fixture(autouse=True)
def quiet(monkeypatch, tmp_path):
    monkeypatch.setattr(base, "sleep", lambda s: None)
    monkeypatch.setattr(core, "ERROR_LOG", str(tmp_path / "errors.log"))
    monkeypatch.setattr(core, "_RECENT", {})
    core.Store.set("src_off", [])
    monkeypatch.setattr(sources.REG, "path", None)
    sources.REG.detail.clear()
    for c in sources.REG.items.values():
        c.throttle = Throttle(c.per_min, c.gap)
    yield


def test_screener_rows_become_fund_records():
    rows = funds.parse_tadawul_list(PAGE)
    assert [r["id"] for r in rows] == ["SA003215", "SA135001", "SA008004", "SA001004"]
    a, b, c, d = rows
    assert a["name"] == "صندوق الاستثمار كابيتال للتوزيعات الربعية" and a["manager"] == "شركة الاستثمار للأوراق المالية والوساطة"
    assert a["price"] == 9.8144 and a["ytd"] == -3.06 and a["aum"] == 120529511.5 and a["fee"] == 0.26 and a["currency"] == "SAR"
    assert a["sharia"] == "official" and a["country"] == "SA" and not a["stale"]
    assert b["sharia"] == "" or b["sharia"] in ("name", "sponsor"), "N/A is not a verdict: only the app's own rules apply"
    assert c["currency"] == "USD" and c["sharia"] == "official" and c["category"] == "money"
    assert d["stale"], "a price two years old marks the fund as stopped"


def test_history_is_read_day_by_day():
    rows = prices.funds.parse_tadawul_history(HISTORY)
    assert [r[1] for r in rows] == [10.0, 9.997, 9.8144], "one price a day, the later one wins, bad dates dropped"
    assert all(r[1] == r[4] and r[5] == 0 for r in rows)


def test_page_without_rows_is_a_format_change(monkeypatch):
    monkeypatch.setattr(funds, "_get", lambda url, timeout=25: "<html>" + "x" * 30000 + "</html>")
    with pytest.raises(base.FormatChanged):
        funds.fetch_tadawul_list()
    monkeypatch.setattr(funds, "_get", lambda url, timeout=25: PAGE)
    with pytest.raises(ValueError):
        funds.fetch_tadawul_list()            # 4 funds is not the whole list (about 360)


def test_saudi_list_comes_from_the_exchange_and_egypt_falls_back_with_a_reason(monkeypatch):
    big = PAGE.replace("</tbody>", "".join(
        '<tr><td><a href="?selectedFund=9%05d">صندوق %d</a></td><td>م</td><td>ريال سعودي</td><td>موافق الشريعة</td><td>هدف</td><td>1.5</td><td>0</td><td>2026/11/16</td><td>1</td><td>0</td></tr>' % (i, i)
        for i in range(120)) + "</tbody>")
    monkeypatch.setattr(funds, "_get", lambda url, timeout=25: big if "fund-screener" in url else (_ for _ in ()).throw(OSError("404")))
    saved_eg = [{"id": 2680, "name": "صندوق مصري", "country": "EG", "price": 1, "date": 1, "sharia": "", "manager": ""}]
    monkeypatch.setattr(prices, "cache_put", lambda k, v: None)
    out = prices._fetch_all_funds({"items": saved_eg})
    sa = [i for i in out["items"] if i["country"] == "SA"]
    assert len(sa) == 124 and out["sources"]["SA"] == "تداول السعودية (صناديق)"
    assert [i["id"] for i in out["items"] if i["country"] == "EG"] == [2680], "the last saved Egyptian list is kept"
    assert out["offline"] and out["failed"] == ["EG"] and "مباشر" in out["note"]


def test_saudi_fund_history_goes_to_the_exchange(monkeypatch):
    monkeypatch.setattr(prices, "get_funds", lambda: {"items": funds.parse_tadawul_list(PAGE)})
    calls = []
    monkeypatch.setattr(funds, "_get", lambda url, timeout=25: calls.append(url) or HISTORY)
    j = prices.fetch_fund("sa003215", "max")
    assert j["ok"] and j["source"] == "تداول السعودية" and j["country"] == "SA" and j["currency"] == "SAR"
    assert j["sharia"] == "official" and j["fundId"] == "SA003215" and len(j["rows"]) == 3
    assert "mutualFundSymbol=003215" in calls[0]
    with pytest.raises(prices.NotFound):
        prices.fetch_fund("SA12;rm", "max")


def test_egyptian_funds_still_use_mubasher_numbers(monkeypatch):
    monkeypatch.setattr(prices, "get_funds", lambda: {"items": []})
    monkeypatch.setattr(prices, "snap_load", lambda: {})
    monkeypatch.setattr(funds, "_get", lambda url, timeout=25: "2026/10/26/00:00:00,57.49\n2026/10/27/00:00:00,57.6\n")
    j = prices.fetch_fund("2680", "max")
    assert j["source"] == "مباشر" and j["fundId"] == 2680 and len(j["rows"]) == 2


def test_official_sharia_label_wins_and_unknown_does_not_count():
    assert funds.fund_sharia("SA1", "صندوق الأسهم", "شركة", "SA", "موافق الشريعة") == "official"
    assert funds.fund_sharia("SA1", "صندوق الأسهم", "شركة", "SA", "N/A") == ""
    assert funds.fund_sharia("SA1", "صندوق المرابحة", "شركة", "SA", "N/A") == "name"
    assert funds.fund_sharia("SA1", "صندوق الأسهم", "شركة", "SA", "غير موافق") == ""
