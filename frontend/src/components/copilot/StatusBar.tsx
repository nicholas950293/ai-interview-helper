import { useCurrentQuestion, useQuestions } from '../../store/selectors';

/**
 * In-Context 狀態列（FR-019 / ui-contracts A-01 步驟 4）。
 *
 * 直接訂閱 `currentQuestion`，MUST NOT 接受傳參——
 * 由父層傳入快照的話，切題後這裡會停留在舊題目，而應試者看不出來（憲章原則 II）。
 */
export function StatusBar() {
  const question = useCurrentQuestion();
  const questions = useQuestions();

  if (!question) return null;

  const index = questions.findIndex((q) => q.id === question.id);

  return (
    <div
      data-testid="in-context-status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-border bg-surface-subtle px-3 py-1.5 text-xs"
    >
      <span className="text-text-muted">目前討論的題目</span>
      <span className="font-medium text-text-primary">
        Q{index + 1}・{question.title}
      </span>
    </div>
  );
}
