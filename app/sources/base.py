# -*- coding: utf-8 -*-
"""Connector framework: one small class per data source with a common interface, a request throttle,
retries with growing delays, and a registry that tries the sources of each data kind in order."""
import collections
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
KINDS = ("history", "fundamentals", "news", "dividends", "sharia", "funds", "filings")
MARKETS = ("SR", "CA", "US")


class NoData(Exception):
    """The source answered, but has nothing for this symbol (not a failure of the source)."""


class SourcesFailed(Exception):
    """Every source of the kind failed or had nothing."""

    def __init__(self, msg, tried=None):
        Exception.__init__(self, msg)
        self.tried = tried or []


class FormatChanged(Exception):
    """A source answered, but the page or file no longer looks the way the reader expects (the site changed its layout)."""


def format_changed(source, why, sample=""):
    """Log the problem once a minute with the start of the response, and return the exception to raise."""
    sample = " ".join(str(sample or "").split())[:400]
    msg = "%s: %s" % (source, why)
    try:
        _core().record("WARN", "format." + source, msg + (" | sample: " + sample if sample else ""))
    except Exception:
        pass
    return FormatChanged("تغيّر شكل صفحة المصدر (%s)." % source)


class AuthError(Exception):
    """The source refused the key."""


class RateLimited(Exception):
    """The request limit of this source is used up for now; skip it instead of making the user wait."""


def _core():
    import core  # imported late: core is loaded before the connectors are used
    return core


def sleep(sec):  # replaced in tests
    time.sleep(sec)


# ---------------------------------------------------------------- http
def http_get(url, headers=None, timeout=20, data=None):
    h = {"User-Agent": UA, "Accept": "application/json,text/*;q=0.9,*/*;q=0.5"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def http_json(url, headers=None, timeout=20):
    return json.loads(http_get(url, headers, timeout).decode("utf-8", errors="replace"))


def is_transient(e):
    if isinstance(e, urllib.error.HTTPError):
        return e.code in (408, 425, 429, 500, 502, 503, 504)
    return isinstance(e, (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError))


def retry_after(e):
    try:
        v = e.headers.get("Retry-After") if isinstance(e, urllib.error.HTTPError) else None
        return min(float(v), 8.0) if v else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- throttle
class Throttle:
    """At most `per_min` calls a minute and `gap` seconds between two calls, so a source is never hammered."""

    def __init__(self, per_min=0, gap=0.0, max_wait=3.0):
        self.per_min, self.gap, self.max_wait = per_min, gap, max_wait
        self.lock = threading.Lock()
        self.stamps = collections.deque()
        self.last = 0.0

    def wait(self):
        while True:
            with self.lock:
                now = time.time()
                while self.stamps and now - self.stamps[0] > 60:
                    self.stamps.popleft()
                need = 0.0
                if self.gap and self.last:
                    need = max(need, self.last + self.gap - now)
                if self.per_min and len(self.stamps) >= self.per_min:
                    need = max(need, self.stamps[0] + 60 - now)
                if need <= 0:
                    self.stamps.append(now)
                    self.last = now
                    return
                if need > self.max_wait:
                    raise RateLimited("request limit reached, try again in %d s" % need)
            sleep(need)


# ---------------------------------------------------------------- connector
class Connector:
    """Base class. A connector sets `kinds` and implements one method per kind, named like the kind:
    history(code, ex, rng, interval, lite), fundamentals(code, ex), news(q, region), dividends(code, ex, rng)..."""
    id = ""
    name = ""
    kinds = ()
    markets = MARKETS
    key_service = None     # set for sources that need the user's own API key (optional, from the settings)
    keys_url = ""
    official = False
    free = True
    gap = 0.0              # minimum seconds between two requests
    per_min = 0            # maximum requests a minute (0 = unlimited)
    retries = 1            # extra attempts after a transient failure
    retry_delay = 0.6
    note = ""
    label = ""             # the name shown as the data's source, when it differs from `name`

    def __init__(self):
        self.throttle = Throttle(self.per_min, self.gap)

    # -- key
    def key_path(self):
        return _core().os.path.join(_core().DATA_DIR, "src_%s.bin" % self.id)

    def key(self):
        if not self.key_service:
            return ""
        try:
            return _core().tvdata.secret_load(self.key_path(), "StockZones Source " + self.id) or ""
        except Exception:
            return ""

    def save_key(self, key):
        _core().tvdata.secret_save(self.key_path(), key.strip(), "StockZones Source " + self.id)

    def delete_key(self):
        _core().tvdata.secret_delete(self.key_path(), "StockZones Source " + self.id)

    # -- availability
    def enabled(self):
        try:
            return self.id not in (_core().Store.get("src_off", []) or [])
        except Exception:
            return True

    def ready(self):
        """Has what it needs to run (a key, an account...)."""
        return (not self.key_service) or bool(self.key())

    def available(self):
        return self.enabled() and self.ready()

    def supports(self, kind, market):
        return kind in self.kinds and (market in self.markets or market == "*")

    def info(self):
        return {"id": self.id, "name": self.name, "kinds": list(self.kinds), "markets": list(self.markets),
                "needsKey": bool(self.key_service), "hasKey": bool(self.key()) if self.key_service else False,
                "keysUrl": self.keys_url, "official": self.official, "free": self.free, "enabled": self.enabled(),
                "ready": self.ready(), "note": self.note}

    # -- running
    def run(self, kind, **kw):
        fn = getattr(self, kind)
        last = None
        for attempt in range(self.retries + 1):
            self.throttle.wait()
            try:
                return fn(**kw)
            except NoData:
                raise
            except Exception as e:
                last = e
                if not is_transient(e) or attempt >= self.retries:
                    raise
                sleep(retry_after(e) or min(self.retry_delay * (2 ** attempt), 4.0))
        raise last


# ---------------------------------------------------------------- registry
RECENT = 30          # outcomes kept per source / kind / market
MIN_SAMPLES = 8      # fewer outcomes than this and the default order is kept
COOLDOWN = 600       # seconds a source with 3 failures in a row goes to the back of the line
SAVE_EVERY = 20


def _blank():
    return {"recent": [], "stale": [], "ms": 0.0, "ok": 0, "fail": 0, "nodata": 0, "streak": 0, "lastOk": 0,
            "lastFail": 0, "lastError": "", "agree": 0, "disagree": 0}


def is_stale(res):
    """True when the newest daily bar is more than five days old (a long weekend or holiday stays under that)."""
    try:
        if res.get("interval", "1d") != "1d" or res.get("offline"):
            return None
        return time.time() - res["rows"][-1][0] / 1000.0 > 5 * 86400
    except Exception:
        return None


class Registry:
    def __init__(self):
        self.items = collections.OrderedDict()
        self.order = {}          # kind -> default list of connector ids, best first
        self.stats = {}          # connector id -> totals over all kinds and markets
        self.detail = {}         # (kind, market, id) -> learning record
        self.lock = threading.Lock()
        self.dirty = False
        self.last_save = 0.0
        self.loaded = False
        self.path = None         # where the learning record is kept (set by the app)

    # -- registration and order
    def register(self, conn):
        self.items[conn.id] = conn
        self.stats.setdefault(conn.id, {"calls": 0, "ok": 0, "fail": 0, "nodata": 0, "ms": 0.0, "lastOk": 0,
                                         "lastFail": 0, "lastError": ""})
        return conn

    def set_order(self, kind, ids):
        self.order[kind] = list(ids)

    def get(self, cid):
        return self.items.get(cid)

    def auto(self):
        try:
            return bool(_core().Store.get("src_auto", True))
        except Exception:
            return True

    def d(self, kind, market, cid):
        return self.detail.setdefault((kind, market, cid), _blank())

    def score(self, kind, market, cid):
        """0-100 from the recent record of the source for this market, or None while there is too little of it."""
        r = self.detail.get((kind, market, cid))
        if not r or len(r["recent"]) < MIN_SAMPLES:
            return None
        pts = 100.0 * sum(r["recent"]) / len(r["recent"])
        pts -= min(r["ms"] / 200.0, 15.0)                      # slowness, up to 15 points
        if len(r["stale"]) >= 5:
            pts -= 20.0 * sum(r["stale"]) / len(r["stale"])    # data that comes late
        votes = r["agree"] + r["disagree"]
        if votes >= 5:
            pts -= 30.0 * r["disagree"] / votes                # disagrees with the other sources
        return pts

    def rank(self, kind, market, ids):
        """Reorder by the learned record. Buckets of ten points keep the default order unless a source is clearly worse."""
        now = time.time()
        keyed = []
        for i, cid in enumerate(ids):
            r = self.detail.get((kind, market, cid))
            cooling = bool(r and r["streak"] >= 3 and now - r["lastFail"] < COOLDOWN)
            sc = self.score(kind, market, cid)
            bucket = int((85.0 if sc is None else sc) // 10)
            keyed.append((cooling, -bucket, i, cid))
        return [k[3] for k in sorted(keyed)]

    def ids(self, kind, market):
        ids = list(self.order.get(kind, []))
        if self.auto() and market in MARKETS:
            ids = self.rank(kind, market, ids)
        hook = ORDER_HOOKS.get(kind)
        return hook(ids, market) if hook else ids

    def chain(self, kind, market):
        out = []
        for cid in self.ids(kind, market):
            c = self.items.get(cid)
            if c and c.supports(kind, market) and c.available():
                out.append(c)
        return out

    # -- recording
    def _count(self, cid, outcome, ms=0.0, err="", kind=None, market=None, stale=None):
        now = time.time()
        with self.lock:
            s = self.stats[cid]
            s["calls"] += 1
            s[outcome] += 1
            if outcome == "ok":
                s["lastOk"] = now
                s["ms"] = ms if not s["ms"] else s["ms"] * 0.8 + ms * 0.2
            elif outcome == "fail":
                s["lastFail"] = now
                s["lastError"] = err[:200]
            if kind:
                r = self.d(kind, market or "*", cid)
                r[outcome] += 1
                if outcome == "ok":
                    r["streak"] = 0
                    r["lastOk"] = now
                    r["ms"] = ms if not r["ms"] else r["ms"] * 0.8 + ms * 0.2
                    r["recent"] = (r["recent"] + [1])[-RECENT:]
                    if stale is not None:
                        r["stale"] = (r["stale"] + [1 if stale else 0])[-RECENT:]
                elif outcome == "fail":
                    r["streak"] += 1
                    r["lastFail"] = now
                    r["lastError"] = err[:200]
                    r["recent"] = (r["recent"] + [0])[-RECENT:]
            self.dirty = True
        self.maybe_save()

    def vote(self, kind, market, cid, agreed):
        with self.lock:
            r = self.d(kind, market, cid)
            r["agree" if agreed else "disagree"] += 1
            self.dirty = True

    # -- persistence of the learning record
    def load(self, path):
        self.path = path
        self.loaded = True
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return
        with self.lock:
            for key, r in (data.get("detail") or {}).items():
                parts = key.split("|")
                if len(parts) == 3 and parts[2] in self.items:
                    row = _blank()
                    row.update({k: r[k] for k in row if k in r})
                    self.detail[(parts[0], parts[1], parts[2])] = row
            for cid, r in (data.get("stats") or {}).items():
                if cid in self.stats:
                    self.stats[cid].update({k: r[k] for k in self.stats[cid] if k in r})

    def maybe_save(self, force=False):
        if not self.path or not self.dirty:
            return
        now = time.time()
        if not force and now - self.last_save < SAVE_EVERY:
            return
        with self.lock:
            data = {"detail": {"%s|%s|%s" % k: v for k, v in self.detail.items()}, "stats": self.stats}
            self.dirty = False
            self.last_save = now
            try:
                tmp = self.path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(data, f)
                os.replace(tmp, self.path)
            except OSError:
                pass

    def reset(self):
        with self.lock:
            self.detail.clear()
            for cid in self.stats:
                self.stats[cid] = {"calls": 0, "ok": 0, "fail": 0, "nodata": 0, "ms": 0.0, "lastOk": 0, "lastFail": 0,
                                   "lastError": ""}
            self.dirty = True
        self.maybe_save(True)

    # -- calling
    def _attempt(self, c, kind, tried, kw, market=None):
        """Run one connector. Returns (value, None) on success, or (None, outcome) where outcome is 'nodata' or an exception."""
        t0 = time.time()
        try:
            v = c.run(kind, **kw)
            if not v:
                raise NoData()
        except NoData as e:
            self._count(c.id, "nodata", kind=kind, market=market)
            tried.append({"id": c.id, "name": c.name, "state": "nodata"})
            return None, e
        except Exception as e:
            self._count(c.id, "fail", err="%s: %s" % (type(e).__name__, e), kind=kind, market=market)
            tried.append({"id": c.id, "name": c.name, "state": "fail", "error": str(e)[:160]})
            if not isinstance(e, RateLimited):
                try:
                    _core().record("WARN", "source %s %s" % (c.id, kind), e)
                except Exception:
                    pass
            return None, e
        self._count(c.id, "ok", (time.time() - t0) * 1000, kind=kind, market=market,
                    stale=is_stale(v) if kind == "history" and isinstance(v, dict) else None)
        tried.append({"id": c.id, "name": c.name, "state": "ok"})
        return v, None

    def call(self, kind, market, **kw):
        """Try the sources in order. Returns (value, meta); meta = {"id", "name", "label", "tried": [...]}.
        Raises NoData when nobody has the item, SourcesFailed when every source broke."""
        tried, nodata, first_err = [], [], None
        for c in self.chain(kind, market):
            v, err = self._attempt(c, kind, tried, kw, market)
            if err is None:
                return v, {"id": c.id, "name": c.name, "label": c.label or c.name, "tried": tried}
            if isinstance(err, NoData):
                if str(err):
                    nodata.append(str(err))
            elif first_err is None:
                first_err = err
        if any(t["state"] == "nodata" for t in tried):
            e = NoData(nodata[0] if nodata else "")
            e.tried = tried
            raise e
        raise SourcesFailed(str(first_err) if first_err else "no source available", tried)

    def call_one(self, cid, kind, **kw):
        """Run one named connector (for data sets where each source is its own list, not a fallback)."""
        c = self.items[cid]
        if not c.available():
            raise SourcesFailed("source %s is switched off" % cid)
        tried = []
        v, err = self._attempt(c, kind, tried, kw, "*")
        if err is not None:
            raise err
        return v

    # -- reporting
    def status(self):
        out = []
        for cid, c in self.items.items():
            row = c.info()
            row.update({k: self.stats[cid][k] for k in ("calls", "ok", "fail", "nodata", "lastOk", "lastFail", "lastError")})
            row["ms"] = round(self.stats[cid]["ms"])
            per = {}
            for (kind, market, i), r in self.detail.items():
                if i != cid or market not in MARKETS or not r["recent"]:
                    continue
                m = per.setdefault(market, {"n": 0, "good": 0, "ms": 0.0, "k": 0, "agree": 0, "disagree": 0, "streak": 0})
                m["n"] += len(r["recent"])
                m["good"] += sum(r["recent"])
                m["agree"] += r["agree"]
                m["disagree"] += r["disagree"]
                m["streak"] = max(m["streak"], r["streak"])
                if r["ms"]:
                    m["ms"] += r["ms"]
                    m["k"] += 1
            row["markets"] = {mk: {"rate": round(100.0 * v["good"] / v["n"]), "n": v["n"],
                                   "ms": round(v["ms"] / v["k"]) if v["k"] else 0, "streak": v["streak"],
                                   "agree": v["agree"], "disagree": v["disagree"]} for mk, v in per.items()}
            out.append(row)
        return out

    def ranking(self):
        """The order the app uses right now, per kind and market (only sources that are ready)."""
        out = {}
        for kind in self.order:
            out[kind] = {}
            for mk in MARKETS:
                ids = [c.id for c in self.chain(kind, mk)]
                if ids:
                    out[kind][mk] = ids
        return out


ORDER_HOOKS = {}   # kind -> fn(ids, market) -> ids, for rules that depend on the user's settings
REG = Registry()
