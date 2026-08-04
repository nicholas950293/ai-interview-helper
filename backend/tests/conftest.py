"""共用測試設施（T004）。

契約測試以 httpx 的 ASGITransport 直接打 ASGI app，不啟動真實伺服器（research R-016）。
每個測試各自一個記憶體資料庫，避免互相污染。
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from techinterview.core import config
from techinterview.core.schemas import ChatRole
from techinterview.db import client as db_client
from techinterview.db import queries

STARTER_CODE = {
    "javascript": "function solve() {\n  // 在此作答\n}\n",
    "typescript": "function solve(): void {\n  // 在此作答\n}\n",
    "python": "def solve():\n    # 在此作答\n    pass\n",
    "go": "func solve() {\n\t// 在此作答\n}\n",
}


@dataclass
class Fixture:
    session_id: str
    token: str
    question_ids: list[str]


@pytest.fixture(autouse=True)
def test_settings(monkeypatch):
    """測試設定：記憶體資料庫、固定 secret、假 AI 回應。"""
    settings = config.make_test_settings(ai_fake=True)
    config.get_settings.cache_clear()
    monkeypatch.setattr(config, "get_settings", lambda: settings)

    # 其他模組是 `from ... import get_settings`，需個別覆寫
    import techinterview.core.auth as auth_mod
    import techinterview.db.client as client_mod

    monkeypatch.setattr(auth_mod, "get_settings", lambda: settings)
    monkeypatch.setattr(client_mod, "get_settings", lambda: settings)

    try:
        import techinterview.ai.providers as providers_mod

        monkeypatch.setattr(providers_mod, "get_settings", lambda: settings)
    except ImportError:
        pass

    return settings


@pytest.fixture
def test_db(test_settings):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    db_client.set_db(conn)
    db_client.run_migrations(conn)
    yield conn
    db_client.close_db()


@pytest.fixture
def fixture(test_db) -> Fixture:
    return seed_fixture(test_db)


def seed_fixture(
    conn: sqlite3.Connection,
    *,
    session_id: str = "sess-test-1",
    token: str = "tok-test-1",
    duration_sec: int = 3600,
    status: str = "not_started",
    token_expires_at: str | None = None,
    question_count: int = 2,
) -> Fixture:
    expires = token_expires_at or (datetime.now(UTC) + timedelta(days=7)).isoformat().replace(
        "+00:00", "Z"
    )

    conn.execute(
        """INSERT INTO interview_session
             (id, candidate_name, position_title, duration_sec, status, collaboration_mode)
           VALUES (?, ?, ?, ?, ?, 'implement')""",
        (session_id, "Alex Chen", "資深全端工程師模擬面試", duration_sec, status),
    )
    conn.execute(
        "INSERT INTO invite_token (token, session_id, status, expires_at) VALUES (?, ?, ?, ?)",
        (token, session_id, "pending" if status == "not_started" else "active", expires),
    )

    prefix = "q" if session_id == "sess-test-1" else f"q-{session_id}"
    question_ids: list[str] = []
    for i in range(1, question_count + 1):
        qid = f"{prefix}-{i}"
        question_ids.append(qid)
        conn.execute(
            """INSERT INTO question
                 (id, title, difficulty, points, description, examples_json,
                  complexity_requirement, grading_focus_json, starter_code_json,
                  predefined_tests_json, quick_prompts_json)
               VALUES (?, ?, 'medium', 40, ?, ?, ?, ?, ?, ?, ?)""",
            (
                qid,
                f"示範題目 {i}",
                f"題目 {i} 的描述",
                json.dumps([{"input": "a", "output": "b"}]),
                "O(1) 時間複雜度",
                json.dumps(["邊界條件處理"]),
                json.dumps(STARTER_CODE),
                json.dumps(
                    [
                        {"name": "case-1", "expected_pass": True},
                        {"name": "case-2", "expected_pass": True},
                        {"name": "case-3", "expected_pass": False},
                    ]
                ),
                json.dumps(["幫我實作這一題", "檢查 Corner Cases"]),
            ),
        )
        conn.execute(
            'INSERT INTO session_question (session_id, question_id, "order") VALUES (?, ?, ?)',
            (session_id, qid, i),
        )
    conn.commit()
    return Fixture(session_id=session_id, token=token, question_ids=question_ids)


@pytest.fixture
def assistant_message(test_db, fixture) -> tuple[str, str]:
    """一則含單一程式碼區塊的 AI 回覆，回傳 (message_id, block_content)。"""
    block_content = "function solve(a) {\n  return a * 2;\n}\n"
    message = queries.insert_chat_message(
        session_id=fixture.session_id,
        question_id=fixture.question_ids[0],
        role=ChatRole.ASSISTANT,
        content=f"這是實作：\n\n```javascript\n{block_content}```",
    )
    queries.replace_code_blocks(message.id, [(0, "javascript", block_content)])
    return message.id, block_content


@pytest.fixture
async def client(test_db):
    from techinterview.main import create_app

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def session_client(client, fixture):
    """已兌換 token、帶有 session cookie 的 client。"""
    res = await client.post("/api/session/redeem", json={"token": fixture.token})
    assert res.status_code == 200, res.text
    return client


def set_session_status(conn: sqlite3.Connection, session_id: str, status: str) -> None:
    submitted = queries.now_iso() if status in ("submitted", "expired_submitted") else None
    conn.execute(
        "UPDATE interview_session SET status = ?, submitted_at = ? WHERE id = ?",
        (status, submitted, session_id),
    )
    conn.commit()
