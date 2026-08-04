import { test, expect } from '@playwright/test';
import { seedSession, enterSession, typeCode } from './helpers';

/**
 * quickstart V4 —— 計時與提交（US4）。
 *
 * 以短場次取代真的等 45 分鐘：`seedSession({ durationSec })` 直接產生
 * 一個即將到期的場次，讓警示與強制提交都能在秒級驗證。
 */
test.describe('timer and submission', () => {
  test('倒數計時器持續顯示剩餘時間', async ({ page }) => {
    const { url } = seedSession({ durationSec: 1800 });
    await enterSession(page, url);

    const timer = page.getByTestId('countdown');
    await expect(timer).toBeVisible();
    await expect(timer).toHaveAttribute('data-phase', 'normal');
    await expect(timer).toContainText(/\d+:\d{2}/);
  });

  test('剩餘不足 5 分鐘時轉為警示樣式（US4 情境 1）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 240 });
    await enterSession(page, url);

    await expect(page.getByTestId('countdown')).toHaveAttribute('data-phase', 'warning');
  });

  test('提交確認對話框選擇取消時不提交（US4 情境 2）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 1800 });
    await enterSession(page, url);

    await page.getByRole('button', { name: '提交全卷' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // 仍可繼續作答
    await expect(page.getByLabel('程式語言')).toBeEnabled();
  });

  test('確認提交後顯示成功提示，所有作答區轉為唯讀（US4 情境 3）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 1800 });
    await enterSession(page, url);

    await typeCode(page, 'MY_FINAL_ANSWER');
    await expect(page.getByTestId('save-indicator')).toHaveText(/已自動儲存草稿/);

    await page.getByRole('button', { name: '提交全卷' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();

    // Radix Toast 會同時渲染標題與 aria-live announce 區域，文字會匹配到多個節點
    await expect(page.getByText('已成功提交全卷').first()).toBeVisible();
    await expect(page.getByLabel('程式語言')).toBeDisabled();
    await expect(page.getByRole('button', { name: '程式碼格式化' })).toBeDisabled();
    await expect(page.getByLabel('向 AI 提問')).toBeDisabled();
    await expect(page.getByRole('button', { name: '提交全卷' })).toBeDisabled();
  });

  test('提交後重新載入仍為唯讀，作答內容保留', async ({ page }) => {
    const { url } = seedSession({ durationSec: 1800 });
    await enterSession(page, url);

    await typeCode(page, 'PERSISTED_ANSWER');
    await expect(page.getByTestId('save-indicator')).toHaveText(/已自動儲存草稿/);

    await page.getByRole('button', { name: '提交全卷' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    await expect(page.getByText('已成功提交全卷').first()).toBeVisible();

    await page.reload();
    await page.getByTestId('code-editor').waitFor();

    await expect(page.getByLabel('程式語言')).toBeDisabled();
    expect(await page.getByTestId('code-editor').innerText()).toContain('PERSISTED_ANSWER');
  });

  test('時間歸零時鎖定全部輸入並自動提交最後保存的草稿（US4 情境 4）', async ({ page }) => {
    // 場次只有 8 秒：足夠輸入並等到自動保存，之後歸零
    const { url } = seedSession({ durationSec: 8 });
    await enterSession(page, url);

    await typeCode(page, 'LAST_SAVED_DRAFT');
    await expect(page.getByTestId('save-indicator')).toHaveText(/已自動儲存草稿/);

    await expect(page.getByTestId('countdown')).toHaveAttribute('data-phase', 'expired', {
      timeout: 15_000,
    });

    // 計時器的 sr-only 宣告與 Toast 都含這段文字
    await expect(page.getByText('時間已到').first()).toBeVisible();
    await expect(page.getByLabel('程式語言')).toBeDisabled();
    await expect(page.getByLabel('向 AI 提問')).toBeDisabled();

    await page.reload();
    await page.getByTestId('code-editor').waitFor();
    expect(await page.getByTestId('code-editor').innerText()).toContain('LAST_SAVED_DRAFT');
  });

  test('逾期的場次無法再進入可作答狀態（FR-031）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 3 });
    await enterSession(page, url);

    await expect(page.getByTestId('countdown')).toHaveAttribute('data-phase', 'expired', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: '提交全卷' })).toBeDisabled();
  });
});
