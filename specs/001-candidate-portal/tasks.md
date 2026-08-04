---
description: 'Task list for TechInterview Pro — Candidate Portal (Constitution v3.0.2)'
---

# Tasks: TechInterview Pro — Candidate Portal

**Input**: Design documents from `/specs/001-candidate-portal/`

**Prerequisites**: [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、
[data-model.md](./data-model.md)、[contracts/](./contracts/)

**Constitution**: v3.0.2

**Tests**: 含測試任務，且為**強制項**。憲章原則 III「互動邏輯測試先行」與原則 I
「上述記錄 MUST 有自動化測試覆蓋」使測試不可略過。計時、debounce 保存、提交、
**AI 產出的套用與作者歸屬**、跨面板聯動的測試 MUST 先寫且先失敗，才寫實作。

**Organization**: 任務依 User Story 分組，每個 Story 可獨立實作、獨立測試、獨立交付。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行執行（不同檔案、無未完成相依）
- **[Story]**: 對應 spec.md 的 User Story（US1–US5）

## Path Conventions

雙套件配置，套件管理器各自獨立（憲章原則 V）：

- `frontend/` —— Next.js 16 + TypeScript + Tailwind，npm 管理
- `backend/` —— Python 3.12 + FastAPI，uv 管理
- `supabase/migrations/` —— schema 遷移
- `docker/` —— 容器化

---

## 遷移對照（plan.md 的 M1–M7）

本清單同時是一份遷移清單。plan.md 的階段與本清單的對應：

| plan | 內容 | 對應任務 | Increment 1 |
| --- | --- | --- | --- |
| M1 | Python + FastAPI 重建端點 | Phase 1–2 的後端任務 + 各 Story 的後端任務 | ✅ 全部 |
| M2 | SQLite → Supabase | T014–T019 | ✅ 完成 |
| M3 | 拆除圍欄，改用 LangChain 雙供應商 | T061–T063、T119 | ✅ 完成（舊資產已於後續增量拆除） |
| M4 | 程式碼變更歸屬與套用 | T055–T057、T064–T067、T071–T072 | ✅ 完成（後端與前端套用 UI 皆已上線） |
| M5 | Vite SPA → Next.js | T007–T011、各 Story 的前端任務 | ✅ 完成 |
| M6 | Docker 化 | T120 | ✅ 完成 |
| M7 | CI 改為 PR 制 | T013、T121 | ✅ 完成 |

**與 plan.md 的一處偏離**：plan 的 M1 原本要「以既有 Vite 前端零改動驗證新後端等價」。
本清單於 T007 就地把 `frontend/` 改為 Next.js，該驗證方式看似不可行。
**實際執行順序讓兩者都成立**：Increment 1 先只做 M1，Vite 前端僅改端點名稱（T124）
即跑通全部 e2e，等價性因此有直接證據；M5 才把該前端遷至 Next.js，
此時 33 個 e2e、7 個 a11y、2 個 perf 測試**一行未改**全數通過——
遷移沒有動到任何行為，這是比逐條對照更強的證據。

---

## 本次增量（Increment 1）—— 只做後端移植

產品負責人 2026-08-04 裁決：本次只做 plan.md 的 M1，其餘維持現狀並保留於憲章落差表。
詳見 [plan.md 的「本次增量範圍」](./plan.md#本次增量範圍increment-1-產品負責人-2026-08-04-裁決)。

**本次要做的任務**（其餘任務保留於本檔，待後續增量）：

| 範圍 | 任務 |
| --- | --- |
| 後端工具鏈 | T001–T005 |
| 資料層與授權 | T018–T027。**本次以 SQLite 實作**（T014–T017 的 Supabase 遷移延後）；`db/client.py` 與 `db/queries.py` 的介面 MUST 設計為可抽換，後續增量替換為 Supabase 時不動呼叫端 |
| 作答與測試端點 | T034、T040、T041 |
| AI 層（拆圍欄、改 LangChain） | T053、T054、T058、T061–T065 |
| **套用與作者歸屬** | T055–T057、T066、T067、T068 —— 含 `chat_code_block` 與 `code_change` 兩張表（SQLite 版，含 CHECK 約束） |
| 聯動、計時、提交、事件端點 | T082、T089、T092、T093、T103、T105 |
| 前端最小調整 | T124 |

**為什麼套用與歸屬不能延後**：`/speckit-analyze` 指出（C1），若排除它們，
本次交付的後端會有 AI 完整輸出、卻沒有套用途徑也沒有作者歸屬——
憲章原則 I（NON-NEGOTIABLE）的兩條 MUST 同時落空。
這些**全是後端工作**，由 T055–T057 的契約測試即可完整驗收，不需要前端 UI；
UI 只是這些端點的消費者，延後的是 UI 不是能力。

**本次明確不做**：T006–T013（Supabase CLI / Next.js / Playwright / PR 制 CI）、
T014–T017（Supabase 遷移）、T028–T033 與各 Story 的前端任務（T124 除外）、
T069–T077 / T084–T086 / T094–T100 / T106–T109（前端元件）、
T110–T123（Polish，含 Docker 與舊資產拆除）。

**唯一不可延後的項目**：圍欄拆除。憲章原則 I 禁止輸出限制層，
把 `guardrails.ts` / `postprocess.ts` 照樣移植到 Python 等於主動實作違憲的東西。
因此本次的 AI 層直接以 LangChain 重建，不含任何輸出攔截。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 建立新技術棧的工具鏈（憲章原則 V）

- [X] T001 建立 uv 專案於 `backend/pyproject.toml`、`backend/.python-version`（3.12），產生 `backend/uv.lock` 並進版控（憲章：相依版本 MUST 鎖定）
- [X] T002 [P] 建立 FastAPI 應用骨架與 `GET /api/health` 於 `backend/src/techinterview/main.py`
- [X] T003 [P] 以 pydantic-settings 定義環境設定於 `backend/src/techinterview/core/config.py`，並建立 `backend/.env.example`（Supabase URL / service role key、SESSION_SECRET、GOOGLE_API_KEY、ANTHROPIC_API_KEY、AI_PROVIDER、AI_MODEL）
- [X] T004 [P] 設定 pytest + pytest-asyncio + httpx `ASGITransport` 於 `backend/pyproject.toml` 與 `backend/tests/conftest.py`（見 [research.md](./research.md) R-016）
- [X] T005 [P] 設定 ruff（lint + format）於 `backend/pyproject.toml`
- [X] T006 初始化 Supabase 本地實例於 `supabase/config.toml`，確認 `supabase start` 可運作
- [X] T007 於 `frontend/` 就地初始化 Next.js 16（App Router + TypeScript + Tailwind CSS 4），移除 Vite 相關設定
- [X] T008 [P] 移植淺色主題 token 至 `frontend/src/styles/theme.css`（Tailwind 4 `@theme`），保留 WCAG AA 實測對比值註記
- [X] T009 [P] 設定 `rewrites` 將 `/api/*` 代理至 FastAPI 於 `frontend/next.config.ts`（見 research R-003）
- [X] T010 [P] 設定 Vitest（jsdom + React Testing Library）於 `frontend/vitest.config.ts` 與 `frontend/tests/setup.ts`
- [X] T011 [P] 設定 Playwright 三個 project（e2e / a11y / perf）於 `frontend/playwright.config.ts`
- [X] T012 [P] 設定 ESLint 9 + Prettier 於 `eslint.config.js`，含「前端不得讀取金鑰」規則，涵蓋 `GOOGLE_API_KEY`、`ANTHROPIC_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`
- [X] T013 建立 CI 工作流骨架於 `.github/workflows/ci.yml`，**觸發條件為 `pull_request`**（憲章：所有變更 MUST 經 PR）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 所有 User Story 共用的資料層、授權與版面骨架

**⚠️ CRITICAL**: 本階段完成前，任何 User Story 不得開工

- [X] T014 Supabase 遷移：`invite_token`、`interview_session`、`question`、`session_question`、`answer` 於 `supabase/migrations/0001_core.sql`，依 [data-model.md](./data-model.md)
- [X] T015 Supabase 遷移：`chat_message`、`chat_code_block`、`code_change` 於 `supabase/migrations/0002_collaboration.sql`，**含 CHECK 約束強制 `source='ai'` 時必有 `chat_message_id` + `block_index`、`'candidate'` 時必為 null**（憲章原則 I）
- [X] T016 [P] Supabase 遷移：`environment_event`、`test_run` 於 `supabase/migrations/0003_events.sql`
- [X] T017 [P] RLS deny-all 政策（僅 service role 可存取）於 `supabase/migrations/0004_rls.sql`，依 research R-004
- [X] T018 Supabase client 與交易輔助於 `backend/src/techinterview/db/client.py`
- [X] T019 [P] 資料存取層於 `backend/src/techinterview/db/queries.py`
- [X] T020 [P] Pydantic schema（`camelCase` alias、Language / SessionStatus / CollaborationMode 等列舉）於 `backend/src/techinterview/core/schemas.py`
- [X] T021 [P] 錯誤碼與 HTTP 映射（見 [contracts/http-api.md](./contracts/http-api.md#錯誤格式全端點共用)）於 `backend/src/techinterview/core/errors.py`
- [X] T022 [P] 撰寫場次狀態機的失敗測試（`not_started → in_progress → submitted / expired_submitted`，終態不可逆）於 `backend/tests/unit/test_session_state.py`
- [X] T023 實作場次狀態機於 `backend/src/techinterview/domain/session_state.py`
- [X] T024 [P] 撰寫邀請 token 兌換的契約測試（首次兌換、重複兌換不重置 deadline、逾期、已提交）於 `backend/tests/contract/test_redeem.py`
- [X] T025 實作 token 驗證與 session cookie 換發於 `backend/src/techinterview/core/auth.py`
- [X] T026 實作 `POST /api/session/redeem` 與 `GET /api/session` 於 `backend/src/techinterview/api/session.py`（`predefined_tests` 內容不得外洩，僅回傳 `testCount`）
- [X] T027 實作 seed 腳本（3 題示範，含各語言 starter code 與 quickPrompts）於 `backend/src/techinterview/db/seed.py`，支援 `--duration` 與 `--session-id`
- [X] T028 [P] 建立單一 session store 於 `frontend/src/store/session.ts`（欄位見 [data-model.md](./data-model.md#前端狀態切片單一事實來源)）
- [X] T029 [P] 建立衍生值 selectors（`currentQuestion`、`currentAnswer`、`remainingSec`、`isReadOnly`）於 `frontend/src/store/selectors.ts`
- [X] T030 [P] 建立 API client 與錯誤映射於 `frontend/src/services/api.ts`
- [X] T031 建立 App Router 根版面於 `frontend/src/app/layout.tsx`（掛載主題、`noindex` meta）
- [X] T032 實作路由 `/s/[token]` 與 `/s` 的場次載入流程於 `frontend/src/app/s/[token]/page.tsx` 與 `frontend/src/app/s/page.tsx`（Client Component，見 research R-003）
- [X] T033 實作三面板版面骨架（CSS grid，左右比例夾制 6:4–7:5）於 `frontend/src/app/AppLayout.tsx`，依 [contracts/ui-contracts.md](./contracts/ui-contracts.md#版面契約)

**Checkpoint**: 可用邀請連結進入空白三面板 — User Story 實作可開始

---

## Phase 3: User Story 1 — 多題作答與草稿保全 (Priority: P1) 🎯 MVP 基座

**Goal**: 應試者能閱讀題目、選語言、寫程式碼、自動保存草稿、跨題切換不遺失、重整後完整還原。

**Independent Test**: 不接任何 AI 功能，寫完三題、切換頁籤、重新載入頁面，內容 100% 還原。

**Note**: 本階段的草稿保存**不建立 `code_change` 記錄**——作者歸屬需要同時知道
「AI 產出」與「應試者輸入」兩種來源才有意義，整套規則於 US2 一次落地（research R-014）。
這讓 US1 維持可獨立驗證。

### Tests for User Story 1 ⚠️ 先寫，先失敗

- [X] T034 [P] [US1] 撰寫草稿保存的契約測試（revision 遞增、`REVISION_STALE`、`CONTENT_TOO_LARGE`、場次終態拒寫、批次補送）於 `backend/tests/contract/test_answers.py`
- [X] T035 [P] [US1] 撰寫 debounce 保存的失敗測試（fake timers：連續輸入 3 秒僅產生 1 次請求）於 `frontend/tests/unit/persistence.test.ts`
- [X] T036 [P] [US1] 撰寫離線佇列的失敗測試（離線累積、恢復連線依 revision 排序補送）於 `frontend/tests/unit/offline-queue.test.ts`
- [X] T037 [P] [US1] 撰寫保存狀態指示的元件測試（idle/saving/saved/error 四態文字與 aria-live）於 `frontend/tests/component/save-indicator.test.tsx`
- [X] T038 [P] [US1] 撰寫題目切換保留內容的元件測試於 `frontend/tests/component/question-tabs.test.tsx`
- [X] T039 [P] [US1] 撰寫端到端草稿保全情境於 `frontend/tests/e2e/draft-persistence.spec.ts`（對應 quickstart V1）

### Implementation for User Story 1

- [X] T040 [US1] 實作 `PUT /api/answers/{question_id}` 與批次 `PUT /api/answers` 於 `backend/src/techinterview/api/answers.py`
- [X] T041 [P] [US1] 實作 `POST /api/tests/{question_id}`（回報預定義結果，不執行任何用戶端程式碼）於 `backend/src/techinterview/api/tests.py`
- [X] T042 [P] [US1] 封裝 CodeMirror 6 編輯器於 `frontend/src/components/workspace/CodeEditor.tsx`，介面為 `value / onChange / language / readOnly`；**外部寫入不得走 `onChange`**，否則 US2 的作者歸屬無從區分（research R-001）。實作以 CodeMirror 的 `Annotation`（`externalWrite`）標記外部交易並於 `updateListener` 略過，未新增 `onApplyExternal` prop——內容本來就由 store 經 `value` 下傳，額外的 imperative handle 只會多一條同樣的路徑；標記法一併修掉切換題目時那次內容相同的多餘保存
- [X] T043 [US1] 實作 debounce 1000ms 保存與 IndexedDB 離線佇列於 `frontend/src/store/persistence.ts`
- [X] T044 [P] [US1] 實作連線狀態偵測與退避補送於 `frontend/src/services/connectivity.ts`
- [X] T045 [P] [US1] 實作語言選單與「是否以新語言 starter code 取代」確認對話框於 `frontend/src/components/workspace/LanguageSelect.tsx`
- [X] T046 [P] [US1] 實作保存狀態指示於 `frontend/src/components/workspace/SaveIndicator.tsx`
- [X] T047 [P] [US1] 實作程式碼格式化（JS/TS 用 Prettier standalone；Python/Go 用縮排正規化）於 `frontend/src/lib/format-code.ts`
- [X] T048 [US1] 組裝作答區於 `frontend/src/components/workspace/AnswerWorkspace.tsx`
- [X] T049 [P] [US1] 實作題目頁籤與難度／配分標籤於 `frontend/src/components/question/QuestionTabs.tsx`（Radix Tabs，MUST 同時渲染 `Tabs.Content`，否則 `aria-controls` 會指向不存在的元素）
- [X] T050 [P] [US1] 實作題目內容呈現於 `frontend/src/components/question/QuestionContent.tsx`（可捲動區域 MUST 可鍵盤聚焦）
- [X] T051 [US1] 實作切換題目時載入該題 starter code 或既有草稿於 `frontend/src/store/session.ts`
- [X] T052 [P] [US1] 實作測試結果呈現於 `frontend/src/components/workspace/TestConsole.tsx`

**Checkpoint**: US1 可獨立驗證 — 作答、保存、切題、重整還原全數運作，無需 AI 功能

---

## Phase 4: User Story 2 — 透過 AI 完成實作 (Priority: P1) 🎯 產品核心

**Goal**: 應試者能向 AI 描述需求、取得完整實作、逐塊套用至編輯器、反覆迭代；
整段協作歷程與每一次程式碼變更的來源都被完整記錄且可歸屬。

**Independent Test**: 以固定題目為輸入，描述需求 → 取得完整實作 → 套用 → 要求修改 →
再套用，驗證編輯器內容與 AI 輸出逐字一致，且每次變更的作者歸屬正確。

**⚠️ 憲章原則 I（NON-NEGOTIABLE）**：本階段 MUST NOT 出現任何形式的輸出限制層——
prompt 圍欄、輸出後處理、區塊過濾皆屬違規。模式差異僅以系統提示表達（research R-015）。

### Tests for User Story 2 ⚠️ 先寫，先失敗

- [X] T053 [P] [US2] 撰寫供應商工廠的失敗測試（設定切換 provider 不需改業務邏輯、fallback 生效）於 `backend/tests/unit/test_providers.py`
- [X] T054 [P] [US2] 撰寫程式碼區塊解析的失敗測試（多區塊、語言標註、未閉合圍籬、逐字保留不做 trim 以外處理）於 `backend/tests/unit/test_code_blocks.py`
- [X] T055 [P] [US2] 撰寫**套用一致性**的契約測試（套用後 `answer.content` 與 `chat_code_block.content` 逐字相同；多區塊時只有指定區塊生效）於 `backend/tests/collaboration/test_apply.py`
- [X] T056 [P] [US2] 撰寫**作者歸屬**的契約測試（套用 → `source='ai'` 且記錄 messageId/blockIndex；手動保存 → `source='candidate'`；**套用後的第一次自動保存 MUST NOT 產生重複的 candidate 記錄**）於 `backend/tests/collaboration/test_attribution.py`
- [X] T057 [P] [US2] 撰寫資料庫 CHECK 約束的測試（違反 source／欄位對應的寫入 MUST 被資料庫拒絕）於 `backend/tests/collaboration/test_constraints.py`
- [X] T058 [P] [US2] 撰寫 `POST /api/chat` 與 SSE 串流的契約測試（token / blocks / done / error 事件；**回應內容 MUST 與模型輸出完全相同，無任何攔截**）於 `backend/tests/contract/test_chat.py`
- [X] T059 [P] [US2] 撰寫對話 Feed 與套用按鈕的元件測試（三角色呈現、每個區塊各有套用按鈕且可存取名稱可區分、串流中不顯示套用按鈕）於 `frontend/tests/component/chat-feed.test.tsx`
- [X] T060 [P] [US2] 撰寫端到端 AI 實作情境於 `frontend/tests/e2e/ai-implementation.spec.ts`（對應 quickstart V2）

### Implementation for User Story 2

- [X] T061 [US2] 實作 LangChain 供應商工廠於 `backend/src/techinterview/ai/providers.py`，以 `init_chat_model` 建立供應商無關的 model，**MUST NOT import 任何供應商 SDK**；以 `with_fallbacks` 表達退回（憲章原則 V）
- [X] T062 [US2] 撰寫系統提示於 `backend/src/techinterview/ai/prompts.py`：**依提問的意圖回應**（要實作就給完整實作，問概念就回答概念），**MUST NOT 限制輸出完整性**。原本的討論／實作雙模式已於 2026-08-05 移除（research R-015 已更新）
- [X] T063 [US2] 實作 `astream` → SSE 串流於 `backend/src/techinterview/ai/streaming.py`（場次進入終態時立即以 `error` 中止）
- [X] T064 [US2] 實作程式碼區塊解析與留存於 `backend/src/techinterview/ai/code_blocks.py`，於串流結束後對**完整回覆**解析並寫入 `chat_code_block`（research R-013）
- [X] T065 [US2] 實作 `POST /api/chat` 與 `GET /api/chat/stream/{stream_id}` 於 `backend/src/techinterview/api/chat.py`（`blocks` 事件於 `done` 之前送出；`provider`、`model` 一併留存）
- [X] T066 [US2] 實作 `POST /api/answers/{question_id}/apply` 於 `backend/src/techinterview/api/answers.py`——逐字寫入指定區塊、遞增 `revision`、回傳寫入後的 `content`
- [X] T067 [US2] 實作 `code_change` 歸屬於 `backend/src/techinterview/domain/attribution.py`：套用時記 `ai`、debounce 保存時記 `candidate`，**且與最近一次 `ai` 變更內容相同時不重複記錄**（research R-014）；並將 candidate 記錄接上 T040 的保存流程
- [X] ~~T068 [P] [US2] 實作 `PATCH /api/session/collaboration-mode`~~ —— 隨協作模式一併移除（2026-08-05）
- [X] T069 [P] [US2] 實作 SSE 用戶端於 `frontend/src/services/chat-stream.ts`（token 批次套用、處理 `blocks` 事件）
- [X] T070 [P] [US2] 實作對話 Feed（candidate／assistant／system 三種呈現）於 `frontend/src/components/copilot/ChatFeed.tsx`
- [X] T071 [P] [US2] 實作程式碼區塊元件與「套用至編輯器」按鈕於 `frontend/src/components/copilot/CodeBlock.tsx`——內容 MUST 完整顯示不摺疊隱藏；可存取名稱 MUST 能區分同一則回覆的不同區塊
- [X] T072 [US2] 實作套用動作編排於 `frontend/src/store/actions.ts`，依 [ui-contracts A-05](./contracts/ui-contracts.md) 五步：忙碌 → 呼叫 apply → 取消進行中的 debounce 計時器 → 以伺服端回傳內容更新 store（編輯器經 `externalWrite` 標記同步，不觸發 `onChange`）→ 失敗時不動編輯器內容。**取消計時器先於更新 store**：兩者之間若插入計時器回呼，送出的仍是套用前的草稿
- [X] T073 [P] [US2] 實作輸入區（多行、Ctrl+Enter 送出、附帶程式碼按鈕、語音輸入佔位）於 `frontend/src/components/copilot/Composer.tsx`
- [X] T074 [P] [US2] 實作協作模式切換分段控制項於 `frontend/src/components/copilot/ModeToggle.tsx`（預設 `implement`）
- [X] T075 [P] [US2] 實作 AI 使用規範長駐 Banner 於 `frontend/src/components/copilot/CollaborationBanner.tsx`——MUST 說明「AI 全面開放」與「協作歷程會被記錄並作為評分依據」（憲章原則 I 的知情要求）
- [X] T076 [P] [US2] 實作隨當前題目變動的快捷提問 Chips 於 `frontend/src/components/copilot/QuickPromptChips.tsx`
- [X] T077 [US2] 組裝 AI 側欄並處理 `AI_UNAVAILABLE` 與連線中斷（轉為 Feed 中的系統訊息，不影響作答內容）於 `frontend/src/components/copilot/CopilotPanel.tsx`

**Checkpoint**: US1 與 US2 各自獨立運作 — 可作答、可透過 AI 實作、套用一致性與作者歸屬測試全綠

---

## Phase 5: User Story 3 — 跨面板 Context 聯動 (Priority: P2)

**Goal**: 題目區與作答區的動作能把正確的 Context 帶入 AI 側欄，In-Context 狀態始終正確。

**Independent Test**: 在已有題目與程式碼的狀態下點擊兩個聯動按鈕，驗證送出的 Context
對應當前題目與當前程式碼。

### Tests for User Story 3 ⚠️ 先寫，先失敗

- [X] T078 [P] [US3] 撰寫 `flushPendingSave()` 的失敗測試（未保存變更先落地才送出；離線時阻擋送出）於 `frontend/tests/unit/flush-pending-save.test.ts`
- [X] T079 [P] [US3] 撰寫聯動送出 Context 正確性的元件測試（停留 Q2 時送出的 questionId 為 Q2）於 `frontend/tests/component/cross-panel.test.tsx`
- [X] T080 [P] [US3] 撰寫端到端聯動情境於 `frontend/tests/e2e/cross-panel-context.spec.ts`（對應 quickstart V3）

### Implementation for User Story 3

- [X] T081 [US3] 實作 `flushPendingSave()` 於 `frontend/src/store/persistence.ts`
- [X] T082 [P] [US3] 實作 `POST /api/chat/system`（題目切換系統訊息）於 `backend/src/techinterview/api/chat.py`
- [X] T083 [US3] 實作切換題目動作序列（flush → setCurrentQuestion → 系統訊息 → 面板同步）於 `frontend/src/store/actions.ts`
- [X] T084 [P] [US3] 實作「詢問 AI 題目重點」按鈕於 `frontend/src/components/question/AskAiButton.tsx`（不接受 questionId 傳參）
- [X] T085 [P] [US3] 實作「傳送至 AI 側邊欄」按鈕於 `frontend/src/components/workspace/SendToAiButton.tsx`（先 flush 再送出；離線時阻擋並提示）
- [X] T086 [P] [US3] 實作 In-Context 狀態列（訂閱 `currentQuestion`，不接受傳參）於 `frontend/src/components/copilot/StatusBar.tsx`

**Checkpoint**: 三面板完全聯動，Context 正確率可驗證

---

## Phase 6: User Story 4 — 計時與提交 (Priority: P2)

**Goal**: 倒數計時正確、警示及時、手動提交有確認、歸零強制提交且不遺失內容。

**Independent Test**: 以可控時鐘注入不同剩餘時間，驗證警示、確認框、強制提交與輸入鎖定。

### Tests for User Story 4 ⚠️ 先寫，先失敗

- [X] T087 [P] [US4] 撰寫計時顯示與 5 分警示的失敗測試（fake timers，含 aria-live 宣告一次）於 `frontend/tests/unit/timer.test.ts`
- [X] T088 [P] [US4] 撰寫時鐘校時與漂移修正的失敗測試於 `frontend/tests/unit/clock-sync.test.ts`
- [X] T089 [P] [US4] 撰寫提交契約測試（冪等、取最後保存草稿、終態拒寫、逾時由 `GET /api/time` 觸發、不覆寫既有終態）於 `backend/tests/contract/test_submission.py`
- [X] T090 [P] [US4] 撰寫提交確認對話框（取消不提交）與終態鎖定的元件測試於 `frontend/tests/component/submit-dialog.test.tsx`
- [X] T091 [P] [US4] 撰寫端到端計時與強制提交情境於 `frontend/tests/e2e/timer-submission.spec.ts`（對應 quickstart V4）

### Implementation for User Story 4

- [X] T092 [US4] 實作 `deadline_at` 計算與 `GET /api/time`（逾期時主動觸發強制提交）於 `backend/src/techinterview/api/time.py`
- [X] T093 [US4] 實作 `POST /api/submit`（冪等、取每題最新草稿、不接受 body）於 `backend/src/techinterview/api/submit.py` 與 `backend/src/techinterview/domain/submission.py`
- [X] T094 [P] [US4] 實作計時 hook（本地每秒遞減 + 每 30 秒校時）於 `frontend/src/lib/use-countdown.ts`
- [X] T095 [P] [US4] 實作倒數計時器元件（一般／警示／鎖定三態，警示只宣告一次）於 `frontend/src/components/header/CountdownTimer.tsx`
- [X] T096 [P] [US4] 實作提交確認對話框與成功提示於 `frontend/src/components/header/SubmitDialog.tsx`
- [X] T097 [US4] 實作 `isReadOnly` 鎖定（作答區、Composer、**套用按鈕**全數轉唯讀）於 `frontend/src/store/selectors.ts` 與相關元件
- [X] T098 [US4] 實作歸零強制提交流程（中止進行中的 SSE 串流 → 鎖定 → 提交）於 `frontend/src/store/actions.ts`
- [X] T099 [US4] 實作提交失敗的持續退避重試與內容保留於 `frontend/src/store/actions.ts`
- [X] T100 [P] [US4] 實作 Header 的品牌標識、職稱與應試者姓名於 `frontend/src/components/header/AppHeader.tsx`

**Checkpoint**: 場次生命週期完整 — 進入、作答、AI 協作、提交、逾時皆正確

---

## Phase 7: User Story 5 — 全螢幕與平台外工具監測 (Priority: P3)

**Goal**: 全螢幕切換狀態同步，離開作答視窗被客觀記錄並提醒應試者。

**Independent Test**: 以程式觸發 focus/visibility 事件，驗證提醒與記錄內容。

### Tests for User Story 5 ⚠️ 先寫，先失敗

- [X] T101 [P] [US5] 撰寫 `fullscreenchange` 狀態同步的失敗測試（含 Esc 退出、瀏覽器拒絕時不做樂觀更新）於 `frontend/tests/unit/fullscreen.test.ts`
- [X] T102 [P] [US5] 撰寫環境事件門檻的失敗測試（< 1000ms 不記錄；非全螢幕狀態不記錄）於 `frontend/tests/unit/environment-events.test.ts`
- [X] T103 [P] [US5] 撰寫 `POST /api/events` 的契約測試（批次、伺服端二次過濾、**schema 不含任何判定性欄位**）於 `backend/tests/contract/test_events.py`
- [X] T104 [P] [US5] 撰寫端到端監測情境於 `frontend/tests/e2e/environment-monitoring.spec.ts`（對應 quickstart V5）

### Implementation for User Story 5

- [X] T105 [P] [US5] 實作 `POST /api/events`（僅記錄客觀事實，無判定欄位）於 `backend/src/techinterview/api/events.py`
- [X] T106 [P] [US5] 實作全螢幕 hook（由 `fullscreenchange` 驅動，不做樂觀更新）於 `frontend/src/lib/use-fullscreen.ts`
- [X] T107 [P] [US5] 實作 blur／visibilitychange 偵測與 1000ms 門檻於 `frontend/src/services/environment-monitor.ts`；監聽 MUST 僅於全螢幕狀態啟用（憲章「平台外工具監測」）
- [X] T108 [US5] 實作全螢幕按鈕與返回提醒 Toast（事實描述，不呈現作弊判定）於 `frontend/src/components/header/FullscreenToggle.tsx`
- [X] T109 [US5] 將環境事件併入離線佇列補送機制於 `frontend/src/store/persistence.ts`

**Checkpoint**: 全部 User Story 獨立可用

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 邊界情境、品質關卡、舊資產拆除與部署

- [X] T110 [P] 撰寫個資最小化的契約測試（`GET /api/session` 與 store 快照皆僅含 `candidateName`、`positionTitle`；回應不含 `code_change` 歷史）於 `backend/tests/contract/test_pii_minimization.py`
- [X] T111 [P] 實作左右／上下比例拖曳與本機偏好保存於 `frontend/src/components/layout/ResizableSplit.tsx`；左右範圍與偏好還原 MUST 夾制於 6:4–7:5，並附邊界測試
- [X] T112 [P] 實作全域鍵盤快捷鍵（Ctrl+S 立即保存、Ctrl+/ 說明、Esc）與可見說明面板於 `frontend/src/components/KeyboardHelp.tsx`
- [X] T113 [P] 實作離開前未保存變更提示（`beforeunload`）於 `frontend/src/app/AppLayout.tsx`
- [X] T114 [P] 實作多分頁同場次偵測（BroadcastChannel）於 `frontend/src/services/tab-guard.ts`
- [X] T115 [P] 實作超長貼上內容處理（256 KB 上限提示，編輯器維持可用）於 `frontend/src/components/workspace/CodeEditor.tsx`
- [X] T116 [P] 實作題目載入失敗、連結失效與多分頁的狀態畫面於 `frontend/src/app/ErrorStates.tsx`
- [X] T117 [P] 建立 axe-core 對比與 ARIA 全頁檢核於 `frontend/tests/e2e/a11y.spec.ts`（含程式碼區塊與套用按鈕的可存取名稱）
- [X] T118 [P] 建立編輯器延遲量測腳本（500 次輸入 p50/p95/p99）與進場耗時量測（SC-001，預算 30 秒）於 `frontend/tests/perf/editor-latency.spec.ts`（**產品目標，非憲章關卡**——原則 IV 已於 v3.0.0 移除）
- [X] T119 拆除舊技術棧資產：`backend/` 的 TypeScript 實作、`backend/src/ai/guardrails.ts`、`postprocess.ts`、`backend/tests/guardrails/`（25 組越獄語料、11 則錄製回應、59 個測試）、`frontend/` 的 Vite 設定。**PR 描述 MUST 載明這是憲章 v3.0.0 反轉原則 I 的結果，不是品質問題**
- [X] T120 [P] 建立 `docker/Dockerfile.frontend`（Next.js standalone）、`docker/Dockerfile.backend`（Python 3.12-slim + `uv sync --frozen`）與 `docker/compose.yaml`，執行環境對齊 Ubuntu 24.04
- [X] T121 完成 CI 於 `.github/workflows/ci.yml`：`pull_request` 觸發，關卡為測試套件、**協作歷程記錄測試**、axe-core 檢核；憑證隔離檢查擴及 `GOOGLE_API_KEY`、`ANTHROPIC_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`
- [X] T122 [P] 改寫 `README.md`（uv / Supabase CLI / Docker 先決條件、雙供應商設定、新的品質關卡、憲章六原則）
- [X] T123 依 [quickstart.md](./quickstart.md) 完整走過 V1–V5 五個驗證情境並記錄結果

---

## Phase 9: Increment 1 的前端銜接

**Purpose**: 讓現有的 Vite 前端能對接新的 Python 後端，不做框架遷移

- [X] T124 更新前端對後端契約的呼叫於 `frontend/src/services/api.ts`、`frontend/src/components/copilot/ModeToggle.tsx` 與 `frontend/src/types.ts`：`guidance-mode` → `collaboration-mode`、`light/deep` → `discuss/implement`；並容忍 SSE 新增的 `blocks` 事件（本次前端不渲染套用按鈕，僅不得因未知事件而中斷串流）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：無相依，可立即開始
- **Foundational (Phase 2)**：相依 Setup — **阻擋所有 User Story**
- **User Stories (Phase 3–7)**：皆相依 Foundational
  - 人力足夠時可平行；否則依 P1 → P2 → P3 順序
- **Polish (Phase 8)**：相依所有欲交付的 Story；T119 額外相依全部 Story 完成
  （舊實作在新實作可用之前不得拆除）

### User Story Dependencies

- **US1 (P1)**：Foundational 完成後即可開始，不相依其他 Story
- **US2 (P1)**：Foundational 完成後即可開始。T067 的 candidate 歸屬需接上 US1 的
  T040 保存流程；若平行開發，需 T040 就緒
- **US3 (P2)**：功能上整合 US1 與 US2 的既有元件；T083、T085 需 US1 的
  `persistence.ts` 與 US2 的 `POST /api/chat` 就緒
- **US4 (P2)**：Foundational 完成後即可開始；T097 的套用按鈕鎖定與 T098 的
  「中止串流」需 US2 就緒
- **US5 (P3)**：完全獨立，可與任何 Story 平行

### Within Each User Story

- 測試先寫且先失敗（憲章原則 III），才進實作
- 後端：migrations → queries → domain → api
- 前端：store → services → 元件 → 組裝
- Story 完成並通過 Independent Test，才進下一優先序

### Parallel Opportunities

- Phase 1 中 T002–T005、T008–T012 可平行
- Phase 2 中 T016–T017、T019–T022、T024、T028–T030 各自可平行
- Foundational 完成後，US1／US2／US4／US5 可由不同人同時進行
- 各 Story 內標記 [P] 的測試可全部平行撰寫
- Phase 8 除 T119、T121、T123 外皆可平行

---

## Parallel Example: User Story 2

```bash
# 先平行寫完所有測試（必須先失敗）：
Task: "供應商工廠測試 in backend/tests/unit/test_providers.py"
Task: "程式碼區塊解析測試 in backend/tests/unit/test_code_blocks.py"
Task: "套用一致性契約測試 in backend/tests/collaboration/test_apply.py"
Task: "作者歸屬契約測試 in backend/tests/collaboration/test_attribution.py"
Task: "資料庫 CHECK 約束測試 in backend/tests/collaboration/test_constraints.py"
Task: "chat SSE 契約測試 in backend/tests/contract/test_chat.py"
Task: "對話 Feed 與套用按鈕元件測試 in frontend/tests/component/chat-feed.test.tsx"
Task: "端到端 AI 實作 in frontend/tests/e2e/ai-implementation.spec.ts"

# 再平行做獨立實作：
Task: "SSE 用戶端 in frontend/src/services/chat-stream.ts"
Task: "對話 Feed in frontend/src/components/copilot/ChatFeed.tsx"
Task: "程式碼區塊與套用按鈕 in frontend/src/components/copilot/CodeBlock.tsx"
Task: "輸入區 in frontend/src/components/copilot/Composer.tsx"
Task: "模式切換 in frontend/src/components/copilot/ModeToggle.tsx"
Task: "規範 Banner in frontend/src/components/copilot/CollaborationBanner.tsx"
Task: "快捷提問 Chips in frontend/src/components/copilot/QuickPromptChips.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2)

本產品的 MVP **不是** US1 單獨——US1 只是一個能存草稿的編輯器，
不構成「評估透過 AI 實作能力」的平台。最小可展示切片是 US1 + US2。

1. 完成 Phase 1：Setup
2. 完成 Phase 2：Foundational（**關鍵路徑，阻擋一切**）
3. 完成 Phase 3：US1 → 停下來驗證 quickstart V1
4. 完成 Phase 4：US2 → 停下來驗證 quickstart V2
5. **此時已可對外展示產品的核心命題**：應試者透過 AI 完成實作，
   而每一行程式碼的來源都分得出來

### Incremental Delivery

1. Setup + Foundational → 地基就緒
2. + US1 → 驗證 → 可作答
3. + US2 → 驗證套用一致性與作者歸屬 → **產品核心成形（MVP）**
4. + US3 → 驗證 Context 正確率 → 體驗完整
5. + US4 → 驗證計時與強制提交 → 可進行真實場次
6. + US5 → 驗證平台外工具監測 → 評估材料完備
7. + Polish → 拆除舊資產、容器化、CI 關卡

### Parallel Team Strategy

三人團隊，Foundational 完成後：

- 開發者 A：US1 → US3（作答與聯動主線）
- 開發者 B：US2（AI 協作、套用與歸屬——本階段最重）
- 開發者 C：US4 → US5（場次生命週期與監測）

US2 的份量明顯大於其他 Story，開發者 B 應優先支援。US3 的整合任務（T083、T085）
需等 A 與 B 的前置就緒，其餘皆可獨立推進。

---

## Notes

- [P] = 不同檔案、無相依
- 測試在本專案為強制項：憲章原則 I 與 III 明定，非選配
- 採 PR 制（憲章 v3.0.0）：變更 MUST 經 Pull Request 且 CI 通過才能合併，
  MUST NOT 直接推送 `main`
- PR 描述 MUST 聲明涉及的原則並確認未違反
- 本期僅支援桌機螢幕（最小視窗寬度 1280px）
- **任何在本階段新增輸出限制層的實作皆屬憲章原則 I 違規**——
  AI 產出什麼就呈現什麼、就能套用什麼
- 效能量測（T118）保留為產品目標，失敗不阻擋合併
