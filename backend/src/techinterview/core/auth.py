"""邀請 token 兌換與 session cookie（T025）。

除 `POST /api/session/redeem` 外，所有端點以 HttpOnly session cookie 授權（research R-009）。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import Request, Response
from itsdangerous import BadSignature, URLSafeSerializer

from techinterview.core.config import get_settings
from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import SessionStatus
from techinterview.db import queries
from techinterview.domain.session_state import is_terminal

COOKIE_NAME = "session"
# Cookie 壽命略長於最長場次，避免作答中途失效；場次終態後不再有寫入權。
COOKIE_MAX_AGE_SEC = 6 * 60 * 60
_SALT = "techinterview.session"


def _serializer() -> URLSafeSerializer:
    return URLSafeSerializer(get_settings().session_secret, salt=_SALT)


def redeem_token(token: str) -> str:
    """兌換邀請 token，回傳 session id。

    - 首次兌換：寫入 started_at 與 deadline_at，狀態轉為 in_progress
    - 重複兌換且場次仍 in_progress：沿用既有場次，MUST NOT 重置 deadline_at
    - token 逾期、場次已終態：拒絕，MUST NOT 讓應試者進入可作答狀態（FR-031）
    """
    invite = queries.find_invite_token(token)
    if invite is None:
        raise AppError(ErrorCode.TOKEN_INVALID)

    session = queries.find_session(invite["session_id"])
    if session is None:
        raise AppError(ErrorCode.TOKEN_INVALID)

    # 場次終態優先於 token 逾期回報：對應試者而言「已提交」是更精確的說明。
    if is_terminal(SessionStatus(session["status"])):
        raise AppError(ErrorCode.SESSION_SUBMITTED)

    expires = datetime.fromisoformat(invite["expires_at"].replace("Z", "+00:00"))
    if expires <= datetime.now(UTC):
        raise AppError(ErrorCode.TOKEN_EXPIRED)

    if SessionStatus(session["status"]) is SessionStatus.NOT_STARTED:
        started_at = datetime.now(UTC)
        deadline_at = started_at + timedelta(seconds=session["duration_sec"])
        started_iso = started_at.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        deadline_iso = deadline_at.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        queries.start_session(session["id"], started_iso, deadline_iso)
        queries.mark_token_used(token, started_iso)

    return str(session["id"])


def issue_session_cookie(response: Response, session_id: str) -> None:
    settings = get_settings()
    response.set_cookie(
        COOKIE_NAME,
        _serializer().dumps(session_id),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
        max_age=COOKIE_MAX_AGE_SEC,
    )


def current_session_id(request: Request) -> str:
    """FastAPI 相依：驗證 cookie 並回傳 session id。"""
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        raise AppError(ErrorCode.UNAUTHORIZED)

    try:
        session_id = _serializer().loads(raw)
    except BadSignature as exc:
        raise AppError(ErrorCode.UNAUTHORIZED) from exc

    if not isinstance(session_id, str) or queries.find_session(session_id) is None:
        raise AppError(ErrorCode.UNAUTHORIZED)

    return session_id


def require_writable_session(request: Request):
    """取得場次並確認可寫入；寫入類端點的共用相依。"""
    from techinterview.domain.session_state import assert_writable

    session_id = current_session_id(request)
    row = queries.find_session(session_id)
    if row is None:
        raise AppError(ErrorCode.UNAUTHORIZED)
    assert_writable(SessionStatus(row["status"]))
    return row
