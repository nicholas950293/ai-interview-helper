"""AI 對話端點（T065、T082）。

**本模組沒有任何輸出限制層**——沒有 prompt 圍欄、沒有輸出後處理、沒有區塊過濾。
憲章 v3.0.0 的原則 I 明文禁止（見 research R-015）。
"""

from __future__ import annotations

import uuid
from time import time

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from techinterview.ai.streaming import PendingStream, context_from_session, stream_response
from techinterview.core.auth import current_session_id, require_writable_session
from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import (
    ChatRequest,
    ChatRole,
    ChatSystemRequest,
)
from techinterview.db import queries

router = APIRouter(prefix="/api", tags=["chat"])

# 待取用的串流；POST 建立，GET 消費一次後移除。
_PENDING: dict[str, tuple[PendingStream, float]] = {}
_TTL_SEC = 60.0


def _reap() -> None:
    cutoff = time() - _TTL_SEC
    for key in [k for k, (_, created) in _PENDING.items() if created < cutoff]:
        _PENDING.pop(key, None)


def _history(session_id: str, question_id: str) -> list[tuple[str, str]]:
    """只取同一題的對話——切題後 AI MUST NOT 參照前一題內容（US3 情境 4）。"""
    return [
        (m.role.value, m.content)
        for m in queries.list_chat_messages(session_id)
        if m.question_id == question_id and m.role is not ChatRole.SYSTEM and m.content
    ]


@router.post("/chat", status_code=202)
async def post_chat(request: Request) -> dict:
    row = require_writable_session(request)
    session_id = row["id"]

    try:
        body = ChatRequest.model_validate(await request.json())
    except Exception as exc:  # noqa: BLE001
        raise AppError(ErrorCode.BAD_REQUEST) from exc

    if not queries.is_question_in_session(session_id, body.question_id):
        raise AppError(ErrorCode.NOT_FOUND)

    question = next(
        (q for q in queries.list_session_questions(session_id) if q.id == body.question_id), None
    )
    if question is None:
        raise AppError(ErrorCode.NOT_FOUND)

    answer = queries.find_answer(session_id, body.question_id)
    # attachCode 時取該題最後保存的草稿；前端 MUST 先 flush（ui-contracts A-03）
    attached = (answer.content if answer else "") if body.attach_code else None
    history = _history(session_id, body.question_id)

    # 提問先落地——對話 MUST 完整留存（FR-015）
    queries.insert_chat_message(
        session_id=session_id,
        question_id=body.question_id,
        role=ChatRole.CANDIDATE,
        content=body.content,
        attached_code=attached,
        source=body.source,
    )
    assistant = queries.insert_chat_message(
        session_id=session_id,
        question_id=body.question_id,
        role=ChatRole.ASSISTANT,
        content="",
    )

    stream_id = str(uuid.uuid4())
    _reap()
    _PENDING[stream_id] = (
        PendingStream(
            session_id=session_id,
            message_id=assistant.id,
            context=context_from_session(row, question, answer, attached),
            prompt=body.content,
            history=history,
        ),
        time(),
    )

    return {"streamId": stream_id, "messageId": assistant.id}


@router.get("/chat/stream/{stream_id}")
def stream_chat(stream_id: str, request: Request) -> StreamingResponse:
    session_id = current_session_id(request)
    entry = _PENDING.pop(stream_id, None)
    if entry is None or entry[0].session_id != session_id:
        raise AppError(ErrorCode.NOT_FOUND)

    return StreamingResponse(
        stream_response(entry[0]),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat/system", status_code=201)
async def post_system_message(request: Request) -> dict:
    """題目切換的系統訊息（FR-019）。"""
    row = require_writable_session(request)
    session_id = row["id"]

    try:
        body = ChatSystemRequest.model_validate(await request.json())
    except Exception as exc:  # noqa: BLE001
        raise AppError(ErrorCode.BAD_REQUEST) from exc

    if not queries.is_question_in_session(session_id, body.to_question_id):
        raise AppError(ErrorCode.NOT_FOUND)

    questions = {q.id: q for q in queries.list_session_questions(session_id)}
    to_q = questions.get(body.to_question_id)
    from_q = questions.get(body.from_question_id)

    content = (
        f"已切換至 Q{to_q.order if to_q else '?'}「{to_q.title if to_q else body.to_question_id}」"
    )
    if from_q:
        content += f"（原本在 Q{from_q.order}「{from_q.title}」）"
    content += "。接下來的討論會以這一題為準。"

    message = queries.insert_chat_message(
        session_id=session_id,
        question_id=body.to_question_id,
        role=ChatRole.SYSTEM,
        content=content,
    )
    return {"message": message.model_dump(by_alias=True)}
