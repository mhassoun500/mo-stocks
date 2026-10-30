# -*- coding: utf-8 -*-
"""TradingView market data and account session.

Prices come over the same websocket the tradingview.com charts use. Without an account the
feed is TradingView's public one (Tadawul / EGX 15 minutes delayed). With the user's own
session, the data matches what their TradingView subscription shows (real time when they
pay for that exchange's data).

The session is never a password: TradingView's sign-in form requires a captcha, so the user
signs in on TradingView's own page (a window inside the app) and the app keeps only the
session cookie, encrypted with the operating system (Windows DPAPI / macOS Keychain).
"""
import base64
import calendar
import json
import os
import queue
import random
import re
import string
import subprocess
import sys
import threading
import time
import urllib.request

try:
    import websocket  # websocket-client
except Exception:  # pragma: no cover - optional dependency
    websocket = None

WS_URL = "wss://data.tradingview.com/socket.io/websocket?type=chart"
UNAUTH = "unauthorized_user_token"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
SIGNIN_URL = "https://www.tradingview.com/accounts/signin/"

# hours from UTC, enough to put each daily bar on its trading date
TZ_OFF = {"Asia/Riyadh": 3, "Africa/Cairo": 2, "America/New_York": -5, "America/Chicago": -6,
          "Etc/UTC": 0, "UTC": 0, "Europe/London": 0, "Asia/Dubai": 4, "Asia/Qatar": 3, "Asia/Kuwait": 3}


class TVError(Exception):
    pass


class TVNotFound(TVError):
    pass


class TVAuthError(TVError):
    pass


def _frame(obj):
    s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    return "~m~%d~m~%s" % (len(s), s)


def _msg(func, params):
    return _frame({"m": func, "p": params})


def _split(raw):
    return [p for p in re.split(r"~m~\d+~m~", raw or "") if p]


class TVClient:
    """One persistent websocket, used by one request at a time (each request ~0.3–0.8 s)."""

    def __init__(self):
        self.ws = None
        self.token = None
        self.last = 0.0
        self.lock = threading.Lock()

    @staticmethod
    def available():
        return websocket is not None

    def close(self):
        try:
            if self.ws is not None:
                self.ws.close()
        except Exception:
            pass
        self.ws = None

    def _connect(self, token):
        self.ws = websocket.create_connection(
            WS_URL, timeout=15,
            header=["Origin: https://www.tradingview.com", "User-Agent: " + UA])
        self.ws.send(_msg("set_auth_token", [token]))
        self.token = token

    def _run(self, symbol, res, n):
        ws = self.ws
        cs = "cs_" + "".join(random.choices(string.ascii_lowercase, k=12))
        ws.send(_msg("chart_create_session", [cs, ""]))
        ws.send(_msg("resolve_symbol", [cs, "sds_sym_1", '={"adjustment":"splits","symbol":%s}' % json.dumps(symbol)]))
        ws.send(_msg("create_series", [cs, "sds_1", "s1", "sds_sym_1", res, int(n), ""]))
        info, bars = None, {}
        deadline = time.time() + 25
        try:
            while time.time() < deadline:
                raw = ws.recv()
                if not raw:
                    raise TVError("closed")
                for p in _split(raw):
                    if p.startswith("~h~"):
                        ws.send("~m~%d~m~%s" % (len(p), p))
                        continue
                    try:
                        j = json.loads(p)
                    except ValueError:
                        continue
                    m, pp = j.get("m"), j.get("p") or []
                    if m in ("critical_error", "protocol_error"):
                        raise (TVAuthError if self.token != UNAUTH else TVError)(str(pp)[:200])
                    if not pp or pp[0] != cs:
                        continue
                    if m == "symbol_resolved" and len(pp) > 2:
                        info = pp[2]
                    elif m in ("timescale_update", "du") and len(pp) > 1 and isinstance(pp[1], dict):
                        for b in (pp[1].get("sds_1") or {}).get("s") or []:
                            v = b.get("v") or []
                            if len(v) >= 5:
                                bars[v[0]] = v
                    elif m == "series_completed":
                        return info or {}, [bars[k] for k in sorted(bars)]
                    elif m == "symbol_error":
                        raise TVNotFound(symbol)
                    elif m == "series_error":
                        raise TVError("series_error")
            raise TVError("timeout")
        finally:
            try:
                ws.send(_msg("chart_delete_session", [cs]))
            except Exception:
                pass

    def history(self, symbol, res="1D", n=520, token=UNAUTH):
        if websocket is None:
            raise TVError("websocket-client is not installed")
        with self.lock:
            for attempt in (0, 1):
                try:
                    if self.ws is None or self.token != token or time.time() - self.last > 180:
                        self.close()
                        self._connect(token)
                    out = self._run(symbol, res, n)
                    self.last = time.time()
                    return out
                except TVNotFound:
                    raise
                except TVAuthError:
                    self.close()
                    raise
                except Exception as e:
                    self.close()
                    if attempt:
                        raise TVError(str(e) or e.__class__.__name__)


class TVPool:
    """A few connections so the market scan can fetch in parallel."""

    def __init__(self, n=3):
        self.all = [TVClient() for _ in range(n)]
        self.q = queue.Queue()
        for c in self.all:
            self.q.put(c)

    @staticmethod
    def available():
        return websocket is not None

    def history(self, *a, **k):
        c = self.q.get()
        try:
            return c.history(*a, **k)
        finally:
            self.q.put(c)

    def close(self):
        for c in self.all:
            with c.lock:
                c.close()


CLIENT = TVPool(3)


def bars_to_rows(bars, info, daily=True):
    off = TZ_OFF.get((info or {}).get("timezone") or "", 0) * 3600
    out = {}
    for b in bars:
        try:
            t = int(b[0])
            o, h, l, c = (float(x) if x is not None else None for x in b[1:5])
        except (TypeError, ValueError):
            continue
        if c is None:
            continue
        v = float(b[5]) if len(b) > 5 and b[5] is not None else 0.0
        if daily:
            lt = time.gmtime(t + off)
            d = calendar.timegm((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0))
            if lt.tm_hour >= 17:  # sessions that open the evening before (gold, currencies)
                d += 86400
            key = d * 1000
        else:
            key = t * 1000
        out[key] = [key, o, h, l, c, v]
    return [out[k] for k in sorted(out)]


def is_delayed(info):
    name = (info or {}).get("pro_name") or (info or {}).get("full_name") or ""
    return "_DLY" in name or "NAUTH" in name or bool((info or {}).get("delay"))


# ================================================================ secure session storage
def _dpapi(data, protect):
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = BLOB()
    crypt32 = ctypes.windll.crypt32
    if protect:
        ok = crypt32.CryptProtectData(ctypes.byref(blob_in), ctypes.c_wchar_p("StockZones"), None, None, None,
                                      0x01, ctypes.byref(blob_out))  # CRYPTPROTECT_UI_FORBIDDEN
    else:
        ok = crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None,
                                        0x01, ctypes.byref(blob_out))
    if not ok:
        raise OSError("DPAPI failed")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


KEYCHAIN_SERVICE = "StockZones TradingView"


def secret_save(path, text):
    """Returns how it was stored: 'dpapi', 'keychain' or 'file'."""
    raw = text.encode("utf-8")
    if sys.platform == "win32":
        try:
            enc = _dpapi(raw, True)
            _write(path, b"DPAPI:" + base64.b64encode(enc))
            return "dpapi"
        except Exception:
            pass
    if sys.platform == "darwin":
        try:
            subprocess.run(["security", "add-generic-password", "-U", "-a", "StockZones", "-s", KEYCHAIN_SERVICE,
                            "-w", text], check=True, capture_output=True, timeout=15)
            _write(path, b"KEYCHAIN:")
            return "keychain"
        except Exception:
            pass
    _write(path, b"PLAIN:" + base64.b64encode(raw))
    return "file"


def secret_load(path):
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return None
    try:
        if data.startswith(b"DPAPI:"):
            return _dpapi(base64.b64decode(data[6:]), False).decode("utf-8")
        if data.startswith(b"KEYCHAIN:"):
            r = subprocess.run(["security", "find-generic-password", "-a", "StockZones", "-s", KEYCHAIN_SERVICE, "-w"],
                               capture_output=True, timeout=15)
            if r.returncode != 0:
                return None
            return r.stdout.decode("utf-8").strip() or None
        if data.startswith(b"PLAIN:"):
            return base64.b64decode(data[6:]).decode("utf-8")
    except Exception:
        return None
    return None


def secret_kind(path):
    try:
        with open(path, "rb") as f:
            head = f.read(9)
    except OSError:
        return ""
    return "dpapi" if head.startswith(b"DPAPI:") else "keychain" if head.startswith(b"KEYCHAIN:") else "file"


def secret_delete(path):
    if secret_kind(path) == "keychain":
        try:
            subprocess.run(["security", "delete-generic-password", "-a", "StockZones", "-s", KEYCHAIN_SERVICE],
                           capture_output=True, timeout=15)
        except Exception:
            pass
    try:
        os.remove(path)
    except OSError:
        pass


def _write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


# ================================================================ account
def account_from_cookies(cookies):
    """cookies: {'sessionid': ..., 'sessionid_sign': ...}. Reads the signed-in home page."""
    parts = ["%s=%s" % (k, v) for k, v in cookies.items() if v and re.match(r"^[A-Za-z0-9_\-.:%=+/]+$", str(v))]
    if not parts:
        return None
    req = urllib.request.Request("https://www.tradingview.com/", headers={"User-Agent": UA, "Cookie": "; ".join(parts),
                                                                          "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=20) as r:
        page = r.read().decode("utf-8", errors="replace")
    m = re.search(r'"auth_token":"([^"]+)"', page)
    if not m:
        return None
    win = page[max(0, m.start() - 6000): m.end() + 6000]
    pos = m.start() - max(0, m.start() - 6000)
    users = [u for u in re.finditer(r'"username":"([^"]*)"', win)]
    before = [u for u in users if u.start() < pos]
    user = (before[-1] if before else (users[0] if users else None))
    plan = re.search(r'"pro_plan":"([^"]*)"', win)
    return {"token": m.group(1), "username": user.group(1) if user else "",
            "plan": plan.group(1) if plan else ""}


class Account:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.info = None      # {'token','username','plan'}
        self.checked = 0.0
        self.error = ""

    def cookies(self):
        s = secret_load(self.path)
        if not s:
            return None
        try:
            c = json.loads(s)
            return c if isinstance(c, dict) and c.get("sessionid") else None
        except ValueError:
            return None

    def has_session(self):
        return os.path.exists(self.path)

    def save(self, cookies):
        cookies = {k: str(v).strip() for k, v in cookies.items() if k in ("sessionid", "sessionid_sign") and v}
        if not cookies.get("sessionid"):
            return {"ok": False, "error": "لم يُعثر على الجلسة (sessionid)."}
        try:
            info = account_from_cookies(cookies)
        except Exception:
            return {"ok": False, "error": "تعذّر الاتصال بـ TradingView للتحقق من الجلسة."}
        if not info:
            return {"ok": False, "error": "الجلسة غير صالحة أو منتهية. سجّل الدخول من جديد."}
        kind = secret_save(self.path, json.dumps(cookies))
        with self.lock:
            self.info, self.checked, self.error = info, time.time(), ""
        return {"ok": True, "username": info["username"], "plan": info["plan"], "storage": kind}

    def logout(self):
        secret_delete(self.path)
        with self.lock:
            self.info, self.checked, self.error = None, 0.0, ""

    def token(self):
        """auth token for the data feed; falls back to the public feed."""
        with self.lock:
            if self.info and time.time() - self.checked < 3000:
                return self.info["token"]
        c = self.cookies()
        if not c:
            return UNAUTH
        try:
            info = account_from_cookies(c)
        except Exception:
            with self.lock:  # offline or TradingView down: keep the last token if any
                return self.info["token"] if self.info else UNAUTH
        with self.lock:
            self.checked = time.time()
            if info:
                self.info, self.error = info, ""
                return info["token"]
            self.info, self.error = None, "expired"
        return UNAUTH

    def invalidate(self):
        with self.lock:
            self.checked = 0.0

    def status(self):
        if not self.has_session():
            return {"loggedIn": False}
        self.token()
        with self.lock:
            if self.info:
                return {"loggedIn": True, "username": self.info["username"], "plan": self.info["plan"],
                        "storage": secret_kind(self.path)}
            return {"loggedIn": False, "expired": self.error == "expired", "storage": secret_kind(self.path)}
