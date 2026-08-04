import { Hono } from 'hono';
import { currentSessionId, requireSession } from '../lib/auth.js';
import { submitSession } from '../domain/submission.js';

export const submitRoutes = new Hono();

/**
 * POST /api/submit —— 手動提交全卷（FR-021）。
 *
 * 不接受作答內容：伺服端取每題最後保存的草稿。
 * 前端傳來的 body 一律忽略——若採信前端內容，一次竄改就能改寫整份作答。
 */
submitRoutes.post('/submit', requireSession, (c) => {
  const result = submitSession(currentSessionId(c));
  return c.json(result);
});
