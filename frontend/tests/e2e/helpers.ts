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
  // 後端已改為 Python + uv（Increment 1）；seed 由 uv 執行，不再是 npm workspace。
  const args = ['run', 'python', '-m', 'techinterview.db.seed', '--session-id', sessionId];
  if (options.durationSec !== undefined) {
    args.push('--duration', `${options.durationSec}s`);
  }

  const output = execFileSync('uv', args, {
    cwd: resolve(REPO_ROOT, 'backend'),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
  });
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

export interface CodeChangeRow {
  seq: number;
  source: 'candidate' | 'ai';
  content: string;
  revision: number;
  chatMessageId: string | null;
  blockIndex: number | null;
}

/**
 * 直接讀取作者歸屬紀錄。
 *
 * 憲章原則 I 的可評估性只有在資料庫裡成立才算數——畫面上看起來套用成功，
 * 但紀錄寫成 candidate，這個產品就評不了分。因此斷言打到資料層，
 * 不停在 UI。
 */
export function readCodeChanges(sessionId: string, questionId: string): CodeChangeRow[] {
  const script = `
import json, sqlite3, sys
conn = sqlite3.connect("data/portal.db")
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT seq, source, content, revision, chat_message_id, block_index"
    " FROM code_change WHERE session_id = ? AND question_id = ? ORDER BY seq",
    (sys.argv[1], sys.argv[2]),
).fetchall()
print(json.dumps([
    {
        "seq": r["seq"], "source": r["source"], "content": r["content"],
        "revision": r["revision"], "chatMessageId": r["chat_message_id"],
        "blockIndex": r["block_index"],
    }
    for r in rows
]))
`;

  const output = execFileSync('uv', ['run', 'python', '-c', script, sessionId, questionId], {
    cwd: resolve(REPO_ROOT, 'backend'),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
  });

  return JSON.parse(output) as CodeChangeRow[];
}
