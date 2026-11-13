import json

import ai_providers
import funds
import sharia
import tvdata


# ---------------------------------------------------------------- funds
def test_fund_history_parsing():
    rows = funds.parse_history("2026/10/26/00:00:00,57.49\n2026/10/27/00:00:00,57.6\nbad line\n2026/10/27/00:00:00,58\n")
    assert len(rows) == 2 and rows[-1][4] == 58


def test_fund_category_and_currency():
    assert funds.fund_category("صندوق الذهب") == "metals"
    assert funds.fund_category("صندوق المرابحة", "SA") == "money"
    assert funds.fund_category("صندوق الأسهم السعودية", "SA") == "equity"
    assert funds.fund_currency("صندوق بالدولار") == "USD"
    assert funds.fund_currency("صندوق", "SA") == "SAR"


def test_fund_sharia_rules():
    assert funds.fund_sharia(2680, "x", "", "EG") == "sponsor"
    assert funds.fund_sharia(1, "صندوق إسلامي", "", "EG") == "name"
    assert funds.fund_sharia(1, "صندوق", "الراجحي المالية", "SA") == "sponsor"
    assert funds.fund_sharia(1, "صندوق", "", "EG") == ""


# ---------------------------------------------------------------- sharia lists
ARGAAM = """<span class="inst_name">الراجحي المالية</span><br/><sup>x<br/><span>2026-01-01</span>
<span class="inst_name">العصيمي</span><br/><sup>x<br/><span>2026-02-01</span>
<tr><td class="stock-symbol"> 1120 </td><td class="argaam-font company-name"><a href="#">شركة مصرف الراجحي</a></td>
<td class="center">✔</td><td class="center"></td></tr>"""


def test_argaam_parser():
    refs, rows = sharia.parse_argaam(ARGAAM)
    assert refs[0] == ["الراجحي المالية", "2026-01-01"]
    assert rows["1120"] == {"n": "مصرف الراجحي", "v": "10"}


def test_egypt_verdicts():
    assert sharia._eg_verdict({"status": "compliant"}) == "1"
    assert sharia._eg_verdict({"status": "doubtful"}) == "2"
    assert sharia._eg_verdict(None) == "-"


# ---------------------------------------------------------------- price feed
def test_bars_to_rows_daily_keys_and_order():
    bars = [[1767254400 + 86400, 2, 3, 1, 2.5, 100], [1767254400, 1, 2, 0.5, 1.5, 50], [1767254400, 1, 2, 0.5, None, 0]]
    rows = tvdata.bars_to_rows(bars, {"timezone": "Asia/Riyadh"})
    assert [r[4] for r in rows] == [1.5, 2.5]
    assert rows[0][0] % 86400000 == 0


def test_secret_round_trip(tmp_path):
    p = str(tmp_path / "s.bin")
    tvdata.secret_save(p, "hello", "Test Service")
    assert tvdata.secret_load(p, "Test Service") == "hello"
    tvdata.secret_delete(p, "Test Service")
    assert tvdata.secret_load(p, "Test Service") is None


# ---------------------------------------------------------------- AI providers
def test_ai_key_checks(tmp_path):
    hub = ai_providers.AIHub(str(tmp_path))
    assert hub.save("claude", "wrong-key-xxxxxxxxxxxxxxxxxxxxxx").get("ok") is False
    assert hub.save("claude", "short").get("ok") is False
    st = hub.save("claude", "sk-ant-" + "a" * 40)
    assert st["providers"]["claude"]["hasKey"] and st["providers"]["claude"]["hint"] == "…aaaa"
    assert "a" * 40 not in json.dumps(hub.status())
    assert hub.delete("claude")["providers"]["claude"]["hasKey"] is False


def test_ai_error_messages():
    assert "مرفوض" in ai_providers.AIError(401, "invalid x-api-key").friendly()
    assert "مرفوض" in ai_providers.AIError(400, "API key not valid").friendly()
    assert "حد الاستخدام" in ai_providers.AIError(429, "rate limited").friendly()
    assert "مشغولة" in ai_providers.AIError(529, "overloaded").friendly()


def test_ai_model_list_ordering(tmp_path, monkeypatch):
    hub = ai_providers.AIHub(str(tmp_path))
    ids = ["gpt-4o", "gpt-5-mini", "gpt-5", "whisper-1", "gpt-4o-audio-preview", "gpt-5-preview", "o3"]
    monkeypatch.setattr(ai_providers, "_http", lambda *a, **k: {"data": [{"id": i} for i in ids]})
    r = hub.models("openai", key="sk-test")
    assert r["ok"] and r["models"][0].startswith("gpt-5")
    assert "whisper-1" not in r["models"] and "gpt-4o-audio-preview" not in r["models"]
    assert r["models"].index("gpt-5-preview") > r["models"].index("gpt-5")


def test_ai_request_shapes(tmp_path, monkeypatch):
    hub = ai_providers.AIHub(str(tmp_path))
    seen = {}

    def fake(url, body=None, headers=None, timeout=0):
        seen["url"], seen["body"], seen["headers"] = url, body, headers
        if "anthropic" in url:
            return {"content": [{"type": "text", "text": "hi"}], "model": "m"}
        if "googleapis" in url:
            return {"candidates": [{"content": {"parts": [{"text": "hi"}]}}]}
        return {"choices": [{"message": {"content": "hi"}}], "model": "m"}
    monkeypatch.setattr(ai_providers, "_http", fake)
    for prov, key, host in (("claude", "sk-ant-x", "anthropic"), ("gemini", "AIza", "googleapis"),
                            ("openai", "sk-x", "openai.com"), ("grok", "xai-x", "x.ai")):
        r = hub.ask(prov, "m", "sys", "user", web=True, key=key)
        assert r["ok"] and r["text"] == "hi" and host in seen["url"], prov
        assert key not in seen["url"], "keys travel in headers, never in the address"
    r = hub.ask("custom", "m", "s", "u", key="k", base="api.deepseek.com/v1")
    assert seen["url"] == "https://api.deepseek.com/v1/chat/completions"
