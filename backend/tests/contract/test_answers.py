"""草稿保存與測試執行的契約測試（T034、T041）。"""

from __future__ import annotations

import pytest
from tests.conftest import set_session_status

from techinterview.core.schemas import MAX_CONTENT_BYTES
from techinterview.db import queries

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _save(client, question_id: str, content: str, revision: int, language: str = "javascript"):
    return client.put(
        f"/api/answers/{question_id}",
        json={"language": language, "content": content, "revision": revision},
    )


class TestSaveAnswer:
    async def test_first_save(self, session_client, fixture):
        res = await _save(session_client, fixture.question_ids[0], "hello", 1)
        assert res.status_code == 200
        assert res.json()["revision"] == 1
        assert res.json()["savedAt"]

    async def test_increasing_revisions_accepted(self, session_client, fixture):
        await _save(session_client, fixture.question_ids[0], "v1", 1)
        res = await _save(session_client, fixture.question_ids[0], "v2", 2)
        assert res.json()["revision"] == 2

    async def test_stale_revision_rejected_with_server_value(self, session_client, fixture):
        await _save(session_client, fixture.question_ids[0], "newer", 5)
        res = await _save(session_client, fixture.question_ids[0], "older", 3)

        assert res.status_code == 409
        body = res.json()
        assert body["error"]["code"] == "REVISION_STALE"
        assert body["error"]["details"]["revision"] == 5

    async def test_stale_revision_does_not_overwrite(self, session_client, fixture):
        await _save(session_client, fixture.question_ids[0], "newer", 5)
        await _save(session_client, fixture.question_ids[0], "older", 3)

        stored = queries.find_answer(fixture.session_id, fixture.question_ids[0])
        assert stored.content == "newer"
        assert stored.revision == 5

    async def test_oversized_content_rejected_without_truncation(self, session_client, fixture):
        res = await _save(session_client, fixture.question_ids[0], "x" * (MAX_CONTENT_BYTES + 1), 1)

        assert res.status_code == 413
        assert res.json()["error"]["code"] == "CONTENT_TOO_LARGE"
        assert queries.find_answer(fixture.session_id, fixture.question_ids[0]) is None

    @pytest.mark.parametrize("status", ["submitted", "expired_submitted"])
    async def test_rejected_after_submission(self, session_client, fixture, test_db, status):
        set_session_status(test_db, fixture.session_id, status)
        res = await _save(session_client, fixture.question_ids[0], "late", 1)
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "SESSION_SUBMITTED"

    async def test_question_not_in_session(self, session_client):
        res = await _save(session_client, "q-not-mine", "x", 1)
        assert res.status_code == 404

    async def test_requires_cookie(self, client, fixture):
        res = await _save(client, fixture.question_ids[0], "x", 1)
        assert res.status_code == 401

    async def test_each_question_saved_independently(self, session_client, fixture):
        """FR-003：切換題目時互不覆蓋。"""
        await _save(session_client, fixture.question_ids[0], "answer-1", 1)
        await _save(session_client, fixture.question_ids[1], "answer-2", 1, language="python")

        answers = {
            a["questionId"]: a for a in (await session_client.get("/api/session")).json()["answers"]
        }
        assert answers[fixture.question_ids[0]]["content"] == "answer-1"
        assert answers[fixture.question_ids[0]]["language"] == "javascript"
        assert answers[fixture.question_ids[1]]["content"] == "answer-2"
        assert answers[fixture.question_ids[1]]["language"] == "python"

    async def test_save_records_candidate_attribution(self, session_client, fixture):
        await _save(session_client, fixture.question_ids[0], "我寫的", 1)

        changes = [dict(r) for r in queries.list_code_changes(fixture.session_id)]
        assert len(changes) == 1
        assert changes[0]["source"] == "candidate"
        assert changes[0]["chat_message_id"] is None


class TestSaveAnswersBatch:
    async def test_applies_in_revision_order(self, session_client, fixture):
        qid = fixture.question_ids[0]
        res = await session_client.put(
            "/api/answers",
            json=[
                {"questionId": qid, "language": "javascript", "content": "v3", "revision": 3},
                {"questionId": qid, "language": "javascript", "content": "v1", "revision": 1},
                {"questionId": qid, "language": "javascript", "content": "v2", "revision": 2},
            ],
        )

        assert res.status_code == 200
        stored = queries.find_answer(fixture.session_id, qid)
        assert stored.content == "v3"
        assert stored.revision == 3

    async def test_stale_item_skipped_not_whole_batch(self, session_client, fixture):
        q1, q2 = fixture.question_ids
        await session_client.put(
            "/api/answers",
            json=[{"questionId": q1, "language": "javascript", "content": "v5", "revision": 5}],
        )
        res = await session_client.put(
            "/api/answers",
            json=[
                {"questionId": q1, "language": "javascript", "content": "stale", "revision": 2},
                {"questionId": q2, "language": "go", "content": "fresh", "revision": 1},
            ],
        )

        assert res.status_code == 200
        assert queries.find_answer(fixture.session_id, q1).content == "v5"
        assert queries.find_answer(fixture.session_id, q2).content == "fresh"


class TestRunTests:
    async def test_reports_predefined_result(self, session_client, fixture):
        res = await session_client.post(f"/api/tests/{fixture.question_ids[0]}", json={})

        assert res.status_code == 200
        body = res.json()
        assert body["total"] == 3
        assert body["passed"] == 2
        assert body["ranAt"]

    async def test_never_leaks_case_details(self, session_client, fixture):
        raw = (await session_client.post(f"/api/tests/{fixture.question_ids[0]}", json={})).text
        assert "case-1" not in raw
        assert "expected_pass" not in raw

    async def test_ignores_client_supplied_code(self, session_client, fixture):
        """MUST NOT 接受或執行任何用戶端提供的程式碼（FR-030）。"""
        res = await session_client.post(
            f"/api/tests/{fixture.question_ids[0]}",
            json={"code": "import os; os.system('rm -rf /')", "language": "python"},
        )
        assert res.status_code == 200
        assert res.json()["total"] == 3

    async def test_rejected_after_submission(self, session_client, fixture, test_db):
        set_session_status(test_db, fixture.session_id, "submitted")
        res = await session_client.post(f"/api/tests/{fixture.question_ids[0]}", json={})
        assert res.status_code == 409
