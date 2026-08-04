"""套用一致性的契約測試（T055）—— 憲章原則 I 的 CI 關卡。

SC-004：AI 產出的程式碼被套用後，編輯器內容與 AI 輸出完全一致的比例為 100%。
"""

from __future__ import annotations

import pytest
from tests.conftest import set_session_status

from techinterview.core.schemas import ChangeSource, ChatRole
from techinterview.db import queries

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def multi_block_message(test_db, fixture):
    """一則含三個程式碼區塊的 AI 回覆。"""
    blocks = [
        "const a = 1;\n",
        "function solve(x) {\n  return x * 2;\n}\n",
        "# python version\ndef solve(x):\n    return x * 2\n",
    ]
    body = "先看這個：\n\n"
    for i, b in enumerate(blocks):
        lang = "python" if i == 2 else "javascript"
        body += f"```{lang}\n{b}```\n\n"

    message = queries.insert_chat_message(
        session_id=fixture.session_id,
        question_id=fixture.question_ids[0],
        role=ChatRole.ASSISTANT,
        content=body,
    )
    queries.replace_code_blocks(
        message.id,
        [(0, "javascript", blocks[0]), (1, "javascript", blocks[1]), (2, "python", blocks[2])],
    )
    return message.id, blocks


async def test_apply_writes_block_verbatim(session_client, fixture, assistant_message):
    message_id, block_content = assistant_message

    res = await session_client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message_id, "blockIndex": 0},
    )

    assert res.status_code == 200, res.text
    body = res.json()
    # 逐字相同——不做 trim 以外的任何處理（FR-034）
    assert body["content"] == block_content

    stored = queries.find_answer(fixture.session_id, fixture.question_ids[0])
    assert stored is not None
    assert stored.content == block_content


async def test_apply_preserves_whitespace_and_indentation(session_client, fixture):
    """縮排、空行、行尾空白都可能有意義，套用時 MUST NOT 正規化。"""
    tricky = "def f():\n\n    x = 1   \n\n\n    return x\n"
    message = queries.insert_chat_message(
        session_id=fixture.session_id,
        question_id=fixture.question_ids[0],
        role=ChatRole.ASSISTANT,
        content=f"```python\n{tricky}```",
    )
    queries.replace_code_blocks(message.id, [(0, "python", tricky)])

    res = await session_client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message.id, "blockIndex": 0},
    )

    assert res.json()["content"] == tricky


async def test_apply_only_selected_block_takes_effect(session_client, fixture, multi_block_message):
    """回覆含多個區塊時，只有被指定的那一個生效（US2 情境 5）。"""
    message_id, blocks = multi_block_message

    res = await session_client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message_id, "blockIndex": 1},
    )

    assert res.json()["content"] == blocks[1]
    stored = queries.find_answer(fixture.session_id, fixture.question_ids[0])
    assert stored.content == blocks[1]
    assert blocks[0] not in stored.content
    assert blocks[2] not in stored.content


async def test_apply_increments_revision(session_client, fixture, assistant_message):
    message_id, _ = assistant_message

    first = await session_client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message_id, "blockIndex": 0},
    )
    second = await session_client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message_id, "blockIndex": 0},
    )

    assert second.json()["revision"] > first.json()["revision"]


async def test_apply_records_ai_attribution(session_client, fixture, assistant_message):
    message_id, block_content = assistant_message

    await session_client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message_id, "blockIndex": 0},
    )

    changes = [dict(r) for r in queries.list_code_changes(fixture.session_id)]
    assert len(changes) == 1
    assert changes[0]["source"] == ChangeSource.AI
    assert changes[0]["chat_message_id"] == message_id
    assert changes[0]["block_index"] == 0
    assert changes[0]["content"] == block_content


async def test_apply_unknown_block_returns_block_not_found(
    session_client, fixture, assistant_message
):
    message_id, _ = assistant_message

    res = await session_client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message_id, "blockIndex": 99},
    )

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "BLOCK_NOT_FOUND"


async def test_apply_rejected_after_submission(session_client, fixture, assistant_message, test_db):
    message_id, _ = assistant_message
    set_session_status(test_db, fixture.session_id, "submitted")

    res = await session_client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message_id, "blockIndex": 0},
    )

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "SESSION_SUBMITTED"


async def test_apply_requires_session(client, fixture, assistant_message):
    message_id, _ = assistant_message

    res = await client.post(
        f"/api/answers/{fixture.question_ids[0]}/apply",
        json={"messageId": message_id, "blockIndex": 0},
    )

    assert res.status_code == 401
