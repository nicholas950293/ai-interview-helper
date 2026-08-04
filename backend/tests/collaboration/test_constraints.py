"""資料庫 CHECK 約束的測試（T057）。

憲章原則 I：「兩者 MUST NOT 混為一談」。
應用層自律不夠——讓不對應的寫入在資料庫層就被拒絕。
"""

from __future__ import annotations

import sqlite3

import pytest

from techinterview.db import queries


def _insert_raw(conn, **kwargs):
    conn.execute(
        """INSERT INTO code_change
             (id, seq, session_id, question_id, source, content, revision,
              created_at, chat_message_id, block_index)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            queries.new_id(),
            kwargs.get("seq", 1),
            kwargs["session_id"],
            kwargs["question_id"],
            kwargs["source"],
            kwargs.get("content", "x"),
            kwargs.get("revision", 1),
            queries.now_iso(),
            kwargs.get("chat_message_id"),
            kwargs.get("block_index"),
        ),
    )
    conn.commit()


class TestCodeChangeConstraints:
    def test_ai_without_message_id_is_rejected(self, test_db, fixture):
        with pytest.raises(sqlite3.IntegrityError):
            _insert_raw(
                test_db,
                session_id=fixture.session_id,
                question_id=fixture.question_ids[0],
                source="ai",
                chat_message_id=None,
                block_index=0,
            )

    def test_ai_without_block_index_is_rejected(self, test_db, fixture, assistant_message):
        message_id, _ = assistant_message
        with pytest.raises(sqlite3.IntegrityError):
            _insert_raw(
                test_db,
                session_id=fixture.session_id,
                question_id=fixture.question_ids[0],
                source="ai",
                chat_message_id=message_id,
                block_index=None,
            )

    def test_candidate_with_message_id_is_rejected(self, test_db, fixture, assistant_message):
        """應試者自行輸入的變更不得偽裝成有 AI 來源。"""
        message_id, _ = assistant_message
        with pytest.raises(sqlite3.IntegrityError):
            _insert_raw(
                test_db,
                session_id=fixture.session_id,
                question_id=fixture.question_ids[0],
                source="candidate",
                chat_message_id=message_id,
                block_index=0,
            )

    def test_unknown_source_is_rejected(self, test_db, fixture):
        with pytest.raises(sqlite3.IntegrityError):
            _insert_raw(
                test_db,
                session_id=fixture.session_id,
                question_id=fixture.question_ids[0],
                source="somewhere_else",
            )

    def test_valid_rows_are_accepted(self, test_db, fixture, assistant_message):
        message_id, _ = assistant_message
        _insert_raw(
            test_db,
            session_id=fixture.session_id,
            question_id=fixture.question_ids[0],
            source="candidate",
            seq=1,
        )
        _insert_raw(
            test_db,
            session_id=fixture.session_id,
            question_id=fixture.question_ids[0],
            source="ai",
            chat_message_id=message_id,
            block_index=0,
            seq=2,
        )
        assert len(queries.list_code_changes(fixture.session_id)) == 2


class TestEnvironmentEventConstraints:
    def test_short_event_is_rejected_at_db_level(self, test_db, fixture):
        """< 1000ms 的事件連寫都寫不進去（FR-025 的門檻）。"""
        with pytest.raises(sqlite3.IntegrityError):
            test_db.execute(
                """INSERT INTO environment_event (id, session_id, type, started_at, duration_ms)
                   VALUES (?, ?, 'tab_hidden', ?, 999)""",
                (queries.new_id(), fixture.session_id, queries.now_iso()),
            )
            test_db.commit()

    def test_no_verdict_columns_exist(self, test_db):
        """MUST NOT 含任何判定欄位（FR-026）——欄位不存在就寫不進去。"""
        cols = {r["name"] for r in test_db.execute("PRAGMA table_info(environment_event)")}
        assert cols == {"id", "session_id", "type", "started_at", "duration_ms"}


class TestCodeBlockConstraints:
    def test_duplicate_block_index_is_rejected(self, test_db, fixture, assistant_message):
        message_id, _ = assistant_message
        with pytest.raises(sqlite3.IntegrityError):
            test_db.execute(
                """INSERT INTO chat_code_block (id, message_id, block_index, language, content)
                   VALUES (?, ?, 0, 'javascript', 'x')""",
                (queries.new_id(), message_id),
            )
            test_db.commit()
