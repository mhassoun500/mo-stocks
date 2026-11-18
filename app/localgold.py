# -*- coding: utf-8 -*-
"""Gold per gram in the local markets (2.18.2), as published by local price pages, not worked out from the ounce.

Egypt: Masrawy's gold page (sell and buy per karat, the change in pounds, the time of the last update).
Saudi Arabia: ZahabPrice's Saudi page (price per karat in riyals, before making charges and VAT).
Both pages allow these paths in their robots.txt. Each answer is kept 20 minutes; if a page cannot be read, its card
says so and nothing is worked out in its place."""
import json
import re
import time

from core import cache_get, cache_put, record
from prices import http_text

EG_URL = "https://www.masrawy.com/Gold"
SA_URL = "https://www.zahabprice.com/ar-sa"
TTL = 1200
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩٫٬", "0123456789.,")


def _num(s):
    s = str(s or "").translate(AR_DIGITS).replace(",", "").strip()
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def _text(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


def _date_modified(html):
    m = re.search(r'"dateModified"\s*:\s*"([^"]+)"', html or "")
    return m.group(1) if m else None


def parse_masrawy(html):
    """{karat: {sell, buy, change}} from the page's price table, and when it was updated."""
    out = {}
    for block in re.findall(r'<div class="currGoldDtls">(.*?</div>)\s*</div>', html or "", re.S):
        cells = [_text(c) for c in re.findall(r'class="item[^"]*"\s*>(.*?)</(?:h2|div)>', block, re.S)]
        if len(cells) < 3:
            continue
        m = re.search(r"عيار\s*(\d+)", cells[0].translate(AR_DIGITS))
        if not m:
            continue
        out[int(m.group(1))] = {"sell": _num(cells[1]), "buy": _num(cells[2]), "change": _num(cells[3]) if len(cells) > 3 else None}
    if not out:                                   # the table changed: the structured data on the same page
        for blk in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html or "", re.S):
            try:
                d = json.loads(blk)
            except ValueError:
                continue
            for it in ((d.get("mainEntity") or {}).get("itemListElement") or []):
                x = it.get("item") or {}
                m = re.search(r"عيار\s*(\d+)", x.get("name") or "")
                if m and x.get("priceCurrency") == "EGP":
                    out[int(m.group(1))] = {"sell": _num(x.get("price")), "buy": None, "change": None}
    return {"karats": out, "updated": _date_modified(html)}


def parse_zahab(html):
    """{karat: {price}} from the "by karat" table of the Saudi page, and when it was updated."""
    out = {}
    i = (html or "").find('id="karats"')
    body = html[i:] if i >= 0 else (html or "")
    j = body.find("</tbody>")
    body = body[:j] if j >= 0 else body
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) < 2:
            continue
        m = re.search(r"عيار\s*(\d+)", cells[0].translate(AR_DIGITS))
        if m:
            out[int(m.group(1))] = {"sell": _num(cells[1]), "buy": None, "change": None}
    return {"karats": out, "updated": _date_modified(html)}


def _card(key, name, cur, karat, src, url, parse, fetch):
    card = {"code": key, "name": name, "short": name, "cur": cur, "karat": karat, "source": src, "url": url, "ok": False}
    hit, _ = cache_get("lgold|" + key, max_age=TTL)
    if hit is None:
        try:
            p = parse(fetch(url))
            k = p["karats"].get(karat) or {}
            hit = {"price": k.get("sell"), "buy": k.get("buy"), "change": k.get("change"), "updated": p.get("updated"), "at": int(time.time() * 1000)}
        except Exception as e:
            record("WARN", "localgold %s" % key, e)
            hit = {"price": None, "error": "تعذّر قراءة صفحة المصدر."}
        if hit.get("price"):
            cache_put("lgold|" + key, hit)
    if not hit.get("price"):
        card["error"] = hit.get("error") or "لم يُعثر على السعر في صفحة المصدر."
        return card
    pr, ch = hit["price"], hit.get("change")
    card.update(ok=True, last=pr, buy=hit.get("buy"), chg=(ch / (pr - ch)) if ch is not None and pr and pr != ch else None,
                updated=hit.get("updated"), at=hit.get("at"))
    return card


def local_gold(fetch=None):
    fetch = fetch or http_text
    return [_card("SA24", "جرام عيار 24", "SAR", 24, "ZahabPrice", SA_URL, parse_zahab, fetch),
            _card("EG21", "جرام عيار 21", "EGP", 21, "مصراوي", EG_URL, parse_masrawy, fetch)]
