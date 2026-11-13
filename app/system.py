# -*- coding: utf-8 -*-
"""Desktop integration: notifications and Telegram, start with the computer, updates, files, backup and restore."""
from core import *  # noqa: F401,F403
from prices import *  # noqa: F401,F403
from markets import *  # noqa: F401,F403
# ================================================================ notifications
def notify_desktop(title, body):
    try:
        if sys.platform == "win32":
            ps = (
                "$ErrorActionPreference='Stop';"
                "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;"
                "$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("
                "[Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
                "$n=$x.GetElementsByTagName('text');"
                "$n.Item(0).AppendChild($x.CreateTextNode($env:SZ_TITLE))|Out-Null;"
                "$n.Item(1).AppendChild($x.CreateTextNode($env:SZ_BODY))|Out-Null;"
                "$id='{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';"
                "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show("
                "[Windows.UI.Notifications.ToastNotification]::new($x))"
            )
            env = dict(os.environ, SZ_TITLE=title, SZ_BODY=body)
            subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                             env=env, creationflags=0x08000000)
        elif sys.platform == "darwin":
            script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run'
            subprocess.Popen(["osascript", "-e", script, title, body])
        else:
            subprocess.Popen(["notify-send", title, body])
        return True
    except Exception:
        return False


def telegram_call(method, params=None, token=None):
    token = token or tg_token()
    if not token:
        raise ValueError("أدخل رمز بوت تيليجرام أولًا في الإعدادات.")
    url = "https://api.telegram.org/bot%s/%s" % (token.strip(), method)
    data = urllib.parse.urlencode(params or {}).encode() if params else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            desc = json.loads(e.read().decode("utf-8")).get("description", "")
        except Exception:
            desc = ""
        raise ValueError("رفض تيليجرام الطلب: %s" % (desc or e.code))


def telegram_send(text, token=None, chat=None):
    chat = chat or pref("telegram.chatId", "")
    if not chat:
        raise ValueError("أدخل معرّف المحادثة أو اضغط «اكتشاف المعرّف».")
    for i in range(0, len(text), 3900):
        telegram_call("sendMessage", {"chat_id": chat, "text": text[i:i + 3900],
                                      "disable_web_page_preview": "true"}, token)
    return True


def telegram_detect(token=None):
    r = telegram_call("getUpdates", None, token)
    chats = []
    for u in r.get("result") or []:
        m = u.get("message") or u.get("channel_post") or {}
        c = m.get("chat") or {}
        if c.get("id") is not None:
            chats.append({"id": c["id"], "name": c.get("title") or c.get("first_name") or c.get("username") or ""})
    if not chats:
        raise ValueError("لم أجد رسائل. أرسل أي رسالة للبوت من تيليجرام ثم أعد المحاولة.")
    return chats[-1]


# ================================================================ autostart, update, files
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
LAUNCH_AGENT = os.path.expanduser("~/Library/LaunchAgents/com.mhassoun.stockzones.plist")


def autostart_state():
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
                winreg.QueryValueEx(k, "StockZones")
                return True
        except OSError:
            return False
    if sys.platform == "darwin":
        return os.path.exists(LAUNCH_AGENT)
    return False


def autostart_set(enabled):
    if not FROZEN:
        raise ValueError("التشغيل مع بدء الجهاز متاح في النسخة المثبتة من البرنامج فقط.")
    exe = sys.executable
    if sys.platform == "win32":
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if enabled:
                winreg.SetValueEx(k, "StockZones", 0, winreg.REG_SZ, '"%s" --minimized' % exe)
            else:
                try:
                    winreg.DeleteValue(k, "StockZones")
                except OSError:
                    pass
    elif sys.platform == "darwin":
        if enabled:
            os.makedirs(os.path.dirname(LAUNCH_AGENT), exist_ok=True)
            plist = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
                     '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'
                     '<key>Label</key><string>com.mhassoun.stockzones</string>'
                     '<key>ProgramArguments</key><array><string>%s</string><string>--minimized</string></array>'
                     '<key>RunAtLoad</key><true/></dict></plist>\n' % exe)
            with open(LAUNCH_AGENT, "w", encoding="utf-8") as f:
                f.write(plist)
        elif os.path.exists(LAUNCH_AGENT):
            os.remove(LAUNCH_AGENT)
    else:
        raise ValueError("غير مدعوم على هذا النظام.")
    return autostart_state()


def version_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def check_update():
    repo = (pref("updateRepo", DEFAULT_UPDATE_REPO) or DEFAULT_UPDATE_REPO).strip()
    if repo == "mhassoun500/stock-zones":  # the program's old name
        repo = DEFAULT_UPDATE_REPO
    try:
        r = json.loads(urllib.request.urlopen(urllib.request.Request(
            "https://api.github.com/repos/%s/releases/latest" % repo,
            headers={"User-Agent": UA, "Accept": "application/vnd.github+json"}), timeout=15).read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            try:  # tell "no release published yet" apart from "repository missing or private"
                urllib.request.urlopen(urllib.request.Request("https://api.github.com/repos/%s" % repo, headers={
                    "User-Agent": UA, "Accept": "application/vnd.github+json"}), timeout=15).read()
                return {"ok": False, "error": "لا يوجد إصدار منشور بعد في المستودع %s. أنشئ إصدارًا من صفحة Releases." % repo}
            except Exception:
                pass
            return {"ok": False, "error": "لم أجد إصدارات منشورة في %s. يجب أن يكون المستودع عامًا ليعمل فحص التحديث." % repo}
        return {"ok": False, "error": "تعذّر فحص التحديثات (HTTP %s)." % e.code}
    except Exception:
        return {"ok": False, "error": "تعذّر فحص التحديثات. تحقق من الاتصال."}
    tag = r.get("tag_name") or ""
    assets = {a.get("name", ""): a.get("browser_download_url") for a in r.get("assets") or []}
    want = ".exe" if sys.platform == "win32" else (".dmg" if sys.platform == "darwin" else "")
    dl = ""
    for name, link in assets.items():
        if want and name.endswith(want) and ("intel" in name) == (sys.platform == "darwin" and os.uname().machine == "x86_64"):
            dl = link
    return {"ok": True, "current": VERSION, "latest": tag.lstrip("v"),
            "newer": version_tuple(tag) > version_tuple(VERSION), "url": dl or r.get("html_url"),
            "notes": (r.get("body") or "")[:800]}


def downloads_dir():
    d = os.path.join(os.path.expanduser("~"), "Downloads")
    return d if os.path.isdir(d) else os.path.expanduser("~")


def save_file(name, data_url=None, text=None):
    name = re.sub(r'[\\/:*?"<>|]+', "_", name or "file")[:120]
    path = os.path.join(downloads_dir(), name)
    base, ext = os.path.splitext(path)
    i = 1
    while os.path.exists(path):
        path = "%s (%d)%s" % (base, i, ext)
        i += 1
    if data_url:
        payload = data_url.split(",", 1)[1]
        with open(path, "wb") as f:
            f.write(base64.b64decode(payload))
    else:
        with open(path, "w", encoding="utf-8-sig") as f:
            f.write(text or "")
    return path


# ================================================================ backup and restore
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
BACKUP_KEEP = 8
BACKUP_EVERY = 7 * 86400


def backup_payload():
    with Store.lock:
        data = Store._load()
    out = {"app": "Mo Stocks", "format": 1, "version": VERSION, "created": time.strftime("%Y-%m-%d %H:%M:%S"), "data": data}
    try:
        with open(SNAP_FILE, encoding="utf-8") as f:
            out["fundPrices"] = json.load(f)
    except (OSError, ValueError):
        pass
    return out


def backup_write(folder, kind):
    """kind: auto (weekly), manual (exported by the user), before-restore (safety copy)."""
    os.makedirs(folder, exist_ok=True)
    name = "mostocks-backup-%s-%s.json" % (kind, time.strftime("%Y-%m-%d-%H%M%S"))
    path = os.path.join(folder, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(backup_payload(), f, ensure_ascii=False)
    os.replace(tmp, path)
    return path


def backup_list():
    out = []
    try:
        names = os.listdir(BACKUP_DIR)
    except OSError:
        return out
    for n in names:
        m = re.match(r"^mostocks-backup-(auto|manual|before-restore)-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})\d{2}\.json$", n)
        if m:
            p = os.path.join(BACKUP_DIR, n)
            out.append({"name": n, "kind": m.group(1), "date": "%s %s:%s" % (m.group(2), m.group(3), m.group(4)),
                        "size": os.path.getsize(p), "t": os.path.getmtime(p)})
    out.sort(key=lambda x: -x["t"])
    return out


def backup_prune():
    for kind in ("auto", "before-restore"):
        for b in [x for x in backup_list() if x["kind"] == kind][BACKUP_KEEP:]:
            try:
                os.remove(os.path.join(BACKUP_DIR, b["name"]))
            except OSError:
                pass


def backup_auto():
    """One automatic copy a week, the newest 8 kept."""
    if not os.path.exists(STORE_FILE):
        return None
    autos = [b for b in backup_list() if b["kind"] == "auto"]
    if autos and time.time() - autos[0]["t"] < BACKUP_EVERY:
        return None
    path = backup_write(BACKUP_DIR, "auto")
    backup_prune()
    return path


def backup_validate(obj):
    if not isinstance(obj, dict) or obj.get("app") != "Mo Stocks" or not isinstance(obj.get("data"), dict):
        raise ValueError("هذا الملف ليس نسخة احتياطية من Mo Stocks.")
    return obj


def backup_restore(obj):
    obj = backup_validate(obj)
    backup_write(BACKUP_DIR, "before-restore")  # so a restore can always be undone
    backup_prune()
    data = dict(obj["data"])
    prefs = data.pop("prefs", None)
    with Store.lock:
        tmp = STORE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, STORE_FILE)
    if prefs is not None:
        Store.set("prefs", prefs)  # goes through the filter that keeps secrets out of the file
    if isinstance(obj.get("fundPrices"), dict):
        with SNAP_LOCK:
            with open(SNAP_FILE + ".tmp", "w", encoding="utf-8") as f:
                json.dump(obj["fundPrices"], f)
            os.replace(SNAP_FILE + ".tmp", SNAP_FILE)
    with MEM_LOCK:
        for k in [k for k in MEM if k.startswith("h|FUND|")]:
            del MEM[k]
    return {"ok": True, "keys": len(data) + (1 if prefs is not None else 0), "created": obj.get("created"), "version": obj.get("version")}


def backup_refresher():
    while not QUIT.is_set():
        try:
            backup_auto()
        except Exception as e:
            record("WARN", "backup", e)
        QUIT.wait(6 * 3600)


def reveal(path):
    if not os.path.exists(path):
        return
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path)])
