import { Hono } from 'hono';
import { AppError } from '../lib/errors.js';
import { currentSessionId, requireSession } from '../lib/auth.js';
import { findSessionById, nowIso } from '../db/queries.js';
import { enforceDeadline } from '../domain/submission.js';

export const timeRoutes = new Hono();

/**
 * GET /api/time —— 輕量校時端點，前端每 30 秒呼叫以修正時鐘漂移（R-007）。
 *
 * 若伺服端判定已逾期且場次仍 `in_progress`，此端點 MUST 主動觸發逾時提交，
 * 不依賴前端主動通報（FR-022）。
 */
timeRoutes.get('/time', requireSession, (c) => {
  const sessionId = currentSessionId(c);
  const status = enforceDeadline(sessionId);

  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }

  return c.json({
    serverTime: nowIso(),
    deadlineAt: session.deadline_at,
    status,
  });
});
