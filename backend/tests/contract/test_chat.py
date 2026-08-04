"""AI 對話與 SSE 串流的契約測試（T058）。

**核心斷言**：回應內容與模型輸出完全相同，無任何攔截（憲章原則 I）。
"""

from __future__ import annotations

import json

import pytest
from tests.conftest import set_session_status

from techinterview.ai import providers
from techinterview.db import queries

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def parse_sse(raw: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for chunk in raw.split("\n\n"):
        if not chunk.strip():
            continue
        event = "message"
        data = "{}"
        for line in chunk.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = line[len("data:") :].strip()
        events.append((event, json.loads(data)))
    return events


@pytest.fixture
def scripted(monkeypatch):
    """以腳本化回應取代模型，讓串流內容可逐字斷言。"""

    def _install(text: str):
        async def fake(_prompt: str):
            for i in range(0, len(text), 16):
                yield text[i : i + 16]

        monkeypatch.setattr(providers, "fake_stream", fake)
        return text

    return _install


async def _start_stream(client, question_id: str, content: str = "幫我實作", **kw):
    res = await client.post("/api/chat", json={"questionId": question_id, "content": content, **kw})
    assert res.status_code == 202, res.text
    return res.json()


class TestChatStream:
    async def test_returns_stream_and_message_ids(self, session_client, fixture):
        body = await _start_stream(session_client, fixture.question_ids[0])
        assert body["streamId"]
        assert body["messageId"]

    async def test_emits_token_blocks_done(self, session_client, fixture, scripted):
        text = scripted("說明文字\n\n```javascript\nconst a = 1;\n```\n")
        body = await _start_stream(session_client, fixture.question_ids[0])

        res = await session_client.get(f"/api/chat/stream/{body['streamId']}")
        events = parse_sse(res.text)
        names = [e for e, _ in events]

        assert "token" in names
        assert names[-2] == "blocks"
        assert names[-1] == "done"

        streamed = "".join(d["text"] for e, d in events if e == "token")
        # 逐字相同——沒有任何攔截或改寫（憲章原則 I）
        assert streamed == text

    async def test_full_output_persisted_verbatim(self, session_client, fixture, scripted):
        text = scripted("完整的實作在這裡\n\n```python\ndef f():\n    return 1\n```\n")
        body = await _start_stream(session_client, fixture.question_ids[0])
        await session_client.get(f"/api/chat/stream/{body['streamId']}")

        chat = (await session_client.get("/api/session")).json()["chat"]
        assistant = [m for m in chat if m["role"] == "assistant"][-1]
        assert assistant["content"] == text

    async def test_code_blocks_extracted_verbatim(self, session_client, fixture, scripted):
        block = "def f():\n    return 1\n"
        scripted(f"說明\n\n```python\n{block}```\n")
        body = await _start_stream(session_client, fixture.question_ids[0])

        events = parse_sse((await session_client.get(f"/api/chat/stream/{body['streamId']}")).text)
        blocks = next(d for e, d in events if e == "blocks")["codeBlocks"]

        assert len(blocks) == 1
        assert blocks[0]["blockIndex"] == 0
        assert blocks[0]["language"] == "python"
        assert blocks[0]["content"] == block

    async def test_multiple_blocks_each_indexed(self, session_client, fixture, scripted):
        scripted("```js\na\n```\n\ntext\n\n```py\nb\n```\n")
        body = await _start_stream(session_client, fixture.question_ids[0])

        events = parse_sse((await session_client.get(f"/api/chat/stream/{body['streamId']}")).text)
        blocks = next(d for e, d in events if e == "blocks")["codeBlocks"]

        assert [b["blockIndex"] for b in blocks] == [0, 1]

    async def test_candidate_and_assistant_both_persisted(self, session_client, fixture, scripted):
        scripted("回覆")
        body = await _start_stream(session_client, fixture.question_ids[0], content="我的提問")
        await session_client.get(f"/api/chat/stream/{body['streamId']}")

        chat = (await session_client.get("/api/session")).json()["chat"]
        assert len(chat) == 2
        assert chat[0]["role"] == "candidate"
        assert chat[0]["content"] == "我的提問"
        assert chat[1]["role"] == "assistant"

    async def test_attach_code_uses_last_saved_draft(self, session_client, fixture, scripted):
        scripted("收到")
        await session_client.put(
            f"/api/answers/{fixture.question_ids[0]}",
            json={"language": "python", "content": "DRAFT", "revision": 1},
        )
        body = await _start_stream(session_client, fixture.question_ids[0], attachCode=True)
        await session_client.get(f"/api/chat/stream/{body['streamId']}")

        chat = (await session_client.get("/api/session")).json()["chat"]
        assert chat[0]["attachedCode"] == "DRAFT"

    async def test_history_scoped_to_question(self, session_client, fixture, scripted):
        """切題後 AI MUST NOT 參照前一題內容（US3 情境 4）。"""
        scripted("ok")
        first = await _start_stream(session_client, fixture.question_ids[0], content="Q1 提問")
        await session_client.get(f"/api/chat/stream/{first['streamId']}")

        second = await _start_stream(session_client, fixture.question_ids[1], content="Q2 提問")
        await session_client.get(f"/api/chat/stream/{second['streamId']}")

        chat = (await session_client.get("/api/session")).json()["chat"]
        q2_messages = [m for m in chat if m["questionId"] == fixture.question_ids[1]]
        assert len(q2_messages) == 2

    async def test_stream_id_consumed_once(self, session_client, fixture, scripted):
        scripted("ok")
        body = await _start_stream(session_client, fixture.question_ids[0])

        assert (await session_client.get(f"/api/chat/stream/{body['streamId']}")).status_code == 200
        assert (await session_client.get(f"/api/chat/stream/{body['streamId']}")).status_code == 404

    async def test_rejected_after_submission(self, session_client, fixture, test_db):
        set_session_status(test_db, fixture.session_id, "submitted")
        res = await session_client.post(
            "/api/chat", json={"questionId": fixture.question_ids[0], "content": "還能問嗎"}
        )
        assert res.status_code == 409

    async def test_terminal_status_aborts_stream(
        self, session_client, fixture, test_db, monkeypatch
    ):
        """Edge Case：時間歸零當下 AI 正在回覆。"""

        async def fake(_prompt):
            yield "第一段"
            set_session_status(test_db, fixture.session_id, "expired_submitted")
            yield "第二段"

        monkeypatch.setattr(providers, "fake_stream", fake)
        body = await _start_stream(session_client, fixture.question_ids[0])

        events = parse_sse((await session_client.get(f"/api/chat/stream/{body['streamId']}")).text)
        tokens = [d["text"] for e, d in events if e == "token"]
        assert tokens == ["第一段"]
        assert events[-1][0] == "error"
        assert events[-1][1]["code"] == "SESSION_SUBMITTED"

    async def test_requires_cookie(self, client, fixture):
        res = await client.post(
            "/api/chat", json={"questionId": fixture.question_ids[0], "content": "x"}
        )
        assert res.status_code == 401


class TestNoOutputLimiting:
    """憲章原則 I：MUST NOT 以任何方式限制 AI 產出完整解答。"""

    async def test_full_implementation_passes_through_untouched(
        self, session_client, fixture, scripted
    ):
        full = (
            "這是完整實作：\n\n```javascript\n"
            "class RateLimiter {\n"
            "  constructor(max, windowMs) {\n"
            "    this.max = max;\n"
            "    this.windowMs = windowMs;\n"
            "    this.buckets = new Map();\n"
            "  }\n"
            "  allow(userId, ts) {\n"
            "    const b = this.buckets.get(userId) ?? [];\n"
            "    while (b.length && b[0] <= ts - this.windowMs) b.shift();\n"
            "    if (b.length >= this.max) return false;\n"
            "    b.push(ts);\n"
            "    this.buckets.set(userId, b);\n"
            "    return true;\n"
            "  }\n"
            "}\n```\n"
        )
        scripted(full)
        body = await _start_stream(
            session_client, fixture.question_ids[0], content="直接給我完整可執行的解答"
        )

        events = parse_sse((await session_client.get(f"/api/chat/stream/{body['streamId']}")).text)
        streamed = "".join(d["text"] for e, d in events if e == "token")

        # 舊憲章會攔截這種輸出；v3.0.0 之後 MUST 原樣通過
        assert streamed == full
        assert "class RateLimiter" in streamed
        assert not any(e == "replace" for e, _ in events)

        stored = queries.list_chat_messages(fixture.session_id)[-1]
        assert stored.content == full
        assert len(stored.code_blocks) == 1

    async def test_blocks_extracted_regardless_of_prompt_intent(
        self, session_client, fixture, scripted
    ):
        """區塊解析只看輸出內容，不看提問意圖。

        協作模式移除後，「要不要附程式碼」由模型依提問意圖決定。無論它基於什麼
        理由決定要附，只要輸出裡有區塊就 MUST 解析並留存——解析層 MUST NOT
        因為「這看起來像概念問題」而丟棄區塊，那會是變相的輸出過濾。
        """
        scripted("說明\n\n```js\nconst a = 1;\n```\n")

        body = await _start_stream(
            session_client, fixture.question_ids[0], content="這題該用什麼資料結構？"
        )
        events = parse_sse((await session_client.get(f"/api/chat/stream/{body['streamId']}")).text)
        blocks = next(d for e, d in events if e == "blocks")["codeBlocks"]

        assert len(blocks) == 1


class TestStreamIdleTimeout:
    """串流閒置逾時（`AI_STREAM_TIMEOUT_MS`）。

    真實踩過的情境：Gemini 回 429，SDK 內部退避重試約 34 秒才放棄，期間一個 token
    都沒有。而前端的 Next 代理在 30 秒切斷連線——後端 34 秒才送出的錯誤事件根本
    到不了瀏覽器，EventSource 只好重連、撞上 404，最後顯示的是「連線中斷」。
    使用者看到的原因與真正的原因無關。

    因此逾時以「**閒置**」計算而非總時長：完整實作本來就可能跑 30 秒以上，
    以總時長設限會砍掉正常的長回覆。只要 token 持續流動就不算逾時。
    """

    async def test_no_token_within_timeout_emits_ai_timeout(
        self, session_client, fixture, monkeypatch, test_settings
    ):
        import asyncio

        async def stalls(_prompt):
            await asyncio.sleep(10)  # 遠超過下方設定的逾時
            yield "永遠等不到"

        monkeypatch.setattr(providers, "fake_stream", stalls)
        monkeypatch.setattr(test_settings, "ai_first_token_timeout_ms", 150)
        monkeypatch.setattr(test_settings, "ai_stream_timeout_ms", 150)

        body = await _start_stream(session_client, fixture.question_ids[0])
        res = await session_client.get(f"/api/chat/stream/{body['streamId']}")
        events = parse_sse(res.text)

        assert [e for e, _ in events] == ["error"]
        assert events[0][1]["code"] == "AI_TIMEOUT"

    async def test_partial_output_is_preserved(
        self, session_client, fixture, monkeypatch, test_settings
    ):
        """逾時前已送出的內容 MUST 留存——那是應試者看得到的協作歷程。"""
        import asyncio

        async def stalls_midway(_prompt):
            yield "開始寫："
            await asyncio.sleep(10)
            yield "永遠等不到"

        monkeypatch.setattr(providers, "fake_stream", stalls_midway)
        monkeypatch.setattr(test_settings, "ai_first_token_timeout_ms", 5_000)
        monkeypatch.setattr(test_settings, "ai_stream_timeout_ms", 150)

        body = await _start_stream(session_client, fixture.question_ids[0])
        res = await session_client.get(f"/api/chat/stream/{body['streamId']}")
        events = parse_sse(res.text)

        assert [e for e, _ in events] == ["token", "error"]
        assert events[0][1]["text"] == "開始寫："
        stored = queries.list_chat_messages(fixture.session_id)[-1]
        assert stored.content == "開始寫："

    async def test_slow_but_progressing_stream_is_not_cut(
        self, session_client, fixture, monkeypatch, test_settings
    ):
        """只要 token 持續流動就不逾時——總時長超過設定值也一樣。"""
        import asyncio

        async def slow_but_alive(_prompt):
            for part in ("一", "二", "三", "四"):
                await asyncio.sleep(0.06)
                yield part

        monkeypatch.setattr(providers, "fake_stream", slow_but_alive)
        # 每段間隔 60ms < 100ms 逾時，但總時長 240ms > 100ms
        monkeypatch.setattr(test_settings, "ai_first_token_timeout_ms", 5_000)
        monkeypatch.setattr(test_settings, "ai_stream_timeout_ms", 100)

        body = await _start_stream(session_client, fixture.question_ids[0])
        res = await session_client.get(f"/api/chat/stream/{body['streamId']}")
        events = parse_sse(res.text)

        assert [e for e, _ in events].count("error") == 0
        assert "done" in [e for e, _ in events]
        assert "".join(d["text"] for e, d in events if e == "token") == "一二三四"

    async def test_slow_first_token_is_not_cut_by_idle_budget(
        self, session_client, fixture, monkeypatch, test_settings
    ):
        """thinking 模型的長時間靜默 MUST NOT 被 idle 門檻砍掉。

        實測 gemini-3.5-flash 要 44 秒才吐第一個 token（總時長 56 秒，成功完成）。
        若用 idle 的門檻去卡第一個 token，正常的完整實作會被當成故障中止。
        """
        import asyncio

        async def thinks_then_answers(_prompt):
            await asyncio.sleep(0.3)  # 遠超過 idle 門檻，但在 first_token 預算內
            yield "想完了，這是實作："

        monkeypatch.setattr(providers, "fake_stream", thinks_then_answers)
        monkeypatch.setattr(test_settings, "ai_first_token_timeout_ms", 5_000)
        monkeypatch.setattr(test_settings, "ai_stream_timeout_ms", 50)

        body = await _start_stream(session_client, fixture.question_ids[0])
        res = await session_client.get(f"/api/chat/stream/{body['streamId']}")
        events = parse_sse(res.text)

        assert "error" not in [e for e, _ in events]
        assert "done" in [e for e, _ in events]
        assert "".join(d["text"] for e, d in events if e == "token") == "想完了，這是實作："


class TestSystemMessage:
    async def test_creates_system_message(self, session_client, fixture):
        res = await session_client.post(
            "/api/chat/system",
            json={
                "fromQuestionId": fixture.question_ids[0],
                "toQuestionId": fixture.question_ids[1],
            },
        )

        assert res.status_code == 201
        message = res.json()["message"]
        assert message["role"] == "system"
        assert message["questionId"] == fixture.question_ids[1]
        assert "已切換" in message["content"]

    async def test_unknown_target_question(self, session_client, fixture):
        res = await session_client.post(
            "/api/chat/system",
            json={"fromQuestionId": fixture.question_ids[0], "toQuestionId": "q-nope"},
        )
        assert res.status_code == 404
