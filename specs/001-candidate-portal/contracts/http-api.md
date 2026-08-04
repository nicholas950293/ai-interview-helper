# Contract: BFF HTTP API

**Date**: 2026-08-04 | **Plan**: [../plan.md](../plan.md)

Base path `/api`。除 `POST /api/session/redeem` 外，所有端點以 HttpOnly session cookie 授權。
請求與回應皆為 JSON（AI 串流除外）。所有輸入以 Zod 於邊界驗證。

實體欄位定義見 [data-model.md](../data-model.md)，此處不重複。

---

## 錯誤格式（全端點共用）

```json
{ "error": { "code": "SESSION_SUBMITTED", "message": "此場次已提交，無法再修改作答。" } }
```

| code                  | HTTP | 情境                       |
| --------------------- | ---- | -------------------------- |
| `TOKEN_INVALID`       | 404  | 邀請連結不存在             |
| `TOKEN_EXPIRED`       | 410  | 連結逾期                   |
| `SESSION_NOT_STARTED` | 409  | 場次尚未開始               |
| `SESSION_SUBMITTED`   | 409  | 場次已提交（含逾時提交）   |
| `REVISION_STALE`      | 409  | 草稿 revision 落後於伺服端 |
| `CONTENT_TOO_LARGE`   | 413  | 草稿超過 256 KB            |
| `AI_UNAVAILABLE`      | 503  | 模型服務暫時不可用         |

`message` MUST 為可直接呈現給應試者的中文說明（FR-031、FR-014）。

---

## POST /api/session/redeem

兌換邀請連結，換發 session cookie。

**Request**：`{ "token": string }`

**Response 200**：

```json
{
  "session": { "id", "candidateName", "positionTitle", "deadlineAt", "status", "guidanceMode" },
  "serverTime": "2026-08-04T09:00:00.000Z"
}
```

- 首次兌換：寫入 `startedAt` 與 `deadlineAt`，`status → in_progress`。
- 重複兌換且場次仍 `in_progress`：回傳既有場次，MUST NOT 重置 `deadlineAt`。
- `serverTime` 供前端計算時鐘偏移（R-007）。

---

## GET /api/session

回傳當前場次、題目、各題最新草稿與完整對話，供頁面載入或重新整理時還原（FR-003）。

**Response 200**：

```json
{
  "session": { "...": "同上" },
  "questions": [ { "id", "title", "difficulty", "points", "description", "examples",
                   "complexityRequirement", "gradingFocus", "starterCode", "quickPrompts",
                   "order" } ],
  "answers": [ { "questionId", "language", "content", "savedAt", "revision" } ],
  "chat": [ { "id", "questionId", "role", "content", "createdAt", "attachedCode" } ],
  "serverTime": "2026-08-04T09:12:33.000Z"
}
```

`predefinedTests` 的內容 MUST NOT 出現在回應中（僅回傳測試數量），避免應試者反推期望輸出。

---

## PUT /api/answers/:questionId

保存草稿。前端於停止輸入 1000ms 後呼叫（FR-004）。

**Request**：`{ "language": Language, "content": string, "revision": number }`

**Response 200**：`{ "savedAt": string, "revision": number }`

- `revision` MUST 大於伺服端現值，否則回 `REVISION_STALE` 並附帶伺服端現值供前端修復。
- 場次非 `in_progress` 時回 `SESSION_SUBMITTED`。
- 離線補送時可一次帶多筆：`PUT /api/answers` body 為陣列，伺服端依 `revision` 排序套用。

---

## GET /api/time

輕量校時端點，前端每 30 秒呼叫以修正時鐘漂移。

**Response 200**：`{ "serverTime": string, "deadlineAt": string, "status": SessionStatus }`

若伺服端判定已逾期且場次仍 `in_progress`，此端點 MUST 主動觸發逾時提交並回傳
`status: "expired_submitted"`——不依賴前端主動通報（FR-022）。

---

## POST /api/submit

手動提交全卷（FR-021）。

**Request**：`{}`（不接受作答內容；伺服端取最後保存的草稿）

**Response 200**：`{ "submittedAt": string, "status": "submitted" }`

- 冪等：重複呼叫回傳既有結果，不視為錯誤。
- 提交後所有寫入端點回 `SESSION_SUBMITTED`。

---

## POST /api/chat

送出提問，回傳串流 id。

**Request**：

```json
{
  "questionId": string,
  "content": string,
  "attachCode": boolean,
  "source": "typed" | "quick_prompt" | "question_hint" | "code_review"
}
```

- `attachCode: true` 時，伺服端取該題**最後保存的草稿**作為附帶 Context。前端在按下
  「傳送至 AI 側邊欄」前 MUST 先 flush 待保存的草稿，確保 AI 看到最新內容（FR-018）。
- `source` 供 Phase 4 分析應試者的提問行為，本期僅記錄。

**Response 202**：`{ "streamId": string, "messageId": string }`

---

## GET /api/chat/stream/:streamId _(text/event-stream)_

SSE 串流 AI 回覆。

| event   | data                                             | 說明                               |
| ------- | ------------------------------------------------ | ---------------------------------- |
| `token` | `{ "text": string }`                             | 增量文字                           |
| `done`  | `{ "messageId", "guardrailTriggered": boolean }` | 回覆結束                           |
| `error` | `{ "code", "message" }`                          | 中止，前端顯示錯誤與重試（FR-014） |

- 圍欄後處理若攔截，串流 MUST 以引導式訊息取代原內容後才送出 `token`
  （不得先送出違規內容再撤回）。
- 場次進入終態時，進行中的串流 MUST 立即以 `error` 中止（Edge Case：時間歸零當下
  AI 正在回覆）。

---

## POST /api/chat/system

記錄題目切換的系統訊息（FR-019）。

**Request**：`{ "fromQuestionId": string, "toQuestionId": string }`

**Response 201**：`{ "message": ChatMessage }`

---

## PATCH /api/session/guidance-mode

切換引導模式（FR-012）。

**Request**：`{ "mode": "light" | "deep" }` → **Response 200**：`{ "mode": "light" | "deep" }`

模式僅影響回覆詳細度；圍欄段落不隨模式變動（憲章原則 I）。

---

## POST /api/events

回報環境事件（FR-025）。可批次。

**Request**：`[ { "type": "window_blur" | "tab_hidden", "startedAt": string, "durationMs": number } ]`

**Response 202**：`{ "accepted": number }`

`durationMs < 1000` 的項目伺服端 MUST 靜默丟棄，計入 `accepted` 之外。

---

## POST /api/tests/:questionId

執行單元測試（本期回報預定義結果，FR-030）。

**Request**：`{}` — **Response 200**：`{ "passed": number, "total": number, "ranAt": string }`

MUST NOT 接受或執行任何用戶端提供的程式碼。回應 MUST NOT 包含個別測試案例的期望值。
