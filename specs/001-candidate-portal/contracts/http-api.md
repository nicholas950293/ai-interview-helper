# Contract: HTTP API (FastAPI)

**Date**: 2026-08-04 | **Plan**: [../plan.md](../plan.md) | **Constitution**: v3.0.0

Base path `/api`。除 `POST /api/session/redeem` 外，所有端點以 HttpOnly session cookie 授權。
請求與回應皆為 JSON（AI 串流除外）。所有輸入以 **Pydantic** 於邊界驗證。
對外 JSON 一律 `camelCase`（Pydantic model 以 alias 產生），資料庫欄位為 `snake_case`。

實體欄位定義見 [data-model.md](../data-model.md)，此處不重複。

---

## 錯誤格式（全端點共用）

```json
{ "error": { "code": "SESSION_SUBMITTED", "message": "此場次已提交，無法再修改作答。" } }
```

| code | HTTP | 情境 |
| --- | --- | --- |
| `TOKEN_INVALID` | 404 | 邀請連結不存在 |
| `TOKEN_EXPIRED` | 410 | 連結逾期 |
| `SESSION_NOT_STARTED` | 409 | 場次尚未開始 |
| `SESSION_SUBMITTED` | 409 | 場次已提交（含逾時提交） |
| `REVISION_STALE` | 409 | 草稿 revision 落後於伺服端 |
| `CONTENT_TOO_LARGE` | 413 | 草稿超過 256 KB |
| `AI_UNAVAILABLE` | 503 | 所有已設定的模型供應商皆不可用 |
| `AI_TIMEOUT` | 504 | 串流閒置超過 `AI_STREAM_TIMEOUT_MS`（距上一個 token 的間隔，非總時長） |
| `BLOCK_NOT_FOUND` | 404 | 指定的程式碼區塊不存在 |
| `UNAUTHORIZED` | 401 | 無有效 session cookie |

`message` MUST 為可直接呈現給應試者的中文說明（FR-031、FR-014）。

---

## POST /api/session/redeem

兌換邀請連結，換發 session cookie。

**Request**：`{ "token": string }`

**Response 200**：

```json
{
  "session": {
    "id",
    "candidateName",
    "positionTitle",
    "deadlineAt",
    "status",
  },
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
  "questions": [
    {
      "id", "title", "difficulty", "points", "description", "examples",
      "complexityRequirement", "gradingFocus", "starterCode", "quickPrompts",
      "order", "testCount"
    }
  ],
  "answers": [{ "questionId", "language", "content", "savedAt", "revision" }],
  "chat": [
    {
      "id", "questionId", "role", "content", "createdAt", "attachedCode",
      "codeBlocks": [{ "blockIndex", "language", "content" }]
    }
  ],
  "serverTime": "2026-08-04T09:12:33.000Z"
}
```

- `predefinedTests` 的內容 MUST NOT 出現在回應中（僅回傳 `testCount`），
  避免應試者反推期望輸出。
- `chat[].content` MUST 為 AI 的完整輸出（憲章原則 I）。
- `codeBlocks` 只出現在 `role = "assistant"` 的訊息上；空陣列表示該則回覆無程式碼。
- 回應 MUST NOT 包含 `code_change` 歷史——那是伺服端的評分材料，前端沒有用途。

---

## PUT /api/answers/{question_id}

保存草稿。前端於停止輸入 1000ms 後呼叫（FR-004）。

**Request**：`{ "language": Language, "content": string, "revision": number }`

**Response 200**：`{ "savedAt": string, "revision": number }`

- `revision` MUST 大於伺服端現值，否則回 `REVISION_STALE` 並附帶伺服端現值供前端修復。
- 場次非 `in_progress` 時回 `SESSION_SUBMITTED`。
- **副作用**：保存成功時建立 `source = "candidate"` 的 `code_change`；
  但若本次內容與最近一次 `source = "ai"` 的變更完全相同則 MUST NOT 建立
  ——那只是套用後的第一次自動保存（research R-014）。
- 離線補送時可一次帶多筆：`PUT /api/answers` body 為陣列，伺服端依 `revision` 排序套用。

---

## POST /api/answers/{question_id}/apply

**套用 AI 產出的程式碼區塊至作答內容**（FR-033 ~ FR-035）。

**Request**：

```json
{ "messageId": string, "blockIndex": number }
```

**Response 200**：

```json
{ "content": string, "savedAt": string, "revision": number }
```

- 伺服端以 `messageId` + `blockIndex` 取出 `chat_code_block`，將其 `content`
  **逐字**寫入該題作答內容。MUST NOT 有任何裁切、改寫或格式調整（FR-034）。
- 回應的 `content` MUST 與該區塊的 `content` 完全相同——前端據此更新編輯器，
  這也是 SC-004 的斷言對象。
- **副作用**：建立 `source = "ai"` 的 `code_change`，並記錄 `chatMessageId`
  與 `blockIndex`（FR-035）。
- 該訊息不屬於本場次、或 `blockIndex` 超出範圍時回 `BLOCK_NOT_FOUND`。
- 場次非 `in_progress` 時回 `SESSION_SUBMITTED`。
- `revision` 一律遞增，前端據此同步，避免與進行中的 debounce 保存互相覆蓋。

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

- 冪等：重複呼叫回傳既有結果，不視為錯誤，且 MUST NOT 覆寫既有終態。
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

## GET /api/chat/stream/{stream_id} _(text/event-stream)_

SSE 串流 AI 回覆。

| event | data | 說明 |
| --- | --- | --- |
| `token` | `{ "text": string }` | 增量文字 |
| `blocks` | `{ "codeBlocks": [{ "blockIndex", "language", "content" }] }` | 串流結束後解析出的程式碼區塊 |
| `done` | `{ "messageId", "provider", "model" }` | 回覆結束 |
| `error` | `{ "code", "message" }` | 中止，前端顯示錯誤與重試（FR-014） |

- **本端點沒有任何輸出攔截或改寫**。AI 產出什麼就送出什麼（憲章原則 I）。
- `blocks` 事件於 `done` 之前送出；前端據此渲染每個區塊的「套用至編輯器」按鈕。
  區塊由後端在**完整回覆**上解析，不由前端拼裝串流片段（research R-013）。
- 場次進入終態時，進行中的串流 MUST 立即以 `error` 中止（Edge Case：時間歸零當下
  AI 正在回覆）。
- 供應商全數不可用時回 `AI_UNAVAILABLE`；LangChain 的 fallback 已先行嘗試次要供應商。
- 串流開始後若長時間沒有任何 token，以 `AI_TIMEOUT` 中止並保留已送出的部分。
  逾時以**閒置**計算：完整實作可能跑 30 秒以上，只要 token 持續流動就不算逾時。
  此值 MUST 明顯小於前方代理的連線逾時，否則錯誤事件來不及送達瀏覽器，
  使用者看到的會是誤導的「連線中斷」而非真正的原因。

---

## POST /api/chat/system

記錄題目切換的系統訊息（FR-019）。

**Request**：`{ "fromQuestionId": string, "toQuestionId": string }`

**Response 201**：`{ "message": ChatMessage }`

---

## POST /api/events

回報平台外工具事件（FR-025）。可批次。

**Request**：`[{ "type": "window_blur" | "tab_hidden", "startedAt": string, "durationMs": number }]`

**Response 202**：`{ "accepted": number }`

`durationMs < 1000` 的項目伺服端 MUST 靜默丟棄，計入 `accepted` 之外。
Request schema MUST NOT 包含任何判定性欄位（FR-026）。

---

## POST /api/tests/{question_id}

執行單元測試（本期回報預定義結果，FR-030）。

**Request**：`{}` — **Response 200**：`{ "passed": number, "total": number, "ranAt": string }`

MUST NOT 接受或執行任何用戶端提供的程式碼。回應 MUST NOT 包含個別測試案例的期望值。
