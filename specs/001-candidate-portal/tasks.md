---
description: 'Task list for TechInterview Pro — Candidate Portal'
---

# Tasks: TechInterview Pro — Candidate Portal

**Input**: Design documents from `/specs/001-candidate-portal/`

**Prerequisites**: [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、
[data-model.md](./data-model.md)、[contracts/](./contracts/)

**Tests**: 含測試任務。憲章原則 III「互動邏輯測試先行」與原則 I「圍欄 MUST 有自動化測試
覆蓋」使測試成為強制項，非選配。計時、debounce 保存、提交、圍欄、跨面板聯動的測試 MUST 先寫且
先失敗，才寫實作。

**Organization**: 任務依 User Story 分組，每個 Story 可獨立實作、獨立測試、獨立交付。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行執行（不同檔案、無未完成相依）
- **[Story]**: 對應 spec.md 的 User Story（US1–US5）

## Path Conventions

Web app 雙套件配置：`frontend/src/`、`backend/src/`（見 plan.md 的 Structure Decision）。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 專案初始化與工具鏈

- [X] T001 建立 npm workspaces 根結構於 `package.json`（workspaces: frontend、backend）與 `.gitignore`
- [X] T002 [P] 初始化前端專案（Vite 6 + React 19 + TypeScript 5.7）於 `frontend/`
- [X] T003 [P] 初始化後端專案（Hono 4 + TypeScript + tsx）於 `backend/`
- [X] T004 [P] 設定 ESLint 與 Prettier 於 `eslint.config.js` 與 `.prettierrc`
- [X] T005 [P] 建立 Tailwind CSS 4 淺色主題 token（單一來源）於 `frontend/src/styles/theme.css`
- [X] T006 [P] 設定 Vitest 於 `frontend/vitest.config.ts` 與 `backend/vitest.config.ts`
- [X] T007 [P] 設定 Playwright 與 axe-core 於 `frontend/playwright.config.ts`
- [X] T008 [P] 建立 `backend/.env.example` 與型別安全的環境變數載入於 `backend/src/lib/env.ts`
- [X] T009 建立 CI 工作流於 `.github/workflows/ci.yml`，於**每次推送 `main`** 執行憲章三道關卡（測試套件、圍欄越獄測試、axe-core 檢核）＋編輯器延遲量測（原則 IV 的條件式要求，此處無條件執行）；並驗證前端建置產物不含 `GEMINI_API_KEY`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 所有 User Story 共用的資料層、授權與版面骨架

**⚠️ CRITICAL**: 本階段完成前，任何 User Story 不得開工

- [X] T010 建立 SQLite schema 遷移（InviteToken、InterviewSession、Question、SessionQuestion、Answer、ChatMessage、EnvironmentEvent、TestRun）於 `backend/src/db/migrations/001_init.sql`，依 [data-model.md](./data-model.md)
- [X] T011 實作遷移執行器與 `npm run db:migrate` 於 `backend/src/db/migrate.ts`
- [X] T012 [P] 實作資料存取層於 `backend/src/db/queries.ts`
- [X] T013 [P] 定義共用 Zod schema 與型別於 `backend/src/lib/schemas.ts`
- [X] T014 [P] 定義錯誤碼與 HTTP 映射（見 [contracts/http-api.md](./contracts/http-api.md#錯誤格式全端點共用)）於 `backend/src/lib/errors.ts`
- [X] T015 [P] 撰寫場次狀態機的失敗測試（`not_started → in_progress → submitted / expired_submitted`，終態不可逆）於 `backend/tests/unit/session-state.test.ts`
- [X] T016 實作場次狀態機於 `backend/src/domain/session-state.ts`
- [X] T017 [P] 撰寫邀請 token 兌換的契約測試（首次兌換、重複兌換不重置 deadline、逾期、已提交）於 `backend/tests/contract/redeem.test.ts`
- [X] T018 實作 token 驗證與 session cookie 換發於 `backend/src/lib/auth.ts`
- [X] T019 實作 `POST /api/session/redeem` 與 `GET /api/session` 於 `backend/src/routes/session.ts`（`predefinedTests` 內容不得外洩）
- [X] T020 實作 seed 腳本（3 題示範：API 限流器 / LRU 快取 / 訊息佇列，含各語言 starter code 與 quickPrompts）於 `backend/src/db/seed.ts`
- [X] T021 [P] 建立單一 session store 於 `frontend/src/store/session.ts`（欄位見 [data-model.md](./data-model.md#前端狀態切片單一事實來源)）
- [X] T022 [P] 建立衍生值 selectors（`currentQuestion`、`currentAnswer`、`remainingSec`、`isReadOnly`）於 `frontend/src/store/selectors.ts`
- [X] T023 [P] 建立 API client 與錯誤映射於 `frontend/src/services/api.ts`
- [X] T024 實作路由 `/s/:token` 與場次載入流程於 `frontend/src/app/routes.tsx`
- [X] T025 實作三面板版面骨架（CSS grid，左右比例鎖定 6:4–7:5）於 `frontend/src/app/AppLayout.tsx`，依 [contracts/ui-contracts.md](./contracts/ui-contracts.md#版面契約)

**Checkpoint**: 可用邀請連結進入空白三面板 — User Story 實作可開始

---

## Phase 3: User Story 1 — 多題作答與草稿保全 (Priority: P1) 🎯 MVP

**Goal**: 應試者能閱讀題目、選語言、寫程式碼、自動保存草稿、跨題切換不遺失、重整後完整還原。

**Independent Test**: 不接任何 AI 功能，寫完三題、切換頁籤、重新載入頁面，內容 100% 還原。

### Tests for User Story 1 ⚠️ 先寫，先失敗

- [X] T026 [P] [US1] 撰寫 debounce 保存的失敗測試（fake timers：連續輸入 3 秒僅產生 1 次請求）於 `frontend/tests/unit/persistence.test.ts`
- [X] T027 [P] [US1] 撰寫離線佇列的失敗測試（離線累積、恢復連線依 revision 排序補送）於 `frontend/tests/unit/offline-queue.test.ts`
- [X] T028 [P] [US1] 撰寫草稿保存的契約測試（revision 遞增、`REVISION_STALE`、`CONTENT_TOO_LARGE`、場次終態拒寫）於 `backend/tests/contract/answers.test.ts`
- [X] T029 [P] [US1] 撰寫保存狀態指示的元件測試（idle/saving/saved/error 四態文字與 aria-live）於 `frontend/tests/component/save-indicator.test.tsx`
- [X] T030 [P] [US1] 撰寫題目切換保留內容的元件測試於 `frontend/tests/component/question-tabs.test.tsx`
- [X] T031 [P] [US1] 撰寫端到端草稿保全情境於 `frontend/tests/e2e/draft-persistence.spec.ts`（對應 quickstart V1）

### Implementation for User Story 1

- [X] T032 [US1] 實作 `PUT /api/answers/:questionId` 與批次 `PUT /api/answers` 於 `backend/src/routes/answers.ts`
- [X] T033 [P] [US1] 實作 `POST /api/tests/:questionId`（回報預定義結果，不執行任何用戶端程式碼）於 `backend/src/routes/tests.ts`
- [X] T034 [P] [US1] 封裝 CodeMirror 6 編輯器（value/onChange/language/readOnly 介面，含行號、語法高亮、Tab 縮排）於 `frontend/src/components/workspace/CodeEditor.tsx`
- [X] T035 [US1] 實作 debounce 1000ms 保存與 IndexedDB 離線佇列於 `frontend/src/store/persistence.ts`
- [X] T036 [P] [US1] 實作連線狀態偵測與 `connectivity` 狀態更新於 `frontend/src/services/connectivity.ts`
- [X] T037 [P] [US1] 實作語言選單與「是否以新語言 starter code 取代」確認對話框於 `frontend/src/components/workspace/LanguageSelect.tsx`
- [X] T038 [P] [US1] 實作保存狀態指示於 `frontend/src/components/workspace/SaveIndicator.tsx`
- [X] T039 [P] [US1] 實作程式碼格式化（JS/TS 用 Prettier standalone；Python/Go 用縮排正規化；失敗時 Toast 提示且不破壞內容）於 `frontend/src/lib/format-code.ts`
- [X] T040 [US1] 組裝作答區（語言選單、保存狀態、格式化、編輯器、控制台、執行測試按鈕）於 `frontend/src/components/workspace/AnswerWorkspace.tsx`
- [X] T041 [P] [US1] 實作題目頁籤與難度／配分標籤於 `frontend/src/components/question/QuestionTabs.tsx`
- [X] T042 [P] [US1] 實作題目內容呈現（描述、範例 Input/Output、複雜度要求、評分重點）於 `frontend/src/components/question/QuestionContent.tsx`
- [X] T043 [US1] 實作切換題目時同步載入該題 starter code 或既有草稿於 `frontend/src/store/session.ts`
- [X] T044 [P] [US1] 實作測試結果 Toast（✅ 通過 5/5 個測試案例）於 `frontend/src/components/workspace/TestConsole.tsx`

**Checkpoint**: US1 可獨立驗證 — 作答、保存、切題、重整還原全數運作，無需 AI 功能

---

## Phase 4: User Story 2 — AI 引導提問與護欄 (Priority: P2)

**Goal**: 應試者能與 AI 對話取得思路提示，AI 在任何模式下都不輸出可直接使用的完整解答。

**Independent Test**: 以固定題目與程式碼為輸入，測試送出、串流、模式切換與越獄拒絕。

### Tests for User Story 2 ⚠️ 先寫，先失敗

- [ ] T045 [P] [US2] 建立越獄語料（≥20 組：直接索取、偽裝除錯、角色扮演、分段索取、翻譯繞道）於 `backend/tests/guardrails/fixtures/jailbreak-prompts.json`
- [ ] T046 [P] [US2] 撰寫圍欄後處理的失敗測試（完整函式／類別偵測、長度門檻、攔截後改寫）於 `backend/tests/guardrails/postprocess.test.ts`
- [ ] T047 [P] [US2] 撰寫兩種引導模式皆受圍欄約束的測試於 `backend/tests/guardrails/modes.test.ts`
- [ ] T048 [P] [US2] 撰寫 `POST /api/chat` 與 SSE 串流的契約測試（token/done/error 事件）於 `backend/tests/contract/chat.test.ts`
- [ ] T049 [P] [US2] 撰寫對話 Feed 串流呈現與送出按鈕忙碌態的元件測試於 `frontend/tests/component/chat-feed.test.tsx`
- [ ] T050 [P] [US2] 撰寫端到端 AI 引導情境於 `frontend/tests/e2e/ai-guidance.spec.ts`（對應 quickstart V2）

### Implementation for User Story 2

- [ ] T051 [US2] 撰寫 System Prompt 圍欄常數（固定圍欄段落 + 可變 verbosity 段落）於 `backend/src/ai/guardrails.ts`
- [ ] T052 [US2] 實作 Gemini 呼叫與串流於 `backend/src/ai/gemini.ts`（金鑰僅由 `env.ts` 取得，前端輸入一律作為 user turn）
- [ ] T053 [US2] 實作輸出後處理攔截層（命中則以引導式訊息取代並記錄 `guardrailTriggered`）於 `backend/src/ai/postprocess.ts`
- [ ] T054 [US2] 實作 `POST /api/chat` 與 `GET /api/chat/stream/:streamId` 於 `backend/src/routes/chat.ts`
- [ ] T055 [P] [US2] 實作 `PATCH /api/session/guidance-mode` 於 `backend/src/routes/session.ts`
- [ ] T056 [US2] 實作 ChatMessage 持久化（含 `attachedCode`、`guidanceMode`、`guardrailTriggered`）於 `backend/src/db/queries.ts`
- [ ] T057 [P] [US2] 實作 SSE 用戶端與批次套用 token（避免每 token 全域更新）於 `frontend/src/services/chat-stream.ts`
- [ ] T058 [P] [US2] 實作對話 Feed（candidate／assistant／system 三種呈現）於 `frontend/src/components/copilot/ChatFeed.tsx`
- [ ] T059 [P] [US2] 實作輸入區（多行、Ctrl+Enter 送出、附帶程式碼按鈕、語音輸入佔位圖示）於 `frontend/src/components/copilot/Composer.tsx`
- [ ] T060 [P] [US2] 實作引導模式切換分段控制項於 `frontend/src/components/copilot/ModeToggle.tsx`
- [ ] T061 [P] [US2] 實作 AI 使用規範長駐 Banner 於 `frontend/src/components/copilot/GuardrailBanner.tsx`
- [ ] T073 [P] [US2] 實作隨當前題目變動的快捷提問 Chips 於 `frontend/src/components/copilot/QuickPromptChips.tsx`（US2 驗收情境 5 / FR-013 所需，故置於本階段；ID 沿用不重編）
- [ ] T062 [US2] 組裝 AI 側欄並處理 `AI_UNAVAILABLE` 錯誤與重試（不影響作答內容）於 `frontend/src/components/copilot/CopilotPanel.tsx`

**Checkpoint**: US1 與 US2 各自獨立運作 — 可作答、可對話、圍欄測試全綠

---

## Phase 5: User Story 3 — 跨面板 Context 聯動 (Priority: P2)

**Goal**: 題目區與作答區的動作能把正確的 Context 帶入 AI 側欄，In-Context 狀態始終正確。

**Independent Test**: 在已有題目與程式碼的狀態下點擊兩個聯動按鈕，驗證送出的 Context
對應當前題目與當前程式碼。

### Tests for User Story 3 ⚠️ 先寫，先失敗

- [ ] T063 [P] [US3] 撰寫 `flushPendingSave()` 的失敗測試（未保存變更先落地才送出）於 `frontend/tests/unit/flush-pending-save.test.ts`
- [ ] T064 [P] [US3] 撰寫聯動送出 Context 正確性的元件測試（停留 Q2 時送出的 questionId 為 Q2）於 `frontend/tests/component/cross-panel.test.tsx`
- [ ] T065 [P] [US3] 撰寫 `POST /api/chat/system` 的契約測試於 `backend/tests/contract/chat-system.test.ts`
- [ ] T066 [P] [US3] 撰寫端到端聯動情境於 `frontend/tests/e2e/cross-panel-context.spec.ts`（對應 quickstart V3）

### Implementation for User Story 3

- [ ] T067 [US3] 實作 `flushPendingSave()` 於 `frontend/src/store/persistence.ts`
- [ ] T068 [P] [US3] 實作 `POST /api/chat/system`（題目切換系統訊息）於 `backend/src/routes/chat.ts`
- [ ] T069 [US3] 實作切換題目動作序列（flush → setCurrentQuestion → 系統訊息 → 面板同步）於 `frontend/src/store/session.ts`，依 [contracts/ui-contracts.md](./contracts/ui-contracts.md#a-01-切換題目)
- [ ] T070 [P] [US3] 實作「詢問 AI 題目重點」按鈕於 `frontend/src/components/question/AskAiButton.tsx`
- [ ] T071 [P] [US3] 實作「傳送至 AI 側邊欄」按鈕（先 flush 再送出，訊息標示已附帶程式碼）於 `frontend/src/components/workspace/SendToAiButton.tsx`；離線導致 flush 失敗時 MUST 阻擋送出並提示「目前離線，程式碼尚未同步」，MUST NOT 以較舊的伺服端草稿充當附帶 Context
- [ ] T072 [P] [US3] 實作 In-Context 狀態列（訂閱 `currentQuestion`，不接受傳參）於 `frontend/src/components/copilot/StatusBar.tsx`

**Checkpoint**: 三面板完全聯動，Context 正確率可驗證

---

## Phase 6: User Story 4 — 計時與提交 (Priority: P2)

**Goal**: 倒數計時正確、警示及時、手動提交有確認、歸零強制提交且不遺失內容。

**Independent Test**: 以可控時鐘注入不同剩餘時間，驗證警示、確認框、強制提交與輸入鎖定。

### Tests for User Story 4 ⚠️ 先寫，先失敗

- [ ] T074 [P] [US4] 撰寫計時顯示與 5 分警示的失敗測試（fake timers，含 aria-live 宣告一次）於 `frontend/tests/unit/timer.test.ts`
- [ ] T075 [P] [US4] 撰寫時鐘校時與漂移修正的失敗測試於 `frontend/tests/unit/clock-sync.test.ts`
- [ ] T076 [P] [US4] 撰寫提交契約測試（冪等、取最後保存草稿、終態拒寫、逾時由 `GET /api/time` 觸發）於 `backend/tests/contract/submission.test.ts`
- [ ] T077 [P] [US4] 撰寫提交確認對話框（取消不提交）的元件測試於 `frontend/tests/component/submit-dialog.test.tsx`
- [ ] T078 [P] [US4] 撰寫端到端計時與強制提交情境於 `frontend/tests/e2e/timer-submission.spec.ts`（對應 quickstart V4）

### Implementation for User Story 4

- [ ] T079 [US4] 實作 `deadlineAt` 計算與 `GET /api/time`（逾期時主動觸發強制提交）於 `backend/src/routes/time.ts`
- [ ] T080 [US4] 實作 `POST /api/submit`（冪等、取每題最新 `savedAt` 草稿）於 `backend/src/routes/submit.ts`
- [ ] T081 [P] [US4] 實作計時 hook（本地每秒遞減 + 每 30 秒校時）於 `frontend/src/lib/use-countdown.ts`
- [ ] T082 [P] [US4] 實作倒數計時器元件（一般／警示／鎖定三態）於 `frontend/src/components/header/CountdownTimer.tsx`
- [ ] T083 [P] [US4] 實作提交確認對話框（Radix Dialog）與提交成功提示（FR-021，同時具備視覺與可存取名稱）於 `frontend/src/components/header/SubmitDialog.tsx`
- [ ] T084 [US4] 實作 `isReadOnly` 鎖定（所有輸入、按鈕、Composer 轉唯讀）於 `frontend/src/store/selectors.ts` 與相關元件
- [ ] T085 [US4] 實作歸零強制提交流程（中止進行中的 SSE 串流、鎖定、提交）於 `frontend/src/store/session.ts`
- [ ] T086 [US4] 實作提交失敗的持續重試與內容保留於 `frontend/src/services/api.ts`
- [ ] T087 [P] [US4] 實作 Header 的品牌標識、職稱與應試者姓名於 `frontend/src/components/header/AppHeader.tsx`

**Checkpoint**: 場次生命週期完整 — 進入、作答、提交、逾時皆正確

---

## Phase 7: User Story 5 — 全螢幕與作答環境監測 (Priority: P3)

**Goal**: 全螢幕切換狀態同步，離開作答視窗被客觀記錄並提醒應試者。

**Independent Test**: 以程式觸發 focus/visibility 事件，驗證提醒與記錄內容。

### Tests for User Story 5 ⚠️ 先寫，先失敗

- [ ] T088 [P] [US5] 撰寫 `fullscreenchange` 狀態同步的失敗測試（含 Esc 退出）於 `frontend/tests/unit/fullscreen.test.ts`
- [ ] T089 [P] [US5] 撰寫環境事件門檻的失敗測試（< 1000ms 不記錄；非全螢幕狀態下不記錄）於 `frontend/tests/unit/environment-events.test.ts`
- [ ] T090 [P] [US5] 撰寫 `POST /api/events` 的契約測試（批次、伺服端二次過濾）於 `backend/tests/contract/events.test.ts`
- [ ] T091 [P] [US5] 撰寫端到端環境監測情境於 `frontend/tests/e2e/environment-monitoring.spec.ts`（對應 quickstart V5）

### Implementation for User Story 5

- [ ] T092 [P] [US5] 實作 `POST /api/events`（僅記錄客觀事實，無判定欄位）於 `backend/src/routes/events.ts`
- [ ] T093 [P] [US5] 實作全螢幕 hook（監聽 `fullscreenchange` 同步按鈕與圖示）於 `frontend/src/lib/use-fullscreen.ts`
- [ ] T094 [P] [US5] 實作 blur／visibilitychange 偵測與 1000ms 門檻於 `frontend/src/services/environment-monitor.ts`；監聽 MUST 僅於全螢幕狀態啟用，退出全螢幕時解除（憲章「防作弊監測」與 FR-025）
- [ ] T095 [US5] 實作全螢幕按鈕與返回提醒 Toast 於 `frontend/src/components/header/FullscreenToggle.tsx`
- [ ] T096 [US5] 將環境事件併入離線佇列補送機制於 `frontend/src/store/persistence.ts`

**Checkpoint**: 全部 User Story 獨立可用

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 跨 Story 的邊界情境、品質關卡與文件

- [ ] T097 [P] 撰寫個資最小化斷言測試（FR-032：`GET /api/session` 回應與前端 store 快照皆僅含 `candidateName`、`positionTitle`，不含其他個資欄位）於 `backend/tests/contract/pii-minimization.test.ts`
- [ ] T098 [P] 實作左右／上下比例拖曳與本機偏好保存於 `frontend/src/components/layout/ResizableSplit.tsx`；左右比例的拖曳範圍與偏好還原 MUST 夾制於 6:4–7:5（憲章原則 V），超出範圍的既存偏好值須夾回邊界，並附邊界單元測試
- [ ] T099 [P] 實作全域鍵盤快捷鍵（Ctrl+S 立即保存、Esc、Ctrl+Enter）與可見說明面板於 `frontend/src/components/KeyboardHelp.tsx`
- [ ] T100 [P] 實作離開前未保存變更提示（`beforeunload`）於 `frontend/src/app/AppLayout.tsx`
- [ ] T101 [P] 實作多分頁同場次偵測（BroadcastChannel，避免草稿互相覆蓋）於 `frontend/src/services/tab-guard.ts`
- [ ] T102 [P] 實作超長貼上內容處理（256 KB 上限提示，編輯器維持可用）於 `frontend/src/components/workspace/CodeEditor.tsx`
- [ ] T103 [P] 實作題目載入失敗與連結失效的狀態畫面於 `frontend/src/app/ErrorStates.tsx`
- [ ] T104 [P] 建立編輯器延遲量測腳本（500 次輸入 p50/p95/p99，預算 50ms）與進入場次到首次可輸入的耗時量測（SC-001，預算 30 秒）於 `frontend/tests/perf/editor-latency.spec.ts`
- [ ] T105 [P] 建立 axe-core 對比與 ARIA 全頁檢核於 `frontend/tests/e2e/a11y.spec.ts`
- [ ] T106 [P] 撰寫圍欄的真實模型排程測試（`test:guardrails:live`）於 `backend/tests/guardrails/live.test.ts`
- [ ] T107 [P] 撰寫 README（安裝、啟動、環境變數、品質關卡）於 `README.md`
- [ ] T108 依 [quickstart.md](./quickstart.md) 完整走過 V1–V5 五個驗證情境並記錄結果

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：無相依，可立即開始
- **Foundational (Phase 2)**：相依 Setup — **阻擋所有 User Story**
- **User Stories (Phase 3–7)**：皆相依 Foundational
  - 人力足夠時可平行；否則依 P1 → P2 → P3 順序
- **Polish (Phase 8)**：相依所有欲交付的 Story

### User Story Dependencies

- **US1 (P1)**：Foundational 完成後即可開始，不相依其他 Story
- **US2 (P2)**：Foundational 完成後即可開始，不相依 US1（以固定題目與程式碼作為測試輸入）
- **US3 (P2)**：功能上整合 US1 與 US2 的既有元件；若平行開發，需 US1 的 `persistence.ts`
  與 US2 的 `POST /api/chat` 就緒才能完成整合任務（T069、T071）
- **US4 (P2)**：Foundational 完成後即可開始；T085 的「中止進行中串流」需 US2 就緒
- **US5 (P3)**：完全獨立，可與任何 Story 平行

### Within Each User Story

- 測試先寫且先失敗（憲章原則 III），才進實作
- 後端：schema → queries → domain → routes
- 前端：store → services → 元件 → 組裝
- Story 完成並通過 Independent Test，才進下一優先序

### Parallel Opportunities

- Phase 1 中 T002–T008 全部可平行
- Phase 2 中 T012–T014、T021–T023 各自可平行
- Foundational 完成後，US1／US2／US4／US5 可由不同人同時進行
- 各 Story 內標記 [P] 的測試可全部平行撰寫
- Phase 8 除 T108 外全部可平行

---

## Parallel Example: User Story 1

```bash
# 先平行寫完所有測試（必須先失敗）：
Task: "debounce 保存測試 in frontend/tests/unit/persistence.test.ts"
Task: "離線佇列測試 in frontend/tests/unit/offline-queue.test.ts"
Task: "草稿保存契約測試 in backend/tests/contract/answers.test.ts"
Task: "保存狀態指示元件測試 in frontend/tests/component/save-indicator.test.tsx"
Task: "題目切換保留內容測試 in frontend/tests/component/question-tabs.test.tsx"
Task: "端到端草稿保全 in frontend/tests/e2e/draft-persistence.spec.ts"

# 再平行做獨立實作：
Task: "CodeEditor 封裝 in frontend/src/components/workspace/CodeEditor.tsx"
Task: "語言選單 in frontend/src/components/workspace/LanguageSelect.tsx"
Task: "保存狀態指示 in frontend/src/components/workspace/SaveIndicator.tsx"
Task: "程式碼格式化 in frontend/src/lib/format-code.ts"
Task: "題目頁籤 in frontend/src/components/question/QuestionTabs.tsx"
Task: "題目內容 in frontend/src/components/question/QuestionContent.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1：Setup
2. 完成 Phase 2：Foundational（**關鍵路徑，阻擋一切**）
3. 完成 Phase 3：US1
4. **停下來驗證**：跑 quickstart V1，確認作答與草稿保全獨立可用
5. 此時已可對外展示一個可用的作答平台（無 AI）

### Incremental Delivery

1. Setup + Foundational → 地基就緒
2. - US1 → 驗證 → 展示（**MVP**）
3. - US2 → 驗證圍欄零穿透 → 展示（產品差異化成形）
4. - US3 → 驗證 Context 正確率 → 展示（體驗完整）
5. - US4 → 驗證計時與強制提交 → 可進行真實場次
6. - US5 → 驗證環境監測 → 公正性完備

### Parallel Team Strategy

三人團隊，Foundational 完成後：

- 開發者 A：US1 → US3（作答與聯動主線）
- 開發者 B：US2（AI 與圍欄，含越獄語料）
- 開發者 C：US4 → US5（場次生命週期與監測）

US3 的整合任務（T069、T071）需等 A 與 B 的前置就緒，其餘皆可獨立推進。

---

## Notes

- [P] = 不同檔案、無相依
- 測試在本專案為強制項：憲章原則 I 與 III 明定，非選配
- 採單一主幹開發，直接 commit 並推送 `main`（憲章 v1.1.0）；每完成一個任務或一組邏輯變更即 commit，提交訊息聲明涉及的原則
- 任何 checkpoint 皆可停下來獨立驗證該 Story
- 觸及編輯器輸入路徑的變更，提交訊息 MUST 附上 T104 的延遲量測數據（憲章原則 IV）
- 本期僅支援桌機螢幕（最小視窗寬度 1280px），不含行動裝置或窄視窗的響應式版面
- 任務 ID 於規格修訂後保持穩定，故階段內編號未必連續（例：T073 已移至 Phase 4）
