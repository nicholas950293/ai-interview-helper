import type { NextConfig } from 'next';

/**
 * Next.js 設定（T009）。
 *
 * BFF 代理：前端永不直接呼叫模型服務，也永不持有模型憑證（憲章「憑證隔離」）。
 * 開發期由 rewrites 轉發至 FastAPI。
 *
 * 注意：`rewrites()` 在 **build 時**求值並寫進 routes-manifest.json，
 * standalone 伺服器不會於執行時重新讀取。容器化時 `BACKEND_ORIGIN`
 * 必須在 `docker build` 階段給定（見 docker/Dockerfile.frontend）。
 */
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? 'http://localhost:8787';

const nextConfig: NextConfig = {
  // 容器映像只需要 standalone 產物（T120 的 Dockerfile 依賴此設定）
  output: 'standalone',

  // Next 16 預設會在 frontend/ 產生 AGENTS.md 與 CLAUDE.md。
  // 本專案的規範由 .specify/memory/constitution.md 與 specs/ 承載，
  // 多兩份自動產生、內容重疊又不會同步更新的檔案只會製造矛盾。
  agentRules: false,

  experimental: {
    // rewrites 的代理預設 30 秒切斷。thinking 模型光是等第一個 token 就可能
    // 40 秒以上（實測 gemini-3.5-flash 為 44 秒），30 秒會在後端還在正常工作時
    // 就砍掉連線——瀏覽器只看到 EventSource 斷線重連，拿不到後端的錯誤事件，
    // 顯示的原因因此與真正的原因無關。
    // 此值 MUST 大於後端的 AI_FIRST_TOKEN_TIMEOUT_MS，讓後端的逾時先發生。
    proxyTimeout: 120_000,
  },

  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
