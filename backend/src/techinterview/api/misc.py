"""測試執行、校時、提交、平台外工具事件（T041、T092、T093、T105）。"""

from __future__ import annotations

from fastapi import APIRouter, Request

from techinterview.core.auth import current_session_id, require_writable_session
from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import (
    ENVIRONMENT_EVENT_MIN_DURATION_MS,
    EnvironmentEventItem,
)
from techinterview.db import queries
from techinterview.domain.submission import enforce_deadline, submit_session

router = APIRouter(prefix="/api", tags=["misc"])


@router.post("/tests/{question_id}")
def run_tests(question_id: str, request: Request) -> dict:
    """本期回報該題預先定義的測試案例結果（FR-030）。

    MUST NOT 接受或執行任何用戶端提供的程式碼——請求 body 一律忽略。
    真實沙盒執行屬 Roadmap Phase 3，不得提前混入。
    """
    row = require_writable_session(request)
    session_id = row["id"]

    if not queries.is_question_in_session(session_id, question_id):
        raise AppError(ErrorCode.NOT_FOUND)

    cases = queries.get_predefined_tests(question_id)
    passed = sum(1 for c in cases if c.get("expected_pass"))
    ran_at = queries.insert_test_run(
        session_id=session_id, question_id=question_id, passed=passed, total=len(cases)
    )
    return {"passed": passed, "total": len(cases), "ranAt": ran_at}


@router.get("/time")
def get_time(request: Request) -> dict:
    """輕量校時端點（research R-007）。

    若伺服端判定已逾期且場次仍 in_progress，MUST 主動觸發逾時提交，
    不依賴前端主動通報（FR-022）。
    """
    session_id = current_session_id(request)
    status = enforce_deadline(session_id)

    row = queries.find_session(session_id)
    if row is None:
        raise AppError(ErrorCode.UNAUTHORIZED)

    return {
        "serverTime": queries.now_iso(),
        "deadlineAt": row["deadline_at"],
        "status": status.value,
    }


@router.post("/submit")
def submit(request: Request) -> dict:
    """手動提交全卷（FR-021）。

    不接受作答內容：伺服端取每題最後保存的草稿。
    採信前端內容的話，一次竄改就能改寫整份作答。
    """
    session_id = current_session_id(request)
    result = submit_session(session_id)
    return {"submittedAt": result.submitted_at, "status": result.status.value}


@router.post("/events", status_code=202)
async def post_events(request: Request) -> dict:
    """回報平台外工具事件（FR-025）。

    Schema 中沒有任何判定性欄位，因此前端即使傳了也寫不進去（FR-026）。
    `durationMs < 1000` 由伺服端二次過濾——不信任前端的門檻。
    """
    row = require_writable_session(request)

    try:
        payload = await request.json()
        items = [EnvironmentEventItem.model_validate(i) for i in payload]
    except Exception as exc:  # noqa: BLE001
        raise AppError(ErrorCode.BAD_REQUEST) from exc

    accepted = [
        (i.type.value, i.started_at, i.duration_ms)
        for i in items
        if i.duration_ms >= ENVIRONMENT_EVENT_MIN_DURATION_MS
    ]
    if accepted:
        queries.insert_environment_events(row["id"], accepted)

    return {"accepted": len(accepted)}
