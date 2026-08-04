"""場次狀態機（T023）。

    not_started ──兌換連結──> in_progress ──手動提交──> submitted
                                  └──deadline 到期──> expired_submitted

兩個終態皆不可逆；進入終態時所有作答轉為唯讀。
"""

from __future__ import annotations

from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import SessionStatus

_TRANSITIONS: dict[SessionStatus, tuple[SessionStatus, ...]] = {
    SessionStatus.NOT_STARTED: (SessionStatus.IN_PROGRESS,),
    SessionStatus.IN_PROGRESS: (SessionStatus.SUBMITTED, SessionStatus.EXPIRED_SUBMITTED),
    SessionStatus.SUBMITTED: (),
    SessionStatus.EXPIRED_SUBMITTED: (),
}

_TERMINAL = (SessionStatus.SUBMITTED, SessionStatus.EXPIRED_SUBMITTED)


def is_terminal(status: SessionStatus) -> bool:
    return status in _TERMINAL


def can_transition(source: SessionStatus, target: SessionStatus) -> bool:
    return target in _TRANSITIONS[source]


def transition(source: SessionStatus, target: SessionStatus) -> SessionStatus:
    """非法轉移一律擲出 AppError——終態回 SESSION_SUBMITTED，未開始回 SESSION_NOT_STARTED。"""
    if can_transition(source, target):
        return target
    raise AppError(
        ErrorCode.SESSION_SUBMITTED if is_terminal(source) else ErrorCode.SESSION_NOT_STARTED
    )


def is_writable(status: SessionStatus) -> bool:
    """僅 in_progress 允許寫入草稿、提問、套用與事件。"""
    return status is SessionStatus.IN_PROGRESS


def assert_writable(status: SessionStatus) -> None:
    """寫入前的守門；訊息可直接呈現給應試者（FR-031）。"""
    if is_writable(status):
        return
    raise AppError(
        ErrorCode.SESSION_SUBMITTED if is_terminal(status) else ErrorCode.SESSION_NOT_STARTED
    )


def next_status_for_submission(*, expired: bool) -> SessionStatus:
    """逾期觸發者與手動提交者必須可區分（供 Phase 4 評分後台辨識）。"""
    return SessionStatus.EXPIRED_SUBMITTED if expired else SessionStatus.SUBMITTED
