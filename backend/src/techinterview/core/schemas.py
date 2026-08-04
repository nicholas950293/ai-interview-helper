"""共用 Pydantic schema（T020）。

對外 JSON 一律 camelCase（以 alias 產生），資料庫欄位為 snake_case。
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

# 作答內容上限 256 KB（data-model.md：answer 驗證規則）
MAX_CONTENT_BYTES = 256 * 1024

# 平台外工具事件門檻：短於 1000ms 的離開 MUST NOT 記錄
ENVIRONMENT_EVENT_MIN_DURATION_MS = 1000

# 剩餘時間低於此值時計時器轉為警示呈現（FR-020）
TIMER_WARNING_THRESHOLD_SEC = 5 * 60


class Language(StrEnum):
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"
    PYTHON = "python"
    GO = "go"


class SessionStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    EXPIRED_SUBMITTED = "expired_submitted"


class ChatRole(StrEnum):
    CANDIDATE = "candidate"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatSource(StrEnum):
    TYPED = "typed"
    QUICK_PROMPT = "quick_prompt"
    QUESTION_HINT = "question_hint"
    CODE_REVIEW = "code_review"


class ChangeSource(StrEnum):
    """程式碼變更的來源。兩者 MUST NOT 混為一談（憲章原則 I）。"""

    CANDIDATE = "candidate"
    AI = "ai"


class EnvironmentEventType(StrEnum):
    WINDOW_BLUR = "window_blur"
    TAB_HIDDEN = "tab_hidden"


class Difficulty(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- 對外實體 ---------------------------------------------------------------


class Example(CamelModel):
    input: str
    output: str
    note: str | None = None


class PublicQuestion(CamelModel):
    """刻意不含 predefined_tests：其內容 MUST NOT 出現在任何回應中（FR-030）。"""

    id: str
    title: str
    difficulty: Difficulty
    points: int
    description: str
    examples: list[Example]
    complexity_requirement: str
    grading_focus: list[str]
    starter_code: dict[str, str]
    quick_prompts: list[str]
    order: int
    test_count: int


class PublicSession(CamelModel):
    """僅含姓名與職稱兩項個資（FR-032）。新增欄位前 MUST 重新檢視個資最小化。"""

    id: str
    candidate_name: str
    position_title: str
    deadline_at: str | None
    status: SessionStatus


class PublicAnswer(CamelModel):
    question_id: str
    language: Language
    content: str
    saved_at: str
    revision: int


class PublicCodeBlock(CamelModel):
    block_index: int
    language: str | None
    content: str


class PublicChatMessage(CamelModel):
    id: str
    question_id: str
    role: ChatRole
    content: str
    created_at: str
    attached_code: str | None = None
    code_blocks: list[PublicCodeBlock] = Field(default_factory=list)


# --- 請求 body ---------------------------------------------------------------


class RedeemRequest(CamelModel):
    token: str = Field(min_length=1)


class SaveAnswerRequest(CamelModel):
    language: Language
    content: str
    revision: int = Field(ge=0)

    @field_validator("content")
    @classmethod
    def _within_limit(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_CONTENT_BYTES:
            raise ValueError("CONTENT_TOO_LARGE")
        return value


class SaveAnswerBatchItem(SaveAnswerRequest):
    question_id: str = Field(min_length=1)


class ApplyBlockRequest(CamelModel):
    """套用 AI 產出的程式碼區塊（FR-033）。"""

    message_id: str = Field(min_length=1)
    block_index: int = Field(ge=0)


class ChatRequest(CamelModel):
    question_id: str = Field(min_length=1)
    content: str = Field(min_length=1, max_length=8000)
    attach_code: bool = False
    source: ChatSource = ChatSource.TYPED


class ChatSystemRequest(CamelModel):
    from_question_id: str = Field(min_length=1)
    to_question_id: str = Field(min_length=1)


class EnvironmentEventItem(CamelModel):
    """MUST NOT 含任何判定性欄位（FR-026）——schema 沒有，就寫不進去。"""

    type: EnvironmentEventType
    started_at: str = Field(min_length=1)
    duration_ms: int = Field(ge=0)
