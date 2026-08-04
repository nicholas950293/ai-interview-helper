"""套用 supabase/migrations 下的 SQL（T014–T017）。

正式環境的遷移由 Supabase CLI 負責（`supabase db push` / `supabase db reset`），
本模組**不是**它的替代品——它存在只為了兩件 CLI 不方便做的事：

  1. 測試需要在獨立資料庫上重建 schema，而 CLI 只認 config.toml 指定的那一個。
  2. CI 若沒有 Docker，仍要能對一個現成的 Postgres 建表。

因此這裡刻意不做版本追蹤：呼叫端負責給一個乾淨的資料庫。
真正的遷移歷史由 supabase/migrations 的檔名順序與 CLI 維護。
"""

from __future__ import annotations

from pathlib import Path

import psycopg

# backend/src/techinterview/db/migrate.py → 專案根目錄
REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def apply_migrations(conn: psycopg.Connection) -> list[str]:
    """依檔名順序套用全部遷移。整批在單一交易內完成。"""
    applied: list[str] = []
    with conn.transaction():
        for path in migration_files():
            conn.execute(path.read_text(encoding="utf-8"))  # type: ignore[arg-type]
            applied.append(path.name)
    return applied


def main() -> None:
    from techinterview.core.config import get_settings

    dsn = get_settings().database_url
    with psycopg.connect(dsn) as conn:
        applied = apply_migrations(conn)
    print(f"[db] 已套用 {len(applied)} 個遷移：{', '.join(applied)}")


if __name__ == "__main__":
    main()
