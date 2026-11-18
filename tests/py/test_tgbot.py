"""2.18: Telegram commands are taken only from the registered chat."""
import core
import tgbot


def upd(uid, chat, text):
    return {"update_id": uid, "message": {"chat": {"id": chat}, "text": text, "date": 1795000000}}


def test_only_the_registered_chat_is_taken_and_the_offset_moves_on(monkeypatch):
    core.Store.set("prefs", {"telegram": {"enabled": True, "chatId": "555", "commands": True}})
    core.Store.set("tgOffset", 0)
    tgbot.pending()
    sent = []

    def call(method, params=None, token=None):
        sent.append((method, dict(params)))
        return {"ok": True, "result": [upd(10, 555, "1120"), upd(11, 999, "محفظتي"), upd(12, "555", "  "), upd(13, 555, "تنبيه 1120 فوق 65")]}
    got = tgbot.poll_once(call)
    assert [g["text"] for g in got] == ["1120", "تنبيه 1120 فوق 65"], "the other chat and the empty message are dropped"
    assert core.Store.get("tgOffset") == 14 and sent[0][1]["offset"] == 0 and sent[0][1]["timeout"] == 15
    assert [x["id"] for x in tgbot.pending()] == [10, 13] and tgbot.pending() == [], "handed over once"
    tgbot.poll_once(lambda m, p=None, token=None: sent.append(p) or {"result": []})
    assert sent[-1]["offset"] == 14, "already-read messages are not asked for again"
    assert tgbot.STATE["ignored"] >= 1


def test_commands_are_off_unless_switched_on(monkeypatch):
    monkeypatch.setattr(tgbot, "tg_token", lambda: "t")
    core.Store.set("prefs", {"telegram": {"enabled": True, "chatId": "555"}})
    assert not tgbot.enabled()
    core.Store.set("prefs", {"telegram": {"enabled": True, "chatId": "555", "commands": True}})
    assert tgbot.enabled()
    core.Store.set("prefs", {"telegram": {"enabled": True, "chatId": "", "commands": True}})
    assert not tgbot.enabled(), "no registered chat: nothing is taken"
