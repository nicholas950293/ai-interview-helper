import { useIsReadOnly, useStreaming } from '../../store/selectors';
import { sendCodeForReview } from '../../store/actions';

/**
 * 「傳送至 AI 側邊欄」（FR-018 / ui-contracts A-03）。
 *
 * `sendCodeForReview` 會先 `flushPendingSave()` 再送出，
 * 否則伺服端取到的是尚未含最新輸入的舊草稿。
 * 離線導致 flush 失敗時會阻擋送出並於 Feed 提示，
 * MUST NOT 以較舊的伺服端草稿充當附帶 Context。
 */
export function SendToAiButton() {
  const streaming = useStreaming();
  const readOnly = useIsReadOnly();

  return (
    <button
      type="button"
      disabled={readOnly || streaming.active}
      onClick={() => void sendCodeForReview()}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-subtle disabled:opacity-60"
    >
      <span aria-hidden="true">↗ </span>
      傳送至 AI 側邊欄
    </button>
  );
}
