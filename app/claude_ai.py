# -*- coding: utf-8 -*-
"""Optional link to Claude (Anthropic API) for a written second opinion on an analysis.

The user pastes an API key from console.anthropic.com in the settings. The key is kept
encrypted on this computer (Windows DPAPI / macOS Keychain) and is only ever sent to
api.anthropic.com. Usage is billed to the user's own API account.
"""
import json
import urllib.error
import urllib.request

import tvdata

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
KEYCHAIN = "StockZones Claude"
MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]
DEFAULT_MODEL = MODELS[0]
WEB_TOOL = {"type": "web_search_20250305", "name": "web_search", "max_uses": 3}

SYSTEM_AR = """أنت محلل أسهم خبير يعمل داخل برنامج «Mo Stocks» لتحليل الأسهم والذهب.
تصلك بيانات سهم واحد محسوبة آليًا: السعر، مناطق الدعم والمقاومة، الأهداف، وقف الخسارة، المؤشرات الفنية، النماذج، بيانات الشركة المالية، تقديرات السعر العادل، وحكم التوافق الشرعي.
المطلوب: رأي ثانٍ مستقل ومختصر بالعربية الفصحى البسيطة، مرتب بهذه العناوين بالضبط (كل عنوان في سطر يبدأ بـ ## ):
## الخلاصة
جملتان: الوضع الآن وما الأنسب لمستثمر لا يملك السهم ولمن يملكه.
## الوضع الفني
## القيمة والأساسيات
## خطة التداول
اذكر الدخول والوقف والأهداف الثلاثة بالأرقام، وعدّلها إن رأيت أن الآلية أخطأت مع ذكر السبب.
## المخاطر
## ما يجب مراقبته
قواعد: استخدم الأرقام المرسلة ولا تخترع أرقامًا. إذا بحثت في الإنترنت فاذكر الخبر وتاريخه باختصار. استخدم نقاطًا قصيرة تبدأ بـ - . لا تزد عن 350 كلمة.
اختم بسطر واحد: «هذا رأي تحليلي وليس توصية استثمارية.»"""

SYSTEM_EN = """You are an expert equity analyst inside the "Mo Stocks" stock and gold analysis app.
You receive machine-computed data for one stock: price, support/resistance zones, targets, stop-loss, technical indicators, chart patterns, company financials, fair-value estimates and the Sharia-compliance verdict.
Give an independent, concise second opinion in plain English under exactly these headings (each on its own line starting with ## ):
## Summary
## Technical picture
## Value and fundamentals
## Trading plan
Give entry, stop and the three targets as numbers; adjust them if you think the machine got them wrong, and say why.
## Risks
## What to watch
Rules: use the numbers you are given and never invent figures. If you search the web, cite the news item and its date briefly. Use short bullets starting with - . At most 350 words.
End with one line: "This is analysis, not investment advice." """


class Claude:
    def __init__(self, path):
        self.path = path

    def key(self):
        return tvdata.secret_load(self.path, KEYCHAIN)

    def status(self):
        k = self.key()
        return {"hasKey": bool(k), "hint": ("…" + k[-4:]) if k else "", "storage": tvdata.secret_kind(self.path) if k else "",
                "models": MODELS, "defaultModel": DEFAULT_MODEL}

    def save(self, key):
        key = (key or "").strip()
        if not key.startswith("sk-ant-") or len(key) < 30:
            return {"ok": False, "error": "المفتاح غير صحيح. يبدأ مفتاح Claude بـ sk-ant- وتجده في console.anthropic.com."}
        tvdata.secret_save(self.path, key, KEYCHAIN)
        return dict(self.status(), ok=True)

    def delete(self):
        tvdata.secret_delete(self.path, KEYCHAIN)
        return dict(self.status(), ok=True)

    # ------------------------------------------------------------------ API
    def _post(self, body, key, timeout=120):
        req = urllib.request.Request(API_URL, data=json.dumps(body).encode("utf-8"), method="POST", headers={
            "x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read().decode("utf-8")).get("error") or {}
            except Exception:
                err = {}
            raise ClaudeError(e.code, err.get("type") or "", err.get("message") or str(e))

    def ask(self, model, system, user, web=False, max_tokens=1600, key=None):
        key = key or self.key()
        if not key:
            return {"ok": False, "error": "أضف مفتاح Claude أولًا من الإعدادات ← الربط مع Claude."}
        model = (model or DEFAULT_MODEL).strip()
        body = {"model": model, "max_tokens": max_tokens, "system": system,
                "messages": [{"role": "user", "content": user}]}
        if web:
            body["tools"] = [WEB_TOOL]
        try:
            res = self._post(body, key)
        except ClaudeError as e:
            if web and e.code == 400:  # web search not enabled for this account or model: answer without it
                body.pop("tools", None)
                try:
                    res = self._post(body, key)
                    res["_noWeb"] = True
                except ClaudeError as e2:
                    return {"ok": False, "error": e2.friendly(), "code": e2.code}
            else:
                return {"ok": False, "error": e.friendly(), "code": e.code}
        except Exception as e:
            return {"ok": False, "error": "تعذّر الاتصال بـ Claude: %s" % e}
        text = "\n".join(b.get("text", "") for b in res.get("content") or [] if b.get("type") == "text").strip()
        searches = sum(1 for b in res.get("content") or [] if b.get("type") == "server_tool_use")
        u = res.get("usage") or {}
        return {"ok": True, "text": text, "model": res.get("model") or model, "searches": searches,
                "noWeb": bool(res.get("_noWeb")), "usage": {"in": u.get("input_tokens"), "out": u.get("output_tokens")},
                "stop": res.get("stop_reason")}

    def test(self, model, key=None):
        r = self.ask(model, "Reply with the single word: OK", "ping", max_tokens=10, key=key)
        if r.get("ok"):
            r["text"] = "تم الاتصال بـ Claude بنجاح (%s)." % r.get("model")
        return r

    def analyze(self, payload, model=None, web=False, lang="ar", question=""):
        system = SYSTEM_EN if lang == "en" else SYSTEM_AR
        intro = ("Analyse this stock. Data from the app (JSON):\n" if lang == "en"
                 else "حلّل هذا السهم. بيانات البرنامج (JSON):\n")
        user = intro + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if question:
            user += ("\n\nThe user also asks: " if lang == "en" else "\n\nويسأل المستخدم أيضًا: ") + question.strip()[:800]
        if web:
            user += ("\n\nYou may search the web for the latest news, results and analyst views on this company."
                     if lang == "en" else "\n\nيمكنك البحث في الإنترنت عن آخر أخبار الشركة ونتائجها وآراء المحللين.")
        return self.ask(model, system, user, web=web)


class ClaudeError(Exception):
    def __init__(self, code, kind, message):
        super().__init__(message)
        self.code, self.kind, self.message = code, kind, message

    def friendly(self):
        if self.code == 401:
            return "مفتاح Claude مرفوض. تأكد أنك نسخته كاملًا وأنه ما زال فعّالًا."
        if self.code == 403:
            return "المفتاح لا يملك صلاحية لهذا الطلب: %s" % self.message
        if self.code == 404:
            return "اسم النموذج غير متاح لحسابك: %s" % self.message
        if self.code == 429:
            return "تجاوزت حد الاستخدام في حسابك مؤقتًا. حاول بعد دقيقة."
        if self.code == 400 and "credit" in self.message.lower():
            return "رصيد حساب Claude لا يكفي. اشحن الرصيد من console.anthropic.com ← Billing."
        if self.code in (500, 529):
            return "خوادم Claude مشغولة الآن. حاول بعد قليل."
        return "خطأ من Claude (%s): %s" % (self.code, self.message)
