import type { NextConfig } from 'next';

/**
 * Next.js 設定（T009）。
 *
 * BFF 代理不在此設定：`/api/*` 由 src/app/api/[...path]/route.ts 於**執行時**
 * 轉發。原本用 rewrites，但它在 build 時求值並寫進 routes-manifest，
 * 後端位址會被烘進映像——一份映像只能對應一個環境。詳見該檔的說明。
 */
const nextConfig: NextConfig = {
  // 容器映像只需要 standalone 產物（T120 的 Dockerfile 依賴此設定）
  output: 'standalone',

  // Next 16 預設會在 frontend/ 產生 AGENTS.md 與 CLAUDE.md。
  // 本專案的規範由 .specify/memory/constitution.md 與 specs/ 承載，
  // 多兩份自動產生、內容重疊又不會同步更新的檔案只會製造矛盾。
  agentRules: false,
};

export default nextConfig;
