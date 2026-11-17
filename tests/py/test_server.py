import http.client
import json
import os
import threading
from http.server import ThreadingHTTPServer

import pytest

import core
import main
import markets
import server as srvmod


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
    main.SERVER_PORT[0] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()


def call(port, path, method="GET", body=None, headers=None, token=True):
    h = {"Host": "127.0.0.1:%d" % port}
    if token:
        h["X-Mo-Token"] = main.API_TOKEN
    h.update(headers or {})
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    data = json.dumps(body).encode() if body is not None else None
    if data:
        h["Content-Type"] = "application/json"
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    raw = r.read()
    c.close()
    return r.status, raw


# ---------------------------------------------------------------- security
def test_api_needs_token(server):
    assert call(server, "/api/ping", token=False)[0] == 403
    st, raw = call(server, "/api/ping")
    assert st == 200 and json.loads(raw)["ok"]


def test_wrong_token_refused(server):
    assert call(server, "/api/ping", token=False, headers={"X-Mo-Token": "nope"})[0] == 403


def test_other_host_refused(server):
    assert call(server, "/api/ping", headers={"Host": "evil.example:%d" % server})[0] == 403
    assert call(server, "/", headers={"Host": "evil.example"}, token=False)[0] == 403


def test_other_origin_refused(server):
    st, _ = call(server, "/api/store", "POST", {"key": "x", "value": 1}, headers={"Origin": "https://evil.example"})
    assert st == 403


def test_same_origin_post_allowed(server):
    st, raw = call(server, "/api/store", "POST", {"key": "t1", "value": 5},
                   headers={"Origin": "http://127.0.0.1:%d" % server})
    assert st == 200 and json.loads(raw)["ok"]
    assert main.Store.get("t1") == 5


def test_page_carries_token(server):
    st, raw = call(server, "/", token=False)
    assert st == 200
    assert main.API_TOKEN.encode() in raw


# ---------------------------------------------------------------- secrets stay out of the settings file
def test_telegram_token_never_in_store():
    main.Store.set("prefs", {"telegram": {"enabled": True, "token": "111:SECRETVALUE", "chatId": "5"}})
    raw = open(main.STORE_FILE, encoding="utf-8").read()
    assert "SECRETVALUE" not in raw
    assert main.tg_token() == "111:SECRETVALUE"
    assert main.Store.get("prefs")["telegram"]["chatId"] == "5"


def test_telegram_migration_from_old_file():
    d = json.load(open(main.STORE_FILE, encoding="utf-8"))
    d["prefs"] = {"telegram": {"token": "222:OLDPLAIN", "chatId": "7"}}
    json.dump(d, open(main.STORE_FILE, "w", encoding="utf-8"))
    main.tg_migrate()
    assert "OLDPLAIN" not in open(main.STORE_FILE, encoding="utf-8").read()
    assert main.tg_token() == "222:OLDPLAIN"


def test_telegram_status_endpoint(server):
    st, raw = call(server, "/api/telegram", "POST", {"action": "status"})
    j = json.loads(raw)
    assert j["hasToken"] and j["hint"].startswith("…")
    assert "OLDPLAIN" not in raw.decode()


# ---------------------------------------------------------------- backup
def test_backup_round_trip(tmp_path):
    main.Store.set("watchlist", [{"code": "1120"}])
    path = main.backup_write(str(tmp_path), "manual")
    obj = json.load(open(path, encoding="utf-8"))
    assert obj["app"] == "Mo Stocks" and obj["data"]["watchlist"][0]["code"] == "1120"
    assert "OLDPLAIN" not in open(path, encoding="utf-8").read()
    main.Store.set("watchlist", [])
    res = main.backup_restore(obj)
    assert res["ok"]
    assert main.Store.get("watchlist") == [{"code": "1120"}]
    assert any(b["kind"] == "before-restore" for b in main.backup_list())


def test_restore_rejects_other_files():
    with pytest.raises(ValueError):
        main.backup_restore({"hello": 1})
    with pytest.raises(ValueError):
        main.backup_validate({"app": "Other", "data": {}})


def test_restore_keeps_secrets_out():
    obj = main.backup_payload()
    obj["data"]["prefs"] = {"telegram": {"token": "333:INBACKUP", "chatId": "1"}}
    main.backup_restore(obj)
    assert "INBACKUP" not in open(main.STORE_FILE, encoding="utf-8").read()
    assert main.tg_token() == "333:INBACKUP"


def test_auto_backup_weekly_and_pruned(monkeypatch):
    for f in os.listdir(main.BACKUP_DIR):
        os.remove(os.path.join(main.BACKUP_DIR, f))
    assert main.backup_auto()            # first one is made
    assert main.backup_auto() is None    # not again within a week
    names = []
    for i in range(12):
        n = "mostocks-backup-auto-2026-01-%02d-120000.json" % (i + 1)
        open(os.path.join(main.BACKUP_DIR, n), "w").write("{}")
        os.utime(os.path.join(main.BACKUP_DIR, n), (1700000000 + i, 1700000000 + i))
        names.append(n)
    main.backup_prune()
    autos = [b for b in main.backup_list() if b["kind"] == "auto"]
    assert len(autos) == main.BACKUP_KEEP


# ---------------------------------------------------------------- error log
def test_error_log_records_and_rotates(monkeypatch):
    monkeypatch.setattr(core, "ERROR_MAX", 2000)
    for i in range(60):
        main.record("WARN", "test", "message %d" % i)
    assert os.path.exists(main.ERROR_LOG + ".1")
    assert "message 59" in main.errors_text()


def test_errors_endpoint(server):
    call(server, "/api/errors", "POST", {"action": "client", "where": "unit", "msg": "boom from page"})
    j = json.loads(call(server, "/api/errors")[1])
    assert "boom from page" in j["text"] and j["version"]
    call(server, "/api/errors", "POST", {"action": "clear"})
    assert json.loads(call(server, "/api/errors")[1])["text"] == ""


def test_handler_error_is_logged(server, monkeypatch):
    def broken(*a, **k):
        raise RuntimeError("synthetic failure")
    monkeypatch.setattr(srvmod, "get_fundamentals", broken)
    j = json.loads(call(server, "/api/fundamentals?code=X&ex=SR")[1])
    assert not j["ok"]
    assert "synthetic failure" in main.errors_text()


# ---------------------------------------------------------------- fundamentals (no network)
def test_fundamentals_picks_primary_listing(monkeypatch):
    rows = [{"d": [100, 20, 2, 5, 50, 6, 1, 120, 150, 90, 2, 10, "Finance", "OTC", "USD", 1e6, 1e6]},
            {"d": [101, 21, 2, 5, 50, 6, 1, 121, 150, 90, 2, 10, "Finance", "NYSE", "USD", 9e9, 1e6]}]
    monkeypatch.setattr(markets, "tv_scan", lambda market, body: {"data": rows})
    monkeypatch.setattr(markets, "sector_multiples", lambda m, s: {"pe": 12, "pb": 1.5, "n": 40})
    r = main.get_fundamentals("ZZZT", "US")
    assert r["ok"] and r["f"]["exchange"] == "NYSE" and r["sectorPE"] == 12


def test_fundamentals_falls_back_to_yahoo_and_never_caches_failures(monkeypatch):
    def down(market, body):
        raise OSError("scanner down")
    monkeypatch.setattr(markets, "tv_scan", down)
    monkeypatch.setattr(markets.time, "sleep", lambda s: None)
    monkeypatch.setattr(markets, "get_profile", lambda sym: {"ok": False})
    r = main.get_fundamentals("NOPE1", "SR")
    assert not r["ok"] and r["error"]
    monkeypatch.setattr(markets, "get_profile", lambda sym: {"ok": True, "price": 50, "trailingPE": 10, "targetMeanPrice": 60})
    r = main.get_fundamentals("NOPE1", "SR")  # the earlier failure was not cached
    assert r["ok"] and r["source"] == "Yahoo Finance" and r["f"]["price_target_average"] == 60


# ---------------------------------------------------------------- Phase 4 routes
def test_phase4_routes_reach_their_functions(server, monkeypatch):
    seen = {}
    monkeypatch.setattr(srvmod, "scan_fundamentals", lambda ex, size=None: seen.update(scan=(ex, size)) or {"ok": True, "f": {}})
    monkeypatch.setattr(srvmod, "events_calendar", lambda items: seen.update(cal=items) or {"ok": True, "events": []})
    assert json.loads(call(server, "/api/scanfund?ex=US&size=500")[1])["ok"] and seen["scan"] == ("US", "500")
    call(server, "/api/scanfund?ex=SR&size=../x")
    assert seen["scan"] == ("SR", None), "a strange size is ignored"
    j = json.loads(call(server, "/api/calendar", "POST", {"items": [{"code": "AAPL", "ex": "US"}, "junk"]})[1])
    assert j["ok"] and seen["cal"] == [{"code": "AAPL", "ex": "US"}]


# ---------------------------------------------------------------- Phase 6: one-click update
import hashlib as _hl
import io as _io

import system as _sys


class _Resp(_io.BytesIO):
    def __init__(self, data):
        super().__init__(data)
        self.headers = {"Content-Length": str(len(data))}


def _fetcher(files):
    return lambda u: _Resp(files[u])


REL = "https://github.com/mhassoun500/mo-stocks/releases/download/v9.9.9/"


def test_update_is_opened_only_when_its_fingerprint_matches(tmp_path, monkeypatch):
    monkeypatch.setattr(_sys, "downloads_dir", lambda: str(tmp_path))
    data = b"installer bytes" * 1000
    good = _hl.sha256(data).hexdigest()
    opened = []
    sums = ("%s  MoStocks_Setup_v9.9.9.exe\n%s *MoStocks_v9.9.9_mac_intel.dmg\n" % (good, "0" * 64)).encode()
    r = _sys.download_update(REL + "MoStocks_Setup_v9.9.9.exe", "MoStocks_Setup_v9.9.9.exe", REL + "SHA256SUMS.txt",
                             opener=lambda p: opened.append(p) or True, fetch=_fetcher({REL + "SHA256SUMS.txt": sums, REL + "MoStocks_Setup_v9.9.9.exe": data}))
    assert r["ok"] and r["sha256"] == good and r["quits"] and opened == [str(tmp_path / "MoStocks_Setup_v9.9.9.exe")]
    assert _sys.UPD["state"] == "done" and _sys.UPD["done"] == len(data)
    opened.clear()
    r = _sys.download_update(REL + "MoStocks_v9.9.9_mac_intel.dmg", "MoStocks_v9.9.9_mac_intel.dmg", REL + "SHA256SUMS.txt",
                             opener=lambda p: opened.append(p), fetch=_fetcher({REL + "SHA256SUMS.txt": sums, REL + "MoStocks_v9.9.9_mac_intel.dmg": data}))
    assert not r["ok"] and "بصمة" in r["error"] and opened == [] and not list(tmp_path.glob("*.dmg*")), "deleted, never opened"


def test_update_refuses_other_addresses_and_files_without_a_fingerprint(tmp_path, monkeypatch):
    monkeypatch.setattr(_sys, "downloads_dir", lambda: str(tmp_path))
    bad = _sys.download_update("https://evil.example/x.exe", "x.exe", REL + "SHA256SUMS.txt", opener=lambda p: 1 / 0)
    assert not bad["ok"] and "GitHub" in bad["error"]
    assert not _sys.download_update(REL + "a.exe", "b.exe", REL + "SHA256SUMS.txt")["ok"], "the name must be the file's"
    r = _sys.download_update(REL + "a.exe", "a.exe", REL + "SHA256SUMS.txt", opener=lambda p: 1 / 0,
                             fetch=_fetcher({REL + "SHA256SUMS.txt": b"", REL + "a.exe": b"x"}))
    assert not r["ok"] and "بصمة" in r["error"]
    assert _sys.sums_for("ABC  x", "x") is None and _sys.sums_for("a" * 64 + "  dist/x.exe", "x.exe") == "a" * 64
