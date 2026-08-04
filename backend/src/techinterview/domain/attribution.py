"""程式碼變更的作者歸屬（T067）—— 憲章原則 I 的核心。

「每一次程式碼變更 MUST 記錄其來源：應試者自行輸入、或套用 AI 產出。
兩者 MUST NOT 混為一談——評分需要能區分『誰寫的』。」

資料庫的 CHECK 約束已讓不對應的寫入不可能發生；本模組負責的是
「什麼時候該記、什麼時候不該記」的判斷（research R-014）。
"""

from __future__ import annotations

import psycopg

from techinterview.core.schemas import ChangeSource
from techinterview.db import queries


def record_ai_change(
    *,
    session_id: str,
    question_id: str,
    content: str,
    revision: int,
    chat_message_id: str,
    block_index: int,
    conn: psycopg.Connection | None = None,
) -> str:
    """套用 AI 產出時記錄。來源訊息與區塊 MUST 一併留存，供評分時追溯。"""
    return queries.insert_code_change(
        session_id=session_id,
        question_id=question_id,
        source=ChangeSource.AI,
        content=content,
        revision=revision,
        chat_message_id=chat_message_id,
        block_index=block_index,
        conn=conn,
    )


def record_candidate_change(
    *,
    session_id: str,
    question_id: str,
    content: str,
    revision: int,
    conn: psycopg.Connection | None = None,
) -> str | None:
    """應試者自行輸入時記錄；重複於套用結果者不記錄。

    去重規則（research R-014）：若本次內容與該題最近一次 `ai` 變更完全相同，
    這只是套用後編輯器觸發的第一次 debounce 保存，不是新的人工輸入。
    沒有這條規則，每次套用都會緊接著產生一筆假的 candidate 記錄，
    歸屬統計直接失真——而 SC-010 要求正確率 100%。

    回傳 None 表示刻意未記錄。
    """
    latest = queries.latest_code_change(session_id, question_id, conn=conn)
    if (
        latest is not None
        and latest["source"] == ChangeSource.AI.value
        and latest["content"] == content
    ):
        return None

    return queries.insert_code_change(
        session_id=session_id,
        question_id=question_id,
        source=ChangeSource.CANDIDATE,
        content=content,
        revision=revision,
        conn=conn,
    )
