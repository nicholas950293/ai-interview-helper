"""示範場次的 seed 腳本（T027）。

用法：
    uv run python -m techinterview.db.seed [--duration 6m] [--session-id sess-x]
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any

from techinterview.db.client import get_db, run_migrations

STARTER = {
    "rate-limiter": {
        "javascript": (
            "class RateLimiter {\n"
            "  constructor(maxRequests, windowMs) {\n"
            "    this.maxRequests = maxRequests;\n"
            "    this.windowMs = windowMs;\n"
            "    // 在此設計你的資料結構\n"
            "  }\n\n"
            "  allow(userId, timestampMs) {\n"
            "    // 在此作答\n"
            "  }\n"
            "}\n"
        ),
        "typescript": (
            "class RateLimiter {\n"
            "  constructor(\n"
            "    private readonly maxRequests: number,\n"
            "    private readonly windowMs: number\n"
            "  ) {}\n\n"
            "  allow(userId: string, timestampMs: number): boolean {\n"
            "    // 在此作答\n"
            "  }\n"
            "}\n"
        ),
        "python": (
            "class RateLimiter:\n"
            "    def __init__(self, max_requests: int, window_ms: int) -> None:\n"
            "        self.max_requests = max_requests\n"
            "        self.window_ms = window_ms\n"
            "        # 在此設計你的資料結構\n\n"
            "    def allow(self, user_id: str, timestamp_ms: int) -> bool:\n"
            "        # 在此作答\n"
            "        ...\n"
        ),
        "go": (
            "type RateLimiter struct {\n"
            "\tmaxRequests int\n"
            "\twindowMs    int64\n"
            "}\n\n"
            "func (r *RateLimiter) Allow(userID string, timestampMs int64) bool {\n"
            "\t// 在此作答\n"
            "\treturn false\n"
            "}\n"
        ),
    },
    "lru-cache": {
        "javascript": (
            "class LRUCache {\n"
            "  constructor(capacity) {\n"
            "    this.capacity = capacity;\n"
            "  }\n\n"
            "  get(key) {\n    // 在此作答\n  }\n\n"
            "  put(key, value) {\n    // 在此作答\n  }\n"
            "}\n"
        ),
        "typescript": (
            "class LRUCache {\n"
            "  constructor(private readonly capacity: number) {}\n\n"
            "  get(key: number): number {\n    // 在此作答\n  }\n\n"
            "  put(key: number, value: number): void {\n    // 在此作答\n  }\n"
            "}\n"
        ),
        "python": (
            "class LRUCache:\n"
            "    def __init__(self, capacity: int) -> None:\n"
            "        self.capacity = capacity\n\n"
            "    def get(self, key: int) -> int:\n        ...\n\n"
            "    def put(self, key: int, value: int) -> None:\n        ...\n"
        ),
        "go": (
            "type LRUCache struct {\n\tcapacity int\n}\n\n"
            "func (c *LRUCache) Get(key int) int {\n\treturn -1\n}\n\n"
            "func (c *LRUCache) Put(key int, value int) {\n}\n"
        ),
    },
    "message-queue": {
        "javascript": (
            "class MessageQueue {\n"
            "  publish(topic, payload, delayMs = 0) {\n    // 回傳 messageId\n  }\n\n"
            "  poll(topic, nowMs) {\n    // 在此作答\n  }\n\n"
            "  ack(messageId) {\n    // 在此作答\n  }\n"
            "}\n"
        ),
        "typescript": (
            "class MessageQueue {\n"
            "  publish(topic: string, payload: string, delayMs = 0): string {\n    // 在此作答\n  }\n\n"
            "  poll(topic: string, nowMs: number) {\n    // 在此作答\n  }\n\n"
            "  ack(messageId: string): void {\n    // 在此作答\n  }\n"
            "}\n"
        ),
        "python": (
            "class MessageQueue:\n"
            "    def publish(self, topic: str, payload: str, delay_ms: int = 0) -> str:\n        ...\n\n"
            "    def poll(self, topic: str, now_ms: int):\n        ...\n\n"
            "    def ack(self, message_id: str) -> None:\n        ...\n"
        ),
        "go": (
            "type MessageQueue struct{}\n\n"
            'func (q *MessageQueue) Publish(topic, payload string, delayMs int64) string {\n\treturn ""\n}\n\n'
            "func (q *MessageQueue) Poll(topic string, nowMs int64) *Message {\n\treturn nil\n}\n\n"
            "func (q *MessageQueue) Ack(messageID string) {\n}\n"
        ),
    },
}

QUESTIONS: list[dict[str, Any]] = [
    {
        "id": "q-rate-limiter",
        "title": "API 限流器",
        "difficulty": "medium",
        "points": 40,
        "description": "\n".join(
            [
                "設計一個 API 限流器，限制每個使用者在滑動時間窗內可發出的請求數。",
                "",
                "**功能規格**",
                "",
                "- `allow(userId, timestampMs)` 回傳布林值，表示該請求是否放行。",
                "- 每個使用者在任意連續 `windowMs` 毫秒內，最多允許 `maxRequests` 次請求。",
                "- 時間窗為滑動窗（sliding window），非固定區間。",
                "- 不同使用者之間互不影響。",
            ]
        ),
        "examples": [
            {
                "input": (
                    "limiter = RateLimiter(maxRequests=3, windowMs=1000)\n"
                    "allow(0), allow(100), allow(200), allow(300)"
                ),
                "output": "true, true, true, false",
                "note": "第 4 次請求落在同一個 1000ms 窗內，被拒絕。",
            }
        ],
        "complexity_requirement": "每次 allow 呼叫的均攤時間複雜度 O(1)。",
        "grading_focus": [
            "滑動窗與固定窗的差異是否正確處理",
            "過期記錄的清理是否會造成記憶體無限成長",
            "邊界：時間戳相同、maxRequests 為 0、使用者首次請求",
        ],
        "starter": STARTER["rate-limiter"],
        "tests": [
            {"name": "窗內未超額的請求全數放行", "expected_pass": True},
            {"name": "窗內超額的請求被拒絕", "expected_pass": True},
            {"name": "時間推進後舊記錄滑出窗外", "expected_pass": True},
            {"name": "不同使用者互不影響", "expected_pass": True},
            {"name": "邊界：maxRequests 為 0 時一律拒絕", "expected_pass": False},
        ],
        "quick_prompts": ["幫我實作這一題", "檢查 Corner Cases", "分析時間複雜度"],
    },
    {
        "id": "q-lru-cache",
        "title": "LRU 快取",
        "difficulty": "medium",
        "points": 30,
        "description": "\n".join(
            [
                "實作一個固定容量的 LRU（Least Recently Used）快取。",
                "",
                "**功能規格**",
                "",
                "- `get(key)` 回傳對應值；不存在時回傳 `-1`。",
                "- `put(key, value)` 寫入鍵值；容量已滿時淘汰最久未使用的項目。",
                "- `get` 與 `put` 都算一次「使用」。",
            ]
        ),
        "examples": [
            {
                "input": "cache = LRUCache(2)\nput(1,1), put(2,2), get(1), put(3,3), get(2)",
                "output": "1, -1",
                "note": "put(3,3) 時容量已滿，最久未使用的 key 2 被淘汰。",
            }
        ],
        "complexity_requirement": "get 與 put 皆需 O(1) 時間複雜度。",
        "grading_focus": [
            "是否達成 O(1) —— 只用陣列掃描不符要求",
            "雙向鏈結串列與雜湊表的搭配是否正確",
            "邊界：容量為 1、重複 put 同一個 key",
        ],
        "starter": STARTER["lru-cache"],
        "tests": [
            {"name": "基本 get / put", "expected_pass": True},
            {"name": "超過容量時淘汰最久未使用者", "expected_pass": True},
            {"name": "get 會更新使用順序", "expected_pass": True},
            {"name": "重複 put 同一個 key 只更新值", "expected_pass": True},
            {"name": "邊界：容量為 1", "expected_pass": True},
        ],
        "quick_prompts": ["幫我實作這一題", "如何達成 O(1)？", "檢查 Corner Cases"],
    },
    {
        "id": "q-message-queue",
        "title": "訊息佇列",
        "difficulty": "hard",
        "points": 30,
        "description": "\n".join(
            [
                "設計一個支援延遲投遞與至少一次語意的記憶體訊息佇列。",
                "",
                "**功能規格**",
                "",
                "- `publish(topic, payload, delayMs)` 將訊息排入佇列，`delayMs` 後才可被消費。",
                "- `poll(topic, nowMs)` 取出一則到期訊息並標記為處理中，逾時未 ack 需重新可見。",
                "- `ack(messageId)` 確認處理完成，該訊息不再重新投遞。",
            ]
        ),
        "examples": [
            {
                "input": 'publish("t", "a", 1000) 於 t=0\npoll("t", 500)',
                "output": "null",
                "note": "延遲時間未到，訊息尚不可見。",
            }
        ],
        "complexity_requirement": "poll 需優於 O(n)；建議以優先佇列達成 O(log n)。",
        "grading_focus": [
            "延遲投遞與可見性逾時的資料結構選擇",
            "至少一次語意如何保證",
            "邊界：同時到期的多則訊息、重複 ack",
        ],
        "starter": STARTER["message-queue"],
        "tests": [
            {"name": "延遲未到的訊息不可見", "expected_pass": True},
            {"name": "到期訊息可被 poll 取出", "expected_pass": True},
            {"name": "未 ack 的訊息在可見性逾時後重新投遞", "expected_pass": False},
            {"name": "ack 後不再重新投遞", "expected_pass": True},
            {"name": "不同 topic 互不影響", "expected_pass": True},
            {"name": "邊界：同時到期的多則訊息依序取出", "expected_pass": False},
        ],
        "quick_prompts": ["幫我實作這一題", "至少一次 vs 最多一次？", "檢查 Corner Cases"],
    },
]


def parse_duration(text: str) -> int:
    """解析 `6m` / `90s` / `1h` / `3600`。"""
    match = re.fullmatch(r"(\d+)\s*([smh])?", text.strip(), re.IGNORECASE)
    if not match:
        raise ValueError(f"無法解析時長「{text}」，可用格式：3600、90s、6m、1h")
    value = int(match.group(1))
    unit = (match.group(2) or "s").lower()
    return value * {"s": 1, "m": 60, "h": 3600}[unit]


def seed(
    conn: sqlite3.Connection | None = None,
    *,
    duration_sec: int = 90 * 60,
    session_id: str = "sess-demo",
) -> dict[str, str]:
    conn = conn or get_db()
    run_migrations(conn)

    # 128-bit 隨機值，URL 安全編碼（research R-009）
    token = base64.urlsafe_b64encode(secrets.token_bytes(16)).decode().rstrip("=")
    expires = (datetime.now(UTC) + timedelta(days=7)).isoformat().replace("+00:00", "Z")

    conn.execute("DELETE FROM invite_token WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM interview_session WHERE id = ?", (session_id,))
    conn.execute(
        """INSERT INTO interview_session
             (id, candidate_name, position_title, duration_sec, status)
           VALUES (?, ?, ?, ?, 'not_started')""",
        (session_id, "Alex Chen", "資深全端工程師模擬面試", duration_sec),
    )
    conn.execute(
        """INSERT INTO invite_token (token, session_id, status, expires_at)
           VALUES (?, ?, 'pending', ?)""",
        (token, session_id, expires),
    )

    for index, q in enumerate(QUESTIONS, start=1):
        conn.execute(
            """INSERT INTO question
                 (id, title, difficulty, points, description, examples_json,
                  complexity_requirement, grading_focus_json, starter_code_json,
                  predefined_tests_json, quick_prompts_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (id) DO UPDATE SET
                 title = excluded.title,
                 description = excluded.description,
                 starter_code_json = excluded.starter_code_json,
                 predefined_tests_json = excluded.predefined_tests_json,
                 quick_prompts_json = excluded.quick_prompts_json""",
            (
                q["id"],
                q["title"],
                q["difficulty"],
                q["points"],
                q["description"],
                json.dumps(q["examples"], ensure_ascii=False),
                q["complexity_requirement"],
                json.dumps(q["grading_focus"], ensure_ascii=False),
                json.dumps(q["starter"], ensure_ascii=False),
                json.dumps(q["tests"], ensure_ascii=False),
                json.dumps(q["quick_prompts"], ensure_ascii=False),
            ),
        )
        conn.execute(
            """INSERT INTO session_question (session_id, question_id, "order") VALUES (?, ?, ?)
               ON CONFLICT (session_id, question_id) DO UPDATE SET "order" = excluded."order" """,
            (session_id, q["id"], index),
        )

    conn.commit()
    return {
        "session_id": session_id,
        "token": token,
        "url": f"http://localhost:5173/s/{token}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="載入示範面試場次")
    parser.add_argument("--duration", default="90m", help="場次時長，如 6m / 3600 / 1h")
    parser.add_argument("--session-id", default="sess-demo")
    args = parser.parse_args()

    result = seed(duration_sec=parse_duration(args.duration), session_id=args.session_id)
    print("[db] 已建立示範場次：")
    print(f"  sessionId : {result['session_id']}")
    print(f"  題目      : {'、'.join(q['title'] for q in QUESTIONS)}")
    print(f"  邀請連結  : {result['url']}")


if __name__ == "__main__":
    main()
