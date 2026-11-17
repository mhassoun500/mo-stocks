# -*- coding: utf-8 -*-
"""Company file: what a company has disclosed, what its insiders did, and its record.

US       SEC EDGAR (official, free): the company's filings list and its insiders' Form 4 reports (buys and sells).
Saudi    Saudi Exchange issuer announcements. The exchange gives the newest announcements of the whole market,
         not one company's history, so the app reads that list every few minutes while it runs and keeps what it
         sees: a company's file grows from the day the app first ran.
Egypt    EGX disclosures search, the newest page, read the same way; the list has no dates, so the date shown is
         the day the app first saw the disclosure.

Insiders are shown by their role (board member, officer, 10% owner), never by name.
"""
import calendar
import html as H
import json
import re
import threading
import time
import xml.etree.ElementTree as ET

FEED_KEEP = 4000                         # announcements kept per market
FEED_EVERY = 10 * 60                     # seconds between reads of the market lists

# ---------------------------------------------------------------- kinds of disclosure
TYPES = [  # first match wins; words in Arabic and English
    ("insider", ("تعاملات", "الداخليين", "المطلعين", "كبار الملاك", "كبار المساهمين", "insider", "form 4")),
    ("results", ("نتائج", "القوائم المالية", "النتائج المالية", "10-q", "10-k", "20-f", "40-f", "results")),
    ("dividend", ("توزيع", "أرباح نقدية", "توزيعات", "dividend")),
    ("assembly", ("الجمعية", "جمعية", "assembly", "def 14a")),
    ("halt", ("إيقاف", "ايقاف", "تعليق التداول", "suspen", "halt")),
    ("resume", ("إعادة التعامل", "استئناف", "resum")),
    ("capital", ("رأس مال", "رأسمال", "رأس المال", "capital", "s-3", "424b")),
    ("board", ("مجلس الإدارة", "مجلس الادارة", "قرارات مجلس", "استقالة", "تعيين", "board")),
    ("contract", ("عقد", "توقيع", "ترسية", "مذكرة تفاهم", "اتفاقية", "contract", "agreement")),
]


def classify(title, form=""):
    t = (str(title or "") + " " + str(form or "")).lower()
    if str(form) == "4":
        return "insider"
    for k, words in TYPES:
        if any(w in t for w in words):
            return k
    return "other"


# ---------------------------------------------------------------- Saudi Exchange
def parse_saudi_feed(text):
    d = json.loads(text)
    out = []
    for r in (d.get("announcementList") or []):
        code = str(r.get("SYMBOL") or "").strip()
        if not re.match(r"^\d{4}$", code):
            continue
        m = re.match(r"(\d{2})/(\d{2})/(\d{4}) (\d{2}):(\d{2})", str(r.get("newsDateStr") or ""))
        t = (calendar.timegm((int(m.group(3)), int(m.group(2)), int(m.group(1)), int(m.group(4)), int(m.group(5)), 0)) - 3 * 3600) * 1000 if m else None
        url = str(r.get("announcementUrl") or "")
        out.append({"id": "SA%s" % r.get("PRESS_REL_ID"), "code": code, "date": t, "dated": bool(t),
                    "title": " ".join(str(r.get("SHORT_DESC") or "").split()),
                    "url": ("https://www.saudiexchange.sa" + url) if url.startswith("/") else ""})
    return out


# ---------------------------------------------------------------- EGX
def parse_egx_feed(page, seen_at):
    out = []
    for nid, title in re.findall(r'NewsDetails\.aspx\?NewsID=(\d+)"[^>]*>\s*<span[^>]*>(.*?)</span>', page or "", re.S):
        title = " ".join(H.unescape(re.sub(r"<[^>]+>", " ", title)).split())
        m = re.search(r"\(([A-Z0-9]{2,8})\.CA\)", title)
        if not m:
            continue
        out.append({"id": "EG" + nid, "code": m.group(1), "date": seen_at, "dated": False, "title": title,
                    "url": "https://www.egx.com.eg/ar/NewsDetails.aspx?NewsID=" + nid})
    return out


def merge_feed(old, new, keep=FEED_KEEP):
    """Keep what was seen before (with its first-seen date), add what is new, newest first, at most `keep`."""
    by = {x["id"]: x for x in old or []}
    for x in new:
        if x["id"] not in by:
            by[x["id"]] = x
        elif x.get("dated") and not by[x["id"]].get("dated"):
            by[x["id"]] = x
    return sorted(by.values(), key=lambda x: (x.get("date") or 0, x["id"]), reverse=True)[:keep]


# ---------------------------------------------------------------- SEC EDGAR
def sec_get(url, timeout=25):
    """The SEC answers the app's usual browser-like request (the fundamentals reader uses it daily); the live check on
    GitHub showed a request naming the app was refused, so the same headers as the rest of the app are sent."""
    from sources.base import http_get
    return http_get(url, headers={"Accept": "application/json,application/xml,text/*"}, timeout=timeout)


def parse_sec_submissions(d):
    r = ((d.get("filings") or {}).get("recent") or {})
    cik = str(d.get("cik") or "").lstrip("0")
    n = len(r.get("form") or [])
    out = []
    for i in range(n):
        form = r["form"][i]
        acc = r["accessionNumber"][i]
        doc = (r.get("primaryDocument") or [""] * n)[i] or ""
        date = r["filingDate"][i]
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", date or "")
        if not m:
            continue
        t = calendar.timegm((int(m.group(1)), int(m.group(2)), int(m.group(3)), 0, 0, 0)) * 1000
        desc = (r.get("primaryDocDescription") or [""] * n)[i] or ""
        items = (r.get("items") or [""] * n)[i] or ""
        folder = "https://www.sec.gov/Archives/edgar/data/%s/%s/" % (cik, acc.replace("-", ""))
        url = folder + doc
        out.append({"id": "US" + acc, "form": form, "date": t, "dated": True, "url": url,
                    "title": desc if desc and desc.upper() != form.upper() else "", "items": items,
                    "type": "results" if form in ("8-K", "6-K") and "2.02" in items else classify(desc, form),
                    "raw": folder + doc.split("/")[-1] if form == "4" else ""})   # the XML itself, not the styled copy under xsl.../
    return out


def parse_form4(xml_text):
    """Buys (P) and sells (S) on the open market from one Form 4; awards and option exercises are left out."""
    root = ET.fromstring(xml_text)
    rel = root.find(".//reportingOwnerRelationship")
    g = lambda e, p: (e.findtext(p) or "").strip() if e is not None else ""
    role = "other"
    if rel is not None:
        if g(rel, "isOfficer") in ("1", "true"):
            role = "officer"
        elif g(rel, "isDirector") in ("1", "true"):
            role = "director"
        elif g(rel, "isTenPercentOwner") in ("1", "true"):
            role = "ten"
    title = g(rel, "officerTitle") if role == "officer" else ""
    out = []
    for tr in root.findall(".//nonDerivativeTable/nonDerivativeTransaction"):
        code = g(tr, "transactionCoding/transactionCode")
        if code not in ("P", "S"):
            continue
        try:
            shares = float(g(tr, "transactionAmounts/transactionShares/value") or 0)
            price = float(g(tr, "transactionAmounts/transactionPricePerShare/value") or 0) or None
        except ValueError:
            continue
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", g(tr, "transactionDate/value"))
        if not m or shares <= 0:
            continue
        t = calendar.timegm((int(m.group(1)), int(m.group(2)), int(m.group(3)), 0, 0, 0)) * 1000
        out.append({"date": t, "side": "buy" if code == "P" else "sell", "shares": shares, "price": price,
                    "value": shares * price if price else None, "role": role, "title": title})
    return out


# ---------------------------------------------------------------- the company's record
def record_of(items, now=None):
    """Counts by kind, the span covered, and the next results date estimated from past years' dates."""
    now = now or time.time() * 1000
    by = {}
    for x in items:
        k = x.get("type") or classify(x.get("title"), x.get("form"))
        by[k] = by.get(k, 0) + 1
    dated = [x["date"] for x in items if x.get("date")]
    res = sorted(x["date"] for x in items if (x.get("type") or classify(x.get("title"), x.get("form"))) == "results" and x.get("date") and x.get("dated", True))
    due = None
    if len(res) >= 3:
        year = 365.2425 * 86400000
        cands = []
        for d in res:
            k = max(1, int((now - d) // year) + 1)
            cands.append(d + k * year)
        nxt = min(c for c in cands if c > now)
        near = [c for c in cands if abs(c - nxt) < 21 * 86400000]
        if len(near) >= 2:          # one past date is a coincidence, not a habit
            due = {"date": int(sum(near) / len(near)), "from": len(near),
                   "basis": "متوسط مواعيد إعلان النتائج في نفس الفترة من الأعوام السابقة"}
    return {"n": len(items), "byType": by, "first": min(dated) if dated else None, "last": max(dated) if dated else None, "due": due}


# ---------------------------------------------------------------- reading and keeping the market lists
FEED_LOCK = threading.Lock()


def refresh_feeds():
    """Read the Saudi and Egyptian lists once and keep what is new. Each failure is logged, never raised."""
    import core
    from sources.base import REG, SourcesFailed
    res = {}
    for ex, cid in (("SR", "sa_announce"), ("CA", "egx_news")):
        c = REG.items.get(cid)
        if not c or not c.available():
            continue
        try:
            new = REG.call_one(cid, "filings", op="feed")
        except Exception as e:
            core.record("WARN", "filings.feed %s" % ex, e)
            res[ex] = False
            continue
        with FEED_LOCK:
            old, _ = core.cache_get("feed|" + ex)
            merged = merge_feed((old or {}).get("items"), new)
            since = (old or {}).get("since") or int(time.time() * 1000)
            core.cache_put("feed|" + ex, {"items": merged, "since": since, "at": int(time.time() * 1000)})
        res[ex] = len(new)
    return res


def feeds_loop(quit_event):
    quit_event.wait(45)
    while not quit_event.is_set():
        refresh_feeds()
        quit_event.wait(FEED_EVERY)


SOURCE_PAGE = {"SR": "https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements?locale=ar&cs=%s",
               "CA": "https://www.egx.com.eg/ar/NewsSearch.aspx?com=&word=%s&from=&to=&isin=&sec_id=20",
               "US": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=%s&type=&dateb=&owner=include&count=40"}


def company_file(code, ex):
    import core
    from sources.base import REG, NoData
    c = str(code or "").strip().upper().split(".")[0]
    if ex not in ("SR", "CA", "US") or not re.match(r"^[A-Z0-9]{1,8}$", c):
        return {"ok": False, "error": "unsupported"}
    out = {"ok": True, "code": c, "ex": ex, "link": SOURCE_PAGE[ex] % c, "insiders": None}
    if ex == "US":
        key = "cfile|US|" + c
        hit, _ = core.cache_get(key, max_age=6 * 3600)
        if hit:
            return hit
        try:
            d = REG.call_one("edgar", "filings", code=c)
        except NoData:
            return {"ok": False, "error": "لا توجد إفصاحات لهذه الشركة في SEC."}
        except Exception as e:
            core.record("WARN", "filings.us %s" % c, e)
            return {"ok": False, "error": "تعذّر جلب الإفصاحات من SEC الآن."}
        items = d["items"]
        out.update(source="SEC EDGAR", items=[{k: v for k, v in x.items() if k != "raw"} for x in items[:40]],
                   insiders=d.get("insiders"), record=record_of(items), since=items[-1]["date"] if items else None, complete=True)
        core.cache_put(key, out)
        return out
    feed, _ = core.cache_get("feed|" + ex)
    items = [dict(x, type=classify(x["title"])) for x in (feed or {}).get("items") or [] if x["code"] == c]
    out.update(source="تداول السعودية" if ex == "SR" else "البورصة المصرية", items=items[:40], record=record_of(items),
               since=(feed or {}).get("since"), complete=False, watching=bool(feed))
    return out
