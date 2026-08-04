import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * 產生一個全新的面試場次並回傳邀請連結。
 *
 * 每個測試各自 seed 一組場次（不同 sessionId），避免平行執行時
 * 互相把對方的場次提交掉。
 */
export function seedSession(options: { durationSec?: number } = {}): {
  sessionId: string;
  url: string;
} {
  const sessionId = `sess-e2e-${randomBytes(4).toString('hex')}`;
  // 直接指定 workspace：走根目錄的 db:seed 別名時，`--` 之後的參數會被外層 npm
  // 當成自己的旗標吃掉，seed 就會退回預設 sessionId 並互相覆寫。
  const args = [
    'run',
    'db:seed',
    '--workspace',
    'backend',
    '--silent',
    '--',
    '--session-id',
    sessionId,
  ];
  if (options.durationSec !== undefined) {
    args.push('--duration', `${options.durationSec}s`);
  }

  const output = execFileSync('npm', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const match = /邀請連結\s*:\s*(\S+)/.exec(output);
  if (!match?.[1]) {
    throw new Error(`seed 未輸出邀請連結：\n${output}`);
  }

  return { sessionId, url: match[1] };
}

/** 進入場次並等待三面板就緒。 */
export async function enterSession(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByRole('tab').first().waitFor();
  await page.getByTestId('code-editor').waitFor();
}

/** 於編輯器輸入內容（先清空既有的 starter code）。 */
export async function typeCode(page: Page, code: string): Promise<void> {
  const editor = page.getByTestId('code-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await editor.pressSequentially(code, { delay: 5 });
}

export async function readCode(page: Page): Promise<string> {
  return page.getByTestId('code-editor').locator('.cm-content').innerText();
}
