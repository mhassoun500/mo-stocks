"""2.18: the daily copy in a cloud folder, and Yahoo figures for Egyptian scanner rows."""
import os
import time

import core
import markets
import system


def test_cloud_folders_found_on_the_disk(tmp_path):
    home = tmp_path
    (home / "OneDrive").mkdir()
    (home / "Library" / "CloudStorage" / "GoogleDrive-me@x.com" / "My Drive").mkdir(parents=True)
    (home / "Library" / "Mobile Documents" / "com~apple~CloudDocs").mkdir(parents=True)
    got = system.cloud_dirs(home=str(home), env={"OneDrive": str(home / "OneDrive")})
    kinds = sorted(d["kind"] for d in got)
    assert kinds == ["gdrive", "icloud", "onedrive"], got          # OneDrive once, though found twice
    assert any(d["path"].endswith("My Drive") for d in got)
    if os.name != "nt":
        assert system.cloud_dirs(home=str(tmp_path / "nobody"), env={}) == []


def test_daily_copy_written_once_a_day_and_pruned(tmp_path, monkeypatch):
    core.Store.set("journal", [{"id": "a", "code": "1120"}])
    core.Store.set("prefs", {"cloudBackup": {"on": False, "dir": str(tmp_path)}})
    assert system.backup_cloud() is None, "off: nothing written"
    core.Store.set("prefs", {"cloudBackup": {"on": True, "dir": str(tmp_path / "missing")}})
    assert system.cloud_target() is None and system.backup_cloud() is None, "a missing folder is not created"
    core.Store.set("prefs", {"cloudBackup": {"on": True, "dir": str(tmp_path)}})
    p = system.backup_cloud()
    assert p and os.path.dirname(p) == os.path.join(str(tmp_path), system.CLOUD_SUB)
    assert system.backup_cloud() is None, "the same day: no second copy"
    folder = os.path.dirname(p)
    for i in range(12):                                   # old automatic copies
        n = os.path.join(folder, "mostocks-backup-auto-2020-01-%02d-120000.json" % (i + 1))
        open(n, "w").write("{}")
        os.utime(n, (time.time() - 86400 * (40 - i), time.time() - 86400 * (40 - i)))
    os.utime(p, (time.time() - 2 * 86400, time.time() - 2 * 86400))
    assert system.backup_cloud()
    autos = [b for b in system.backup_list(folder) if b["kind"] == "auto"]
    assert len(autos) == system.BACKUP_KEEP, "the newest 8 are kept"


def test_yahoo_fill_asks_once_a_day_and_keeps_misses(monkeypatch):
    calls = []

    def fetch(code, ex):
        calls.append(code)
        return {"close": 50.0, "price_earnings_ttm": 8.0, "price_book_fq": None} if code == "COMI" else None
    stamp = str(time.time()).replace(".", "")
    a, b = "COMI", "ZZ" + stamp[-6:]
    store = {}
    monkeypatch.setattr(markets, "cache_get", lambda k, max_age=None: (store.get(k), 0))
    monkeypatch.setattr(markets, "cache_put", lambda k, v: store.__setitem__(k, v))
    r = markets.scan_fill_yahoo("CA", [a, b, "bad code!", ""], fetch=fetch)
    assert r["ok"] and list(r["f"]) == ["COMI"] and r["f"]["COMI"] == {"close": 50.0, "price_earnings_ttm": 8.0}
    assert r["missing"] == 1 and calls == [a, b], "an invalid code is not asked for"
    markets.scan_fill_yahoo("CA", [a, b], fetch=fetch)
    assert calls == [a, b], "both kept for a day, the miss too"
    many = []
    markets.scan_fill_yahoo("CA", ["X%d" % i for i in range(40)], fetch=lambda c, e: many.append(c))
    assert len(many) == 25, "at most 25 companies a request"
