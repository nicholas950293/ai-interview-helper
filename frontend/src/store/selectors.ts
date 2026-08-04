import { useSessionStore, type SessionState } from './session';
import type { AnswerState, Question } from '../types';

/**
 * 衍生值 —— 一律以 selector 計算，MUST NOT 另存為狀態（憲章原則 II）。
 *
 * 每個 hook 只訂閱它真正需要的切片：編輯器輸入更新 `answers` 時，
 * 題目區與 AI 側欄不會重繪（效能契約，憲章原則 IV）。
 */

export function selectCurrentQuestion(state: SessionState): Question | undefined {
  return state.questions.find((q) => q.id === state.currentQuestionId);
}

export function selectCurrentAnswer(state: SessionState): AnswerState | undefined {
  return state.answers[state.currentQuestionId];
}

/** 場次進入終態後所有輸入轉為唯讀（憲章「提交不可逆」）。 */
export function selectIsReadOnly(state: SessionState): boolean {
  return state.session === null || state.session.status !== 'in_progress';
}

/**
 * 剩餘秒數 —— 由 `deadlineAt` 與校時後的時鐘推導，
 * MUST NOT 以純本地累加計時（contracts/ui-contracts.md）。
 */
export function computeRemainingSec(
  deadlineAt: string | null,
  clockOffsetMs: number,
  now: number = Date.now()
): number {
  if (!deadlineAt) return 0;
  const remainingMs = Date.parse(deadlineAt) - (now + clockOffsetMs);
  return Math.max(0, Math.floor(remainingMs / 1000));
}

export function selectRemainingSec(state: SessionState, now: number = Date.now()): number {
  return computeRemainingSec(state.session?.deadlineAt ?? null, state.clockOffsetMs, now);
}

export function selectHasUnsavedChanges(state: SessionState): boolean {
  return Object.values(state.answers).some((a) => a.dirty);
}

// --- React hooks -------------------------------------------------------------

export const useCurrentQuestion = () => useSessionStore(selectCurrentQuestion);
export const useCurrentAnswer = () => useSessionStore(selectCurrentAnswer);
export const useIsReadOnly = () => useSessionStore(selectIsReadOnly);
export const useCurrentQuestionId = () => useSessionStore((s) => s.currentQuestionId);
export const useQuestions = () => useSessionStore((s) => s.questions);
export const useSession = () => useSessionStore((s) => s.session);
export const useChat = () => useSessionStore((s) => s.chat);
export const useCollaborationMode = () => useSessionStore((s) => s.collaborationMode);
export const useStreaming = () => useSessionStore((s) => s.streaming);
export const useConnectivity = () => useSessionStore((s) => s.connectivity);
export const useHasUnsavedChanges = () => useSessionStore(selectHasUnsavedChanges);

export const useApplyingBlockKey = () => useSessionStore((s) => s.applyingBlockKey);

/** 只訂閱單一題目的作答，避免其他題目的變更觸發重繪。 */
export const useAnswer = (questionId: string) => useSessionStore((s) => s.answers[questionId]);
