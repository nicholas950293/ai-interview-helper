"""提交規則（T093）。

憲章「提交不可逆」：提交 MUST 取每題最後一次成功保存的草稿——
那些內容已經在 `answer` 表裡，因此提交只需推進場次狀態，不搬動任何作答內容。
這也是為什麼 `POST /api/submit` 不接受 body：前端傳來的內容一律不採信。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import SessionStatus
from techinterview.db import queries
from techinterview.domain.session_state import is_terminal, next_status_for_submission


@dataclass(frozen=True)
class SubmissionResult:
    submitted_at: str
    status: SessionStatus


def _now_ms() -> float:
    return datetime.now(UTC).timestamp() * 1000


def is_expired(deadline_at: str | None, now_ms: float | None = None) -> bool:
    if not deadline_at:
        return False
    deadline = datetime.fromisoformat(deadline_at.replace("Z", "+00:00")).timestamp() * 1000
    return deadline <= (now_ms if now_ms is not None else _now_ms())


def submit_session(
    session_id: str, *, expired: bool | None = None, now_ms: float | None = None
) -> SubmissionResult:
    """提交場次。

    已是終態時回傳既有結果（冪等），MUST NOT 覆寫原本的終態——
    手動提交與逾時提交的區別要保留給 Phase 4 的評分後台。
    """
    row = queries.find_session(session_id)
    if row is None:
        raise AppError(ErrorCode.UNAUTHORIZED)

    status = SessionStatus(row["status"])

    if is_terminal(status):
        return SubmissionResult(
            submitted_at=row["submitted_at"] or queries.now_iso(), status=status
        )

    if status is not SessionStatus.IN_PROGRESS:
        raise AppError(ErrorCode.SESSION_NOT_STARTED)

    resolved_expired = expired if expired is not None else is_expired(row["deadline_at"], now_ms)
    next_status = next_status_for_submission(expired=resolved_expired)
    submitted_at = queries.now_iso()

    queries.update_session_status(session_id, next_status, submitted_at)
    queries.mark_token_consumed(session_id)

    return SubmissionResult(submitted_at=submitted_at, status=next_status)


def enforce_deadline(session_id: str, now_ms: float | None = None) -> SessionStatus:
    """校時時的逾期檢查。

    伺服端主動判定並強制提交，不依賴前端通報——前端可能已關掉分頁，
    或時鐘被竄改（research R-007）。
    """
    row = queries.find_session(session_id)
    if row is None:
        raise AppError(ErrorCode.UNAUTHORIZED)

    status = SessionStatus(row["status"])
    if status is SessionStatus.IN_PROGRESS and is_expired(row["deadline_at"], now_ms):
        return submit_session(session_id, expired=True, now_ms=now_ms).status

    return status
