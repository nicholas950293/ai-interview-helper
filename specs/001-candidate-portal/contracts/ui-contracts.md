# Contract: UI 與跨面板互動

**Date**: 2026-08-04 | **Plan**: [../plan.md](../plan.md)

本文件定義三面板的版面契約、跨面板動作的資料流，以及可及性與效能的可驗收約定。
狀態欄位定義見 [data-model.md](../data-model.md#前端狀態切片單一事實來源)。

---

## 版面契約

```text
┌─ Header ────────────────────────────────────────────────────────────────┐
│ Logo · 職稱 │ 倒數計時器 │ 姓名 │ 全螢幕 │ 提交全卷                        │
├─────────────────────────────────────┬───────────────────────────────────┤
│ QuestionPanel      (左上)            │ CopilotPanel      (右)             │
│  Tabs · 難度/配分 · 內容 · 詢問AI按鈕  │  StatusBar · ModeToggle           │
├─────────────────────────────────────┤  ChatFeed                         │
│ AnswerWorkspace    (左下)            │  QuickPromptChips                 │
│  語言 · 保存狀態 · 格式化             │  Composer                         │
│  CodeEditor · 控制台 · 測試 · 送AI    │                                   │
└─────────────────────────────────────┴───────────────────────────────────┘
```

- 左右比例以 CSS grid `grid-template-columns` 控制，MUST 落在 6:4 至 7:5 之間（憲章原則 V）。
- 視窗寬度 < 1024px 時改為單欄堆疊，AI 側欄轉為可收合面板；MUST NOT 產生整頁水平捲動。
- 左側上下比例預設 1:1，允許使用者拖曳調整，比例存於本機偏好（非場次狀態）。

---

## 跨面板動作（憲章原則 II 的可驗收面）

三個面板皆為 `sessionStore` 的消費者。下列動作 MUST 從 store 讀取 Context，
MUST NOT 由元件間直接傳遞快照。

### A-01 切換題目

**觸發**：QuestionPanel 的 Tabs

**流程**：
1. `flushPendingSave()` — 若當前題目有未保存變更，先強制保存
2. `store.setCurrentQuestion(id)`
3. `POST /api/chat/system` 記錄切換，將回傳的系統訊息 append 至 `chat`
4. CopilotPanel 的 StatusBar 自動反映新題目（訂閱 `currentQuestion`，非傳參）
5. AnswerWorkspace 顯示新題目的 `answers[id]`，若不存在則載入該語言的 `starterCode`

**驗收**：切換後立即提問，AI 回覆 MUST 對應新題目（spec US3 情境 4）。

### A-02 詢問 AI 題目重點

**觸發**：QuestionPanel 的「詢問 AI 題目重點」按鈕

**流程**：`POST /api/chat` with
`{ questionId: currentQuestionId, content: 預設提問, attachCode: false, source: "question_hint" }`
→ 訊息立即樂觀 append 至 ChatFeed → 開啟 SSE 串流。

**預設提問**：「請簡要說明這道題目的核心評分要點。」

**驗收**：停留在 Q2 時點擊，送出的 `questionId` MUST 為 Q2（spec US3 情境 1）。

### A-03 傳送至 AI 檢查

**觸發**：AnswerWorkspace 的「傳送至 AI 側邊欄」按鈕

**流程**：
1. `await flushPendingSave()` — **必要**，否則伺服端取到的是舊草稿
2. `POST /api/chat` with `{ questionId, content: Code Review 提問, attachCode: true, source: "code_review" }`
3. ChatFeed 顯示該則訊息時 MUST 標示「已附帶目前程式碼」

**驗收**：輸入程式碼後不等待自動保存即點擊，AI 收到的 MUST 是最新內容（spec US3 情境 2）。

### A-04 快捷提問 Chip

**觸發**：CopilotPanel 的 Chips（內容來自 `currentQuestion.quickPrompts`）

**流程**：`POST /api/chat` with `{ source: "quick_prompt", attachCode: false }`，
點擊即送出，無需額外輸入。Chips 內容 MUST 隨當前題目變動。

---

## 元件狀態契約

### 保存狀態指示（AnswerWorkspace 標題列）

| `saveState` | 顯示文字 | 可及性宣告 |
| --- | --- | --- |
| `idle` | 「草稿」 | 無 |
| `saving` | 「儲存草稿中…」 | `aria-live="polite"` |
| `saved` | 「已自動儲存草稿」 | `aria-live="polite"` |
| `error` | 「儲存失敗，將自動重試」 | `aria-live="assertive"` |

MUST NOT 僅以顏色區分狀態（憲章原則 V）。

### 倒數計時器（Header）

| 剩餘時間 | 呈現 | 行為 |
| --- | --- | --- |
| > 5 分 | 一般樣式 | — |
| ≤ 5 分 | 警示樣式 + `aria-live="assertive"` 宣告一次 | — |
| = 0 | 鎖定樣式 | 鎖定全部輸入並觸發強制提交 |

顯示每秒更新；權威來自 `deadlineAt` 與校時偏移，MUST NOT 以純本地累加計時。

### 對話 Feed

| `role` | 呈現 |
| --- | --- |
| `candidate` | 右側氣泡；`attachedCode` 存在時顯示「已附帶程式碼」標記與可展開的程式碼 |
| `assistant` | 左側氣泡；串流中顯示逐字輸出與忙碌指示 |
| `system` | 置中細體分隔訊息（題目切換通知） |

串流期間 Composer 的送出按鈕 MUST 呈忙碌且不可重複送出。

### 引導模式切換

`light`（輕度引導）／`deep`（深入討論）以分段控制項呈現，MUST 標示當前模式的可存取名稱。
切換 MUST NOT 清空既有對話。

---

## 鍵盤契約

| 快捷鍵 | 作用 | 位置 |
| --- | --- | --- |
| `Ctrl/Cmd + Enter` | 送出提問 | Composer |
| `Tab` / `Shift + Tab` | 縮排／反縮排 | CodeEditor |
| `Esc` | 關閉對話框；退出全螢幕 | 全域 |
| `Ctrl/Cmd + S` | 立即保存草稿（攔截瀏覽器預設） | 全域 |

所有快捷鍵 MUST 於介面上有可見說明（憲章原則 V）。核心流程——閱讀題目、作答、提問、
提交——MUST 可全鍵盤完成。

---

## 效能契約（憲章原則 IV 的可驗收面）

- CodeEditor 的 `onChange` MUST NOT 觸發 QuestionPanel 或 CopilotPanel 重繪
  （以 React Profiler 於元件測試中斷言）。
- 按鍵到畫面更新 p95 < 50ms，以 Playwright 對 500 次連續輸入量測。
- 草稿保存 debounce 1000ms：連續輸入 3 秒 MUST 僅產生 1 次 `PUT /api/answers`
  （以 fake timers 與請求計數斷言）。
- SSE token 抵達 MUST 以批次方式套用至狀態，避免每 token 一次全域更新。
