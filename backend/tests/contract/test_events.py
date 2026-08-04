"""平台外工具事件的契約測試（T103）。"""

from __future__ import annotations

import pytest
from tests.conftest import set_session_status

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _count(conn, session_id: str) -> int:
    return conn.execute(
        "SELECT COUNT(*) AS n FROM environment_event WHERE session_id = ?", (session_id,)
    ).fetchone()["n"]


async def test_records_single_event(session_client, fixture, test_db):
    res = await session_client.post(
        "/api/events",
        json=[{"type": "tab_hidden", "startedAt": "2026-08-04T10:00:00.000Z", "durationMs": 2500}],
    )

    assert res.status_code == 202
    assert res.json()["accepted"] == 1
    assert _count(test_db, fixture.session_id) == 1


async def test_batch(session_client, fixture, test_db):
    res = await session_client.post(
        "/api/events",
        json=[
            {"type": "tab_hidden", "startedAt": "2026-08-04T10:00:00.000Z", "durationMs": 2000},
            {"type": "window_blur", "startedAt": "2026-08-04T10:01:00.000Z", "durationMs": 3000},
        ],
    )

    assert res.json()["accepted"] == 2
    assert _count(test_db, fixture.session_id) == 2


async def test_short_events_silently_dropped(session_client, fixture, test_db):
    """伺服端二次過濾——不信任前端的門檻。"""
    res = await session_client.post(
        "/api/events",
        json=[
            {"type": "tab_hidden", "startedAt": "2026-08-04T10:00:00.000Z", "durationMs": 999},
            {"type": "window_blur", "startedAt": "2026-08-04T10:01:00.000Z", "durationMs": 1000},
        ],
    )

    assert res.status_code == 202
    assert res.json()["accepted"] == 1
    assert _count(test_db, fixture.session_id) == 1


async def test_all_below_threshold_is_not_an_error(session_client, fixture, test_db):
    res = await session_client.post(
        "/api/events",
        json=[{"type": "tab_hidden", "startedAt": "2026-08-04T10:00:00.000Z", "durationMs": 100}],
    )

    assert res.status_code == 202
    assert res.json()["accepted"] == 0
    assert _count(test_db, fixture.session_id) == 0


async def test_verdict_fields_cannot_be_written(session_client, fixture, test_db):
    """FR-026：schema 沒有判定性欄位，傳了也寫不進去。"""
    await session_client.post(
        "/api/events",
        json=[
            {
                "type": "tab_hidden",
                "startedAt": "2026-08-04T10:00:00.000Z",
                "durationMs": 2000,
                "cheating": True,
                "verdict": "suspicious",
            }
        ],
    )

    cols = {r["name"] for r in test_db.execute("PRAGMA table_info(environment_event)")}
    assert "cheating" not in cols
    assert "verdict" not in cols


async def test_unknown_type_rejected(session_client):
    res = await session_client.post(
        "/api/events",
        json=[
            {
                "type": "screenshot_taken",
                "startedAt": "2026-08-04T10:00:00.000Z",
                "durationMs": 2000,
            }
        ],
    )
    assert res.status_code == 400


async def test_rejected_after_submission(session_client, fixture, test_db):
    set_session_status(test_db, fixture.session_id, "submitted")
    res = await session_client.post(
        "/api/events",
        json=[{"type": "tab_hidden", "startedAt": "2026-08-04T10:00:00.000Z", "durationMs": 2000}],
    )
    assert res.status_code == 409


async def test_requires_cookie(client):
    res = await client.post(
        "/api/events",
        json=[{"type": "tab_hidden", "startedAt": "2026-08-04T10:00:00.000Z", "durationMs": 2000}],
    )
    assert res.status_code == 401


async def test_events_survive_submission(session_client, fixture, test_db):
    """US5 情境 3：所有切換記錄隨作答一併留存。"""
    await session_client.post(
        "/api/events",
        json=[
            {"type": "tab_hidden", "startedAt": "2026-08-04T10:00:00.000Z", "durationMs": 2000},
            {"type": "window_blur", "startedAt": "2026-08-04T10:01:00.000Z", "durationMs": 5000},
        ],
    )
    await session_client.post("/api/submit")

    assert _count(test_db, fixture.session_id) == 2
