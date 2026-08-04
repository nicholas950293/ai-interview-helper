"""提交與校時的契約測試（T089）。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from tests.conftest import set_session_status

from techinterview.db import queries

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _expire(conn, session_id: str) -> None:
    past = (datetime.now(UTC) - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    conn.execute("UPDATE interview_session SET deadline_at = %s WHERE id = %s", (past, session_id))
    conn.commit()


class TestSubmit:
    async def test_submit_returns_status(self, session_client):
        res = await session_client.post("/api/submit")
        assert res.status_code == 200
        assert res.json()["status"] == "submitted"
        assert res.json()["submittedAt"]

    async def test_idempotent(self, session_client):
        first = (await session_client.post("/api/submit")).json()
        second = await session_client.post("/api/submit")

        assert second.status_code == 200
        assert second.json()["submittedAt"] == first["submittedAt"]

    async def test_ignores_client_supplied_answers(self, session_client, fixture):
        """伺服端取最後保存的草稿；前端傳來的內容一律不採信（FR-022）。"""
        qid = fixture.question_ids[0]
        await session_client.put(
            f"/api/answers/{qid}", json={"language": "javascript", "content": "v1", "revision": 1}
        )
        await session_client.put(
            f"/api/answers/{qid}", json={"language": "javascript", "content": "v2", "revision": 2}
        )

        await session_client.request(
            "POST", "/api/submit", json={"answers": [{"questionId": qid, "content": "偽造"}]}
        )

        assert queries.find_answer(fixture.session_id, qid).content == "v2"

    async def test_writes_rejected_after_submit(self, session_client, fixture):
        await session_client.post("/api/submit")
        qid = fixture.question_ids[0]

        assert (
            await session_client.put(
                f"/api/answers/{qid}",
                json={"language": "javascript", "content": "late", "revision": 1},
            )
        ).status_code == 409
        assert (
            await session_client.post("/api/chat", json={"questionId": qid, "content": "x"})
        ).status_code == 409
        assert (await session_client.post(f"/api/tests/{qid}", json={})).status_code == 409

    async def test_content_preserved(self, session_client, fixture):
        qid = fixture.question_ids[0]
        await session_client.put(
            f"/api/answers/{qid}",
            json={"language": "javascript", "content": "我的作答", "revision": 1},
        )
        await session_client.post("/api/submit")

        answers = (await session_client.get("/api/session")).json()["answers"]
        assert answers[0]["content"] == "我的作答"

    async def test_requires_cookie(self, client):
        assert (await client.post("/api/submit")).status_code == 401


class TestTime:
    async def test_returns_clock_sync_payload(self, session_client):
        res = await session_client.get("/api/time")
        assert res.status_code == 200
        body = res.json()
        assert body["serverTime"]
        assert body["deadlineAt"]
        assert body["status"] == "in_progress"

    async def test_expired_triggers_forced_submission(self, session_client, fixture, test_db):
        """伺服端主動判定並強制提交，不依賴前端通報（FR-022）。"""
        _expire(test_db, fixture.session_id)

        body = (await session_client.get("/api/time")).json()
        assert body["status"] == "expired_submitted"

        row = test_db.execute(
            "SELECT status, submitted_at FROM interview_session WHERE id = %s",
            (fixture.session_id,),
        ).fetchone()
        assert row["status"] == "expired_submitted"
        assert row["submitted_at"]

    async def test_expired_preserves_last_saved_draft(self, session_client, fixture, test_db):
        qid = fixture.question_ids[0]
        await session_client.put(
            f"/api/answers/{qid}",
            json={"language": "javascript", "content": "歸零前的內容", "revision": 1},
        )
        _expire(test_db, fixture.session_id)
        await session_client.get("/api/time")

        late = await session_client.put(
            f"/api/answers/{qid}",
            json={"language": "javascript", "content": "歸零後", "revision": 2},
        )
        assert late.status_code == 409
        assert queries.find_answer(fixture.session_id, qid).content == "歸零前的內容"

    async def test_manual_submission_not_overwritten_by_expiry(
        self, session_client, fixture, test_db
    ):
        await session_client.post("/api/submit")
        _expire(test_db, fixture.session_id)

        assert (await session_client.get("/api/time")).json()["status"] == "submitted"

    async def test_submit_after_expiry_returns_expired_status(
        self, session_client, fixture, test_db
    ):
        _expire(test_db, fixture.session_id)
        await session_client.get("/api/time")

        res = await session_client.post("/api/submit")
        assert res.status_code == 200
        assert res.json()["status"] == "expired_submitted"

    async def test_terminal_session_can_still_sync(self, session_client, fixture, test_db):
        set_session_status(test_db, fixture.session_id, "submitted")
        res = await session_client.get("/api/time")
        assert res.status_code == 200
        assert res.json()["status"] == "submitted"
