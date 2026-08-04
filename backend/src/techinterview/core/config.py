"""型別安全的環境設定（T003）。

憲章「憑證隔離」：`GOOGLE_API_KEY`、`ANTHROPIC_API_KEY` 與 Supabase service role key
只在此模組讀取，只被 `ai/` 與 `db/` 消費。任何前端可觸及的模組 MUST NOT 匯入本檔。
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[3]

Provider = Literal["google_genai", "anthropic"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 8787
    environment: Literal["development", "test", "production"] = "development"

    # --- 持久化（憲章原則 V：Supabase）--------------------------------------
    # 後端以 psycopg 直連 Postgres，不走 PostgREST——理由見 db/client.py。
    # 預設值為 `supabase start` 的本地實例；正式環境由 Supabase 專案的
    # connection string 覆寫（Dashboard → Project Settings → Database）。
    database_url: str = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

    # 供 PostgREST／Storage 等 Data API 使用。本後端目前沒有消費者，
    # 保留是為了讓遷移工具與日後的功能有一致的來源（憲章「憑證隔離」）。
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # --- Session Cookie -----------------------------------------------------
    session_secret: str = Field(min_length=32)
    cookie_secure: bool = False

    # --- AI（憲章原則 V：雙供應商，一律經 LangChain）------------------------
    google_api_key: str = ""
    anthropic_api_key: str = ""
    ai_provider: Provider = "google_genai"
    ai_model: str = "gemini-3.6-flash"
    # 主要供應商不可用時的退回對象；留空表示不退回。
    ai_fallback_provider: Provider | None = None
    ai_fallback_model: str = ""

    ai_stream_timeout_ms: int = 20_000

    # 以腳本化的假回應取代真實模型，供端到端驗證使用。
    # production 一律無效（見 `ai_fake_enabled`）。
    ai_fake: bool = False

    @field_validator("ai_fallback_provider", mode="before")
    @classmethod
    def _empty_to_none(cls, value: object) -> object:
        return None if value in ("", None) else value

    @property
    def ai_fake_enabled(self) -> bool:
        """假回應在 production 一律關閉——這個開關不得成為關掉模型的後門。"""
        return self.environment != "production" and self.ai_fake

    def api_key_for(self, provider: Provider) -> str:
        return self.google_api_key if provider == "google_genai" else self.anthropic_api_key

    @property
    def configured_providers(self) -> list[Provider]:
        """已備妥金鑰的供應商。缺金鑰不影響程式碼對雙供應商的支援。"""
        available: list[Provider] = []
        for provider in ("google_genai", "anthropic"):
            if self.api_key_for(provider):  # type: ignore[arg-type]
                available.append(provider)  # type: ignore[arg-type]
        return available


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


def reset_settings_cache() -> None:
    """測試用：清除快取以便重新載入不同的設定。"""
    get_settings.cache_clear()


def make_test_settings(**overrides: object) -> Settings:
    """測試預設值，避免每個測試檔都要自備 .env。"""
    defaults: dict[str, object] = {
        "environment": "test",
        "database_path": ":memory:",
        "session_secret": secrets.token_hex(32),
        "ai_provider": "google_genai",
        "ai_model": "gemini-3.6-flash",
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]
