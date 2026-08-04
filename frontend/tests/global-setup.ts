import { request } from '@playwright/test';

/**
 * 路由暖機。
 *
 * Next 的 dev server 是按需編譯：第一次有人打 `/s/[token]` 才開始編譯該路由，
 * 冷啟動時要數秒到數十秒。Playwright 預設 4 個 worker 平行跑，等於四個測試
 * 同時撞上同一次冷編譯，第一批很容易超過 30 秒的 test timeout——而且每次
 * 中槍的測試都不一樣，看起來像隨機失敗。
 *
 * Vite 時代沒這個問題（轉譯夠快），是 Next 遷移帶進來的。CI 每次都是冷啟動，
 * 因此這裡不是為了本機方便，而是 CI 的穩定性。
 *
 * 這裡只送一次請求把路由編譯起來，不斷言任何行為。
 */
const WARMUP_PATHS = ['/s'];

async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
  const context = await request.newContext({ baseURL });

  try {
    for (const path of WARMUP_PATHS) {
      // 編譯本身可能很久，逾時給得比單一測試寬鬆。
      await context.get(path, { timeout: 120_000 });
    }
  } finally {
    await context.dispose();
  }
}

export default globalSetup;
