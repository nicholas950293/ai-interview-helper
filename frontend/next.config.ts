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

  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
