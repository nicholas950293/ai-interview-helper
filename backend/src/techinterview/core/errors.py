"""錯誤碼與 HTTP 映射（T021）。

見 contracts/http-api.md「錯誤格式（全端點共用）」。
`message` MUST 為可直接呈現給應試者的中文說明（FR-031、FR-014）。
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    TOKEN_INVALID = "TOKEN_INVALID"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    SESSION_NOT_STARTED = "SESSION_NOT_STARTED"
    SESSION_SUBMITTED = "SESSION_SUBMITTED"
    REVISION_STALE = "REVISION_STALE"
    CONTENT_TOO_LARGE = "CONTENT_TOO_LARGE"
    AI_UNAVAILABLE = "AI_UNAVAILABLE"
    AI_TIMEOUT = "AI_TIMEOUT"
    BLOCK_NOT_FOUND = "BLOCK_NOT_FOUND"
    UNAUTHORIZED = "UNAUTHORIZED"
    NOT_FOUND = "NOT_FOUND"
    BAD_REQUEST = "BAD_REQUEST"


_STATUS: dict[ErrorCode, int] = {
    ErrorCode.TOKEN_INVALID: 404,
    ErrorCode.TOKEN_EXPIRED: 410,
    ErrorCode.SESSION_NOT_STARTED: 409,
    ErrorCode.SESSION_SUBMITTED: 409,
    ErrorCode.REVISION_STALE: 409,
    ErrorCode.CONTENT_TOO_LARGE: 413,
    ErrorCode.AI_UNAVAILABLE: 503,
    ErrorCode.AI_TIMEOUT: 504,
    ErrorCode.BLOCK_NOT_FOUND: 404,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.BAD_REQUEST: 400,
}

_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.TOKEN_INVALID: "這個邀請連結不存在，請向面試安排人員確認連結是否正確。",
    ErrorCode.TOKEN_EXPIRED: "這個邀請連結已經逾期，無法再進入此場次。",
    ErrorCode.SESSION_NOT_STARTED: "此場次尚未開始，請於約定時間再進入。",
    ErrorCode.SESSION_SUBMITTED: "此場次已提交，無法再修改作答。",
    ErrorCode.REVISION_STALE: "偵測到較新的草稿版本，已為你保留最新內容。",
    ErrorCode.CONTENT_TOO_LARGE: "作答內容超過 256 KB 上限，請精簡後再儲存。",
    ErrorCode.AI_UNAVAILABLE: "AI 目前無法回應，你的作答內容不受影響，稍後可再試一次。",
    ErrorCode.AI_TIMEOUT: "AI 回應逾時，已停止等待。你的作答內容不受影響，稍後可再試一次。",
    ErrorCode.BLOCK_NOT_FOUND: "找不到指定的程式碼區塊，請重新整理後再試。",
    ErrorCode.UNAUTHORIZED: "你的作答連線已失效，請重新開啟邀請連結。",
    ErrorCode.NOT_FOUND: "找不到指定的資料。",
    ErrorCode.BAD_REQUEST: "請求格式不正確。",
}


class AppError(Exception):
    """帶錯誤碼的應用例外；由 main.py 的 exception handler 轉為 JSON 回應。"""

    def __init__(
        self,
        code: ErrorCode,
        *,
        message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.status = _STATUS[code]
        self.message = message or _MESSAGES[code]
        self.details = details
        super().__init__(self.message)

    def to_body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code.value, "message": self.message}
        if self.details:
            error["details"] = self.details
        return {"error": error}


def message_for(code: ErrorCode) -> str:
    return _MESSAGES[code]


def status_for(code: ErrorCode) -> int:
    return _STATUS[code]
