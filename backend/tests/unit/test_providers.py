"""LangChain 供應商工廠（T053）。

憲章原則 V：
- MUST 同時支援 Gemini 與 Claude
- MUST NOT 於應用程式碼中直接裸接個別供應商的 SDK
- 切換或組合 MUST 可透過設定完成，MUST NOT 需要改動業務邏輯
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from techinterview.ai import providers
from techinterview.core import config
from techinterview.core.errors import AppError, ErrorCode

SRC = Path(providers.__file__).resolve().parents[1]


def _patch_settings(monkeypatch, **overrides):
    settings = config.make_test_settings(**overrides)
    monkeypatch.setattr(providers, "get_settings", lambda: settings)
    return settings


class TestConfigDrivenSwitching:
    def test_default_provider_from_settings(self, monkeypatch):
        _patch_settings(monkeypatch, ai_provider="google_genai", ai_model="gemini-3.6-flash")
        choice = providers.resolve_model_choice()
        assert choice.provider == "google_genai"
        assert choice.model == "gemini-3.6-flash"

    def test_switching_provider_needs_no_code_change(self, monkeypatch):
        """只改設定就換供應商——業務邏輯完全不動。"""
        _patch_settings(monkeypatch, ai_provider="anthropic", ai_model="claude-sonnet-4-5")
        choice = providers.resolve_model_choice()
        assert choice.provider == "anthropic"
        assert choice.model == "claude-sonnet-4-5"

    def test_fallback_resolved_when_configured(self, monkeypatch):
        _patch_settings(
            monkeypatch,
            ai_fallback_provider="anthropic",
            ai_fallback_model="claude-sonnet-4-5",
        )
        fallback = providers.resolve_fallback()
        assert fallback is not None
        assert fallback.provider == "anthropic"

    def test_no_fallback_by_default(self, monkeypatch):
        _patch_settings(monkeypatch)
        assert providers.resolve_fallback() is None


class TestAvailability:
    def test_not_configured_without_key(self, monkeypatch):
        settings = _patch_settings(monkeypatch, ai_fake=False, google_api_key="")
        assert settings.configured_providers == []
        assert not providers.is_configured()

    def test_configured_with_key(self, monkeypatch):
        _patch_settings(monkeypatch, ai_fake=False, google_api_key="k")
        assert providers.is_configured()

    def test_both_providers_supported(self, monkeypatch):
        """憲章要求程式碼同時支援兩家；金鑰是執行期設定。"""
        settings = _patch_settings(monkeypatch, google_api_key="g", anthropic_api_key="a")
        assert set(settings.configured_providers) == {"google_genai", "anthropic"}

    def test_build_without_key_raises_ai_unavailable(self, monkeypatch):
        _patch_settings(monkeypatch, ai_fake=False, google_api_key="")
        with pytest.raises(AppError) as exc:
            providers.build_chat_model()
        assert exc.value.code is ErrorCode.AI_UNAVAILABLE


class TestNoRawSdkImports:
    """MUST NOT 於應用程式碼中直接裸接個別供應商的 SDK（憲章原則 V）。"""

    FORBIDDEN = {"google", "google_genai", "anthropic", "openai"}

    def _imported_roots(self, path: Path) -> set[str]:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        roots: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                roots.add(node.module.split(".")[0])
        return roots

    def test_no_module_imports_provider_sdk_directly(self):
        offenders: list[str] = []
        for path in SRC.rglob("*.py"):
            hits = self._imported_roots(path) & self.FORBIDDEN
            if hits:
                offenders.append(f"{path.relative_to(SRC)}: {sorted(hits)}")
        assert offenders == [], f"應改用 LangChain 的 init_chat_model：{offenders}"

    def test_providers_module_uses_langchain(self):
        source = Path(providers.__file__).read_text(encoding="utf-8")
        assert "init_chat_model" in source


class TestFakeStream:
    async def test_fake_is_disabled_in_production(self, monkeypatch):
        settings = _patch_settings(monkeypatch, environment="production", ai_fake=True)
        assert not settings.ai_fake_enabled

    async def test_implement_mode_yields_code_block(self):
        text = "".join([chunk async for chunk in providers.fake_stream("x", "implement")])
        assert "```" in text

    async def test_discuss_mode_yields_no_code_block(self):
        text = "".join([chunk async for chunk in providers.fake_stream("x", "discuss")])
        assert "```" not in text
