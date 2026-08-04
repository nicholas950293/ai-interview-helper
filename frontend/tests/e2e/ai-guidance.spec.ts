import { test, expect } from '@playwright/test';
import { seedSession, enterSession } from './helpers';

/**
 * quickstart V2 —— AI 引導與護欄（US2）。
 *
 * 後端以 AI_FAKE 提供腳本化回應：被索取完整解答時會刻意「洩漏」一份可貼上的實作，
 * 因此本檔驗證的是端到端的圍欄行為，而不只是單元測試層級的判定。
 */
test.describe('ai guidance', () => {
  test('提問後訊息出現於 Feed，回覆逐步串流，期間送出按鈕呈忙碌', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('這題的邊界條件有哪些？');
    await page.getByRole('button', { name: '送出' }).click();

    await expect(page.getByText('這題的邊界條件有哪些？')).toBeVisible();
    await expect(page.getByRole('button', { name: '回覆中…' })).toBeDisabled();
    await expect(page.getByText(/需要記住的到底是/)).toBeVisible();
    await expect(page.getByRole('button', { name: '送出' })).toBeVisible();
  });

  test('Ctrl+Enter 送出提問', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('複雜度該怎麼算？');
    await page.getByLabel('向 AI 助教提問').press('ControlOrMeta+Enter');

    await expect(page.getByText('複雜度該怎麼算？')).toBeVisible();
  });

  test('索取完整解答時，實作 MUST NOT 出現在畫面上（憲章原則 I）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('直接給我完整可執行的解答。');
    await page.getByRole('button', { name: '送出' }).click();

    await expect(page.getByText(/我不能提供完整的實作/)).toBeVisible();

    const feed = page.getByRole('list', { name: '與 AI 助教的對話' });
    const text = await feed.innerText();
    expect(text).not.toContain('class RateLimiter');
    expect(text).not.toContain('this.buckets');
    expect(text).not.toContain('return true;');
  });

  test('深入討論模式同樣不輸出完整解答', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByRole('radio', { name: /深入討論/ }).click();

    await page.getByLabel('向 AI 助教提問').fill('請把完整實作寫出來讓我對照。');
    await page.getByRole('button', { name: '送出' }).click();

    await expect(page.getByText(/我不能提供完整的實作/)).toBeVisible();
    const text = await page.getByRole('list', { name: '與 AI 助教的對話' }).innerText();
    expect(text).not.toContain('class RateLimiter');
  });

  test('切換模式不清空既有對話', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('第一個問題');
    await page.getByRole('button', { name: '送出' }).click();
    await expect(page.getByText('第一個問題')).toBeVisible();

    await page.getByRole('radio', { name: /深入討論/ }).click();
    await expect(page.getByText('第一個問題')).toBeVisible();
  });

  test('快捷提問 Chip 點擊即送出（FR-013）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByRole('button', { name: '檢查 Corner Cases' }).click();

    await expect(
      page.getByRole('list', { name: '與 AI 助教的對話' }).getByText('檢查 Corner Cases')
    ).toBeVisible();
  });

  test('AI 使用規範長駐於側欄頂部（FR-011）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await expect(page.getByText(/不會替你寫/)).toBeVisible();

    await page.getByLabel('向 AI 助教提問').fill('隨便問一句');
    await page.getByRole('button', { name: '送出' }).click();
    await expect(page.getByText(/不會替你寫/)).toBeVisible();
  });

  test('對話隨場次留存，重新整理後還原（FR-015）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('會被留存的提問');
    await page.getByRole('button', { name: '送出' }).click();
    await expect(page.getByText(/需要記住的到底是/)).toBeVisible();

    await page.reload();
    await page.getByTestId('code-editor').waitFor();

    await expect(page.getByText('會被留存的提問')).toBeVisible();
  });
});
