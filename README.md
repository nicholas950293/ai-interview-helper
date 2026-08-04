# TechInterview Pro — Candidate Portal

AI 面試作答平台的應試者端。三面板版面（題目區、作答區、AI 助教）共用單一場次狀態，
搭配一個輕量 BFF 負責邀請連結驗證、題目派送、草稿與提交持久化，以及 AI 呼叫代理。

**核心約束**：AI 是蘇格拉底式的引導者，不是解題器。它會反問邊界條件、分析複雜度、
指出問題所在，但不會提供可直接貼上就通過測試的完整實作——這是不可妥協的產品前提，
由三層防線與自動化越獄測試守著。

## 先決條件

- Node.js 22 LTS 以上、npm 10+
- Gemini API 金鑰（僅供 BFF 使用；開發時可用假回應取代）
- 桌機瀏覽器，最小視窗寬度 1280px

## 安裝與啟動

```bash
npm install
cp backend/.env.example backend/.env      # 填入 SESSION_SECRET 與 GEMINI_API_KEY

npm run db:migrate                        # 建立 SQLite schema
npm run seed                              # 載入示範場次（3 題）並輸出邀請連結
npm run dev                               # backend:8787 + frontend:5173（並行）
```

`npm run seed` 會輸出可直接開啟的邀請連結：

```text
[db] 已建立示範場次：
  sessionId : sess-demo
  題目      : API 限流器、LRU 快取、訊息佇列
  邀請連結  : http://localhost:5173/s/9fK2xQ...
```

短場次（驗證計時與強制提交）：

```bash
npm run db:seed --workspace backend -- --duration 6m
```

> 參數要用 `--workspace backend` 指定，走根目錄的 `db:seed` 別名時
> `--` 之後的參數會被外層 npm 當成自己的旗標吃掉。

## 環境變數

全部定義於 `backend/.env`，見 `backend/.env.example`。

| 變數             | 說明                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `PORT`           | BFF 埠號，預設 8787                                              |
| `DATABASE_PATH`  | SQLite 檔案路徑，預設 `./data/portal.db`                         |
| `SESSION_SECRET` | 至少 32 字元的隨機值，用於簽章 session cookie                    |
| `COOKIE_SECURE`  | 正式環境 MUST 設為 `true`                                        |
| `GEMINI_API_KEY` | 模型金鑰。**MUST NOT 出現在 `frontend/` 的任何檔案或環境變數中** |
| `GEMINI_MODEL`   | 預設 `gemini-2.5-flash`                                          |
| `AI_FAKE`        | 以腳本化假回應取代真實模型，供 e2e 使用；production 一律無效     |

產生 `SESSION_SECRET`：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## 專案結構

```text
frontend/src/
├── app/            進入點、路由 /s/:token、三面板版面骨架
├── components/     header / question / workspace / copilot / layout / ui
├── store/          session.ts（單一事實來源）、selectors、persistence、actions
├── services/       BFF 呼叫、SSE 串流、連線偵測、環境監測、多分頁偵測
├── lib/            計時、全螢幕、格式化
└── styles/         Tailwind 淺色主題 token（單一來源）

backend/src/
├── routes/         session / answers / tests / chat / time / submit / events
├── ai/             guardrails（版本控管的圍欄）、gemini、postprocess
├── db/             schema、遷移、查詢、seed
├── domain/         場次狀態機、提交規則
└── lib/            env、auth、schemas、errors
```

## 品質關卡

憲章要求每次推送 `main` 都必須通過以下關卡，CI（`.github/workflows/ci.yml`）會強制執行：

```bash
npm test                    # 前後端完整測試套件
npm run test:guardrails     # 圍欄越獄測試（以錄製回應驗證後處理層）
npm run test:a11y           # axe-core：WCAG AA 對比與 ARIA
npm run perf:editor         # 編輯器延遲量測，p95 須 < 50ms
```

其他：

```bash
npm run lint                # ESLint（含「前端不得讀取金鑰」規則）
npm run typecheck
npm run test:e2e            # Playwright 端到端（對應 quickstart V1–V5）
npm run test:guardrails:live --workspace backend   # 對真實模型執行，排程作業
```

`npm run perf:editor` 的輸出：

```text
keystroke → paint latency: p50 16.7ms · p95 17.5ms · p99 18ms ✓ within 50ms budget
```

CI 另有一道**憑證隔離**檢查：以假金鑰建置前端，若建置產物含有該字串即失敗。

## 開發約定

本專案受 `.specify/memory/constitution.md` 約束，其中五項原則是硬性要求：

1. **AI 護欄不可妥協** — 回應不得含可直接貼上通過測試的完整實作；圍欄需版本控管並有自動化測試
2. **Context 單一事實來源** — 三個面板共用一份 session state，不得各自複製快照
3. **互動邏輯測試先行** — 計時、debounce 保存、提交、圍欄、聯動須先寫失敗測試
4. **效能預算即需求** — 編輯器按鍵到畫面更新 p95 < 50ms；草稿保存 debounce 1000ms
5. **淺色系一致性與可及性** — 左右比例維持 6:4–7:5、WCAG AA 對比、全鍵盤可操作

開發流程採單一主幹：變更直接推送 `main`，提交訊息需聲明涉及的原則並確認未違反。
關卡失敗時立即修復或還原，不讓 `main` 停在紅燈。

## 本期範圍

對應 PRD 的 Phase 1。**不在本期**：Monaco Editor（Phase 2）、真實沙盒執行（Phase 3）、
評分後台（Phase 4）。「執行單元測試」回報的是預先定義的結果，不執行應試者的程式碼。

規格文件見 [`specs/001-candidate-portal/`](specs/001-candidate-portal/)：
`spec.md`（需求）、`plan.md`（技術決策）、`research.md`（決策理由與被否決的替代方案）、
`data-model.md`、`contracts/`（HTTP 與 UI 契約）、`quickstart.md`（驗證情境）。
