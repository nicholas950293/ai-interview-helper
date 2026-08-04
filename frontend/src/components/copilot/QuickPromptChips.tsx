import { useCurrentQuestion, useIsReadOnly, useStreaming } from '../../store/selectors';
import { sendChat } from '../../store/actions';

/**
 * 快捷提問 Chips（FR-013 / ui-contracts A-04）。
 *
 * 內容來自 `currentQuestion.quickPrompts`，MUST 隨當前題目變動——
 * 因此直接訂閱 store，不接受由父層傳入的快照（憲章原則 II）。
 * 點擊即送出，無需額外輸入。
 */
export function QuickPromptChips() {
  const question = useCurrentQuestion();
  const streaming = useStreaming();
  const readOnly = useIsReadOnly();

  const prompts = question?.quickPrompts ?? [];
  if (prompts.length === 0) return null;

  const disabled = readOnly || streaming.active;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          disabled={disabled}
          onClick={() => void sendChat({ content: prompt, source: 'quick_prompt' })}
          className="rounded-full border border-border px-3 py-1 text-xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary disabled:opacity-60"
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
