import { findSessionById, markTokenConsumed, nowIso, updateSessionStatus } from '../db/queries.js';
import { AppError } from '../lib/errors.js';
import { isTerminal, nextStatusForSubmission } from './session-state.js';
import type { SessionStatus } from '../lib/schemas.js';

/**
 * 提交規則（憲章「提交不可逆」）。
 *
 * 提交 MUST 取每題最後一次成功保存的草稿——那些內容已經在 `answer` 表裡，
 * 因此提交只需要推進場次狀態，不搬動任何作答內容。
 * 這也是為什麼 `POST /api/submit` 不接受 body：前端傳來的內容一律不採信。
 */
export interface SubmissionResult {
  submittedAt: string;
  status: SessionStatus;
}

export function isExpired(deadlineAt: string | null, now: number = Date.now()): boolean {
  return deadlineAt !== null && Date.parse(deadlineAt) <= now;
}

/**
 * 提交場次。已是終態時回傳既有結果（冪等），MUST NOT 覆寫原本的終態——
 * 手動提交與逾時提交的區別要保留給 Phase 4 的評分後台。
 */
export function submitSession(
  sessionId: string,
  options: { expired?: boolean; now?: number } = {}
): SubmissionResult {
  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }

  if (isTerminal(session.status)) {
    return {
      submittedAt: session.submitted_at ?? nowIso(),
      status: session.status,
    };
  }

  if (session.status !== 'in_progress') {
    throw new AppError('SESSION_NOT_STARTED');
  }

  const expired = options.expired ?? isExpired(session.deadline_at, options.now);
  const status = nextStatusForSubmission({ expired });
  const submittedAt = nowIso();

  updateSessionStatus(sessionId, status, submittedAt);
  markTokenConsumed(sessionId);

  return { submittedAt, status };
}

/**
 * 校時時的逾期檢查。伺服端主動判定並強制提交，不依賴前端通報——
 * 前端可能已經關掉分頁，或時鐘被竄改（R-007）。
 */
export function enforceDeadline(sessionId: string, now: number = Date.now()): SessionStatus {
  const session = findSessionById(sessionId);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }

  if (session.status === 'in_progress' && isExpired(session.deadline_at, now)) {
    return submitSession(sessionId, { expired: true, now }).status;
  }

  return session.status;
}
