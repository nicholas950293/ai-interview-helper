<!--
Sync Impact Report (v4.0.0)
- Version change: 3.0.3 → 4.0.0
- Bump rationale: MAJOR —— 移除一項原則（II. Context 單一事實來源）、移除多個治理章節
  （開發流程與品質關卡、Governance、生效範圍與遷移狀態），並不相容地放寬多項技術選型。
  全文以產品負責人 2026-08-05 提供的新版為準。

- Removed principles:
  - II. Context 單一事實來源 (Single Source of Truth for Context) —— 全數移除。
    三面板共用會談狀態、禁止 Context 快照複製、題目切換系統訊息等條款不再屬憲章層級。

- Renumbered principles:
  - III. 互動邏輯測試先行 → II（內容不變）
  - IV. 規格驅動開發 → III（內容不變）
  - V. 技術棧治理 → IV（內容有修改，見下）
  - VI. 淺色系一致性與可及性 → V（內容不變）

- Modified principles:
  - I. AI 協作可評估性不可妥協 —— 精簡條款：移除「MUST NOT 以 prompt 圍欄限制輸出」、
    「記錄 MUST 有自動化測試覆蓋」與「對所有 GenAI 供應商一致生效」三則細項；
    核心要求（完整實作能力、對話留存、作者歸屬、完整輸出可見）維持不變。
  - IV. 技術棧治理 ——
    · 前端框架：Next.js (React) → React（不再指定 meta-framework）。
    · 樣式：Tailwind CSS MUST → CSS MUST、Tailwind CSS SHOULD。
    · 虛擬環境：venv → uv venv。
    · 資料庫：移除「RLS SHOULD 啟用／匿名金鑰可觸及資料表 MUST 啟用」條款。
    · AI 整合：雙供應商（Gemini + Claude）MUST → 僅 MUST 支援 Google Gemini；
      LangChain 統一編排與禁止裸接 SDK 維持不變。
    · 認證：Google Login MUST → SHOULD。
    · 部署與基礎設施小節（Docker、Ubuntu 24.04、GitHub Actions CI/CD）全數移除。

- Removed sections:
  - 生效範圍與遷移狀態（落差表已於 v3.0.3 清空，依該章節自身要求移除）
  - 公正性與安全要求 → 「平台外工具監測」條款移除；其餘四項（提交不可逆、
    協作歷程留存、資料最小化、憑證隔離）保留。
  - 開發流程與品質關卡（PR 制、CI 關卡、Phase 分期）全數移除。
  - Governance（修訂程序、版本政策、合規審查）全數移除。

- Deferred TODOs / editorial notes:
  - 原文「見『生效範圍與遷移狀態』」的交叉引用因該章節移除而失效，已改寫為
    「本項為尚未實作的目標狀態」。
  - 原文筆誤「SHOUD」已更正為 SHOULD；前端框架段落的貼文雜訊已清除。
  - Governance 章節移除後，本憲章不再自載版本政策與修訂程序；本報告仍沿用
    既有語意化版本慣例標記 4.0.0。建議產品負責人確認是否需要恢復最小 Governance 條款。
-->

# TechInterview Pro Candidate Portal Constitution

## Core Principles

### I. AI 協作可評估性不可妥協 (Assessable AI Collaboration, NON-NEGOTIABLE)

本平台評估的是「應試者能否透過 AI 完成實作」，不是「能否徒手寫出程式碼」。
AI MUST 具備完整的實作能力；不可妥協之處不在於限制 AI，而在於協作過程可被評估。

- AI MUST 能輸出完整、可執行的實作，並 MUST 提供將其套用至作答內容的途徑。
- 完整對話歷程 MUST 留存，且每一則訊息 MUST 可追溯到當時的題目與程式碼狀態。
- 每一次程式碼變更 MUST 記錄其來源：應試者自行輸入、或套用 AI 產出。
  兩者 MUST NOT 混為一談——評分需要能區分「誰寫的」。
- 應試者 MUST 能看見 AI 的完整輸出，MUST NOT 有任何隱藏、裁切或改寫。

**理由**：既然評估對象是「透過 AI 實作的能力」，限制 AI 就等於讓題目失真。
取而代之的不可妥協之處是可評估性——若對話與程式碼演進沒有被完整記錄且可歸屬，
面試分數同樣失去意義。這是「AI 幫助思考、而非代寫」的舊前提被替換後，
唯一還能撐住評估效力的東西。

### II. 互動邏輯測試先行 (Test-First for Interaction Logic)

計時、自動儲存、提交、AI 產出的套用與作者歸屬、跨組件聯動屬於關鍵路徑。

- 上述關鍵路徑的每一項行為 MUST 先有失敗的測試，才寫實作 (Red-Green-Refactor)。
- 計時歸零強制提交、Debounce 儲存、平台外工具事件記錄 MUST 有測試以假時鐘驗證邊界，
  MUST NOT 僅以手動點擊驗收。
- 純視覺樣式調整 MAY 免除單元測試，但仍 MUST 通過既有回歸測試。

**理由**：面試場景不可重來。一次計時錯誤或草稿遺失就是一位應試者的實質損害，
事後修復無法補償。

### III. 規格驅動開發 (Spec-Driven Development, SDD)

所有功能開發 MUST 依序經過 spec → plan → tasks → implement。

- 任何功能 MUST NOT 跳過規格直接實作；沒有 `spec.md` 就沒有 `plan.md`，
  沒有 `tasks.md` 就不進 implement。
- 實作過程中發現規格有誤時，MUST 先回頭修正 `spec.md` 或 `plan.md`，
  MUST NOT 只改程式碼而讓文件與實作脫節。
- 每個 feature 的產出 MUST 存放於 `specs/<NNN>-<slug>/`，
  並 MUST 通過 `/speckit-analyze` 的跨產物一致性檢查後才進 implement。
- 緊急修復 (hotfix) MAY 先改程式碼，但 MUST 於同一次 PR 內補齊對應的規格變更。

**理由**：規格是這個專案唯一能被審查、被爭論、被留存的設計依據。跳過規格直接實作
等於把設計決策藏進程式碼裡，之後沒有人（包含作者自己）能說清楚為什麼是這樣。

### IV. 技術棧治理 (Technology Stack Governance)

以下技術選型為本專案的治理決定。`/speckit-specify`、`/speckit-plan`、`/speckit-tasks`
的產出 MUST 遵守，MUST NOT 在未修訂本憲章的情況下替換為其他框架或服務。

**開發方法論**

- SDD 流程 MUST 遵守（見原則 III）。

**前端**

- 框架 MUST 為 React。
- 語言 MUST 為 TypeScript；MUST NOT 新增未經型別檢查的 JavaScript 原始檔。
- 樣式 MUST 為 CSS，SHOULD 使用 Tailwind CSS；設計 token MUST 集中於單一來源。
- UI 基礎元件 SHOULD 選用已處理焦點管理與 ARIA 的無頭元件庫，以滿足原則 V。

**後端**

- 語言 MUST 為 Python；框架 MUST 為 FastAPI。
- 套件管理 MUST 使用 uv；虛擬環境 MUST 使用 uv venv 管理。
- 相依版本 MUST 鎖定（lock file 進版控），MUST NOT 依賴未鎖定的浮動版本。

**資料庫**

- MUST 使用 Supabase 作為資料庫與持久化層。
- Schema 變更 MUST 以遷移檔管理並進版控，MUST NOT 僅於後台介面手動調整。

**AI 整合**

- MUST 支援 Google Gemini。
- 所有模型呼叫與編排 MUST 透過 LangChain 進行；MUST NOT 於應用程式碼中
  直接裸接個別供應商的 SDK。
- 供應商的切換或組合 MUST 可透過設定完成，MUST NOT 需要改動業務邏輯。
- 原則 I 的協作歷程記錄 MUST 實作於 LangChain 的共用層，
  使對話留存與作者歸屬對所有供應商一致生效。

**認證**

- 使用者登入 SHOULD 支援 Google Login (Google OAuth)。
- OAuth client secret MUST 僅存在於伺服端（見「公正性與安全要求」的憑證隔離）。
- 本項為尚未實作的目標狀態。

**理由**：技術選型分散會讓每個 feature 的 plan 各自為政，最終得到一個沒有人能整體
維護的系統。把選型寫進憲章，是為了讓「要換技術」變成一次需要明講理由的修訂，
而不是某一份 plan.md 裡的一行決定。

### V. 淺色系一致性與可及性 (Light-Theme Consistency & Accessibility)

- UI MUST 維持柔和淺色系 (Clean Light Theme) 與三卡片浮動式版面；左側與右側
  比例 MUST 維持在 6:4 至 7:5 之間。允許使用者拖曳調整比例，但拖曳範圍與偏好還原
  MUST 夾制於該區間內。
- 目標裝置為桌機／筆電，最小支援視窗寬度 1280px。本期 MUST NOT 為行動裝置或窄視窗
  另做響應式堆疊版面；上述比例約束在所有支援寬度下皆成立，無響應式例外。
- 文字與背景對比 MUST 達 WCAG AA (一般文字 4.5:1、大型文字 3:1)。
- 所有互動元件 MUST 可鍵盤操作；Ctrl+Enter 送出、Tab 縮排等快捷鍵 MUST 有可見說明。
- 狀態變化（儲存中/已儲存、測試結果、AI 回覆中）MUST 同時以視覺與可存取名稱呈現，
  MUST NOT 僅依賴顏色。

**理由**：應試者在高壓與長時間閱讀下作答；一致、低干擾且可及的介面是公平性的一部分，
不是美術偏好。

## 公正性與安全要求 (Fairness & Security Requirements)

- **提交不可逆**：計時歸零 MUST 鎖定所有輸入並強制提交。強制提交 MUST 使用最後一次
  成功儲存的草稿，MUST NOT 因網路失敗而丟棄作答內容。
- **協作歷程留存**：應試者與 AI 的完整對話、以及每一次程式碼變更的作者歸屬
  MUST 留存，供 Phase 4 評分後台檢視。這是本平台的主要評分材料，
  MUST NOT 因任何理由被裁切或匿名化（見原則 I）。
- **資料最小化**：前端 MUST 僅顯示必要的個人資訊（姓名與職稱）；其他個資 MUST NOT
  進入前端狀態或送入模型 Context。
- **憑證隔離**：下列憑證 MUST NOT 出現在前端程式碼或建置產物中——
  GenAI 供應商的 API 金鑰、Supabase 的 service role key、Google OAuth 的 client secret。
  CI MUST 有自動化檢查驗證建置產物不含上述憑證。

**Version**: 4.0.0 | **Ratified**: 2026-08-04 | **Last Amended**: 2026-08-05
