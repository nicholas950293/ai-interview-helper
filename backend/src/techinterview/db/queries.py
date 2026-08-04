"""資料存取層（T019）。

介面刻意只用純 Python 型別，不外洩 sqlite3 的細節——
後續替換為 Supabase client 時，只有本檔需要改寫。
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from typing import Any

from techinterview.core.schemas import (
    ChangeSource,
    ChatRole,
    ChatSource,
    CollaborationMode,
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


def _json(raw: str, fallback: Any) -> Any:
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return fallback


def _next_seq(conn: sqlite3.Connection, table: str, session_id: str) -> int:
    row = conn.execute(
        f"SELECT COALESCE(MAX(seq), 0) AS s FROM {table} WHERE session_id = ?",  # noqa: S608
        (session_id,),
    ).fetchone()
    return int(row["s"]) + 1


# --- 場次 -------------------------------------------------------------------


def find_session(session_id: str, conn: sqlite3.Connection | None = None) -> sqlite3.Row | None:
    conn = conn or get_db()
    return conn.execute("SELECT * FROM interview_session WHERE id = ?", (session_id,)).fetchone()


def to_public_session(row: sqlite3.Row) -> PublicSession:
    """唯一允許將場次資料送往前端的轉換點。

    僅含姓名與職稱兩項個資（FR-032）；擴充欄位前 MUST 重新檢視個資最小化。
    """
    return PublicSession(
        id=row["id"],
        candidate_name=row["candidate_name"],
        position_title=row["position_title"],
        deadline_at=row["deadline_at"],
        status=SessionStatus(row["status"]),
        collaboration_mode=CollaborationMode(row["collaboration_mode"]),
    )


def start_session(
    session_id: str, started_at: str, deadline_at: str, conn: sqlite3.Connection | None = None
) -> None:
    conn = conn or get_db()
    conn.execute(
        """UPDATE interview_session
              SET started_at = ?, deadline_at = ?, status = 'in_progress'
            WHERE id = ?""",
        (started_at, deadline_at, session_id),
    )
    conn.commit()


def update_session_status(
    session_id: str,
    status: SessionStatus,
    submitted_at: str | None,
    conn: sqlite3.Connection | None = None,
) -> None:
    conn = conn or get_db()
    conn.execute(
        "UPDATE interview_session SET status = ?, submitted_at = ? WHERE id = ?",
        (status.value, submitted_at, session_id),
    )
    conn.commit()


def update_collaboration_mode(
    session_id: str, mode: CollaborationMode, conn: sqlite3.Connection | None = None
) -> None:
    conn = conn or get_db()
    conn.execute(
        "UPDATE interview_session SET collaboration_mode = ? WHERE id = ?",
        (mode.value, session_id),
    )
    conn.commit()


# --- 邀請連結 ---------------------------------------------------------------


def find_invite_token(token: str, conn: sqlite3.Connection | None = None) -> sqlite3.Row | None:
    conn = conn or get_db()
    return conn.execute("SELECT * FROM invite_token WHERE token = ?", (token,)).fetchone()


def mark_token_used(token: str, first_used_at: str, conn: sqlite3.Connection | None = None) -> None:
    conn = conn or get_db()
    conn.execute(
        """UPDATE invite_token
              SET status = 'active', first_used_at = COALESCE(first_used_at, ?)
            WHERE token = ?""",
        (first_used_at, token),
    )
    conn.commit()


def mark_token_consumed(session_id: str, conn: sqlite3.Connection | None = None) -> None:
    conn = conn or get_db()
    conn.execute("UPDATE invite_token SET status = 'consumed' WHERE session_id = ?", (session_id,))
    conn.commit()


# --- 題目 -------------------------------------------------------------------


def _to_public_question(row: sqlite3.Row) -> PublicQuestion:
    predefined = _json(row["predefined_tests_json"], [])
    return PublicQuestion(
        id=row["id"],
        title=row["title"],
        difficulty=row["difficulty"],
        points=row["points"],
        description=row["description"],
        examples=[Example(**e) for e in _json(row["examples_json"], [])],
        complexity_requirement=row["complexity_requirement"],
        grading_focus=_json(row["grading_focus_json"], []),
        starter_code=_json(row["starter_code_json"], {}),
        quick_prompts=_json(row["quick_prompts_json"], []),
        order=row["order"],
        # 只回傳數量，不回傳個別測試案例（FR-030）
        test_count=len(predefined),
    )


def list_session_questions(
    session_id: str, conn: sqlite3.Connection | None = None
) -> list[PublicQuestion]:
    conn = conn or get_db()
    rows = conn.execute(
        """SELECT q.*, sq."order" AS "order"
             FROM session_question sq
             JOIN question q ON q.id = sq.question_id
            WHERE sq.session_id = ?
            ORDER BY sq."order" ASC""",
        (session_id,),
    ).fetchall()
    return [_to_public_question(r) for r in rows]


def is_question_in_session(
    session_id: str, question_id: str, conn: sqlite3.Connection | None = None
) -> bool:
    conn = conn or get_db()
    row = conn.execute(
        "SELECT 1 FROM session_question WHERE session_id = ? AND question_id = ?",
        (session_id, question_id),
    ).fetchone()
    return row is not None


def get_predefined_tests(
    question_id: str, conn: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    """僅供伺服端計算通過數，MUST NOT 出現在任何回應中。"""
    conn = conn or get_db()
    row = conn.execute(
        "SELECT predefined_tests_json FROM question WHERE id = ?", (question_id,)
    ).fetchone()
    return _json(row["predefined_tests_json"], []) if row else []


# --- 作答 -------------------------------------------------------------------


def _to_public_answer(row: sqlite3.Row) -> PublicAnswer:
    return PublicAnswer(
        question_id=row["question_id"],
        language=Language(row["language"]),
        content=row["content"],
        saved_at=row["saved_at"],
        revision=row["revision"],
    )


def list_answers(session_id: str, conn: sqlite3.Connection | None = None) -> list[PublicAnswer]:
    conn = conn or get_db()
    rows = conn.execute("SELECT * FROM answer WHERE session_id = ?", (session_id,)).fetchall()
    return [_to_public_answer(r) for r in rows]


def find_answer(
    session_id: str, question_id: str, conn: sqlite3.Connection | None = None
) -> PublicAnswer | None:
    conn = conn or get_db()
    row = conn.execute(
        "SELECT * FROM answer WHERE session_id = ? AND question_id = ?",
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
    conn: sqlite3.Connection | None = None,
) -> tuple[str, int]:
    conn = conn or get_db()
    saved_at = now_iso()
    conn.execute(
        """INSERT INTO answer (session_id, question_id, language, content, saved_at, revision)
           VALUES (?, ?, ?, ?, ?, ?)
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
    session_id: str, conn: sqlite3.Connection | None = None
) -> list[PublicChatMessage]:
    conn = conn or get_db()
    # 排序 MUST 以 seq；created_at 在同毫秒插入時分不出先後。
    rows = conn.execute(
        "SELECT * FROM chat_message WHERE session_id = ? ORDER BY seq ASC", (session_id,)
    ).fetchall()

    messages: list[PublicChatMessage] = []
    for row in rows:
        blocks = conn.execute(
            """SELECT block_index, language, content
                 FROM chat_code_block WHERE message_id = ? ORDER BY block_index ASC""",
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
    collaboration_mode: CollaborationMode | None = None,
    provider: str | None = None,
    model: str | None = None,
    source: ChatSource | None = None,
    conn: sqlite3.Connection | None = None,
) -> PublicChatMessage:
    """所有訊息 MUST 留存（FR-015）；本模組不提供刪除介面。"""
    conn = conn or get_db()
    message_id = new_id()
    created_at = now_iso()
    seq = _next_seq(conn, "chat_message", session_id)

    conn.execute(
        """INSERT INTO chat_message
             (id, seq, session_id, question_id, role, content, created_at,
              attached_code, collaboration_mode, provider, model, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            message_id,
            seq,
            session_id,
            question_id,
            role.value,
            content,
            created_at,
            attached_code,
            collaboration_mode.value if collaboration_mode else None,
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
    conn: sqlite3.Connection | None = None,
) -> None:
    """寫入 AI 的完整輸出。MUST NOT 在此做任何裁切或改寫（憲章原則 I）。"""
    conn = conn or get_db()
    conn.execute(
        "UPDATE chat_message SET content = ?, provider = ?, model = ? WHERE id = ?",
        (content, provider, model, message_id),
    )
    conn.commit()


# --- 程式碼區塊 -------------------------------------------------------------


def replace_code_blocks(
    message_id: str,
    blocks: list[tuple[int, str | None, str]],
    conn: sqlite3.Connection | None = None,
) -> None:
    conn = conn or get_db()
    conn.execute("DELETE FROM chat_code_block WHERE message_id = ?", (message_id,))
    conn.executemany(
        """INSERT INTO chat_code_block (id, message_id, block_index, language, content)
           VALUES (?, ?, ?, ?, ?)""",
        [(new_id(), message_id, idx, lang, content) for idx, lang, content in blocks],
    )
    conn.commit()


def find_code_block(
    message_id: str, block_index: int, conn: sqlite3.Connection | None = None
) -> sqlite3.Row | None:
    conn = conn or get_db()
    return conn.execute(
        "SELECT * FROM chat_code_block WHERE message_id = ? AND block_index = ?",
        (message_id, block_index),
    ).fetchone()


def find_message(message_id: str, conn: sqlite3.Connection | None = None) -> sqlite3.Row | None:
    conn = conn or get_db()
    return conn.execute("SELECT * FROM chat_message WHERE id = ?", (message_id,)).fetchone()


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
    conn: sqlite3.Connection | None = None,
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
    session_id: str, question_id: str, conn: sqlite3.Connection | None = None
) -> sqlite3.Row | None:
    conn = conn or get_db()
    return conn.execute(
        """SELECT * FROM code_change
            WHERE session_id = ? AND question_id = ?
            ORDER BY seq DESC LIMIT 1""",
        (session_id, question_id),
    ).fetchone()


def list_code_changes(session_id: str, conn: sqlite3.Connection | None = None) -> list[sqlite3.Row]:
    conn = conn or get_db()
    return conn.execute(
        "SELECT * FROM code_change WHERE session_id = ? ORDER BY seq ASC", (session_id,)
    ).fetchall()


# --- 平台外工具事件 ---------------------------------------------------------


def insert_environment_events(
    session_id: str,
    events: list[tuple[str, str, int]],
    conn: sqlite3.Connection | None = None,
) -> int:
    conn = conn or get_db()
    conn.executemany(
        """INSERT INTO environment_event (id, session_id, type, started_at, duration_ms)
           VALUES (?, ?, ?, ?, ?)""",
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
    conn: sqlite3.Connection | None = None,
) -> str:
    conn = conn or get_db()
    ran_at = now_iso()
    conn.execute(
        """INSERT INTO test_run (id, session_id, question_id, passed, total, ran_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (new_id(), session_id, question_id, passed, total, ran_at),
    )
    conn.commit()
    return ran_at
