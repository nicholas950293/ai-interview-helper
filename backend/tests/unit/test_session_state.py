"""場次狀態機（T022）。"""

from __future__ import annotations

import pytest

from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import SessionStatus as S
from techinterview.domain.session_state import (
    assert_writable,
    can_transition,
    is_terminal,
    is_writable,
    next_status_for_submission,
    transition,
)

TERMINALS = [S.SUBMITTED, S.EXPIRED_SUBMITTED]


class TestLegalTransitions:
    def test_not_started_to_in_progress(self):
        assert can_transition(S.NOT_STARTED, S.IN_PROGRESS)
        assert transition(S.NOT_STARTED, S.IN_PROGRESS) is S.IN_PROGRESS

    def test_in_progress_to_submitted(self):
        assert transition(S.IN_PROGRESS, S.SUBMITTED) is S.SUBMITTED

    def test_in_progress_to_expired_submitted(self):
        assert transition(S.IN_PROGRESS, S.EXPIRED_SUBMITTED) is S.EXPIRED_SUBMITTED


class TestTerminalIsIrreversible:
    @pytest.mark.parametrize("status", TERMINALS)
    def test_is_terminal(self, status):
        assert is_terminal(status)

    @pytest.mark.parametrize("status", [S.NOT_STARTED, S.IN_PROGRESS])
    def test_is_not_terminal(self, status):
        assert not is_terminal(status)

    @pytest.mark.parametrize("source", TERMINALS)
    def test_no_transition_out_of_terminal(self, source):
        for target in S:
            assert not can_transition(source, target)

    @pytest.mark.parametrize("source", TERMINALS)
    def test_transition_raises_session_submitted(self, source):
        with pytest.raises(AppError) as exc:
            transition(source, S.IN_PROGRESS)
        assert exc.value.code is ErrorCode.SESSION_SUBMITTED


class TestIllegalTransitions:
    def test_cannot_skip_to_submitted(self):
        assert not can_transition(S.NOT_STARTED, S.SUBMITTED)

    def test_cannot_return_to_not_started(self):
        assert not can_transition(S.IN_PROGRESS, S.NOT_STARTED)
        assert not can_transition(S.NOT_STARTED, S.NOT_STARTED)

    def test_not_started_raises_session_not_started(self):
        with pytest.raises(AppError) as exc:
            transition(S.NOT_STARTED, S.SUBMITTED)
        assert exc.value.code is ErrorCode.SESSION_NOT_STARTED


class TestWritability:
    def test_only_in_progress_is_writable(self):
        assert is_writable(S.IN_PROGRESS)
        assert not is_writable(S.NOT_STARTED)
        assert not is_writable(S.SUBMITTED)
        assert not is_writable(S.EXPIRED_SUBMITTED)

    @pytest.mark.parametrize("status", TERMINALS)
    def test_assert_writable_raises_on_terminal(self, status):
        with pytest.raises(AppError) as exc:
            assert_writable(status)
        assert exc.value.code is ErrorCode.SESSION_SUBMITTED

    def test_assert_writable_raises_on_not_started(self):
        with pytest.raises(AppError) as exc:
            assert_writable(S.NOT_STARTED)
        assert exc.value.code is ErrorCode.SESSION_NOT_STARTED

    def test_assert_writable_passes_on_in_progress(self):
        assert_writable(S.IN_PROGRESS)


class TestSubmissionStatus:
    def test_manual(self):
        assert next_status_for_submission(expired=False) is S.SUBMITTED

    def test_expired(self):
        assert next_status_for_submission(expired=True) is S.EXPIRED_SUBMITTED
