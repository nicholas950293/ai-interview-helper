# Implementation Plan: TechInterview Pro — Candidate Portal

**Branch**: `001-candidate-portal` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-candidate-portal/spec.md`

## Summary

交付一個應試者端單頁應用：三面板版面（題目區、作答區、AI 側欄）共用單一場次狀態，
搭配一個輕量 BFF 負責邀請連結驗證、題目派送、草稿與提交持久化、以及 AI 呼叫代理。

技術取向：React + TypeScript 前端，狀態集中於單一 session store（滿足憲章原則 II）；
編輯器本期採 CodeMirror 6（行號、語法高亮、Tab 縮排，輸入延遲遠低於 50ms 預算，
Roadmap Phase 2 再換 Monaco）；BFF 以 Node + Hono 實作，SQLite 持久化，Gemini 呼叫
一律在伺服端進行並套用版本控管的 System Prompt 圍欄，前端永不持有模型憑證。

## Technical Context

**Language/Version**: TypeScript 5.7；Node.js 22 LTS

**Primary Dependencies**:
- 前端：React 19、Vite 6、Zustand 5（單一 session store）、CodeMirror 6（`@codemirror/*`）、
  Tailwind CSS 4、Radix UI（Dialog / Toast / Tabs，取其鍵盤與 ARIA 行為）
- 後端：Hono 4（HTTP）、`@google/genai`（Gemini SDK，僅伺服端）、Zod 4（邊界驗證）、
  better-sqlite3（同步存取，單機足夠）

**Storage**: SQLite 單檔資料庫（場次、題目、作答、對話、環境事件）；前端以 IndexedDB
保存離線草稿佇列，恢復連線後補送

**Testing**: Vitest + React Testing Library（單元／元件）、Vitest fake timers（計時與
debounce 邊界）、Playwright（端到端與可及性）、`axe-core` 對比與 ARIA 檢核；
圍欄越獄測試以錄製的模型回應（fixtures）加真實模型的排程測試雙軌執行

**Target Platform**: 桌機瀏覽器（Chrome / Edge / Safari / Firefox 最新兩版）；
BFF 部署於單一 Node 程序

**Project Type**: Web application（frontend + 輕量 backend）

**Performance Goals**: 編輯器按鍵到畫面更新 p95 < 50ms；草稿保存 debounce 1000ms；
AI 首個 token 於 2 秒內開始串流

**Constraints**: 模型憑證僅存在於伺服端；草稿在離線期間不得遺失；計時以伺服端時間為權威；
本期不執行應試者提交的任意程式碼

**Scale/Scope**: 單場次 2–3 題、1 位應試者；約 12–15 個前端元件、8 個 HTTP 端點

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 本計畫如何滿足 | 初審 | 設計後複審 |
| --- | --- | --- | --- |
| I. AI 護欄不可妥協 | Gemini 呼叫僅在 BFF；System Prompt 圍欄以 `backend/src/ai/guardrails.ts` 版本控管，前端輸入僅作為 user turn，無法覆寫 system；越獄測試套件涵蓋直接索取與偽裝除錯兩類 | ✅ PASS | ✅ PASS |
| II. Context 單一事實來源 | 單一 Zustand session store 持有 `currentQuestionId`／`language`／`draft`；三面板皆為消費者；聯動動作以 selector 讀取，不複製快照 | ✅ PASS | ✅ PASS |
| III. 互動邏輯測試先行 | 計時、debounce 保存、強制提交、圍欄、聯動皆先寫失敗測試；計時與 debounce 以 fake timers 驗證邊界 | ✅ PASS | ✅ PASS |
| IV. 效能預算即需求 | CodeMirror 6 受控更新、狀態訂閱切片化避免全樹重繪；編輯器路徑變更須附延遲量測（Playwright trace） | ✅ PASS | ✅ PASS |
| V. 淺色系一致性與可及性 | Tailwind 淺色 token 單一來源；版面比例以 CSS grid 鎖在 6:4–7:5；Radix 提供焦點管理；`axe-core` 納入 CI | ✅ PASS | ✅ PASS |

**公正性與安全要求**：邀請連結一次性 token 於 BFF 驗證；強制提交取最後一次成功保存的
草稿；對話完整留存；前端僅持有姓名與職稱；金鑰僅存在於 BFF 環境變數。全數符合。

**開發流程與品質關卡**：CI 執行測試套件、圍欄越獄測試、`axe-core` 對比檢核，對應憲章
「合併前 MUST 通過」三項。Phase 3 沙盒與 Phase 4 後台不在本期範圍。

**結論**：無違反項目，Complexity Tracking 留空。

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
frontend/
├── src/
│   ├── app/                    # 進入點、路由（/s/:token）、版面骨架
│   ├── components/
│   │   ├── header/             # 品牌、職稱、計時器、姓名、全螢幕、提交
│   │   ├── question/           # 題目頁籤、難度配分、內容、詢問 AI 按鈕
│   │   ├── workspace/          # 語言選單、保存狀態、格式化、編輯器、測試控制台
│   │   └── copilot/            # 狀態列、模式切換、對話 Feed、Chips、輸入區
│   ├── store/
│   │   ├── session.ts          # 單一事實來源（原則 II）
│   │   ├── selectors.ts
│   │   └── persistence.ts      # debounce 保存、離線佇列
│   ├── services/               # BFF 呼叫、SSE 串流、環境事件回報
│   ├── lib/                    # 計時器、格式化、a11y 輔助
│   └── styles/                 # Tailwind 主題 token（淺色系單一來源）
└── tests/
    ├── unit/
    ├── component/
    └── e2e/                    # Playwright，含 axe-core 檢核

backend/
├── src/
│   ├── routes/                 # session、questions、drafts、submit、chat、events、tests
│   ├── ai/
│   │   ├── guardrails.ts       # System Prompt 圍欄（版本控管）
│   │   └── gemini.ts           # 模型呼叫與串流
│   ├── db/                     # schema、遷移、查詢
│   ├── domain/                 # 場次狀態機、計時權威、提交規則
│   └── lib/                    # token 驗證、錯誤映射
└── tests/
    ├── unit/
    ├── contract/               # HTTP 契約
    └── guardrails/             # 越獄測試套件

docs/
└── PRD.md
```

**Structure Decision**：採前後端分離的雙套件配置。前端承載三面板體驗與單一 session store；
後端僅承擔憲章要求必須離開瀏覽器的職責（憑證隔離、權威計時、持久化、對話留存）。
不引入 monorepo 工具鏈——兩個套件、單一部署目標，`npm workspaces` 已足夠。

## Complexity Tracking

> 無憲章違反項目，本節留空。
