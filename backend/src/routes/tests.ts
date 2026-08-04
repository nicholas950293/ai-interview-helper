import { Hono } from 'hono';
import { AppError } from '../lib/errors.js';
import { currentSessionId, requireSession } from '../lib/auth.js';
import {
  findSessionById,
  getPredefinedTests,
  insertTestRun,
  isQuestionInSession,
} from '../db/queries.js';
import { assertWritable } from '../domain/session-state.js';

export const testRoutes = new Hono();

/**
 * POST /api/tests/:questionId
 *
 * 本期回報該題預先定義的測試案例結果（FR-030）。
 * MUST NOT 接受或執行任何用戶端提供的程式碼——請求 body 一律忽略，
 * 真實沙盒執行屬 Roadmap Phase 3，不得提前混入（憲章「開發流程與品質關卡」）。
 * 回應 MUST NOT 包含個別測試案例的名稱或期望值。
 */
testRoutes.post('/tests/:questionId', requireSession, (c) => {
  const sessionId = currentSessionId(c);
  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }
  assertWritable(session.status);

  const questionId = c.req.param('questionId');
  if (!isQuestionInSession(sessionId, questionId)) {
    throw new AppError('NOT_FOUND');
  }

  const cases = getPredefinedTests(questionId);
  const passed = cases.filter((t) => t.expectedPass).length;

  const result = insertTestRun({ sessionId, questionId, passed, total: cases.length });

  return c.json(result);
});
