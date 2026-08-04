"""場次端點契約測試（T024）。

依 research R-016 由既有 TypeScript 契約測試一對一移植——
`ASGITransport` 對應原本的 `app.request()`，測試意圖可逐條對照。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from tests.conftest import seed_fixture, set_session_status

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


class TestRedeem:
    async def test_first_redeem_starts_session(self, client, fixture, test_db):
        res = await client.post("/api/session/redeem", json={"token": fixture.token})

        assert res.status_code == 200, res.text
        body = res.json()
        assert body["session"]["status"] == "in_progress"
        assert body["session"]["candidateName"] == "Alex Chen"
        assert body["session"]["deadlineAt"]
        assert body["session"]["collaborationMode"] == "implement"
        assert body["serverTime"]

        # deadlineAt = startedAt + durationSec（伺服端計算，不接受用戶端傳入）
        row = test_db.execute(
            "SELECT started_at, deadline_at FROM interview_session WHERE id = ?",
            (fixture.session_id,),
        ).fetchone()
        started = datetime.fromisoformat(row["started_at"].replace("Z", "+00:00"))
        deadline = datetime.fromisoformat(row["deadline_at"].replace("Z", "+00:00"))
        assert (deadline - started).total_seconds() == 3600

        assert "session=" in res.headers.get("set-cookie", "")
        assert "HttpOnly" in res.headers.get("set-cookie", "")

    async def test_repeat_redeem_does_not_reset_deadline(self, client, fixture):
        first = await client.post("/api/session/redeem", json={"token": fixture.token})
        second = await client.post("/api/session/redeem", json={"token": fixture.token})

        assert second.status_code == 200
        assert second.json()["session"]["deadlineAt"] == first.json()["session"]["deadlineAt"]

    async def test_unknown_token(self, client, fixture):
        res = await client.post("/api/session/redeem", json={"token": "nope"})
        assert res.status_code == 404
        assert res.json()["error"]["code"] == "TOKEN_INVALID"
        assert res.json()["error"]["message"]

    async def test_expired_token(self, client, test_db):
        expired = (datetime.now(UTC) - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
        seed_fixture(test_db, session_id="sess-exp", token="tok-exp", token_expires_at=expired)

        res = await client.post("/api/session/redeem", json={"token": "tok-exp"})
        assert res.status_code == 410
        assert res.json()["error"]["code"] == "TOKEN_EXPIRED"

    @pytest.mark.parametrize("status", ["submitted", "expired_submitted"])
    async def test_submitted_session_rejected(self, client, fixture, test_db, status):
        set_session_status(test_db, fixture.session_id, status)
        res = await client.post("/api/session/redeem", json={"token": fixture.token})
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "SESSION_SUBMITTED"


class TestGetSession:
    async def test_returns_full_state(self, session_client, fixture):
        res = await session_client.get("/api/session")

        assert res.status_code == 200
        body = res.json()
        assert body["session"]["id"] == fixture.session_id
        assert len(body["questions"]) == 2
        assert body["questions"][0]["order"] == 1
        assert isinstance(body["answers"], list)
        assert isinstance(body["chat"], list)
        assert body["serverTime"]

    async def test_predefined_tests_never_leak(self, session_client):
        """FR-030：僅回傳測試數量，不得洩漏個別案例。"""
        res = await session_client.get("/api/session")
        raw = res.text

        assert "predefinedTests" not in raw
        assert "expected_pass" not in raw
        assert "case-1" not in raw
        assert res.json()["questions"][0]["testCount"] == 3

    async def test_requires_cookie(self, client):
        res = await client.get("/api/session")
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "UNAUTHORIZED"

    async def test_forged_cookie_rejected(self, client):
        client.cookies.set("session", "forged.value")
        res = await client.get("/api/session")
        assert res.status_code == 401


class TestCollaborationMode:
    async def test_switch_mode_persists(self, session_client):
        res = await session_client.patch(
            "/api/session/collaboration-mode", json={"mode": "discuss"}
        )
        assert res.status_code == 200
        assert res.json()["mode"] == "discuss"

        session = (await session_client.get("/api/session")).json()["session"]
        assert session["collaborationMode"] == "discuss"

    async def test_default_is_implement(self, session_client):
        """本平台的評估標的是透過 AI 實作，預設不該是討論。"""
        session = (await session_client.get("/api/session")).json()["session"]
        assert session["collaborationMode"] == "implement"

    async def test_rejected_after_submission(self, session_client, fixture, test_db):
        set_session_status(test_db, fixture.session_id, "submitted")
        res = await session_client.patch(
            "/api/session/collaboration-mode", json={"mode": "discuss"}
        )
        assert res.status_code == 409


class TestPiiMinimization:
    """FR-032 的 MUST NOT 半段：前端不得持有姓名與職稱以外的個資。"""

    ALLOWED = {
        "id",
        "candidateName",
        "positionTitle",
        "deadlineAt",
        "status",
        "collaborationMode",
    }

    async def test_session_payload_has_only_allowed_fields(self, session_client):
        session = (await session_client.get("/api/session")).json()["session"]
        assert set(session.keys()) == self.ALLOWED

    async def test_redeem_payload_has_only_allowed_fields(self, client, fixture):
        res = await client.post("/api/session/redeem", json={"token": fixture.token})
        assert set(res.json()["session"].keys()) == self.ALLOWED

    async def test_token_never_echoed(self, session_client, fixture):
        raw = (await session_client.get("/api/session")).text
        assert fixture.token not in raw

    async def test_code_change_history_not_exposed(
        self, session_client, fixture, assistant_message
    ):
        """變更歷史是伺服端的評分材料，前端沒有用途。"""
        message_id, _ = assistant_message
        await session_client.post(
            f"/api/answers/{fixture.question_ids[0]}/apply",
            json={"messageId": message_id, "blockIndex": 0},
        )

        body = (await session_client.get("/api/session")).json()
        assert "codeChanges" not in body
        assert "code_change" not in (await session_client.get("/api/session")).text
