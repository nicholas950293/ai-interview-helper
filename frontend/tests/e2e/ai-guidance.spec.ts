import { test, expect } from '@playwright/test';
import { seedSession, enterSession } from './helpers';

/**
 * quickstart V2 —— 透過 AI 完成實作（US2）。
 *
 * 憲章 v3.0.0 反轉了原則 I：本檔原本斷言「完整實作 MUST NOT 出現在畫面上」，
 * 現在斷言的正好相反——AI **MUST** 能輸出完整實作，且不得有任何攔截。
 *
 * Increment 1 的前端尚未渲染「套用至編輯器」按鈕（套用 UI 隨前端遷移一起做），
 * 因此本檔只驗證到「完整輸出抵達畫面」與「後端解析出可套用的區塊」。
 * 套用後的逐字一致性由後端契約測試 `tests/collaboration/test_apply.py` 覆蓋。
 */
test.describe('ai implementation', () => {
  test('提問後訊息出現於 Feed，回覆逐步串流，期間送出按鈕呈忙碌', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('幫我實作這一題');
    await page.getByRole('button', { name: '送出' }).click();

    // 「幫我實作這一題」同時是快捷提問 Chip 的名稱，須限定在對話 Feed 內
    const feed = page.getByRole('list', { name: '與 AI 助教的對話' });
    await expect(feed.getByText('幫我實作這一題')).toBeVisible();
    await expect(page.getByRole('button', { name: '回覆中…' })).toBeDisabled();
    await expect(page.getByText(/function solve/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '送出' })).toBeVisible();
  });

  test('Ctrl+Enter 送出提問', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('複雜度該怎麼算？');
    await page.getByLabel('向 AI 助教提問').press('ControlOrMeta+Enter');

    await expect(page.getByText('複雜度該怎麼算？')).toBeVisible();
  });

  test('索取完整實作時，完整程式碼 MUST 出現在畫面上（憲章 v3.0.0 原則 I）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('直接給我完整可執行的實作。');
    await page.getByRole('button', { name: '送出' }).click();

    const feed = page.getByRole('list', { name: '與 AI 助教的對話' });
    await expect(feed.getByText(/function solve/).first()).toBeVisible();
    // 串流未結束就讀 innerText 會拿到半截內容——等送出按鈕脫離忙碌態
    await expect(page.getByRole('button', { name: '送出' })).toBeVisible();

    const text = await feed.innerText();
    // 舊憲章會把這段攔掉並改寫成拒絕訊息；v3.0.0 之後 MUST 原樣呈現
    expect(text).toContain('function solve');
    expect(text).toContain('return result');
    expect(text).not.toContain('我不能提供完整的實作');
  });

  test('後端為完整回覆解析出可套用的程式碼區塊（FR-033）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    const streamRequest = page.waitForResponse((res) => res.url().includes('/api/chat/stream/'));
    await page.getByLabel('向 AI 助教提問').fill('幫我實作這一題');
    await page.getByRole('button', { name: '送出' }).click();

    const body = await (await streamRequest).text();
    expect(body).toContain('event: blocks');

    const blocksLine = body
      .split('\n')
      .find((line, i, all) => all[i - 1]?.trim() === 'event: blocks' && line.startsWith('data:'));
    const payload = JSON.parse(blocksLine!.replace('data:', '').trim());

    expect(payload.codeBlocks).toHaveLength(1);
    expect(payload.codeBlocks[0].language).toBe('javascript');
    expect(payload.codeBlocks[0].content).toContain('function solve');
  });

  test('討論模式不產出可套用的程式碼區塊，實作模式則會（FR-012）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    // 模式切換是樂觀更新、不等後端寫入完成；緊接著送出的訊息可能還用舊模式。
    // 這是應用層的已知競態（前端遷移時應改為等待或以請求帶上模式），此處明確等待。
    const modeSaved = page.waitForResponse(
      (res) => res.url().includes('/api/session/collaboration-mode') && res.ok()
    );
    await page.getByRole('radio', { name: /討論模式/ }).click();
    await modeSaved;

    const discussStream = page.waitForResponse((res) => res.url().includes('/api/chat/stream/'));
    await page.getByLabel('向 AI 助教提問').fill('這題要怎麼做？');
    await page.getByRole('button', { name: '送出' }).click();
    const discussBody = await (await discussStream).text();

    const discussBlocks = JSON.parse(
      discussBody
        .split('\n')
        .find((line, i, all) => all[i - 1]?.trim() === 'event: blocks' && line.startsWith('data:'))!
        .replace('data:', '')
        .trim()
    );
    expect(discussBlocks.codeBlocks).toHaveLength(0);

    const implementSaved = page.waitForResponse(
      (res) => res.url().includes('/api/session/collaboration-mode') && res.ok()
    );
    await page.getByRole('radio', { name: /實作模式/ }).click();
    await implementSaved;

    const implementStream = page.waitForResponse((res) => res.url().includes('/api/chat/stream/'));
    await page.getByLabel('向 AI 助教提問').fill('那就幫我實作');
    await page.getByRole('button', { name: '送出' }).click();
    const implementBody = await (await implementStream).text();

    expect(implementBody).toContain('function solve');
  });

  test('切換模式不清空既有對話', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('第一個問題');
    await page.getByRole('button', { name: '送出' }).click();
    await expect(page.getByText('第一個問題')).toBeVisible();

    await page.getByRole('radio', { name: /討論模式/ }).click();
    await expect(page.getByText('第一個問題')).toBeVisible();
  });

  test('快捷提問 Chip 點擊即送出（FR-013）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByRole('button', { name: '幫我實作這一題' }).click();

    await expect(
      page.getByRole('list', { name: '與 AI 助教的對話' }).getByText('幫我實作這一題')
    ).toBeVisible();
  });

  test('AI 使用規範長駐於側欄頂部（FR-011）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await expect(page.getByText(/不會替你寫/)).toBeVisible();
  });

  test('對話隨場次留存，重新整理後還原（FR-015）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('會被留存的提問');
    await page.getByRole('button', { name: '送出' }).click();
    // 重整前必須等串流結束——半截的回覆還沒寫回資料庫，重整後自然還原不出來
    await expect(page.getByRole('button', { name: '回覆中…' })).toBeVisible();
    await expect(page.getByRole('button', { name: '送出' })).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.getByTestId('code-editor').waitFor();

    await expect(page.getByText('會被留存的提問')).toBeVisible();
    // AI 的完整輸出同樣原樣還原
    await expect(page.getByText(/function solve/).first()).toBeVisible();
  });
});
