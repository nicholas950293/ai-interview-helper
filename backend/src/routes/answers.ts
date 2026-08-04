import { Hono } from 'hono';
import { AppError } from '../lib/errors.js';
import { saveAnswerRequestSchema, saveAnswersBatchRequestSchema } from '../lib/schemas.js';
import { currentSessionId, requireSession } from '../lib/auth.js';
import { findAnswer, findSessionById, isQuestionInSession, upsertAnswer } from '../db/queries.js';
import { assertWritable } from '../domain/session-state.js';
import type { Language } from '../lib/schemas.js';

export const answerRoutes = new Hono();

answerRoutes.use('/answers/*', requireSession);
answerRoutes.use('/answers', requireSession);

function assertSessionWritable(sessionId: string): void {
  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }
  assertWritable(session.status);
}

/** zod 的長度 refine 以 `CONTENT_TOO_LARGE` 作為訊息，於此轉為對應的錯誤碼與 413。 */
function toValidationError(issues: { message: string }[]): AppError {
  return issues.some((i) => i.message === 'CONTENT_TOO_LARGE')
    ? new AppError('CONTENT_TOO_LARGE')
    : new AppError('BAD_REQUEST');
}

interface SaveInput {
  questionId: string;
  language: Language;
  content: string;
  revision: number;
}

/**
 * 單筆保存。`revision` MUST 大於伺服端現值，否則回 `REVISION_STALE`
 * 並附帶伺服端現值供前端修復（contracts/http-api.md）。
 */
function applySave(sessionId: string, input: SaveInput): { savedAt: string; revision: number } {
  if (!isQuestionInSession(sessionId, input.questionId)) {
    throw new AppError('NOT_FOUND');
  }

  const existing = findAnswer(sessionId, input.questionId);
  if (existing && input.revision <= existing.revision) {
    throw new AppError('REVISION_STALE', {
      details: { revision: existing.revision, savedAt: existing.savedAt },
    });
  }

  return upsertAnswer({ sessionId, ...input });
}

// PUT /api/answers/:questionId —— 前端於停止輸入 1000ms 後呼叫（FR-004）
answerRoutes.put('/answers/:questionId', async (c) => {
  const sessionId = currentSessionId(c);
  assertSessionWritable(sessionId);

  const parsed = saveAnswerRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw toValidationError(parsed.error.issues);
  }

  const result = applySave(sessionId, {
    questionId: c.req.param('questionId'),
    ...parsed.data,
  });

  return c.json(result);
});

/**
 * PUT /api/answers —— 離線補送。
 *
 * 依 revision 排序套用；批次中個別的落後 revision 會被略過而非讓整批失敗，
 * 否則一筆過期的離線變更就會擋住其他題目的補送（FR-028）。
 */
answerRoutes.put('/answers', async (c) => {
  const sessionId = currentSessionId(c);
  assertSessionWritable(sessionId);

  const parsed = saveAnswersBatchRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw toValidationError(parsed.error.issues);
  }

  const ordered = [...parsed.data].sort((a, b) => a.revision - b.revision);
  const saved: { questionId: string; savedAt: string; revision: number }[] = [];

  for (const item of ordered) {
    try {
      const result = applySave(sessionId, item);
      saved.push({ questionId: item.questionId, ...result });
    } catch (err) {
      // 落後的 revision 與不屬於本場次的題目一律略過；其餘錯誤照常往上拋。
      if (err instanceof AppError && (err.code === 'REVISION_STALE' || err.code === 'NOT_FOUND')) {
        continue;
      }
      throw err;
    }
  }

  return c.json({ saved });
});
