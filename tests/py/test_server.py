import http.client
import json
import os
import threading
from http.server import ThreadingHTTPServer

import pytest

import main


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
    monkeypatch.setattr(main, "ERROR_MAX", 2000)
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
    monkeypatch.setattr(main, "get_fundamentals", broken)
    j = json.loads(call(server, "/api/fundamentals?code=X&ex=SR")[1])
    assert not j["ok"]
    assert "synthetic failure" in main.errors_text()


# ---------------------------------------------------------------- fundamentals (no network)
def test_fundamentals_picks_primary_listing(monkeypatch):
    rows = [{"d": [100, 20, 2, 5, 50, 6, 1, 120, 150, 90, 2, 10, "Finance", "OTC", "USD", 1e6, 1e6]},
            {"d": [101, 21, 2, 5, 50, 6, 1, 121, 150, 90, 2, 10, "Finance", "NYSE", "USD", 9e9, 1e6]}]
    monkeypatch.setattr(main, "tv_scan", lambda market, body: {"data": rows})
    monkeypatch.setattr(main, "sector_multiples", lambda m, s: {"pe": 12, "pb": 1.5, "n": 40})
    r = main.get_fundamentals("ZZZT", "US")
    assert r["ok"] and r["f"]["exchange"] == "NYSE" and r["sectorPE"] == 12
