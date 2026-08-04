"""共用測試設施（T004）。

契約測試以 httpx 的 ASGITransport 直接打 ASGI app，不啟動真實伺服器（research R-016）。

資料庫改用 Postgres 後不再有 `:memory:` 可用，測試隔離改為：整個 session 建立一個
獨立資料庫（`portal_test`），每個測試前 TRUNCATE 全部資料表。刻意不用「交易內執行、
結束回滾」——被測程式碼本身會 commit，那種做法會在第一次 commit 就失效。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from httpx import ASGITransport, AsyncClient
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

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
    """測試設定：獨立的 Postgres 測試資料庫、固定 secret、假 AI 回應。"""
    settings = config.make_test_settings(ai_fake=True, database_url=TEST_DSN)
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


ADMIN_DSN = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
TEST_DB_NAME = "portal_test"
TEST_DSN = ADMIN_DSN.rsplit("/", 1)[0] + f"/{TEST_DB_NAME}"

# 每個測試都要清空的資料表。順序無關——TRUNCATE ... CASCADE 一次處理外鍵。
_ALL_TABLES = (
    "code_change, chat_code_block, chat_message, environment_event, test_run, "
    "answer, session_question, invite_token, interview_session, question"
)


@pytest.fixture(scope="session")
def _test_database() -> str:
    """整個測試 session 共用一個乾淨的資料庫，schema 由 supabase/migrations 建立。"""
    from techinterview.db.migrate import apply_migrations

    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')

    with psycopg.connect(TEST_DSN) as conn:
        apply_migrations(conn)
        conn.commit()

    yield TEST_DSN

    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}" WITH (FORCE)')


@pytest.fixture
def test_db(test_settings, _test_database):
    conn = psycopg.connect(TEST_DSN, row_factory=dict_row, autocommit=False)
    conn.adapters.register_loader("timestamptz", db_client._IsoTimestamptzLoader)
    conn.execute(f"TRUNCATE {_ALL_TABLES} RESTART IDENTITY CASCADE")
    conn.commit()

    db_client.set_db(conn)
    yield conn
    db_client.set_db(None)
    conn.close()


@pytest.fixture
def fixture(test_db) -> Fixture:
    return seed_fixture(test_db)


def seed_fixture(
    conn: psycopg.Connection,
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
             (id, candidate_name, position_title, duration_sec, status)
           VALUES (%s, %s, %s, %s, %s)""",
        (session_id, "Alex Chen", "資深全端工程師模擬面試", duration_sec, status),
    )
    conn.execute(
        "INSERT INTO invite_token (token, session_id, status, expires_at) VALUES (%s, %s, %s, %s)",
        (token, session_id, "pending" if status == "not_started" else "active", expires),
    )

    prefix = "q" if session_id == "sess-test-1" else f"q-{session_id}"
    question_ids: list[str] = []
    for i in range(1, question_count + 1):
        qid = f"{prefix}-{i}"
        question_ids.append(qid)
        conn.execute(
            """INSERT INTO question
                 (id, title, difficulty, points, description, examples,
                  complexity_requirement, grading_focus, starter_code,
                  predefined_tests, quick_prompts)
               VALUES (%s, %s, 'medium', 40, %s, %s, %s, %s, %s, %s, %s)""",
            (
                qid,
                f"示範題目 {i}",
                f"題目 {i} 的描述",
                Jsonb([{"input": "a", "output": "b"}]),
                "O(1) 時間複雜度",
                Jsonb(["邊界條件處理"]),
                Jsonb(STARTER_CODE),
                Jsonb(
                    [
                        {"name": "case-1", "expected_pass": True},
                        {"name": "case-2", "expected_pass": True},
                        {"name": "case-3", "expected_pass": False},
                    ]
                ),
                Jsonb(["幫我實作這一題", "檢查 Corner Cases"]),
            ),
        )
        conn.execute(
            'INSERT INTO session_question (session_id, question_id, "order") VALUES (%s, %s, %s)',
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


def set_session_status(conn: psycopg.Connection, session_id: str, status: str) -> None:
    submitted = queries.now_iso() if status in ("submitted", "expired_submitted") else None
    conn.execute(
        "UPDATE interview_session SET status = %s, submitted_at = %s WHERE id = %s",
        (status, submitted, session_id),
    )
    conn.commit()
