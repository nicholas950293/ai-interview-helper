import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedSession, enterSession } from '../e2e/helpers';

/**
 * 效能預算即需求（憲章原則 IV）。
 *
 * - 編輯器按鍵到畫面更新 p95 MUST < 50ms（以 500 次連續輸入量測）
 * - 進入場次到可開始輸入 MUST < 30 秒（SC-001）
 *
 * 觸及編輯器輸入路徑的變更，提交訊息 MUST 附上本檔的量測數據。
 */
const KEYSTROKES = 500;
const P95_BUDGET_MS = 50;
const TIME_TO_FIRST_KEYSTROKE_BUDGET_MS = 30_000;

const RESULTS_DIR = resolve(import.meta.dirname, '../../perf-results');

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function report(name: string, samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const stats = {
    name,
    samples: sorted.length,
    p50: Number(percentile(sorted, 50).toFixed(2)),
    p95: Number(percentile(sorted, 95).toFixed(2)),
    p99: Number(percentile(sorted, 99).toFixed(2)),
    max: Number((sorted.at(-1) ?? 0).toFixed(2)),
    budgetMs: P95_BUDGET_MS,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(resolve(RESULTS_DIR, `${name}.json`), JSON.stringify(stats, null, 2));

  console.log(
    `keystroke → paint latency: p50 ${stats.p50}ms · p95 ${stats.p95}ms · p99 ${stats.p99}ms ` +
      `${stats.p95 < P95_BUDGET_MS ? '✓ within' : '✗ exceeds'} ${P95_BUDGET_MS}ms budget`
  );

  return stats;
}

test.describe('editor performance', () => {
  test.setTimeout(180_000);

  test(`按鍵到畫面更新 p95 < ${P95_BUDGET_MS}ms（${KEYSTROKES} 次輸入）`, async ({ page }) => {
    const { url } = seedSession({ durationSec: 3600 });
    await enterSession(page, url);

    const editor = page.getByTestId('code-editor').locator('.cm-content');
    await editor.click();

    const samples = await page.evaluate(async (count) => {
      const content = document.querySelector('.cm-content') as HTMLElement;
      const results: number[] = [];

      for (let i = 0; i < count; i += 1) {
        const start = performance.now();

        content.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'x',
            bubbles: true,
            cancelable: true,
          })
        );

        // 等到瀏覽器實際完成一次繪製，量的才是「到畫面更新」
        await new Promise<void>((res) => requestAnimationFrame(() => res()));
        results.push(performance.now() - start);
      }

      return results;
    }, KEYSTROKES);

    const stats = report('editor-latency', samples);
    expect(stats.samples).toBe(KEYSTROKES);
    expect(stats.p95).toBeLessThan(P95_BUDGET_MS);
  });

  test(`進入場次到可開始輸入 < ${TIME_TO_FIRST_KEYSTROKE_BUDGET_MS / 1000} 秒（SC-001）`, async ({
    page,
  }) => {
    const { url } = seedSession({ durationSec: 3600 });

    const start = Date.now();
    await page.goto(url);
    // 「可開始輸入」＝ 編輯器已掛載且可聚焦
    await page.getByTestId('code-editor').locator('.cm-content').click();
    const elapsed = Date.now() - start;

    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(
      resolve(RESULTS_DIR, 'time-to-first-keystroke.json'),
      JSON.stringify({ elapsedMs: elapsed, budgetMs: TIME_TO_FIRST_KEYSTROKE_BUDGET_MS }, null, 2)
    );

    console.log(
      `time to first keystroke: ${elapsed}ms (budget ${TIME_TO_FIRST_KEYSTROKE_BUDGET_MS}ms)`
    );
    expect(elapsed).toBeLessThan(TIME_TO_FIRST_KEYSTROKE_BUDGET_MS);
  });
});
