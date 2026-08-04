"""資料庫連線（T018）。

憲章原則 V 要求 Supabase。後端以 **psycopg 直連 Postgres**，不走 PostgREST：

- 查詢層是大量原生 SQL（含 CHECK 約束、交易、seq 計算），PostgREST 表達不了，
  硬要改寫會把資料完整性的判斷從資料庫搬回應用層——正是憲章原則 I 不允許的方向。
- Data API 表面因此可以完全關閉（見 supabase/migrations/0004_rls.sql），
  anon key 外流也讀不到任何東西。

`get_db()` / `set_db()` 的介面與 SQLite 版相同，呼叫端不知道底層換過。
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime

import psycopg
from psycopg.rows import dict_row
from psycopg.types.datetime import TimestamptzLoader

from techinterview.core.config import get_settings


class _IsoTimestamptzLoader(TimestamptzLoader):
    """把 timestamptz 讀成 API 契約要求的 ISO-8601 字串。

    整個應用層（auth 的逾期判斷、submission 的計時、送往前端的 payload）
    都以 `2026-08-05T01:23:45.678Z` 這種字串在運作。若讓 psycopg 回傳
    datetime，這些地方全都要改，且每個轉換點都是一次格式出錯的機會。
    在型別載入器統一轉一次，消費端因此完全不必更動。
    """

    def load(self, data):  # type: ignore[override]
        value = super().load(data)
        if value is None:
            return None
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


_injected: psycopg.Connection | None = None
_local = threading.local()


def _dsn() -> str:
    return get_settings().database_url


def _open(dsn: str) -> psycopg.Connection:
    conn = psycopg.connect(dsn, row_factory=dict_row, autocommit=False)
    conn.adapters.register_loader("timestamptz", _IsoTimestamptzLoader)
    return conn


def get_db() -> psycopg.Connection:
    """取得本執行緒的連線。

    FastAPI 的同步端點跑在 threadpool，多個執行緒會同時進來；psycopg 的連線
    不是執行緒安全的，因此每個執行緒各自持有一條。
    `set_db()` 注入的連線（測試用）仍為共用——測試是單執行緒。
    """
    if _injected is not None:
        return _injected

    conn = getattr(_local, "conn", None)
    if conn is None or conn.closed:
        conn = _open(_dsn())
        _local.conn = conn
    return conn


def set_db(conn: psycopg.Connection | None) -> None:
    """測試用：以指定連線取代預設連線。"""
    global _injected
    _injected = conn


def close_db() -> None:
    global _injected
    if _injected is not None:
        _injected.close()
        _injected = None
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None


def utc_now() -> datetime:
    return datetime.now(UTC)
