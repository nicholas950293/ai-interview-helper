# Implementation Plan: TechInterview Pro — Candidate Portal

**Branch**: `001-candidate-portal` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-candidate-portal/spec.md`

**Constitution**: v3.0.0

## Summary

交付一個應試者端應用：三面板版面（題目區、作答區、AI 側欄）共用單一場次狀態。
AI 全面開放協助實作——它產出完整、可執行的程式碼，應試者逐塊檢視後套用至編輯器。
平台的職責不是限制 AI，而是**把協作過程完整記錄下來並可歸屬**：每一次作答內容變更
都標明來源是應試者自行輸入或套用 AI 產出，這是本平台評估效力的唯一依據（憲章原則 I）。

技術取向由憲章原則 V 決定，本計畫不重新選型：前端 Next.js + TypeScript + Tailwind；
後端 Python + FastAPI（uv + venv）；持久化 Supabase；AI 呼叫一律經 LangChain 編排
Gemini 與 Claude 兩個供應商；容器化以 Docker，目標 Ubuntu 24.04。

**本計畫同時是一份遷移計畫**。`main` 上已有一套可運作的實作（Node + Hono + SQLite +
Vite SPA + 三層 AI 圍欄），與憲章 v2.0.0／v3.0.0 有 8 項落差。落差清單見憲章的
「生效範圍與遷移狀態」；本計畫的 Migration Strategy 一節說明拆除與重建的順序。

## Technical Context

**Language/Version**:

- 前端：TypeScript 5.9；Node.js 22 LTS（僅為 Next.js 的執行環境）
- 後端：Python 3.12（`.python-version` 鎖定），uv 管理相依與 venv

**Primary Dependencies**:

- 前端：Next.js 16（App Router）、React 19、Tailwind CSS 4、Zustand 5（單一 session
  store）、CodeMirror 6（`@codemirror/*`）、Radix UI（Dialog / Toast / Tabs / ToggleGroup）
- 後端：FastAPI 0.141、uvicorn 0.52、pydantic 2.13 + pydantic-settings、
  `langchain` 1.3、`langchain-google-genai` 4.3、`langchain-anthropic` 1.5、
  `supabase` 2.31（Python client）
- 測試：Vitest + React Testing Library（前端單元／元件）、Playwright（端到端與可及性）、
  pytest + pytest-asyncio + httpx `ASGITransport`（後端單元／契約）

**Storage**: Supabase（Postgres）。schema 以 `supabase/migrations/` 的 SQL 檔管理並進版控；
本機開發與 CI 使用 Supabase CLI 啟動的本地實例（Docker）。前端以 IndexedDB 保存離線草稿
與環境事件佇列，恢復連線後補送。

**AI 整合**: 所有模型呼叫經 LangChain。以 `init_chat_model` 建立供應商無關的 chat model，
供應商與模型名稱由設定決定，切換 MUST NOT 需要改動業務邏輯。串流以 LangChain 的
`astream` 產生，經 FastAPI `StreamingResponse` 以 SSE 送出。
**本期不含任何輸出限制層**——憲章原則 I v3.0.0 明文禁止（見 Migration Strategy）。

**Target Platform**: 桌機瀏覽器（Chrome / Edge / Safari / Firefox 最新兩版），最小支援
視窗寬度 1280px，不含行動裝置與窄視窗的響應式版面。部署目標為 Linux Ubuntu 24.04，
前後端各自容器化。

**Project Type**: Web application（Next.js 前端 + FastAPI 後端 + Supabase）

**Performance Goals**: 憲章 v3.0.0 已移除「效能預算即需求」原則，效能不再是憲章關卡。
spec 的 SC-003（編輯器按鍵到畫面更新 p95 < 50ms）保留為**產品目標**而非強制門檻；
草稿保存 debounce 1000ms 則仍是 FR-004 的功能需求，不因原則移除而改變。

**Constraints**:

- 模型憑證、Supabase service role key、OAuth client secret 僅存在於伺服端
- 草稿在離線期間不得遺失；計時以伺服端時間為權威
- 本期不執行應試者提交的任意程式碼（真實沙盒屬 Roadmap Phase 3）
- AI 產出的套用對象為當前題目的單一檔案

**Scale/Scope**: 單場次 2–3 題、1 位應試者；約 16–20 個前端元件、11 個 HTTP 端點。

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| 原則 | 本計畫如何滿足 | 初審 | 設計後複審 |
| --- | --- | --- | --- |
| I. AI 協作可評估性不可妥協 | 不設任何輸出限制層；AI 回覆的每個程式碼區塊皆可套用；`code_change` 表記錄每次變更的 `source`（candidate／ai）與對應的 `chat_message_id`；套用後內容與 AI 輸出逐字比對的測試納入 CI | ✅ PASS | ✅ PASS |
| II. Context 單一事實來源 | 單一 Zustand session store 持有 `currentQuestionId`／`language`／`draft`；三面板皆為消費者；聯動動作與「套用至編輯器」皆以 selector 讀取，不複製快照 | ✅ PASS | ✅ PASS |
| III. 互動邏輯測試先行 | 計時、debounce 保存、強制提交、**AI 產出的套用與作者歸屬**、聯動皆先寫失敗測試；計時與 debounce 以 fake timers 驗證邊界 | ✅ PASS | ✅ PASS |
| IV. 規格驅動開發 (SDD) | 本計畫依 spec.md 產出；`/speckit-analyze` 於 tasks 產出後執行，通過才進 implement | ✅ PASS | ✅ PASS |
| V. 技術棧治理 | Next.js + TS + Tailwind、Python + FastAPI + uv/venv、Supabase、LangChain 雙供應商、Docker + Ubuntu 24.04、GitHub Actions PR 制——逐項落實，無替換 | ✅ PASS | ✅ PASS |
| VI. 淺色系一致性與可及性 | Tailwind 淺色 token 單一來源；版面比例以 CSS grid 夾在 6:4–7:5；Radix 提供焦點管理；`axe-core` 納入 CI | ✅ PASS | ✅ PASS |

**公正性與安全要求**：邀請連結一次性 token 於後端驗證；強制提交取最後一次成功保存的
草稿；**協作歷程（對話 + 程式碼變更歸屬）完整留存**；前端僅持有姓名與職稱；
模型金鑰、Supabase service role key 僅存在於後端環境變數，CI 以 canary 值驗證前端
建置產物不含它們。全數符合。

**開發流程與品質關卡**：採 PR 制，CI 於 pull request 執行測試套件、**協作歷程記錄測試**、
`axe-core` 對比檢核，對應憲章「PR MUST 通過才能合併」三項。Phase 3 沙盒與 Phase 4 後台
不在本期範圍。

**認證**：憲章原則 V 將 Google OAuth 列為 MUST，但憲章「生效範圍與遷移狀態」明載其為
尚未實作的目標，且在 spec FR-027 修訂前應試者端維持邀請連結不視為違反。本期依此辦理，
不實作 Google OAuth。

**結論**：無違反項目，Complexity Tracking 留空。

## Migration Strategy

`main` 上的既有實作與本計畫的技術棧完全不同。本節說明遷移順序與其理由；
逐項任務由 `/speckit-tasks` 產出。

**順序**：後端 → 資料庫 → AI 層 → 前端框架 → 容器化 → CI 流程。

理由：HTTP 契約是前後端唯一的耦合點，先換後端可讓改動範圍收斂在契約之內。

**等價性如何保證**：原本設想「以既有 Vite 前端零改動驗證」，但 tasks.md 的 T007 會就地
把 `frontend/` 改為 Next.js，舊前端不再存在。改以**契約測試一對一移植**達成——
`httpx` 的 `ASGITransport` 對應原本 Node 實作的 `app.request()`（research R-016），
每一條測試的意圖可逐條對照，等價性由此保證而非靠人工點擊。

| 階段 | 內容 | 完成的判準 |
| --- | --- | --- |
| M1 | Python + FastAPI 重建全部端點 | 契約測試依 research R-016 一對一移植，逐條對照通過 |
| M2 | SQLite → Supabase；schema 以 migrations 重建 | 資料存取層測試通過；seed 於本地 Supabase 可執行 |
| M3 | 拆除三層圍欄；改以 LangChain 編排 Gemini + Claude | 圍欄程式碼與越獄語料刪除；雙供應商可經設定切換 |
| M4 | 新增 `code_change` 與套用流程（FR-033 ~ FR-036） | 套用一致性與歸屬正確性的測試通過（SC-004） |
| M5 | Vite SPA → Next.js App Router | e2e 全數通過；axe-core 零違規 |
| M6 | Docker 化（前端、後端、Supabase 本地實例） | `docker compose up` 可完整啟動 |
| M7 | CI 改為 PR 制並加上協作歷程記錄關卡 | PR 未通過 CI 無法合併 |

**待拆除的既有資產**（憲章 v3.0.0 使其失效，非因品質問題）：

- `backend/src/ai/guardrails.ts`（System Prompt 圍欄）
- `backend/src/ai/postprocess.ts`（輸出攔截層）
- `backend/tests/guardrails/`（25 組越獄語料、11 則錄製回應、59 個測試）
- CI 的 `Gate 2 — 圍欄越獄測試`

這些在憲章 v2.x 之下是產品的核心保護，v3.0.0 反轉定位後全數失去依據。
移除 MUST 於 PR 中明列本段理由，以免日後被誤讀為「測試被隨意刪掉」。

## Project Structure

### Documentation (this feature)

```text
specs/001-candidate-portal/
├── plan.md              # 本檔
├── research.md          # Phase 0 產出
├── data-model.md        # Phase 1 產出
├── quickstart.md        # Phase 1 產出
├── contracts/           # Phase 1 產出
│   ├── http-api.md
│   └── ui-contracts.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 產出（/speckit-tasks）
```

### Source Code (repository root)

```text
frontend/                        # Next.js 16（App Router）
├── src/
│   ├── app/
│   │   ├── layout.tsx           # 根版面、Tailwind 主題掛載
│   │   ├── s/[token]/page.tsx   # 邀請連結進入點（Client Component）
│   │   └── s/page.tsx           # 重整後以 cookie 還原
│   ├── components/
│   │   ├── header/              # 品牌、職稱、計時器、姓名、全螢幕、提交
│   │   ├── question/            # 題目頁籤、難度配分、內容、詢問 AI 按鈕
│   │   ├── workspace/           # 語言選單、保存狀態、格式化、編輯器、測試控制台
│   │   ├── copilot/             # 狀態列、模式切換、對話 Feed、程式碼區塊、輸入區
│   │   ├── layout/              # 比例拖曳
│   │   └── ui/                  # Toast 等共用元件
│   ├── store/
│   │   ├── session.ts           # 單一事實來源（原則 II）
│   │   ├── selectors.ts
│   │   ├── persistence.ts       # debounce 保存、離線佇列
│   │   └── actions.ts           # 跨模組動作編排（含套用 AI 產出）
│   ├── services/                # 後端呼叫、SSE 串流、環境監測、多分頁偵測
│   ├── lib/                     # 計時、全螢幕、格式化、程式碼區塊解析
│   └── styles/                  # Tailwind 主題 token（淺色系單一來源）
└── tests/
    ├── unit/
    ├── component/
    ├── e2e/                     # Playwright，含 axe-core 檢核
    └── perf/                    # 編輯器延遲量測（非憲章關卡，保留為產品目標）

backend/                         # Python 3.12 + FastAPI
├── src/techinterview/
│   ├── main.py                  # ASGI app 組裝
│   ├── api/                     # session、answers、tests、chat、time、submit、events
│   ├── ai/
│   │   ├── providers.py         # LangChain 供應商工廠（Gemini / Claude）
│   │   ├── prompts.py           # 系統提示（討論模式 / 實作模式）
│   │   └── streaming.py         # astream → SSE
│   ├── db/                      # Supabase client、查詢、seed
│   ├── domain/                  # 場次狀態機、提交規則、程式碼變更歸屬
│   └── core/                    # 設定、認證、錯誤映射、共用 schema
├── tests/
│   ├── unit/
│   ├── contract/                # HTTP 契約
│   └── collaboration/           # 協作歷程記錄測試（原則 I 的 CI 關卡）
├── pyproject.toml
├── uv.lock
└── .python-version

supabase/
├── migrations/                  # 編號 SQL 遷移檔
└── config.toml                  # 本地實例設定

docker/
├── Dockerfile.frontend
├── Dockerfile.backend
└── compose.yaml                 # frontend + backend + supabase（本地）

docs/
└── PRD.md
```

**Structure Decision**：維持前後端分離的雙套件配置，但兩者不再共用套件管理器——
前端由 npm 管理，後端由 uv 管理，各自獨立建置與容器化。這是憲章原則 V 的直接結果，
不是本計畫的選擇。`supabase/` 與 `docker/` 提升至根層級，因為它們同時服務前後端。

## Complexity Tracking

> 無憲章違反項目，本節留空。
