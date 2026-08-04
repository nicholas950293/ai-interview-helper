<!--
Sync Impact Report
- Version change: (template, unversioned) → 1.0.0
- Bump rationale: MAJOR — initial ratification; all five principles and both
  additional sections defined for the first time.
- Modified principles: none (initial definition)
- Added sections:
  - Core Principles I–V
  - 公正性與安全要求 (Fairness & Security Requirements)
  - 開發流程與品質關卡 (Development Workflow & Quality Gates)
  - Governance
- Removed sections: none
- Templates requiring review: .specify/templates/plan-template.md,
  spec-template.md, tasks-template.md read this file at runtime; no edits made here.
- Deferred TODOs: none
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

### IV. 效能預算即需求 (Performance Budgets Are Requirements)

- 編輯器按鍵到畫面更新的延遲 MUST < 50ms (p95，於目標裝置量測)。
- 草稿儲存 MUST 採 Debounce 1000ms；MUST NOT 逐次按鍵送出請求。
- 任何 PR 若觸及編輯器輸入路徑，MUST 附上延遲量測數據或說明為何不受影響。
- 超出預算的變更 MUST 在 PR 中記錄理由並取得明確核可，MUST NOT 默默合併。

**理由**：延遲會被應試者感知為「平台很卡」，在計時壓力下直接損害作答表現與品牌信任。

### V. 淺色系一致性與可及性 (Light-Theme Consistency & Accessibility)

- UI MUST 維持柔和淺色系 (Clean Light Theme) 與三卡片浮動式版面；左側與右側
  比例 MUST 維持在 6:4 至 7:5 之間。
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
- **憑證隔離**：模型 API 金鑰 MUST NOT 出現在前端程式碼或 bundle 中。

## 開發流程與品質關卡 (Development Workflow & Quality Gates)

- 所有變更 MUST 經 PR；PR MUST 聲明其涉及的原則並確認未違反。
- 合併前 MUST 通過：測試套件、圍欄越獄測試、無障礙對比檢查。
- Roadmap 分期 MUST 被尊重：Phase 1 為前端體驗與模擬互動；真實沙盒執行 (Phase 3)
  與評分後台 (Phase 4) MUST NOT 提前混入 Phase 1 範圍，除非修訂本憲章。
- 任何違反本憲章的實作 MUST 在 PR 中明列理由與較簡單方案為何不可行；無理由者退回。

## Governance

本憲章優先於其他開發慣例。當文件、範本或口頭約定與本憲章衝突時，以本憲章為準。

- **修訂程序**：修訂 MUST 以 PR 提出，內容包含變更理由、影響範圍與遷移方式，
  並取得產品負責人與技術負責人雙方核可。
- **版本政策**：採語意化版本。MAJOR 為原則移除或不相容重新定義；MINOR 為新增原則或
  實質擴充指引；PATCH 為釐清、措辭與非語意修正。
- **合規審查**：每次 PR 審查 MUST 檢視合規性；每個 Phase 結束時 MUST 進行一次完整
  憲章對照審查，並將發現記錄於該 Phase 的回顧文件。
- **執行指引**：日常開發指引見 `docs/PRD.md` 與各 feature 的 `specs/` 目錄；
  兩者 MUST NOT 與本憲章牴觸。

**Version**: 1.0.0 | **Ratified**: 2026-08-04 | **Last Amended**: 2026-08-04
