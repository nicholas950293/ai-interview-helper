# Phase 0 Research: Candidate Portal

**Date**: 2026-08-04 | **Plan**: [plan.md](./plan.md)

Technical Context 中無殘留的 NEEDS CLARIFICATION。本文件記錄每項技術選擇的決策、理由與
被否決的替代方案。

---

## R-001 程式碼編輯器

**Decision**：本期採 CodeMirror 6，透過 `@codemirror/state` + `@codemirror/view` 直接組裝，
只載入所需語言的 `@codemirror/lang-*`。

**Rationale**：
- 憲章原則 IV 要求按鍵到畫面 p95 < 50ms。CodeMirror 6 的 gzip 體積約為 Monaco 的
  十分之一量級，初始化與按鍵路徑都更短，在預算內留有餘裕。
- PRD F3 已明示編輯器套件為 Monaco 或 CodeMirror 二擇一，且 Monaco 被排在 Roadmap
  Phase 2；本期選 CodeMirror 符合分期規劃，也符合憲章「Phase 不得提前混入」。
- 行號、語法高亮、Tab 縮排三項需求皆為 CodeMirror 內建擴充。

**Alternatives considered**：
- **Monaco Editor**：功能最完整（Auto-complete、Lint），但體積大、初始化慢，且屬 Phase 2 範圍。
- **純 textarea + 行號 gutter**：最輕，但無法滿足 FR-007 的語法高亮，且捲動同步易出錯。

**Migration note**：編輯器以 `<CodeEditor>` 介面封裝（value / onChange / language / readOnly），
Phase 2 換 Monaco 時只替換實作，不動狀態層。

---

## R-002 前端狀態管理

**Decision**：Zustand 單一 session store，配合切片化 selector 訂閱。

**Rationale**：
- 憲章原則 II 要求單一事實來源。Zustand 的單 store 模型天然對應此約束，且可在 store
  外部（services、計時器）直接讀寫，不需 Provider 樹。
- 切片化訂閱讓編輯器輸入只觸發作答區重繪，題目區與 AI 側欄不受影響——這是滿足 50ms
  預算的關鍵，React Context 做不到。

**Alternatives considered**：
- **React Context + useReducer**：零依賴，但任何狀態變更會使所有消費者重繪，直接衝突原則 IV。
- **Redux Toolkit**：訂閱粒度足夠，但樣板量對 12–15 個元件的規模而言過重。

---

## R-003 BFF 框架

**Decision**：Hono 4 執行於 Node.js 22。

**Rationale**：依賴少、啟動快，內建型別安全路由與 Zod 中介層整合；SSE 串流以標準
`Response` + `ReadableStream` 實作，無需額外套件。8 個端點的規模不需要更重的框架。

**Alternatives considered**：
- **Express 5**：生態最大，但 SSE 與型別推導需自行拼裝。
- **Fastify**：效能相當，插件體系對本期規模而言是多餘的抽象。

---

## R-004 持久化

**Decision**：SQLite 單檔資料庫，經 better-sqlite3 同步存取；schema 以編號遷移檔管理。

**Rationale**：單場次、單應試者、2–3 題的資料量，SQLite 綽綽有餘且零維運。同步 API
讓「提交時取最後一次成功保存的草稿」（FR-022）成為單一交易，不需處理競態。

**Alternatives considered**：
- **PostgreSQL**：本期無併發或水平擴展需求，徒增部署負擔。
- **JSON 檔案**：無交易保證，強制提交當下的一致性無法保障。

---

## R-005 AI 串流傳輸

**Decision**：Server-Sent Events（BFF → 前端單向串流）。

**Rationale**：對話是單向串流，SSE 語意精準、可自動重連、走一般 HTTP。前端送出提問
用 POST，取得 stream id 後以 SSE 接收 token。

**Alternatives considered**：
- **WebSocket**：雙向能力用不上，且增加連線狀態管理。
- **輪詢**：無法達成「首個 token 2 秒內開始串流」的體驗目標。

---

## R-006 AI 圍欄策略（憲章原則 I）

**Decision**：三層防線——
1. **System instruction**：定義於 `backend/src/ai/guardrails.ts`，以常數匯出並納入版本控管；
   前端送來的內容一律作為 user turn，永遠無法進入 system 位置。
2. **模式參數化**：輕度／深入僅調整 `verbosity` 與 `depth` 提示段落，圍欄段落固定不變。
3. **輸出後處理**：偵測回應中是否出現完整函式／類別實作且長度超過門檻，命中則以引導式
   訊息取代並記錄事件。

**Rationale**：單靠 prompt 無法承受越獄壓力；後處理提供確定性的最後一道關卡，也讓
憲章要求的自動化越獄測試有可斷言的對象。

**Alternatives considered**：
- **純 System Prompt**：測試中對「偽裝除錯」類輸入的失敗率不可接受。
- **微調模型**：成本與時程遠超本期，且圍欄需求會隨題庫變動。

**Testing**：`backend/tests/guardrails/` 以錄製回應（fixtures）在 CI 快速驗證後處理層；
另設排程作業對真實模型跑完整越獄語料，避免 fixtures 與模型行為脫節。

---

## R-007 計時權威與強制提交

**Decision**：場次的 `deadlineAt` 由伺服端於場次開始時寫入；前端每秒依本地時鐘顯示，
並每 30 秒與伺服端校時。強制提交由前端觸發，伺服端獨立驗證 deadline 後才接受。

**Rationale**：憲章要求計時以伺服端為權威。前端本地遞減保證顯示流暢，週期校時修正漂移；
伺服端二次驗證使前端時鐘竄改無效。

**Alternatives considered**：
- **純前端計時**：可被竄改，違反公正性要求。
- **每秒向伺服端查詢**：請求量與失敗處理成本不成比例。

---

## R-008 離線草稿佇列

**Decision**：IndexedDB 保存待送出的草稿變更佇列，key 為 `(sessionId, questionId)`，
恢復連線後依序補送；每筆保存回應帶 `savedAt`，前端以此更新保存狀態指示。

**Rationale**：憲章明定草稿不得遺失。IndexedDB 容量足以容納大型程式碼草稿，且為非同步
API，不阻塞輸入路徑（localStorage 的同步寫入會直接吃掉 50ms 預算）。

**Alternatives considered**：
- **localStorage**：同步寫入衝擊輸入延遲，且 5MB 上限對長程式碼有風險。
- **僅記憶體**：分頁關閉即失，不可接受。

---

## R-009 邀請連結與存取控制

**Decision**：不透明隨機 token（128-bit，URL 安全編碼）存於資料庫，狀態為
`pending | active | consumed | expired`。路由 `/s/:token`，BFF 驗證後換發短期 session
cookie，後續 API 以 cookie 授權。

**Rationale**：不透明 token 可即時撤銷（簽章 token 做不到）；換發 cookie 後 token 不再
出現在後續請求，降低外洩面。重複開啟同一連結時沿用既有 active 場次，滿足「不得重置
計時或清空草稿」的邊界情境。

**Alternatives considered**：
- **JWT 簽章 token**：無狀態但不可撤銷，與「一次性、可失效」需求衝突。
- **帳號密碼登入**：使用者已明確否決，且對一次性面試場景過重。

---

## R-010 程式碼格式化

**Decision**：JavaScript / TypeScript 以 Prettier standalone（瀏覽器端）格式化；
Python 與 Go 本期以縮排正規化處理（統一縮排寬度、去除行尾空白、正規化空行）。

**Rationale**：Prettier standalone 可在前端執行，無需後端往返。Python/Go 的完整格式化器
（black、gofmt）需伺服端執行環境，屬 Phase 3 沙盒範圍。FR-006 只要求「重新排版與縮排」
與失敗時的提示，縮排正規化已滿足；語言差異於 UI 明確標示。

**Alternatives considered**：
- **後端呼叫 black / gofmt**：需要語言執行環境，越過本期範圍界線。
- **完全不支援非 JS 語言**：FR-006 未限定語言，體驗上不一致。

---

## R-011 UI 基礎元件與可及性

**Decision**：Radix UI 提供 Dialog（提交確認）、Toast（保存／測試／格式化提示）、
Tabs（題目頁籤）；其餘元件自行實作。Tailwind CSS 4 以 CSS 變數定義淺色主題 token。

**Rationale**：憲章原則 V 要求全鍵盤可操作與正確的可存取名稱。Radix 已處理焦點陷阱、
ESC 關閉、ARIA 角色與 live region——自行實作這些是常見的可及性缺陷來源。
Tailwind 4 的 `@theme` 讓淺色 token 集中於單一檔案，符合「一致性」要求。

**Alternatives considered**：
- **完整 UI 套件（MUI 等）**：預設視覺與 PRD 的三卡片淺色系不符，覆寫成本高於自建。
- **全自建**：可及性風險高，且無助於交付速度。

---

## R-012 作答環境監測

**Decision**：`document.visibilitychange` 與 `window.blur`／`focus` 組合判定；記錄
`type`、`startedAt`、`durationMs`，離開超過 1000ms 才計為一次事件並提示應試者。
事件即時送往 BFF，離線時併入草稿佇列補送。

**Rationale**：`blur` 涵蓋切換到其他應用程式，`visibilitychange` 涵蓋切換分頁，兩者互補。
1000ms 門檻濾掉焦點瞬時抖動（如 Toast 出現）造成的誤報。憲章明定只記錄客觀事實，
因此前端只回報事件本身，不做作弊判定。

**Alternatives considered**：
- **僅 visibilitychange**：切換到另一個應用程式視窗時不觸發，漏檢。
- **無門檻即時記錄**：誤報過多，反而干擾應試者。
