import { Hono } from 'hono';
import { AppError } from '../lib/errors.js';
import {
  ENVIRONMENT_EVENT_MIN_DURATION_MS,
  environmentEventsRequestSchema,
} from '../lib/schemas.js';
import { currentSessionId, requireSession } from '../lib/auth.js';
import { findSessionById, insertEnvironmentEvents } from '../db/queries.js';
import { assertWritable } from '../domain/session-state.js';

export const eventRoutes = new Hono();

/**
 * POST /api/events —— 回報環境事件（FR-025）。可批次。
 *
 * 憲章「防作弊監測」：記錄 MUST 為事實描述，MUST NOT 由前端自行判定作弊結論——
 * 因此本端點只接受 type / startedAt / durationMs 三個客觀欄位，
 * 任何判定性欄位都不在 schema 中，也就無從寫入（FR-026）。
 *
 * `durationMs < 1000` 的項目伺服端 MUST 靜默丟棄（濾除焦點抖動），
 * 計入 `accepted` 之外——前端已有一道門檻，這裡是不信任前端的第二道。
 */
eventRoutes.post('/events', requireSession, async (c) => {
  const sessionId = currentSessionId(c);
  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }
  assertWritable(session.status);

  const parsed = environmentEventsRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError('BAD_REQUEST');
  }

  const accepted = parsed.data.filter(
    (event) => event.durationMs >= ENVIRONMENT_EVENT_MIN_DURATION_MS
  );

  if (accepted.length > 0) {
    insertEnvironmentEvents(sessionId, accepted);
  }

  return c.json({ accepted: accepted.length }, 202);
});
