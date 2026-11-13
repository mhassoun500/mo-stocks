# -*- coding: utf-8 -*-
"""Shared foundation: paths, version, logging and the error log, settings store, disk cache, secrets."""
import hmac
import secrets
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
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The packaged macOS app carries its own OpenSSL, which cannot see the Mac's certificate store, so
# every HTTPS request would fail certificate checks. Use certifi's bundle when the system has none.
try:
    import ssl as _ssl
    import certifi as _certifi
    _paths = _ssl.get_default_verify_paths()
    if not os.environ.get("SSL_CERT_FILE") and (sys.platform == "darwin" or not (
            (_paths.cafile and os.path.exists(_paths.cafile)) or (_paths.capath and os.path.isdir(_paths.capath)))):
        os.environ["SSL_CERT_FILE"] = _certifi.where()
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import funds  # noqa: E402  Egyptian mutual funds (Mubasher)
import tvdata  # noqa: E402  TradingView data feed and account session
import ai_providers
import sharia  # noqa: E402  Saudi (Argaam) and Egyptian Sharia lists

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


# ---------------------------------------------------------------- error log (shown in Settings)
ERROR_LOG = os.path.join(DATA_DIR, "errors.log")
ERROR_LOCK = threading.Lock()
ERROR_MAX = 512 * 1024


def record(level, where, msg, tb=None):
    """Append one entry to errors.log; keeps one older file when it grows past 512 KB."""
    line = "%s [%s] %s: %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), level, where, str(msg).replace("\n", " ")[:2000])
    if tb:
        line += "".join("    " + x + "\n" for x in tb.rstrip().splitlines()[-25:])
    try:
        with ERROR_LOCK:
            if os.path.exists(ERROR_LOG) and os.path.getsize(ERROR_LOG) > ERROR_MAX:
                os.replace(ERROR_LOG, ERROR_LOG + ".1")
            with open(ERROR_LOG, "a", encoding="utf-8") as f:
                f.write(line)
    except OSError:
        pass


def warn(msg, where="server"):
    log(msg)
    record("WARN", where, str(msg).strip())


def errors_text(limit=64 * 1024):
    try:
        with open(ERROR_LOG, encoding="utf-8", errors="replace") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - limit))
            text = f.read()
        if size > limit:
            text = text[text.find("\n") + 1:]
        return text
    except OSError:
        return ""


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
        if key == "prefs" and isinstance(value, dict) and isinstance(value.get("telegram"), dict):
            value = dict(value, telegram=dict(value["telegram"]))
            tok = value["telegram"].pop("token", "")  # secrets never go into the plain settings file
            if tok:
                try:
                    tg_save(tok)
                except Exception as e:
                    warn("telegram token not saved: %s" % e)
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





# ---------------------------------------------------------------- state shared by several modules
US_EXCH = {}            # US ticker -> TradingView exchange, filled from the US market list
LAST_PING = [time.time()]  # last request from the page; the app quits a while after the page is gone
WINDOW = [None]         # the app window, when running in one
QUIT = threading.Event()


# ---------------------------------------------------------------- Telegram bot token (kept encrypted, never in the settings file)
TG_SECRET = os.path.join(DATA_DIR, "telegram_token.bin")
TG_KEYCHAIN = "StockZones Telegram"


def tg_token():
    return tvdata.secret_load(TG_SECRET, TG_KEYCHAIN) or ""


def tg_save(token):
    token = (token or "").strip()
    if token and token != tg_token():
        tvdata.secret_save(TG_SECRET, token, TG_KEYCHAIN)


def tg_status():
    t = tg_token()
    return {"ok": True, "hasToken": bool(t), "hint": ("…" + t[-4:]) if len(t) > 8 else "",
            "storage": tvdata.secret_kind(TG_SECRET) if t else ""}


def tg_migrate():
    """Older versions kept the bot token in plain text inside the settings file: move it to encrypted storage."""
    prefs = Store.get("prefs", {}) or {}
    tg = prefs.get("telegram") if isinstance(prefs, dict) else None
    if isinstance(tg, dict) and tg.get("token"):
        Store.set("prefs", prefs)  # Store.set moves the token out
