"""資料庫連線與遷移（T018）。

Increment 1 以 SQLite 實作。憲章原則 V 要求 Supabase，屬已記錄的落差——
因此本模組只暴露 `get_db()` / `set_db()` 這組介面，呼叫端不知道底層是什麼，
後續替換為 Supabase client 時不必改動 queries 以外的任何檔案。
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from techinterview.core.config import BACKEND_ROOT, get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

# FastAPI 的同步端點跑在 threadpool，多個執行緒會同時進來。
# 共用單一 sqlite3 連線會讓 commit 互相競態（實測會出現
# "cannot commit - no transaction is active"），因此檔案型資料庫改為
# 每個執行緒各自持有連線；WAL + busy_timeout 負責跨連線的協調。
# `set_db()` 注入的連線（測試用的 :memory:）仍為共用——測試是單執行緒。
_injected: sqlite3.Connection | None = None
_local = threading.local()


def _open(path: str) -> sqlite3.Connection:
    if path != ":memory:":
        resolved = Path(path)
        if not resolved.is_absolute():
            resolved = BACKEND_ROOT / resolved
        resolved.parent.mkdir(parents=True, exist_ok=True)
        path = str(resolved)

    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    # 寫入者互相等待而非立刻回 SQLITE_BUSY——串流、草稿保存與 seed 可能同時寫入。
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def get_db() -> sqlite3.Connection:
    if _injected is not None:
        return _injected
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _open(get_settings().database_path)
        _local.conn = conn
    return conn


def set_db(conn: sqlite3.Connection) -> None:
    """測試用：以獨立的記憶體資料庫取代預設連線。"""
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


def _ensure_migrations_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migration (
          name       TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
        """
    )
    conn.commit()


def run_migrations(conn: sqlite3.Connection | None = None) -> list[str]:
    """依檔名順序套用尚未執行的遷移；每個遷移在單一交易中完成。"""
    conn = conn or get_db()
    _ensure_migrations_table(conn)

    applied = {row["name"] for row in conn.execute("SELECT name FROM schema_migration")}
    executed: list[str] = []

    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name in applied:
            continue
        sql = path.read_text(encoding="utf-8")
        try:
            conn.executescript(sql)
            conn.execute("INSERT INTO schema_migration (name) VALUES (?)", (path.name,))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        executed.append(path.name)

    return executed


def main() -> None:
    executed = run_migrations()
    if executed:
        print(f"[db] 已套用 {len(executed)} 個遷移：{', '.join(executed)}")
    else:
        print("[db] 無待執行的遷移，schema 已是最新。")


if __name__ == "__main__":
    main()
