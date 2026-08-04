# Contract: UI 與跨面板互動

**Date**: 2026-08-04 | **Plan**: [../plan.md](../plan.md) | **Constitution**: v3.0.0

本文件定義三面板的版面契約、跨面板動作的資料流，以及可及性的可驗收約定。
狀態欄位定義見 [data-model.md](../data-model.md#前端狀態切片單一事實來源)。

---

## 版面契約

```text
┌─ Header ────────────────────────────────────────────────────────────────┐
│ Logo · 職稱 │ 倒數計時器 │ 姓名 │ 快捷鍵 │ 全螢幕 │ 提交全卷              │
├─────────────────────────────────────┬───────────────────────────────────┤
│ QuestionPanel      (左上)            │ CopilotPanel      (右)             │
│  Tabs · 難度/配分 · 內容 · 詢問AI按鈕  │  規範 Banner · StatusBar          │
├─────────────────────────────────────┤  ModeToggle                       │
│ AnswerWorkspace    (左下)            │  ChatFeed（含程式碼區塊與套用按鈕） │
│  語言 · 保存狀態 · 格式化             │  QuickPromptChips                 │
│  CodeEditor · 控制台 · 測試 · 送AI    │  Composer                         │
└─────────────────────────────────────┴───────────────────────────────────┘
```

- 左右比例以 CSS grid `grid-template-columns` 控制，MUST 落在 6:4 至 7:5 之間（憲章原則 VI）。
- 目標裝置為桌機／筆電，最小支援視窗寬度 1280px。本期 MUST NOT 為行動裝置或窄視窗
  另做堆疊版面；低於最小寬度時以水平捲動呈現完整版面即可，比例約束仍然成立。
- 左右與上下比例皆允許拖曳調整，但左右的拖曳範圍與本機偏好還原 MUST 夾制於 6:4–7:5；
  超出範圍的偏好值 MUST 夾回邊界而非照原值套用。

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

**驗收**：停留在 Q2 時點擊，送出的 `questionId` MUST 為 Q2（spec US3 情境 1）。

### A-03 傳送至 AI 檢查

**觸發**：AnswerWorkspace 的「傳送至 AI 側邊欄」按鈕

**流程**：

1. `await flushPendingSave()` — **必要**，否則伺服端取到的是舊草稿
2. `POST /api/chat` with `{ questionId, content: 檢視提問, attachCode: true, source: "code_review" }`
3. ChatFeed 顯示該則訊息時 MUST 標示「已附帶目前程式碼」

**驗收**：輸入程式碼後不等待自動保存即點擊，AI 收到的 MUST 是最新內容（spec US3 情境 2）。
離線導致 flush 失敗時 MUST 阻擋送出並提示，MUST NOT 以較舊的伺服端草稿充當 Context。

### A-04 快捷提問 Chip

**觸發**：CopilotPanel 的 Chips（內容來自 `currentQuestion.quickPrompts`）

**流程**：`POST /api/chat` with `{ source: "quick_prompt", attachCode: false }`，
點擊即送出。Chips 內容 MUST 隨當前題目變動。

### A-05 套用 AI 產出至編輯器 **（新增）**

**觸發**：ChatFeed 中某個程式碼區塊的「套用至編輯器」按鈕

**流程**：

1. `store.setApplying(blockKey)` — 該按鈕轉為忙碌，防止重複點擊
2. `POST /api/answers/{currentQuestionId}/apply` with `{ messageId, blockIndex }`
3. 以回應的 `content` 呼叫編輯器的 `onApplyExternal`（**非** `onChange`）——
   這是作者歸屬的前端來源，MUST NOT 走一般的輸入路徑
4. 以回應的 `revision`、`savedAt` 更新 store，並將 `saveState` 設為 `saved`
5. 取消任何進行中的 debounce 保存計時器，避免以套用前的內容覆蓋

**驗收**：

- 套用後編輯器內容 MUST 與該區塊 `content` **逐字相同**（SC-004）
- 該次變更 MUST 記錄為 `source = "ai"` 且可追溯至 `messageId` / `blockIndex`（FR-035）
- 回覆含多個區塊時，只有被點擊的那一個生效，其餘不影響作答內容（US2 情境 5）

**失敗處理**：套用失敗時 MUST NOT 改動編輯器內容，並以 Toast 說明原因。
場次已進入終態時按鈕 MUST 為停用狀態。

---

## 元件狀態契約

### 保存狀態指示（AnswerWorkspace 標題列）

| `saveState` | 顯示文字 | 可及性宣告 |
| --- | --- | --- |
| `idle` | 「草稿」 | 無 |
| `saving` | 「儲存草稿中…」 | `aria-live="polite"` |
| `saved` | 「已自動儲存草稿」 | `aria-live="polite"` |
| `error` | 「儲存失敗，將自動重試」 | `aria-live="assertive"` |

MUST NOT 僅以顏色區分狀態（憲章原則 VI）。

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
| `candidate` | 右側氣泡；`attachedCode` 存在時顯示「已附帶程式碼」標記與可展開內容 |
| `assistant` | 左側氣泡；串流中逐字輸出並顯示忙碌指示；**每個程式碼區塊獨立呈現** |
| `system` | 置中細體分隔訊息（題目切換通知） |

**程式碼區塊的呈現（新增）**：

- 每個區塊 MUST 顯示語言標註（若有）與「套用至編輯器」按鈕。
- 按鈕的可存取名稱 MUST 能區分同一則回覆中的不同區塊
  （例如「套用第 2 段程式碼至編輯器」）——只寫「套用」會讓螢幕閱讀器使用者
  無從分辨要套用哪一段。
- 區塊內容 MUST 完整顯示，MUST NOT 截斷或摺疊隱藏（憲章原則 I：
  應試者 MUST 能看見 AI 的完整輸出）。超長區塊以區塊內捲動呈現。
- 串流期間不顯示套用按鈕；`blocks` 事件抵達後才渲染。

串流期間 Composer 的送出按鈕 MUST 呈忙碌且不可重複送出。

### 協作模式切換 **（已移除，2026-08-05）**

原有 `discuss`／`implement` 分段控制項已移除。它是圍欄時代「輕度引導／深入討論」
的遺留物，憲章 v3.0.0 反轉原則 I 後僅剩「要不要輸出可套用的區塊」這一項差異，
而那件事改由系統提示依提問意圖判斷（FR-012）。

側欄 MUST NOT 再提供任何要求應試者先宣告意圖的前置設定——真實的 AI 工具沒有
這種開關，多一個平台自創的旋鈕會讓這場面試測到「有沒有發現那個按鈕」。

### AI 使用規範 Banner

側欄頂部長駐，不可關閉（FR-011）。內容 MUST 說明兩件事：

1. AI 全面開放協助實作，可直接產出並套用完整程式碼
2. 完整對話與每一次程式碼變更的來源都會被記錄，並作為評分依據

第 2 點是憲章原則 I 的知情要求——應試者有權在開始前就知道被記錄的範圍。

---

## 鍵盤契約

| 快捷鍵 | 作用 | 位置 |
| --- | --- | --- |
| `Ctrl/Cmd + Enter` | 送出提問 | Composer |
| `Tab` / `Shift + Tab` | 縮排／反縮排 | CodeEditor |
| `Esc` | 關閉對話框；退出全螢幕 | 全域 |
| `Ctrl/Cmd + S` | 立即保存草稿（攔截瀏覽器預設） | 全域 |
| `Ctrl/Cmd + /` | 開啟快捷鍵說明 | 全域 |

所有快捷鍵 MUST 於介面上有可見說明（憲章原則 VI）。核心流程——閱讀題目、作答、
提問、**套用 AI 產出**、提交——MUST 可全鍵盤完成。

---

## 效能約定

憲章 v3.0.0 已移除效能預算原則，以下為**產品目標**而非強制關卡：

- 按鍵到畫面更新 p95 < 50ms（以 Playwright 對 500 次連續輸入量測）
- CodeEditor 的 `onChange` 不觸發 QuestionPanel 或 CopilotPanel 重繪

以下仍為**功能需求**，不因原則移除而改變：

- 草稿保存 debounce 1000ms：連續輸入 3 秒 MUST 僅產生 1 次 `PUT /api/answers`（FR-004）
- SSE token 抵達 MUST 以批次方式套用至狀態，避免每 token 一次全域更新
