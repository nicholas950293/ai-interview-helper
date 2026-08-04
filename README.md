# TechInterview Pro — Candidate Portal

AI 面試作答平台的應試者端。三面板版面（題目區、作答區、AI 協作）共用單一場次狀態，
後端負責邀請連結驗證、題目派送、草稿與提交持久化，以及 AI 呼叫代理。

**核心約束**：這個產品評的**不是**徒手寫程式的能力，而是「能不能透過 AI 把東西做出來」。
因此 AI 全面開放——它可以直接產出完整可執行的實作、重構、補測試，任何模式都不設限，
系統 MUST NOT 以 prompt 圍欄或輸出後處理限制它。

不可妥協的是**可評估性**：完整對話與每一次程式碼變更的來源（應試者自行輸入／套用 AI
產出）都被記錄，且兩者 MUST NOT 混為一談。這條規則由資料庫的 CHECK 約束強制，
不倚賴應用層自律。

## 先決條件

- Node.js 22 LTS 以上、npm 10+
- Python 3.12 與 [uv](https://docs.astral.sh/uv/)
- 桌機瀏覽器，最小視窗寬度 1280px
- **選用**：Gemini 或 Anthropic API 金鑰。未設定時自動改用腳本化假回應，
  串流、區塊解析、套用與作者歸屬的路徑完全相同，開發與驗證都不需要金鑰。

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # 若尚未安裝 uv
```

## 安裝與啟動

```bash
npm install
cd backend && uv sync --frozen && cd ..
cp backend/.env.example backend/.env      # 至少填入 SESSION_SECRET

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
npm run seed -- --duration 6m
```

> 根目錄的 script 一律是直接指令、不是巢狀的 `npm run`。巢狀時外層 npm 會把
> `--` 之後的參數當成自己的旗標吃掉，`--duration` 與 `--grep` 都會**靜默失效**。

## 環境變數

全部定義於 `backend/.env`，見 `backend/.env.example`。

| 變數                                        | 說明                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `PORT`                                      | 後端埠號，預設 8787                                                         |
| `ENVIRONMENT`                               | `development` / `test` / `production`                                       |
| `DATABASE_PATH`                             | SQLite 檔案路徑，預設 `./data/portal.db`                                    |
| `SESSION_SECRET`                            | 至少 32 字元的隨機值，用於簽章 session cookie                               |
| `COOKIE_SECURE`                             | 正式環境 MUST 設為 `true`                                                   |
| `GOOGLE_API_KEY`                            | Gemini 金鑰。**MUST NOT 出現在 `frontend/` 的任何檔案或環境變數中**         |
| `ANTHROPIC_API_KEY`                         | Claude 金鑰，同上                                                           |
| `AI_PROVIDER`                               | 主要供應商：`google_genai` 或 `anthropic`                                   |
| `AI_MODEL`                                  | 預設 `gemini-3.6-flash`                                                     |
| `AI_FALLBACK_PROVIDER`／`AI_FALLBACK_MODEL` | 主要供應商不可用時的退回對象，兩者皆填才生效                                |
| `AI_FAKE`                                   | 以腳本化假回應取代真實模型；**production 一律無效**，不得成為關掉模型的後門 |

產生 `SESSION_SECRET`：

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

## 專案結構

```text
frontend/src/
├── app/            App Router：layout、/s/[token] 與 /s、三面板版面骨架
├── components/     header / question / workspace / copilot / layout / ui
├── store/          session.ts（單一事實來源）、selectors、persistence、actions
├── services/       後端呼叫、SSE 串流、連線偵測、環境監測、多分頁偵測
├── lib/            計時、全螢幕、格式化、AI 回覆的區塊分段
└── styles/         Tailwind 4 淺色主題 token（單一來源）

backend/src/techinterview/
├── api/            session / answers / tests / chat / time / submit / events
├── ai/             LangChain 編排、串流、程式碼區塊解析
├── db/             client、queries、migrations、seed
├── domain/         場次狀態機、提交規則、作者歸屬
└── core/           config、auth、schemas、errors
```

前端 `/api/*` 由 `next.config.ts` 的 rewrites 代理至後端。前端永不直接呼叫模型服務，
也永不持有任何模型憑證。

## 品質關卡

CI（`.github/workflows/ci.yml`）於 Pull Request 強制執行，通過才能合併 `main`：

```bash
npm test                    # 前後端完整測試套件（pytest 142 + vitest 123）
npm run test:collaboration  # 協作可評估性：套用一致性與作者歸屬（24）
npm run test:a11y           # axe-core：WCAG AA 對比與 ARIA（7）
npm run lint                # ESLint（含「前端不得讀取金鑰」規則）+ ruff
npm run typecheck
npm run format:check
```

其他：

```bash
npm run test:e2e            # Playwright 端到端（對應 quickstart V1–V5，33 個）
npm run test:e2e -- --grep "ai implementation"   # 只跑某一個情境
npm run perf:editor         # 編輯器延遲量測
```

`npm run perf:editor` 的輸出：

```text
keystroke → paint latency: p50 16.7ms · p95 17.5ms · p99 18ms ✓ within 50ms budget
```

效能量測保留為**回歸偵測**而非合併門檻——憲章 v2.0.0 已移除效能預算原則。

CI 另有一道**憑證隔離**檢查：以假金鑰建置前端，若 `frontend/.next/static/`（也就是
真正送到瀏覽器的那一份）含有該字串即失敗。檢查涵蓋雙供應商金鑰與 Supabase
service role key。

## 開發約定

本專案受 `.specify/memory/constitution.md` 約束，六項原則皆為硬性要求：

1. **AI 協作可評估性不可妥協**（NON-NEGOTIABLE）— AI MUST 能輸出完整實作且不受任何限制；
   每次程式碼變更 MUST 記錄來源，應試者自行輸入與套用 AI 產出 MUST NOT 混為一談
2. **Context 單一事實來源** — 三個面板共用一份 session state，不得各自複製快照
3. **互動邏輯測試先行** — 計時、debounce 保存、提交、套用與歸屬、聯動須先寫失敗測試
4. **規格驅動開發（SDD）** — spec → plan → tasks → implement 不可跳過
5. **技術棧治理** — Next.js + TypeScript + Tailwind／Python + FastAPI + uv／Supabase／
   LangChain 統一編排 Gemini 與 Claude（不裸接 SDK）／Google OAuth／Docker + Ubuntu 24.04／
   GitHub Actions PR 制
6. **淺色系一致性與可及性** — 左右比例維持 6:4–7:5、WCAG AA 對比、全鍵盤可操作

變更 MUST 經 Pull Request 且 CI 通過才能合併。提交訊息需聲明涉及的原則並確認未違反；
關卡失敗時立即修復或還原，不讓 `main` 停在紅燈。

## 目前狀態

憲章「待遷移落差」表尚有兩列未關閉，皆待本機環境備妥，非程式碼本身的阻礙：

| 落差   | 憲章要求              | 現況                                         |
| ------ | --------------------- | -------------------------------------------- |
| 資料庫 | Supabase              | SQLite；`db/queries.py` 的介面已設計為可抽換 |
| 容器化 | Docker + Ubuntu 24.04 | 尚未建立 Dockerfile                          |

**尚未實作的功能**（非落差，屬後續 feature）：Google OAuth 登入、
Monaco Editor、真實沙盒執行、評分後台。「執行單元測試」回報的是預先定義的結果，
不執行應試者的程式碼。

規格文件見 [`specs/001-candidate-portal/`](specs/001-candidate-portal/)：
`spec.md`（需求）、`plan.md`（技術決策）、`research.md`（決策理由與被否決的替代方案）、
`data-model.md`、`contracts/`（HTTP 與 UI 契約）、`quickstart.md`（驗證情境與最近一次結果）。
