import { test, expect } from '@playwright/test';
import { seedSession, enterSession, typeCode } from './helpers';

/**
 * quickstart V3 —— 跨面板 Context 聯動（US3）。
 *
 * 重點在「送出的 Context 對應當前題目與當前程式碼」，
 * 這類錯誤對應試者不可見卻直接影響評分，因此以實際請求內容斷言。
 */
test.describe('cross-panel context', () => {
  test('停留在 Q2 時「詢問 AI 題目重點」送出的是 Q2（US3 情境 1）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByRole('tab').nth(1).click();

    const request = page.waitForRequest(
      (req) => req.url().endsWith('/api/chat') && req.method() === 'POST'
    );
    await page.getByRole('button', { name: /詢問 AI 題目重點/ }).click();

    const payload = JSON.parse((await request).postData() ?? '{}');
    expect(payload.questionId).toBe('q-lru-cache');
    expect(payload.source).toBe('question_hint');
  });

  test('未等自動保存即「傳送至 AI 側邊欄」，附帶的是最新內容（US3 情境 2）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    // 刻意不等 debounce（1000ms）就送出
    await typeCode(page, 'LATEST_UNSAVED_CONTENT');

    const saveRequest = page.waitForRequest(
      (req) => req.url().includes('/api/answers/') && req.method() === 'PUT'
    );
    const chatRequest = page.waitForRequest(
      (req) => req.url().endsWith('/api/chat') && req.method() === 'POST'
    );

    await page.getByRole('button', { name: /傳送至 AI 側邊欄/ }).click();

    // 保存 MUST 先發生，否則伺服端取到的是舊草稿
    const saved = JSON.parse((await saveRequest).postData() ?? '{}');
    expect(saved.content).toContain('LATEST_UNSAVED_CONTENT');

    const chat = JSON.parse((await chatRequest).postData() ?? '{}');
    expect(chat.attachCode).toBe(true);

    await expect(page.getByRole('button', { name: /已附帶程式碼/ })).toBeVisible();
  });

  test('切換題目時 Feed 插入系統訊息，In-Context 狀態同步更新（US3 情境 3）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await expect(page.getByTestId('in-context-status')).toContainText('Q1・API 限流器');

    await page.getByRole('tab').nth(2).click();

    await expect(page.getByTestId('in-context-status')).toContainText('Q3・訊息佇列');
    await expect(
      page.getByRole('list', { name: '與 AI 助教的對話' }).getByText(/已切換至 Q3/)
    ).toBeVisible();
  });

  test('切換題目後再提問，送出的是新題目（US3 情境 4）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('第一題的問題');
    await page.getByRole('button', { name: '送出' }).click();
    await expect(page.getByText(/function solve/).first()).toBeVisible();

    await page.getByRole('tab').nth(1).click();

    const request = page.waitForRequest(
      (req) => req.url().endsWith('/api/chat') && req.method() === 'POST'
    );
    await page.getByLabel('向 AI 助教提問').fill('第二題的問題');
    await page.getByRole('button', { name: '送出' }).click();

    const payload = JSON.parse((await request).postData() ?? '{}');
    expect(payload.questionId).toBe('q-lru-cache');
  });

  test('快捷提問 Chips 隨題目變動（ui-contracts A-04）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await expect(page.getByRole('button', { name: '分析時間複雜度' })).toBeVisible();

    await page.getByRole('tab').nth(1).click();

    await expect(page.getByRole('button', { name: '如何達成 O(1)？' })).toBeVisible();
    await expect(page.getByRole('button', { name: '分析時間複雜度' })).toBeHidden();
  });
});
