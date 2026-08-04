import { test, expect } from '@playwright/test';
import { seedSession, enterSession, typeCode, readCode } from './helpers';

/**
 * quickstart V1 —— 作答與草稿保全（US1）。
 * 完全不涉及 AI 功能，可獨立驗證 MVP 是否成立。
 */
test.describe('draft persistence', () => {
  test('停止輸入後自動保存，狀態指示轉為「已自動儲存草稿」', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await typeCode(page, 'const answer = 42;');

    await expect(page.getByTestId('save-indicator')).toHaveText(/已自動儲存草稿/, {
      timeout: 5000,
    });
  });

  test('切換題目後再切回，各題內容互不覆蓋', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await typeCode(page, 'CODE_FOR_Q1');
    await expect(page.getByTestId('save-indicator')).toHaveText(/已自動儲存草稿/);

    await page.getByRole('tab').nth(1).click();
    await typeCode(page, 'CODE_FOR_Q2');
    await expect(page.getByTestId('save-indicator')).toHaveText(/已自動儲存草稿/);

    await page.getByRole('tab').nth(0).click();
    expect(await readCode(page)).toContain('CODE_FOR_Q1');

    await page.getByRole('tab').nth(1).click();
    expect(await readCode(page)).toContain('CODE_FOR_Q2');
  });

  test('重新載入頁面後，草稿與語言選擇完整還原', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('程式語言').selectOption('python');
    await typeCode(page, 'RELOAD_ME');
    await expect(page.getByTestId('save-indicator')).toHaveText(/已自動儲存草稿/);

    await page.reload();
    await page.getByTestId('code-editor').waitFor();

    expect(await readCode(page)).toContain('RELOAD_ME');
    await expect(page.getByLabel('程式語言')).toHaveValue('python');
  });

  test('執行單元測試回報通過數與總數，且不揭露測試案例內容（FR-008 / FR-030）', async ({
    page,
  }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    const responsePromise = page.waitForResponse((res) => res.url().includes('/api/tests/'));
    await page.getByRole('button', { name: '執行單元測試' }).click();

    const body = await (await responsePromise).text();
    expect(body).not.toContain('expectedPass');

    await expect(page.getByTestId('test-result')).toHaveText(/通過 \d+\/\d+ 個測試案例/);
  });

  test('切換語言且已有內容時，先徵詢是否以啟始樣板取代（FR-005）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await typeCode(page, 'MY_OWN_CODE');
    await page.getByLabel('程式語言').selectOption('go');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '保留現有內容' }).click();
    expect(await readCode(page)).toContain('MY_OWN_CODE');
  });
});
