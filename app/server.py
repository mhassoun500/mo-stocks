# -*- coding: utf-8 -*-
"""The local web server the page talks to, and the TradingView sign-in window."""
from core import *  # noqa: F401,F403
from prices import *  # noqa: F401,F403
from markets import *  # noqa: F401,F403
from system import *  # noqa: F401,F403
# ================================================================ web server
SKELETON = ('<!doctype html><html lang="ar"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<link rel="icon" href="/icon.png">'
            '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
            '<script>window.LOCAL_API={version:"@VER@",frozen:@FROZEN@,platform:"@PLAT@",token:"@TOKEN@"};'
            'document.documentElement.classList.add("local");</script>'
            '</head><body>')

# A new secret for every run. The page gets it inside its own HTML and sends it with every API call,
# so another website open in the browser cannot use this local server.
API_TOKEN = secrets.token_urlsafe(24)
SERVER_PORT = [PREFERRED_PORT]


def load_page():
    with open(os.path.join(resource_dir(), "page.html"), encoding="utf-8") as f:
        html = f.read()
    if os.path.exists(os.path.join(resource_dir(), "fonts", "fonts.css")):
        html = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]*">',
                      '<link rel="stylesheet" href="/fonts/fonts.css">', html)
        html = re.sub(r'<link rel="preconnect"[^>]*>\s*', "", html)
    head = SKELETON.replace("@VER@", VERSION).replace("@FROZEN@", "true" if FROZEN else "false").replace("@PLAT@", sys.platform).replace("@TOKEN@", API_TOKEN)
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

    def _allowed(self, path):
        """Only this app's own page may talk to the server."""
        port = SERVER_PORT[0]
        hosts = ("127.0.0.1:%d" % port, "localhost:%d" % port)
        if (self.headers.get("Host") or "").lower() not in hosts:  # blocks DNS-rebinding tricks
            return False
        origin = self.headers.get("Origin")
        if origin and origin.lower() not in ("http://" + h for h in hosts):
            return False
        if path.startswith("/api/"):
            return hmac.compare_digest(self.headers.get("X-Mo-Token") or "", API_TOKEN)
        return True

    def _deny(self):
        self._send(403, json.dumps({"ok": False, "error": "forbidden"}), "application/json; charset=utf-8")

    # ------------------------------------------------------------ GET
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if not self._allowed(url.path):
            return self._deny()
        LAST_PING[0] = time.time()
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
                size = q.get("size") if re.match(r"^(\d+|cap300|all)$", q.get("size", "")) else None
                return self._json(get_universe(q.get("ex", "SR"), None if size == "all" else size))
            if p == "/api/ussharia":
                return self._json(us_sharia(q.get("code", "")))
            if p == "/api/sharialists":
                if q.get("refresh") == "1":
                    threading.Thread(target=sharia_refresh, daemon=True).start()
                    return self._json({"ok": True, "started": True})
                return self._json(sharia_lists())
            if p == "/api/yaaqen":
                if q.get("refresh") == "1":
                    threading.Thread(target=yaaqen_refresh, daemon=True).start()
                    return self._json({"ok": True, "started": True})
                hit, _ = cache_get("yaaqen|us")
                return self._json({"ok": True, "busy": YAAQEN_BUSY.is_set(), "list": hit})
            if p == "/api/store":
                return self._json({"ok": True, "value": Store.get(q.get("key", ""))})
            if p == "/api/autostart":
                return self._json({"ok": True, "enabled": autostart_state(), "available": FROZEN})
            if p == "/api/tvaccount":
                return self._json(tv_account_status())
            if p == "/api/fundamentals":
                return self._json(get_fundamentals(q.get("code", ""), q.get("ex", "SR")))
            if p == "/api/ai":
                return self._json(AI.status())
            if p == "/api/backup":
                return self._json({"ok": True, "list": backup_list(), "folder": BACKUP_DIR})
            if p == "/api/errors":
                return self._json({"ok": True, "text": errors_text(), "path": ERROR_LOG, "version": VERSION,
                                   "platform": sys.platform, "python": sys.version.split()[0], "frozen": FROZEN})
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
            if isinstance(e, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
                return  # the page went away before the answer arrived
            record("ERROR", "GET " + p, e, traceback.format_exc())
            return self._json({"ok": False, "error": str(e)})

    # ------------------------------------------------------------ POST
    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path
        if not self._allowed(p):
            return self._deny()
        LAST_PING[0] = time.time()
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
                if act == "status":
                    return self._json(tg_status())
                if act == "clear":
                    tvdata.secret_delete(TG_SECRET, TG_KEYCHAIN)
                    return self._json(tg_status())
                if act == "detect":
                    chat = telegram_detect(b.get("token") or None)
                    tg_save(b.get("token"))
                    return self._json(dict(tg_status(), chat=chat))
                if act == "test":
                    telegram_send("✅ تم ربط Mo Stocks بتيليجرام بنجاح.", b.get("token") or None, b.get("chatId"))
                    tg_save(b.get("token"))
                    return self._json(tg_status())
                return self._json({"ok": False, "error": "إجراء غير معروف."})
            if p == "/api/autostart":
                return self._json({"ok": True, "enabled": autostart_set(bool(b.get("enabled")))})
            if p == "/api/tvaccount":
                return self._json(tv_account_action(b))
            if p == "/api/ai":
                act, prov = b.get("action"), b.get("provider") or "claude"
                if act == "save":
                    return self._json(AI.save(prov, b.get("key")))
                if act == "delete":
                    return self._json(AI.delete(prov))
                if act == "models":
                    return self._json(AI.models(prov, b.get("key") or None, b.get("base")))
                if act == "test":
                    return self._json(AI.test(prov, b.get("model"), b.get("key") or None, b.get("base")))
                if act == "ask":
                    log("  ai %s %s" % (prov, b.get("model") or ""))
                    return self._json(AI.ask(prov, b.get("model"), str(b.get("system") or "")[:8000],
                                             str(b.get("user") or "")[:60000], bool(b.get("web")), base=b.get("base")))
                return self._json({"ok": False, "error": "إجراء غير معروف."})
            if p == "/api/save":
                path = save_file(b.get("filename"), b.get("dataUrl"), b.get("text"))
                return self._json({"ok": True, "path": path})
            if p == "/api/backup":
                act = b.get("action")
                if act == "export":
                    path = backup_write(downloads_dir(), "manual")
                    return self._json({"ok": True, "path": path})
                if act == "now":
                    path = backup_write(BACKUP_DIR, "manual")
                    return self._json({"ok": True, "path": path, "list": backup_list()})
                if act == "restore":
                    if b.get("name"):
                        name = os.path.basename(str(b["name"]))
                        with open(os.path.join(BACKUP_DIR, name), encoding="utf-8-sig") as f:
                            obj = json.load(f)
                    else:
                        obj = b.get("data")
                    return self._json(backup_restore(obj))
                if act == "folder":
                    os.makedirs(BACKUP_DIR, exist_ok=True)
                    lst = backup_list()
                    reveal(os.path.join(BACKUP_DIR, lst[0]["name"]) if lst else BACKUP_DIR)
                    return self._json({"ok": True})
                return self._json({"ok": False, "error": "إجراء غير معروف."})
            if p == "/api/errors":
                act = b.get("action")
                if act == "client":  # an error inside the page
                    record("ERROR", "page " + str(b.get("where") or "")[:80], str(b.get("msg") or "")[:1000], str(b.get("stack") or "")[:4000])
                    return self._json({"ok": True})
                if act == "clear":
                    for f in (ERROR_LOG, ERROR_LOG + ".1"):
                        try:
                            os.remove(f)
                        except OSError:
                            pass
                    return self._json({"ok": True})
                return self._json({"ok": False, "error": "إجراء غير معروف."})
            return self._send(404, "not found", "text/plain; charset=utf-8")
        except Exception as e:
            if isinstance(e, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
                return  # the page went away before the answer arrived
            record("ERROR", "POST " + p, e, traceback.format_exc())
            return self._json({"ok": False, "error": str(e)})


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
