"""作者歸屬的契約測試（T056）—— 憲章原則 I 的 CI 關卡。

「每一次程式碼變更 MUST 記錄其來源：應試者自行輸入、或套用 AI 產出。
兩者 MUST NOT 混為一談——評分需要能區分『誰寫的』。」
"""

from __future__ import annotations

import pytest

from techinterview.core.schemas import ChangeSource, Language
from techinterview.db import queries
from techinterview.domain import attribution


@pytest.fixture
def seeded(test_db, fixture):
    return fixture


def _changes(session_id: str) -> list[dict]:
    return [dict(r) for r in queries.list_code_changes(session_id)]


class TestCandidateAttribution:
    def test_manual_save_records_candidate_source(self, seeded):
        attribution.record_candidate_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content="我自己寫的內容",
            revision=1,
        )

        changes = _changes(seeded.session_id)
        assert len(changes) == 1
        assert changes[0]["source"] == ChangeSource.CANDIDATE
        assert changes[0]["chat_message_id"] is None
        assert changes[0]["block_index"] is None

    def test_consecutive_manual_saves_each_recorded(self, seeded):
        for i, content in enumerate(["v1", "v2", "v3"], start=1):
            attribution.record_candidate_change(
                session_id=seeded.session_id,
                question_id=seeded.question_ids[0],
                content=content,
                revision=i,
            )

        changes = _changes(seeded.session_id)
        assert [c["content"] for c in changes] == ["v1", "v2", "v3"]
        assert all(c["source"] == ChangeSource.CANDIDATE for c in changes)


class TestAiAttribution:
    def test_apply_records_ai_source_with_provenance(self, seeded, assistant_message):
        message_id, _ = assistant_message

        attribution.record_ai_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content="AI 產出的內容",
            revision=1,
            chat_message_id=message_id,
            block_index=0,
        )

        changes = _changes(seeded.session_id)
        assert len(changes) == 1
        assert changes[0]["source"] == ChangeSource.AI
        assert changes[0]["chat_message_id"] == message_id
        assert changes[0]["block_index"] == 0


class TestDeduplication:
    """research R-014：套用後的第一次自動保存不是新的人工輸入。

    沒有這條規則，每次套用 AI 產出後都會緊接著出現一筆假的 candidate 變更，
    讓歸屬統計失真——而 SC-010 要求歸屬正確率 100%。
    """

    def test_autosave_right_after_apply_is_not_recorded(self, seeded, assistant_message):
        message_id, block_content = assistant_message

        attribution.record_ai_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content=block_content,
            revision=1,
            chat_message_id=message_id,
            block_index=0,
        )
        # 套用後編輯器觸發的第一次 debounce 保存，內容與剛套用的完全相同
        attribution.record_candidate_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content=block_content,
            revision=2,
        )

        changes = _changes(seeded.session_id)
        assert len(changes) == 1, "套用後的第一次自動保存不應產生 candidate 記錄"
        assert changes[0]["source"] == ChangeSource.AI

    def test_real_edit_after_apply_is_recorded(self, seeded, assistant_message):
        message_id, block_content = assistant_message

        attribution.record_ai_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content=block_content,
            revision=1,
            chat_message_id=message_id,
            block_index=0,
        )
        attribution.record_candidate_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content=block_content + "\n// 我自己補的一行",
            revision=2,
        )

        changes = _changes(seeded.session_id)
        assert len(changes) == 2
        assert changes[1]["source"] == ChangeSource.CANDIDATE

    def test_dedup_is_scoped_per_question(self, seeded, assistant_message):
        """Q1 套用的內容，不該讓 Q2 的相同內容被誤判為重複。"""
        message_id, block_content = assistant_message

        attribution.record_ai_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content=block_content,
            revision=1,
            chat_message_id=message_id,
            block_index=0,
        )
        attribution.record_candidate_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[1],
            content=block_content,
            revision=1,
        )

        changes = _changes(seeded.session_id)
        assert len(changes) == 2
        assert changes[1]["source"] == ChangeSource.CANDIDATE


class TestAttributionCompleteness:
    """SC-010：面試官能還原「哪些由 AI 產生、哪些由應試者自行撰寫」，正確率 100%。"""

    def test_every_change_has_resolvable_source(self, seeded, assistant_message):
        message_id, block_content = assistant_message

        attribution.record_candidate_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content="起手式",
            revision=1,
        )
        attribution.record_ai_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content=block_content,
            revision=2,
            chat_message_id=message_id,
            block_index=0,
        )
        attribution.record_candidate_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content=block_content + "\n// 調整",
            revision=3,
        )

        changes = _changes(seeded.session_id)
        assert len(changes) == 3
        assert [c["source"] for c in changes] == [
            ChangeSource.CANDIDATE,
            ChangeSource.AI,
            ChangeSource.CANDIDATE,
        ]
        # 每一筆 ai 變更都能追溯回具體的對話訊息與區塊
        ai_changes = [c for c in changes if c["source"] == ChangeSource.AI]
        assert all(c["chat_message_id"] and c["block_index"] is not None for c in ai_changes)

    def test_save_flow_records_language_independent_content(self, seeded):
        """歸屬記錄的是內容，與語言選擇無關。"""
        queries.upsert_answer(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            language=Language.PYTHON,
            content="print(1)",
            revision=1,
        )
        attribution.record_candidate_change(
            session_id=seeded.session_id,
            question_id=seeded.question_ids[0],
            content="print(1)",
            revision=1,
        )

        changes = _changes(seeded.session_id)
        assert changes[0]["content"] == "print(1)"
