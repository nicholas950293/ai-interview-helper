"""LangChain astream → SSE（T063）。

**本模組沒有任何輸出攔截或改寫**。AI 產出什麼就送出什麼（憲章原則 I）。
唯一會中止串流的情況是場次進入終態——那是計時規則，不是內容審查。
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from techinterview.ai import providers
from techinterview.ai.code_blocks import extract_code_blocks
from techinterview.ai.prompts import PromptContext, build_system_prompt
from techinterview.core.errors import AppError, ErrorCode
from techinterview.core.schemas import SessionStatus
from techinterview.db import queries
from techinterview.domain.session_state import is_terminal

logger = logging.getLogger(__name__)


@dataclass
class PendingStream:
    session_id: str
    message_id: str
    context: PromptContext
    prompt: str
    history: list[tuple[str, str]] = field(default_factory=list)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _model_stream(pending: PendingStream) -> AsyncIterator[str]:
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    system = build_system_prompt(pending.context)
    messages: list = [SystemMessage(content=system)]
    for role, content in pending.history:
        messages.append(
            HumanMessage(content=content) if role == "candidate" else AIMessage(content=content)
        )
    # 應試者的輸入一律是 human turn，永遠不會進入 system 位置。
    messages.append(HumanMessage(content=pending.prompt))

    model = providers.build_chat_model()
    async for chunk in model.astream(messages):
        text = getattr(chunk, "text", None)
        if callable(text):
            text = text()
        if not text:
            content = getattr(chunk, "content", "")
            text = content if isinstance(content, str) else ""
        if text:
            yield text


async def stream_response(pending: PendingStream) -> AsyncIterator[str]:
    """產生 SSE 事件序列：token* → blocks → done，或 error。"""
    settings_choice = providers.resolve_model_choice()
    buffer: list[str] = []

    try:
        if not providers.is_configured():
            raise AppError(ErrorCode.AI_UNAVAILABLE)

        from techinterview.core.config import get_settings

        if get_settings().ai_fake_enabled:
            source = providers.fake_stream(pending.prompt)
        else:
            source = _model_stream(pending)

        async for token in source:
            # 場次進入終態時立即中止（Edge Case：時間歸零當下 AI 正在回覆）
            row = queries.find_session(pending.session_id)
            if row is None or is_terminal(SessionStatus(row["status"])):
                queries.update_chat_message_content(pending.message_id, "".join(buffer))
                yield sse(
                    "error",
                    {
                        "code": ErrorCode.SESSION_SUBMITTED.value,
                        "message": "場次已結束，AI 回覆已中止。",
                    },
                )
                return

            buffer.append(token)
            yield sse("token", {"text": token})

        full = "".join(buffer)
        # 完整輸出原樣留存——MUST NOT 裁切或改寫（憲章原則 I）
        queries.update_chat_message_content(
            pending.message_id,
            full,
            provider=settings_choice.provider,
            model=settings_choice.model,
        )

        blocks = extract_code_blocks(full)
        queries.replace_code_blocks(
            pending.message_id, [(b.block_index, b.language, b.content) for b in blocks]
        )

        yield sse(
            "blocks",
            {
                "codeBlocks": [
                    {"blockIndex": b.block_index, "language": b.language, "content": b.content}
                    for b in blocks
                ]
            },
        )
        yield sse(
            "done",
            {
                "messageId": pending.message_id,
                "provider": settings_choice.provider,
                "model": settings_choice.model,
            },
        )

    except AppError as exc:
        logger.warning(
            "AI 串流中止：%s（session=%s message=%s provider=%s model=%s）",
            exc.code.value,
            pending.session_id,
            pending.message_id,
            settings_choice.provider,
            settings_choice.model,
        )
        queries.update_chat_message_content(pending.message_id, "".join(buffer))
        yield sse("error", {"code": exc.code.value, "message": exc.message})
    except Exception:
        # 應試者只會看到一句「稍後再試」，維運端必須拿得到真正的原因。
        # 這裡若不記錄，供應商回的 404／額度用罄／金鑰失效在日誌上完全等價，
        # 只能靠人工重現才能分辨——實測踩過一次（模型名稱過期）。
        logger.exception(
            "AI 串流失敗（session=%s message=%s provider=%s model=%s 已送出 %d 個 token）",
            pending.session_id,
            pending.message_id,
            settings_choice.provider,
            settings_choice.model,
            len(buffer),
        )
        queries.update_chat_message_content(pending.message_id, "".join(buffer))
        yield sse(
            "error",
            {
                "code": ErrorCode.AI_UNAVAILABLE.value,
                "message": "AI 目前無法回應，你的作答內容不受影響，稍後可再試一次。",
            },
        )


def context_from_session(row, question, answer, attached_code: str | None) -> PromptContext:
    return PromptContext(
        question_title=question.title,
        question_description=question.description,
        complexity_requirement=question.complexity_requirement,
        grading_focus=question.grading_focus,
        language=answer.language.value if answer else "javascript",
        attached_code=attached_code,
    )
