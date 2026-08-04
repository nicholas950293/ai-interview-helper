# Phase 1 Data Model: Candidate Portal

**Date**: 2026-08-04 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

**Constitution**: v3.0.0

實體對應 spec 的 Key Entities。持久化於 **Supabase（Postgres）**；schema 以
`supabase/migrations/` 的編號 SQL 檔管理。前端 session store 持有其中的
**可變作答狀態**子集（見文末「前端狀態切片」）。

命名採 Postgres 慣例（`snake_case`），對外 JSON 一律轉為 `camelCase`。
所有資料表以 **RLS deny-all** 起始，僅 service role 可存取（見 research R-004）。

---

## 實體關聯

```text
invite_token ──1:1── interview_session
                          │
                          ├──1:N── session_question ──N:1── question
                          │              │
                          │              └──1:1── answer ──1:N── code_change
                          │                                          │
                          ├──1:N── chat_message ─────1:N─────────────┘
                          │              │              (source='ai' 時的來源訊息)
                          │              └──1:N── chat_code_block
                          │
                          ├──1:N── environment_event
                          └──1:N── test_run
```

---

## invite_token（邀請連結）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `token` | text (PK) | 128-bit 隨機值，URL 安全編碼 |
| `session_id` | uuid (FK, unique) | 綁定的場次 |
| `status` | text | `pending` \| `active` \| `consumed` \| `expired` |
| `expires_at` | timestamptz | 逾期時間 |
| `first_used_at` | timestamptz? | 首次兌換時間 |

**驗證規則**：

- `token` MUST 唯一且不可預測。
- 兌換時 MUST 檢查 `status` 與 `expires_at`；`consumed` 且對應場次仍為 `in_progress` 時
  MUST 允許重新進入同一場次（不重置計時、不清空草稿）。

**狀態轉移**：`pending → active`（首次兌換）→ `consumed`（場次提交）；
任一狀態於 `expires_at` 之後 → `expired`。

**未來**：實作 Google OAuth 時此表需增加與使用者身分的關聯（見 research R-009）。

---

## interview_session（面試場次）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid (PK) | |
| `candidate_name` | text | 顯示於 Header，如「Alex Chen」 |
| `position_title` | text | 如「資深全端工程師模擬面試」 |
| `duration_sec` | int | 總時長 |
| `started_at` | timestamptz? | 首次兌換時寫入 |
| `deadline_at` | timestamptz? | `started_at + duration_sec`，計時權威 |
| `status` | text | `not_started` \| `in_progress` \| `submitted` \| `expired_submitted` |
| `submitted_at` | timestamptz? | |

**驗證規則**：

- `candidate_name` 與 `position_title` 為前端唯一可見的個資欄位（FR-032）。
- `status` 非 `in_progress` 時 MUST 拒絕所有草稿寫入、提問與套用。
- `deadline_at` MUST 由伺服端計算，MUST NOT 接受用戶端傳入。

**狀態轉移**：

```text
not_started ──兌換連結──> in_progress ──手動提交──> submitted
                              └──deadline 到期──> expired_submitted
```

兩個終態皆不可逆；進入終態時所有作答轉為唯讀。

---

## question（題目）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | text (PK) | |
| `title` | text | 如「API 限流器」 |
| `difficulty` | text | `easy` \| `medium` \| `hard` |
| `points` | int | 配分 |
| `description` | text (markdown) | 題目描述與功能規格 |
| `examples` | jsonb | `[{ input, output, note? }]` |
| `complexity_requirement` | text | 時間／空間複雜度要求 |
| `grading_focus` | jsonb | `string[]` 評分重點 |
| `starter_code` | jsonb | `Record<Language, string>` |
| `predefined_tests` | jsonb | `[{ name, expected_pass }]`，本期用於回報結果 |
| `quick_prompts` | jsonb | `string[]` 該題的快捷提問 |

**驗證規則**：`starter_code` MUST 至少涵蓋 `javascript`、`typescript`、`python`、`go`；
缺漏語言時 MUST 以空樣板回退而非讓 UI 崩潰。
`predefined_tests` 的內容 MUST NOT 出現在任何回應中（僅回傳測試數量）。

---

## session_question（場次題目）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `session_id` | uuid (FK) | |
| `question_id` | text (FK) | |
| `order` | int | 頁籤順序，1 起算 |

主鍵為 `(session_id, question_id)`。

---

## answer（作答）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `session_id` | uuid (FK) | |
| `question_id` | text (FK) | |
| `language` | text | `javascript` \| `typescript` \| `python` \| `go` |
| `content` | text | 程式碼內容 |
| `saved_at` | timestamptz | 最後一次伺服端保存成功時間 |
| `revision` | int | 每次保存遞增，用於偵測失序寫入 |

主鍵為 `(session_id, question_id)`。

**驗證規則**：

- 保存 MUST 拒絕 `revision` 小於或等於現有值的請求（防止離線補送覆蓋較新內容）。
- 套用 AI 產出同樣遞增 `revision`，前端據回傳值同步，避免與 debounce 保存互相覆蓋。
- 提交 MUST 取每題 `saved_at` 最新的一筆（FR-022），MUST NOT 依賴前端傳入的內容。
- `content` 長度上限 256 KB；超出時 MUST 回傳明確錯誤而非靜默截斷。

---

## chat_message（對話訊息）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid (PK) | |
| `session_id` | uuid (FK) | |
| `question_id` | text (FK) | 發話當下綁定的題目 |
| `role` | text | `candidate` \| `assistant` \| `system` |
| `content` | text | **AI 的完整輸出，MUST NOT 裁切或改寫** |
| `created_at` | timestamptz | |
| `seq` | bigint (identity) | 單調遞增的顯示順序 |
| `attached_code` | text? | 「傳送至 AI 檢查」時附帶的程式碼快照 |
| `provider` | text? | 產生該回覆的供應商（`google_genai` \| `anthropic`） |
| `model` | text? | 實際使用的模型名稱 |
| `source` | text? | `typed` \| `quick_prompt` \| `question_hint` \| `code_review` |

**驗證規則**：

- 所有訊息 MUST 留存至場次結束後（FR-015），MUST NOT 提供刪除介面。
- `content` MUST 為 AI 的完整輸出（憲章原則 I）；本期**沒有**任何輸出攔截或改寫層。
- `role = system` 用於題目切換通知（FR-019）。
- 排序 MUST 以 `seq`，MUST NOT 以 `created_at`——同一毫秒插入的提問與回覆
  無法靠時間戳分出先後。
- `provider` 與 `model` 留存的理由：日後評分時需要知道應試者是在哪個模型上完成的，
  不同模型的協作難度不同。

---

## chat_code_block（回覆中的程式碼區塊）

由後端於串流結束後解析 AI 回覆的 markdown 圍籬區塊產生（research R-013）。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid (PK) | |
| `message_id` | uuid (FK) | 所屬的 `chat_message` |
| `block_index` | int | 於該則訊息中的序號，0 起算 |
| `language` | text? | 圍籬標註的語言，可為空 |
| `content` | text | 區塊內容，**逐字保留** |

主鍵之外另有 `(message_id, block_index)` 的唯一約束。

**驗證規則**：

- `content` MUST 與 AI 輸出的該區塊逐字相同（SC-004）——不做 trim 以外的任何處理。
- 只有 `role = 'assistant'` 的訊息會有區塊。
- 解析只看輸出內容，不看提問意圖。AI 依提問意圖決定要不要附程式碼（FR-012），
  但無論它基於什麼理由決定要附，只要輸出裡有區塊就 MUST 解析並留存——
  解析層若因為「這看起來像概念問題」而丟棄區塊，那就是變相的輸出過濾。

---

## code_change（程式碼變更）

**這是本平台評估效力的核心資料**（憲章原則 I、SC-010）。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid (PK) | |
| `session_id` | uuid (FK) | |
| `question_id` | text (FK) | |
| `source` | text | `candidate`（自行輸入）\| `ai`（套用 AI 產出） |
| `content` | text | 變更後的完整作答內容 |
| `revision` | int | 對應 `answer.revision` |
| `created_at` | timestamptz | |
| `seq` | bigint (identity) | 單調遞增的變更順序 |
| `chat_message_id` | uuid? (FK) | `source='ai'` 時 MUST 有值，指向來源訊息 |
| `block_index` | int? | `source='ai'` 時 MUST 有值，指向來源區塊 |

**驗證規則**：

- `source = 'ai'` 時 `chat_message_id` 與 `block_index` MUST NOT 為 null；
  `source = 'candidate'` 時兩者 MUST 為 null。以 CHECK 約束表達，
  讓「混為一談」在資料庫層就不可能發生（憲章原則 I）。
- 應試者自行輸入的變更於 debounce 保存成功時寫入；**若該次內容與最近一次
  `source='ai'` 的變更完全相同，MUST NOT 寫入**——那只是套用後的第一次自動保存，
  不是新的人工輸入（research R-014）。
- 排序 MUST 以 `seq`。
- MUST NOT 提供刪除或修改介面。

---

## environment_event（平台外工具事件）

MUST 僅記錄客觀事實，MUST NOT 含任何判定欄位（FR-026）。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid (PK) | |
| `session_id` | uuid (FK) | |
| `type` | text | `window_blur` \| `tab_hidden` |
| `started_at` | timestamptz | |
| `duration_ms` | int | 離開持續長度，CHECK `>= 1000` |

**驗證規則**：`duration_ms < 1000` 的事件 MUST NOT 記錄（濾除焦點抖動）。

---

## test_run（測試結果）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid (PK) | |
| `session_id` | uuid (FK) | |
| `question_id` | text (FK) | |
| `passed` | int | 通過數 |
| `total` | int | 總數 |
| `ran_at` | timestamptz | |

**驗證規則**：本期結果來自 `question.predefined_tests`，MUST NOT 執行應試者程式碼（FR-030）。

---

## 前端狀態切片（單一事實來源）

`frontend/src/store/session.ts` 持有下列狀態；三個面板皆以 selector 讀取，
**任何面板 MUST NOT 自行保有副本**（憲章原則 II）。

```text
SessionState {
  session:        { id, candidateName, positionTitle, deadlineAt, status }
  questions:      Question[]              // 唯讀
  currentQuestionId: string               // 三面板共用的當前題目
  answers:        Record<questionId, { language, content, saveState, revision }>
  chat:           ChatMessage[]           // 每則 assistant 訊息含 codeBlocks[]
  streaming:      { active: boolean, messageId?: string }
  applying:       { blockKey?: string }   // 套用中的區塊，防止重複點擊
  connectivity:   'online' | 'offline'
}
```

`saveState` 為 `idle | saving | saved | error`，驅動作答區標題列的保存狀態指示（FR-004）。

**衍生值（selectors，不另存狀態）**：

- `currentQuestion` = `questions.find(q => q.id === currentQuestionId)`
- `currentAnswer` = `answers[currentQuestionId]`
- `remainingSec` = 由 `deadlineAt` 與校時後的時鐘推導
- `isReadOnly` = `session.status !== 'in_progress'`

**刻意不放入前端狀態的東西**：`code_change` 的歷史。前端只需要知道「當前內容」與
「是否正在套用」；變更歷史是伺服端的評分材料，放進前端沒有用途，
反而多一份可能與伺服端不一致的副本。
