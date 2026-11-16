# -*- coding: utf-8 -*-
"""Connector framework: one small class per data source with a common interface, a request throttle,
retries with growing delays, and a registry that tries the sources of each data kind in order."""
import collections
import json
import socket
import threading
import time
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
KINDS = ("history", "fundamentals", "news", "dividends", "sharia", "funds")
MARKETS = ("SR", "CA", "US")


class NoData(Exception):
    """The source answered, but has nothing for this symbol (not a failure of the source)."""


class SourcesFailed(Exception):
    """Every source of the kind failed or had nothing."""

    def __init__(self, msg, tried=None):
        Exception.__init__(self, msg)
        self.tried = tried or []


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
class Registry:
    def __init__(self):
        self.items = collections.OrderedDict()
        self.order = {}          # kind -> default list of connector ids, best first
        self.stats = {}
        self.lock = threading.Lock()

    def register(self, conn):
        self.items[conn.id] = conn
        self.stats.setdefault(conn.id, {"calls": 0, "ok": 0, "fail": 0, "nodata": 0, "ms": 0.0, "lastOk": 0,
                                         "lastFail": 0, "lastError": ""})
        return conn

    def set_order(self, kind, ids):
        self.order[kind] = list(ids)

    def get(self, cid):
        return self.items.get(cid)

    def ids(self, kind, market):
        ids = list(self.order.get(kind, []))
        hook = ORDER_HOOKS.get(kind)
        return hook(ids, market) if hook else ids

    def chain(self, kind, market):
        out = []
        for cid in self.ids(kind, market):
            c = self.items.get(cid)
            if c and c.supports(kind, market) and c.available():
                out.append(c)
        return out

    def _count(self, cid, outcome, ms=0.0, err=""):
        with self.lock:
            s = self.stats[cid]
            s["calls"] += 1
            s[outcome] += 1
            if outcome == "ok":
                s["lastOk"] = time.time()
                s["ms"] = ms if not s["ms"] else s["ms"] * 0.8 + ms * 0.2
            elif outcome == "fail":
                s["lastFail"] = time.time()
                s["lastError"] = err[:200]

    def _attempt(self, c, kind, tried, kw):
        """Run one connector. Returns (value, None) on success, or (None, outcome) where outcome is 'nodata' or an exception."""
        t0 = time.time()
        try:
            v = c.run(kind, **kw)
            if not v:
                raise NoData()
        except NoData as e:
            self._count(c.id, "nodata")
            tried.append({"id": c.id, "name": c.name, "state": "nodata"})
            return None, e
        except Exception as e:
            self._count(c.id, "fail", err="%s: %s" % (type(e).__name__, e))
            tried.append({"id": c.id, "name": c.name, "state": "fail", "error": str(e)[:160]})
            if not isinstance(e, RateLimited):
                try:
                    _core().record("WARN", "source %s %s" % (c.id, kind), e)
                except Exception:
                    pass
            return None, e
        self._count(c.id, "ok", (time.time() - t0) * 1000)
        tried.append({"id": c.id, "name": c.name, "state": "ok"})
        return v, None

    def call(self, kind, market, **kw):
        """Try the sources in order. Returns (value, meta); meta = {"id", "name", "label", "tried": [...]}.
        Raises NoData when nobody has the item, SourcesFailed when every source broke."""
        tried, nodata, first_err = [], [], None
        for c in self.chain(kind, market):
            v, err = self._attempt(c, kind, tried, kw)
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
        v, err = self._attempt(c, kind, tried, kw)
        if err is not None:
            raise err
        return v

    def status(self):
        out = []
        for cid, c in self.items.items():
            row = c.info()
            row.update({k: self.stats[cid][k] for k in ("calls", "ok", "fail", "nodata", "lastOk", "lastFail", "lastError")})
            row["ms"] = round(self.stats[cid]["ms"])
            out.append(row)
        return out


ORDER_HOOKS = {}   # kind -> fn(ids, market) -> ids, for rules that depend on the user's settings
REG = Registry()
