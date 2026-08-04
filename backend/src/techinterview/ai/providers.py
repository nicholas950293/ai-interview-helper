"""LangChain 供應商工廠（T061）。

憲章原則 V：
- MUST 同時支援 Google Gemini 與 Anthropic Claude
- 所有模型呼叫 MUST 透過 LangChain；**MUST NOT 於應用程式碼中直接裸接供應商 SDK**
- 供應商的切換或組合 MUST 可透過設定完成，MUST NOT 需要改動業務邏輯

因此本檔只 import `langchain`，不 import `google.generativeai` 或 `anthropic`。
`init_chat_model` 內部會依 provider 字串載入對應的 partner 套件。
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from dataclasses import dataclass

from techinterview.core.config import Provider, get_settings
from techinterview.core.errors import AppError, ErrorCode


@dataclass(frozen=True)
class ModelChoice:
    provider: Provider
    model: str


def resolve_model_choice() -> ModelChoice:
    """由設定決定供應商與模型；業務邏輯不需要知道是哪一家。"""
    settings = get_settings()
    return ModelChoice(provider=settings.ai_provider, model=settings.ai_model)


def resolve_fallback() -> ModelChoice | None:
    settings = get_settings()
    if settings.ai_fallback_provider and settings.ai_fallback_model:
        return ModelChoice(provider=settings.ai_fallback_provider, model=settings.ai_fallback_model)
    return None


def is_configured() -> bool:
    """AI 是否可用。缺金鑰時路由層回 AI_UNAVAILABLE 而非崩潰。"""
    settings = get_settings()
    return settings.ai_fake_enabled or bool(settings.api_key_for(settings.ai_provider))


def _build_one(choice: ModelChoice):
    from langchain.chat_models import init_chat_model

    settings = get_settings()
    api_key = settings.api_key_for(choice.provider)
    if not api_key:
        raise AppError(ErrorCode.AI_UNAVAILABLE)

    # LangChain 的 partner 套件由環境變數取金鑰；此處是唯一的注入點。
    env_var = "GOOGLE_API_KEY" if choice.provider == "google_genai" else "ANTHROPIC_API_KEY"
    os.environ[env_var] = api_key

    return init_chat_model(choice.model, model_provider=choice.provider)


def build_chat_model():
    """建立供應商無關的 chat model。

    設定了 fallback 時以 LangChain 的 `with_fallbacks` 表達退回——
    退回邏輯同樣不需要業務邏輯介入（憲章原則 V）。
    """
    primary = _build_one(resolve_model_choice())
    fallback = resolve_fallback()
    if fallback is None:
        return primary
    try:
        return primary.with_fallbacks([_build_one(fallback)])
    except AppError:
        # 次要供應商未設定金鑰時，主要供應商仍可用。
        return primary


# --- 腳本化假回應（僅限非 production）---------------------------------------

_FAKE_IMPLEMENT = """我先照你的需求做一版，假設輸入都是合法的整數陣列。

```javascript
function solve(items) {
  const result = [];
  for (const item of items) {
    if (item > 0) {
      result.push(item * 2);
    }
  }
  return result;
}
```

時間複雜度 O(n)、空間 O(n)。有兩個邊界你可能想確認：空陣列會回傳空陣列；
負數與 0 會被略過——如果 0 應該保留，跟我說我改。
"""


async def fake_stream(prompt: str) -> AsyncIterator[str]:
    """腳本化回應，供端到端驗證串流與套用流程。

    固定回傳含完整實作的那一份。系統提示要求 AI「依提問的意圖回應」——
    概念問題就別附完整實作——但那是**模型的行為**，腳本化的回應驗證不了它，
    硬寫個關鍵字判斷只會製造「測過了」的假象。該項以真實模型人工驗證。
    """
    import asyncio

    for i in range(0, len(_FAKE_IMPLEMENT), 24):
        await asyncio.sleep(0.005)
        yield _FAKE_IMPLEMENT[i : i + 24]
