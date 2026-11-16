# -*- coding: utf-8 -*-
"""Sharia-compliance lists for the Saudi and Egyptian markets.

Saudi Arabia (main market and Nomu): Argaam's table of three Sharia references,
  https://www.argaam.com/ar/company/shariahcompanies/1/3/3   (main market)
  https://www.argaam.com/ar/company/shariahcompanies/1/3/14  (Nomu)
  Each company gets a tick or not from each reference (Al Rajhi Capital, Dr. Mohammed Al-Osaimi,
  Albilad Capital).

Egypt: the aggregated list behind https://stocks.templatesnippet.com/stocks, which collects the
  verdicts of about ten Egyptian sources (Musaffa, Kashif, Halal Bourse, Faisal Islamic Bank,
  Osoul, Thndr/Islamicly, EGX33 Shariah index, ...).

Both are reduced to a compact form that ships inside the page and is refreshed by the app.
"""
import json
import re
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
ARGAAM_URL = "https://www.argaam.com/ar/company/shariahcompanies/1/3/%d"   # built-in; sources.defs may replace it
ARGAAM_MARKETS = {"main": 3, "nomu": 14}
EG_URL = "https://stocks.templatesnippet.com/data/stocks_merged.json"
EG_PAGE = "https://stocks.templatesnippet.com/stocks"

# Egyptian sources, in display order: key in the data -> Arabic name
EG_SOURCES = [
    ("egx33_sharia", "مؤشر الشريعة EGX33"), ("musaffa", "مصفاة"), ("kashif", "كاشف"),
    ("halal_bourse", "بورصة حلال"), ("faisal_bank", "بنك فيصل الإسلامي"), ("osoul", "أسطول"),
    ("thndr", "ثاندر / Islamicly"), ("halal_invest", "حلال إنفست"), ("nourborsa", "نور البورصة"),
    ("mohamed_ramadan_sharia", "قائمة محمد رمضان"),
]


def _get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


# ---------------------------------------------------------------- Saudi (Argaam)
def _defs():
    from sources import defs
    return defs


def parse_argaam(page, d=None):
    d = d or _defs().get("argaam")
    refs = []
    for name, date in re.findall(d["ref_re"], page):
        refs.append([name.strip(), date.strip()])
    if not refs:
        refs = [[n.strip(), ""] for n in re.findall(d["ref_alt_re"], page)]
    rows = {}
    for code, name, rest in re.findall(d["row_re"], page, re.S):
        cells = re.findall(d["cell_re"], rest, re.S)[:len(refs) or 3]
        rows[code] = {"n": re.sub(d["name_prefix_re"], "", name.strip()), "v": "".join("1" if d["tick"] in c else "0" for c in cells)}
    return refs, rows


def fetch_saudi():
    from sources.base import format_changed
    D = _defs()
    url = D.get("urls", "argaam")
    out = {"source": "أرقام", "url": url % 3, "date": time.strftime("%Y-%m-%d"), "refs": [], "main": {}, "nomu": {}}
    for seg, mid in ARGAAM_MARKETS.items():
        page = _get(url % mid)
        refs, rows = parse_argaam(page)
        if not rows and len(page) > 2000:
            raise format_changed("argaam", "page is %d characters but no company row matched" % len(page), page[:400])
        if len(rows) < (100 if seg == "main" else 30):
            raise ValueError("Argaam list for %s looks incomplete (%d rows)" % (seg, len(rows)))
        out[seg] = rows
        if len(refs) > len(out["refs"]):
            out["refs"] = refs
    return out


# ---------------------------------------------------------------- Egypt
def _eg_verdict(v):
    st = (v or {}).get("status") if isinstance(v, dict) else None
    return {"compliant": "1", "non_compliant": "0", "doubtful": "2"}.get(st, "-")


def eg_purification(it):
    """Share of the company's income that is not permissible, in percent: what is given away from each dividend."""
    for k in ("haram_earnings_percentage", "sp_haram_earning_percentage"):
        v = it.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 100:
            return round(float(v), 3)
    return None


def fetch_egypt():
    from sources.base import format_changed
    raw = _get(_defs().get("urls", "eg"), timeout=60)
    data = json.loads(raw)
    if isinstance(data, list) and data and not any(isinstance(x, dict) and x.get("symbol") for x in data[:20]):
        raise format_changed("egsharia", "records have no 'symbol' field", raw[:400])
    if not isinstance(data, list) or len(data) < 100:
        raise ValueError("Egyptian list looks incomplete")
    rows = {}
    for it in data:
        sym = (it.get("symbol") or "").strip().upper()
        if not sym:
            continue
        rows[sym] = {"n": (it.get("name_ar") or "").strip(),
                     "v": "".join(_eg_verdict(it.get(k)) for k, _ in EG_SOURCES)}
        pur = eg_purification(it)
        if pur is not None:
            rows[sym]["p"] = pur
    return {"source": "اسهم حلال (stocks.templatesnippet.com)", "url": EG_PAGE, "date": time.strftime("%Y-%m-%d"),
            "refs": [n for _, n in EG_SOURCES], "rows": rows}


# ---------------------------------------------------------------- USA: S&P 500 Shariah (SPUS holdings)
SPUS_CSV = "https://www.sp-funds.com/wp-content/uploads/data/TidalFG_Holdings_SPUS.csv"


def fetch_spus():
    """Holdings of the SP Funds S&P 500 Sharia ETF, which tracks the S&P 500 Shariah index (AAOIFI rules)."""
    import csv
    import io
    from sources.base import format_changed
    text = _get(_defs().get("urls", "spus"))
    rows = list(csv.DictReader(io.StringIO(text)))
    if rows and "StockTicker" not in rows[0]:
        raise format_changed("spus", "no 'StockTicker' column", text[:400])
    tickers = sorted({(r.get("StockTicker") or "").strip().upper() for r in rows})
    tickers = [t for t in tickers if re.match(r"^[A-Z]{1,5}(\.[A-Z])?$", t)]
    if len(tickers) < 100:
        raise ValueError("SPUS holdings look incomplete")
    date = (rows[0].get("Date") or "").strip()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", date)
    if m:
        date = "%s-%02d-%02d" % (m.group(3), int(m.group(1)), int(m.group(2)))
    return {"source": "SP Funds (SPUS)", "url": "https://www.sp-funds.com/spus/", "date": date, "tickers": tickers}
