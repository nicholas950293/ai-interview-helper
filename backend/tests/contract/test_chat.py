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
        async def fake(_prompt: str, _mode: str):
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

        async def fake(_prompt, _mode):
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

    async def test_discuss_mode_does_not_filter_output(self, session_client, fixture, scripted):
        """討論模式是提示層的意圖，不是輸出過濾——真有區塊仍須留存。"""
        await session_client.patch("/api/session/collaboration-mode", json={"mode": "discuss"})
        scripted("說明\n\n```js\nconst a = 1;\n```\n")

        body = await _start_stream(session_client, fixture.question_ids[0])
        events = parse_sse((await session_client.get(f"/api/chat/stream/{body['streamId']}")).text)
        blocks = next(d for e, d in events if e == "blocks")["codeBlocks"]

        assert len(blocks) == 1


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
