import { defineConfig, devices } from '@playwright/test';

/**
 * 三個 project 對應憲章的三類關卡：
 *   e2e  —— User Story 的端到端驗證
 *   a11y —— axe-core 對比與 ARIA 檢核（憲章原則 V）
 *   perf —— 編輯器延遲量測（憲章原則 IV）
 *
 * 桌機限定：viewport 固定為 1440x900，不測行動裝置或窄視窗。
 */
export default defineConfig({
  testDir: './tests',
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
        // e2e 以腳本化的假回應驗證串流與圍欄，不需要（也不該需要）真實金鑰。
        env: { AI_FAKE: 'true', PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        cwd: '..',
      },
});
