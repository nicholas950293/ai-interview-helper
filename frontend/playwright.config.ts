import { defineConfig, devices } from '@playwright/test';

/**
 * 三個 project 對應憲章的三類關卡（T011）：
 *   e2e  —— User Story 的端到端驗證
 *   a11y —— axe-core 對比與 ARIA 檢核（憲章原則 VI）
 *   perf —— 編輯器延遲量測（憲章 v2.0.0 起為回歸偵測，非合併門檻）
 *
 * 桌機限定：viewport 固定為 1440x900，不測行動裝置或窄視窗。
 */
export default defineConfig({
  testDir: './tests',
  // Next 的路由是按需編譯，冷啟動時第一批平行測試會一起卡在編譯上。
  // 先暖機再開跑，否則逾時會落在隨機幾個測試身上，看起來像 flaky。
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'e2e',
      testDir: './tests/e2e',
      testIgnore: ['**/a11y.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'a11y',
      testDir: './tests/e2e',
      testMatch: ['**/a11y.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'perf',
      testDir: './tests/perf',
      // 延遲量測不重試：重試會掩蓋真實的 p95。
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev:backend & npm run dev:frontend',
        // e2e 一律以腳本化的假回應驗證，不需要（也不該需要）真實金鑰。
        env: { AI_FAKE: 'true', PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        // Next 首次啟動要編譯路由，比 Vite 慢得多
        timeout: 180_000,
        cwd: '..',
      },
});
