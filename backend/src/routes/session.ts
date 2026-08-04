import { Hono } from 'hono';
import { AppError } from '../lib/errors.js';
import { guidanceModeRequestSchema, redeemRequestSchema } from '../lib/schemas.js';
import { currentSessionId, issueSessionCookie, redeemToken, requireSession } from '../lib/auth.js';
import {
  findSessionById,
  listAnswers,
  listChatMessages,
  listSessionQuestions,
  nowIso,
  toPublicSession,
  updateGuidanceMode,
} from '../db/queries.js';
import { assertWritable } from '../domain/session-state.js';

export const sessionRoutes = new Hono();

// POST /api/session/redeem —— 唯一不需 cookie 的端點
sessionRoutes.post('/session/redeem', async (c) => {
  const parsed = redeemRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError('BAD_REQUEST');
  }

  const { sessionId } = redeemToken(parsed.data.token);
  await issueSessionCookie(c, sessionId);

  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('TOKEN_INVALID');
  }

  return c.json({
    session: toPublicSession(session),
    // 供前端計算時鐘偏移（R-007）
    serverTime: nowIso(),
  });
});

// GET /api/session —— 頁面載入或重新整理時的完整還原（FR-003）
sessionRoutes.get('/session', requireSession, (c) => {
  const sessionId = currentSessionId(c);
  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }

  return c.json({
    session: toPublicSession(session),
    // listSessionQuestions 只回傳 testCount，predefinedTests 內容不外洩（FR-030）
    questions: listSessionQuestions(sessionId),
    answers: listAnswers(sessionId),
    chat: listChatMessages(sessionId),
    serverTime: nowIso(),
  });
});

// PATCH /api/session/guidance-mode —— 切換引導模式（FR-012）
// 模式僅影響回覆詳細度；圍欄段落不隨模式變動（憲章原則 I）。
sessionRoutes.patch('/session/guidance-mode', requireSession, async (c) => {
  const sessionId = currentSessionId(c);
  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }
  assertWritable(session.status);

  const parsed = guidanceModeRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError('BAD_REQUEST');
  }

  updateGuidanceMode(sessionId, parsed.data.mode);
  return c.json({ mode: parsed.data.mode });
});
