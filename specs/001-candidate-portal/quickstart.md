# Quickstart & Validation Guide: Candidate Portal

**Date**: 2026-08-04 | **Plan**: [plan.md](./plan.md) | **Constitution**: v3.0.2

**最後驗證**：2026-08-04，全部五個情境通過（結果記於各情境末）。

本文件說明如何啟動本專案並驗證功能確實可用。實作細節屬 `tasks.md` 與實作階段，
此處只描述「怎麼跑」與「跑出什麼才算通過」。

---

## 先決條件

**目前必要**：

- Node.js 22 LTS、npm 10+（前端）
- Python 3.12、[uv](https://docs.astral.sh/uv/)（後端；憲章原則 V 指定）
- 現代桌機瀏覽器，視窗寬度 ≥ 1280px

**選用**：Gemini 或 Anthropic API 金鑰。未設定時後端自動改用腳本化假回應
（`AI_FAKE`），串流、區塊解析、套用與作者歸屬的路徑完全相同，
因此本文件的五個情境**不需要金鑰即可全數驗證**。

**尚未需要**：Docker 與 [Supabase CLI](https://supabase.com/docs/guides/local-development)。
兩者是憲章落差表中僅存的兩列，待後續增量；目前持久化以 SQLite 實作，
`db/client.py` 與 `db/queries.py` 的介面已設計為可抽換。

安裝 uv（若尚未安裝）：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

---

## 設定

```bash
npm install                          # 前端（npm workspace）
cd backend && uv sync --frozen && cd ..   # 後端，uv 會自行建立 venv
cp backend/.env.example backend/.env
```

`backend/.env` 至少要有 `SESSION_SECRET`；其餘留空即可跑起來：

```text
SESSION_SECRET=<random 32+ chars>
DATABASE_PATH=./data/portal.db
PORT=8787

# 留空則自動使用腳本化假回應
GOOGLE_API_KEY=
ANTHROPIC_API_KEY=
AI_PROVIDER=google_genai            # 或 anthropic
AI_MODEL=gemini-3.6-flash
```

> 下列憑證 MUST NOT 出現在 `frontend/` 的任何檔案或環境變數中（憲章「憑證隔離」）：
> `GOOGLE_API_KEY`、`ANTHROPIC_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。
> 前端建置產物若包含任一字串，CI 應直接失敗。

產生 `SESSION_SECRET`：

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## 啟動

```bash
npm run db:migrate               # 建立 SQLite schema
npm run seed                     # 載入示範場次（3 題）與一組邀請 token
npm run dev                      # 同時啟動 backend:8787 與 frontend:5173
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

> 根目錄的 script 一律是直接指令、不是巢狀的 `npm run`——後者會把 `--` 之後的
> 參數當成外層 npm 自己的旗標吃掉，`--duration` 與 `--grep` 都會靜默失效。

容器化完整啟動（T120，尚未實作）：

```bash
docker compose -f docker/compose.yaml up --build
```

---

## 驗證情境

每個情境對應 spec 的一則 User Story，可獨立執行。

### V1 — 作答與草稿保全（US1）

1. 開啟邀請連結，確認 Header 顯示姓名、職稱與倒數計時。
2. 在 Q1 輸入程式碼，停手約 1 秒。
3. **預期**：標題列由「儲存草稿中…」轉為「已自動儲存草稿」。
4. 切到 Q2 輸入不同內容，再切回 Q1。
5. **預期**：Q1 內容完整保留，Q2 內容不受影響。
6. 重新整理頁面。
7. **預期**：三題草稿與語言選擇全數還原。

```bash
npm run test:e2e -- --grep "draft persistence"
```

**結果（2026-08-04）**：5 個測試通過 ✅

### V2 — 透過 AI 完成實作（US2）

1. 確認側欄頂部的規範 Banner 說明「AI 全面開放」與「協作歷程會被記錄」。
2. 於側欄輸入「幫我實作這一題」，按 `Ctrl+Enter`。
3. **預期**：訊息出現於 Feed，AI 的**完整實作**逐字串流，送出按鈕呈忙碌。
4. 串流結束後，回覆中的每個程式碼區塊各自帶有「套用至編輯器」按鈕。
5. 點擊其中一個區塊的套用。
6. **預期**：編輯器內容與該區塊**逐字相同**；保存狀態轉為「已自動儲存草稿」。
7. 要求 AI 修改某一段，再套用一次。
8. **預期**：編輯器反映最新版本；兩次變更皆留存且順序可追溯。
9. 手動在編輯器中改一行，等待自動保存。
10. **預期**：該次變更記錄為 `candidate`，與前兩次的 `ai` 變更可區分。
11. 改問一個概念問題（例如「這題該用什麼資料結構？」）。
12. **預期**：AI 回答該問題而不順帶附上完整實作；接著要求實作時仍取得完整版本（FR-012）。
    此項為模型行為，腳本化假回應驗證不了，MUST 以真實模型人工確認。

```bash
npm run test:collaboration                          # 套用一致性與作者歸屬，CI 必過
npm run test:e2e -- --grep "ai implementation"
```

**結果（2026-08-04）**：後端 24 個、端到端 10 個測試通過 ✅
端到端的斷言直接查 `code_change` 資料表，不停在 UI——畫面上套用成功但紀錄
寫成 `candidate`，這個產品就評不了分。

**步驟 11–12 的人工驗證（2026-08-05，Gemini 3.6 Flash，非假回應）** ✅
同一個場次、無任何模式切換：

| 提問 | 回覆 | 可套用區塊 |
| --- | --- | --- |
| 「這題該用什麼資料結構？我還在想，先不要寫程式。」 | 1467 字元的設計說明 | 0 個 |
| 「好，那幫我實作這一題。」 | 3787 字元 | 1 個 |

模式選擇器原本要做的事，系統提示自己做到了（research R-015）。

**通過標準**：

- 套用後編輯器內容與 AI 輸出的該區塊完全一致，比例 100%（SC-004）
- 每一次作答內容變更皆能正確歸屬來源，正確率 100%（SC-004、SC-010）

### V3 — 跨面板聯動（US3）

1. 停留在 Q2，點「詢問 AI 題目重點」。
2. **預期**：AI 回覆針對 Q2 的評分要點。
3. 在 Q2 編輯器輸入程式碼後**立即**點「傳送至 AI 側邊欄」（不等自動保存）。
4. **預期**：訊息標示「已附帶目前程式碼」，AI 檢視的是剛輸入的最新內容。
5. 切換到 Q3。
6. **預期**：Feed 出現題目切換的系統訊息，In-Context 狀態更新為 Q3。

```bash
npm run test:e2e -- --grep "cross-panel context"
```

**結果（2026-08-04）**：5 個測試通過 ✅

### V4 — 計時與提交（US4）

以可控時鐘驗證，不需真的等 45 分鐘：

```bash
npm run seed -- --duration 6m
```

1. 開啟連結，等待剩餘時間降至 5 分以下。
2. **預期**：計時器轉為警示樣式並向輔助技術宣告一次。
3. 點「提交全卷」→ 在確認對話框選「取消」。
4. **預期**：不提交，作答狀態不變。
5. 讓時間歸零。
6. **預期**：所有輸入鎖定並自動提交；提交內容為各題最後保存的草稿。
   進行中的 AI 串流一併中止。

```bash
npm run test:e2e -- --grep "timer and submission"
npm run test:frontend -- timer                   # fake timers 邊界
cd backend && uv run pytest -k submission        # 逾時提交與冪等性
```

**結果（2026-08-04）**：端到端 7 個、前端 15 個、後端 22 個測試通過 ✅

### V5 — 全螢幕與平台外工具監測（US5）

1. 點全螢幕按鈕進入全螢幕，再按 `Esc` 退出。
2. **預期**：按鈕狀態與圖示自動同步實際狀態。
3. 重新進入全螢幕，切換到其他分頁停留 2 秒後返回。
4. **預期**：顯示提醒，且該次切換的起訖與持續時間被記錄。
   提醒為事實描述，不呈現作弊判定結論。

```bash
npm run test:e2e -- --grep "environment monitoring"
```

**結果（2026-08-04）**：4 個測試通過 ✅

---

## 品質關卡（合併前必過，憲章要求）

```bash
npm test                              # 前後端完整測試套件（pytest 142 + vitest 123）
npm run test:collaboration            # 協作歷程記錄：套用一致性 + 作者歸屬（24）
npm run test:a11y                     # axe-core：對比與 ARIA（7）
npm run lint && npm run typecheck && npm run format:check
```

CI 另有一道**憑證隔離**檢查：以假金鑰建置前端，若建置產物含有該字串即失敗。
檢查對象包含 Gemini 金鑰、Anthropic 金鑰與 Supabase service role key。

效能量測保留為產品目標，非憲章關卡（原則 IV 已於 v3.0.0 移除）：

```bash
npm run perf:editor
# keystroke → paint latency: p50 12ms · p95 31ms · p99 44ms
```

---

## 疑難排解

| 現象 | 可能原因 | 處理 |
| --- | --- | --- |
| 開啟連結顯示「連結已失效」 | seed 的 token 已被提交過 | 重跑 `npm run seed` 取得新連結 |
| AI 側欄一直顯示錯誤 | 金鑰未設、額度用罄，或**模型名稱已失效** | 看後端日誌的 `AI 串流失敗` 例外——供應商的 404／401／429 在畫面上都是同一句「稍後再試」，只有日誌分得出來。Google 的模型會下架，`gemini-2.5-flash` 已對新金鑰回 404 |
| 想確認金鑰能用哪些模型 | — | `uv run python -c "from google import genai; from techinterview.core.config import get_settings; [print(m.name) for m in genai.Client(api_key=get_settings().google_api_key).models.list()]"` |
| 「套用至編輯器」沒有反應 | 場次已進入終態，或該訊息不屬於本場次 | 檢查回應的錯誤碼；終態下按鈕應為停用 |
| 套用後內容與畫面上的不一致 | 編輯器的外部寫入沒有帶上 `externalWrite` 標記，因而觸發了 `onChange` | 這會讓套用被當成應試者自行輸入、記為 `candidate`，同時破壞 SC-004 與作者歸屬，屬憲章原則 I 違規，須修正 |
| `npm run seed -- --duration 6m` 沒有效果 | 該 script 被改成巢狀的 `npm run` | 根目錄的 script MUST 為直接指令，否則 `--` 之後的參數會被外層 npm 吃掉 |
| 草稿狀態卡在「儲存草稿中…」 | 後端未啟動 | 確認 8787 埠；草稿此時仍保留於 IndexedDB，不會遺失 |
| 計時與預期不符 | 前端時鐘偏移 | 檢查 `GET /api/time` 的校時回應 |
| `supabase start` 失敗 | Docker 未執行 | 啟動 Docker 後重試（Supabase 為待實作的落差，目前用不到） |
