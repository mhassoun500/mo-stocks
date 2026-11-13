# -*- coding: utf-8 -*-
"""Price data: Yahoo Finance, Stooq, metals, TradingView history and today's live session, mutual fund prices."""
from core import *  # noqa: F401,F403
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
            warn(" TradingView metal fetch failed (%s); using Yahoo." % e)
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
AI = ai_providers.AIHub(DATA_DIR)


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
            warn(" TradingView failed for %s (%s); trying Yahoo." % (code, e))

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
        if not isinstance(e, NotFound):
            record("WARN", "history %s %s" % (ex, code), e)
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
