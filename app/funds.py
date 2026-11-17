# -*- coding: utf-8 -*-
"""Egyptian and Saudi mutual funds (صناديق الاستثمار).

Saudi funds (since 2.13.1): the Saudi Exchange's own fund screener, official and free:
- Fund list:  https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/fund-screener?locale=ar
  (one table in the page: name and fund code, manager, currency, Sharia compliance as the exchange lists it,
  objective, unit price, change since the start of the year, valuation date, net assets, expense ratio)
- History:    .../tadawul.eportal.charts.v2/MutualFundChartDataDownloader?...&mutualFundSymbol=<code>  (every valuation day)
Saudi fund ids are "SA" + the exchange's code (e.g. SA003215), so they never collide with Mubasher's numbers.

Egyptian funds: Mubasher Info (its new site asks visitors to sign in for funds, so the list may only be the last one saved).

- Fund list with latest price:  https://www.mubasher.info/api/1/funds?country=eg|sa&size=2000
- Full price history per fund:  https://static.mubasher.info/File.MubasherCharts/File.Mutual_Fund_Charts_Dir/priceChartFund_<id>.csv
  (lines like  2026/10/26/00:00:00,57.4907)

Funds are bought and redeemed at their unit price (NAV), so there is one price per day,
no high/low and no volume.
"""
import calendar
import json
import re
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
LIST_URL = "https://www.mubasher.info/api/1/funds?country=%s&size=2000"
COUNTRIES = {"EG": "eg", "SA": "sa"}
COUNTRY_AR = {"EG": "مصر", "SA": "السعودية"}
HIST_URL = "https://static.mubasher.info/File.MubasherCharts/File.Mutual_Fund_Charts_Dir/priceChartFund_%d.csv"

# Egypt: Sharia-compliant funds reviewed by hand from Mubasher's list (October 2026).
# "name": the fund's own name says Islamic / Sharia / Takaful.
# "sponsor": issued by a fully Islamic bank or with one as co-sponsor.
SHARIA_FUNDS = {
    2680: "sponsor", 2701: "sponsor", 5679: "sponsor", 2693: "sponsor", 2747: "sponsor", 5423: "sponsor", 2726: "sponsor",
    6144: "name", 6149: "name", 5911: "name", 5912: "name", 6427: "name", 6428: "name", 6448: "name", 6467: "name",
    6250: "name", 2710: "name", 5784: "name", 2742: "name", 5823: "name", 6403: "name", 5958: "name", 5989: "name",
    6122: "name", 2721: "name",
}
SHARIA_NOTE = {"official": "مصنّف «موافق الشريعة» في قائمة صناديق تداول السعودية الرسمية",
               "name": "اسم الصندوق أو نوعه ينص على توافقه مع الشريعة",
               "sponsor": "صادر عن بنك إسلامي أو مدير صناديق متوافق مع الشريعة بالكامل"}
# Names that state compliance, or instruments that are Sharia-compliant by definition
# (murabaha, sukuk, ijara, waqf, "pure"/purified equity funds).
SHARIA_NAME_RE = re.compile(r"شرع|إسلام|اسلام|مرابح|متوافق|صكوك|إجار|اجار|النقي|تكافل|وقف|الأوقاف")
# Saudi managers that only run Sharia-compliant funds (Islamic banks' investment arms and the like)
SHARIA_SPONSORS_SA = ("الراجحي المالية", "الإنماء المالية", "البلاد للاستثمار", "الجزيرة للأسواق المالية",
                      "بيت التمويل السعودي الكويتي", "الشركة السعودية للإقتصاد والتنمية للأوراق المالية",
                      "جدوى للإستثمار")


def fund_sharia(fid, name, manager, country, listed=None):
    """listed: the exchange's own Sharia column for the fund, when there is one (Saudi Exchange)."""
    if listed and "موافق" in listed and "غير" not in listed:
        return "official"
    if country == "EG" and fid in SHARIA_FUNDS:
        return SHARIA_FUNDS[fid]
    if SHARIA_NAME_RE.search(name or ""):
        return "name"
    if country == "SA" and any((manager or "").startswith(m) for m in SHARIA_SPONSORS_SA):
        return "sponsor"
    return ""

CATEGORY_AR = {"money": "نقدي وسيولة", "fixed": "دخل ثابت", "metals": "ذهب ومعادن", "equity": "أسهم",
               "balanced": "متوازن", "realestate": "عقاري", "other": "متنوع"}


def fund_category(name, country="EG"):
    n = name or ""
    if re.search(r"ذهب|معادن|فضة|Bullion|سبائك|الشكمجية|جولد", n, re.I):
        return "metals"
    if country == "SA":
        if re.search(r"مرابح|متاجرة|المتاجرة|سيولة|السيولة|نقد|أسواق النقد", n):
            return "money"
        if re.search(r"صكوك|دخل ثابت|الدخل الثابت|أدوات الدين|سندات", n):
            return "fixed"
        if re.search(r"متوازن|المتوازن|متعدد الأصول|الأصول المتنوعة|المرن للأصول", n):
            return "balanced"
        if re.search(r"عقار|ريت", n):
            return "realestate"
        if re.search(r"أسهم|الأسهم|الاسهم|أسھم|الأسھم|مؤشر|نمو|النمو|الشركات", n):
            return "equity"
        return "other"
    if re.search(r"دخل ثابت|الدخل الثابت|أدوات الدين|استحقاق|سندات|بوندز|كوبونات|العائد الثابت|توفير|ادخار", n):
        return "fixed"
    if re.search(r"نقد|سيولة|اليومي|يوم بيوم|كاش|أسواق النقد|العائد اليومي|كل يوم|يومي|النهاردة", n):
        return "money"
    if re.search(r"متوازن|المتوازن|توازن", n):
        return "balanced"
    if re.search(r"أسهم|الأسهم|الاسهم|مؤشر|EGX|إكويتي|فرص|نمو|Alpha|B-35|B-70|تريند", n, re.I):
        return "equity"
    return "other"


def fund_currency(name, country="EG"):
    n = name or ""
    if "الدولار" in n or "بالدولا" in n or "دولار" in n:
        return "USD"
    if "اليورو" in n or "باليورو" in n:
        return "EUR"
    return "SAR" if country == "SA" else "EGP"


_AR_MONTHS = {"يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "مايو": 5, "يونيو": 6, "يوليو": 7,
              "أغسطس": 8, "اغسطس": 8, "سبتمبر": 9, "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12}


def _ar_date_ms(s):
    m = re.match(r"\s*(\d{1,2})\s+(\S+)\s+(\d{4})", s or "")
    if not m or m.group(2) not in _AR_MONTHS:
        return None
    return calendar.timegm((int(m.group(3)), _AR_MONTHS[m.group(2)], int(m.group(1)), 0, 0, 0)) * 1000


def _get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/csv,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def fetch_fund_list(country="EG"):
    # Mubasher builds this list slowly (about a minute for the 600 Saudi funds), hence the long timeout
    data = json.loads(_get(LIST_URL % COUNTRIES[country], timeout=110))
    out = []
    stale_before = (time.time() - 365 * 86400) * 1000
    for r in data.get("rows") or []:
        fid = r.get("fundId")
        name = (r.get("name") or "").strip()
        if not fid or not name:
            continue
        price = r.get("price") or None
        manager = ((r.get("managers") or [""])[0] or "").strip()
        date = _ar_date_ms(r.get("date"))
        out.append({
            "id": fid, "name": name, "owner": (r.get("owner") or "").strip(), "manager": manager,
            "price": price if price else None, "date": date, "country": country,
            "ytd": r.get("profitYearStart"), "category": fund_category(name, country),
            "currency": fund_currency(name, country), "sharia": fund_sharia(fid, name, manager, country),
            "stale": not date or date < stale_before,
        })
    return out


def parse_history(text):
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or "," not in line:
            continue
        d, p = line.split(",", 1)
        m = re.match(r"(\d{4})/(\d{1,2})/(\d{1,2})", d)
        try:
            v = float(p)
        except ValueError:
            continue
        if not m or v <= 0:
            continue
        t = calendar.timegm((int(m.group(1)), int(m.group(2)), int(m.group(3)), 0, 0, 0)) * 1000
        rows.append([t, v, v, v, v, 0])
    rows.sort(key=lambda x: x[0])
    dedup = []
    for r in rows:
        if dedup and dedup[-1][0] == r[0]:
            dedup[-1] = r
        else:
            dedup.append(r)
    return dedup


def fetch_fund_history(fid):
    return parse_history(_get(HIST_URL % int(fid)))


RANGE_DAYS = {"1y": 366, "2y": 731, "5y": 1827, "max": None}


def trim_days(rows, rng):
    days = RANGE_DAYS.get(rng, 731)
    if not days or not rows:
        return rows
    cut = rows[-1][0] - days * 86400000
    return [r for r in rows if r[0] >= cut]


# ---------------------------------------------------------------- Saudi Exchange (official) fund list and history
TADAWUL_LIST = "https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/fund-screener?locale=ar"
TADAWUL_HIST = ("https://www.saudiexchange.sa/tadawul.eportal.charts.v2/MutualFundChartDataDownloader"
                "?actionTarget=mutualFundChartData&mutualFundSymbol=%s&pageName=CompanyProfileMutualFund&methodType=parsingMethod")
TADAWUL_CUR = {"ريال سعودي": "SAR", "دولار أمريكي": "USD", "دولار امريكي": "USD", "يورو": "EUR", "جنيه استرليني": "GBP"}
_TAG = re.compile(r"<[^>]+>")


def _cell(html):
    import html as H
    return " ".join(H.unescape(_TAG.sub(" ", html)).split())


def _num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def parse_tadawul_list(page):
    """Rows of the exchange's fund screener table -> the app's fund records."""
    page = re.sub(r"<!--.*?-->", "", page or "", flags=re.S)       # a commented-out column hides a <td> in each row
    out = []
    stale_before = (time.time() - 365 * 86400) * 1000
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        m = re.search(r"selectedFund=(\d+)", row)
        if not m:
            continue
        cells = [_cell(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) < 8:
            continue
        name, manager, cur, sharia, goal, nav, ytd, date = cells[:8]
        aum = _num(cells[8]) if len(cells) > 8 else None
        fee = _num(cells[9]) if len(cells) > 9 else None
        dm = re.match(r"(\d{4})/(\d{1,2})/(\d{1,2})", date)
        d = calendar.timegm((int(dm.group(1)), int(dm.group(2)), int(dm.group(3)), 0, 0, 0)) * 1000 if dm else None
        fid = "SA" + m.group(1)
        price = _num(nav)
        out.append({"id": fid, "name": name, "owner": "", "manager": manager, "price": price if price else None, "date": d,
                    "country": "SA", "ytd": _num(ytd), "category": fund_category(name, "SA"),
                    "currency": TADAWUL_CUR.get(cur) or fund_currency(name, "SA"), "sharia": fund_sharia(fid, name, manager, "SA", sharia),
                    "goal": goal, "aum": aum, "fee": fee, "stale": not d or d < stale_before, "src": "tadawul"})
    return out


def fetch_tadawul_list():
    from sources.base import format_changed
    page = _get(TADAWUL_LIST, timeout=60)
    rows = parse_tadawul_list(page)
    if not rows and len(page) > 20000:
        raise format_changed("tadawul_funds", "fund screener page has no fund rows", page[:400])
    if len(rows) < 100:
        raise ValueError("Saudi Exchange fund list looks incomplete (%d funds)" % len(rows))
    return rows


def parse_tadawul_history(text):
    data = json.loads(text or "[]")
    rows = {}
    for r in data if isinstance(data, list) else []:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(r.get("valuationDate") or r.get("dateTime") or ""))
        v = r.get("unitPrice") or r.get("mutualFundNav")
        if not m or not isinstance(v, (int, float)) or v <= 0:
            continue
        t = calendar.timegm((int(m.group(1)), int(m.group(2)), int(m.group(3)), 0, 0, 0)) * 1000
        rows[t] = [t, v, v, v, v, 0]
    return [rows[t] for t in sorted(rows)]


def fetch_tadawul_history(fid):
    from sources.base import format_changed
    code = str(fid)[2:] if str(fid).upper().startswith("SA") else str(fid)
    if not re.match(r"^\d{3,8}$", code):
        raise ValueError("bad Saudi Exchange fund code")
    text = _get(TADAWUL_HIST % code, timeout=40)
    try:
        return parse_tadawul_history(text)
    except ValueError:
        raise format_changed("tadawul_funds", "fund history is not JSON", text[:300])
