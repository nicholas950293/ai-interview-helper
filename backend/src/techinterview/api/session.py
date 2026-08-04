"""場次端點（T026、T068）。"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response

from techinterview.core.auth import (
    current_session_id,
    issue_session_cookie,
    redeem_token,
    require_writable_session,
)
from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import CollaborationModeRequest, RedeemRequest
from techinterview.db import queries

router = APIRouter(prefix="/api", tags=["session"])


@router.post("/session/redeem")
def redeem(body: RedeemRequest, response: Response) -> dict:
    """唯一不需 cookie 的端點。"""
    session_id = redeem_token(body.token)
    issue_session_cookie(response, session_id)

    row = queries.find_session(session_id)
    if row is None:
        raise AppError(ErrorCode.TOKEN_INVALID)

    return {
        "session": queries.to_public_session(row).model_dump(by_alias=True),
        # 供前端計算時鐘偏移（research R-007）
        "serverTime": queries.now_iso(),
    }


@router.get("/session")
def get_session(request: Request) -> dict:
    """頁面載入或重新整理時的完整還原（FR-003）。"""
    session_id = current_session_id(request)
    row = queries.find_session(session_id)
    if row is None:
        raise AppError(ErrorCode.UNAUTHORIZED)

    return {
        "session": queries.to_public_session(row).model_dump(by_alias=True),
        # list_session_questions 只回傳 testCount，predefined_tests 內容不外洩（FR-030）
        "questions": [
            q.model_dump(by_alias=True) for q in queries.list_session_questions(session_id)
        ],
        "answers": [a.model_dump(by_alias=True) for a in queries.list_answers(session_id)],
        # chat[].content 為 AI 的完整輸出；codeBlocks 供前端渲染套用按鈕
        "chat": [m.model_dump(by_alias=True) for m in queries.list_chat_messages(session_id)],
        "serverTime": queries.now_iso(),
    }


@router.patch("/session/collaboration-mode")
def set_collaboration_mode(request: Request, body: CollaborationModeRequest) -> dict:
    """切換協作模式（FR-012）。

    模式僅改變送往模型的系統提示，MUST NOT 限制 AI 輸出的完整性（憲章原則 I）。
    """
    row = require_writable_session(request)
    queries.update_collaboration_mode(row["id"], body.mode)
    return {"mode": body.mode.value}
