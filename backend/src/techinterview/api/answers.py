"""作答端點（T040）與套用 AI 產出（T066）。"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import ValidationError

from techinterview.core.auth import require_writable_session
from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import (
    ApplyBlockRequest,
    SaveAnswerBatchItem,
    SaveAnswerRequest,
)
from techinterview.db import queries
from techinterview.domain import attribution

router = APIRouter(prefix="/api", tags=["answers"])


def _validation_error(exc: ValidationError) -> AppError:
    """content 長度的 refine 以 CONTENT_TOO_LARGE 作為訊息，於此轉為 413。"""
    if any("CONTENT_TOO_LARGE" in str(e.get("msg", "")) for e in exc.errors()):
        return AppError(ErrorCode.CONTENT_TOO_LARGE)
    return AppError(ErrorCode.BAD_REQUEST)


def _apply_save(session_id: str, question_id: str, body: SaveAnswerRequest) -> dict:
    if not queries.is_question_in_session(session_id, question_id):
        raise AppError(ErrorCode.NOT_FOUND)

    existing = queries.find_answer(session_id, question_id)
    if existing and body.revision <= existing.revision:
        raise AppError(
            ErrorCode.REVISION_STALE,
            details={"revision": existing.revision, "savedAt": existing.saved_at},
        )

    saved_at, revision = queries.upsert_answer(
        session_id=session_id,
        question_id=question_id,
        language=body.language,
        content=body.content,
        revision=body.revision,
    )

    # 應試者自行輸入的變更；與最近一次 ai 變更相同時不重複記錄（research R-014）
    attribution.record_candidate_change(
        session_id=session_id,
        question_id=question_id,
        content=body.content,
        revision=revision,
    )

    return {"savedAt": saved_at, "revision": revision}


@router.put("/answers/{question_id}")
async def save_answer(question_id: str, request: Request) -> dict:
    """前端於停止輸入 1000ms 後呼叫（FR-004）。"""
    row = require_writable_session(request)
    try:
        body = SaveAnswerRequest.model_validate(await request.json())
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    except Exception as exc:  # noqa: BLE001
        raise AppError(ErrorCode.BAD_REQUEST) from exc

    return _apply_save(row["id"], question_id, body)


@router.put("/answers")
async def save_answers_batch(request: Request) -> dict:
    """離線補送。

    依 revision 排序套用；批次中個別的落後 revision 會被略過而非讓整批失敗，
    否則一筆過期的離線變更就會擋住其他題目的補送（FR-028）。
    """
    row = require_writable_session(request)
    try:
        items = [SaveAnswerBatchItem.model_validate(i) for i in await request.json()]
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    except Exception as exc:  # noqa: BLE001
        raise AppError(ErrorCode.BAD_REQUEST) from exc

    saved = []
    for item in sorted(items, key=lambda i: i.revision):
        try:
            result = _apply_save(
                row["id"],
                item.question_id,
                SaveAnswerRequest(
                    language=item.language, content=item.content, revision=item.revision
                ),
            )
        except AppError as exc:
            if exc.code in (ErrorCode.REVISION_STALE, ErrorCode.NOT_FOUND):
                continue
            raise
        saved.append({"questionId": item.question_id, **result})

    return {"saved": saved}


@router.post("/answers/{question_id}/apply")
async def apply_code_block(question_id: str, request: Request) -> dict:
    """套用 AI 產出的程式碼區塊（FR-033 ~ FR-035）。

    為什麼要往返後端而不是前端直接改編輯器：若走一般的 debounce 保存路徑，
    這次變更會與應試者自行輸入無法區分——正是憲章原則 I 禁止的「混為一談」。
    """
    row = require_writable_session(request)
    session_id = row["id"]

    try:
        body = ApplyBlockRequest.model_validate(await request.json())
    except (ValidationError, ValueError) as exc:
        raise AppError(ErrorCode.BAD_REQUEST) from exc

    if not queries.is_question_in_session(session_id, question_id):
        raise AppError(ErrorCode.NOT_FOUND)

    message = queries.find_message(body.message_id)
    if message is None or message["session_id"] != session_id:
        raise AppError(ErrorCode.BLOCK_NOT_FOUND)

    block = queries.find_code_block(body.message_id, body.block_index)
    if block is None:
        raise AppError(ErrorCode.BLOCK_NOT_FOUND)

    existing = queries.find_answer(session_id, question_id)
    revision = (existing.revision if existing else 0) + 1
    language = existing.language if existing else None
    if language is None:
        from techinterview.core.schemas import Language

        language = Language.JAVASCRIPT

    # 逐字寫入，MUST NOT 有任何裁切、改寫或格式調整（FR-034）
    saved_at, revision = queries.upsert_answer(
        session_id=session_id,
        question_id=question_id,
        language=language,
        content=block["content"],
        revision=revision,
    )

    attribution.record_ai_change(
        session_id=session_id,
        question_id=question_id,
        content=block["content"],
        revision=revision,
        chat_message_id=body.message_id,
        block_index=body.block_index,
    )

    return {"content": block["content"], "savedAt": saved_at, "revision": revision}
