# Phase 1 Data Model: Candidate Portal

**Date**: 2026-08-04 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

實體對應 spec 的 Key Entities。持久化於 SQLite；前端 session store 持有其中的
**可變作答狀態**子集（見文末「前端狀態切片」）。

---

## 實體關聯

```text
InviteToken ──1:1── InterviewSession
                         │
                         ├──1:N── SessionQuestion ──N:1── Question
                         │              │
                         │              └──1:1── Answer
                         │
                         ├──1:N── ChatMessage
                         ├──1:N── EnvironmentEvent
                         └──1:N── TestRun
```

---

## InviteToken（邀請連結）

| 欄位          | 型別        | 說明                                             |
| ------------- | ----------- | ------------------------------------------------ |
| `token`       | string (PK) | 128-bit 隨機值，URL 安全編碼                     |
| `sessionId`   | string (FK) | 綁定的場次                                       |
| `status`      | enum        | `pending` \| `active` \| `consumed` \| `expired` |
| `expiresAt`   | timestamp   | 逾期時間                                         |
| `firstUsedAt` | timestamp?  | 首次兌換時間                                     |

**驗證規則**：

- `token` MUST 唯一且不可預測。
- 兌換時 MUST 檢查 `status` 與 `expiresAt`；`consumed` 且對應場次仍為 `in_progress` 時
  MUST 允許重新進入同一場次（不重置計時、不清空草稿）。

**狀態轉移**：`pending → active`（首次兌換）→ `consumed`（場次提交）；
任一狀態於 `expiresAt` 之後 → `expired`。

---

## InterviewSession（面試場次）

| 欄位            | 型別        | 說明                                                                 |
| --------------- | ----------- | -------------------------------------------------------------------- |
| `id`            | string (PK) |                                                                      |
| `candidateName` | string      | 顯示於 Header，如「Alex Chen」                                       |
| `positionTitle` | string      | 如「資深全端工程師模擬面試」                                         |
| `durationSec`   | int         | 總時長                                                               |
| `startedAt`     | timestamp?  | 首次兌換時寫入                                                       |
| `deadlineAt`    | timestamp?  | `startedAt + durationSec`，計時權威                                  |
| `status`        | enum        | `not_started` \| `in_progress` \| `submitted` \| `expired_submitted` |
| `submittedAt`   | timestamp?  |                                                                      |
| `guidanceMode`  | enum        | `light` \| `deep`，預設 `light`                                      |

**驗證規則**：

- `candidateName` 與 `positionTitle` 為前端唯一可見的個資欄位（FR-032）。
- `status` 非 `in_progress` 時 MUST 拒絕所有草稿寫入與提問。
- `deadlineAt` MUST 由伺服端計算，MUST NOT 接受用戶端傳入。

**狀態轉移**：

```text
not_started ──兌換連結──> in_progress ──手動提交──> submitted
                              └──deadline 到期──> expired_submitted
```

兩個終態皆不可逆；進入終態時所有作答轉為唯讀。

---

## Question（題目）

| 欄位                    | 型別                     | 說明                                       |
| ----------------------- | ------------------------ | ------------------------------------------ |
| `id`                    | string (PK)              |                                            |
| `title`                 | string                   | 如「API 限流器」                           |
| `difficulty`            | enum                     | `easy` \| `medium` \| `hard`               |
| `points`                | int                      | 配分，如 40                                |
| `description`           | markdown                 | 題目描述與功能規格                         |
| `examples`              | Example[]                | `{ input, output, note? }`                 |
| `complexityRequirement` | string                   | 時間／空間複雜度要求                       |
| `gradingFocus`          | string[]                 | 評分重點                                   |
| `starterCode`           | Record<Language, string> | 各語言啟始樣板                             |
| `predefinedTests`       | TestCase[]               | `{ name, expectedPass }`，本期用於回報結果 |
| `quickPrompts`          | string[]                 | 該題的快捷提問 Chips                       |

**驗證規則**：`starterCode` MUST 至少涵蓋 `javascript`、`typescript`、`python`、`go`；
缺漏語言時 MUST 以空樣板回退而非讓 UI 崩潰。

---

## SessionQuestion（場次題目）

| 欄位         | 型別        | 說明                         |
| ------------ | ----------- | ---------------------------- |
| `sessionId`  | string (FK) |                              |
| `questionId` | string (FK) |                              |
| `order`      | int         | 頁籤順序，1 起算（Q1/Q2/Q3） |

主鍵為 `(sessionId, questionId)`。

---

## Answer（作答）

| 欄位         | 型別        | 說明                                             |
| ------------ | ----------- | ------------------------------------------------ |
| `sessionId`  | string (FK) |                                                  |
| `questionId` | string (FK) |                                                  |
| `language`   | enum        | `javascript` \| `typescript` \| `python` \| `go` |
| `content`    | text        | 程式碼內容                                       |
| `savedAt`    | timestamp   | 最後一次伺服端保存成功時間                       |
| `revision`   | int         | 每次保存遞增，用於偵測失序寫入                   |

主鍵為 `(sessionId, questionId)`。

**驗證規則**：

- 保存 MUST 拒絕 `revision` 小於現有值的請求（防止離線補送覆蓋較新內容）。
- 提交 MUST 取每題 `savedAt` 最新的一筆（FR-022），MUST NOT 依賴前端傳入的內容。
- `content` 長度上限 256 KB；超出時 MUST 回傳明確錯誤而非靜默截斷。

---

## ChatMessage（對話訊息）

| 欄位                 | 型別        | 說明                                   |
| -------------------- | ----------- | -------------------------------------- |
| `id`                 | string (PK) |                                        |
| `sessionId`          | string (FK) |                                        |
| `questionId`         | string (FK) | 發話當下綁定的題目                     |
| `role`               | enum        | `candidate` \| `assistant` \| `system` |
| `content`            | text        |                                        |
| `createdAt`          | timestamp   |                                        |
| `attachedCode`       | text?       | 「傳送至 AI 檢查」時附帶的程式碼快照   |
| `guidanceMode`       | enum?       | 該則回覆採用的模式                     |
| `guardrailTriggered` | boolean     | 後處理層是否攔截並改寫過此則回覆       |

**驗證規則**：

- 所有訊息 MUST 留存至場次結束後（FR-015），MUST NOT 提供刪除介面。
- `role = system` 用於題目切換通知（FR-019）。
- `guardrailTriggered = true` 的訊息 MUST 一併記錄原始攔截原因於伺服端日誌
  （不回傳前端）。

---

## EnvironmentEvent（環境事件）

| 欄位         | 型別        | 說明                          |
| ------------ | ----------- | ----------------------------- |
| `id`         | string (PK) |                               |
| `sessionId`  | string (FK) |                               |
| `type`       | enum        | `window_blur` \| `tab_hidden` |
| `startedAt`  | timestamp   |                               |
| `durationMs` | int         | 離開持續長度                  |

**驗證規則**：`durationMs < 1000` 的事件 MUST NOT 記錄（濾除焦點抖動）。
記錄 MUST 為客觀事實，MUST NOT 含任何判定欄位（FR-026）。

---

## TestRun（測試結果）

| 欄位         | 型別        | 說明   |
| ------------ | ----------- | ------ |
| `id`         | string (PK) |        |
| `sessionId`  | string (FK) |        |
| `questionId` | string (FK) |        |
| `passed`     | int         | 通過數 |
| `total`      | int         | 總數   |
| `ranAt`      | timestamp   |        |

**驗證規則**：本期結果來自 `Question.predefinedTests`，MUST NOT 執行應試者程式碼（FR-030）。

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
  chat:           ChatMessage[]
  guidanceMode:   'light' | 'deep'
  streaming:      { active: boolean, messageId?: string }
  connectivity:   'online' | 'offline'
}
```

`saveState` 為 `idle | saving | saved | error`，驅動作答區標題列的保存狀態指示（FR-004）。

**衍生值（selectors，不另存狀態）**：

- `currentQuestion` = `questions.find(q => q.id === currentQuestionId)`
- `currentAnswer` = `answers[currentQuestionId]`
- `remainingSec` = 由 `deadlineAt` 與校時後的時鐘推導
- `isReadOnly` = `session.status !== 'in_progress'`
