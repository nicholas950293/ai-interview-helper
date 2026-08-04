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

_FAKE_DISCUSS = """先把問題拆開來看。

你要的是「過濾後再轉換」，這在實作上有兩種走法：一次走訪同時做完，
或先 filter 再 map。前者少一次配置，後者可讀性好一些；資料量不大時差異可以忽略。

真正會影響正確性的是邊界定義：0 算不算正數？輸入可能是 null 嗎？
這兩題決定了判斷式要怎麼寫。你先決定，我再依此產出實作。
"""


async def fake_stream(prompt: str, mode: str) -> AsyncIterator[str]:
    """腳本化回應，供端到端驗證串流與套用流程。"""
    import asyncio

    text = _FAKE_DISCUSS if mode == "discuss" else _FAKE_IMPLEMENT
    for i in range(0, len(text), 24):
        await asyncio.sleep(0.005)
        yield text[i : i + 24]
