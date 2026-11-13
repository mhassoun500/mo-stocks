# -*- coding: utf-8 -*-
"""Optional links to AI assistants for a written second opinion on an analysis.

Supported: Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), Grok (xAI), and any
OpenAI-compatible service (DeepSeek, OpenRouter, Mistral, a local Ollama...).
Each key is kept encrypted on this computer (Windows DPAPI / macOS Keychain) and is only
sent to that provider. The page builds the prompt; this module only carries it.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

import tvdata

PROVIDERS = {
    "claude": {"name": "Claude", "company": "Anthropic", "web": True, "prefix": "sk-ant-",
               "keys": "https://console.anthropic.com/settings/keys",
               "prefer": ["claude-sonnet", "claude-opus", "claude-haiku"]},
    "openai": {"name": "ChatGPT", "company": "OpenAI", "web": False, "prefix": "sk-",
               "keys": "https://platform.openai.com/api-keys", "base": "https://api.openai.com/v1",
               "prefer": ["gpt-5", "gpt-4.1", "gpt-4o", "o4", "o3"]},
    "gemini": {"name": "Gemini", "company": "Google", "web": True, "prefix": "",
               "keys": "https://aistudio.google.com/apikey",
               "prefer": ["gemini-3-pro", "gemini-3-flash", "gemini-2.5-pro", "gemini-2.5-flash"]},
    "grok": {"name": "Grok", "company": "xAI", "web": False, "prefix": "xai-",
             "keys": "https://console.x.ai", "base": "https://api.x.ai/v1", "prefer": ["grok-4", "grok-3"]},
    "custom": {"name": "OpenAI-compatible", "company": "", "web": False, "prefix": "", "keys": "", "prefer": []},
}
UA = "MoStocks"


class AIError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message

    def friendly(self):
        m = self.message or ""
        low = m.lower()
        if self.code == 401 or (self.code in (400, 403) and ("api key" in low or "api_key" in low or "auth" in low)):
            return "المفتاح مرفوض. تأكد أنك نسخته كاملًا وأنه ما زال فعّالًا."
        if self.code == 404:
            return "اسم النموذج غير متاح لحسابك: %s" % m
        if self.code == 429 or "quota" in low or "rate" in low:
            return "تجاوزت حد الاستخدام أو نفد رصيد حسابك. حاول لاحقًا أو اشحن الرصيد."
        if "credit" in low or "balance" in low or "billing" in low:
            return "رصيد الحساب لا يكفي. اشحن الرصيد من موقع الشركة."
        if self.code in (500, 502, 503, 529):
            return "خوادم الخدمة مشغولة الآن. حاول بعد قليل."
        return "خطأ من الخدمة (%s): %s" % (self.code, m[:400])


def _http(url, body=None, headers=None, timeout=150):
    h = {"content-type": "application/json", "user-agent": UA}
    h.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8") if body is not None else None,
                                 method="POST" if body is not None else "GET", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            j = json.loads(raw)
            err = j.get("error") if isinstance(j, dict) else None
            msg = (err.get("message") if isinstance(err, dict) else err) or j.get("message") or raw
        except ValueError:
            msg = raw
        raise AIError(e.code, str(msg))


class AIHub:
    def __init__(self, data_dir):
        self.dir = data_dir

    # -------------------------------------------------------------- keys
    def _path(self, prov):
        return os.path.join(self.dir, "claude_key.bin" if prov == "claude" else "ai_%s.bin" % prov)

    @staticmethod
    def _svc(prov):
        return "StockZones Claude" if prov == "claude" else "StockZones AI %s" % prov

    def key(self, prov):
        return tvdata.secret_load(self._path(prov), self._svc(prov)) if prov in PROVIDERS else None

    def status(self):
        out = {}
        for p, info in PROVIDERS.items():
            k = self.key(p)
            out[p] = {"name": info["name"], "company": info["company"], "web": info["web"], "keysUrl": info["keys"],
                      "hasKey": bool(k), "hint": ("…" + k[-4:]) if k and len(k) > 8 else ("✓" if k else ""),
                      "storage": tvdata.secret_kind(self._path(p)) if k else ""}
        return {"ok": True, "providers": out}

    def save(self, prov, key):
        key = (key or "").strip()
        if prov not in PROVIDERS:
            return {"ok": False, "error": "خدمة غير معروفة."}
        pre = PROVIDERS[prov]["prefix"]
        if (pre and not key.startswith(pre)) or len(key) < (4 if prov == "custom" else 20):
            return {"ok": False, "error": "المفتاح لا يبدو صحيحًا%s." % (" (يبدأ بـ %s)" % pre if pre else "")}
        tvdata.secret_save(self._path(prov), key, self._svc(prov))
        return self.status()

    def delete(self, prov):
        if prov in PROVIDERS:
            tvdata.secret_delete(self._path(prov), self._svc(prov))
        return self.status()

    # -------------------------------------------------------------- calls
    @staticmethod
    def _base(prov, base):
        b = (base or PROVIDERS[prov].get("base") or "").strip().rstrip("/")
        if not b:
            raise AIError(0, "اكتب عنوان الخدمة (Base URL)، مثل https://api.deepseek.com/v1")
        if not b.startswith(("https://", "http://")):
            b = "https://" + b
        return b

    def models(self, prov, key=None, base=None):
        key = key or self.key(prov)
        if not key:
            return {"ok": False, "error": "أضف المفتاح أولًا."}
        try:
            if prov == "claude":
                j = _http("https://api.anthropic.com/v1/models?limit=100",
                          headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=30)
                ids = [m.get("id") for m in j.get("data") or []]
            elif prov == "gemini":
                j = _http("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                          headers={"x-goog-api-key": key}, timeout=30)
                ids = [m.get("name", "").replace("models/", "") for m in j.get("models") or []
                       if "generateContent" in (m.get("supportedGenerationMethods") or [])]
            else:
                j = _http(self._base(prov, base) + "/models", headers={"authorization": "Bearer " + key}, timeout=30)
                ids = [m.get("id") for m in j.get("data") or []]
        except AIError as e:
            return {"ok": False, "error": e.friendly() if e.code else e.message, "code": e.code}
        except Exception as e:
            return {"ok": False, "error": "تعذّر الاتصال بالخدمة: %s" % e}
        ids = [i for i in ids if i]
        if prov == "openai":  # keep chat models only
            ids = [i for i in ids if i.startswith(("gpt-", "o1", "o3", "o4", "chatgpt"))
                   and not any(x in i for x in ("audio", "realtime", "transcribe", "tts", "image", "embedding", "search"))]
        if prov == "gemini":
            ids = [i for i in ids if i.startswith("gemini") and not any(x in i for x in ("embedding", "tts", "image", "aqa"))]
        pref = PROVIDERS[prov]["prefer"]
        rank = lambda i: next((n for n, p in enumerate(pref) if i.startswith(p)), len(pref))
        fam = {}  # preferred families first; inside a family, stable releases first and newest (highest id) first
        for i in set(ids):
            fam.setdefault(rank(i), []).append(i)
        ordered = []
        for r in sorted(fam):
            ordered += sorted(fam[r], key=lambda i: ("preview" in i or "exp" in i, [-ord(c) for c in i]))
        return {"ok": True, "models": ordered, "suggested": ordered[0] if ordered else ""}

    def ask(self, prov, model, system, user, web=False, key=None, base=None, max_tokens=1800):
        if prov not in PROVIDERS:
            return {"ok": False, "error": "خدمة غير معروفة."}
        key = key or self.key(prov)
        if not key:
            return {"ok": False, "error": "أضف مفتاح %s أولًا من الإعدادات." % PROVIDERS[prov]["name"]}
        model = (model or "").strip()
        if not model:
            r = self.models(prov, key, base)
            model = r.get("suggested") if r.get("ok") else ""
            if not model:
                return {"ok": False, "error": r.get("error") or "اختر النموذج من الإعدادات."}
        web = bool(web and PROVIDERS[prov]["web"])
        try:
            try:
                res = self._call(prov, model, system, user, web, key, base, max_tokens)
            except AIError as e:
                if web and e.code == 400:  # search not enabled for this account/model: answer without it
                    res = self._call(prov, model, system, user, False, key, base, max_tokens)
                    res["noWeb"] = True
                else:
                    raise
        except AIError as e:
            return {"ok": False, "error": e.friendly() if e.code else e.message, "code": e.code}
        except Exception as e:
            return {"ok": False, "error": "تعذّر الاتصال بالخدمة: %s" % e}
        res.update(ok=True, provider=prov, name=PROVIDERS[prov]["name"])
        res.setdefault("model", model)
        return res

    def _call(self, prov, model, system, user, web, key, base, max_tokens):
        if prov == "claude":
            body = {"model": model, "max_tokens": max_tokens, "system": system,
                    "messages": [{"role": "user", "content": user}]}
            if web:
                body["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]
            j = _http("https://api.anthropic.com/v1/messages", body,
                      {"x-api-key": key, "anthropic-version": "2023-06-01"})
            blocks = j.get("content") or []
            return {"text": "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip(),
                    "searches": sum(1 for b in blocks if b.get("type") == "server_tool_use"), "model": j.get("model")}
        if prov == "gemini":
            body = {"system_instruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "generationConfig": {"maxOutputTokens": max_tokens * 4}}
            if web:
                body["tools"] = [{"google_search": {}}]
            j = _http("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % urllib.parse.quote(model),
                      body, {"x-goog-api-key": key})
            cand = (j.get("candidates") or [{}])[0]
            parts = (cand.get("content") or {}).get("parts") or []
            gm = cand.get("groundingMetadata") or {}
            return {"text": "\n".join(p.get("text", "") for p in parts if not p.get("thought")).strip(),
                    "searches": len(gm.get("webSearchQueries") or []), "model": model}
        # OpenAI and OpenAI-compatible (Grok, DeepSeek, OpenRouter...)
        body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if prov == "openai":
            body["max_completion_tokens"] = max_tokens * 4  # reasoning models spend tokens before answering
        else:
            body["max_tokens"] = max_tokens
        j = _http(self._base(prov, base) + "/chat/completions", body, {"authorization": "Bearer " + key})
        msg = ((j.get("choices") or [{}])[0].get("message") or {})
        text = msg.get("content") or ""
        if isinstance(text, list):
            text = "\n".join(x.get("text", "") for x in text if isinstance(x, dict))
        return {"text": text.strip(), "searches": 0, "model": j.get("model") or model}

    def test(self, prov, model, key=None, base=None):
        r = self.ask(prov, model, "Reply with the single word: OK", "ping", key=key, base=base, max_tokens=16)
        if r.get("ok"):
            r["text"] = "تم الاتصال بـ %s بنجاح (%s)." % (PROVIDERS[prov]["name"], r.get("model"))
        return r
