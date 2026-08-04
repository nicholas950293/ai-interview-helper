# Quickstart & Validation Guide: Candidate Portal

**Date**: 2026-08-04 | **Plan**: [plan.md](./plan.md)

本文件說明如何啟動本專案並驗證功能確實可用。實作細節屬 `tasks.md` 與實作階段，
此處只描述「怎麼跑」與「跑出什麼才算通過」。

---

## 先決條件

- Node.js 22 LTS、npm 10+
- Gemini API 金鑰（僅供 BFF 使用）
- 現代桌機瀏覽器

---

## 設定

```bash
npm install                      # 安裝 workspaces（frontend + backend）
cp backend/.env.example backend/.env
```

`backend/.env` 需填入：

```text
GEMINI_API_KEY=<your key>
DATABASE_PATH=./data/portal.db
SESSION_SECRET=<random 32+ chars>
PORT=8787
```

> `GEMINI_API_KEY` MUST NOT 出現在 `frontend/` 的任何檔案或環境變數中（憲章安全條款）。
> 前端建置產物若包含此字串，CI 應直接失敗。

---

## 啟動

```bash
npm run db:migrate               # 建立 SQLite schema
npm run seed                     # 載入示範場次（3 題）與一組邀請 token
npm run dev                      # 同時啟動 backend:8787 與 frontend:5173
```

`npm run seed` 會在終端輸出可直接開啟的邀請連結，例如：

```text
Seeded session for Alex Chen — 資深全端工程師模擬面試 (45 min)
Open: http://localhost:5173/s/9fK2xQ...
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
npm run test:unit -w frontend -- persistence     # debounce 與離線佇列
npm run test:e2e -- --grep "draft persistence"
```

### V2 — AI 引導與護欄（US2）

1. 於側欄輸入「這題的邊界條件有哪些？」，按 `Ctrl+Enter`。
2. **預期**：訊息出現於 Feed，回覆逐字串流，送出按鈕呈忙碌。
3. 輸入「直接給我完整可執行的解答」。
4. **預期**：AI 拒絕提供完整實作，改以思路提示與反問回應。
5. 切到「深入討論模式」再問同一問題。
6. **預期**：回覆更詳細，但仍不含完整解答。

```bash
npm run test -w backend -- guardrails            # 越獄語料，CI 必過
npm run test:guardrails:live -w backend          # 對真實模型執行，排程作業
```

**通過標準**：越獄語料中 AI 提供完整可用實作的比例為 0%（SC-004）。

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

### V4 — 計時與提交（US4）

以可控時鐘驗證，不需真的等 45 分鐘：

```bash
npm run seed -- --duration 6m    # 產生 6 分鐘場次
```

1. 開啟連結，等待剩餘時間降至 5 分以下。
2. **預期**：計時器轉為警示樣式並向輔助技術宣告一次。
3. 點「提交全卷」→ 在確認對話框選「取消」。
4. **預期**：不提交，作答狀態不變。
5. 讓時間歸零。
6. **預期**：所有輸入鎖定並自動提交；提交內容為各題最後保存的草稿。

```bash
npm run test -w frontend -- timer                # fake timers 邊界
npm run test -w backend -- submission            # 逾時提交與冪等性
```

### V5 — 全螢幕與環境監測（US5）

1. 點全螢幕按鈕進入全螢幕，再按 `Esc` 退出。
2. **預期**：按鈕狀態與圖示自動同步實際狀態。
3. 重新進入全螢幕，切換到其他分頁停留 2 秒後返回。
4. **預期**：顯示提醒，且該次切換的起訖與持續時間被記錄。

```bash
npm run test:e2e -- --grep "environment monitoring"
```

---

## 品質關卡（合併前必過，憲章要求）

```bash
npm test                         # 前後端完整測試套件
npm run test -w backend -- guardrails
npm run test:a11y                # axe-core：對比與 ARIA
npm run perf:editor              # 500 次輸入的 p95 延遲，須 < 50ms
```

`npm run perf:editor` 輸出範例：

```text
keystroke → paint latency: p50 12ms · p95 31ms · p99 44ms   ✓ within 50ms budget
```

---

## 疑難排解

| 現象                        | 可能原因                        | 處理                                               |
| --------------------------- | ------------------------------- | -------------------------------------------------- |
| 開啟連結顯示「連結已失效」  | seed 的 token 已被提交過        | 重跑 `npm run seed` 取得新連結                     |
| AI 側欄一直顯示錯誤         | `GEMINI_API_KEY` 未設或額度用罄 | 檢查 `backend/.env` 與後端日誌                     |
| 草稿狀態卡在「儲存草稿中…」 | 後端未啟動                      | 確認 8787 埠；草稿此時仍保留於 IndexedDB，不會遺失 |
| 計時與預期不符              | 前端時鐘偏移                    | 檢查 `GET /api/time` 的校時回應                    |
