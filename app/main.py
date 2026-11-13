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

Code layout (each module builds on the ones before it):
  core.py     paths, version, logging and error log, settings store, disk cache, secrets
  prices.py   price history and live quotes (TradingView, Yahoo, Stooq, metals, funds)
  markets.py  search, profiles, market lists, sectors, fundamentals, Sharia lists
  system.py   notifications, Telegram, autostart, updates, files, backup and restore
  server.py   the local web server for the page, TradingView sign-in window
  main.py     window, background tasks and start-up (this file)

Run from source:  python app/main.py      Options: --browser  --minimized  --selftest
"""
from core import *  # noqa: F401,F403
from prices import *  # noqa: F401,F403
from markets import *  # noqa: F401,F403
from system import *  # noqa: F401,F403
from server import *  # noqa: F401,F403

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
    try:
        tg_migrate()
    except Exception as e:
        warn("telegram migrate: %s" % e)
    srv.daemon_threads = True
    SERVER_PORT[0] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=fund_refresher, daemon=True).start()
    threading.Thread(target=yaaqen_refresher, daemon=True).start()
    threading.Thread(target=sharia_refresher, daemon=True).start()
    threading.Thread(target=backup_refresher, daemon=True).start()
    return srv, "http://%s:%d/" % (HOST, srv.server_address[1])


def run_window(url, minimized):
    import webview  # pywebview

    try:
        win = webview.create_window(APP_TITLE, url, width=1400, height=920, min_size=(900, 640), background_color="#eef1f3",
                                    text_select=True, minimized=minimized, maximized=not minimized)
    except TypeError:  # older pywebview without "maximized"
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
    if "--selftest" in sys.argv:  # used by the build pipeline to check HTTPS works inside the packaged app
        i = sys.argv.index("--selftest")
        out_path = sys.argv[i + 1] if len(sys.argv) > i + 1 else None
        lines, ok = [], True
        checks = (("TradingView scanner", True, lambda: tv_scan("ksa", {"columns": ["close"], "range": [0, 1]})),
                  ("TradingView chart feed", True, lambda: tvdata.CLIENT.history("TADAWUL:1120", "1D", 5)),
                  ("Yahoo Finance", False, lambda: http_json("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d")),
                  ("Mubasher", False, lambda: http_text("https://www.mubasher.info/api/1/listed-companies?country=sa&size=1")))
        for name, required, fn in checks:
            try:
                fn()
                lines.append("OK    " + name)
            except Exception as e:
                ok = ok and not required
                lines.append(("FAIL  " if required else "WARN  ") + name + " - " + str(e))
        lines.append("SSL_CERT_FILE = %s" % os.environ.get("SSL_CERT_FILE"))
        text = "\n".join(lines) + "\n"
        if out_path:
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(text)
        elif sys.stdout:
            sys.stdout.write(text)
            sys.stdout.flush()
        os._exit(0 if ok else 1)
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
            warn(" Native window unavailable (%s); using the browser instead." % e)
            run_browser(url)
    srv.shutdown()


if __name__ == "__main__":
    main()
