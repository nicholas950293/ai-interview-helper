import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // 圍欄的真實模型測試（T106）僅於排程執行，不納入預設測試套件。
    exclude: ['**/node_modules/**', 'tests/guardrails/live.test.ts'],
    restoreMocks: true,
    pool: 'forks',
  },
});
