import { test, expect } from '@playwright/test';
import { seedSession, enterSession } from './helpers';

/**
 * quickstart V5 —— 全螢幕與作答環境監測（US5）。
 *
 * headless Chromium 不允許真的進入全螢幕，因此改以直接觸發
 * `fullscreenchange`／`visibilitychange` 驗證同步與記錄行為，
 * 這也正是 spec 的 Independent Test 所描述的方式（以程式觸發事件）。
 */
test.describe('environment monitoring', () => {
  test('全螢幕按鈕依實際狀態同步，含以 Esc 退出的路徑（US5 情境 1）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 1800 });
    await enterSession(page, url);

    const toggle = page.getByTestId('fullscreen-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toContainText('全螢幕');

    // 模擬瀏覽器進入全螢幕（不經過按鈕，等同 F11）
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => document.documentElement,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('退出全螢幕');

    // 模擬以 Esc 退出
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => null,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('全螢幕期間切換分頁超過 1 秒後返回，顯示提醒並記錄（US5 情境 2）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 1800 });
    await enterSession(page, url);

    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => document.documentElement,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await expect(page.getByTestId('fullscreen-toggle')).toHaveAttribute('aria-pressed', 'true');

    const eventsRequest = page.waitForRequest(
      (req) => req.url().endsWith('/api/events') && req.method() === 'POST'
    );

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(1600);

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const payload = JSON.parse((await eventsRequest).postData() ?? '[]');
    expect(payload).toHaveLength(1);
    expect(payload[0].type).toBe('tab_hidden');
    expect(payload[0].durationMs).toBeGreaterThanOrEqual(1000);
    expect(payload[0].startedAt).toBeTruthy();

    // 提醒為事實描述，不呈現作弊判定結論（FR-026）
    await expect(page.getByText('已記錄一次離開作答視窗').first()).toBeVisible();
  });

  test('未進入全螢幕時不監測（憲章「防作弊監測」限定全螢幕期間）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 1800 });
    await enterSession(page, url);

    let eventsPosted = false;
    page.on('request', (req) => {
      if (req.url().endsWith('/api/events') && req.method() === 'POST') eventsPosted = true;
    });

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1600);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);

    expect(eventsPosted).toBe(false);
  });

  test('短於 1 秒的切換不記錄（濾除焦點抖動）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 1800 });
    await enterSession(page, url);

    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => document.documentElement,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    let eventsPosted = false;
    page.on('request', (req) => {
      if (req.url().endsWith('/api/events') && req.method() === 'POST') eventsPosted = true;
    });

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      setTimeout(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, 300);
    });
    await page.waitForTimeout(1200);

    expect(eventsPosted).toBe(false);
  });
});
