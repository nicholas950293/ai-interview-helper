import { AppError } from '../lib/errors.js';
import type { SessionStatus } from '../lib/schemas.js';

/**
 * 場次狀態機（data-model.md：InterviewSession 狀態轉移）
 *
 *   not_started ──兌換連結──> in_progress ──手動提交──> submitted
 *                                 └──deadline 到期──> expired_submitted
 *
 * 兩個終態皆不可逆；進入終態時所有作答轉為唯讀。
 */
const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  not_started: ['in_progress'],
  in_progress: ['submitted', 'expired_submitted'],
  submitted: [],
  expired_submitted: [],
};

const TERMINAL_STATUSES: readonly SessionStatus[] = ['submitted', 'expired_submitted'];

export function isTerminal(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * 執行狀態轉移。非法轉移一律擲出 `AppError`——
 * 終態回 `SESSION_SUBMITTED`，尚未開始回 `SESSION_NOT_STARTED`。
 */
export function transition(from: SessionStatus, to: SessionStatus): SessionStatus {
  if (canTransition(from, to)) {
    return to;
  }
  if (isTerminal(from)) {
    throw new AppError('SESSION_SUBMITTED');
  }
  throw new AppError('SESSION_NOT_STARTED');
}

/** 僅 `in_progress` 允許寫入草稿、提問與事件。 */
export function isWritable(status: SessionStatus): boolean {
  return status === 'in_progress';
}

/** 寫入前的守門；訊息可直接呈現給應試者（FR-031）。 */
export function assertWritable(status: SessionStatus): void {
  if (isWritable(status)) return;
  throw new AppError(isTerminal(status) ? 'SESSION_SUBMITTED' : 'SESSION_NOT_STARTED');
}

/** 提交的終態：逾期觸發者與手動提交者必須可區分（供 Phase 4 評分後台辨識）。 */
export function nextStatusForSubmission({ expired }: { expired: boolean }): SessionStatus {
  return expired ? 'expired_submitted' : 'submitted';
}
