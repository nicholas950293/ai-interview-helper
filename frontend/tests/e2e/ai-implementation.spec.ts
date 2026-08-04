import { test, expect } from '@playwright/test';
import { seedSession, enterSession, readCode, readCodeChanges } from './helpers';

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

    await page.getByLabel('向 AI 提問').fill('幫我實作這一題');
    await page.getByRole('button', { name: '送出' }).click();

    // 「幫我實作這一題」同時是快捷提問 Chip 的名稱，須限定在對話 Feed 內
    const feed = page.getByRole('list', { name: '與 AI 的對話' });
    await expect(feed.getByText('幫我實作這一題')).toBeVisible();
    await expect(page.getByRole('button', { name: '回覆中…' })).toBeDisabled();
    await expect(page.getByText(/function solve/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '送出' })).toBeVisible();
  });

  test('Ctrl+Enter 送出提問', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 提問').fill('複雜度該怎麼算？');
    await page.getByLabel('向 AI 提問').press('ControlOrMeta+Enter');

    await expect(page.getByText('複雜度該怎麼算？')).toBeVisible();
  });

  test('索取完整實作時，完整程式碼 MUST 出現在畫面上（憲章 v3.0.0 原則 I）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 提問').fill('直接給我完整可執行的實作。');
    await page.getByRole('button', { name: '送出' }).click();

    const feed = page.getByRole('list', { name: '與 AI 的對話' });
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
    await page.getByLabel('向 AI 提問').fill('幫我實作這一題');
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

  test('快捷提問 Chip 點擊即送出（FR-013）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByRole('button', { name: '幫我實作這一題' }).click();

    await expect(
      page.getByRole('list', { name: '與 AI 的對話' }).getByText('幫我實作這一題')
    ).toBeVisible();
  });

  test('AI 協作說明長駐於側欄頂部（FR-011）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await expect(page.getByText(/AI 全面開放/)).toBeVisible();
    await expect(page.getByText(/都會被記錄並作為評分依據/)).toBeVisible();
  });

  test('套用 AI 產出後，編輯器內容逐字一致且記為 ai（SC-004、FR-035）', async ({ page }) => {
    const { sessionId, url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 提問').fill('幫我實作這一題');
    await page.getByRole('button', { name: '送出' }).click();
    // 套用按鈕要等 blocks 事件抵達才會渲染
    const applyButton = page.getByRole('button', { name: '套用至編輯器' });
    await expect(applyButton).toBeVisible();

    const blockText = await page
      .getByRole('list', { name: '與 AI 的對話' })
      .getByRole('region', { name: '程式碼' })
      .innerText();

    await applyButton.click();
    await expect(page.getByText('已自動儲存草稿')).toBeVisible();

    // 逐字一致：CodeMirror 的 innerText 會逐行還原，比對去除行尾空白後的內容
    const editorText = await readCode(page);
    const normalise = (s: string) =>
      s
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''))
        .join('\n')
        .trim();
    expect(normalise(editorText)).toBe(normalise(blockText));

    const changes = readCodeChanges(sessionId, 'q-rate-limiter');
    const aiChange = changes.filter((c) => c.source === 'ai').at(-1);
    expect(aiChange).toBeDefined();
    expect(aiChange!.chatMessageId).not.toBeNull();
    expect(aiChange!.blockIndex).toBe(0);
    expect(normalise(aiChange!.content)).toBe(normalise(blockText));
  });

  test('套用後的自動保存 MUST NOT 把 AI 的產出記成應試者自行輸入（憲章原則 I）', async ({
    page,
  }) => {
    const { sessionId, url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 提問').fill('幫我實作這一題');
    await page.getByRole('button', { name: '送出' }).click();
    await page.getByRole('button', { name: '套用至編輯器' }).click();
    await expect(page.getByText('已自動儲存草稿')).toBeVisible();

    // 套用會整份取代編輯器內容；若那次同步被當成一般輸入，
    // debounce 一到就會補上一筆 candidate，兩者從此無法區分。
    await page.waitForTimeout(1500);

    const changes = readCodeChanges(sessionId, 'q-rate-limiter');
    const lastAiIndex = changes.map((c) => c.source).lastIndexOf('ai');
    expect(lastAiIndex).toBeGreaterThanOrEqual(0);
    expect(changes.slice(lastAiIndex + 1).filter((c) => c.source === 'candidate')).toEqual([]);
  });

  test('之後自行修改仍記為 candidate，兩種來源並存可追溯', async ({ page }) => {
    const { sessionId, url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 提問').fill('幫我實作這一題');
    await page.getByRole('button', { name: '送出' }).click();
    await page.getByRole('button', { name: '套用至編輯器' }).click();
    await expect(page.getByText('已自動儲存草稿')).toBeVisible();

    // 套用後 saveState 已是 saved，等「已自動儲存草稿」會立刻通過而測不到這次輸入；
    // 必須等真正的 PUT 回來，才知道 candidate 那筆已經寫進去了。
    const draftSaved = page.waitForResponse(
      (res) => res.request().method() === 'PUT' && /\/api\/answers\//.test(res.url()) && res.ok()
    );
    await page.getByTestId('code-editor').locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n// 我自己補的註解');
    await draftSaved;

    const changes = readCodeChanges(sessionId, 'q-rate-limiter');
    const sources = changes.map((c) => c.source);
    expect(sources).toContain('ai');
    expect(sources.lastIndexOf('candidate')).toBeGreaterThan(sources.lastIndexOf('ai'));
    expect(changes.at(-1)!.content).toContain('我自己補的註解');
  });

  test('對話隨場次留存，重新整理後還原（FR-015）', async ({ page }) => {
    const { url } = seedSession();
    await enterSession(page, url);

    await page.getByLabel('向 AI 提問').fill('會被留存的提問');
    await page.getByRole('button', { name: '送出' }).click();
    // 重整前必須等串流結束——半截的回覆還沒寫回資料庫，重整後自然還原不出來。
    // 以「套用按鈕出現」為準：它在 blocks 事件之後才渲染，代表回覆已完整落地。
    // 不改用「回覆中…」消失來判斷——假回應只跑約 100ms，那個狀態本來就抓不穩。
    await expect(page.getByRole('button', { name: '套用至編輯器' })).toBeVisible();

    await page.reload();
    await page.getByTestId('code-editor').waitFor();

    await expect(page.getByText('會被留存的提問')).toBeVisible();
    // AI 的完整輸出同樣原樣還原
    await expect(page.getByText(/function solve/).first()).toBeVisible();
  });
});
