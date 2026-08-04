# Phase 0 Research: Candidate Portal

**Date**: 2026-08-04 | **Plan**: [plan.md](./plan.md) | **Constitution**: v3.0.0

Technical Context 中無殘留的 NEEDS CLARIFICATION。本文件記錄每項技術選擇的決策、理由與
被否決的替代方案。

**前提**：憲章原則 V 已固定前端框架、後端語言／框架、資料庫、AI 編排層、認證方式與
部署形式。這些項目**不在本文件的決策範圍內**——本文件只處理「在憲章給定的框架內，
具體怎麼做」。凡屬憲章已決定者以「（憲章原則 V 決定）」標示，僅記錄實作方式。

---

## R-001 程式碼編輯器

**Decision**：維持 CodeMirror 6，透過 `@codemirror/state` + `@codemirror/view` 直接組裝。

**Rationale**：

- PRD 將 Monaco 排在 Roadmap Phase 2，憲章「開發流程與品質關卡」明定 Phase 分期
  MUST 被尊重，不得提前混入。
- 憲章 v3.0.0 移除了效能預算原則，因此「Monaco 太重」不再是憲章層級的理由；
  但分期理由仍然成立，選擇不變。
- 行號、語法高亮、Tab 縮排三項需求皆為 CodeMirror 內建擴充。
- 「套用 AI 產出」需要以程式替換整份文件內容，CodeMirror 的 `dispatch({changes})`
  是單一交易，套用前後的內容可精確比對——這對 SC-004 的逐字一致性斷言是必要的。

**Alternatives considered**：

- **Monaco Editor**：功能最完整，但屬 Phase 2 範圍。
- **純 textarea**：套用與比對最單純，但無法滿足 FR-007 的語法高亮。

**Migration note**：介面維持 `value / onChange / language / readOnly`，
另加 `onApplyExternal` 以區分「外部套用」與「使用者輸入」——這是 FR-035 作者歸屬的
前端來源，不能靠 `onChange` 自行猜測。

---

## R-002 前端狀態管理

**Decision**：Zustand 單一 session store，配合切片化 selector 訂閱。

**Rationale**：

- 憲章原則 II 要求單一事實來源。Zustand 的單 store 模型天然對應此約束。
- 在 Next.js App Router 下，store 建立於 Client Component 邊界內，以 `'use client'`
  標記；不做 SSR hydration（場次資料一律由後端 API 取得）——理由見 R-003。
- 切片化訂閱讓編輯器輸入只觸發作答區重繪，題目區與 AI 側欄不受影響。

**Alternatives considered**：

- **React Context + useReducer**：任何狀態變更會使所有消費者重繪。
- **Next.js Server Components + Server Actions 持有狀態**：作答是高頻本地互動，
  每次輸入往返伺服器不可行。

---

## R-003 Next.js 的角色界定（憲章原則 V 決定框架，此處決定用法）

**Decision**：Next.js 只負責前端交付（路由、版面、Client Component），
**不承擔 API 職責**。所有資料存取直接呼叫 FastAPI 後端。
`/s/[token]` 為 Client Component，場次載入於瀏覽器端完成。

**Rationale**：

- 憲章原則 V 同時指定 Next.js 與 FastAPI。若讓 Next.js Route Handlers 再包一層 BFF，
  等於同一個系統有兩個後端，每個端點都要維護兩份錯誤映射與型別。
- 應試者端沒有 SEO 需求（頁面 `noindex`），SSR 對本產品沒有價值；
  而 SSR 會讓「以 cookie 授權的 SPA 狀態」多出一組伺服器端會話處理。
- 保持 FastAPI 為唯一 API，也讓 M1 遷移期間既有前端可零改動接上。

**Implication**：跨來源請求需處理。開發時以 Next.js `rewrites` 將 `/api/*` 代理至
FastAPI，避免瀏覽器跨來源；正式部署以反向代理讓兩者同源。session cookie 因此維持
`SameSite=Lax`，不需 CORS 憑證設定。

**Alternatives considered**：

- **Next.js Route Handlers 作為 BFF**：雙後端，維護成本加倍。
- **前端直連 FastAPI 並開啟 CORS**：需要 `SameSite=None; Secure` cookie，
  攻擊面較大且本地開發更麻煩。

---

## R-004 Supabase 的使用方式（憲章原則 V 決定，此處決定用法）

**Decision**：後端以 `supabase-py` 的 service role client 存取；
schema 以 `supabase/migrations/` 的編號 SQL 檔管理；本機與 CI 以 Supabase CLI
啟動本地實例（Docker）。**前端不直接存取 Supabase**。

**Rationale**：

- 憲章「憑證隔離」明定 service role key MUST NOT 出現在前端。前端若直連 Supabase，
  就得改用 anon key + RLS，而本產品的授權模型是「一次性邀請 token 換發 session cookie」，
  與 Supabase Auth 的使用者模型不相容（FR-027 明文不要求註冊帳號）。
- 全部存取集中於後端，也讓「提交時取最後保存草稿」維持單一交易。
- 憲章要求「RLS SHOULD 啟用；凡以匿名金鑰可觸及的資料表 MUST 啟用」。本期沒有任何
  資料表以匿名金鑰觸及，因此 RLS 以 deny-all 起始（僅 service role 可存取），
  待 Google OAuth 實作後再依使用者模型開放。

**Alternatives considered**：

- **前端直連 Supabase + RLS**：需要 Supabase Auth 的使用者身分，與 FR-027 衝突。
- **繞過 Supabase client 直接用 asyncpg**：放棄了遷移工具與本地開發流程，
  且與憲章「使用 Supabase 作為持久化層」的意旨不符。

---

## R-005 AI 串流傳輸

**Decision**：LangChain `astream` → FastAPI `StreamingResponse`（`text/event-stream`）。
前端送出提問用 POST 取得 stream id，再以 `EventSource` 接收。

**Rationale**：對話是單向串流，SSE 語意精準、走一般 HTTP、可自動重連。
兩段式（POST 建立 → GET 串流）讓提問與回覆的訊息在串流開始前就已落地，
即使串流中斷，協作歷程仍完整——這是憲章原則 I 的要求。

**Alternatives considered**：

- **WebSocket**：雙向能力用不上，且增加連線狀態管理。
- **單一 POST 直接回串流**：`EventSource` 不支援 POST，需改用 fetch + ReadableStream，
  失去自動重連。

---

## R-006 雙供應商編排（憲章原則 V 決定，此處決定用法）

**Decision**：以 LangChain 的 `init_chat_model` 建立供應商無關的 chat model，
供應商與模型名稱由 `pydantic-settings` 的設定值決定。應用程式碼只依賴
`BaseChatModel` 介面，不 import 任何供應商 SDK。

**Rationale**：

- 憲章明定「MUST NOT 於應用程式碼中直接裸接個別供應商的 SDK」，且「切換或組合
  MUST 可透過設定完成，MUST NOT 需要改動業務邏輯」。`init_chat_model` 正是為此設計。
- 兩個供應商（`google_genai` / `anthropic`）的串流與訊息格式差異由 LangChain 吸收，
  SSE 層看到的都是 `AIMessageChunk`。
- 供應商不可用時的退回以 LangChain 的 `with_fallbacks` 表達，不需業務邏輯介入。

**Alternatives considered**：

- **自寫 provider 抽象層**：重造 LangChain 已有的東西，且違反憲章明文。
- **只接一家、之後再說**：憲章明定 MUST 同時支援兩家。

**Open item**：供應商的選擇是否開放給應試者，spec 尚未規定。本期預設由設定決定、
應試者不可見；若日後要讓應試者選，需先修 spec。

---

## R-007 計時權威與強制提交

**Decision**：場次的 `deadline_at` 由後端於場次開始時寫入；前端每秒依本地時鐘顯示，
並每 30 秒與後端校時。逾期由後端於校時端點主動判定並強制提交。

**Rationale**：憲章要求計時以伺服端為權威。前端本地遞減保證顯示流暢，週期校時修正漂移；
後端獨立驗證使前端時鐘竄改無效，且不依賴前端主動通報——分頁關閉時仍會正確提交。

**Alternatives considered**：**純前端計時**（可被竄改）、
**每秒查詢後端**（請求量與失敗處理成本不成比例）。

---

## R-008 離線草稿佇列

**Decision**：IndexedDB 保存待送出的草稿變更與環境事件佇列，恢復連線後依序補送。

**Rationale**：憲章明定草稿不得遺失。IndexedDB 為非同步 API，不阻塞輸入路徑；
localStorage 的同步寫入會影響輸入流暢度（此理由不再是憲章關卡，但仍是體驗考量）。

**Alternatives considered**：**localStorage**（同步寫入、5MB 上限）、
**僅記憶體**（分頁關閉即失）。

---

## R-009 存取控制（本期）

**Decision**：維持不透明隨機 token（128-bit，URL 安全編碼），後端驗證後換發
HttpOnly session cookie。路由 `/s/[token]`，兌換後將 token 自網址移除。

**Rationale**：憲章原則 V 將 Google OAuth 列為 MUST，但「生效範圍與遷移狀態」明載
其為尚未實作的目標，且在 spec FR-027 修訂前維持邀請連結不視為違反。本期依此辦理。
不透明 token 可即時撤銷，換發 cookie 後 token 不再出現於後續請求。

**Migration note**：實作 Google OAuth 時，`invite_token` 需增加與使用者身分的關聯，
且 FR-027 的「MUST NOT 要求應試者註冊帳號」必須先修訂——那是規格層級的變更，
不能只在 plan 裡決定。

---

## R-010 程式碼格式化

**Decision**：JavaScript / TypeScript 以 Prettier standalone 在瀏覽器端格式化；
Python 與 Go 以縮排正規化處理。

**Rationale**：Prettier standalone 可在前端執行，無需後端往返。Python/Go 的完整
格式化器需要語言執行環境，屬 Phase 3 沙盒範圍。

**Alternatives considered**：**後端呼叫 black / gofmt**（需語言執行環境，越過本期界線）。

---

## R-011 UI 基礎元件與可及性

**Decision**：Radix UI 提供 Dialog、Toast、Tabs、ToggleGroup；其餘自行實作。
Tailwind CSS 4 以 `@theme` 定義淺色主題 token。

**Rationale**：憲章原則 VI 要求全鍵盤可操作與正確的可存取名稱。Radix 已處理焦點陷阱、
ESC 關閉、ARIA 角色與 live region——自行實作這些是可及性缺陷的常見來源。
憲章原則 V 亦 SHOULD 選用此類無頭元件庫。

**Alternatives considered**：**完整 UI 套件（MUI 等）**（視覺與三卡片淺色系不符）、
**全自建**（可及性風險高）。

---

## R-012 作答環境監測

**Decision**：`document.visibilitychange` 與 `window.blur`／`focus` 組合判定；
記錄 `type`、`started_at`、`duration_ms`，離開超過 1000ms 才計為一次事件。
監聽僅於全螢幕期間啟用。

**Rationale**：憲章「平台外工具監測」明定監聽時機為全螢幕模式下。平台內的 AI 已全面
開放，此監測的意義是掌握「是否改用平台外的工具」——那部分協作無法被記錄，
也就無法被評估。1000ms 門檻濾掉焦點瞬時抖動造成的誤報。

**Alternatives considered**：**僅 visibilitychange**（切換到其他應用程式時不觸發）、
**無門檻即時記錄**（誤報過多）。

---

## R-013 AI 產出的程式碼區塊擷取與套用（新增）

**Decision**：後端於串流結束後解析 AI 回覆的 markdown 圍籬區塊，將每個區塊以
`{index, language, content}` 與訊息一併留存；前端依此渲染每個區塊的「套用至編輯器」。
套用時前端呼叫 `POST /api/answers/{question_id}/apply`，由後端寫入作答內容並建立
`code_change` 記錄，前端再以回傳內容更新編輯器。

**Rationale**：

- **為什麼由後端解析**：SC-004 要求「套用後內容與 AI 輸出完全一致」。若由前端解析
  串流片段自行拼裝，一致性取決於前端的拼接邏輯；由後端在完整回覆上解析，
  比對對象就是留存於資料庫的那一份，可被測試逐字斷言。
- **為什麼套用要往返後端**：FR-035 要求記錄變更來源並可追溯到對話訊息。若前端直接
  改編輯器再走一般的 debounce 保存，這次變更會與應試者自行輸入無法區分——
  正是憲章原則 I 禁止的「混為一談」。往返後端讓「套用」成為有明確語意的動作。
- 套用回應包含新的 `revision`，前端據此同步，避免與 debounce 保存互相覆蓋。

**Alternatives considered**：

- **前端解析並直接套用**：無法滿足歸屬要求，且一致性難以斷言。
- **AI 直接寫入資料庫（tool calling）**：應試者將失去「檢視後再決定是否採用」的環節，
  而那個環節正是評估的觀察點之一。

---

## R-014 程式碼變更歸屬的記錄時機（新增）

**Decision**：`code_change` 於下列兩個時機寫入，兩者互斥：

1. **套用 AI 產出**：`POST /api/answers/{question_id}/apply` → `source = 'ai'`，
   並記錄 `chat_message_id` 與 `block_index`。
2. **應試者自行輸入**：草稿 debounce 保存成功時 → `source = 'candidate'`。
   若該次保存的內容與最近一次 `ai` 變更完全相同，則 MUST NOT 重複記錄——
   那只是套用後的第一次自動保存，不是新的人工輸入。

**Rationale**：

- 不在每次按鍵記錄：`code_change` 的用途是評分材料，不是編輯歷史。以 debounce
  保存為粒度，既能反映「應試者改了什麼」，又不會產生數千筆雜訊。
- 「與最近一次 ai 變更相同則不記錄」這條規則是必要的：沒有它，每次套用 AI 產出後
  都會緊接著出現一筆假的 `candidate` 變更，讓歸屬統計失真——而 SC-010 要求
  歸屬正確率 100%。

**Alternatives considered**：

- **每次按鍵記錄**：資料量爆炸且無評分價值。
- **只在提交時記錄最終狀態**：完全喪失過程資訊，SC-010 無法達成。

---

## R-015 討論模式與實作模式（新增）

**Decision**：兩種模式的差異**僅在系統提示**，且僅影響「是否輸出可套用的程式碼區塊」，
不影響 AI 輸出的完整性。實作方式為兩段不同的 system prompt，
其餘（模型、參數、串流路徑）完全相同。實作模式為預設。

**Rationale**：

- FR-012 明定兩種模式皆 MUST NOT 限制 AI 輸出的完整性。因此模式**不是圍欄的變體**——
  討論模式下 AI 仍可完整說明作法，只是不以可套用的形式輸出。
- 若以輸出後處理實作模式差異，會重蹈憲章 v3.0.0 明文禁止的「輸出限制層」。
  以系統提示表達意圖是唯一不牴觸原則 I 的作法。
- 實作模式為預設：本平台的評估標的是透過 AI 實作，預設不該是討論。

**Alternatives considered**：

- **以後處理移除程式碼區塊**：違反憲章原則 I 對輸出限制層的禁令。
- **只保留單一模式**：FR-012 明定需要兩種。

---

## R-016 後端測試策略（新增）

**Decision**：pytest + pytest-asyncio；HTTP 契約測試以 httpx 的 `ASGITransport`
直接打 ASGI app，不啟動真實伺服器。資料層對測試用的本地 Supabase 實例執行，
每個測試以交易包裹並回滾。

**Rationale**：

- `ASGITransport` 讓契約測試維持毫秒級，與既有 Node 實作的 `app.request()` 等價，
  遷移時測試意圖可一對一對照。
- 憲章原則 III 要求關鍵路徑測試先行，測試必須夠快才可能真的先寫。
- 交易回滾比「每個測試重建資料庫」快兩個數量級。

**Alternatives considered**：

- **對真實 HTTP 伺服器測試**：慢，且需處理埠號競態。
- **完全 mock 資料層**：驗不到 SQL 與約束條件，而 revision 衝突與作者歸屬
  正是靠資料庫約束保證的。

---

## R-017 容器化與部署（憲章原則 V 決定，此處決定用法）

**Decision**：三個容器——`frontend`（Next.js standalone 輸出）、`backend`
（Python 3.12-slim + uv 安裝）、本地開發另加 Supabase CLI 啟動的實例。
以 `docker/compose.yaml` 編排，執行環境對齊 Ubuntu 24.04。

**Rationale**：

- 憲章明定「MUST 容器化」「目標作業系統 MUST 為 Linux Ubuntu 24.04」。
- Next.js 的 `output: 'standalone'` 讓前端映像不含開發相依。
- 後端以 `uv sync --frozen` 安裝，確保容器內與本機的相依完全一致——
  這也是憲章「相依版本 MUST 鎖定」的落實方式。

**Alternatives considered**：

- **單一容器跑前後端**：兩個執行期綁在一起，任一方更新都要重建整包。
- **不容器化直接部署於主機**：違反憲章明文。

---

## R-018 CI 關卡的重新定義（新增）

**Decision**：CI 於 pull request 觸發，關卡為：測試套件、**協作歷程記錄測試**、
`axe-core` 無障礙檢核，外加憑證隔離檢查。原「圍欄越獄測試」關卡移除。

**Rationale**：憲章 v3.0.0 將 CI 關卡由圍欄測試改為協作歷程記錄測試。
後者斷言的是原則 I 的新內容：AI 產出被完整套用、作者歸屬正確。
憑證隔離檢查擴及 Supabase service role key 與 OAuth client secret。

**Alternatives considered**：**保留圍欄測試作為回歸保護**——沒有意義，
圍欄本身已被憲章移除，測試會全數失敗。
