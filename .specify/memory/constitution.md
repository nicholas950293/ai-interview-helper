<!--
Sync Impact Report
- Version change: 1.1.0 → 2.0.0
- Bump rationale: MAJOR —— 移除一項既有原則，並以不相容的方式重新定義開發流程。
  兩者依版本政策皆屬 MAJOR。

- Removed principles:
  - IV. 效能預算即需求 (Performance Budgets Are Requirements) —— 全數移除。
    50ms 延遲預算、觸及編輯器路徑須附量測數據、超出預算須核可等條款一併失效。
    註：「草稿儲存 debounce 1000ms」不因此消失，它同時是 spec 的 FR-004 功能需求。

- Added principles:
  - IV. 規格驅動開發 (Spec-Driven Development) —— SDD 流程不可跳過。
  - V. 技術棧治理 (Technology Stack Governance) —— 前端／後端／資料庫／AI／認證／
    部署的技術選型納入憲章約束，/specify、/plan、/tasks 的產出不得任意替換。

- Renumbered principles:
  - V. 淺色系一致性與可及性 → VI（內容不變）

- Modified sections:
  - 公正性與安全要求 —— 憑證隔離擴及 Supabase service key 與 OAuth client secret。
  - 開發流程與品質關卡 —— 單一主幹直推制 → PR 制；合併前 MUST 通過 CI。
    此項反轉 v1.1.0 的變更，為本次列為 MAJOR 的第二個理由。
  - Governance —— 修訂程序與合規審查改回以 PR 為載體。

- Downstream impact: 本次修訂與現有實作有 6 處技術選型衝突（前端框架、後端語言、
  資料庫、AI 供應商與編排層、認證方式、CI 觸發條件），已於修訂報告中列出，
  待產品負責人決定「調整程式碼」或「修正憲章」。在該決定作出前，
  specs/001-candidate-portal/ 的既有產出與本憲章第 V 條處於已知衝突狀態。

- Deferred TODOs: none

Prior versions:
- 1.1.0 —— MINOR：擴充原則 V 的裝置範圍與比例夾制；開發流程由 PR 制改為 main 直推制。
- 1.0.0 —— 初次批准；五項原則與兩個附加章節首次定義。
-->

# TechInterview Pro Candidate Portal Constitution

## Core Principles

### I. AI 護欄不可妥協 (AI Guardrails, NON-NEGOTIABLE)

AI Co-Pilot 的定位是蘇格拉底式引導者，不是解題器。

- AI 回應 MUST NOT 包含可直接複製貼上、即可通過該題單元測試的完整解答實作。
- 每一條送往模型的請求 MUST 附帶系統層級圍欄 (System Prompt Guardrails)；圍欄
  內容 MUST 存在於版本控制中，MUST NOT 由前端可竄改的輸入組出。
- 圍欄 MUST 有自動化測試覆蓋：至少涵蓋「直接索取完整程式碼」「偽裝成除錯請求
  索取完整程式碼」兩類越獄輸入，斷言回應不含完整解法。
- 「輕度引導」與「深入討論」兩種模式 MAY 調整回覆詳細度，但兩者 MUST 同樣受上述
  圍欄約束；模式切換 MUST NOT 成為繞過圍欄的途徑。
- 圍欄 MUST 對所有 GenAI 供應商一致生效（見原則 V）；切換或並用不同模型
  MUST NOT 成為繞過圍欄的途徑。

**理由**：平台的評估效力完全建立在「AI 幫助思考、而非代寫」之上。一旦圍欄失效，
面試分數即失去意義，產品的核心價值歸零。

### II. Context 單一事實來源 (Single Source of Truth for Context)

題目區、作答區與 AI 側欄共用同一份會談狀態 (session state)。

- 當前題目、當前語言、當前草稿內容 MUST 由單一狀態來源持有，三個面板皆為其消費者。
- 跨組件動作（「詢問 AI 題目重點」「傳送至 AI 檢查」）MUST 從該狀態來源讀取 Context，
  MUST NOT 各自複製一份快照。
- 切換題目時 MUST 以系統訊息記錄於 AI Feed，使對話歷程可追溯到當時的題目脈絡。

**理由**：三面板聯動是本產品的差異點；狀態分散會造成 AI 針對舊題目或舊程式碼回覆，
這類錯誤對應試者不可見卻直接影響評分公正性。

### III. 互動邏輯測試先行 (Test-First for Interaction Logic)

計時、自動儲存、提交、圍欄、跨組件聯動屬於關鍵路徑。

- 上述關鍵路徑的每一項行為 MUST 先有失敗的測試，才寫實作 (Red-Green-Refactor)。
- 計時歸零強制提交、Debounce 儲存、防作弊事件記錄 MUST 有測試以假時鐘驗證邊界，
  MUST NOT 僅以手動點擊驗收。
- 純視覺樣式調整 MAY 免除單元測試，但仍 MUST 通過既有回歸測試。

**理由**：面試場景不可重來。一次計時錯誤或草稿遺失就是一位應試者的實質損害，
事後修復無法補償。

### IV. 規格驅動開發 (Spec-Driven Development, SDD)

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

### V. 技術棧治理 (Technology Stack Governance)

以下技術選型為本專案的治理決定。`/speckit-specify`、`/speckit-plan`、`/speckit-tasks`
的產出 MUST 遵守，MUST NOT 在未修訂本憲章的情況下替換為其他框架或服務。

**開發方法論**

- SDD 流程 MUST 遵守（見原則 IV）。

**前端**

- 框架 MUST 為 Next.js (React)。
- 語言 MUST 為 TypeScript；MUST NOT 新增未經型別檢查的 JavaScript 原始檔。
- 樣式 MUST 為 Tailwind CSS；設計 token MUST 集中於單一來源。
- UI 基礎元件 SHOULD 選用已處理焦點管理與 ARIA 的無頭元件庫，以滿足原則 VI。

**後端**

- 語言 MUST 為 Python；框架 MUST 為 FastAPI。
- 套件管理 MUST 使用 uv；虛擬環境 MUST 使用 venv。
- 相依版本 MUST 鎖定（lock file 進版控），MUST NOT 依賴未鎖定的浮動版本。

**資料庫**

- MUST 使用 Supabase 作為資料庫與持久化層。
- Schema 變更 MUST 以遷移檔管理並進版控，MUST NOT 僅於後台介面手動調整。
- Row Level Security SHOULD 啟用；凡以匿名金鑰可觸及的資料表 MUST 啟用。

**AI 整合**

- MUST 同時支援兩個 GenAI 供應商：Google Gemini 與 Anthropic Claude API。
- 所有模型呼叫與編排 MUST 透過 LangChain 進行；MUST NOT 於應用程式碼中
  直接裸接個別供應商的 SDK。
- 供應商的切換或組合 MUST 可透過設定完成，MUST NOT 需要改動業務邏輯。
- 原則 I 的圍欄 MUST 實作於 LangChain 的共用層，使其對所有供應商一致生效。

**認證**

- 使用者登入 MUST 採 Google Login (Google OAuth)。
- OAuth client secret MUST 僅存在於伺服端（見「公正性與安全要求」的憑證隔離）。

**部署與基礎設施**

- 應用程式 MUST 容器化 (Docker)；MUST 提供可重現的建置。
- 目標作業系統 MUST 為 Linux Ubuntu 24.04。
- CI/CD MUST 使用 GitHub Actions（流程規範見「開發流程與品質關卡」）。

**理由**：技術選型分散會讓每個 feature 的 plan 各自為政，最終得到一個沒有人能整體
維護的系統。把選型寫進憲章，是為了讓「要換技術」變成一次需要明講理由的修訂，
而不是某一份 plan.md 裡的一行決定。

### VI. 淺色系一致性與可及性 (Light-Theme Consistency & Accessibility)

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

- **防作弊監測**：全螢幕模式下 MUST 監聽 `blur` 與 `visibilitychange`；每次異常切換
  MUST 記錄時間戳與持續時間並提示應試者。記錄 MUST 為事實描述，MUST NOT 由前端自行
  判定作弊結論。
- **提交不可逆**：計時歸零 MUST 鎖定所有輸入並強制提交。強制提交 MUST 使用最後一次
  成功儲存的草稿，MUST NOT 因網路失敗而丟棄作答內容。
- **對話留存**：面試者與 AI 的完整對話 MUST 留存，供 Phase 4 評分後台檢視。
- **資料最小化**：前端 MUST 僅顯示必要的個人資訊（姓名與職稱）；其他個資 MUST NOT
  進入前端狀態或送入模型 Context。
- **憑證隔離**：下列憑證 MUST NOT 出現在前端程式碼或建置產物中——
  GenAI 供應商的 API 金鑰、Supabase 的 service role key、Google OAuth 的 client secret。
  CI MUST 有自動化檢查驗證建置產物不含上述憑證。

## 開發流程與品質關卡 (Development Workflow & Quality Gates)

- 所有變更 MUST 經 Pull Request；MUST NOT 直接推送至 `main`。
- PR MUST 通過 GitHub Actions 的 CI 檢查才能合併：測試套件、圍欄越獄測試、
  無障礙對比檢查。任一關卡失敗 MUST NOT 合併。
- PR 描述 MUST 聲明其涉及的原則並確認未違反。
- Roadmap 分期 MUST 被尊重：Phase 1 為前端體驗與模擬互動；真實沙盒執行 (Phase 3)
  與評分後台 (Phase 4) MUST NOT 提前混入 Phase 1 範圍，除非修訂本憲章。
- 任何違反本憲章的實作 MUST 在 PR 中明列理由與較簡單方案為何不可行；無理由者退回。

## Governance

本憲章優先於其他開發慣例。當文件、範本或口頭約定與本憲章衝突時，以本憲章為準。

- **修訂程序**：修訂 MUST 以獨立 PR 提出，內容包含變更理由、影響範圍與遷移方式，
  並取得產品負責人核可。技術選型（原則 V）的變更 MUST 一併說明既有實作的遷移計畫。
- **版本政策**：採語意化版本。MAJOR 為原則移除或不相容重新定義；MINOR 為新增原則或
  實質擴充指引；PATCH 為釐清、措辭與非語意修正。
- **合規審查**：每次 PR 審查 MUST 檢視合規性；每個 Phase 結束時 MUST 進行一次完整
  憲章對照審查，並將發現記錄於該 Phase 的回顧文件。
- **既有衝突的處理**：本憲章生效時若既有實作與原則 V 牴觸，該衝突 MUST 明確記錄，
  並 MUST 由產品負責人決定「調整程式碼」或「修正憲章」；MUST NOT 以沉默視為默許。
- **執行指引**：日常開發指引見 `docs/PRD.md` 與各 feature 的 `specs/` 目錄；
  兩者 MUST NOT 與本憲章牴觸。

**Version**: 2.0.0 | **Ratified**: 2026-08-04 | **Last Amended**: 2026-08-04
