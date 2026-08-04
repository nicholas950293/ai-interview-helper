# Render 部署環境變數

兩個 Render 服務，**皆以 Docker 部署**（Runtime 選 Docker）。

> **Build Command 與 Start Command 一律留空。** 映像的 `CMD` 已經是對的，
> `PORT` 由 Render 注入後應用程式會自行讀取。
>
> 這裡踩過一次：前端映像是 Next 的 **standalone** 產物，裡面只有 `server.js`
> 與 13 個執行期套件，**沒有 `next` CLI**（build 才需要，standalone 的重點就是
> 不帶它）。在 Start Command 填 `npx next start` 會找不到而轉向 registry 下載，
> 容器隨即以狀態碼 128 結束——而建置階段完全成功，log 看起來一切正常。

> 憲章「憑證隔離」：本檔的任何金鑰 MUST NOT 進入版本控管。
> 下方的值為佔位符，實際值請填在 Render 的 Environment 頁面。

---

## backend（Python Web Service）

```dotenv
# --- 執行環境 --------------------------------------------------------------
# PORT 由 Render 自動注入，MUST NOT 自行設定。
# 啟動指令要綁上它：uvicorn techinterview.main:app --host 0.0.0.0 --port $PORT
ENVIRONMENT=production

# --- 資料庫（Supabase，ap-southeast-1）-------------------------------------
# 主機用 pooler 而非 db.<ref>.supabase.co：後者對新專案已不再提供，
# 且 Render 的對外連線是 IPv4，直連主機是 IPv6-only。
# 埠 5432 為 session mode——MUST 用它，不要用 6543 的 transaction mode：
# psycopg 預設會使用 prepared statement，transaction pooling 不支援。
DATABASE_URL=postgresql://postgres.liyjwovgafpxjgjgykqi:<DB_PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres

# --- Session Cookie --------------------------------------------------------
# 至少 32 字元。MUST 與本機開發用的不同——本機那組已進過聊天紀錄。
# 產生方式：python3 -c "import secrets; print(secrets.token_hex(32))"
SESSION_SECRET=<32_BYTE_HEX>
# 正式環境走 HTTPS，MUST 為 true
COOKIE_SECURE=true

# --- AI（憲章原則 V：雙供應商，一律經 LangChain）---------------------------
GOOGLE_API_KEY=<GEMINI_KEY>
ANTHROPIC_API_KEY=<CLAUDE_KEY>
AI_PROVIDER=google_genai
AI_MODEL=gemini-3.6-flash

# 主要供應商 429／不可用時由此接手。兩者皆填才生效。
# Gemini 免費層每個模型每天僅 20 次請求，正式環境強烈建議設定。
AI_FALLBACK_PROVIDER=anthropic
AI_FALLBACK_MODEL=claude-sonnet-4-5

# --- 串流逾時 --------------------------------------------------------------
# 兩段式：first_token 給 thinking 模型推理的時間，idle 管開始吐字後的斷流。
# 實測 gemini-3.5-flash 要 44 秒才吐第一個 token，90 秒是留了餘裕的值。
# 順序 MUST 為 idle < first_token < 平台的連線逾時。
AI_FIRST_TOKEN_TIMEOUT_MS=90000
AI_STREAM_TIMEOUT_MS=20000

# 假回應在 production 一律無效（見 config.ai_fake_enabled），設了也不會生效。
AI_FAKE=false

# --- Supabase Data API（目前無消費者）--------------------------------------
# 後端以 psycopg 直連 Postgres，不走 PostgREST。這兩個變數保留供日後使用；
# 現在不填也能正常運作。
SUPABASE_URL=https://liyjwovgafpxjgjgykqi.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

**Render 服務設定**

| 欄位 | 值 |
| --- | --- |
| Runtime | Docker |
| Dockerfile Path | `./docker/Dockerfile.backend` |
| Docker Build Context | `.`（倉庫根目錄——Dockerfile 會 `COPY backend/...`） |
| Build Command | 留空 |
| Start Command | 留空 |

映像的 `CMD` 為 `uvicorn techinterview.main:app --host 0.0.0.0 --port 8787`。
Render 注入的 `PORT` 若不是 8787，於 Environment 補一個同名變數即可
（uvicorn 的 `--port` 已寫死，必要時改 Dockerfile 或以 Docker Command 覆寫）。

---

## frontend（Docker Web Service）

**Environment**（執行時）

```dotenv
# PORT 由 Render 自動注入，MUST NOT 自行設定。
NODE_ENV=production
```

**Docker Build Arguments**（建置時，**不是** Environment）

```
BACKEND_ORIGIN=https://<backend-service>.onrender.com
```

`BACKEND_ORIGIN` MUST 設在 Build Arguments：`next.config.ts` 的 `rewrites()` 在
build 階段求值並寫進 routes-manifest.json，執行時不會重新讀取。
設在 Environment 的話部署會成功，但前端會編譯成打 `localhost:8787`，
所有 API 呼叫失敗——症狀與本次的 128 完全不同，且不易查。
改了這個值 MUST 重新建置，重啟無效。

**Render 服務設定**

| 欄位 | 值 |
| --- | --- |
| Runtime | Docker |
| Dockerfile Path | `./docker/Dockerfile.frontend` |
| Docker Build Context | `.`（倉庫根目錄） |
| Build Command | 留空 |
| Start Command | 留空 |

---

## 部署前必須先改的三件事

1. **資料庫 schema 尚未套用到正式環境的話要先跑遷移**。目前線上 Supabase 專案
   已於 2026-08-05 套用完畢；換專案時：
   ```bash
   DATABASE_URL=<正式連線字串> uv run python -m techinterview.db.migrate
   ```
2. **題目資料要 seed**，否則場次沒有題目：
   ```bash
   DATABASE_URL=<正式連線字串> npm run db:seed
   ```

## 要驗證的一件事

本專案的 AI 回覆是 **SSE 長連線**，實測完整實作可跑 73 秒。Render 的反向代理
對長連線與串流的逾時行為 MUST 先確認——這正是本機踩過的坑（Next 代理預設
30 秒切斷，後端還在正常工作就被砍，瀏覽器只看到「連線中斷」）。

若 Render 的逾時短於 `AI_FIRST_TOKEN_TIMEOUT_MS`，同樣的錯誤會重演。
確認後把 `AI_FIRST_TOKEN_TIMEOUT_MS` 調到該值以下，讓後端的逾時先發生。
