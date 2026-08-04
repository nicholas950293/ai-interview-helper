import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transition,
  isTerminal,
  isWritable,
  assertWritable,
  nextStatusForSubmission,
} from '../../src/domain/session-state.js';
import { AppError } from '../../src/lib/errors.js';
import type { SessionStatus } from '../../src/lib/schemas.js';

describe('場次狀態機', () => {
  describe('合法轉移', () => {
    it('not_started 兌換連結後進入 in_progress', () => {
      expect(canTransition('not_started', 'in_progress')).toBe(true);
      expect(transition('not_started', 'in_progress')).toBe('in_progress');
    });

    it('in_progress 手動提交後進入 submitted', () => {
      expect(canTransition('in_progress', 'submitted')).toBe(true);
      expect(transition('in_progress', 'submitted')).toBe('submitted');
    });

    it('in_progress 逾期後進入 expired_submitted', () => {
      expect(canTransition('in_progress', 'expired_submitted')).toBe(true);
      expect(transition('in_progress', 'expired_submitted')).toBe('expired_submitted');
    });
  });

  describe('終態不可逆', () => {
    const terminals: SessionStatus[] = ['submitted', 'expired_submitted'];
    const allStatuses: SessionStatus[] = [
      'not_started',
      'in_progress',
      'submitted',
      'expired_submitted',
    ];

    it.each(terminals)('%s 是終態', (status) => {
      expect(isTerminal(status)).toBe(true);
    });

    it.each(['not_started', 'in_progress'] as SessionStatus[])('%s 不是終態', (status) => {
      expect(isTerminal(status)).toBe(false);
    });

    it.each(terminals)('%s 無法轉移至任何其他狀態', (from) => {
      for (const to of allStatuses) {
        expect(canTransition(from, to)).toBe(false);
      }
    });

    it.each(terminals)('對 %s 呼叫 transition 會擲出 SESSION_SUBMITTED', (from) => {
      expect(() => transition(from, 'in_progress')).toThrowError(AppError);
      try {
        transition(from, 'in_progress');
      } catch (err) {
        expect((err as AppError).code).toBe('SESSION_SUBMITTED');
      }
    });
  });

  describe('非法轉移', () => {
    it('not_started 不可直接跳到 submitted', () => {
      expect(canTransition('not_started', 'submitted')).toBe(false);
    });

    it('not_started 不可直接跳到 expired_submitted', () => {
      expect(canTransition('not_started', 'expired_submitted')).toBe(false);
    });

    it('任何狀態都不可回到 not_started', () => {
      expect(canTransition('in_progress', 'not_started')).toBe(false);
      expect(canTransition('not_started', 'not_started')).toBe(false);
    });

    it('對 not_started 寫入時擲出 SESSION_NOT_STARTED', () => {
      try {
        transition('not_started', 'submitted');
        throw new Error('應該擲出例外');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('SESSION_NOT_STARTED');
      }
    });
  });

  describe('可寫入判定', () => {
    it('僅 in_progress 允許寫入草稿與提問', () => {
      expect(isWritable('in_progress')).toBe(true);
      expect(isWritable('not_started')).toBe(false);
      expect(isWritable('submitted')).toBe(false);
      expect(isWritable('expired_submitted')).toBe(false);
    });

    it('assertWritable 對終態擲出 SESSION_SUBMITTED', () => {
      expect(() => assertWritable('submitted')).toThrowError(AppError);
      try {
        assertWritable('expired_submitted');
      } catch (err) {
        expect((err as AppError).code).toBe('SESSION_SUBMITTED');
      }
    });

    it('assertWritable 對 not_started 擲出 SESSION_NOT_STARTED', () => {
      try {
        assertWritable('not_started');
        throw new Error('應該擲出例外');
      } catch (err) {
        expect((err as AppError).code).toBe('SESSION_NOT_STARTED');
      }
    });

    it('assertWritable 對 in_progress 不擲出例外', () => {
      expect(() => assertWritable('in_progress')).not.toThrow();
    });
  });

  describe('提交終態的選擇', () => {
    it('未逾期的手動提交 → submitted', () => {
      expect(nextStatusForSubmission({ expired: false })).toBe('submitted');
    });

    it('逾期觸發的強制提交 → expired_submitted', () => {
      expect(nextStatusForSubmission({ expired: true })).toBe('expired_submitted');
    });
  });
});
