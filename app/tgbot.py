# -*- coding: utf-8 -*-
"""Commands sent to the Telegram bot (2.18).

The app asks Telegram for new messages (long polling, no server of ours in between). Only messages from the chat the
user registered in Settings are taken; anything else is ignored and never answered. The page reads the queue,
works out the answer with the same engine as the screen, and replies through telegram_send."""
import collections
import threading
import time

from core import Store, pref, record, tg_token
import system

QUEUE = collections.deque(maxlen=20)
LOCK = threading.Lock()
STATE = {"last": 0, "error": "", "ignored": 0}


def enabled():
    return bool(pref("telegram.enabled", False) and pref("telegram.commands", False) and tg_token() and pref("telegram.chatId", ""))


def take(updates, chat, offset):
    """New messages from the registered chat, and the next offset. Others are counted and dropped."""
    out, nxt = [], offset
    for u in updates or []:
        uid = u.get("update_id")
        if isinstance(uid, int):
            nxt = max(nxt, uid + 1)
        m = u.get("message") or {}
        text = (m.get("text") or "").strip()
        if not text:
            continue
        if str((m.get("chat") or {}).get("id")) != str(chat).strip():
            STATE["ignored"] += 1
            continue
        out.append({"id": uid, "text": text[:200], "t": int((m.get("date") or time.time()) * 1000)})
    return out, nxt


def poll_once(call=None):
    call = call or system.telegram_call
    offset = int(Store.get("tgOffset", 0) or 0)
    r = call("getUpdates", {"offset": offset, "timeout": 15, "allowed_updates": '["message"]'})
    got, nxt = take(r.get("result"), pref("telegram.chatId", ""), offset)
    if nxt != offset:
        Store.set("tgOffset", nxt)
    with LOCK:
        QUEUE.extend(got)
    STATE.update(last=int(time.time() * 1000), error="")
    return got


def pending():
    with LOCK:
        out = list(QUEUE)
        QUEUE.clear()
    return out


def loop(quit_event):
    while not quit_event.is_set():
        if not enabled():
            quit_event.wait(15)
            continue
        try:
            poll_once()
        except Exception as e:                      # offline, a wrong token, or a webhook set on the bot
            STATE["error"] = str(e)[:200]
            record("WARN", "tgbot.poll", e)
            quit_event.wait(60)
