"""Phase 5, step 1: answers in pieces, tokens and cost, the monthly limit."""
import http.client
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import ai_providers as AP
import ai_usage
import core
import main
from prices import AI


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    core.Store.set("aiUsage", {})
    core.Store.set("prefs", {})
    monkeypatch.setattr(AI, "key", lambda prov: "k" * 30)
    yield


# ---------------------------------------------------------------- prices
def test_price_is_the_longest_matching_name_and_the_users_own_price_leads():
    assert ai_usage.price_of("claude-opus-4-5-20251101") == (5, 25)
    assert ai_usage.price_of("claude-opus-4-1-20250805") == (15, 75)
    assert ai_usage.price_of("gpt-5-mini-2025-08-07") == (0.25, 2)
    assert ai_usage.price_of("gemini-3.1-pro-preview") == (2, 12)
    assert ai_usage.price_of("some-local-model") is None, "unknown: no price, not zero"
    assert ai_usage.price_of("some-local-model", {"some-local-model": [1, 2]}) == (1.0, 2.0)
    assert ai_usage.cost("claude", "claude-sonnet-5-5", {"in": 1_000_000, "out": 100_000}, searches=2) == round(2 + 1 + 0.02, 6)
    assert ai_usage.cost("custom", "x", {"in": 5, "out": 5}) is None


# ---------------------------------------------------------------- reading the providers' streams
class SSE(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path == "/bad":
            body = json.dumps({"error": {"message": "invalid model"}}).encode()
            self.send_response(404)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for ev in ({"a": 1}, "not json", {"a": 2}):
            self.wfile.write(("event: x\ndata: %s\n\n" % (json.dumps(ev) if isinstance(ev, dict) else ev)).encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\ndata: {\"a\": 3}\n\n")


def test_sse_reader_against_a_real_http_stream():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), SSE)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    assert [e["a"] for e in AP._sse(base + "/ok", {}, {})] == [1, 2], "bad lines skipped, stops at [DONE]"
    with pytest.raises(AP.AIError) as e:
        list(AP._sse(base + "/bad", {}, {}))
    assert e.value.code == 404 and "invalid model" in e.value.message
    srv.shutdown()


CLAUDE = [{"type": "message_start", "message": {"model": "claude-sonnet-5-5", "usage": {"input_tokens": 1000, "output_tokens": 1}}},
          {"type": "content_block_start", "content_block": {"type": "server_tool_use"}},
          {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "مرحبا "}},
          {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "بك"}},
          {"type": "message_delta", "usage": {"output_tokens": 500}}, {"type": "message_stop"}]
GEMINI = [{"candidates": [{"content": {"parts": [{"text": "think", "thought": True}, {"text": "A"}]}}]},
          {"candidates": [{"content": {"parts": [{"text": "B"}]}, "groundingMetadata": {"webSearchQueries": ["q"]}}],
           "usageMetadata": {"promptTokenCount": 200, "candidatesTokenCount": 30, "thoughtsTokenCount": 70}}]
OPENAI = [{"model": "gpt-5-mini", "choices": [{"delta": {"role": "assistant"}}]}, {"choices": [{"delta": {"content": "X"}}]},
          {"choices": [{"delta": {"content": "Y"}}]}, {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 4}}]


@pytest.mark.parametrize("prov,events,model,text,usage", [
    ("claude", CLAUDE, "claude-sonnet-5-5", "مرحبا بك", {"in": 1000, "out": 500}),
    ("gemini", GEMINI, "gemini-3-flash", "AB", {"in": 200, "out": 100}),
    ("openai", OPENAI, "gpt-5-mini", "XY", {"in": 10, "out": 4})])
def test_each_provider_streams_text_and_tokens(monkeypatch, prov, events, model, text, usage):
    sent = {}
    monkeypatch.setattr(AP, "_sse", lambda url, body, h, timeout=150: sent.update(url=url, body=body) or iter(events))
    got = []
    r = AI.stream(prov, model, "sys", "", got.append, web=True, messages=[{"role": "assistant", "content": "x"},
                                                                         {"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"},
                                                                         {"role": "user", "content": "q2"}])
    assert r["ok"] and "".join(got) == text and r["text"] == text and r["usage"] == usage, r
    assert r["cost"] is not None and r["monthCost"] == r["cost"]
    if prov == "claude":
        assert r["searches"] == 1 and sent["body"]["messages"][0] == {"role": "user", "content": "q1"}, "starts with the user"
    if prov == "gemini":
        assert "streamGenerateContent?alt=sse" in sent["url"] and [c["role"] for c in sent["body"]["contents"]] == ["user", "model", "user"]
    if prov == "openai":
        assert sent["body"]["stream"] and sent["body"]["stream_options"] == {"include_usage": True}
        assert sent["body"]["messages"][0]["role"] == "system"
    m = core.Store.get("aiUsage")["months"][ai_usage.month_key()]
    assert m["n"] == 1 and m["in"] == usage["in"]


def test_a_service_that_will_not_stream_answers_whole(monkeypatch):
    def no(url, body, h, timeout=150):
        raise AP.AIError(400, "stream_options not supported")
        yield
    monkeypatch.setattr(AP, "_sse", no)
    monkeypatch.setattr(AP, "_http", lambda url, body=None, headers=None, timeout=150: {"choices": [{"message": {"content": "whole"}}],
                                                                                      "usage": {"prompt_tokens": 3, "completion_tokens": 2}})
    got = []
    r = AI.stream("grok", "grok-4.7", "s", "q", got.append)
    assert r["ok"] and got == ["whole"] and r["streamed"] is False and r["usage"] == {"in": 3, "out": 2}


def test_a_cut_stream_keeps_what_arrived(monkeypatch):
    def cut(url, body, h, timeout=150):
        yield {"choices": [{"delta": {"content": "part"}}]}
        raise OSError("reset")
    monkeypatch.setattr(AP, "_sse", cut)
    r = AI.stream("openai", "gpt-5", "s", "q", lambda t: None)
    assert not r["ok"] and r["partial"] == "part"
    assert not core.Store.get("aiUsage"), "nothing finished, nothing counted"


# ---------------------------------------------------------------- the monthly limit
def test_the_monthly_limit_holds_new_requests_until_confirmed(monkeypatch):
    monkeypatch.setattr(AP, "_http", lambda url, body=None, headers=None, timeout=150: {"content": [{"type": "text", "text": "ok"}],
                                                                                      "usage": {"input_tokens": 1_000_000, "output_tokens": 0}})
    core.Store.set("prefs", {"aiCap": {"on": True, "usd": 3}})
    assert AI.ask("claude", "claude-sonnet-5-5", "s", "q")["ok"]          # 2$
    assert AI.ask("claude", "claude-sonnet-5-5", "s", "q")["ok"]          # 4$: over, but this one was already allowed
    r = AI.ask("claude", "claude-sonnet-5-5", "s", "q")
    assert not r["ok"] and r["capped"] == {"cap": 3.0, "spent": 4.0} and "الحد" in r["error"]
    assert AI.ask("claude", "claude-sonnet-5-5", "s", "q", override=True)["ok"], "confirmed by the user"
    assert AI.test("claude", "claude-sonnet-5-5")["ok"], "the key test is never held and never counted"
    s = ai_usage.summary()
    assert s["spent"] == 6.0 and s["cap"] == 3.0 and s["months"][s["month"]]["n"] == 3 and s["recent"][0]["kind"] == "ask"
    core.Store.set("prefs", {"aiCap": {"on": False, "usd": 3}})
    assert AI.ask("claude", "claude-sonnet-5-5", "s", "q")["ok"], "limit switched off"


# ---------------------------------------------------------------- the page's stream
def test_server_streams_json_lines(monkeypatch):
    monkeypatch.setattr(AP, "_sse", lambda url, body, h, timeout=150: iter(OPENAI))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
    main.SERVER_PORT[0] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request("POST", "/api/ai", body=json.dumps({"action": "stream", "provider": "openai", "model": "gpt-5-mini", "system": "s", "user": "q"}),
              headers={"Host": "127.0.0.1:%d" % port, "X-Mo-Token": main.API_TOKEN, "Content-Type": "application/json"})
    r = c.getresponse()
    lines = [json.loads(x) for x in r.read().decode().splitlines() if x.strip()]
    assert r.getheader("Content-Type").startswith("application/x-ndjson")
    assert [x["t"] for x in lines if "t" in x] == ["X", "Y"] and lines[-1]["done"] and lines[-1]["usage"] == {"in": 10, "out": 4}
    c.request("POST", "/api/ai", body=json.dumps({"action": "usage"}), headers={"Host": "127.0.0.1:%d" % port, "X-Mo-Token": main.API_TOKEN, "Content-Type": "application/json"})
    u = json.loads(c.getresponse().read())
    assert u["ok"] and u["months"][u["month"]]["n"] == 1 and u["checked"]
    srv.shutdown()
