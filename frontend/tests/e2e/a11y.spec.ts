import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, enterSession } from './helpers';

/**
 * 無障礙檢核（憲章原則 V / SC-008）。
 *
 * 「全部文字與背景組合通過 WCAG AA 對比檢核，核心流程可全鍵盤完成」——
 * 對比由 axe-core 檢查，鍵盤路徑另以焦點順序驗證。
 */
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('accessibility', () => {
  test('三面板版面無 WCAG A / AA 違規', async ({ page }) => {
    const { url } = seedSession({ durationSec: 3600 });
    await enterSession(page, url);

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();

    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length, help: v.help }))
    ).toEqual([]);
  });

  test('文字與背景對比全數通過（單獨檢核，避免被其他違規掩蓋）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 3600 });
    await enterSession(page, url);

    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();

    expect(results.violations).toEqual([]);
  });

  test('AI 對話進行中的狀態同樣無違規', async ({ page }) => {
    const { url } = seedSession({ durationSec: 3600 });
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('邊界條件有哪些？');
    await page.getByRole('button', { name: '送出' }).click();
    // 串流途中就掃描——pending 態的 aria-live 與忙碌按鈕也必須無違規。
    // 錨定在假回應的開頭句，確保只到了第一批 token 就開始檢核。
    await expect(page.getByText(/我先照你的需求做一版/)).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('程式碼區塊與套用按鈕無違規，且可存取名稱能區分不同區塊（T117）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 3600 });
    await enterSession(page, url);

    await page.getByLabel('向 AI 助教提問').fill('幫我實作這一題');
    await page.getByRole('button', { name: '送出' }).click();
    await expect(page.getByRole('button', { name: '套用至編輯器' })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);

    // 區塊可捲動，因此 MUST 可鍵盤聚焦——否則純鍵盤使用者看不到超出視窗的部分
    await expect(
      page.getByRole('list', { name: '與 AI 助教的對話' }).getByRole('region', { name: '程式碼' })
    ).toBeVisible();
  });

  test('提交確認對話框無違規（焦點陷阱與 ARIA 由 Radix 提供）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 3600 });
    await enterSession(page, url);

    await page.getByRole('button', { name: '提交全卷' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('核心流程可全鍵盤完成：題目 → 作答 → 提問 → 提交', async ({ page }) => {
    const { url } = seedSession({ durationSec: 3600 });
    await enterSession(page, url);

    // 題目頁籤可用方向鍵切換
    await page.getByRole('tab').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');

    // 編輯器可聚焦並以 Tab 縮排（不會跳出編輯器）
    await page.getByTestId('code-editor').locator('.cm-content').focus();
    await page.keyboard.type('const a = 1;');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('code-editor').locator('.cm-content')).toBeFocused();

    // AI 提問可用 Ctrl+Enter 送出
    await page.getByLabel('向 AI 助教提問').focus();
    await page.keyboard.type('這題的重點是什麼？');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByText('這題的重點是什麼？')).toBeVisible();

    // 提交對話框可用鍵盤開啟與取消
    await page.getByRole('button', { name: '提交全卷' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('快捷鍵有可見說明（憲章原則 V）', async ({ page }) => {
    const { url } = seedSession({ durationSec: 3600 });
    await enterSession(page, url);

    await page.getByRole('button', { name: '鍵盤快捷鍵說明' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Ctrl / ⌘ + Enter');
    await expect(dialog).toContainText('Tab / Shift + Tab');
    await expect(dialog).toContainText('Ctrl / ⌘ + S');
    await expect(dialog).toContainText('Esc');

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
