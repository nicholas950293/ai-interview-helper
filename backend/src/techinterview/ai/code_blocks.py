"""AI 回覆的程式碼區塊解析（T064）。

由後端在**完整回覆**上解析，不由前端拼裝串流片段——
SC-004 要求「套用後內容與 AI 輸出完全一致」，比對對象必須是留存於資料庫的那一份
（research R-013）。

注意：這**不是**輸出過濾層。解析只是把可套用的部分辨識出來，
訊息本身仍以 AI 的完整輸出原樣留存（憲章原則 I）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_FENCE = re.compile(r"^\s*```([\w+-]*)\s*$")


@dataclass(frozen=True)
class CodeBlock:
    block_index: int
    language: str | None
    content: str


def extract_code_blocks(text: str) -> list[CodeBlock]:
    """取出 markdown 圍籬區塊。

    未閉合的區塊也要納入——串流中斷或模型忘了收尾時，那段內容仍是可套用的產出，
    漏掉它等於讓應試者拿不到 AI 已經寫好的東西。
    """
    blocks: list[CodeBlock] = []
    in_block = False
    language: str | None = None
    buffer: list[str] = []

    for line in text.split("\n"):
        fence = _FENCE.match(line)
        if fence:
            if in_block:
                blocks.append(CodeBlock(len(blocks), language, _join(buffer)))
                in_block = False
                buffer = []
            else:
                in_block = True
                language = fence.group(1) or None
            continue
        if in_block:
            buffer.append(line)

    if in_block and buffer:
        blocks.append(CodeBlock(len(blocks), language, _join(buffer)))

    return [b for b in blocks if b.content.strip()]


def _join(lines: list[str]) -> str:
    """逐字保留，只補上結尾換行。

    MUST NOT 做 trim 以外的任何處理——縮排、空行、行尾空白都可能是有意義的，
    改動它們會讓 SC-004 的逐字一致性斷言失去意義。
    """
    content = "\n".join(lines)
    return content if content.endswith("\n") else content + "\n"
