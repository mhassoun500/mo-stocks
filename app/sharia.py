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
ARGAAM_URL = "https://www.argaam.com/ar/company/shariahcompanies/1/3/%d"
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
def parse_argaam(page):
    refs = []
    for name, date in re.findall(r'<span class="inst_name">([^<]+)</span>\s*<br\s*/?>\s*<sup[^>]*>[^<]*<br\s*/?>\s*<span>([^<]*)</span>', page):
        refs.append([name.strip(), date.strip()])
    if not refs:
        refs = [[n.strip(), ""] for n in re.findall(r'<span class="inst_name">([^<]+)</span>', page)]
    rows = {}
    for code, name, rest in re.findall(
            r'<td class="stock-symbol">\s*(\d+)\s*</td>\s*<td class="argaam-font company-name">\s*<a [^>]*>([^<]+)</a>\s*</td>(.*?)</tr>',
            page, re.S):
        cells = re.findall(r'<td class="center">(.*?)</td>', rest, re.S)[:len(refs) or 3]
        rows[code] = {"n": re.sub(r"^شركة\s+", "", name.strip()), "v": "".join("1" if "✔" in c else "0" for c in cells)}
    return refs, rows


def fetch_saudi():
    out = {"source": "أرقام", "url": ARGAAM_URL % 3, "date": time.strftime("%Y-%m-%d"), "refs": [], "main": {}, "nomu": {}}
    for seg, mid in ARGAAM_MARKETS.items():
        refs, rows = parse_argaam(_get(ARGAAM_URL % mid))
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


def fetch_egypt():
    data = json.loads(_get(EG_URL, timeout=60))
    if not isinstance(data, list) or len(data) < 100:
        raise ValueError("Egyptian list looks incomplete")
    rows = {}
    for it in data:
        sym = (it.get("symbol") or "").strip().upper()
        if not sym:
            continue
        rows[sym] = {"n": (it.get("name_ar") or "").strip(),
                     "v": "".join(_eg_verdict(it.get(k)) for k, _ in EG_SOURCES)}
    return {"source": "اسهم حلال (stocks.templatesnippet.com)", "url": EG_PAGE, "date": time.strftime("%Y-%m-%d"),
            "refs": [n for _, n in EG_SOURCES], "rows": rows}
