#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mo Stocks  |  تحليل الأسهم والذهب والصناديق   (desktop app)

A small local server feeds the analyzer page (page.html) and is shown in a native
window through pywebview, or in the default browser as a fallback.

Data
  - Yahoo Finance (primary): stocks (Saudi .SR, Egypt .CA, US, any Yahoo symbol),
    gold/silver futures converted to grams and local currency, indices, company data.
  - TradingView (optional fallback for stocks): pip install git+https://github.com/rongardF/tvdatafeed.git
  - Stooq (best-effort fallback for US stocks and metals).
  - Google News RSS for Arabic news.
Everything fetched is cached on disk so the last data stays available offline.

Run from source:  python app/main.py      Options: --browser  --minimized
"""
import base64
import bisect
import calendar
import csv
import datetime as dt
import http.cookiejar
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import funds  # noqa: E402  Egyptian mutual funds (Mubasher)
import tvdata  # noqa: E402  TradingView data feed and account session

APP_NAME = "Mo Stocks"
APP_TITLE = "Mo Stocks"
HOST = "127.0.0.1"
PREFERRED_PORT = 47821  # fixed so the page's saved state keeps the same origin between runs
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
TROY_OUNCE_G = 31.1034768
DEFAULT_UPDATE_REPO = "mhassoun500/mo-stocks"


# ================================================================ paths & version
def resource_dir():
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def read_version():
    here = os.path.dirname(os.path.abspath(__file__))
    for p in (os.path.join(resource_dir(), "VERSION"), os.path.join(here, "..", "VERSION")):
        try:
            with open(p, encoding="utf-8") as f:
                return f.read().strip()
        except OSError:
            pass
    return "dev"


def data_dir():
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    path = os.path.join(base, "StockZones")
    os.makedirs(os.path.join(path, "cache"), exist_ok=True)
    return path


VERSION = read_version()
DATA_DIR = data_dir()
CACHE_DIR = os.path.join(DATA_DIR, "cache")
STORE_FILE = os.path.join(DATA_DIR, "store.json")
FROZEN = bool(getattr(sys, "frozen", False))


def log(*a):
    try:
        print(*a)
    except Exception:
        pass


# ================================================================ persistent store (prefs, watchlist, journal...)
class Store:
    lock = threading.Lock()

    @classmethod
    def _load(cls):
        try:
            with open(STORE_FILE, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    @classmethod
    def get(cls, key, default=None):
        with cls.lock:
            return cls._load().get(key, default)

    @classmethod
    def set(cls, key, value):
        with cls.lock:
            d = cls._load()
            d[key] = value
            tmp = STORE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False)
            os.replace(tmp, STORE_FILE)


def pref(path, default=None):
    cur = Store.get("prefs", {}) or {}
    for part in path.split("."):
        if not isinstance(cur, dict):
            return default
        cur = cur.get(part)
    return default if cur is None else cur


# ================================================================ disk cache
def _cache_path(key):
    safe = re.sub(r"[^A-Za-z0-9_.=-]+", "_", key)[:150]
    return os.path.join(CACHE_DIR, safe + ".json")


def cache_put(key, obj):
    try:
        with open(_cache_path(key), "w", encoding="utf-8") as f:
            json.dump({"t": time.time(), "v": obj}, f, ensure_ascii=False)
    except OSError:
        pass


def cache_get(key, max_age=None):
    try:
        with open(_cache_path(key), encoding="utf-8") as f:
            d = json.load(f)
        if max_age is not None and time.time() - d["t"] > max_age:
            return None, d["t"]
        return d["v"], d["t"]
    except (OSError, ValueError, KeyError):
        return None, None


# ================================================================ HTTP with Yahoo cookie + crumb
class Yahoo:
    lock = threading.Lock()
    opener = None
    crumb = None

    @classmethod
    def _reset(cls):
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        cls.crumb = None

    @classmethod
    def get(cls, url, data=None, headers=None, timeout=20):
        if cls.opener is None:
            cls._reset()
        h = {"User-Agent": UA, "Accept": "application/json,*/*"}
        h.update(headers or {})
        req = urllib.request.Request(url, data=data, headers=h)
        with cls.opener.open(req, timeout=timeout) as r:
            return r.read()

    @classmethod
    def ensure_crumb(cls):
        with cls.lock:
            if cls.crumb:
                return cls.crumb
            last = None
            for attempt in range(3):
                cls._reset()
                try:
                    cls.get("https://fc.yahoo.com", timeout=10)
                except Exception:
                    pass  # returns 404 but sets the A3 cookie
                try:
                    c = cls.get("https://query1.finance.yahoo.com/v1/test/getcrumb").decode().strip()
                    if c and "<" not in c and " " not in c:
                        cls.crumb = c
                        return c
                except Exception as e:
                    last = e
                time.sleep(1.5 * (attempt + 1))
            raise RuntimeError("تعذّر الحصول على تصريح Yahoo. %s" % (last or ""))

    @classmethod
    def with_crumb(cls, fn):
        for attempt in range(2):
            crumb = cls.ensure_crumb()
            try:
                return fn(crumb)
            except urllib.error.HTTPError as e:
                if e.code in (401, 403) and attempt == 0:
                    with cls.lock:
                        cls.crumb = None
                    continue
                raise


def http_json(url, timeout=20):
    return json.loads(Yahoo.get(url, timeout=timeout).decode("utf-8"))


def http_text(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


class NotFound(Exception):
    pass


# ================================================================ markets
# exchange code -> (Yahoo suffix, TradingView exchanges, index symbol, Stooq suffix)
EXCHANGES = {
    "SR": (".SR", ["TADAWUL"], "^TASI.SR", None),
    "CA": (".CA", ["EGX"], "^CASE30", None),
    "US": ("", ["NASDAQ", "NYSE", "AMEX"], "^GSPC", ".us"),
    "XX": ("", [], None, None),
}
RANGES = {"1y": 260, "2y": 520, "5y": 1300, "max": 5000}

# metal code -> (Yahoo base, Yahoo FX or None, purity, per gram?, currency, Arabic name, short label, stooq base, stooq fx)
METALS = {
    "XAU-USD-OZ": ("GC=F", None, 1.0, False, "USD", "الذهب — أوقية بالدولار", "ذهب · أوقية", "xauusd", None),
    "XAU-SAR-24": ("GC=F", "SAR=X", 1.0, True, "SAR", "ذهب عيار 24 — جرام بالريال", "ذهب ٢٤ · ريال", "xauusd", "usdsar"),
    "XAU-SAR-21": ("GC=F", "SAR=X", 0.875, True, "SAR", "ذهب عيار 21 — جرام بالريال", "ذهب ٢١ · ريال", "xauusd", "usdsar"),
    "XAU-SAR-18": ("GC=F", "SAR=X", 0.75, True, "SAR", "ذهب عيار 18 — جرام بالريال", "ذهب ١٨ · ريال", "xauusd", "usdsar"),
    "XAU-EGP-24": ("GC=F", "EGP=X", 1.0, True, "EGP", "ذهب عيار 24 — جرام بالجنيه", "ذهب ٢٤ · جنيه", "xauusd", "usdegp"),
    "XAU-EGP-21": ("GC=F", "EGP=X", 0.875, True, "EGP", "ذهب عيار 21 — جرام بالجنيه", "ذهب ٢١ · جنيه", "xauusd", "usdegp"),
    "XAU-EGP-18": ("GC=F", "EGP=X", 0.75, True, "EGP", "ذهب عيار 18 — جرام بالجنيه", "ذهب ١٨ · جنيه", "xauusd", "usdegp"),
    "XAG-USD-OZ": ("SI=F", None, 1.0, False, "USD", "الفضة — أوقية بالدولار", "فضة · أوقية", "xagusd", None),
}


def day_ms(ts_seconds, gmtoffset=0):
    d = time.gmtime(ts_seconds + (gmtoffset or 0))
    return calendar.timegm((d.tm_year, d.tm_mon, d.tm_mday, 0, 0, 0)) * 1000


def yahoo_symbol(code, ex):
    code = code.strip().upper().replace(" ", "")
    suffix = EXCHANGES.get(ex, ("",))[0]
    if ex == "US" and re.match(r"^[A-Z]+\.[A-Z]$", code):
        return code.replace(".", "-")  # class shares: BRK.B on TradingView is BRK-B on Yahoo
    if "." in code or code.startswith("^") or "=" in code or not suffix:
        return code
    return code + suffix


# ---------------------------------------------------------------- Yahoo chart
def fetch_yahoo(symbol, rng, interval="1d"):
    intraday = interval != "1d"
    yr = rng if not intraday else ("1y" if rng == "1y" else "2y")
    last = None
    data = None
    for host in ("query1", "query2"):
        url = ("https://%s.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=%s"
               "&includePrePost=false&events=div%%2Csplit" % (host, urllib.parse.quote(symbol), yr, interval))
        try:
            data = http_json(url)
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound("الرمز %s غير موجود في Yahoo Finance." % symbol)
            last = "Yahoo Finance رفض الطلب (HTTP %s). حاول بعد دقيقة." % e.code
        except Exception as e:
            last = "تعذّر الاتصال بـ Yahoo Finance. تأكد من اتصال الإنترنت."
    if data is None:
        raise ConnectionError(last or "تعذّر الاتصال بـ Yahoo Finance.")

    chart = data.get("chart") or {}
    if chart.get("error"):
        raise NotFound("الرمز %s غير معروف لدى Yahoo Finance." % symbol)
    res = (chart.get("result") or [None])[0]
    if not res or not res.get("timestamp"):
        raise NotFound("لا توجد بيانات أسعار للرمز %s." % symbol)

    meta = res.get("meta") or {}
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    off = meta.get("gmtoffset", 0)
    cols = [quote.get(k) or [] for k in ("open", "high", "low", "close", "volume")]
    rows = []
    stamps = res["timestamp"]
    rmp, rmt = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
    for i, ts in enumerate(stamps):
        vals = [c[i] if i < len(c) else None for c in cols]
        if vals[3] is None:
            # Yahoo often leaves today's close empty for Tadawul / EGX while the bar's open, high,
            # low and volume are filled; the latest traded price is then in the chart's meta.
            if (i == len(stamps) - 1 and not intraday and rmp and rmt
                    and day_ms(rmt, off) == day_ms(ts, off)):
                vals[3] = rmp
                vals[0] = vals[0] if vals[0] is not None else rmp
                vals[1] = max(vals[1] if vals[1] is not None else rmp, rmp)
                vals[2] = min(vals[2] if vals[2] is not None else rmp, rmp)
            else:
                continue
        t = ts * 1000 if intraday else day_ms(ts, off)
        rows.append([t] + vals)
    if not rows:
        raise NotFound("لا توجد بيانات أسعار للرمز %s." % symbol)
    ev = res.get("events") or {}
    divs = sorted([[day_ms(int(v["date"]), off), v.get("amount")] for v in (ev.get("dividends") or {}).values()])
    splits = sorted([[day_ms(int(v["date"]), off), v.get("splitRatio") or ""] for v in (ev.get("splits") or {}).values()])
    return {
        "ok": True, "source": "Yahoo Finance", "symbol": symbol, "interval": interval,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "currency": meta.get("currency") or "", "exchangeTz": meta.get("exchangeTimezoneName") or "",
        "rows": rows, "dividends": divs, "splits": splits,
    }


# ---------------------------------------------------------------- Stooq (best effort)
def fetch_stooq(sym):
    txt = http_text("https://stooq.com/q/d/l/?s=%s&i=d" % urllib.parse.quote(sym.lower()))
    rd = csv.DictReader(io.StringIO(txt))
    rows = []
    for r in rd:
        try:
            y, m, d = map(int, r["Date"].split("-"))
            rows.append([calendar.timegm((y, m, d, 0, 0, 0)) * 1000, float(r["Open"]), float(r["High"]),
                         float(r["Low"]), float(r["Close"]), float(r.get("Volume") or 0)])
        except (KeyError, ValueError):
            continue
    if not rows:
        raise NotFound("لا توجد بيانات في Stooq.")
    return rows


def trim_range(rows, rng):
    n = RANGES.get(rng, 520)
    return rows[-n:]


# ---------------------------------------------------------------- metals
def combine_fx(base_rows, fx_rows, factor):
    fx_t = [r[0] for r in fx_rows] if fx_rows else []
    fx_c = [r[4] for r in fx_rows] if fx_rows else []
    out = []
    for t, o, h, l, c, v in base_rows:
        mult = factor
        if fx_rows is not None:
            k = bisect.bisect_right(fx_t, t) - 1  # last FX close on or before this bar
            if k < 0:
                continue
            mult *= fx_c[k]
        out.append([t, o * mult if o is not None else None, h * mult if h is not None else None,
                    l * mult if l is not None else None, c * mult, v])
    return out


def fetch_metal(code, rng, interval="1d"):
    if code not in METALS:
        raise NotFound("نوع المعدن غير معروف.")
    base_sym, fx_sym, purity, per_gram, cur, name, short, st_base, st_fx = METALS[code]
    factor = purity / TROY_OUNCE_G if per_gram else purity
    base = None
    if prefer_tv():
        try:
            n = tv_bars_needed(rng, interval)
            res = "1D" if interval == "1d" else "60"
            info, bars, _ = tv_hist(TV_METAL[base_sym], res, n)
            base = {"rows": tvdata.bars_to_rows(bars, info, interval == "1d")[-n:]}
            fx = None
            if fx_sym:
                finfo, fbars, _ = tv_hist(TV_METAL[fx_sym], res, n + 40)
                fx = tvdata.bars_to_rows(fbars, finfo, interval == "1d")
            source = "TradingView"
            if not base["rows"] or (fx_sym and not fx):
                base = None
        except Exception as e:
            log(" TradingView metal fetch failed (%s); using Yahoo." % e)
            base = None
    try:
        if base is None:
            base = fetch_yahoo(base_sym, rng, interval)
            fx = fetch_yahoo(fx_sym, rng, interval)["rows"] if fx_sym else None
            source = "Yahoo Finance"
    except ConnectionError:
        if interval != "1d":
            raise
        base = {"rows": trim_range(fetch_stooq(st_base), rng)}
        fx = fetch_stooq(st_fx) if st_fx else None
        source = "Stooq"
    rows = combine_fx(base["rows"], fx, factor)
    note = (("السعر العالمي الفوري" if source == "TradingView" else "سعر عالمي من العقود الآجلة")
            + " محوّل بسعر الصرف اليومي، وقد يختلف عن سعر الصاغة ولا يشمل المصنعية." if per_gram else "")
    shown = (lambda x: TV_METAL.get(x, x)) if source == "TradingView" else (lambda x: x)
    return {"ok": True, "source": source, "symbol": shown(base_sym) + ("×" + shown(fx_sym) if fx_sym else ""),
            "interval": interval, "name": name, "short": short, "currency": cur, "rows": rows,
            "delayed": False if source == "TradingView" else None,
            "note": note, "dividends": [], "splits": []}


# ---------------------------------------------------------------- TradingView (preferred source)
TV_PREFIX = {"SR": "TADAWUL", "CA": "EGX"}
TV_INDEX = {"^TASI.SR": "TADAWUL:TASI", "^CASE30": "EGX:EGX30", "^GSPC": "SP:SPX", "DX-Y.NYB": "TVC:DXY"}
TV_METAL = {"GC=F": "TVC:GOLD", "SI=F": "TVC:SILVER", "SAR=X": "FX_IDC:USDSAR", "EGP=X": "FX_IDC:USDEGP"}
ACCOUNT = tvdata.Account(os.path.join(DATA_DIR, "tv_session.bin"))


def prefer_tv():
    return pref("dataSource", "tv") != "yahoo" and tvdata.CLIENT.available()


def tv_symbol(code, ex):
    c = code.strip().upper().replace(" ", "")
    if c in TV_INDEX:
        return TV_INDEX[c]
    if ex in TV_PREFIX:
        return TV_PREFIX[ex] + ":" + c.split(".")[0]
    if ex == "XX":
        for suf, pre in ((".SR", "TADAWUL"), (".CA", "EGX")):
            if c.endswith(suf):
                return pre + ":" + c[: -len(suf)]
        return None
    if ex == "US" and re.match(r"^[A-Z][A-Z0-9.\-]{0,9}$", c):
        return US_EXCH[c] + ":" + c if US_EXCH.get(c) else c
    return None


def tv_hist(symbol, res, n):
    token = ACCOUNT.token()
    try:
        return tvdata.CLIENT.history(symbol, res, n, token) + (token != tvdata.UNAUTH,)
    except tvdata.TVAuthError:
        ACCOUNT.invalidate()
        return tvdata.CLIENT.history(symbol, res, n, tvdata.UNAUTH) + (False,)


def tv_bars_needed(rng, interval):
    if interval == "1d":
        return RANGES.get(rng, 520) + 5
    return 1800 if rng == "1y" else 3600


def yahoo_events(symbol, rng, box):
    """Dividends and splits (TradingView's chart feed has none); kept for 12 hours."""
    key = "ev|%s" % symbol
    hit, _ = cache_get(key, max_age=12 * 3600)
    if hit is None:
        try:
            r = fetch_yahoo(symbol, "max" if rng == "max" else "5y", "1d")
            hit = {"dividends": r["dividends"], "splits": r["splits"], "name": r["name"]}
            cache_put(key, hit)
        except Exception:
            return
    box.update(hit)


def fetch_tv(code, ex, rng, interval="1d", lite=False):
    """Price history from TradingView, or None when the symbol has no TradingView mapping."""
    sym = tv_symbol(code, ex)
    if not sym:
        return None
    daily = interval == "1d"
    n = tv_bars_needed(rng, interval)
    events = {}
    th = None
    if daily and not lite and not code.startswith("^") and ex in ("SR", "CA", "US", "XX"):
        th = threading.Thread(target=yahoo_events, args=(yahoo_symbol(code, ex), rng, events), daemon=True)
        th.start()
    cands = [sym] if ":" in sym else ["NASDAQ:" + sym, "NYSE:" + sym, "AMEX:" + sym, sym]
    for s_ in cands:
        try:
            info, bars, authed = tv_hist(s_, "1D" if daily else "60", n)
        except tvdata.TVNotFound:
            continue
        rows = tvdata.bars_to_rows(bars, info, daily)
        if not rows:
            continue
        if th:
            th.join(4)
        delayed = tvdata.is_delayed(info)
        clean = re.sub(r"_(DLY|NAUTH)(?=:)", "", info.get("pro_name") or s_)
        first = rows[-n:][0][0]
        for k in ("dividends", "splits"):
            events[k] = [e for e in events.get(k, []) if e[0] >= first]
        return {"ok": True, "source": "TradingView", "symbol": clean, "interval": interval,
                "name": info.get("description") or events.get("name") or s_,
                "currency": info.get("currency_code") or "", "exchangeTz": info.get("timezone") or "",
                "rows": rows[-n:], "dividends": events.get("dividends", []), "splits": events.get("splits", []),
                "delayed": delayed, "tvAccount": authed}
    raise NotFound("الرمز %s غير موجود في TradingView." % sym)


def fund_short(name):
    parts = [p.strip() for p in re.split(r"\s+[-–]\s+", name or "") if p.strip()]
    short, share_class = "", ""
    for part in reversed(parts[1:]):
        if re.match(r"^(ال)?فئة\b", part):
            share_class = part
            continue
        if re.search(r"[\u0600-\u06FF]", part) and not part.startswith("الإصدار") and len(part) >= 3:
            short = part
            break
    if not short:
        short = re.sub(r"^صندوق\s+(?:استثمار|إستثمار)?\s*", "", parts[0] if share_class and parts else name or "").strip()
    if share_class:
        short += " · " + share_class
    short = re.sub(r"\s{2,}", " ", short)
    return short if len(short) <= 40 else short[:38] + "…"


SNAP_FILE = os.path.join(DATA_DIR, "fund_prices.json")
SNAP_LOCK = threading.Lock()


def snap_load():
    try:
        with open(SNAP_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def snap_add(points_by_id):
    """points_by_id: {fund_id: [[t_ms, price], ...]} — merged into the local price record."""
    with SNAP_LOCK:
        d = snap_load()
        for fid, pts in points_by_id.items():
            cur = {int(t): p for t, p in d.get(str(fid), [])}
            for t, p in pts:
                if t and p and p > 0:
                    cur[int(t)] = float(p)
            d[str(fid)] = sorted([[t, p] for t, p in cur.items()])
        tmp = SNAP_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.replace(tmp, SNAP_FILE)


FUNDS_LOCK = threading.Lock()
FUNDS_BUSY = threading.Event()


def get_funds(force=False):
    cached, _ = cache_get("funds|all", max_age=6 * 3600)
    if cached and not force:
        return cached
    stale, _ = cache_get("funds|all")
    if stale and not force:  # answer at once with the last list and refresh it in the background
        if not FUNDS_BUSY.is_set():
            threading.Thread(target=get_funds, kwargs={"force": True}, daemon=True).start()
        return dict(stale, refreshing=True)
    with FUNDS_LOCK:
        cached, t = cache_get("funds|all", max_age=6 * 3600)
        if cached and time.time() - t < 120:  # another request just finished the same work
            return cached
        FUNDS_BUSY.set()
        try:
            return _fetch_all_funds(stale)
        finally:
            FUNDS_BUSY.clear()


def _fetch_all_funds(stale):
    got_by = {}

    def one(country):
        try:
            got_by[country] = funds.fetch_fund_list(country)
        except Exception:
            got_by[country] = None

    ths = [threading.Thread(target=one, args=(c,), daemon=True) for c in funds.COUNTRIES]
    for th in ths:
        th.start()
    for th in ths:
        th.join(130)
    items, failed = [], []
    for country in funds.COUNTRIES:
        got = got_by.get(country)
        if not got:
            failed.append(country)
            got = [i for i in (stale or {}).get("items", []) if i.get("country") == country]
        items += got
    if not items:
        return {"ok": False, "error": "تعذّر جلب قائمة الصناديق من مباشر. تحقق من الاتصال."}
    for it in items:
        it["short"] = fund_short(it["name"])
    try:
        # Mubasher keeps full histories for Saudi funds; Egyptian ones have gaps, so record their prices daily
        snap_add({it["id"]: [[it["date"], it["price"]]] for it in items
                  if it.get("country") == "EG" and it.get("date") and it.get("price")})
    except OSError:
        pass
    out = {"ok": True, "items": items, "at": time.time(), "categories": funds.CATEGORY_AR,
           "countries": funds.COUNTRY_AR, "shariaNote": funds.SHARIA_NOTE}
    if failed:
        out["offline"] = True
    else:
        cache_put("funds|all", out)
    return out


def fetch_fund(code, rng):
    try:
        fid = int(str(code).strip())
    except ValueError:
        raise NotFound("رقم الصندوق غير صحيح.")
    lst = get_funds()
    meta = next((i for i in lst.get("items", []) if i["id"] == fid), None)
    online = True
    try:
        rows = funds.fetch_fund_history(fid)
    except urllib.error.HTTPError as e:
        if e.code not in (403, 404):
            online = False
        rows = []
    except Exception:
        online = False
        rows = []
    mub_last = rows[-1][0] if rows else None
    local = snap_load().get(str(fid), [])
    if local:
        by_t = {r[0]: r for r in rows}
        for t, p in local:
            if t not in by_t:
                by_t[t] = [t, p, p, p, p, 0]
        rows = sorted(by_t.values(), key=lambda r: r[0])
    if not rows:
        if not online:
            raise ConnectionError("تعذّر الاتصال بموقع مباشر.")
        raise NotFound("لا يوجد سجل أسعار لهذا الصندوق بعد.")
    gaps = []
    for a, b in zip(rows, rows[1:]):
        if b[0] - a[0] > 45 * 86400000:
            gaps.append([a[0], b[0]])
    name = meta["name"] if meta else "صندوق %d" % fid
    country = (meta or {}).get("country") or "EG"
    return {"ok": True, "source": "مباشر", "symbol": "صندوق %d" % fid, "interval": "1d", "name": name,
            "short": fund_short(name), "currency": funds.fund_currency(name, country), "rows": funds.trim_days(rows, rng),
            "allRows": len(rows), "inception": rows[0][0], "dividends": [], "splits": [], "isFund": True,
            "country": country, "category": funds.fund_category(name, country),
            "sharia": funds.fund_sharia(fid, name, (meta or {}).get("manager", ""), country),
            "manager": meta["manager"] if meta else "", "owner": meta["owner"] if meta else "",
            "ytd": meta.get("ytd") if meta else None, "listDate": meta.get("date") if meta else None,
            "mubasherLast": mub_last, "gaps": gaps[-3:], "localPoints": len(local), "fundId": fid}


# ---------------------------------------------------------------- today's session (TradingView scanner)
# Yahoo publishes Tadawul and EGX daily bars a day or more late, so the current session's
# open/high/low/last/volume come from TradingView's public market scanner (15-minute delay).
# One request returns the whole market and is kept for two minutes, so the market scan,
# alerts and the analysis view all share it.
TV_MARKETS = {"SR": "ksa", "CA": "egypt"}
LIVE_TTL = 120
LQ = {}
LQ_LOCK = threading.Lock()


def live_quotes(ex):
    with LQ_LOCK:
        hit = LQ.get(ex)
    if hit and time.time() - hit[0] < LIVE_TTL:
        return hit[1]
    body = {"filter": [{"left": "type", "operation": "in_range", "right": ["stock", "fund", "dr"]}],
            "columns": ["close", "open", "high", "low", "volume", "time"], "range": [0, 3000]}
    req = urllib.request.Request("https://scanner.tradingview.com/%s/scan" % TV_MARKETS[ex],
                                 data=json.dumps(body).encode("utf-8"),
                                 headers={"User-Agent": UA, "Content-Type": "application/json",
                                          "Origin": "https://www.tradingview.com",
                                          "Referer": "https://www.tradingview.com/"})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception:
        with LQ_LOCK:  # back off for a minute instead of retrying on every request
            LQ[ex] = (time.time() - LIVE_TTL + 60, hit[1] if hit else {})
        return hit[1] if hit else {}
    out = {}
    for row in data.get("data") or []:
        sym, d = row.get("s") or "", row.get("d") or []
        if ":" not in sym or len(d) < 6 or not d[0] or not d[5]:
            continue
        c = float(d[0])
        o = float(d[1] or c)
        out[sym.split(":", 1)[1].upper()] = [day_ms(int(d[5]), 3 * 3600), o, float(d[2] or max(o, c)),
                                             float(d[3] or min(o, c)), c, float(d[4] or 0)]
    with LQ_LOCK:
        LQ[ex] = (time.time(), out)
    return out


def live_market(code, ex):
    if ex in TV_MARKETS:
        return ex
    if ex == "XX":
        return {".SR": "SR", ".CA": "CA"}.get(code.strip().upper()[-3:])
    return None


def patch_live(res, code, ex):
    """Return a copy of a daily history with today's session merged in (SR / CA only)."""
    ex = live_market(code, ex)
    if not ex or not res.get("ok") or not res.get("rows") or res.get("offline"):
        return res
    bar = live_quotes(ex).get(code.strip().upper().split(".")[0])
    if not bar:
        return res
    rows = list(res["rows"])
    if bar[0] > rows[-1][0]:
        prev = rows[-1]
    elif bar[0] == rows[-1][0] and len(rows) > 1:
        prev = rows[-2]
    else:
        return res
    # Daily price limits are ±10% (Tadawul) and ±20% (EGX); a bigger jump means the two sources
    # disagree on this listing (unit, split or a stale Yahoo series), so keep Yahoo's data as is.
    if not prev[4] or abs(bar[4] / prev[4] - 1) > 0.25:
        return res
    if bar[0] > rows[-1][0]:
        rows.append(bar)
    else:
        rows[-1] = bar
    return dict(res, rows=rows, live={"source": "TradingView", "delayMin": 15, "day": bar[0], "at": time.time()})


def _history_live(code, ex, rng, interval, lite=False):
    if ex == "FUND":
        return fetch_fund(code, rng)
    if ex == "GOLD":
        return fetch_metal(code, rng, interval)
    tv_first = prefer_tv()
    tv_err = None
    if tv_first:
        try:
            r = fetch_tv(code, ex, rng, interval, lite)
            if r:
                return r
        except NotFound as e:
            tv_err = e
        except Exception as e:
            log(" TradingView failed for %s (%s); trying Yahoo." % (code, e))

    def tv_backup():
        if tv_first or not tvdata.CLIENT.available():
            return None
        try:
            r = fetch_tv(code, ex, rng, interval)
            if r:
                r["note"] = "تعذّر الجلب من Yahoo Finance فاستُخدم TradingView."
            return r
        except Exception:
            return None

    symbol = yahoo_symbol(code, ex)
    try:
        return fetch_yahoo(symbol, rng, interval)
    except NotFound as e:
        tv = tv_backup()
        if tv:
            return tv
        return {"ok": False, "notFound": True, "error": str(tv_err or e)}
    except ConnectionError:
        tv = tv_backup()
        if tv:
            return tv
        if interval == "1d":
            st = EXCHANGES.get(ex, (None, None, None, None))[3]
            if st:
                rows = trim_range(fetch_stooq(code.split(".")[0] + st), rng)
                return {"ok": True, "source": "Stooq", "symbol": code.upper(), "interval": "1d", "name": code.upper(),
                        "currency": "", "rows": rows, "dividends": [], "splits": [],
                        "note": "تعذّر الوصول إلى TradingView وYahoo Finance فاستُخدم Stooq."}
        raise


MEM = {}
MEM_LOCK = threading.Lock()


def get_history(code, ex, rng, interval="1d", lite=False):
    if rng not in RANGES:
        rng = "2y"
    if interval not in ("1d", "60m") or ex == "FUND":
        interval = "1d"
    src = "tv" if (prefer_tv() and ex != "FUND") else "yf"
    key = "h|%s|%s|%s|%s|%s%s" % (src, ex, code.upper(), rng, interval, "|L" if lite else "")
    live = interval == "1d" and bool(live_market(code, ex))
    with MEM_LOCK:
        hit = MEM.get(key)
    if hit:
        from_tv = hit[1].get("source") == "TradingView"
        ttl = 120 if from_tv else 300 if interval != "1d" else (900 if live else 180)
        if time.time() - hit[0] < ttl:
            return patch_live(hit[1], code, ex) if live and not from_tv else hit[1]
    try:
        res = _history_live(code, ex, rng, interval, lite)
    except Exception as e:
        cached, t = cache_get(key)
        if cached:
            cached = dict(cached)
            cached["offline"] = True
            cached["note"] = ("لا يوجد اتصال بالإنترنت، وهذه آخر بيانات محفوظة بتاريخ %s."
                              % time.strftime("%Y-%m-%d %H:%M", time.localtime(t)))
            return cached
        return {"ok": False, "error": str(e) or "تعذّر جلب البيانات.", "offline": True}
    if res.get("ok"):
        with MEM_LOCK:
            MEM[key] = (time.time(), res)
        cache_put(key, res)
        if live and res.get("source") != "TradingView":
            return patch_live(res, code, ex)
    return res


# ---------------------------------------------------------------- search, profile, universe, sectors
def search_yahoo(q, ex):
    url = ("https://query2.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=15&newsCount=0&listsCount=0"
           % urllib.parse.quote(q))
    data = http_json(url)
    suffix = EXCHANGES.get(ex, ("",))[0]
    items = []
    for it in data.get("quotes") or []:
        sym = it.get("symbol") or ""
        if not sym or it.get("quoteType") not in (None, "EQUITY", "ETF", "INDEX"):
            continue
        if suffix and not sym.endswith(suffix):
            continue
        if ex == "US" and "." in sym:
            continue
        items.append({"symbol": sym, "name": it.get("longname") or it.get("shortname") or sym,
                      "exch": it.get("exchDisp") or ""})
    return items[:10]


def _raw(v):
    if isinstance(v, dict):
        return v.get("raw", v.get("fmt"))
    return v


def get_profile(symbol):
    key = "p|" + symbol
    cached, _ = cache_get(key, max_age=12 * 3600)
    if cached:
        return cached
    mods = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,calendarEvents"

    def call(crumb):
        url = ("https://query1.finance.yahoo.com/v10/finance/quoteSummary/%s?modules=%s&crumb=%s"
               % (urllib.parse.quote(symbol), mods, urllib.parse.quote(crumb)))
        return json.loads(Yahoo.get(url).decode("utf-8"))

    try:
        data = Yahoo.with_crumb(call)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"ok": False, "error": "لا توجد بيانات أساسية لهذا الرمز."}
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب البيانات الأساسية."}
    except Exception:
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب البيانات الأساسية."}
    res = ((data.get("quoteSummary") or {}).get("result") or [{}])[0]
    sd = res.get("summaryDetail") or {}
    ks = res.get("defaultKeyStatistics") or {}
    fd = res.get("financialData") or {}
    ap = res.get("assetProfile") or {}
    ce = res.get("calendarEvents") or {}
    pr = res.get("price") or {}
    earn = ce.get("earnings") or {}
    out = {
        "ok": True, "symbol": symbol,
        "name": pr.get("longName") or pr.get("shortName") or symbol,
        "sector": ap.get("sector") or "", "industry": ap.get("industry") or "",
        "summary": (ap.get("longBusinessSummary") or "")[:600], "website": ap.get("website") or "",
        "marketCap": _raw(sd.get("marketCap")) or _raw(pr.get("marketCap")),
        "trailingPE": _raw(sd.get("trailingPE")), "forwardPE": _raw(sd.get("forwardPE")),
        "priceToBook": _raw(ks.get("priceToBook")),
        "dividendYield": _raw(sd.get("dividendYield")), "payoutRatio": _raw(sd.get("payoutRatio")),
        "beta": _raw(sd.get("beta")),
        "profitMargins": _raw(fd.get("profitMargins")) or _raw(ks.get("profitMargins")),
        "returnOnEquity": _raw(fd.get("returnOnEquity")), "debtToEquity": _raw(fd.get("debtToEquity")),
        "revenueGrowth": _raw(fd.get("revenueGrowth")), "earningsGrowth": _raw(fd.get("earningsGrowth")),
        "fiftyTwoWeekHigh": _raw(sd.get("fiftyTwoWeekHigh")), "fiftyTwoWeekLow": _raw(sd.get("fiftyTwoWeekLow")),
        "recommendation": fd.get("recommendationKey") or "",
        "targetMeanPrice": _raw(fd.get("targetMeanPrice")),
        "analysts": _raw(fd.get("numberOfAnalystOpinions")),
        "earningsDates": [_raw(x) for x in (earn.get("earningsDate") or []) if _raw(x)],
        "exDividendDate": _raw(ce.get("exDividendDate")), "dividendDate": _raw(ce.get("dividendDate")),
    }
    cache_put(key, out)
    return out


SCREENER_EXCH = {"SR": "SAU"}

# Yahoo's screener lists Egyptian shares by ISIN codes that mostly carry no price history,
# so the Egyptian market uses this list of EGX trading symbols, each verified on Yahoo
# Finance (at least six months of daily prices). Ordered roughly by size.
EGX_LIST = [
    ("COMI", "Commercial International Bank Egypt (CIB) S.A.E."),
    ("TMGH", "Talaat Moustafa Group Holding"),
    ("EAST", "Eastern Company S.A.E"),
    ("ETEL", "Telecom Egypt Company"),
    ("HRHO", "EFG Holding Company S.A.E"),
    ("SWDY", "El Sewedy Electric Company"),
    ("ABUK", "Abu Qir Fertilizers & Chemical Industries Company (S.A.E)"),
    ("EFIH", "e-finance for Digital and Financial Investments S.A.E."),
    ("FWRY", "Fawry for Banking Technology and Electronic Payments S.A.E."),
    ("ORAS", "Orascom Construction PLC"),
    ("AMOC", "Alexandria Mineral Oils Company"),
    ("HELI", "Heliopolis Co. for Housing & Development"),
    ("JUFO", "Juhayna Food Industries S.A.E."),
    ("MFPC", "Misr Fertilizer Production Company"),
    ("PHDC", "Palm Hills Developments S.A.E."),
    ("CIEB", "Credit Agricole - Egypt Bank (S.A.E.)"),
    ("ADIB", "Abu Dhabi Islamic Bank - Egypt - S.A.E"),
    ("EMFD", "Emaar Misr for Development Company (S.A.E.)"),
    ("ORWE", "Oriental Weavers Carpets Company (S.A.E)"),
    ("CCAP", "QALA For Financial Investments"),
    ("EFID", "Edita Food Industries Company (S.A.E)"),
    ("BTFH", "Beltone Holding S.A.E"),
    ("SKPC", "Sidi Kerir Petrochemicals Co."),
    ("ISPH", "Ibnsina Pharma"),
    ("OCDI", "Sixth of October for Development and Investment Company \"SODIC\" (S.A.E.)"),
    ("MCQE", "Misr Cement (Qena) Company (S.A.E)"),
    ("ARCC", "Arabian Cement Company S.A.E."),
    ("EGAL", "Egypt Aluminum"),
    ("EGCH", "Egyptian Chemical Industries"),
    ("SUGR", "Delta Sugar Company"),
    ("POUL", "Cairo Poultry Company S.A.E."),
    ("EFIC", "Egyptian Financial and Industrial SAE"),
    ("CLHO", "Cleopatra Hospitals Group S.A.E."),
    ("RMDA", "Tenth of Ramadan for Pharmaceutical Industries and Diagnostic Reagents (Rameda) (S.A.E)"),
    ("IRON", "Egyptian Iron and Steel Company"),
    ("ALCN", "Alexandria Container&Cargo Handling Company"),
    ("EGTS", "Egyptian Resorts Company (S.A.E)"),
    ("PHAR", "Egyptian International Pharmaceutical Industries Company"),
    ("OLFI", "Obour Land for Food Industries S.A.E."),
    ("ACGC", "Arabia Cotton Ginning Company"),
    ("DSCW", "Dice For Ready-Made Garments (SAE)"),
    ("ORHD", "Orascom Development Egypt S.A.E."),
    ("PRDC", "Pioneers Properties For Urban Development - PRE Group"),
    ("ZMID", "Zahraa El Maadi Investment and Development Company SAE"),
    ("ATQA", "Misr National Steel - Ataqa"),
    ("SCEM", "Sinai Cement Co. (S.A.E)"),
    ("ARAB", "Arab Developers Holding"),
    ("ASCM", "ASEC Company for Mining ASCOM, S.A.E"),
    ("BINV", "B Investments Holding S.A.E."),
    ("CANA", "Suez Canal Bank (S.A.E)"),
    ("CIRA", "Cairo For Investment And Real Estate Developments-CIRA Education"),
    ("DOMT", "Arabian Food Industries Company (DOMTY) - S.A.E"),
    ("EGAS", "Egypt Gas Company SAE"),
    ("ELEC", "Electro Cable Egypt"),
    ("ENGC", "Industrial Engineering Company for Construction and Development (ICON) (S.A.E.)"),
    ("HDBK", "Housing and Development Bank- Egypt (S.A.E)"),
    ("ISMA", "Ismailia / Misr Poultry Company S.A.E"),
    ("KZPC", "Kafr El Zayat For Pesticides & Chemicals Co.(S.A.E)"),
    ("MASR", "Madinet Masr For Housing and Development"),
    ("MTIE", "MM Group for Industry and International Trade S.A.E."),
    ("NCCW", "Nasr Company for Civil Works"),
    ("OIH", "Orascom Investment Holding S.A.E."),
    ("RAYA", "Raya Holding Company for Financial Investments (S.A.E)"),
    ("SAUD", "alBaraka Bank Egypt S.A.E."),
    ("SPMD", "Speed Medical Co"),
    ("TALM", "Taaleem Management Services Company S.A.E."),
    ("CSAG", "Canal Shipping Agencies Company"),
    ("NIPH", "Nile Pharmaceuticals and Chemical Industries Company"),
    ("MPRC", "Egyptian Media Production City"),
    ("ACAMD", "Arab Co.,for asset management and development"),
    ("EXPA", "Export Development Bank of Egypt (S.A.E.)"),
    ("FAIT", "Faisal Islamic Bank of Egypt"),
    ("CAED", "Cairo Educational Services SAE"),
    ("GDWA", "Gadwa for Industrial Development"),
    ("RREI", "Arab Real Estate Investment Co."),
    ("SDTI", "SHARM DREAMS Co. for Touristic Investment S.A.E"),
    ("UEGC", "El-Saeed Company for Contracting and Real Estate Investment \"SCCD\" (S.A.E.)"),
    ("ELKA", "Cairo for Housing and Development Company (S.A.E)"),
    ("ICFC", "International Company for Fertilizers and Chemicals S.A.E"),
    ("IFAP", "International Company for Agricultural Crops"),
    ("KABO", "El-Nasr Clothing & Textiles Co. (KABO)"),
    ("MENA", "Mena for Touristic & Real Estate Investment"),
    ("MPCO", "Mansoura Poultry co.S.A.E"),
    ("NHPS", "National Company for Housing Professional Syndicates SAE"),
    ("AFDI", "Al Ahly for Development & Investment"),
    ("APSW", "Unirab Polvara Spinning & Weaving Co."),
    ("AJWA", "AJWA For Food Industries Co. Egypt"),
    ("AIFI", "Atlas for Investment & Food Industries SAE"),
    ("ALUM", "Arab Aluminum Company (S.A.E)"),
    ("BIOC", "GlaxoSmithKline S.A.E"),
    ("CERA", "The Arab Ceramic Co."),
    ("COPR", "Copper for Commercial Investment & Real Estate Development"),
    ("DAPH", "Development & Engineering Consultants"),
    ("EALR", "Arab Company For Land Reclamation"),
    ("ECAP", "Al Ezz Ceramics & Porcelain Co."),
    ("EOSB", "El Orouba Securities Brokerage"),
    ("GGCC", "Giza General - Contracting and Real Estate Investment S.A.E"),
    ("GRCA", "Grand Capital for Financial Investments"),
    ("INFI", "Ismailia National Co. for Food Industries"),
    ("LCSW", "Lecico Egypt (S.A.E.)"),
    ("MAAL", "Marseille Almasreia Alkhalegeya For Holding Investment SAE"),
    ("MICH", "Misr Chemical Industries Co."),
    ("MILS", "North Cairo Flour Mills"),
    ("MOSC", "Misr Oils & Soap"),
    ("NINH", "Nozha International Hospital"),
    ("OCPH", "October Pharma S.A.E"),
    ("ODIN", "ODIN Investments (S.A.E)"),
    ("PRCL", "The General Company for Ceramic and Porcelain Products"),
    ("RTVC", "Remco Tourism Villages Construction"),
    ("SMFR", "Samad Misr EGYFERT.S.A.E"),
    ("SNFC", "Sharkia National Company for Food Security"),
    ("SPIN", "Alexandria Spinning & Weaving Co."),
    ("WCDF", "Middle & West Delta Flour Mills"),
    ("ZEOT", "Extracted Oil & Derivatives Co."),
    ("AMER", "Amer Group Holding Company S.A.E."),
    ("EPCO", "Egypt for Poultry"),
    ("EDFM", "East Delta Flour Mills"),
    ("GPPL", "Golden Pyramids Plaza S.A.E."),
    ("CPCI", "Kahira Pharmaceuticals & Chemical Industries Company"),
    ("DEIN", "Delta Insurance Company"),
    ("EBSC", "Osool ESB Securities Brokerage"),
    ("EGSA", "The Egyptian Satellite Company Nilesat"),
    ("ELSH", "Al-Shams Company for Housing and Urban Development"),
    ("IDRE", "Ismailia Development and Real Estate Co"),
    ("MHOT", "Misr Hotels Company"),
    ("MOIL", "Maridive and Oil Services S.A.E."),
    ("NAHO", "Naeem Holding Company For Investments (S.A.E - Free Zone)"),
    ("RACC", "Raya Customer Experience"),
    ("SEIG", "Saudi Egyptian Investment & Finance Co. S.A.E"),
    ("UNIP", "Universal For Paper and Packaging Materials"),
    ("AXPH", "Alexandria Co. For Pharmaceuticals & Chemical Industries"),
    ("AMIA", "Arab Moltaqa Investments Company"),
    ("ELWA", "El Wadi for International and Investment Development SAE"),
    ("EASB", "Egyptian Arabian Company (Themar) for securities Brokerage EAC"),
    ("EHDR", "Egyptians for Housing & Development Co."),
    ("CICH", "CI Capital Holding For Financial Investments (S.A.E)"),
    ("TRTO", "Trans Oceans Tours"),
    ("SPHT", "El Shams Pyramids Co. For Hotels & Touristic Projects S.A.E"),
    ("NEDA", "Northern Upper Egypt For Development & Agricultural Production Co."),
    ("RUBX", "Rubex International for Plastic and Acrylic Manufacturing"),
    ("MEPA", "Medical Packaging Company"),
    ("ICID", "International Co. For Investment & Development"),
    ("MBSC", "Misr Beni Suef Cement Co. S.A.E"),
    ("OFH", "O B Financial Holding S.A.E"),
    ("CNFN", "Contact Financial Holding S.A.E."),
    ("SVCE", "South Valley Cement Company")
]


# ---------------------------------------------------------------- market lists (TradingView scanner)
TV_SECTOR_AR = {
    "Finance": "المالية والبنوك", "Technology Services": "خدمات التقنية", "Electronic Technology": "التقنية الإلكترونية",
    "Health Technology": "تقنية الرعاية الصحية", "Health Services": "خدمات الرعاية الصحية", "Retail Trade": "تجارة التجزئة",
    "Consumer Non-Durables": "السلع الاستهلاكية", "Consumer Durables": "السلع المعمّرة", "Consumer Services": "الخدمات الاستهلاكية",
    "Producer Manufacturing": "الصناعات التحويلية", "Process Industries": "الصناعات الأساسية", "Non-Energy Minerals": "المواد والتعدين",
    "Energy Minerals": "الطاقة", "Utilities": "المرافق العامة", "Transportation": "النقل", "Communications": "الاتصالات",
    "Commercial Services": "الخدمات التجارية", "Distribution Services": "التوزيع", "Industrial Services": "الخدمات الصناعية",
    "Miscellaneous": "متنوع", "Government": "حكومي",
}
TV_MARKET_OF = {"SR": "ksa", "CA": "egypt", "US": "america"}


def tv_scan(market, body, timeout=25):
    req = urllib.request.Request("https://scanner.tradingview.com/%s/scan" % market, data=json.dumps(body).encode("utf-8"),
                                 headers={"User-Agent": UA, "Content-Type": "application/json",
                                          "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def sa_segment(code):
    """Tadawul codes: 9xxx = Nomu (parallel market); 4330-4349 = REIT funds; everything else = main market."""
    c = str(code).split(".")[0]
    if not c.isdigit():
        return ""
    n = int(c)
    if 9000 <= n <= 9999:
        return "nomu"
    if 4330 <= n <= 4349:
        return "reit"
    return "main"


def sa_names():
    """Arabic company names and Tadawul sectors from Mubasher, kept for a week."""
    hit, _ = cache_get("sa|names", max_age=7 * 86400)
    if hit:
        return hit
    try:
        d = json.loads(http_text("https://www.mubasher.info/api/1/listed-companies?country=sa&size=1000"))
        out = {str(r.get("symbol")): [r.get("name") or "", r.get("sector") or ""] for r in d.get("rows") or [] if r.get("symbol")}
        if out:
            cache_put("sa|names", out)
        return out
    except Exception:
        stale, _ = cache_get("sa|names")
        return stale or {}


US_EXCH = {}  # ticker -> TradingView exchange, filled from the US list


def tv_universe(ex, size=None):
    market = TV_MARKET_OF[ex]
    filt = [{"left": "type", "operation": "equal", "right": "stock"},
            {"left": "is_primary", "operation": "equal", "right": True}]
    if ex == "US":
        filt += [{"left": "exchange", "operation": "in_range", "right": ["NASDAQ", "NYSE", "AMEX"]},
                 {"left": "subtype", "operation": "in_range", "right": ["common", "foreign-issuer"]}]
    body = {"filter": filt, "columns": ["name", "description", "market_cap_basic", "sector", "change", "close", "exchange"],
            "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}, "range": [0, size or 1500]}
    d = tv_scan(market, body)
    names = sa_names() if ex == "SR" else {}
    egx = dict(EGX_LIST) if ex == "CA" else {}
    items = []
    for row in d.get("data") or []:
        v = row.get("d") or []
        if len(v) < 7 or not v[0]:
            continue
        code = str(v[0])
        ar = names.get(code) or ["", ""]
        it = {"symbol": code + {"SR": ".SR", "CA": ".CA"}.get(ex, ""), "name": ar[0] or egx.get(code) or v[1] or code,
              "short": ar[0] or "", "price": v[5], "chg": v[4], "cap": v[2], "pe": None, "dy": None, "chg52": None,
              "sector": ar[1] or TV_SECTOR_AR.get(v[3] or "", v[3] or "")}
        if ex == "SR":
            it["segment"] = sa_segment(code)
        if ex == "US":
            it["exch"] = v[6] or ""
            US_EXCH[code] = it["exch"]
        items.append(it)
    return items


def get_universe(ex, size=None):
    if ex in TV_MARKET_OF:
        key = "tvu|%s|%s" % (ex, size or "all")
        cached, _ = cache_get(key, max_age=900)
        if cached:
            for it in cached["items"] if ex == "US" else []:
                US_EXCH.setdefault(it["symbol"], it.get("exch") or "")
            return cached
        try:
            items = tv_universe(ex, size)
            if items:
                out = {"ok": True, "ex": ex, "items": items, "at": time.time(), "source": "TradingView"}
                cache_put(key, out)
                return out
        except Exception as e:
            log(" TradingView market list failed (%s)" % e)
        if ex == "US":
            stale, _ = cache_get(key)
            return stale or {"ok": False, "error": "تعذّر جلب قائمة الشركات الأمريكية من TradingView."}
    return get_universe_yahoo(ex)


def get_universe_yahoo(ex):
    if ex == "CA":
        return {"ok": True, "ex": ex, "at": time.time(),
                "items": [{"symbol": sym + ".CA", "name": name or sym, "short": "", "price": None, "chg": None,
                           "cap": None, "pe": None, "dy": None, "chg52": None} for sym, name in EGX_LIST]}
    if ex not in SCREENER_EXCH:
        return {"ok": False, "error": "ماسح السوق متاح للسوق السعودي والمصري والأمريكي."}
    key = "u|" + ex
    cached, _ = cache_get(key, max_age=3 * 86400)
    if cached:
        return cached

    def page(crumb, offset):
        body = json.dumps({"offset": offset, "size": 250, "sortField": "intradaymarketcap", "sortType": "DESC",
                           "quoteType": "EQUITY", "userId": "", "userIdType": "guid",
                           "query": {"operator": "AND", "operands": [
                               {"operator": "eq", "operands": ["exchange", SCREENER_EXCH[ex]]}]}}).encode()
        url = ("https://query1.finance.yahoo.com/v1/finance/screener?crumb=%s&formatted=false&lang=en-US&region=US"
               % urllib.parse.quote(crumb))
        return json.loads(Yahoo.get(url, data=body, headers={"Content-Type": "application/json"}).decode("utf-8"))

    items = []
    try:
        offset, total = 0, 1
        while offset < total and offset < 1500:
            r = Yahoo.with_crumb(lambda c: page(c, offset))
            res = ((r.get("finance") or {}).get("result") or [{}])[0]
            total = res.get("total") or 0
            quotes = res.get("quotes") or []
            if not quotes:
                break
            for q in quotes:
                items.append({"symbol": q.get("symbol"), "name": q.get("longName") or q.get("shortName") or q.get("symbol"),
                              "short": q.get("shortName") or "", "price": q.get("regularMarketPrice"),
                              "chg": q.get("regularMarketChangePercent"), "cap": q.get("marketCap"),
                              "pe": q.get("trailingPE"), "dy": q.get("dividendYield"),
                              "chg52": q.get("fiftyTwoWeekChangePercent"),
                              "segment": sa_segment((q.get("symbol") or "").split(".")[0])})
            offset += len(quotes)
    except Exception:
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب قائمة شركات السوق. تحقق من الاتصال."}
    out = {"ok": True, "ex": ex, "items": [i for i in items if i["symbol"]], "at": time.time()}
    cache_put(key, out)
    return out


SECTOR_FILE = os.path.join(DATA_DIR, "sectors.json")
SECTOR_LOCK = threading.Lock()


def get_sectors(symbols, budget_s=25):
    with SECTOR_LOCK:
        try:
            with open(SECTOR_FILE, encoding="utf-8") as f:
                known = json.load(f)
        except (OSError, ValueError):
            known = {}
    t0 = time.time()
    changed = False
    for s in symbols:
        if s in known or time.time() - t0 > budget_s:
            continue
        p = get_profile(s)
        known[s] = p.get("sector") or "" if p.get("ok") else ""
        changed = True
    if changed:
        with SECTOR_LOCK:
            with open(SECTOR_FILE, "w", encoding="utf-8") as f:
                json.dump(known, f, ensure_ascii=False)
    missing = [s for s in symbols if s not in known]
    return {"ok": True, "sectors": {s: known.get(s, "") for s in symbols if s in known}, "missing": len(missing)}


def get_index(ex, rng):
    """Market benchmark. Yahoo carries no history for TASI / EGX30, so for those markets a
    cap-weighted index of the 15 largest listed companies is computed instead."""
    if ex == "GOLD":
        r = get_history("DX-Y.NYB", "XX", rng)
        if r.get("ok"):
            r = dict(r, label="مؤشر الدولار")
        return r
    sym = EXCHANGES.get(ex, (None, None, None))[2]
    if not sym:
        return {"ok": False, "error": "لا يوجد مؤشر مرجعي لهذا السوق."}
    r = get_history(sym, "XX", rng)
    if r.get("ok") and len(r.get("rows") or []) >= 30:
        return dict(r, label={"US": "مؤشر إس آند بي 500", "SR": "مؤشر تاسي", "CA": "مؤشر إي جي إكس 30"}.get(ex, sym))
    key = "ci|%s|%s" % (ex, rng)
    cached, _ = cache_get(key, max_age=1800)
    if cached:
        return cached
    u = get_universe(ex)
    if not u.get("ok"):
        return {"ok": False, "error": "تعذّر حساب مؤشر السوق."}
    capped = [i for i in u["items"] if i.get("cap")]
    top = sorted(capped, key=lambda i: -i["cap"])[:15] if len(capped) >= 15 else u["items"][:15]
    series = []
    for it in top:
        h = get_history(it["symbol"], "XX", rng)
        if h.get("ok") and len(h["rows"]) >= 60:
            series.append((it.get("cap") or 1.0, {r_[0]: r_[4] for r_ in h["rows"]}))
    if len(series) < 5:
        return {"ok": False, "error": "تعذّر حساب مؤشر السوق."}
    days = sorted(set().union(*[set(m_.keys()) for _, m_ in series]))
    last = [None] * len(series)
    base = [None] * len(series)
    tot = sum(c for c, _ in series)
    rows = []
    for d in days:
        val = 0.0
        ok = True
        for k, (cap, m_) in enumerate(series):
            if d in m_:
                last[k] = m_[d]
                if base[k] is None:
                    base[k] = m_[d]
            if last[k] is None:
                ok = False
                break
            val += cap / tot * last[k] / base[k]
        if ok:
            v = round(val * 1000, 3)
            rows.append([d, v, v, v, v, 0])
    out = {"ok": True, "source": "محسوب", "symbol": "TOP15", "rows": rows, "dividends": [], "splits": [],
           "label": "مؤشر أكبر 15 شركة"}
    cache_put(key, out)
    return out


def get_news(q, region):
    key = "n|%s|%s" % (region, q)
    cached, _ = cache_get(key, max_age=1800)
    if cached:
        return cached
    gl = {"SR": "SA", "CA": "EG"}.get(region, "SA")
    url = ("https://news.google.com/rss/search?q=%s&hl=ar&gl=%s&ceid=%s:ar"
           % (urllib.parse.quote(q), gl, gl))
    try:
        root = ET.fromstring(http_text(url).encode("utf-8"))
    except Exception:
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب الأخبار."}
    items = []
    for it in root.iter("item"):
        src = it.find("source")
        title = (it.findtext("title") or "").strip()
        source = src.text.strip() if src is not None and src.text else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        items.append({"title": title, "link": it.findtext("link") or "", "date": it.findtext("pubDate") or "",
                      "source": source})
        if len(items) >= 12:
            break
    out = {"ok": True, "items": items}
    cache_put(key, out)
    return out


# ================================================================ notifications
def notify_desktop(title, body):
    try:
        if sys.platform == "win32":
            ps = (
                "$ErrorActionPreference='Stop';"
                "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;"
                "$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("
                "[Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
                "$n=$x.GetElementsByTagName('text');"
                "$n.Item(0).AppendChild($x.CreateTextNode($env:SZ_TITLE))|Out-Null;"
                "$n.Item(1).AppendChild($x.CreateTextNode($env:SZ_BODY))|Out-Null;"
                "$id='{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';"
                "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show("
                "[Windows.UI.Notifications.ToastNotification]::new($x))"
            )
            env = dict(os.environ, SZ_TITLE=title, SZ_BODY=body)
            subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                             env=env, creationflags=0x08000000)
        elif sys.platform == "darwin":
            script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run'
            subprocess.Popen(["osascript", "-e", script, title, body])
        else:
            subprocess.Popen(["notify-send", title, body])
        return True
    except Exception:
        return False


def telegram_call(method, params=None, token=None):
    token = token or pref("telegram.token", "")
    if not token:
        raise ValueError("أدخل رمز بوت تيليجرام أولًا في الإعدادات.")
    url = "https://api.telegram.org/bot%s/%s" % (token.strip(), method)
    data = urllib.parse.urlencode(params or {}).encode() if params else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            desc = json.loads(e.read().decode("utf-8")).get("description", "")
        except Exception:
            desc = ""
        raise ValueError("رفض تيليجرام الطلب: %s" % (desc or e.code))


def telegram_send(text, token=None, chat=None):
    chat = chat or pref("telegram.chatId", "")
    if not chat:
        raise ValueError("أدخل معرّف المحادثة أو اضغط «اكتشاف المعرّف».")
    for i in range(0, len(text), 3900):
        telegram_call("sendMessage", {"chat_id": chat, "text": text[i:i + 3900],
                                      "disable_web_page_preview": "true"}, token)
    return True


def telegram_detect(token=None):
    r = telegram_call("getUpdates", None, token)
    chats = []
    for u in r.get("result") or []:
        m = u.get("message") or u.get("channel_post") or {}
        c = m.get("chat") or {}
        if c.get("id") is not None:
            chats.append({"id": c["id"], "name": c.get("title") or c.get("first_name") or c.get("username") or ""})
    if not chats:
        raise ValueError("لم أجد رسائل. أرسل أي رسالة للبوت من تيليجرام ثم أعد المحاولة.")
    return chats[-1]


# ================================================================ autostart, update, files
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
LAUNCH_AGENT = os.path.expanduser("~/Library/LaunchAgents/com.mhassoun.stockzones.plist")


def autostart_state():
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
                winreg.QueryValueEx(k, "StockZones")
                return True
        except OSError:
            return False
    if sys.platform == "darwin":
        return os.path.exists(LAUNCH_AGENT)
    return False


def autostart_set(enabled):
    if not FROZEN:
        raise ValueError("التشغيل مع بدء الجهاز متاح في النسخة المثبتة من البرنامج فقط.")
    exe = sys.executable
    if sys.platform == "win32":
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if enabled:
                winreg.SetValueEx(k, "StockZones", 0, winreg.REG_SZ, '"%s" --minimized' % exe)
            else:
                try:
                    winreg.DeleteValue(k, "StockZones")
                except OSError:
                    pass
    elif sys.platform == "darwin":
        if enabled:
            os.makedirs(os.path.dirname(LAUNCH_AGENT), exist_ok=True)
            plist = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
                     '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'
                     '<key>Label</key><string>com.mhassoun.stockzones</string>'
                     '<key>ProgramArguments</key><array><string>%s</string><string>--minimized</string></array>'
                     '<key>RunAtLoad</key><true/></dict></plist>\n' % exe)
            with open(LAUNCH_AGENT, "w", encoding="utf-8") as f:
                f.write(plist)
        elif os.path.exists(LAUNCH_AGENT):
            os.remove(LAUNCH_AGENT)
    else:
        raise ValueError("غير مدعوم على هذا النظام.")
    return autostart_state()


def version_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def check_update():
    repo = (pref("updateRepo", DEFAULT_UPDATE_REPO) or DEFAULT_UPDATE_REPO).strip()
    if repo == "mhassoun500/stock-zones":  # the program's old name
        repo = DEFAULT_UPDATE_REPO
    try:
        r = json.loads(urllib.request.urlopen(urllib.request.Request(
            "https://api.github.com/repos/%s/releases/latest" % repo,
            headers={"User-Agent": UA, "Accept": "application/vnd.github+json"}), timeout=15).read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"ok": False, "error": "لم أجد إصدارات منشورة في %s. يجب أن يكون المستودع عامًا ليعمل فحص التحديث." % repo}
        return {"ok": False, "error": "تعذّر فحص التحديثات (HTTP %s)." % e.code}
    except Exception:
        return {"ok": False, "error": "تعذّر فحص التحديثات. تحقق من الاتصال."}
    tag = r.get("tag_name") or ""
    assets = {a.get("name", ""): a.get("browser_download_url") for a in r.get("assets") or []}
    want = ".exe" if sys.platform == "win32" else (".dmg" if sys.platform == "darwin" else "")
    dl = ""
    for name, link in assets.items():
        if want and name.endswith(want) and ("intel" in name) == (sys.platform == "darwin" and os.uname().machine == "x86_64"):
            dl = link
    return {"ok": True, "current": VERSION, "latest": tag.lstrip("v"),
            "newer": version_tuple(tag) > version_tuple(VERSION), "url": dl or r.get("html_url"),
            "notes": (r.get("body") or "")[:800]}


def downloads_dir():
    d = os.path.join(os.path.expanduser("~"), "Downloads")
    return d if os.path.isdir(d) else os.path.expanduser("~")


def save_file(name, data_url=None, text=None):
    name = re.sub(r'[\\/:*?"<>|]+', "_", name or "file")[:120]
    path = os.path.join(downloads_dir(), name)
    base, ext = os.path.splitext(path)
    i = 1
    while os.path.exists(path):
        path = "%s (%d)%s" % (base, i, ext)
        i += 1
    if data_url:
        payload = data_url.split(",", 1)[1]
        with open(path, "wb") as f:
            f.write(base64.b64decode(payload))
    else:
        with open(path, "w", encoding="utf-8-sig") as f:
            f.write(text or "")
    return path


def reveal(path):
    if not os.path.exists(path):
        return
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path)])


# ================================================================ web server
SKELETON = ('<!doctype html><html lang="ar"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<link rel="icon" href="/icon.png">'
            '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
            '<script>window.LOCAL_API={version:"@VER@",frozen:@FROZEN@,platform:"@PLAT@"};'
            'document.documentElement.classList.add("local");</script>'
            '</head><body>')

LAST_PING = [time.time()]
WINDOW = [None]
QUIT = threading.Event()


def load_page():
    with open(os.path.join(resource_dir(), "page.html"), encoding="utf-8") as f:
        html = f.read()
    if os.path.exists(os.path.join(resource_dir(), "fonts", "fonts.css")):
        html = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]*">',
                      '<link rel="stylesheet" href="/fonts/fonts.css">', html)
        html = re.sub(r'<link rel="preconnect"[^>]*>\s*', "", html)
    head = SKELETON.replace("@VER@", VERSION).replace("@FROZEN@", "true" if FROZEN else "false").replace("@PLAT@", sys.platform)
    return head + html + "</body></html>"


STATIC_TYPES = {".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png"}


class Handler(BaseHTTPRequestHandler):
    page = None
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype, cache=False):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj):
        self._send(200, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except ValueError:
            return {}

    # ------------------------------------------------------------ GET
    def do_GET(self):
        LAST_PING[0] = time.time()
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        p = url.path
        try:
            if p in ("/", "/index.html"):
                if Handler.page is None or VERSION == "dev":
                    Handler.page = load_page()
                return self._send(200, Handler.page, "text/html; charset=utf-8")
            if p == "/icon.png" or p.startswith("/fonts/"):
                rel = "icon.png" if p == "/icon.png" else p.lstrip("/")
                full = os.path.normpath(os.path.join(resource_dir(), rel))
                if not full.startswith(os.path.normpath(resource_dir())) or not os.path.isfile(full):
                    return self._send(404, "", "text/plain")
                with open(full, "rb") as f:
                    return self._send(200, f.read(), STATIC_TYPES.get(os.path.splitext(full)[1], "application/octet-stream"), True)
            if p == "/api/ping":
                return self._json({"ok": True, "version": VERSION})
            if p == "/api/history":
                code = q.get("code", "").strip()
                if not code:
                    return self._json({"ok": False, "error": "اكتب رمز السهم أولًا."})
                log("  fetch %-16s %-5s %s %s" % (code, q.get("ex", "SR"), q.get("range", "2y"), q.get("interval", "1d")))
                return self._json(get_history(code, q.get("ex", "SR"), q.get("range", "2y"), q.get("interval", "1d"),
                                              q.get("lite") == "1"))
            if p == "/api/index":
                return self._json(get_index(q.get("ex", "SR"), q.get("range", "2y")))
            if p == "/api/search":
                return self._json({"ok": True, "items": search_yahoo(q.get("q", ""), q.get("ex", "XX"))})
            if p == "/api/profile":
                return self._json(get_profile(q.get("symbol", "")))
            if p == "/api/news":
                return self._json(get_news(q.get("q", ""), q.get("region", "SR")))
            if p == "/api/funds":
                return self._json(get_funds())
            if p == "/api/universe":
                size = int(q["size"]) if q.get("size", "").isdigit() else None
                return self._json(get_universe(q.get("ex", "SR"), size))
            if p == "/api/store":
                return self._json({"ok": True, "value": Store.get(q.get("key", ""))})
            if p == "/api/autostart":
                return self._json({"ok": True, "enabled": autostart_state(), "available": FROZEN})
            if p == "/api/tvaccount":
                return self._json(tv_account_status())
            if p == "/api/update":
                return self._json(check_update())
            if p == "/api/open":
                u = q.get("url", "")
                if re.match(r"^https?://", u):
                    webbrowser.open(u)
                return self._json({"ok": True})
            if p == "/api/reveal":
                reveal(q.get("path", ""))
                return self._json({"ok": True})
            if p == "/api/quit":
                self._json({"ok": True})
                threading.Timer(0.3, shutdown_app).start()
                return
            return self._send(404, "not found", "text/plain; charset=utf-8")
        except Exception as e:  # never crash the server thread
            return self._json({"ok": False, "error": str(e)})

    # ------------------------------------------------------------ POST
    def do_POST(self):
        LAST_PING[0] = time.time()
        p = urllib.parse.urlparse(self.path).path
        b = self._body()
        try:
            if p == "/api/store":
                Store.set(str(b.get("key", "")), b.get("value"))
                return self._json({"ok": True})
            if p == "/api/fundimport":
                fid = int(b.get("id"))
                pts = [[int(r[0]), float(r[1])] for r in (b.get("rows") or []) if r and r[1]]
                snap_add({fid: pts})
                with MEM_LOCK:
                    for k in [k for k in MEM if k.startswith("h|FUND|%d|" % fid)]:
                        del MEM[k]
                return self._json({"ok": True, "added": len(pts)})
            if p == "/api/sectors":
                return self._json(get_sectors([s for s in (b.get("symbols") or []) if isinstance(s, str)][:600]))
            if p == "/api/notify":
                res = {"ok": True, "desktop": False, "telegram": None}
                if b.get("desktop", True):
                    res["desktop"] = notify_desktop(b.get("title", APP_TITLE), b.get("body", ""))
                if b.get("telegram") and pref("telegram.enabled", False):
                    try:
                        telegram_send(b.get("text") or ("%s\n%s" % (b.get("title", ""), b.get("body", ""))))
                        res["telegram"] = True
                    except Exception as e:
                        res["telegram"] = str(e)
                return self._json(res)
            if p == "/api/telegram":
                act = b.get("action")
                if act == "detect":
                    return self._json({"ok": True, "chat": telegram_detect(b.get("token"))})
                if act == "test":
                    telegram_send("✅ تم ربط Mo Stocks بتيليجرام بنجاح.", b.get("token"), b.get("chatId"))
                    return self._json({"ok": True})
                return self._json({"ok": False, "error": "إجراء غير معروف."})
            if p == "/api/autostart":
                return self._json({"ok": True, "enabled": autostart_set(bool(b.get("enabled")))})
            if p == "/api/tvaccount":
                return self._json(tv_account_action(b))
            if p == "/api/save":
                path = save_file(b.get("filename"), b.get("dataUrl"), b.get("text"))
                return self._json({"ok": True, "path": path})
            return self._send(404, "not found", "text/plain; charset=utf-8")
        except Exception as e:
            return self._json({"ok": False, "error": str(e)})


# ================================================================ TradingView account
TVLOGIN = {"state": "idle", "message": ""}


def clear_history_cache():
    with MEM_LOCK:
        for k in [k for k in MEM if k.startswith("h|")]:
            del MEM[k]
    with LQ_LOCK:
        LQ.clear()


def tv_account_status():
    st = ACCOUNT.status()
    st.update(ok=True, feed=tvdata.CLIENT.available(), windowLogin=WINDOW[0] is not None,
              source=pref("dataSource", "tv"), login=dict(TVLOGIN))
    return st


def tv_login_window():
    """Open TradingView's own sign-in page in an app window; keep only the session cookie."""
    import webview  # pywebview

    if TVLOGIN.get("state") == "waiting" and TVLOGIN.get("win"):
        return
    win = webview.create_window("تسجيل الدخول إلى TradingView", tvdata.SIGNIN_URL, width=520, height=780)
    TVLOGIN.clear()
    TVLOGIN.update(state="waiting", message="سجّل الدخول في النافذة المفتوحة.", win=True)
    closed = threading.Event()
    try:
        win.events.closed += lambda: closed.set()
    except Exception:
        pass

    def poll():
        tried = None
        deadline = time.time() + 20 * 60
        while time.time() < deadline and not closed.is_set() and not QUIT.is_set():
            closed.wait(2)
            try:
                jar = win.get_cookies() or []
            except Exception:
                continue
            found = {}
            for c in jar:
                try:
                    for k, morsel in c.items():
                        if k in ("sessionid", "sessionid_sign") and morsel.value:
                            found[k] = morsel.value
                except Exception:
                    continue
            if not found.get("sessionid") or found == tried:
                continue
            tried = dict(found)
            res = ACCOUNT.save(found)
            if res.get("ok"):
                clear_history_cache()
                TVLOGIN.update(state="done", message="تم ربط حساب TradingView: %s" % (res.get("username") or ""), win=False)
                try:
                    win.destroy()
                except Exception:
                    pass
                return
        if TVLOGIN.get("state") == "waiting":
            TVLOGIN.update(state="closed", message="أُغلقت نافذة الدخول قبل اكتماله.", win=False)

    threading.Thread(target=poll, daemon=True).start()


def tv_account_action(b):
    act = b.get("action")
    if act == "window":
        if WINDOW[0] is None:
            return {"ok": False, "error": "نافذة الدخول متاحة في البرنامج المثبت فقط. استخدم الإدخال اليدوي."}
        tv_login_window()
        return {"ok": True}
    if act == "cookie":
        res = ACCOUNT.save({"sessionid": b.get("sessionid") or "", "sessionid_sign": b.get("sessionid_sign") or ""})
        if res.get("ok"):
            clear_history_cache()
        return res
    if act == "logout":
        ACCOUNT.logout()
        tvdata.CLIENT.close()
        clear_history_cache()
        TVLOGIN.update(state="idle", message="", win=False)
        return {"ok": True}
    if act == "source":
        clear_history_cache()
        return {"ok": True}
    return {"ok": False, "error": "إجراء غير معروف."}


# ================================================================ app lifecycle
def fund_refresher():
    """Keep a daily record of every fund's price while the app runs (fills Mubasher's gaps)."""
    while not QUIT.is_set():
        try:
            get_funds(force=True)
        except Exception:
            pass
        QUIT.wait(6 * 3600)


def start_server():
    for port in [PREFERRED_PORT] + list(range(PREFERRED_PORT + 1, PREFERRED_PORT + 30)):
        try:
            srv = ThreadingHTTPServer((HOST, port), Handler)
            break
        except OSError:
            continue
    else:
        raise SystemExit("No free port found.")
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=fund_refresher, daemon=True).start()
    return srv, "http://%s:%d/" % (HOST, srv.server_address[1])


def shutdown_app():
    QUIT.set()
    w = WINDOW[0]
    if w is not None:
        try:
            w.destroy()  # on_closing lets it through because QUIT is set
        except Exception:
            pass
    else:
        os._exit(0)


def run_window(url, minimized):
    import webview  # pywebview

    win = webview.create_window(APP_TITLE, url, width=1400, height=920, min_size=(900, 640),
                                background_color="#eef1f3", text_select=True, minimized=minimized)
    WINDOW[0] = win

    def on_closing():
        if QUIT.is_set() or not pref("background", False):
            return True
        try:
            win.minimize()  # keep running so alerts and the morning report keep working
        except Exception:
            return True
        return False

    win.events.closing += on_closing
    webview.start(private_mode=False, storage_path=os.path.join(DATA_DIR, "webview"))


def run_browser(url):
    """Fallback: open the default browser and stop once the page has been closed for a while."""
    webbrowser.open(url)
    log(" Opened in your browser. This program stops ~2 minutes after the page is closed.")
    LAST_PING[0] = time.time()
    try:
        while not QUIT.is_set() and time.time() - LAST_PING[0] < 120:
            time.sleep(3)
    except KeyboardInterrupt:
        pass


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    srv, url = start_server()
    if FROZEN:
        try:  # keep "start with the computer" pointing at this copy (the program was renamed in 2.4)
            if autostart_state():
                autostart_set(True)
        except Exception:
            pass
    log("Mo Stocks v%s running at %s  (data: %s)" % (VERSION, url, DATA_DIR))
    if "--browser" in sys.argv:
        run_browser(url)
    else:
        try:
            run_window(url, "--minimized" in sys.argv)
        except Exception as e:
            log(" Native window unavailable (%s); using the browser instead." % e)
            run_browser(url)
    srv.shutdown()


if __name__ == "__main__":
    main()
