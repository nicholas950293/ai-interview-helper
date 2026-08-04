import { useIsReadOnly, useStreaming } from '../../store/selectors';
import { askQuestionHint } from '../../store/actions';

/**
 * 「詢問 AI 題目重點」（FR-017 / ui-contracts A-02）。
 *
 * 不接受 questionId 傳參——Context 由 `sendChat` 從 store 讀取，
 * 因此按鈕不可能送出過期的題目（憲章原則 II）。
 */
export function AskAiButton() {
  const streaming = useStreaming();
  const readOnly = useIsReadOnly();

  return (
    <button
      type="button"
      disabled={readOnly || streaming.active}
      onClick={() => void askQuestionHint()}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-subtle disabled:opacity-60"
    >
      <span aria-hidden="true">💬 </span>
      詢問 AI 題目重點
    </button>
  );
}
