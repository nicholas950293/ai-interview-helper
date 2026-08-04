"""資料存取層（T019）。

介面刻意只用純 Python 型別，不外洩 psycopg 的細節。
時間欄位由 db/client.py 的型別載入器統一轉為 ISO-8601 字串，
因此本檔與呼叫端看到的一律是字串，不是 datetime。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import psycopg

from techinterview.core.schemas import (
    ChangeSource,
    ChatRole,
    ChatSource,
    Example,
    Language,
    PublicAnswer,
    PublicChatMessage,
    PublicCodeBlock,
    PublicQuestion,
    PublicSession,
    SessionStatus,
)
from techinterview.db.client import get_db


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id() -> str:
    return str(uuid.uuid4())


def _next_seq(conn: psycopg.Connection, table: str, session_id: str) -> int:
    row = conn.execute(
        f"SELECT COALESCE(MAX(seq), 0) AS s FROM {table} WHERE session_id = %s",  # noqa: S608
        (session_id,),
    ).fetchone()
    return int(row["s"]) + 1


# --- 場次 -------------------------------------------------------------------


def find_session(session_id: str, conn: psycopg.Connection | None = None) -> dict[str, Any] | None:
    conn = conn or get_db()
    return conn.execute("SELECT * FROM interview_session WHERE id = %s", (session_id,)).fetchone()


def to_public_session(row: dict[str, Any]) -> PublicSession:
    """唯一允許將場次資料送往前端的轉換點。

    僅含姓名與職稱兩項個資（FR-032）；擴充欄位前 MUST 重新檢視個資最小化。
    """
    return PublicSession(
        id=row["id"],
        candidate_name=row["candidate_name"],
        position_title=row["position_title"],
        deadline_at=row["deadline_at"],
        status=SessionStatus(row["status"]),
    )


def start_session(
    session_id: str, started_at: str, deadline_at: str, conn: psycopg.Connection | None = None
) -> None:
    conn = conn or get_db()
    conn.execute(
        """UPDATE interview_session
              SET started_at = %s, deadline_at = %s, status = 'in_progress'
            WHERE id = %s""",
        (started_at, deadline_at, session_id),
    )
    conn.commit()


def update_session_status(
    session_id: str,
    status: SessionStatus,
    submitted_at: str | None,
    conn: psycopg.Connection | None = None,
) -> None:
    conn = conn or get_db()
    conn.execute(
        "UPDATE interview_session SET status = %s, submitted_at = %s WHERE id = %s",
        (status.value, submitted_at, session_id),
    )
    conn.commit()


# --- 邀請連結 ---------------------------------------------------------------


def find_invite_token(token: str, conn: psycopg.Connection | None = None) -> dict[str, Any] | None:
    conn = conn or get_db()
    return conn.execute("SELECT * FROM invite_token WHERE token = %s", (token,)).fetchone()


def mark_token_used(token: str, first_used_at: str, conn: psycopg.Connection | None = None) -> None:
    conn = conn or get_db()
    conn.execute(
        """UPDATE invite_token
              SET status = 'active', first_used_at = COALESCE(first_used_at, %s)
            WHERE token = %s""",
        (first_used_at, token),
    )
    conn.commit()


def mark_token_consumed(session_id: str, conn: psycopg.Connection | None = None) -> None:
    conn = conn or get_db()
    conn.execute("UPDATE invite_token SET status = 'consumed' WHERE session_id = %s", (session_id,))
    conn.commit()


# --- 題目 -------------------------------------------------------------------


def _to_public_question(row: dict[str, Any]) -> PublicQuestion:
    predefined = row["predefined_tests"] or []
    return PublicQuestion(
        id=row["id"],
        title=row["title"],
        difficulty=row["difficulty"],
        points=row["points"],
        description=row["description"],
        examples=[Example(**e) for e in (row["examples"] or [])],
        complexity_requirement=row["complexity_requirement"],
        grading_focus=row["grading_focus"] or [],
        starter_code=row["starter_code"] or {},
        quick_prompts=row["quick_prompts"] or [],
        order=row["order"],
        # 只回傳數量，不回傳個別測試案例（FR-030）
        test_count=len(predefined),
    )


def list_session_questions(
    session_id: str, conn: psycopg.Connection | None = None
) -> list[PublicQuestion]:
    conn = conn or get_db()
    rows = conn.execute(
        """SELECT q.*, sq."order" AS "order"
             FROM session_question sq
             JOIN question q ON q.id = sq.question_id
            WHERE sq.session_id = %s
            ORDER BY sq."order" ASC""",
        (session_id,),
    ).fetchall()
    return [_to_public_question(r) for r in rows]


def is_question_in_session(
    session_id: str, question_id: str, conn: psycopg.Connection | None = None
) -> bool:
    conn = conn or get_db()
    row = conn.execute(
        "SELECT 1 FROM session_question WHERE session_id = %s AND question_id = %s",
        (session_id, question_id),
    ).fetchone()
    return row is not None


def get_predefined_tests(
    question_id: str, conn: psycopg.Connection | None = None
) -> list[dict[str, Any]]:
    """僅供伺服端計算通過數，MUST NOT 出現在任何回應中。"""
    conn = conn or get_db()
    row = conn.execute(
        "SELECT predefined_tests FROM question WHERE id = %s", (question_id,)
    ).fetchone()
    return (row["predefined_tests"] or []) if row else []


# --- 作答 -------------------------------------------------------------------


def _to_public_answer(row: dict[str, Any]) -> PublicAnswer:
    return PublicAnswer(
        question_id=row["question_id"],
        language=Language(row["language"]),
        content=row["content"],
        saved_at=row["saved_at"],
        revision=row["revision"],
    )


def list_answers(session_id: str, conn: psycopg.Connection | None = None) -> list[PublicAnswer]:
    conn = conn or get_db()
    rows = conn.execute("SELECT * FROM answer WHERE session_id = %s", (session_id,)).fetchall()
    return [_to_public_answer(r) for r in rows]


def find_answer(
    session_id: str, question_id: str, conn: psycopg.Connection | None = None
) -> PublicAnswer | None:
    conn = conn or get_db()
    row = conn.execute(
        "SELECT * FROM answer WHERE session_id = %s AND question_id = %s",
        (session_id, question_id),
    ).fetchone()
    return _to_public_answer(row) if row else None


def upsert_answer(
    *,
    session_id: str,
    question_id: str,
    language: Language,
    content: str,
    revision: int,
    conn: psycopg.Connection | None = None,
) -> tuple[str, int]:
    conn = conn or get_db()
    saved_at = now_iso()
    conn.execute(
        """INSERT INTO answer (session_id, question_id, language, content, saved_at, revision)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (session_id, question_id) DO UPDATE SET
             language = excluded.language,
             content  = excluded.content,
             saved_at = excluded.saved_at,
             revision = excluded.revision""",
        (session_id, question_id, language.value, content, saved_at, revision),
    )
    conn.commit()
    return saved_at, revision


# --- 對話訊息 ---------------------------------------------------------------


def list_chat_messages(
    session_id: str, conn: psycopg.Connection | None = None
) -> list[PublicChatMessage]:
    conn = conn or get_db()
    # 排序 MUST 以 seq；created_at 在同毫秒插入時分不出先後。
    rows = conn.execute(
        "SELECT * FROM chat_message WHERE session_id = %s ORDER BY seq ASC", (session_id,)
    ).fetchall()

    messages: list[PublicChatMessage] = []
    for row in rows:
        blocks = conn.execute(
            """SELECT block_index, language, content
                 FROM chat_code_block WHERE message_id = %s ORDER BY block_index ASC""",
            (row["id"],),
        ).fetchall()
        messages.append(
            PublicChatMessage(
                id=row["id"],
                question_id=row["question_id"],
                role=ChatRole(row["role"]),
                content=row["content"],
                created_at=row["created_at"],
                attached_code=row["attached_code"],
                code_blocks=[
                    PublicCodeBlock(
                        block_index=b["block_index"], language=b["language"], content=b["content"]
                    )
                    for b in blocks
                ],
            )
        )
    return messages


def insert_chat_message(
    *,
    session_id: str,
    question_id: str,
    role: ChatRole,
    content: str,
    attached_code: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    source: ChatSource | None = None,
    conn: psycopg.Connection | None = None,
) -> PublicChatMessage:
    """所有訊息 MUST 留存（FR-015）；本模組不提供刪除介面。"""
    conn = conn or get_db()
    message_id = new_id()
    created_at = now_iso()
    seq = _next_seq(conn, "chat_message", session_id)

    conn.execute(
        """INSERT INTO chat_message
             (id, seq, session_id, question_id, role, content, created_at,
              attached_code, provider, model, source)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            message_id,
            seq,
            session_id,
            question_id,
            role.value,
            content,
            created_at,
            attached_code,
            provider,
            model,
            source.value if source else None,
        ),
    )
    conn.commit()

    return PublicChatMessage(
        id=message_id,
        question_id=question_id,
        role=role,
        content=content,
        created_at=created_at,
        attached_code=attached_code,
        code_blocks=[],
    )


def update_chat_message_content(
    message_id: str,
    content: str,
    *,
    provider: str | None = None,
    model: str | None = None,
    conn: psycopg.Connection | None = None,
) -> None:
    """寫入 AI 的完整輸出。MUST NOT 在此做任何裁切或改寫（憲章原則 I）。"""
    conn = conn or get_db()
    conn.execute(
        "UPDATE chat_message SET content = %s, provider = %s, model = %s WHERE id = %s",
        (content, provider, model, message_id),
    )
    conn.commit()


# --- 程式碼區塊 -------------------------------------------------------------


def replace_code_blocks(
    message_id: str,
    blocks: list[tuple[int, str | None, str]],
    conn: psycopg.Connection | None = None,
) -> None:
    conn = conn or get_db()
    conn.execute("DELETE FROM chat_code_block WHERE message_id = %s", (message_id,))
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO chat_code_block (id, message_id, block_index, language, content)
               VALUES (%s, %s, %s, %s, %s)""",
            [(new_id(), message_id, idx, lang, content) for idx, lang, content in blocks],
        )
    conn.commit()


def find_code_block(
    message_id: str, block_index: int, conn: psycopg.Connection | None = None
) -> dict[str, Any] | None:
    conn = conn or get_db()
    return conn.execute(
        "SELECT * FROM chat_code_block WHERE message_id = %s AND block_index = %s",
        (message_id, block_index),
    ).fetchone()


def find_message(message_id: str, conn: psycopg.Connection | None = None) -> dict[str, Any] | None:
    conn = conn or get_db()
    return conn.execute("SELECT * FROM chat_message WHERE id = %s", (message_id,)).fetchone()


# --- 程式碼變更（憲章原則 I 的核心資料）------------------------------------


def insert_code_change(
    *,
    session_id: str,
    question_id: str,
    source: ChangeSource,
    content: str,
    revision: int,
    chat_message_id: str | None = None,
    block_index: int | None = None,
    conn: psycopg.Connection | None = None,
) -> str:
    """記錄一次作答內容變更的來源。

    資料庫的 CHECK 約束會拒絕 source 與欄位不對應的寫入——
    「混為一談」在資料層就不可能發生。
    """
    conn = conn or get_db()
    change_id = new_id()
    conn.execute(
        """INSERT INTO code_change
             (id, seq, session_id, question_id, source, content, revision,
              created_at, chat_message_id, block_index)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            change_id,
            _next_seq(conn, "code_change", session_id),
            session_id,
            question_id,
            source.value,
            content,
            revision,
            now_iso(),
            chat_message_id,
            block_index,
        ),
    )
    conn.commit()
    return change_id


def latest_code_change(
    session_id: str, question_id: str, conn: psycopg.Connection | None = None
) -> dict[str, Any] | None:
    conn = conn or get_db()
    return conn.execute(
        """SELECT * FROM code_change
            WHERE session_id = %s AND question_id = %s
            ORDER BY seq DESC LIMIT 1""",
        (session_id, question_id),
    ).fetchone()


def list_code_changes(
    session_id: str, conn: psycopg.Connection | None = None
) -> list[dict[str, Any]]:
    conn = conn or get_db()
    return conn.execute(
        "SELECT * FROM code_change WHERE session_id = %s ORDER BY seq ASC", (session_id,)
    ).fetchall()


# --- 平台外工具事件 ---------------------------------------------------------


def insert_environment_events(
    session_id: str,
    events: list[tuple[str, str, int]],
    conn: psycopg.Connection | None = None,
) -> int:
    conn = conn or get_db()
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO environment_event (id, session_id, type, started_at, duration_ms)
               VALUES (%s, %s, %s, %s, %s)""",
            [(new_id(), session_id, t, started, dur) for t, started, dur in events],
        )
    conn.commit()
    return len(events)


# --- 測試結果 ---------------------------------------------------------------


def insert_test_run(
    *,
    session_id: str,
    question_id: str,
    passed: int,
    total: int,
    conn: psycopg.Connection | None = None,
) -> str:
    conn = conn or get_db()
    ran_at = now_iso()
    conn.execute(
        """INSERT INTO test_run (id, session_id, question_id, passed, total, ran_at)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (new_id(), session_id, question_id, passed, total, ran_at),
    )
    conn.commit()
    return ran_at
